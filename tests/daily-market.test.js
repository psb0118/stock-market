#!/usr/bin/env node
/**
 * 하루 단위 시세 테스트
 *  - 게임 10분(600초)마다 하루가 지나고, 전일 종가에 새 일일 변동률이 복리로 적용되는지
 *  - 카드에 "시작가 대비"(누적)와 "오늘"(전일 종가 대비)이 함께 표시되는지
 *  - 저장·복원, ETF, 안전선(시작가 8%~6배), 토스트 미리보기 버튼
 * 실행: node tests/daily-market.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const source = /<script>([\s\S]*?)<\/script>/.exec(html)[1];

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log(`PASS ${name}${detail !== undefined ? `  [${detail}]` : ''}`); }
  else { fail++; console.log(`FAIL ${name}${detail !== undefined ? `  [${detail}]` : ''}`); }
}

function makeElement(id) {
  const classes = new Set();
  return {
    id, tagName: 'DIV', value: '', textContent: '', innerHTML: '', disabled: false, className: '', style: {},
    checked: false, children: [],
    classList: {
      add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c),
      toggle: c => (classes.has(c) ? classes.delete(c) : classes.add(c))
    },
    appendChild(child) { this.children.push(child); return child; },
    removeChild(child) { this.children = this.children.filter(c => c !== child); return child; },
    contains: () => false, addEventListener() {}
  };
}

function createGame(seed = 7) {
  const els = new Map();
  const el = id => { if (!els.has(id)) els.set(id, makeElement(id)); return els.get(id); };
  const document = {
    getElementById: el, querySelector: () => null, querySelectorAll: () => [],
    createElement: () => makeElement('toast'), body: makeElement('body'), addEventListener() {}
  };
  const store = {};
  let s = seed;
  const rand = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  const seededMath = Object.create(Math); seededMath.random = rand;
  const ctx = {
    console, Math: seededMath, Date, JSON, Number, isFinite, Intl, Promise,
    setTimeout: () => 0, setInterval: () => 0, clearInterval: () => 0,
    alert: () => {}, confirm: () => true, document,
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    window: {}
  };
  vm.createContext(ctx);
  vm.runInContext(source, ctx, { filename: 'index.html#script' });
  const run = code => vm.runInContext(code, ctx);
  run('clearGame(true); state.marketOpen=true; state.settings.confirmTrades=false; 1');
  // 카드 갱신을 확인할 수 있게 특정 종목의 data-change 요소를 하나 연결합니다.
  run(`
    window.__ce={textContent:'',className:''};
    window.__ceId=null;
    document.querySelectorAll=sel=>{
      if(window.__ceId && sel.indexOf('data-change="'+window.__ceId+'"')>=0) return [window.__ce];
      return [];
    };
    1`);
  return { run, el, store };
}

const DOMESTIC = 'stocks.findIndex(s=>s.group==="domestic" && !s.indexPower)';

// ── 하루 길이 ──────────────────────────────────
{
  const g = createGame();
  check('하루 = 게임 600초', g.run('MARKET_DAY_SECONDS') === 600);
  check('하루 경계 계산', g.run('marketDayIndex(0)') === 0 && g.run('marketDayIndex(599)') === 0 && g.run('marketDayIndex(600)') === 1 && g.run('marketDayIndex(1250)') === 2,
    `${g.run('marketDayIndex(0)')}/${g.run('marketDayIndex(599)')}/${g.run('marketDayIndex(600)')}/${g.run('marketDayIndex(1250)')}`);
}

// ── 첫날 -90% → 다음 날은 떨어진 값 기준으로 새 변동률 ─────
{
  const g = createGame();
  g.run(`dailyMarketReturn=()=>0; dailyStockReturn=()=>-0.9; state.marketSeconds=600;
    { const s=stocks[${DOMESTIC}]; s.start=100000; s.price=100000; s.dayIndex=0; s.dayOpen=100000; s.prevClose=100000; }
    1`);
  g.run('tickMarket(); 1');
  const s1 = g.run(`{ const s=stocks[${DOMESTIC}]; ({price:s.price, prev:s.prevClose, ret:s.dayRet, open:s.dayOpen, idx:s.dayIndex}); }`);
  check('첫날 -90%: 100,000원 → 10,000원', s1.price === 10000, s1.price);
  check('첫날 종가가 다음 날 기준가로 기록', s1.prev === 100000 && s1.ret === -0.9 && s1.open === 10000 && s1.idx === 1, JSON.stringify(s1));

  g.run(`dailyStockReturn=()=>0.50; state.marketSeconds=1200; 1`);
  g.run('tickMarket(); 1');
  const s2 = g.run(`{ const s=stocks[${DOMESTIC}]; ({price:s.price, prev:s.prevClose, dayC:dayChangePct(s), base:(s.price-s.start)/s.start}); }`);
  check('다음 날 +50%는 10,000원 기준(15,000원)', s2.price === 15000, s2.price);
  check('전일 종가 대비 오늘 변동률 +50%', Math.abs(s2.dayC - 0.50) < 1e-9, s2.dayC);
  check('시작가(100,000원) 대비 누적 -85%', Math.abs(s2.base + 0.85) < 1e-9, s2.base);
}

// ── 카드 표시: 시작가 대비 + 오늘 ─────────────────
{
  const g = createGame();
  g.run(`dailyMarketReturn=()=>0; dailyStockReturn=()=>-0.5; state.marketSeconds=600; window.__ceId=stocks[${DOMESTIC}].id; 1`);
  g.run('tickMarket(); update(); 1');
  const text = g.run('window.__ce.textContent');
  check('카드에 시작가 대비·오늘 변동률 동시 표시', /시작가 대비 -?\d+\.\d+%/.test(text) && /오늘 -?\d+\.\d+%/.test(text), text);
  check('하락이면 하락 색상', g.run('window.__ce.className') === 'down', g.run('window.__ce.className'));
}

// ── 하루 안에서는 새 변동률을 뽑지 않음 ──────────────
{
  const g = createGame();
  g.run('window.__calls=0; dailyStockReturn=s=>{window.__calls++; return 0.01}; dailyMarketReturn=()=>0; state.marketSeconds=601; tickMarket(); 1');
  const first = g.run('window.__calls');
  for (let i = 0; i < 5; i++) g.run('state.marketSeconds++; tickMarket(); 1');
  check('하루 안(5틱)에는 추가 변동률 없음', g.run('window.__calls') === first && first >= 1, `${first} → ${g.run('window.__calls')}`);
  g.run('state.marketSeconds=1200; tickMarket(); 1');
  check('하루가 지나면 새 변동률 적용', g.run('window.__calls') > first, g.run('window.__calls'));
}

// ── 장중 가격은 오늘 시가 근처에서 움직임 ─────────────
{
  const g = createGame();
  g.run('dailyMarketReturn=()=>0; dailyStockReturn=()=>0; state.marketSeconds=600; tickMarket(); 1');
  for (let i = 0; i < 40; i++) g.run('state.marketSeconds++; tickMarket(); 1');
  const r = g.run(`{ const s=stocks[${DOMESTIC}]; s.price/s.dayOpen; }`);
  check('장중 등락은 시가 대비 ±15% 이내', r > 0.85 && r < 1.15, r.toFixed(4));
}

// ── 안전선(시작가 8% ~ 6배) ─────────────────────
{
  const g = createGame();
  g.run('dailyMarketReturn=()=>0; dailyStockReturn=()=>-0.6; 1');
  for (let d = 1; d <= 30; d++) g.run(`state.marketSeconds=${d * 600}; tickMarket(); 1`);
  const low = g.run(`{ const s=stocks[${DOMESTIC}]; s.price/s.start; }`);
  check('폭락해도 시작가 8% 아래로는 내려가지 않음', low >= 0.0799 && low <= 0.09, low.toFixed(4));

  g.run('dailyStockReturn=()=>0.6; 1');
  for (let d = 31; d <= 60; d++) g.run(`state.marketSeconds=${d * 600}; tickMarket(); 1`);
  const high = g.run(`{ const s=stocks[${DOMESTIC}]; s.price/s.start; }`);
  check('폭등해도 시작가 6배 위로는 올라가지 않음', high <= 6.0001, high.toFixed(3));
  check('모든 종목 가격이 유효한 양수', g.run('stocks.every(s=>Number.isFinite(s.price)&&s.price>0)') === true);
}

// ── ETF도 전일 종가·시가를 가짐 ─────────────────
{
  const g = createGame();
  g.run('state.marketSeconds=600; tickMarket(); 1');
  const r = g.run('{ const e=stocks.find(s=>s.id==="market_etf"); ({prev:e.prevClose, open:e.dayOpen, ret:e.dayRet, idx:e.dayIndex, price:e.price}); }');
  check('ETF: 전일 종가·시가·일차 기록', r.prev > 0 && r.open > 0 && r.ret === 0 && r.idx === 1, JSON.stringify(r));
}

// ── 저장·복원 ──────────────────────────────────
{
  const g = createGame();
  g.run('dailyMarketReturn=()=>0; dailyStockReturn=()=>-0.4; state.marketSeconds=600; tickMarket(); 1');
  const saved = g.run(`{ const s=stocks[${DOMESTIC}]; ({prev:s.prevClose, open:s.dayOpen, ret:s.dayRet, idx:s.dayIndex, price:s.price, id:s.id}); }`);
  const data = g.run('JSON.stringify(buildSaveData())');
  check('세이브에 일일 시세 4개 필드 포함', /"prevClose":/.test(data) && /"dayOpen":/.test(data) && /"dayRet":/.test(data) && /"dayIndex":/.test(data));

  const g2 = createGame();
  g2.run(`applySaveData(${data}); 1`);
  const back = g2.run(`{ const s=stocks.find(x=>x.id===${JSON.stringify(saved.id)}); ({prev:s.prevClose, open:s.dayOpen, ret:s.dayRet, idx:s.dayIndex, price:s.price}); }`);
  check('복원 후 전일 종가·시가 동일', back.prev === saved.prev && back.open === saved.open && back.price === saved.price, JSON.stringify(back));
  check('복원 후 일일 변동률 동일', Math.abs(back.ret - saved.ret) < 1e-12, back.ret);
}

// ── 구버전 세이브(필드 없음) 호환 ─────────────────
{
  const g = createGame();
  const oldId = g.run('stocks[0].id');
  const old = JSON.stringify({
    costBasisIncludesFee: true,
    state: g.run('JSON.parse(JSON.stringify(state))'),
    fx: { usd: 1300, anchor: 1300 },
    stocks: [{ id: oldId, own: 0, price: 12345, avgBuy: 0, realizedProfit: 0, lastMove: 0, revenue: 0, opProfit: 0 }],
    products: []
  });
  g.run(`applySaveData(${old}); 1`);
  const r = g.run(`{ const s=stocks.find(x=>x.id===${JSON.stringify(oldId)}); ({price:s.price, prev:s.prevClose, open:s.dayOpen, ret:s.dayRet, idx:s.dayIndex}); }`);
  check('구버전 세이브: 전일 종가·시가를 현재가로 보정', r.prev === 12345 && r.open === 12345 && r.ret === 0, JSON.stringify(r));
  check('구버전 세이브: 일차는 현재 게임 시간', Number.isFinite(r.idx), r.idx);
}

// ── 초기화 ─────────────────────────────────────
{
  const g = createGame();
  g.run('dailyMarketReturn=()=>0; dailyStockReturn=()=>0.3; state.marketSeconds=600; tickMarket(); clearGame(true); 1');
  const r = g.run('stocks.every(s=>s.prevClose===s.start && s.dayOpen===s.start && s.dayRet===0)');
  check('게임 초기화 시 일일 시세도 초기화', r === true);
}

// ── 토스트 미리보기 ────────────────────────────
{
  const g = createGame();
  const htmlSettings = g.run('setNotifyNum("toastMax",2); setNotifyNum("toastMs",6000); settingsPage(); document.getElementById("settings").innerHTML');
  check('설정에 토스트 미리보기 버튼', /토스트 미리보기/.test(g.run('document.getElementById("settings").innerHTML')) || /토스트 미리보기/.test(htmlSettings));
  check('버튼에 현재 설정 표시', /미리보기 \(6초 · 2개\)/.test(htmlSettings), /미리보기[^<]*/.exec(htmlSettings));

  const n = g.run('previewToasts()');
  const wrap = g.el('toastWrap');
  check('미리보기는 현재 최대 개수만큼 표시', n === 2 && wrap.children.length === 2, `${n}/${wrap.children.length}`);
  check('미리보기 문구에 설정값 안내', /6초/.test(wrap.children[0].innerHTML) && /2개/.test(wrap.children[0].innerHTML), wrap.children[0].innerHTML);

  g.run('setNotifyNum("toastMax",5); setNotifyNum("toastMs",2000); previewToasts(); 1');
  check('5개·2초 설정도 반영', g.el('toastWrap').children.length === 5, g.el('toastWrap').children.length);

  g.run('setNotify("master",true); 1');
  const n2 = g.run('previewToasts()');
  check('알림을 모두 꺼도 미리보기는 동작', n2 === 5, n2);
  check('라벨에 현재 값 노출', g.run('toastPreviewLabel()') === '2초 · 5개', g.run('toastPreviewLabel()'));
}

console.log(`\n${pass}/${pass + fail} 통과`);
process.exit(fail ? 1 : 0);
