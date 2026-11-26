#!/usr/bin/env node
'use strict';
/**
 * 장기 시장 밸런스 시뮬레이션.
 *
 * 가격 엔진만 굴려서 30·100·365게임일 시점의 비ETF 종목 배율(현재가/시작가) 분포를 봅니다.
 * - 일별 상한 +50% / 하한 -30%, 장기 범위 시작가의 40%~300%가 실제로 지켜지는지 확인
 * - 특정 종목이 범위 끝에 몰리는지(breadth) 확인
 *
 * 실행: node tests/simulate-long.js [시드수=3] [일수=365]
 * 예:   node tests/simulate-long.js 2 30
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const source = /<script>([\s\S]*?)<\/script>/.exec(html)[1];
const SNAPSHOTS = [30, 100, 365];

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
  const document = { getElementById: id => el(id), querySelector: () => null, querySelectorAll: () => [], createElement: id => makeElement(id), body: makeElement('body') };
  const store = {};
  const seededMath = Object.create(Math);
  seededMath.random = mulberry32(seed);
  const ctx = {
    console, Math: seededMath, Date, JSON, Number, isFinite, Intl,
    setTimeout: () => 0, setInterval: () => 0, clearInterval: () => 0,
    alert: () => {}, confirm: () => true, document,
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    window: {}
  };
  vm.createContext(ctx);
  vm.runInContext(source, ctx, { filename: 'index.html#script' });
  return { run: code => vm.runInContext(code, ctx) };
}
function quantile(values, q) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * q)));
  return sorted[i];
}
function pct(v) { return `${Math.round((+v || 0) * 100)}%`; }

function simulate(seed, days) {
  const { run } = createContext(seed);
  run(`
    clearGame(true);
    state.paused=false;
    update=()=>{}; renderMarketBar=()=>{}; saveGame=()=>{}; addLog=()=>{};
    1;
  `);
  const snaps = {};
  for (let day = 1; day <= days; day++) {
    for (let t = 0; t < 600; t++) {
      const sec = (day - 1) * 600 + t + 1;
      run('tickSeconds(); 1');
      if (sec % 15 === 0) run('tickAlt(); 1');
      if (sec % 5 === 0) { run('tickMarket(); updateFX(); 1'); }
      if (sec % 7 === 0) run('marketEventsAndNews(); 1');
      if (sec % 15 === 0) run('interest(); 1');
    }
    if (SNAPSHOTS.includes(day)) {
      snaps[day] = run(`(()=>{
        const list=stocks.filter(s=>!isIndexFund(s));
        const mult=list.map(s=>s.price/Math.max(1,s.start));
        const up=list.filter(s=>dayChangePct(s)>0).length;
        return {mult,up,down:list.length-up,total:list.length};
      })()`);
    }
  }
  return snaps;
}

const seedCount = Math.max(1, Math.min(10, Math.floor(+process.argv[2] || 3)));
const days = Math.max(1, Math.min(365, Math.floor(+process.argv[3] || 365)));
const seeds = Array.from({ length: seedCount }, (_, i) => 20261126 + i * 7919);

console.log(`장기 시장 시뮬레이션 · ${seedCount}개 시드 · ${days}게임일 · 일별 +50%/-30% · 장기 40%~300%\n`);
const rows = seeds.map(seed => ({ seed, snaps: simulate(seed, days) }));
for (const day of SNAPSHOTS) {
  if (day > days) continue;
  const all = rows.flatMap(r => (r.snaps[day] || {}).mult || []);
  if (!all.length) continue;
  const atMin = all.filter(v => v <= 0.401).length;
  const atMax = all.filter(v => v >= 2.999).length;
  const final = rows[0].snaps[day] || { up: 0, down: 0, total: 0 };
  console.log(`[${String(day).padStart(3)}일] 표본 ${all.length}개`);
  console.log(`  배율  10% ${pct(quantile(all, .1))} · 중위 ${pct(quantile(all, .5))} · 90% ${pct(quantile(all, .9))} · 최저 ${pct(Math.min(...all))} · 최고 ${pct(Math.max(...all))}`);
  console.log(`  범위 끝  하한 근처 ${((atMin / all.length) * 100).toFixed(1)}% · 상한 근처 ${((atMax / all.length) * 100).toFixed(1)}%`);
  console.log(`  첫 시드 breadth  상승 ${final.up} / 하락 ${final.down} / ${final.total}\n`);
}
console.log('해석: 하한·상한 근처 비율이 한쪽으로 치우치면 장기 범위가 너무 좁거나 넓다는 신호입니다.');
