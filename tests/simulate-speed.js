#!/usr/bin/env node
'use strict';
/**
 * 1~5배속 경제 시뮬레이션.
 * 같은 시드·같은 게임 시간(3600초)에서 배속만 바꿨을 때 자산이 달라지지 않는지 확인합니다.
 * 실행: node tests/simulate-speed.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const source = /<script>([\s\S]*?)<\/script>/.exec(html)[1];

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function createContext(seed) {
  const elements = new Map();
  const mk = id => ({ id, value: '', textContent: '', disabled: false, className: '', style: {}, classList: { add() {}, remove() {}, toggle() {} } });
  const el = id => { if (!elements.has(id)) elements.set(id, mk(id)); return elements.get(id); };
  const document = { getElementById: id => el(id), querySelector: () => null, querySelectorAll: () => [], createElement: id => mk(id), body: mk('body') };
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

function setup(run, mode) {
  run(`
    clearGame(true);
    state.cash = 100000000; state.usd = 0; state.loan = 0; state.paused = false;
    state.auto.enabled = false; state.settings.speed = 1;
    products.forEach(p => { p.amount = 0; p.rate = 0; p.bank = null; p.startedAt = null; p.matured = false; });
    stocks.forEach(s => { s.own = 0; s.avgBuy = 0; });
    state.estate = {}; state.metals = { gold: { qty: 0, avg: 0 }, silver: { qty: 0, avg: 0 } };
    state.company = null; state.altPrices = {}; state.economy = Object.assign({}, ECON_DEFAULT);
    1;
  `);
  if (mode === 'stocks') {
    run(`
      const picks = ['future_ai','hanbit_semi','aurora_bio'];
      picks.forEach((id, i) => { const s = stock(id); if (!s) return; const q = 50 + i * 10; s.own = q; s.avgBuy = s.price; state.cash -= q * s.price; });
      1;
    `);
  } else if (mode === 'deposit') {
    run(`state.cash = 0; const p = product('deposit'); p.amount = 100000000; p.rate = 0.058; p.startedAt = 0; p.term = 1e9; 1`);
  }
  // 시작 자산으로 즉시 달성되는 1회성 목표·특별 미션·승급 보상은 순수 자동 수익 측정에서 제외합니다.
  run(`
    state.goals = Object.fromEntries(MILESTONES.map(m => [m.id, true]));
    state.special = Object.fromEntries(SPECIAL_MISSIONS.map(m => [m.id, true]));
    state.achievements = Object.fromEntries(ACHIEVEMENTS.map(a => [a.id, true]));
    state.rewardedGrade = gradeIndex(currentGrade());
    1;
  `);
}

function runSpeed(speed, mode, seconds, seed) {
  const { run } = createContext(seed);
  setup(run, mode);
  run(`setSpeed(${speed}); state.paused = false; 1`);
  const loops = Math.floor(seconds / speed);
  for (let i = 0; i < loops; i++) run('gameLoop(); 1');
  return run(`({
    speed: speedNow(), seconds: state.marketSeconds,
    total: totalAssetsKRW(), cash: state.cash, stock: stockValueKRW(),
    product: productValueKRW(), estate: estateValue(), metal: metalValue(), company: companyValue(),
    loan: state.loan || 0, grade: currentGrade()
  })`);
}

function compare(label, mode, seconds) {
  const rows = [1, 2, 3, 4, 5].map(speed => runSpeed(speed, mode, seconds, 20261123));
  const base = rows[0];
  const diffs = rows.map(r => Math.abs(r.total - base.total));
  const maxDiff = Math.max(...diffs);
  const rel = base.total ? maxDiff / Math.abs(base.total) : 0;
  const ok = rows.every(r => r.seconds === seconds) && rel < 1e-9;
  return { label, mode, seconds, ok, maxDiff, rel, rows };
}

const scenarios = [
  compare('아무 활동 없음 (600초)', 'idle', 600),
  compare('주식만 보유 (3600초)', 'stocks', 3600),
  compare('예금만 보유 (3600초)', 'deposit', 3600)
];

for (const s of scenarios) {
  console.log(`\n[${s.label}] ${s.ok ? 'PASS' : 'FAIL'} · 최대 차이 ${Math.round(s.maxDiff)}원 (${(s.rel * 100).toFixed(6)}%)`);
  for (const r of s.rows) {
    console.log(`  ${r.speed}x · ${r.seconds}s · 총자산 ${Math.round(r.total).toLocaleString('ko-KR')} · 현금 ${Math.round(r.cash).toLocaleString('ko-KR')} · 주식 ${Math.round(r.stock).toLocaleString('ko-KR')} · 예금 ${Math.round(r.product).toLocaleString('ko-KR')}`);
  }
}
const allOk = scenarios.every(s => s.ok);
console.log(`\n== ${scenarios.filter(s => s.ok).length}/${scenarios.length} speed scenarios passed ==`);
process.exit(allOk ? 0 : 1);
