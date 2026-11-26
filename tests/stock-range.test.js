#!/usr/bin/env node
/**
 * 주가가 시작가 대비 -60%·+200% 범위를 지키면서도 종목별로 다양하게 움직이는지 확인하는 장기 회귀 테스트
 * 실행: node tests/stock-range.test.js [게임시간(초) = 21600] [시드 = 11,22,33]
 *
 * 배경: 예전에는 시작가의 80%까지 올라가는 지지선과 시작가 2.2배 천장 때문에
 *       이 테스트는 게임 루프를 몇 시간 분량 돌려 극단적인 -99%·+2,300%가
 *       다시 발생하지 않는지, 종목별 등락이 한 가격대로 붙지 않는지 봅니다.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const source = /<script>([\s\S]*?)<\/script>/.exec(html)[1];

const OLD_FLOOR = 0.8;   // 예전 하한(시작가의 80% = -20%)
const OLD_CAP = 2.2;     // 예전 상한(시작가의 2.2배 = +120%)

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeElement(id) {
  return { id, value: '', textContent: '', disabled: false, className: '', style: {}, classList: { add() {}, remove() {}, toggle() {} } };
}

function createContext(seed) {
  const elements = new Map();
  const el = id => { if (!elements.has(id)) elements.set(id, makeElement(id)); return elements.get(id); };
  const document = { getElementById: el, querySelector: () => null, querySelectorAll: () => [], createElement: id => makeElement(id), body: makeElement('body') };
  const store = {};
  const seededMath = Object.create(Math);
  seededMath.random = mulberry32(seed);
  const ctx = {
    console, Math: seededMath, Date, JSON, Number, isFinite, Intl,
    setTimeout: () => 0, setInterval: () => 0, clearInterval: () => 0,
    alert: () => {}, confirm: () => true, document,
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    window: { __stockStat: null }
  };
  vm.createContext(ctx);
  vm.runInContext(source, ctx, { filename: 'index.html#script' });
  return { ctx, run: code => vm.runInContext(code, ctx) };
}

/**
 * gameLoop와 같은 순서(5초 단위)로 게임 시간을 진행하며 주가를 표본 수집합니다.
 * 매 표본마다 시작가 대비 비율과, 예전 경계(-20%·+120%)·현재 안전선에 붙은 횟수를 셉니다.
 */
const STEP = `
  (() => {
    if (!window.__stockStat) {
      window.__stockStat = {};
      stocks.filter(s => !s.indexPower).forEach(s => {
        window.__stockStat[s.id] = { min: Infinity, max: 0, oldFloor: 0, oldCap: 0, aboveCap: 0, samples: 0, last: 1 };
      });
    }
    for (let i = 0; i < 5; i++) {
      tickSeconds();
      if (state.marketSeconds % 15 === 0) tickAlt();
      if (state.marketSeconds % 5 === 0) { tickMarket(); updateFX(); }
      if (state.marketSeconds % 7 === 0) marketEventsAndNews();
      if (state.marketSeconds % 15 === 0) interest();
    }
    stocks.filter(s => !s.indexPower).forEach(s => {
      const st = window.__stockStat[s.id];
      if(!st) return; // 공모주로 새로 상장된 종목은 측정 대상이 아닙니다.
      const r = s.price / s.start;
      st.samples++;
      st.last = r;
      if (r < st.min) st.min = r;
      if (r > st.max) st.max = r;
      if (Math.abs(r - ${OLD_FLOOR}) < 0.004) st.oldFloor++;
      if (Math.abs(r - ${OLD_CAP}) < 0.004) st.oldCap++;
      if (r > ${OLD_CAP} + 0.1) st.aboveCap++;
    });
    return 1;
  })()
`;

function simulate(seed, seconds) {
  const { run } = createContext(seed);
  run('clearGame(true); state.paused=false; state.auto.enabled=false; 1');
  for (let t = 0; t < seconds; t += 5) run(STEP);
  return run('stocks.filter(s=>window.__stockStat[s.id]).map(s=>({id:s.id,start:s.start,price:s.price,stat:window.__stockStat[s.id]}))');
}

let pass = 0;
let fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log(`PASS ${name}${detail !== undefined ? `  [${detail}]` : ''}`); }
  else { fail++; console.log(`FAIL ${name}${detail !== undefined ? `  [${detail}]` : ''}`); }
}

const seconds = Math.max(3600, Math.floor(+process.argv[2] || 21600)); // 기본 6게임시간
const seedsArg = process.argv[3];
const seeds = seedsArg ? seedsArg.split(',').map(Number) : [11, 22, 33];

let allMin = Infinity;
let allMax = 0;
let belowOldFloor = 0;
let aboveOldCap = 0;
let finalsCount = 0;
let oldFloorRate = 0;
let oldCapRate = 0;
let aboveCapRate = 0;
let oddPrices = 0;
let samples = 0;
const spread = [];

for (const seed of seeds) {
  const rows = simulate(seed, seconds);
  // 최종 가격은 예전 지지선·천장이 실제로 막고 있던 값입니다(구버전: 80%~220% 고정, 수렴 후).
  const finals = rows.map(r => r.price / r.start);
  belowOldFloor += finals.filter(r => r < OLD_FLOOR).length;
  aboveOldCap += finals.filter(r => r > OLD_CAP).length;
  finalsCount += finals.length;
  const min = Math.min(...rows.map(r => r.stat.min));
  const max = Math.max(...rows.map(r => r.stat.max));
  const floorTicks = rows.reduce((a, r) => a + r.stat.oldFloor, 0);
  const capTicks = rows.reduce((a, r) => a + r.stat.oldCap, 0);
  const n = rows.reduce((a, r) => a + r.stat.samples, 0);

  allMin = Math.min(allMin, min);
  allMax = Math.max(allMax, max);
  oldFloorRate += floorTicks;
  oldCapRate += capTicks;
  aboveCapRate += rows.reduce((a, r) => a + r.stat.aboveCap, 0);
  samples += n;
  oddPrices += rows.filter(r => !Number.isFinite(r.price) || r.price <= 0).length;
  const mean = finals.reduce((a, b) => a + b, 0) / finals.length;
  spread.push(Math.sqrt(finals.reduce((a, b) => a + (b - mean) ** 2, 0) / finals.length));

  console.log(`  seed ${seed}: ${(seconds / 3600).toFixed(1)}시간 · 최저 ${(min * 100).toFixed(0)}% ~ 최고 ${(max * 100).toFixed(0)}% · -20% 벽 ${(floorTicks / n * 100).toFixed(2)}% · +120% 벽 ${(capTicks / n * 100).toFixed(2)}%`);
}

console.log('');

// 1) 하한: 예전 코드에서는 몇 시간만 지나면 모든 종목이 -20% 지지선 위에 갇혔습니다.
check('최종 주가가 -20% 아래에 남는 종목이 있다', belowOldFloor > 0, `${belowOldFloor}/${finalsCount}종목 · 구간 최저 ${(allMin * 100).toFixed(1)}%`);
// 2) 상한: 예전 코드는 속보 충격으로 잠깐 넘어도 다음 틱에 2.2배로 되돌려졌습니다.
check('주가가 +120% 위로도 움직이는 표본이 있다', aboveCapRate / samples > 0.005, `+130% 초과 ${(aboveCapRate / samples * 100).toFixed(2)}% · 구간 최고 ${(allMax * 100).toFixed(1)}%`);
// 3) 벽에 붙어 머무는 시간이 사실상 없어야 합니다.
check('-20% 경계에 머무는 표본 3% 미만', oldFloorRate / samples < 0.03, `${(oldFloorRate / samples * 100).toFixed(2)}%`);
check('+120% 경계에 머무는 표본 3% 미만', oldCapRate / samples < 0.03, `${(oldCapRate / samples * 100).toFixed(2)}%`);
// 4) 장기 가격 범위: 시작가의 40%~300%를 벗어나지 않아야 합니다.
check('시작가 40% 아래로 내려가지 않음', createContext(1).run('clampStockPrice({group:"domestic",start:100000},1000)') === 40000);
check('시작가 300% 위로 올라가지 않음', createContext(1).run('clampStockPrice({group:"domestic",start:100000},1000000)') === 300000);
check('모든 표본이 -60% 이상', allMin >= 0.4 - 1e-9, `${(allMin * 100).toFixed(1)}%`);
check('모든 표본이 +200% 이하', allMax <= 3 + 1e-9, `${(allMax * 100).toFixed(1)}%`);
// 5) 종목별 결과가 한 가격대로 수렴하지 않고 흩어져야 합니다.
check('종목별 최종 주가가 다양하게 갈린다', Math.max(...spread) > 0.15, `최대 표준편차 ${Math.max(...spread).toFixed(2)}`);
// 6) 가격이 0이나 NaN으로 깨지지 않아야 합니다.
check('가격이 0·NaN이 되지 않는다', oddPrices === 0, oddPrices);

console.log('');
console.log(`== ${pass}/${pass + fail} passed ==`);
process.exit(fail ? 1 : 0);
