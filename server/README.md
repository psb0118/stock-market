# 클라우드 세이브 · 리더보드 백엔드 (Cloudflare Workers + D1)

정적 GitHub Pages 게임에 **기기 단위 클라우드 저장**과 **월간 순자산 리더보드**를 붙이는 서버입니다.
배포하지 않은 상태이며, 로컬(Wrangler/workerd + 로컬 D1)에서 전부 검증할 수 있습니다.

## 구성

| 파일 | 역할 |
|---|---|
| `src/index.js` | Worker API (CORS, 토큰 인증, 저장/복원, 점수, 순위, 레이트 리밋, 공유 시세) |
| `src/market.js` | 공유 일일 시세 계산(게임과 같은 전역 시드)·Cron 기록·히스토리(순수 모듈) |
| `schema.sql` | D1 테이블 5개(`players`, `saves`, `scores`, `rate`, `market_days`) |
| `migrate-scores-verified.sql` | 기존 `scores` 테이블에 서버 검증 컬럼을 추가 |
| `migrate-market-days.sql` | 기존 D1에 `market_days` 테이블만 추가 |
| `test/market.test.js` | 시세 계산·Cron·히스토리 단위 테스트(Worker 불필요) |
| `wrangler.toml` | 로컬 개발 설정. `database_id`는 배포 시 교체 |
| `smoke.mjs` | 로컬 서버용 API 통합 테스트 30여 건 |
| `package.json` | `npm run dev` / `db:local` / `smoke` / `deploy` |

## API

| 메서드 | 경로 | 인증 | 설명 |
|---|---|---|---|
| GET | `/api/health` | - | 상태 확인 |
| POST | `/api/register` | - | 닉네임으로 플레이어 생성 → `playerId`, `token`(1회) |
| PUT | `/api/profile` | Bearer | 닉네임 변경 |
| GET | `/api/save` | Bearer | 클라우드 저장 조회 |
| PUT | `/api/save` | Bearer | 저장 업로드 (`revision` 충돌 시 409, `force:true`로 덮어쓰기) |
| POST | `/api/score` | Bearer | 시즌 최고 순자산 등록(저장 파일과 대조 후 최댓값 유지) |
| GET | `/api/leaderboard?season=YYYY-MM&limit=10` | 선택 | 상위 순위 + (토큰 있으면) 내 순위 |
| GET | `/api/market?day=N&phase=호황` | - | 그날의 공유 시세(`marketReturn`, `baseMarketReturn`, 날짜, 남은 초) |
| GET | `/api/market/history?days=30` | - | 최근 일별 시세(D1 저장값 우선, 없으면 계산) |

- 인증은 **서버가 발급한 64자 hex 기기 토큰**입니다. 비밀번호·이메일·쿠키가 없습니다.
- 서버에는 토큰의 SHA-256만 저장합니다. 토큰은 가입 응답에서 한 번만 내려갑니다.
- 저장 본문 상한 320KB(직렬화 300KB), 점수 상한 1e15, 닉네임 2~16자(한글/영문/숫자/공백/`._-`).
- **닉네임은 중복될 수 있습니다.** 계정·비밀번호가 없어 이름을 선점하면 연결을 해제한 뒤 같은 이름으로 시작할 수 없기 때문입니다. 신원은 기기 토큰입니다.
- 레이트 리밋: IP당 가입 10회/시간, 리더보드 120회/분, 플레이어당 저장 30회/분·점수 10회/분.
- **점수는 서버에 저장된 세이브와 대조합니다.** 현금·달러·주식·금융상품은 저장 값으로 서버가 직접 계산하고, 시세가 저장에 없는 부동산·금속·기업·채권·공매도는 `buildSaveData()`의 `valuation` 스냅샷을 더합니다. 계산한 순자산보다 2%+5만원 넘게 높은 점수는 `400 score_mismatch`로 거부됩니다. 저장이 없으면 `400 save_required`입니다.

## 공유 일일 시세 (`/api/market`) + Cron

- `index.html`의 `dailyMarketReturn`과 **같은 전역 시드(20261126)·같은 식**을 서버에서 계산합니다.
  같은 날짜면 누구나 같은 `marketReturn`을 받습니다(패리티는 `test/market.test.js`가 고정).
- 날짜 경계는 한국 자정(`GAME_DAY_EPOCH_MS = 2026-01-01 00:00 KST`), `day`는 0부터 시작합니다.
- `phase`(호황/중립/불황)를 주면 게임의 경기 국면 보정(±0.2%p)까지 적용합니다. 기본은 중립입니다.
- 응답은 `public, max-age=60`으로 캐시됩니다. 읽기 전용 공개 데이터이며 인증이 없습니다.
- **Cron**(`wrangler.toml`의 `[triggers] crons = ["5 15 * * *"]`, 매일 00:05 KST)이 오늘·어제
  시세를 `market_days`에 남기고 400일보다 오래된 행을 지웁니다. 어제를 함께 쓰는 이유는
  Cron이 하루 실패해도 구멍이 생기지 않게 하기 위함입니다.
- Cron/저장은 배포 후에만 동작합니다. 로컬에서는 `wrangler dev --test-scheduled` +
  `curl "http://127.0.0.1:8787/__scheduled?cron=5+15+*+*+*"`로 확인합니다.

## 로컬 실행

```bash
cd server
npm install                 # wrangler 설치
npm run db:local            # 로컬 D1에 schema.sql 적용
npm run dev                 # http://127.0.0.1:8787 (workerd)
# 다른 터미널에서
npm run smoke               # API 통합 테스트(공유 시세 포함)
npm test                    # 시세 계산·Cron·히스토리 단위 테스트
```

로컬 D1 데이터는 `server/.wrangler/state`에 남습니다. 초기화하려면 그 폴더를 지우고 `db:local`을 다시 실행하세요.

## 게임 연결 (현재 제거됨)

클라우드 저장을 당분간 접기로 하면서 `index.html`의 Worker 클라이언트 코드와
`meta[name="cloud-api"]`를 제거했습니다. 이 서버는 나중에 다시 켤 때를 위해 남겨 둡니다.

다시 붙이려면 삭제 직전 커밋(`d3d2493`)의 `index.html`에서 `cloud*` 함수 묶음,
`openGlobalRanking`, 설정 섹션을 복원하고 `meta[name="cloud-api"]`를 Worker 주소로
채우면 됩니다. 서버 API·D1 스키마는 그대로 쓸 수 있습니다.

## 배포 절차 (승인 후)

```bash
cd server
npx wrangler login                          # 브라우저 로그인(대화형)
npx wrangler d1 create mp-leaderboard       # 출력된 database_id 복사
# wrangler.toml의 database_id를 위 값으로 교체
npm run db:remote                           # 원격 D1에 스키마 적용
npx wrangler deploy                         # 예: https://mp-cloud.<계정>.workers.dev
```

배포 후:
1. `wrangler.toml`의 `ALLOWED_ORIGINS`를 실제 게임 주소로 확인/수정
   (기본값 `https://psb0118.github.io,http://127.0.0.1:3000,http://localhost:3000`).
   커스텀 도메인을 쓰면 그 도메인도 추가하고 다시 `wrangler deploy`.
2. 삭제된 클라이언트 코드를 복원한 뒤(위 "게임 연결" 참고) `meta[name="cloud-api"]`에 Worker URL 입력 → 커밋/푸시.
3. 배포된 게임에서 닉네임 연결 → 올리기 → 다른 브라우저/시크릿 창에서 내려받기로 복원 확인.

## 승인이 필요한 것

- Cloudflare 계정 로그인/약관 동의 (`wrangler login`)
- D1 데이터베이스 생성(무료 한도 내)
- Worker를 **공개 URL**로 배포 (누구나 접근 가능한 API가 됩니다)
- 리더보드에 **닉네임과 순자산이 공개**된다는 점
- 게임 페이지(`psb0118.github.io`)를 CORS 허용 오리진으로 등록
- 기기 토큰 분실 시 복구 수단이 없다는 점(서버에 평문 토큰 없음)

## 보안/한계 (반드시 인지)

- **점수는 저장 파일과 대조하지만, 저장 파일 자체를 위조하는 것까지 막지는 못합니다.** `verified` 표시는 "점수만 따로 부풀린 요청이 아님"을 뜻하는 최소 검증입니다. 완전한 경쟁 랭킹은 서버가 게임을 재실행/검증해야 합니다.
- 점수/세이브 스키마를 바꾸는 경우 기존 D1에는 `migrate-scores-verified.sql`을 한 번 실행하세요(새 DB는 `schema.sql`만).
- 기기 토큰을 가진 사람은 그 플레이어의 저장을 읽고 덮어쓸 수 있습니다. 토큰은 `localStorage`에만 두고, 내보내기 파일에는 포함하지 않습니다.
- 닉네임이 중복될 수 있으므로 순위표에서 같은 이름이 보일 수 있습니다(내 행은 기기 id로 구분해 강조).
- 서버는 저장 데이터의 형식만 검사하고 내용(현금·주식 수)은 검증하지 않습니다.
- 리더보드 시즌은 UTC 기준 매월 1일에 바뀝니다. 게임 진행을 되돌리는 버튼은 환생뿐이며, 별도의 수동 시즌 종료는 없습니다.
- 무료 한도(Worker 요청/일, D1 저장/읽기) 안에서 운영하세요. 저장은 1인 1행(최대 300KB)입니다.
- `rate` 테이블은 계속 쌓입니다. 가끔 `DELETE FROM rate WHERE window_start < unixepoch() - 86400;`로 정리하세요.

## 테스트 범위

`npm test`(단위): 게임과의 시세 패리티, 날짜 매핑, ±8% 범위, 결정성, 경기 국면 보정,
Cron의 오늘·어제 기록과 정리 기준, 히스토리의 저장값 우선·미저장 시 계산·D1 오류 폴백·개수 제한.

`smoke.mjs`가 확인하는 것: health, CORS 허용/차단, 닉네임 검증·중복 허용, 인증 401, 저장 없음 404,
업로드 revision 증가, 충돌 409, force 덮어쓰기, 잘못된 저장 400, 과대 저장 413,
시즌/점수 검증, 저장 없는 점수 400, 저장 자산과 다른 점수 400, 점수 서버 검증·최고 기록 유지,
리더보드 정렬·검증 표시·내 순위·limit·총원, 닉네임 변경/중복.
