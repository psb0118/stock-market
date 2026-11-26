#!/usr/bin/env node
/**
 * 신규 기능 회귀 테스트: 지수 ETF · 공매도 · 금리연동 채권 · 공모주 · 기업 상장/삭제 ·
 * 예약 주문 4종 · 자동 리밸런싱이 실제로 동작하는지 확인합니다.
 * 실행: node tests/features.test.js
 */
'use strict';

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
  return { id, value: '', textContent: '', disabled: false, className: '', style: {}, checked: false, classList: { add() {}, remove() {}, toggle() {} } };
}
function createGame(seed = 3) {
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
    window: {}
  };
  vm.createContext(ctx);
  vm.runInContext(source, ctx, { filename: 'index.html#script' });
  const run = code => vm.runInContext(code, ctx);
  run('clearGame(true); state.marketOpen=true; state.settings.confirmTrades=false; 1');
  return { run, el };
}

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log(`PASS ${name}${detail !== undefined ? `  [${detail}]` : ''}`); }
  else { fail++; console.log(`FAIL ${name}${detail !== undefined ? `  [${detail}]` : ''}`); }
}

// ── 지수 ETF 3종 ───────────────────────────────
{
  const g = createGame(11);
  const etfs = g.run('stocks.filter(s=>isIndexFund(s)).map(s=>s.id)');
  check('지수 ETF 3종 존재', ['market_etf', 'market_2x', 'market_inv'].every(id => etfs.includes(id)), etfs.join(','));

  const tracked = g.run(`(()=>{
    stocks.forEach(s=>{ if(!isIndexFund(s)) s.price=s.start*1.2; });
    tickMarket();
    return { idx:Math.round(marketIndex()), etf:stock('market_etf').price, x2:stock('market_2x').price, inv:stock('market_inv').price };
  })()`);
  check('지수 ETF가 지수를 추종', Math.abs(tracked.etf - Math.round(tracked.idx * 10 / 100) * 100) < 1, `${tracked.etf} / 지수 ${tracked.idx}`);
  const x2Raw = Math.round(10000 * Math.pow(tracked.idx / 1000, 2) / 100) * 100;
  check('2X ETF가 지수 2배(±30% 한도)', Math.abs(tracked.x2 - Math.min(13000, x2Raw)) < 1, tracked.x2);
  check('인버스 ETF가 지수 반대', tracked.inv < 10000 && tracked.idx > 1000, tracked.inv);
  check('지수 계산에서 ETF 제외', g.run('stocks.filter(s=>!isIndexFund(s)).length') === g.run('stocks.length') - 3, g.run('stocks.length'));
}

// ── 보유 주식 모아보기(매도 전용) ─────────────────
{
  const g = createGame(13);
  g.run("const s=stock('future_ai'); s.own=10; s.avgBuy=s.price; const f=stock('nova_sys'); f.own=2; f.avgBuy=f.price; holdingsPage(); 1");
  const html = g.run("document.getElementById('holdings').innerHTML");
  check('보유 탭에 모든 보유 종목을 모음', html.includes('보유 주식') && html.includes('미래AI전자') && html.includes('Nova Systems'), html.length);
  check('보유 탭은 매도 전용', html.includes('매도') && html.includes('전량 매도') && !html.includes('buyQty') && !html.includes('>매수<'), 'no buy');
  check('보유 탭에 평가액·평가손익 표시', html.includes('data-hold-value="future_ai"') && html.includes('data-hold-pnl="future_ai"'));
  check('보유 탭 수량 입력칸은 화면별로 구분', html.includes('qty-future_ai-holdings'));
  g.run("state.marketOpen=true; state.settings.confirmTrades=false; state.cash=0; document.getElementById('qty-future_ai-holdings').value='3'; sellQty('future_ai','holdings'); 1");
  check('보유 탭에서 입력 수량만큼 매도', g.run("stock('future_ai').own") === 7 && g.run('state.cash') > 0, g.run("stock('future_ai').own"));
}

// ── 그래프 호버 가격 ─────────────────────────────
{
  const g = createGame(14);
  const point = g.run(`(()=>{ const s=stock('future_ai'); s.start=100; s.hist=[100,120,90]; return sparkPointAt(s,.5); })()`);
  check('그래프 중간 위치의 실제 가격', point.price === 120 && point.index === 1, JSON.stringify(point));
  check('그래프 툴팁 마크업 포함', g.run("sparklineHTML(stock('future_ai')).includes('spark-tip')") === true);
  check('그래프 툴팁은 시작가 대비 수익률 계산', Math.abs(point.pct - 0.2) < 1e-9, point.pct);
}

// ── 공매도 ─────────────────────────────────────
{
  const g = createGame(12);
  const opened = g.run(`(()=>{
    state.cash=100000000; const s=stock('future_ai'); s.price=s.start;
    const before=state.cash; shortStock('future_ai',10);
    return { before, after:Math.round(state.cash), qty:state.shorts[0].qty, entry:state.shorts[0].entry };
  })()`);
  check('공매도 실행: 주식 10주 매도 대금 유입', opened.qty === 10 && opened.after > opened.before, `${opened.before}→${opened.after}`);

  const covered = g.run(`(()=>{
    const s=stock('future_ai'); s.price=s.start*0.8; coverShort(state.shorts[0].id);
    return { realized:Math.round(state.shortRealized), left:state.shorts.length };
  })()`);
  check('하락 후 환매 시 이익', covered.realized > 0 && covered.left === 0, covered.realized);

  const margin = g.run(`(()=>{
    shortStock('future_ai',5);
    const s=stock('future_ai'); s.price=state.shorts[0].entry*1.35;
    checkShortMargins();
    return { left:state.shorts.length, realized:Math.round(state.shortRealized) };
  })()`);
  check('진입가 +30%에서 마진콜 강제 청산', margin.left === 0, margin.realized);

  check('공매도 평가손익이 총자산에 반영', g.run(`(()=>{
    state.cash=10000000; state.loan=0; state.usd=0; state.bonds={qty:0,avg:0};
    state.estate={}; state.metals={gold:{qty:0,avg:0},silver:{qty:0,avg:0}}; state.company=null;
    stocks.forEach(s=>{s.own=0});
    const base=grossAssetsKRW(); shortStock('future_ai',1);
    const s=stock('future_ai'); s.price=s.price*0.5;
    return grossAssetsKRW()>base;
  })()`) === true);
}

// ── 금리연동 채권 ───────────────────────────────
{
  const g = createGame(13);
  const bond = g.run(`(()=>{
    state.cash=50000000; state.economy.baseRate=.03; const p1=bondUnitPrice(); buyBond(2);
    state.economy.baseRate=.015; const p2=bondUnitPrice(); const value=bondValueKRW();
    const cash0=state.cash; interest();
    return { p1, p2, qty:state.bonds.qty, value:Math.round(value), coupon:Math.round(state.cash-cash0) };
  })()`);
  check('금리가 내려가면 채권 가격 상승', bond.p2 > bond.p1, `${bond.p1}→${bond.p2}`);
  check('채권 매수·평가액 반영', bond.qty === 2 && bond.value > 0, bond.value);
  check('채권 이자가 현금으로 지급', bond.coupon > 0, bond.coupon);
}

// ── 기업: 이름 수정 · 상장 · 지분 매각 · 삭제 ─────
{
  const g = createGame(14);
  g.run(`state.cash=3000000000; document.getElementById('company-name').value='테스트기업'; foundCompany(); expandCompany(); 1`);
  check('기업 설립·확장', g.run('state.company.level') === 2, g.run('state.company.level'));

  g.run(`document.getElementById('company-rename').value='새이름'; updateCompanyName(); 1`);
  check('기업명 수정', g.run('state.company.name') === '새이름', g.run('state.company.name'));

  const listed = g.run(`(()=>{
    const before=state.cash; listCompany(); const c=state.company;
    return { listed:!!c.listed, ipo:c.listed&&c.listed.ipoPrice, own:c.listed&&c.listed.ownPct, cash:Math.round(state.cash-before), value:Math.round(companyValue()) };
  })()`);
  check('기업 상장(공모 30%)', listed.listed === true && listed.own === 70, `${listed.ipo}원 · 지분 ${listed.own}%`);
  check('상장으로 공모 자금 유입', listed.cash > 0, listed.cash);
  check('내 지분만큼만 기업 자산 평가', Math.abs(listed.value - Math.round(g.run('state.company.valuation') * 0.7)) < 1, listed.value);

  const sold = g.run(`(()=>{ const before=state.cash; sellCompanyShares(10); return { cash:Math.round(state.cash-before), own:state.company.listed.ownPct }; })()`);
  check('지분 매각', sold.cash > 0 && sold.own === 60, `${sold.cash}원 · ${sold.own}%`);

  const acquired = g.run(`(()=>{ acquireRival('r1'); const c=state.company; return { upkeep:c.upkeep, risk:c.risk, acq:Object.keys(c.acquired).length, revenue:c.revenue }; })()`);
  check('인수 시 유지비·위협 정보 반영', acquired.upkeep > 0 && acquired.risk > 0 && acquired.acq === 1, `${acquired.upkeep}/${acquired.risk}`);

  const upkeep = g.run(`(()=>{
    // 배당·임대 등 다른 수입이 섞이지 않게 배당을 0으로 두고 유지비만 확인합니다.
    state.company.profit=0; state.company.payout=0; state.marketSeconds=30;
    state.rewardedGrade=gradeIndex(currentGrade());
    state.special=Object.fromEntries(SPECIAL_MISSIONS.map(m=>[m.id,true]));
    const before=state.cash; tickAlt(); return { before:Math.round(before), after:Math.round(state.cash), upkeep:state.company.upkeep };
  })()`);
  check('인수 유지비가 30초마다 차감', Math.abs((upkeep.before - upkeep.after) - upkeep.upkeep) < 1000, `${upkeep.before}→${upkeep.after} (유지비 ${upkeep.upkeep})`);

  const deleted = g.run(`(()=>{ const before=state.cash; deleteCompany(); return { company:state.company, cash:Math.round(state.cash-before) }; })()`);
  check('기업 삭제는 보상 없이 삭제', deleted.company === null && Math.abs(deleted.cash) < 1, deleted.cash);
}

// ── 노동 난이도 ─────────────────────────────────
{
  const g = createGame(15);
  const jobs = g.run('LABOR_JOBS.map(j=>({pay:j.pay,zone:j.zone,speed:j.speed,diff:j.diff}))');
  const high = jobs.slice(2);
  check('고임금 노동일수록 성공 구간이 좁아짐', high.every((j,i) => i === 0 || j.zone <= high[i-1].zone), high.map(j=>j.zone).join(','));
  check('고임금 노동일수록 표시선이 빨라짐', high.every((j,i) => i === 0 || j.speed >= high[i-1].speed), high.map(j=>j.speed).join(','));
  check('노동 난이도 별점 표시', jobs.every(j=>j.diff>=1&&j.diff<=5));
  check('회차가 쌓이면 피로로 빨라짐', g.run('laborSpeedMultiplier({results:[{grade:"perfect"},{grade:"perfect"}]})') > 1);
  check('실패하면 다음 작업이 더 빨라짐', g.run('laborSpeedMultiplier({results:[{grade:"perfect"},{grade:"miss"}]})') > g.run('laborSpeedMultiplier({results:[{grade:"perfect"},{grade:"good"}]})'));
}

// ── 공모주 ─────────────────────────────────────
{
  const g = createGame(15);
  const ipo = g.run(`(()=>{
    state.cash=50000000; state.ipo={offer:null,nextAt:0,history:[]};
    tickIPO(); const offer=ensureIPO().offer;
    document.getElementById('ipo-amount').value='1000000'; subscribeIPO();
    const mine=ensureIPO().offer.mine; closeIPO();
    const h=ensureIPO().history[0]; const s=stock(h.id);
    return { name:offer.name, mine, alloc:h.alloc, listed:!!s, own:s&&s.own, start:s&&s.start, price:s&&s.price, ids:state.listedIds.length, refunded:Math.round(state.cash) };
  })()`);
  check('공모주 청약 접수', ipo.mine === 1000000, ipo.mine);
  check('공모주 상장·배정', ipo.listed === true && ipo.alloc > 0 && ipo.own === ipo.alloc, `${ipo.alloc}주`);
  check('상장 종목이 주식 목록에 추가', g.run('stocks.some(s=>s.ipo)') === true);
  check('상장 id가 저장 대상에 기록', ipo.ids === 1, ipo.ids);

  const restored = g.run(`(()=>{
    const data=JSON.parse(JSON.stringify(buildSaveData()));
    resetListedStocks();
    const removed=!stocks.some(s=>s.ipo);
    applySaveData(data);
    return { removed, back:stocks.some(s=>s.ipo), ids:state.listedIds.length };
  })()`);
  check('저장/복원 후 상장 종목 유지', restored.removed === true && restored.back === true, restored.ids);
}

// ── 예약 주문 4종 ───────────────────────────────
{
  const g = createGame(16);
  const orders = g.run(`(()=>{
    state.orders=[]; state.marketOpen=true;
    const s=stock('future_ai'); s.price=100000; s.own=100; s.avgBuy=100000; state.cash=100000000; state.marketSeconds=100;
    state.orders.push({id:'o1',stockId:s.id,type:'limit',side:'buy',qty:2,limit:110000});
    state.orders.push({id:'o2',stockId:s.id,type:'stop',side:'sell',qty:3,limit:90000});
    state.orders.push({id:'o3',stockId:s.id,type:'trailing',side:'sell',qty:4,trail:5,peak:100000});
    state.orders.push({id:'o4',stockId:s.id,type:'dca',side:'buy',amount:500000,every:60,lastAt:0});
    processOrders();
    const afterBuy={ own:s.own, left:state.orders.map(o=>o.type) };
    s.price=80000; processOrders();
    return { afterBuy, own:s.own, left:state.orders.map(o=>o.type) };
  })()`);
  check('지정가·분할 매수 체결', orders.afterBuy.own === 106, orders.afterBuy.own);
  check('손절·트레일링 매도 체결', orders.own === 99, orders.own);
  check('분할 매수 주문은 계속 유지', orders.left.join(',') === 'dca', orders.left.join(','));
}

// ── 자동 리밸런싱 ───────────────────────────────
{
  const g = createGame(17);
  const reb = g.run(`(()=>{
    state.cash=100000000; state.marketOpen=true;
    state.auto={enabled:true,rebalance:true,rebStockPct:10,rebBand:5,stockPct:0,minCash:0,every:15};
    const s=stock('future_ai'); s.price=100000; s.own=400; s.avgBuy=100000;
    const before=Math.round(stockValueKRW()); const moved=Math.round(autoRebalance());
    return { before, moved, after:Math.round(stockValueKRW()), cash:Math.round(state.cash) };
  })()`);
  check('자동 리밸런싱이 초과 주식 비중을 줄임', reb.moved > 0 && reb.after < reb.before, `${reb.before}→${reb.after}`);
  check('리밸런싱 매도 대금이 현금으로 유입', reb.cash > 100000000, reb.cash);
}

// ── 화면 렌더 ───────────────────────────────────
{
  const g = createGame(18);
  const rendered = g.run(`(()=>{
    const out={};
    ['short','ipo','holdings','guide','company','orders','banking'].forEach(id=>{
      try{ renderPage(id); const el=document.getElementById(id);
        out[id]={ len:(el.innerHTML||'').length, bad:/NaN|undefined/.test(el.innerHTML||'') };
      }catch(e){ out[id]={ error:e.message }; }
    });
    return out;
  })()`);
  let ok = true, detail = [];
  Object.keys(rendered).forEach(id => {
    const r = rendered[id];
    if (r.error || r.bad || r.len < 50) ok = false;
    detail.push(`${id}:${r.error ? 'ERR' : r.len}`);
  });
  check('신규 페이지가 NaN·undefined 없이 렌더', ok, detail.join(' '));
  check('도움말 페이지에 게임 방법 안내', g.run("document.getElementById('guide').innerHTML.includes('게임 방법')") === true);
  check('기업 페이지에 이득/위협 안내', g.run("document.getElementById('company').innerHTML.includes('위협')") === true);
}

console.log('');
console.log(`== ${pass}/${pass + fail} passed ==`);
process.exit(fail ? 1 : 0);
