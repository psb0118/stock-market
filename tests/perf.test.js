#!/usr/bin/env node
/**
 * 성능 예산 회귀 테스트
 *
 * 브라우저 대신 vm에서 실행하므로 절대 수치보다 '자릿수 폭주'를 잡는 것이 목적입니다.
 * 예산은 현재 측정값의 3~4배로 넉넉히 잡아 CI 흔들림을 견디게 했습니다.
 * 실행: node tests/perf.test.js
 */
'use strict';

const { performance } = require('perf_hooks');
const { createGame } = require('./harness');

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log(`PASS ${name}${detail !== undefined ? `  [${detail}]` : ''}`); }
  else { fail++; console.log(`FAIL ${name}${detail !== undefined ? `  [${detail}]` : ''}`); }
}
function avg(fn, times) {
  fn(); // 준비(캐시·JIT)
  const t = performance.now();
  for (let i = 0; i < times; i++) fn();
  return (performance.now() - t) / times;
}

const g = createGame();
g.run(`(()=>{
  clearGame(true);
  state.cash=5e8; state.marketSeconds=3600;
  stocks.forEach((s,i)=>{ s.own=i<20?50:0; s.avg=s.price; });
  products.forEach(p=>{ p.amount=1e7; });
  state.loan=2e7; state.loanRate=.05;
  1;
})()`);

const tick = avg(() => g.run('tickSeconds(30)'), 120);
const render = avg(() => g.run('update()'), 120);
const portfolio = avg(() => g.run('portfolio()'), 80);
const saveGen = avg(() => g.run('JSON.stringify(buildSaveData())'), 80);
const saveBytes = g.run('JSON.stringify(buildSaveData()).length');

check('1틱(30초) 평균 8ms 미만', tick < 8, `${tick.toFixed(2)}ms`);
check('전체 화면 렌더 평균 20ms 미만', render < 20, `${render.toFixed(2)}ms`);
check('포트폴리오 렌더 평균 20ms 미만', portfolio < 20, `${portfolio.toFixed(2)}ms`);
check('저장 직렬화 평균 10ms 미만', saveGen < 10, `${saveGen.toFixed(2)}ms`);
check('저장 파일 250KB 미만', saveBytes < 250000, `${(saveBytes / 1024).toFixed(1)}KB`);

console.log(`\n== ${pass}/${pass + fail} passed ==`);
if (fail) process.exit(1);
