#!/usr/bin/env node
// 공유 일일 시세 모듈 단위 테스트 (Worker/D1 없이 실행).
// 실행: node test/market.test.js
"use strict";
import assert from "node:assert/strict";
import {
  GAME_DAY_EPOCH_MS,
  REAL_DAY_MS,
  dayDateText,
  dayIndexAt,
  dayStartMs,
  marketCandle,
  marketHistory,
  marketReturn,
  rollMarketDays,
  secondsUntilNextDay,
  worldRand,
} from "../src/market.js";

let pass = 0;
const failures = [];
function check(name, fn) {
  try {
    fn();
    pass++;
    console.log("PASS " + name);
  } catch (err) {
    failures.push(name);
    console.log("FAIL " + name + "  [" + (err && err.message) + "]");
  }
}

function fakeDb(rows = []) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      calls.push(sql);
      const stmt = { args: [] };
      stmt.bind = (...args) => {
        stmt.args = args;
        return stmt;
      };
      stmt.run = async () => ({ success: true });
      stmt.all = async () => ({ results: rows });
      stmt.first = async () => null;
      return stmt;
    },
  };
}

// 게임(index.html)과 값이 같아야 합니다. 아래 값은 클라이언트 dailyMarketReturn에서 뽑았습니다.
const PARITY = [
  [0, 0.0043555120192933835],
  [1, 0.01752594241993502],
  [2, 0.0035130126181058597],
  [100, 0.013462637045932934],
  [331, 0.013835038853622975],
  [500, 0.022952660893835127],
];

check("epoch은 2026-01-01 00:00 KST", () => {
  assert.equal(GAME_DAY_EPOCH_MS, Date.UTC(2026, 0, 1) - 9 * 3600 * 1000);
  assert.equal(dayDateText(0), "2026-01-01");
  assert.equal(dayStartMs(0), GAME_DAY_EPOCH_MS);
});

check("게임과 같은 일일 변동률(패리티)", () => {
  for (const [day, expected] of PARITY) {
    assert.equal(marketReturn(day), expected, `day ${day}`);
  }
});

check("날짜 → 게임 일수 매핑", () => {
  assert.equal(dayIndexAt(GAME_DAY_EPOCH_MS), 0);
  assert.equal(dayIndexAt(GAME_DAY_EPOCH_MS + REAL_DAY_MS - 1), 0);
  assert.equal(dayIndexAt(GAME_DAY_EPOCH_MS + REAL_DAY_MS), 1);
  assert.equal(dayDateText(331), "2026-11-28");
  assert.equal(dayIndexAt(Date.UTC(2026, 10, 28, 0, 0, 0) - 9 * 3600 * 1000 + 12 * 3600 * 1000), 331);
});

check("하루 남은 초 계산", () => {
  assert.equal(secondsUntilNextDay(dayStartMs(331)), REAL_DAY_MS / 1000);
  assert.equal(secondsUntilNextDay(dayStartMs(331) + 3600 * 1000), 82800);
});

check("같은 날짜는 항상 같은 값", () => {
  const first = Array.from({ length: 400 }, (_, i) => marketReturn(i));
  const second = Array.from({ length: 400 }, (_, i) => marketReturn(i));
  assert.deepEqual(first, second);
});

check("변동률은 ±8% 범위", () => {
  for (let d = 0; d < 800; d++) {
    const r = marketReturn(d);
    assert.ok(r >= -0.08 && r <= 0.08, `day ${d} = ${r}`);
    assert.equal(Number.isFinite(worldRand("mkt", d)), true);
  }
});

check("경기 국면 보정", () => {
  const base = marketReturn(10);
  const candle = marketCandle(10, dayStartMs(10), "호황");
  assert.equal(candle.baseMarketReturn, base);
  assert.ok(Math.abs(candle.marketReturn - Math.min(0.08, base + 0.002)) < 1e-12);
  assert.equal(marketCandle(10, dayStartMs(10)).phase, "중립");
  assert.equal(marketCandle(10, dayStartMs(10), "이상한값").phaseAdjust, 0);
});

check("Cron: 오늘·어제 시세 기록 + 정리", async () => {
  const db = fakeDb();
  const now = dayStartMs(331) + 1000;
  const result = await rollMarketDays({ DB: db }, now, 400);
  assert.equal(result.day, 331);
  assert.deepEqual(result.days.map((d) => d.day), [330, 331]);
  assert.equal(result.cutoff, 331 - 400);
  assert.equal(db.calls.filter((sql) => sql.includes("INSERT INTO market_days")).length, 2);
  assert.equal(db.calls.filter((sql) => sql.includes("DELETE FROM market_days")).length, 1);
  // 첫날(day 0)에는 어제(-1)를 쓰지 않습니다.
  const first = await rollMarketDays({ DB: fakeDb() }, dayStartMs(0) + 1000, 400);
  assert.deepEqual(first.days.map((d) => d.day), [0]);
});

check("Cron: 저장 값은 8자리로 반올림", async () => {
  let args = null;
  const db = {
    prepare() {
      const stmt = {
        bind(...a) {
          args = a;
          return stmt;
        },
        run: async () => ({}),
      };
      return stmt;
    },
  };
  await rollMarketDays({ DB: db }, dayStartMs(5) + 1, 400);
  assert.equal(args[2], Number(marketReturn(4).toFixed(8)));
});

check("히스토리: 저장이 없으면 계산해서 채움", async () => {
  const result = await marketHistory({ DB: fakeDb([]) }, dayStartMs(20) + 1, 7);
  assert.equal(result.days.length, 7);
  assert.equal(result.storedDays, 0);
  assert.equal(result.days[0].day, 14);
  assert.equal(result.days[6].day, 20);
  assert.equal(result.days[6].stored, false);
  assert.equal(result.days[6].marketReturn, marketReturn(20));
});

check("히스토리: 저장된 행을 우선 사용", async () => {
  const rows = [{ day: 20, date: "2026-01-21", market_return: 0.0123, updated_at: 999 }];
  const result = await marketHistory({ DB: fakeDb(rows) }, dayStartMs(20) + 1, 3);
  const today = result.days.find((d) => d.day === 20);
  assert.equal(today.stored, true);
  assert.equal(today.marketReturn, 0.0123);
  assert.equal(today.updatedAt, 999);
});

check("히스토리: D1 오류에도 계산값으로 응답", async () => {
  const broken = {
    prepare() {
      throw new Error("no such table");
    },
  };
  const result = await marketHistory({ DB: broken }, dayStartMs(3) + 1, 3);
  assert.equal(result.days.length, 3);
  assert.equal(result.days[2].marketReturn, marketReturn(3));
});

check("히스토리: 개수 제한", async () => {
  const result = await marketHistory({ DB: fakeDb([]) }, dayStartMs(10) + 1, 999);
  assert.equal(result.days.length, 365);
});

console.log(`\n== ${pass}/${pass + failures.length} passed ==`);
process.exit(failures.length ? 1 : 0);
