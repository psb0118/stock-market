-- 기존 D1에 공유 일일 시세 테이블만 추가합니다.
-- 적용: wrangler d1 execute mp-leaderboard --remote --file=./migrate-market-days.sql
CREATE TABLE IF NOT EXISTS market_days (
  day           INTEGER PRIMARY KEY,
  date          TEXT NOT NULL,
  market_return REAL NOT NULL,
  updated_at    INTEGER NOT NULL
);
