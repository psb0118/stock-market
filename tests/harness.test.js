#!/usr/bin/env node
/**
 * 공통 하네스 자체의 계약 테스트
 * - 호출마다 독립된 상태/저장소를 가진다
 * - 추가 전역(globals)을 주입할 수 있다
 * - index.html 스크립트를 실제로 실행해 게임 함수를 쓸 수 있다
 * 실행: node tests/harness.test.js
 */
'use strict';

const { createGame, mulberry32, seededMath } = require('./harness');

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log(`PASS ${name}${detail !== undefined ? `  [${detail}]` : ''}`); }
  else { fail++; console.log(`FAIL ${name}${detail !== undefined ? `  [${detail}]` : ''}`); }
}

const a = createGame();
const b = createGame();
a.run('state.cash = 4321; saveGame(); 1');
const bSaved = JSON.parse(b.store[a.run('SAVE_KEY')] || '{"state":{}}');
check('게임 상태·저장소가 테스트마다 독립', b.run('state.cash') !== 4321 && bSaved.state.cash !== 4321, b.run('state.cash'));

const injected = createGame({ performance: { now: () => 777 } });
check('추가 전역 주입', injected.run('performance.now()') === 777);

const seeded = seededMath(42);
check('시드 난수는 같은 시드에서 같은 값', seeded.random() === seededMath(42).random() && mulberry32(7)() === mulberry32(7)());

check('게임 함수 호출 가능', a.run('typeof tickSeconds') === 'function' && a.run('typeof buildSaveData') === 'function');
check('게임 초기 상태는 숫자 현금', typeof a.run('state.cash') === 'number' && a.run('state.marketOpen') === true, a.run('state.cash'));

const saveRound = a.run(`(()=>{ state.cash=100; saveGame(); const raw=localStorage.getItem(SAVE_KEY); clearGame(true); applySaveData(JSON.parse(raw)); return state.cash; })()`);
check('저장→초기화→복원 왕복', saveRound === 100, saveRound);

console.log(`\n== ${pass}/${pass + fail} passed ==`);
if (fail) process.exit(1);
