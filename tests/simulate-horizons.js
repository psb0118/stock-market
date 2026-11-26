#!/usr/bin/env node
'use strict';
/**
 * 0원 시작 기준 1·3·6시간 난이도/자산 분포 시뮬레이션.
 *
 * - 시장: 각 시드마다 0원에서 시작해 가격만 굴리고, 비ETF 종목의 시작가 대비 배율 분포를 봅니다.
 * - 플레이어: 30초마다 기본 노동 1회(성과 75% = 45,000원)를 하고, 5분마다 현금의 75%를
 *   시장 ETF에 넣는 현실적인 초보 플레이를 가정합니다.
 *
 * 실행: node tests/simulate-horizons.js [시드수=10]
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const source = /<script>([\s\S]*?)<\/script>/.exec(html)[1];
const HORIZONS = [3600, 10800, 21600];
const LABOR_EVERY = 30;
const LABOR_PAY = 45000; // 편의점 최대 60,000원의 75% 성과
const INVEST_EVERY = 300;
const INVEST_RATE = 0.75;

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
function pct(values, q) { return `${(quantile(values, q) * 100).toFixed(0)}%`; }
function won(n) {
  if (!Number.isFinite(n)) return '-';
  if (Math.abs(n) >= 100000000) return `${(n / 100000000).toFixed(1)}억`;
  if (Math.abs(n) >= 10000) return `${(n / 10000).toFixed(0)}만`;
  return `${Math.round(n).toLocaleString('ko-KR')}`;
}

function simulate(seed, seconds) {
  const { run } = createContext(seed);
  run(`
    clearGame(true);
    state.auto.enabled=false; state.paused=false;
    state.goals=Object.fromEntries(MILESTONES.map(m=>[m.id,true]));
    state.special=Object.fromEntries(SPECIAL_MISSIONS.map(m=>[m.id,true]));
    state.achievements=Object.fromEntries(ACHIEVEMENTS.map(a=>[a.id,true]));
    state.rewardedGrade=gradeIndex(currentGrade());
    update=()=>{}; renderMarketBar=()=>{}; saveGame=()=>{}; addLog=()=>{};
    1;
  `);
  let nextLabor = LABOR_EVERY;
  let nextInvest = INVEST_EVERY;
  for (let t = 1; t <= seconds; t++) {
    run('tickSeconds(); 1');
    if (t % 15 === 0) run('tickAlt(); 1');
    if (t % 5 === 0) { run('tickMarket(); updateFX(); 1'); }
    if (t % 7 === 0) run('marketEventsAndNews(); 1');
    if (t % 15 === 0) run('interest(); 1');
    if (t >= nextLabor) {
      run(`state.cash+=${LABOR_PAY}; state.labor.shifts++; 1`);
      nextLabor += LABOR_EVERY;
    }
    if (t >= nextInvest) {
      run(`(()=>{const etf=stock('market_etf');const q=Math.floor((state.cash*${INVEST_RATE})/(etf.price*(1+stockFeeRate())));if(q>0)marketBuyShares(etf,q);})()`);
      nextInvest += INVEST_EVERY;
    }
  }
  const result = run(`(()=>{
    const owned=stocks.filter(s=>s.own>0);
    const multiples=stocks.filter(s=>!isIndexFund(s)).map(s=>s.price/s.start);
    return {
      total:totalAssetsKRW(), cash:state.cash, stock:stockValueKRW(), own:owned.length,
      multiples, etf:stock('market_etf').price/stock('market_etf').start,
      grade:currentGrade()
    };
  })()`);
  result.seed = seed;
  result.seconds = seconds;
  return result;
}

const seedCount = Math.max(1, Math.min(30, Math.floor(+process.argv[2] || 10)));
const seeds = Array.from({ length: seedCount }, (_, i) => 1103 + i * 97);
console.log(`0원 시작 · ${seedCount}개 시드 · 노동 45,000원/${LABOR_EVERY}초 · ETF 75%/${INVEST_EVERY}초\n`);
const summary = [];
for (const seconds of HORIZONS) {
  const rows = seeds.map(seed => simulate(seed, seconds));
  const totals = rows.map(r => r.total);
  const allMults = rows.flatMap(r => r.multiples);
  const etfs = rows.map(r => r.etf);
  const hours = seconds / 3600;
  const row = {
    hours,
    totalMedian: quantile(totals, .5), totalP90: quantile(totals, .9), totalMax: Math.max(...totals),
    multMedian: quantile(allMults, .5), multP90: quantile(allMults, .9), multMax: Math.max(...allMults),
    over2: allMults.filter(v => v > 2).length / allMults.length
  };
  summary.push(row);
  console.log(`[${hours}시간]`);
  console.log(`  플레이어 자산: 중앙 ${won(row.totalMedian)} · 하위10% ${won(quantile(totals, .1))} · 상위10% ${won(row.totalP90)} · 최고 ${won(row.totalMax)}`);
  console.log(`  주가 배율: 중앙 ${pct(allMults, .5)} · 10% ${pct(allMults, .1)} · 90% ${pct(allMults, .9)} · 최저 ${pct(allMults, 0)} · 최고 ${pct(allMults, 1)}`);
  console.log(`  2배 초과 ${(row.over2 * 100).toFixed(1)}% · 절반 미만 ${(allMults.filter(v => v < .5).length / allMults.length * 100).toFixed(1)}% · ETF 중앙 ${pct(etfs, .5)}`);
  console.log('');
}

// 난이도 가드레일: 초반은 버티고, 장기에는 폭주하지 않아야 합니다.
const checks = [
  ['1시간 플레이어 자산이 100만~2,000만원', summary[0].totalMedian >= 1000000 && summary[0].totalMedian <= 20000000, won(summary[0].totalMedian)],
  ['6시간 플레이어 자산이 1,000만~1억원', summary[2].totalMedian >= 10000000 && summary[2].totalMedian <= 100000000, won(summary[2].totalMedian)],
  ['6시간 주가 중앙값이 50%~300%', summary[2].multMedian >= .5 && summary[2].multMedian <= 3, pct([summary[2].multMedian], 0)],
  ['6시간 주가 상위10%가 500% 미만', summary[2].multP90 < 5, pct([summary[2].multP90], 0)],
  ['6시간 최고 주가가 15배 미만', summary[2].multMax < 15, `${summary[2].multMax.toFixed(1)}배`],
  ['6시간 2배 초과 종목이 절반 미만', summary[2].over2 < .5, `${(summary[2].over2 * 100).toFixed(0)}%`]
];
let failed = 0;
for (const [name, ok, detail] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} [${detail}]`);
  if (!ok) failed++;
}
if (failed) process.exitCode = 1;
