#!/usr/bin/env node
// 로컬에서 실행 중인 Worker(wrangler dev)에 대해 API 전체 흐름을 검증합니다.
// 사용: npm run dev (다른 터미널) → npm run smoke
const BASE = (process.env.BASE_URL || "http://127.0.0.1:8787").replace(/\/+$/, "");
const ORIGIN = process.env.TEST_ORIGIN || "https://psb0118.github.io";
let passed = 0;
let failed = 0;

function ok(name, cond, detail) {
  if (cond) {
    passed++;
    console.log("PASS " + name);
  } else {
    failed++;
    console.log("FAIL " + name + (detail === undefined ? "" : "  [" + JSON.stringify(detail) + "]"));
  }
}

async function call(path, { method = "GET", body, token, origin = ORIGIN } = {}) {
  const headers = {};
  if (origin) headers.Origin = origin;
  if (token) headers.Authorization = "Bearer " + token;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch (e) {}
  return { status: res.status, json, headers: res.headers };
}

const random = () => Math.random().toString(36).slice(2, 8);
const nameA = "테스터" + random();
const nameB = "라이벌" + random();

const health = await call("/api/health");
ok("health 200", health.status === 200 && health.json.ok === true, health.status);

const pre = await fetch(BASE + "/api/save", {
  method: "OPTIONS",
  headers: { Origin: ORIGIN, "Access-Control-Request-Method": "PUT" },
});
ok("CORS preflight 204", pre.status === 204, pre.status);
ok("CORS 허용 오리진", pre.headers.get("access-control-allow-origin") === ORIGIN, pre.headers.get("access-control-allow-origin"));
ok("CORS 허용 헤더에 authorization", String(pre.headers.get("access-control-allow-headers")).includes("authorization"));

const evil = await call("/api/health", { origin: "https://evil.example" });
ok("CORS 비허용 오리진 차단", evil.headers.get("access-control-allow-origin") === null, evil.headers.get("access-control-allow-origin"));

const badName = await call("/api/register", { method: "POST", body: { nickname: "a" } });
ok("닉네임 검증 400", badName.status === 400 && badName.json.error === "bad_nickname", badName.json);

const regA = await call("/api/register", { method: "POST", body: { nickname: nameA } });
ok("가입 201", regA.status === 201 && /^[a-f0-9]{64}$/.test(regA.json.token || ""), regA.status);
const tokenA = regA.json.token;

const dupName = await call("/api/profile", { method: "PUT", token: tokenA, body: { nickname: nameB } });
ok("닉네임 중복 허용", dupName.status === 200 && dupName.json.nickname === nameB, dupName.status);
await call("/api/profile", { method: "PUT", token: tokenA, body: { nickname: nameA } });

const noAuth = await call("/api/save");
ok("토큰 없으면 401", noAuth.status === 401 && noAuth.json.error === "unauthorized", noAuth.status);
const badAuth = await call("/api/save", { token: "f".repeat(64) });
ok("가짜 토큰 401", badAuth.status === 401, badAuth.status);

const emptySave = await call("/api/save", { token: tokenA });
ok("저장 없음 404", emptySave.status === 404 && emptySave.json.error === "no_save", emptySave.status);

const saveBody = {
  costBasisIncludesFee: true,
  state: { cash: 12345678, cloud: { nickname: nameA, auto: true, token: "SHOULD_NOT_STORE" } },
  fx: { usd: 1400 },
  stocks: [{ id: "future_ai", own: 3, price: 50000, avgBuy: 49000 }],
  products: [{ id: "parking", amount: 0 }],
};
const put1 = await call("/api/save", { method: "PUT", token: tokenA, body: { data: saveBody, revision: 0 } });
ok("저장 1회차 revision 1", put1.status === 200 && put1.json.revision === 1, put1.json);
ok("저장 크기 기록", put1.json.size > 100, put1.json.size);

const got1 = await call("/api/save", { token: tokenA });
ok("저장 조회", got1.status === 200 && got1.json.data.state.cash === 12345678 && got1.json.revision === 1, got1.status);
ok("토큰은 저장 데이터에서 제거", !JSON.stringify(got1.json.data).includes("SHOULD_NOT_STORE"), JSON.stringify(got1.json.data.state.cloud));

const conflict = await call("/api/save", { method: "PUT", token: tokenA, body: { data: saveBody, revision: 0 } });
ok("revision 충돌 409", conflict.status === 409 && conflict.json.error === "conflict", conflict.status);

const put2 = await call("/api/save", { method: "PUT", token: tokenA, body: { data: saveBody, revision: 1 } });
ok("revision 맞으면 2회차", put2.status === 200 && put2.json.revision === 2, put2.json);

const forced = await call("/api/save", { method: "PUT", token: tokenA, body: { data: saveBody, revision: 0, force: true } });
ok("force 덮어쓰기 3회차", forced.status === 200 && forced.json.revision === 3, forced.json);

const badSave = await call("/api/save", { method: "PUT", token: tokenA, body: { data: { stocks: [] }, revision: 3 } });
ok("state 없는 저장 400", badSave.status === 400 && badSave.json.error === "bad_save", badSave.status);

const bigSave = await call("/api/save", {
  method: "PUT",
  token: tokenA,
  body: { data: { state: { cash: 1, blob: "x".repeat(330 * 1024) } }, revision: 3 },
});
ok("과대 저장 413", bigSave.status === 413, bigSave.status);

const badSeason = await call("/api/score", { method: "POST", token: tokenA, body: { score: 1, season: "2026-13" } });
ok("잘못된 시즌 400", badSeason.status === 400 && badSeason.json.error === "bad_season", badSeason.status);

const oldSeason = await call("/api/score", { method: "POST", token: tokenA, body: { score: 1, season: "2020-01" } });
ok("지난 시즌 등록 400", oldSeason.status === 400, oldSeason.status);

const badScore = await call("/api/score", { method: "POST", token: tokenA, body: { score: -5 } });
ok("음수 점수 400", badScore.status === 400 && badScore.json.error === "bad_score", badScore.status);

const scoreA = await call("/api/score", { method: "POST", token: tokenA, body: { score: 12000000 } });
ok("점수 등록 1위", scoreA.status === 200 && scoreA.json.rank === 1 && scoreA.json.best === 12000000, scoreA.json);

const regB = await call("/api/register", { method: "POST", body: { nickname: nameB } });
const tokenB = regB.json.token;
const scoreB = await call("/api/score", { method: "POST", token: tokenB, body: { score: 34000000 } });
ok("두 번째 플레이어 1위", scoreB.status === 200 && scoreB.json.rank === 1, scoreB.json);

const lowerAgain = await call("/api/score", { method: "POST", token: tokenB, body: { score: 1000 } });
ok("낮은 점수는 최고 기록 유지", lowerAgain.json.best === 34000000, lowerAgain.json);

const board = await call("/api/leaderboard?limit=10", { token: tokenB });
ok("리더보드 200", board.status === 200 && Array.isArray(board.json.entries), board.status);
ok("리더보드 정렬", board.json.entries[0].nickname === nameB && board.json.entries[0].score === 34000000, board.json.entries[0]);
ok("리더보드 내 순위", board.json.me && board.json.me.rank === 1, board.json.me);
ok("리더보드에 플레이어 id 포함", board.json.entries[0].playerId === regB.json.playerId, board.json.entries[0].playerId);

const boardA = await call("/api/leaderboard?limit=10", { token: tokenA });
ok("A의 순위는 2위", boardA.json.me && boardA.json.me.rank === 2, boardA.json.me);

const rename = await call("/api/profile", { method: "PUT", token: tokenA, body: { nickname: nameA + "님" } });
ok("닉네임 변경", rename.status === 200 && rename.json.nickname === nameA + "님", rename.json);

const boardX = await call("/api/leaderboard?limit=3", { token: tokenB });
ok("limit 적용", boardX.json.entries.length <= 3, boardX.json.entries.length);
ok("총 참가자 수", boardX.json.total === 2, boardX.json.total);

console.log(`\n== ${passed}/${passed + failed} passed ==`);
process.exit(failed ? 1 : 0);
