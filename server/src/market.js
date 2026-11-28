// 공유 일일 시세 — 게임(index.html)과 완전히 같은 계산을 서버에서도 수행합니다.
// 날짜는 한국 자정 경계이고, 변동률은 전역 시드로 고정되어 모든 플레이어가 같은 값을 봅니다.
// 이 모듈은 순수 함수만 두고(D1 접근 없음), 저장·Cron은 index.js가 담당합니다.
export const WORLD_SEED = 20261126;
export const REAL_DAY_MS = 86400000;
export const KST_OFFSET_MS = 9 * 3600 * 1000;
// 2026-01-01 00:00 KST = 2025-12-31 15:00 UTC
export const GAME_DAY_EPOCH_MS = Date.UTC(2026, 0, 1) - KST_OFFSET_MS;
export const MARKET_MIN = -0.08;
export const MARKET_MAX = 0.08;
// 경기 국면 보정(클라이언트 state.economy.phase). 기본값은 중립입니다.
export const PHASE_ADJUST = { 호황: 0.002, 중립: 0, 불황: -0.002 };

export function worldHash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// FNV 해시를 mulberry32 한 단계로 섞어 0~1 난수를 만듭니다(게임과 동일).
export function worldRand(...parts) {
  let a = worldHash(WORLD_SEED + "|" + parts.join("|"));
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

export function dayIndexAt(ms = Date.now()) {
  const t = Number.isFinite(+ms) ? +ms : Date.now();
  return Math.floor((t - GAME_DAY_EPOCH_MS) / REAL_DAY_MS);
}

export function dayStartMs(day) {
  return GAME_DAY_EPOCH_MS + Math.max(0, Math.floor(+day || 0)) * REAL_DAY_MS;
}

// 게임의 marketDayDateText와 같은 한국 날짜(YYYY-MM-DD)를 돌려줍니다.
export function dayDateText(day) {
  const d = new Date(dayStartMs(day) + KST_OFFSET_MS);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

// 일일 시장 변동률(경기 국면 보정 전 기준선). 클라이언트 dailyMarketReturn과 같은 식입니다.
// 하루 평균은 완만한 우상향(+0.36%p 안팎)이고, 범위는 ±8%입니다.
export function marketReturn(day) {
  const d = Number.isFinite(+day) ? Math.floor(+day) : dayIndexAt();
  const r = (worldRand("mkt", d) - 0.47) * 0.045 + 0.0036;
  return clamp(r, MARKET_MIN, MARKET_MAX);
}

// 국면 보정을 적용한 값이 필요할 때 사용합니다(기본은 중립).
export function marketReturnWithPhase(day, phase = "중립") {
  const adjust = PHASE_ADJUST[phase] != null ? PHASE_ADJUST[phase] : 0;
  return clamp(marketReturn(day) + adjust, MARKET_MIN, MARKET_MAX);
}

export function secondsUntilNextDay(now = Date.now()) {
  const day = dayIndexAt(now);
  return Math.max(0, (dayStartMs(day + 1) - now) / 1000);
}

// API 응답용 하루 묶음입니다.
export function marketCandle(day, now = Date.now(), phase = "중립") {
  const d = Number.isFinite(+day) ? Math.floor(+day) : dayIndexAt(now);
  return {
    day: d,
    date: dayDateText(d),
    marketReturn: marketReturnWithPhase(d, phase),
    baseMarketReturn: marketReturn(d),
    phase: PHASE_ADJUST[phase] != null ? phase : "중립",
    phaseAdjust: PHASE_ADJUST[phase] != null ? PHASE_ADJUST[phase] : 0,
    dayStartAt: dayStartMs(d),
    dayEndAt: dayStartMs(d + 1),
    secondsLeft: Math.max(0, (dayStartMs(d + 1) - now) / 1000),
  };
}

// Cron: 오늘·어제 시세를 D1에 남기고 오래된 행을 정리합니다.
// 어제를 함께 쓰는 이유는 Cron이 하루 걸러 실패해도 구멍이 생기지 않게 하기 위함입니다.
export async function rollMarketDays(env, now = Date.now(), keepDays = 400) {
  const today = dayIndexAt(now);
  const days = [today - 1, today].filter((d) => d >= 0);
  const rows = days.map((d) => ({
    day: d,
    date: dayDateText(d),
    marketReturn: Number(marketReturn(d).toFixed(8)),
  }));
  for (const row of rows) {
    await env.DB.prepare(
      `INSERT INTO market_days (day, date, market_return, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(day) DO UPDATE SET date = excluded.date,
         market_return = excluded.market_return, updated_at = excluded.updated_at`
    )
      .bind(row.day, row.date, row.marketReturn, now)
      .run();
  }
  const cutoff = today - Math.max(30, Math.floor(+keepDays || 400));
  await env.DB.prepare("DELETE FROM market_days WHERE day < ?").bind(cutoff).run();
  return { ok: true, day: today, days: rows, cutoff, updatedAt: now };
}

// 저장된 시세를 읽고, 없으면 계산해서 돌려줍니다(로컬 첫 실행·Cron 이전에도 응답).
export async function marketHistory(env, now = Date.now(), count = 30) {
  const limit = Math.max(1, Math.min(365, Math.floor(+count) || 30));
  const today = dayIndexAt(now);
  let stored = [];
  try {
    const res = await env.DB.prepare(
      "SELECT day, date, market_return, updated_at FROM market_days WHERE day <= ? ORDER BY day DESC LIMIT ?"
    )
      .bind(today, limit)
      .all();
    stored = (res && res.results) || [];
  } catch (e) {
    stored = [];
  }
  const byDay = new Map(stored.map((r) => [Number(r.day), r]));
  const days = [];
  for (let d = today; d > today - limit && d >= 0; d--) {
    const row = byDay.get(d);
    days.push(
      row
        ? {
            day: d,
            date: row.date || dayDateText(d),
            marketReturn: Number(row.market_return),
            stored: true,
            updatedAt: Number(row.updated_at) || null,
          }
        : { day: d, date: dayDateText(d), marketReturn: marketReturn(d), stored: false, updatedAt: null }
    );
  }
  return { days: days.reverse(), count: days.length, today, storedDays: stored.length };
}
