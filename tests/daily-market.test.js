#!/usr/bin/env node
/**
 * 하루 단위 시세 테스트
 *  - 게임 10분(600초)마다 하루가 지나고, 전일 종가에 새 일일 변동률이 복리로 적용되는지
 *  - 카드에 오늘(전일 종가 대비) 변동률만 표시되는지
 *  - 하루 -30%~+50% 제한, 시작가 대비 -60%~+200% 장기 범위, 일차·다음 날 카운트다운
 *  - 원하는 수량 매수·매도, 공모주 강제 알림, 저장·복원, ETF, 토스트 미리보기
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

// ── 첫날 -90% 요청도 -30% 상한 → 다음 날은 떨어진 값 기준으로 새 변동률 ─────
{
  const g = createGame();
  g.run(`dailyMarketReturn=()=>0; dailyStockReturn=()=>-0.9; state.marketSeconds=600;
    { const s=stocks[${DOMESTIC}]; s.start=100000; s.price=100000; s.dayIndex=0; s.dayOpen=100000; s.prevClose=100000; }
    1`);
  g.run('tickMarket(); 1');
  const s1 = g.run(`{ const s=stocks[${DOMESTIC}]; ({price:s.price, prev:s.prevClose, ret:s.dayRet, open:s.dayOpen, idx:s.dayIndex}); }`);
  check('첫날 -90%는 -30%로 제한(70,000원)', s1.price === 70000, s1.price);
  check('첫날 종가가 다음 날 기준가로 기록', s1.prev === 100000 && Math.abs(s1.ret + 0.3) < 1e-9 && s1.open === 70000 && s1.idx === 1, JSON.stringify(s1));

  g.run(`dailyStockReturn=()=>0.50; state.marketSeconds=1200; 1`);
  g.run('tickMarket(); 1');
  const s2 = g.run(`{ const s=stocks[${DOMESTIC}]; ({price:s.price, prev:s.prevClose, dayC:dayChangePct(s), base:(s.price-s.start)/s.start}); }`);
  check('다음 날 +50%는 +50%로 제한(105,000원)', s2.price === 105000, s2.price);
  check('전일 종가 대비 오늘 변동률 +50%', Math.abs(s2.dayC - 0.50) < 1e-9, s2.dayC);
  check('시작가(100,000원) 대비 누적 +5%', Math.abs(s2.base - 0.05) < 1e-9, s2.base);
  check('하루 상한 +50%·하한 -30%', g.run('MAX_DAILY_GAIN') === 0.50 && g.run('MAX_DAILY_LOSS') === 0.30);
  const strict = g.run(`(()=>{ const s={group:"domestic",prevClose:15,price:15,start:15}; return [clampDailyPrice(s,100),clampDailyPrice(s,0.01)]; })()`);
  check('호가 단위와 무관하게 +50%·-30%를 넘지 않음', strict[0] <= 22.5 && strict[1] >= 10.5, strict.join('/'));
  g.run(`{ const s=stocks[${DOMESTIC}]; s.price=100000; s.prevClose=100000; applyShock(s,.9); window.__up=s.price; applyShock(s,-.9); window.__down=s.price; } 1`);
  check('장중 충격도 상한·하한을 지킴', g.run('window.__up') <= 150000 && g.run('window.__down') >= 70000, `${g.run('window.__up')}/${g.run('window.__down')}`);
  const fxLimit = g.run(`(()=>{ const s={group:"foreign",prevClose:.5,price:.5,start:.5}; return [clampDailyPrice(s,10),clampDailyPrice(s,.001)]; })()`);
  check('해외 주식도 센트 단위로 -30%~+50% 제한', fxLimit[0] <= .75 && fxLimit[1] >= .35, fxLimit.join('/'));
}

// ── 카드 표시: 오늘(전일 종가)만 ─────────────────
{
  const g = createGame();
  g.run(`dailyMarketReturn=()=>0; dailyStockReturn=()=>-0.5; state.marketSeconds=600; window.__ceId=stocks[${DOMESTIC}].id; 1`);
  g.run('tickMarket(); update(); 1');
  const text = g.run('window.__ce.textContent');
  check('카드에 오늘 변동률만 표시', /오늘 -?\d+\.\d+%/.test(text) && /전일 종가 기준/.test(text) && !/시작가 대비/.test(text), text);
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

// ── 하한·상한 없이 복리 하락/상승 ─────────────
{
  const g = createGame();
  g.run(`dailyMarketReturn=()=>0; dailyStockReturn=()=>-0.6; 1`);
  g.run(`{ const s=stocks[${DOMESTIC}]; s.start=100000; s.price=100000; s.dayIndex=0; s.dayOpen=100000; s.prevClose=100000; } 1`);
  const prices = [];
  for (let d = 1; d <= 8; d++) {
    g.run(`state.marketSeconds=${d * 600}; tickMarket(); 1`);
    prices.push(g.run(`stocks[${DOMESTIC}].price`));
  }
  check('하루 -30%가 반복되어도 시작가의 40% 하한을 지킴', prices[2] === 40000 && prices[7] === 40000, prices.join(' → '));
  check('복리 하락은 매일 전일 종가 기준이며 하한에서 멈춤', prices[0] === 70000 && prices[1] === 49000 && prices[2] === 40000, `${prices[0]}/${prices[1]}/${prices[2]}`);

  const g2 = createGame();
  g2.run(`dailyMarketReturn=()=>0; dailyStockReturn=()=>0.6; 1`);
  g2.run(`{ const s=stocks[${DOMESTIC}]; s.start=100000; s.price=100000; s.dayIndex=0; s.dayOpen=100000; s.prevClose=100000; } 1`);
  const ups = [];
  for (let d = 1; d <= 7; d++) {
    g2.run(`state.marketSeconds=${d * 600}; tickMarket(); 1`);
    ups.push(g2.run(`stocks[${DOMESTIC}].price`));
  }
  check('상승도 하루 +50%씩 적용되다 시작가의 300% 상한에서 멈춤', ups[2] === 300000 && ups[6] === 300000, ups.join(' → '));
  check('모든 종목 가격이 유효한 양수', g2.run('stocks.every(s=>Number.isFinite(s.price)&&s.price>0)') === true);
  check('국내 저가주는 시작가의 40% 아래로 내려가지 않음', g2.run('clampStockPrice({group:"domestic",start:100000},0.1)') === 40000);
  check('국내 고가주는 시작가의 300% 위로 올라가지 않음', g2.run('clampStockPrice({group:"domestic",start:100000},1000000)') === 300000);
}

// ── 장기 범위와 하루 등락의 분산 ───────────────────
{
  const g = createGame();
  g.run('dailyMarketReturn=()=>-0.08; dailyStockReturn=()=>-0.9; 1');
  for (let d = 1; d <= 30; d++) g.run(`state.marketSeconds=${d * 600}; tickMarket(); 1`);
  const ratios = g.run('stocks.filter(s=>!isIndexFund(s)).map(s=>s.price/s.start)');
  check('30일 연속 하락에도 -60%보다 아래로 내려가지 않음', Math.min(...ratios) >= 0.4 - 1e-9, Math.min(...ratios));
  check('30일 연속 하락에도 -99%가 나오지 않음', ratios.every(r => r > 0.39), Math.min(...ratios));

  const g2 = createGame();
  g2.run('dailyMarketReturn=()=>0.08; dailyStockReturn=()=>0.9; 1');
  for (let d = 1; d <= 30; d++) g2.run(`state.marketSeconds=${d * 600}; tickMarket(); 1`);
  const ratios2 = g2.run('stocks.filter(s=>!isIndexFund(s)).map(s=>s.price/s.start)');
  check('30일 연속 상승에도 +200% 위로 올라가지 않음', Math.max(...ratios2) <= 3 + 1e-9, Math.max(...ratios2));
  check('30일 연속 상승에도 +2,300%가 나오지 않음', ratios2.every(r => r < 3.01), Math.max(...ratios2));
}

// ── 모든 종목이 같은 방향으로만 움직이지 않음 ───────
{
  const g = createGame();
  g.run('dailyMarketReturn=()=>0; dailyStockReturn=()=>-0.5; state.marketSeconds=600; tickMarket(); 1');
  const rets = g.run('stocks.filter(s=>!isIndexFund(s)).map(s=>s.dayRet)');
  check('전 종목 하락일에도 일부 종목은 상승', rets.some(r => r > 0) && rets.some(r => r < 0), rets.map(r => (r * 100).toFixed(1)).join(','));
}

// ── 며칠째인지 · 다음 날까지 남은 시간 ────────────
{
  const g = createGame();
  g.run('state.paused=false; state.speed=1; state.marketSeconds=0; 1');
  check('1일차 표시', g.run('marketDayNumber()') === 1, g.run('marketDayNumber()'));
  check('1일차 남은 시간은 600초', g.run('marketDaySecondsLeft()') === 600, g.run('marketDaySecondsLeft()'));
  g.run('state.marketSeconds=650; 1');
  check('650초는 2일차', g.run('marketDayNumber()') === 2, g.run('marketDayNumber()'));
  check('다음 날까지 550초', g.run('marketDaySecondsLeft()') === 550, g.run('marketDaySecondsLeft()'));
  check('시계 문자열', g.run('clockText(550)') === '9분 10초', g.run('clockText(550)'));
  check('주식 화면 문구에 일차·남은 시간', /2일차/.test(g.run('marketDayText()')) && /9분 10초/.test(g.run('marketDayText()')), g.run('marketDayText()'));
  g.run('state.speed=5; 1');
  check('배속에 맞춘 실제 남은 시간', /1분 50초/.test(g.run('marketDayText()')), g.run('marketDayText()'));
  g.run('state.paused=true; 1');
  check('일시정지 중에도 일차·남은 시간 유지', /2일차/.test(g.run('marketDayText()')) && /1분 50초/.test(g.run('marketDayText()')) && /일시정지/.test(g.run('marketDayText()')), g.run('marketDayText()'));
  g.run('state.paused=false; 1');
  check('주식 화면에 일차 표시 영역', /data-market-day/.test(g.run('marketDayBarHTML()')) === true, g.run('marketDayBarHTML()'));
}

// ── 원하는 수량만큼 매수·매도 ────────────────────
{
  const g = createGame();
  g.run(`state.cash=10000000; state.marketOpen=true; state.settings.confirmTrades=false;
    state.achievements={}; ACHIEVEMENTS.forEach(a=>{ state.achievements[a.id]=true; });
    { const s=stocks.find(x=>x.id==="future_ai"); s.price=1000; s.own=0; s.avgBuy=0; }
    document.getElementById("qty-future_ai").value="7"; 1`);
  g.run('buyQty("future_ai"); 1');
  check('입력한 7주만큼 매수', g.run('stock("future_ai").own') === 7, g.run('stock("future_ai").own'));
  check('매수 후 현금이 수수료 포함 차감', g.run('state.cash') < 10000000 && g.run('state.cash') > 9900000, Math.round(g.run('state.cash')));

  g.run('document.getElementById("qty-future_ai").value="3"; sellQty("future_ai"); 1');
  check('입력한 3주만큼 매도', g.run('stock("future_ai").own') === 4, g.run('stock("future_ai").own'));

  g.run('document.getElementById("qty-future_ai").value="99"; sellQty("future_ai"); 1');
  check('보유량보다 많이 매도하면 거부', g.run('stock("future_ai").own') === 4, g.run('stock("future_ai").own'));

  g.run('setTradeQty("future_ai","max"); 1');
  const maxQty = g.run('maxBuyQty(stock("future_ai"))');
  check('최대 매수 버튼이 최대 수량을 채움', g.run('document.getElementById("qty-future_ai").value') === String(maxQty) && maxQty > 0, `${maxQty}`);
  g.run('setTradeQty("future_ai","own"); 1');
  check('보유 전량 버튼이 보유 수량을 채움', g.run('document.getElementById("qty-future_ai").value') === '4', g.run('document.getElementById("qty-future_ai").value'));
  check('큰 수량은 만 단위로 짧게 표시', g.run('qtyText(148974)') === '14.9만주', g.run('qtyText(148974)'));
}

// ── 공모주 알림은 설정과 무관하게 반드시 표시 ────────
{
  const g = createGame();
  g.run('setNotify("master",true); state.notify.toast=false; state.marketSeconds=0; state.ipo={offer:null,nextAt:0,history:[]}; 1');
  g.run('tickIPO(); 1');
  const wrap = g.el('toastWrap');
  const offer = g.run('state.ipo.offer && state.ipo.offer.name');
  check('알림을 모두 꺼도 공모주 시작 알림 표시', wrap.children.length >= 1 && /공모주 청약 시작/.test(wrap.children[0].innerHTML), wrap.children[0] && wrap.children[0].innerHTML);
  check('공모주 알림에 종목명·청약 안내', !!offer && wrap.children[0].innerHTML.includes(offer) && /청약/.test(wrap.children[0].innerHTML), offer);
  check('공모주 토스트는 클릭으로 청약 화면 이동', typeof wrap.children[0].onclick === 'function', typeof wrap.children[0].onclick);

  g.run('setNotifyNum("toastMax",1); showToast("일반 알림","테스트"); 1');
  check('공모주 알림은 일반 토스트에 밀리지 않음', wrap.children.some(c=>/공모주 청약 시작/.test(c.innerHTML)), wrap.children.map(c=>c.innerHTML).join(" / "));

  g.run('state.marketSeconds=state.ipo.offer.closesAt-20; tickIPO(); 1');
  check('마감 30초 전 알림도 강제 표시', /마감 임박/.test(wrap.children[wrap.children.length - 1].innerHTML), wrap.children[wrap.children.length - 1].innerHTML);
}

// ── 알림은 문서 흐름을 밀지 않는 오버레이 ────────────
{
  check('시황 속보가 fixed 오버레이', /\.breaking\{[^}]*position:fixed/.test(html) === true);
  check('토스트도 fixed 오버레이', /\.toast-wrap\{[^}]*position:fixed/.test(html) === true);
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
  const expected = g.run(`(()=>{ const s=stocks.find(x=>x.id===${JSON.stringify(oldId)}); return clampStockPrice(s,0); })()`);
  check('구버전 세이브: 극단 가격을 장기 범위로 보정', r.price === expected && r.prev === expected && r.open === expected && r.ret === 0, `${JSON.stringify(r)} / expected ${expected}`);
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
