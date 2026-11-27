-- 이미 scores 테이블을 만든 D1에 서버 검증 컬럼을 추가합니다.
-- 새로 만드는 데이터베이스는 schema.sql만 실행하면 됩니다.
-- 적용: wrangler d1 execute mp-leaderboard --local --file=./migrate-scores-verified.sql
--       (원격은 --local 대신 --remote)
ALTER TABLE scores ADD COLUMN verified INTEGER NOT NULL DEFAULT 0;
ALTER TABLE scores ADD COLUMN checked_worth INTEGER NOT NULL DEFAULT 0;
