-- 머니 플레이그라운드 클라우드 저장 + 리더보드 (Cloudflare D1 / SQLite)
-- 적용: wrangler d1 execute mp-leaderboard --local --file=./schema.sql
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS players (
  id         TEXT PRIMARY KEY,                 -- 서버가 발급하는 16자 hex
  token_hash TEXT NOT NULL UNIQUE,             -- 기기 토큰의 SHA-256(평문 저장 금지)
  nickname   TEXT NOT NULL,                    -- 중복 허용(계정/비밀번호가 없는 기기 토큰 방식)
  created_at INTEGER NOT NULL,
  last_seen  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS saves (
  player_id  TEXT PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  data       TEXT NOT NULL,                    -- 게임 buildSaveData() 결과(JSON)
  revision   INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL,
  size       INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS scores (
  season        TEXT NOT NULL,                 -- YYYY-MM (UTC)
  player_id     TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  score         INTEGER NOT NULL,              -- 순자산(원)
  verified      INTEGER NOT NULL DEFAULT 0,    -- 서버가 저장 파일과 대조해 검증했는지
  checked_worth INTEGER NOT NULL DEFAULT 0,    -- 저장 파일에서 계산한 순자산(감사용)
  updated_at    INTEGER NOT NULL,
  PRIMARY KEY (season, player_id)
);

CREATE INDEX IF NOT EXISTS idx_scores_season ON scores(season, score DESC, updated_at ASC);

-- 공유 일일 시세: Cron이 오늘·어제 변동률을 남깁니다(게임과 같은 전역 시드 계산).
CREATE TABLE IF NOT EXISTS market_days (
  day           INTEGER PRIMARY KEY,           -- 게임 며칠차(2026-01-01 KST = 0)
  date          TEXT NOT NULL,                 -- YYYY-MM-DD (한국 날짜)
  market_return REAL NOT NULL,                 -- 그날 시장 변동률(경기 국면 보정 전)
  updated_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS rate (
  key          TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count        INTEGER NOT NULL,
  PRIMARY KEY (key, window_start)
);
