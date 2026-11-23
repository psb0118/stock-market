'use strict';
/**
 * 10억 포트폴리오를 게임 시간으로 굴려 자산 폭주 여부를 측정합니다.
 * 실행: node tests/simulate-1h.js [초=3600] [portfolio|deposit] [시드=20261123]
 * 코드에서: const { runSimulation } = require('./simulate-1h');
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
  return { ctx, run: code => vm.runInContext(code, ctx) };
}

function setupPortfolio(run) {
  run(`
    clearGame(true);
    state.cash=1000000000; state.auto.enabled=false;
    state.estate={}; state.metals={gold:{qty:0,avg:0},silver:{qty:0,avg:0}};
    state.company=null; state.altPrices={};
    state.economy={phase:"중립",baseRate:.03,cycleLeft:99,rateAdj:0};
    state.goals={}; state.achievements={};
    state.special={sp_estate:true,sp_company:true,sp_gold:true,sp_billion:true};
    state.rewardedGrade=5;
    products.forEach(p=>{p.amount=0;p.rate=0;p.bank=null;p.startedAt=null;p.matured=false});
    const budget=400000000, list=stocks.filter(s=>s.id!=="market_etf"), per=budget/list.length;
    list.forEach(s=>{ const unit=s.price*(isForeignStock(s)?fx.usd:1); const q=Math.floor(per/unit); if(q>0){ s.own=q; s.avgBuy=s.price; state.cash-=q*unit; } });
    state.estate={apt:{qty:1,avgBuy:300000000},shop:{qty:1,avgBuy:180000000}}; state.cash-=480000000;
    state.company={name:"시뮬기업",level:1,valuation:50000000,book:50000000,revenue:2000000,profit:600000,payout:.3}; state.cash-=50000000;
    state.altPrices={apt:300000000,shop:180000000};
    state.cash=Math.max(0,state.cash);
    1;
  `);
}

function setupDeposit(run) {
  run(`
    products.forEach(p=>{p.amount=0;p.rate=0;p.bank=null;p.startedAt=null;p.matured=false});
    stocks.forEach(s=>{s.own=0;s.avgBuy=0}); state.estate={}; state.metals={gold:{qty:0,avg:0},silver:{qty:0,avg:0}};
    state.company=null; state.cash=0;
    const p=product('deposit'); p.amount=1000000000; p.rate=.058; p.startedAt=0; p.term=1e9;
    1;
  `);
}

function runSimulation(options = {}) {
  const seconds = Math.max(60, Math.floor(options.seconds || 3600));
  const mode = options.mode || 'portfolio';
  const seed = Number.isFinite(+options.seed) ? (+options.seed >>> 0) : 20261123;
  const { run } = createContext(seed);
  setupPortfolio(run);
  if (mode === 'deposit') setupDeposit(run);

  const started = Date.now();
  const marks = {};
  let max = 0;
  for (let i = 0; i < seconds; i++) {
    run('tickSeconds(); 1');
    const sec = run('state.marketSeconds');
    if (sec % 15 === 0) run('tickAlt(); 1');
    if (sec % 5 === 0) run('tickMarket(); updateFX(); 1');
    if (sec % 7 === 0) run('marketEventsAndNews(); 1');
    if (sec % 15 === 0) run('interest(); 1');
    const value = run('totalAssetsKRW()');
    if (value > max) max = value;
    if ([600, 1800, 3600, 10800, 18000, 36000].includes(sec)) {
      marks[sec] = run('({total:totalAssetsKRW(),cash:state.cash,stock:stockValueKRW(),estate:estateValue(),metal:metalValue(),company:companyValue(),grade:currentGrade()})');
    }
  }
  const end = run('({total:totalAssetsKRW(),cash:state.cash,usd:state.usd,stock:stockValueKRW(),estate:estateValue(),metal:metalValue(),company:companyValue(),product:productValueKRW(),grade:currentGrade(),peak:state.peakNet})');
  const moves = run('stocks.map(s=>({name:s.name,mult:s.price/s.start,own:s.own}))').sort((a, b) => b.mult - a.mult);
  return { seed, mode, seconds, elapsedMs: Date.now() - started, max, marks, end, top: moves.slice(0, 5), bottom: moves.slice(-3) };
}

if (require.main === module) {
  const seconds = +process.argv[2] || 3600;
  const mode = process.argv[3] || 'portfolio';
  const seed = +process.argv[4] || 20261123;
  console.log(JSON.stringify(runSimulation({ seconds, mode, seed }), null, 1));
}

module.exports = { runSimulation };
