// 머니 플레이그라운드 — 클라우드 세이브 + 월간 리더보드 (Cloudflare Workers + D1)
// 인증: 서버가 발급한 64자 hex 기기 토큰을 Bearer로 사용합니다. 비밀번호/이메일 없음.
const MAX_BODY = 320 * 1024;
const MAX_SAVE_TEXT = 300 * 1024;
const MAX_SCORE = 1e15;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(origin, env);
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }
    try {
      const res = await route(request, url, env);
      return addHeaders(res, cors);
    } catch (err) {
      const status = err && err.status ? err.status : 500;
      if (status >= 500) console.log("unhandled", (err && err.stack) || err);
      return json(
        { error: (err && err.code) || "server_error", message: status >= 500 ? "서버 오류가 발생했습니다." : (err && err.message) || "" },
        status,
        cors
      );
    }
  },
};

async function route(req, url, env) {
  const p = url.pathname.replace(/\/+$/, "") || "/";
  if (p === "/" || p === "/api/health") return json({ ok: true, service: "mp-cloud", now: Date.now() });
  if (p === "/api/register" && req.method === "POST") return register(req, env);
  if (p === "/api/profile" && req.method === "PUT") return updateProfile(req, env);
  if (p === "/api/save" && req.method === "PUT") return putSave(req, env);
  if (p === "/api/save" && req.method === "GET") return getSave(req, env);
  if (p === "/api/score" && req.method === "POST") return postScore(req, env);
  if (p === "/api/leaderboard" && req.method === "GET") return leaderboard(req, url, env);
  return json({ error: "not_found", message: "없는 경로입니다." }, 404);
}

// ── 핸들러 ───────────────────────────────────────
async function register(req, env) {
  await takeRate(env, `reg:${clientIp(req)}`, 10, 3600);
  const body = await readJson(req, 2048);
  const nickname = normalizeNickname(body.nickname);
  const token = randomHex(32);
  const id = randomHex(8);
  const now = Date.now();
  // 닉네임은 중복을 허용합니다. 계정·비밀번호가 없어 닉네임을 선점하면
  // 연결을 해제한 뒤 같은 이름으로 다시 시작할 수 없기 때문입니다.
  await env.DB.prepare(
    "INSERT INTO players (id, token_hash, nickname, created_at, last_seen) VALUES (?, ?, ?, ?, ?)"
  ).bind(id, await sha256Hex(token), nickname, now, now).run();
  // 토큰은 이 응답에서 한 번만 내려갑니다. 서버에는 해시만 저장됩니다.
  return json({ playerId: id, token, nickname }, 201);
}

async function updateProfile(req, env) {
  const player = await requirePlayer(req, env);
  await takeRate(env, `profile:${player.id}`, 10, 60);
  const body = await readJson(req, 1024);
  const nickname = normalizeNickname(body.nickname);
  await env.DB.prepare("UPDATE players SET nickname = ? WHERE id = ?").bind(nickname, player.id).run();
  return json({ nickname });
}

async function getSave(req, env) {
  const player = await requirePlayer(req, env);
  await takeRate(env, `saveget:${player.id}`, 60, 60);
  const row = await env.DB.prepare("SELECT data, revision, updated_at FROM saves WHERE player_id = ?").bind(player.id).first();
  if (!row) return json({ error: "no_save", message: "서버에 저장된 진행이 없습니다." }, 404);
  let data;
  try {
    data = JSON.parse(row.data);
  } catch (e) {
    throw httpError(500, "corrupt_save", "서버 저장이 손상되었습니다.");
  }
  return json({ data, revision: row.revision, updatedAt: row.updated_at });
}

async function putSave(req, env) {
  const player = await requirePlayer(req, env);
  await takeRate(env, `saveput:${player.id}`, 30, 60);
  const body = await readJson(req, MAX_BODY);
  const data = validateSave(body.data);
  const text = JSON.stringify(data);
  if (text.length > MAX_SAVE_TEXT) throw httpError(413, "too_large", "저장 파일이 너무 큽니다.");

  const now = Date.now();
  const row = await env.DB.prepare("SELECT revision FROM saves WHERE player_id = ?").bind(player.id).first();
  const base = Number.isInteger(body.revision) && body.revision >= 0 ? body.revision : 0;
  if (row && base !== row.revision && body.force !== true) {
    throw httpError(409, "conflict", "서버에 더 최신 저장이 있습니다.");
  }
  const revision = (row ? row.revision : 0) + 1;
  await env.DB.prepare(
    `INSERT INTO saves (player_id, data, revision, updated_at, size) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(player_id) DO UPDATE SET data = excluded.data, revision = excluded.revision,
       updated_at = excluded.updated_at, size = excluded.size`
  ).bind(player.id, text, revision, now, text.length).run();
  return json({ revision, updatedAt: now, size: text.length });
}

async function postScore(req, env) {
  const player = await requirePlayer(req, env);
  await takeRate(env, `score:${player.id}`, 10, 60);
  const body = await readJson(req, 2048);
  const season = String(body.season || monthKey());
  if (!isSeasonKey(season)) throw httpError(400, "bad_season", "시즌 형식이 올바르지 않습니다.");
  if (season !== monthKey() && season !== previousMonthKey()) {
    throw httpError(400, "bad_season", "지난 시즌에는 점수를 등록할 수 없습니다.");
  }
  const score = Math.round(Number(body.score));
  if (!Number.isFinite(score) || score < 0 || score > MAX_SCORE) {
    throw httpError(400, "bad_score", "점수 범위가 올바르지 않습니다.");
  }
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO scores (season, player_id, score, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(season, player_id) DO UPDATE SET
       score = MAX(scores.score, excluded.score), updated_at = excluded.updated_at`
  ).bind(season, player.id, score, now).run();
  const mine = await env.DB.prepare("SELECT score FROM scores WHERE season = ? AND player_id = ?").bind(season, player.id).first();
  const above = await env.DB.prepare("SELECT COUNT(*) AS n FROM scores WHERE season = ? AND score > ?").bind(season, mine.score).first();
  return json({ season, best: mine.score, rank: (above ? above.n : 0) + 1 });
}

async function leaderboard(req, url, env) {
  await takeRate(env, `board:${clientIp(req)}`, 120, 60);
  const season = url.searchParams.get("season") || monthKey();
  if (!isSeasonKey(season)) throw httpError(400, "bad_season", "시즌 형식이 올바르지 않습니다.");
  const limit = Math.max(1, Math.min(50, Number(url.searchParams.get("limit")) || 10));
  const rows = await env.DB.prepare(
    `SELECT p.id AS player_id, p.nickname, s.score, s.updated_at FROM scores s JOIN players p ON p.id = s.player_id
     WHERE s.season = ? ORDER BY s.score DESC, s.updated_at ASC LIMIT ?`
  ).bind(season, limit).all();
  const entries = (rows.results || []).map((r, i) => ({
    rank: i + 1, playerId: r.player_id, nickname: r.nickname, score: r.score, updatedAt: r.updated_at
  }));
  const totalRow = await env.DB.prepare("SELECT COUNT(*) AS n FROM scores WHERE season = ?").bind(season).first();

  let me = null;
  try {
    const player = await requirePlayer(req, env);
    const mine = await env.DB.prepare("SELECT score FROM scores WHERE season = ? AND player_id = ?").bind(season, player.id).first();
    if (mine) {
      const above = await env.DB.prepare("SELECT COUNT(*) AS n FROM scores WHERE season = ? AND score > ?").bind(season, mine.score).first();
      me = { rank: (above ? above.n : 0) + 1, score: mine.score };
    }
  } catch (e) {
    // 비로그인/만료 토큰은 순위만 보여 줍니다.
  }
  return json({ season, entries, me, total: totalRow ? totalRow.n : 0 });
}

// ── 검증/유틸 ────────────────────────────────────
function validateSave(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw httpError(400, "bad_save", "저장 데이터가 없습니다.");
  if (!data.state || typeof data.state !== "object" || Array.isArray(data.state)) throw httpError(400, "bad_save", "state가 없습니다.");
  if (data.stocks != null && !Array.isArray(data.stocks)) throw httpError(400, "bad_save", "stocks 형식이 올바르지 않습니다.");
  if (data.products != null && !Array.isArray(data.products)) throw httpError(400, "bad_save", "products 형식이 올바르지 않습니다.");
  if ((data.stocks || []).length > 300 || (data.products || []).length > 100) throw httpError(400, "bad_save", "항목 수가 너무 많습니다.");
  // 실수로 딸려 온 인증 토큰은 저장하지 않습니다.
  if (data.state.cloud && typeof data.state.cloud === "object") delete data.state.cloud.token;
  if (data.token) delete data.token;
  return data;
}

async function requirePlayer(req, env) {
  const m = /^Bearer ([a-f0-9]{64})$/.exec(req.headers.get("Authorization") || "");
  if (!m) throw httpError(401, "unauthorized", "클라우드 연결이 필요합니다.");
  const hash = await sha256Hex(m[1]);
  const row = await env.DB.prepare("SELECT id, nickname FROM players WHERE token_hash = ?").bind(hash).first();
  if (!row) throw httpError(401, "unauthorized", "연결 정보가 만료되었습니다. 다시 연결해 주세요.");
  return row;
}

function normalizeNickname(raw) {
  const s = String(raw == null ? "" : raw).trim().replace(/\s+/g, " ");
  if (!/^[\p{L}\p{N} ._-]{2,16}$/u.test(s)) {
    throw httpError(400, "bad_nickname", "닉네임은 한글/영문/숫자 2~16자로 입력해 주세요.");
  }
  return s;
}

async function readJson(req, maxBytes) {
  const text = await req.text();
  if (text.length > maxBytes) throw httpError(413, "too_large", "요청 본문이 너무 큽니다.");
  try {
    return JSON.parse(text);
  } catch (e) {
    throw httpError(400, "bad_json", "JSON 형식이 아닙니다.");
  }
}

async function takeRate(env, key, limit, windowSec) {
  const now = Math.floor(Date.now() / 1000);
  const bucket = now - (now % windowSec);
  const row = await env.DB.prepare("SELECT count FROM rate WHERE key = ? AND window_start = ?").bind(key, bucket).first();
  if (row && row.count >= limit) throw httpError(429, "rate_limited", "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.");
  await env.DB.prepare(
    `INSERT INTO rate (key, window_start, count) VALUES (?, ?, 1)
     ON CONFLICT(key, window_start) DO UPDATE SET count = count + 1`
  ).bind(key, bucket).run();
}

function corsHeaders(origin, env) {
  const allowed = String(env.ALLOWED_ORIGINS || "https://psb0118.github.io,http://127.0.0.1:3000,http://localhost:3000")
    .split(",").map((s) => s.trim()).filter(Boolean);
  const headers = { vary: "Origin" };
  if (origin && allowed.includes(origin)) {
    headers["access-control-allow-origin"] = origin;
    headers["access-control-allow-methods"] = "GET, PUT, POST, OPTIONS";
    headers["access-control-allow-headers"] = "authorization, content-type";
    headers["access-control-max-age"] = "86400";
  }
  return headers;
}

function addHeaders(res, extra) {
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries(extra)) h.set(k, v);
  return new Response(res.body, { status: res.status, headers: h });
}

function json(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: Object.assign({ "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }, headers),
  });
}

function httpError(status, code, message) {
  const e = new Error(message);
  e.status = status;
  e.code = code;
  return e;
}

function clientIp(req) {
  const raw = req.headers.get("CF-Connecting-IP") || req.headers.get("x-forwarded-for") || "127.0.0.1";
  return String(raw).split(",")[0].trim();
}

function monthKey(d = new Date()) {
  return d.toISOString().slice(0, 7);
}

function previousMonthKey() {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return monthKey(d);
}

function isSeasonKey(s) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(s));
}

function randomHex(bytes) {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
