'use strict';
/**
 * 10억 포트폴리오를 1시간(게임 시간 3,600초) 굴려 자산 폭주 여부를 측정합니다.
 * 실행: node tests/simulate-1h.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const source = /<script>([\s\S]*?)<\/script>/.exec(html)[1];
function mk(id) { return { id, value: '', textContent: '', disabled: false, className: '', style: {}, classList: { add() {}, remove() {}, toggle() {} } }; }
const els = new Map();
const el = id => { if (!els.has(id)) els.set(id, mk(id)); return els.get(id); };
const document = { getElementById: id => el(id), querySelector: () => null, querySelectorAll: () => [], createElement: id => mk(id), body: mk('body') };
const store = {};
const ctx = {
  console, Math, Date, JSON, Number, isFinite, Intl,
  setTimeout: () => 0, setInterval: () => 0, clearInterval: () => 0,
  alert: () => {}, confirm: () => true, document,
  localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
  window: {}
};
vm.createContext(ctx);
vm.runInContext(source, ctx, { filename: 'index.html#script' });
const run = code => vm.runInContext(code, ctx);

const mode = process.argv[3] || 'portfolio';
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
  state.company={name:"시뮬기업",level:1,valuation:50000000,revenue:2000000,profit:600000,payout:.3}; state.cash-=50000000;
  state.altPrices={apt:300000000,shop:180000000};
  state.cash=Math.max(0,state.cash);
  1;
`);
if (mode === 'deposit') {
  run(`
    products.forEach(p=>{p.amount=0;p.rate=0;p.bank=null;p.startedAt=null;p.matured=false});
    stocks.forEach(s=>{s.own=0;s.avgBuy=0}); state.estate={}; state.metals={gold:{qty:0,avg:0},silver:{qty:0,avg:0}};
    state.company=null; state.cash=0;
    const p=product('deposit'); p.amount=1000000000; p.rate=.058; p.startedAt=0; p.term=1e9;
    1;
  `);
}

const totalSeconds = Math.max(60, Math.floor(+process.argv[2] || 3600));
const started = Date.now();
const marks = {};
let max = 0;
for (let i = 0; i < totalSeconds; i++) {
  run('tickSeconds(); 1');
  const sec = run('state.marketSeconds');
  if (sec % 15 === 0) run('tickAlt(); 1');
  if (sec % 5 === 0) run('tickMarket(); updateFX(); 1');
  if (sec % 7 === 0) run('marketEventsAndNews(); 1');
  if (sec % 15 === 0) run('interest(); 1');
  const v = run('totalAssetsKRW()');
  if (v > max) max = v;
  if ([600, 1800, 3600, 10800, 18000, 36000].includes(sec)) marks[sec] = run('({total:totalAssetsKRW(),cash:state.cash,stock:stockValueKRW(),estate:estateValue(),metal:metalValue(),company:companyValue(),grade:currentGrade()})');
}
const end = run('({total:totalAssetsKRW(),cash:state.cash,usd:state.usd,stock:stockValueKRW(),estate:estateValue(),metal:metalValue(),company:companyValue(),product:productValueKRW(),grade:currentGrade(),peak:state.peakNet})');
const moves = run('stocks.map(s=>({name:s.name,mult:s.price/s.start,own:s.own}))').sort((a, b) => b.mult - a.mult);
console.log(JSON.stringify({ elapsedMs: Date.now() - started, max, marks, end, top: moves.slice(0, 5), bottom: moves.slice(-3) }, null, 1));
