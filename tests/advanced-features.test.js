#!/usr/bin/env node
/**
 * 확장 기능 회귀 테스트
 * - 환생 외 초기화 경로 제거
 * - 공모주 청약/취소 즉시 피드백
 * - 거래량·수급, 실적 캘린더·공시
 * - FIFO 세금 로트·일반/ISA/연금 계좌
 * - 노동 경력·컨디션·스킬
 * - OCO·브래킷 주문
 * - 리스크 대시보드
 * - 초기화 없는 시나리오 챌린지
 * - 모바일 빠른 거래 바
 * 실행: node tests/advanced-features.test.js
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
  return {
    id, value: '', textContent: '', disabled: false, className: '', style: {}, checked: false,
    dataset: {}, parentElement: null, offsetLeft: 0, offsetWidth: 0,
    classList: { add() {}, remove() {}, toggle() {} },
    setAttribute() {}, removeAttribute() {}, getBoundingClientRect() { return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }; }
  };
}
function createGame(seed = 7) {
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
  return { run, el, document };
}

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log(`PASS ${name}${detail !== undefined ? `  [${detail}]` : ''}`); }
  else { fail++; console.log(`FAIL ${name}${detail !== undefined ? `  [${detail}]` : ''}`); }
}

// ── 1. 환생 외 초기화 제거 ──────────────────────
{
  const g = createGame(1);
  const globals = g.run('({retire:typeof retire, open:typeof openRetire, season:typeof seasonReset, rebirth:typeof rebirthNow, reset:typeof resetRunForRebirth})');
  check('은퇴·시즌 초기화 함수 제거', globals.retire === 'undefined' && globals.open === 'undefined' && globals.season === 'undefined', JSON.stringify(globals));
  check('환생 초기화 경로는 유지', globals.rebirth === 'function' && globals.reset === 'function');
  const saveHtml = g.run('savePanelHtml()');
  check('설정에 환생만 초기화 안내', saveHtml.includes('환생') && saveHtml.includes('별도 초기화') && !saveHtml.includes('시즌 종료 버튼을'), saveHtml.length);
  const guide = g.run('guidePage(); document.getElementById("guide").innerHTML');
  check('도움말에 유일한 초기화 설명', guide.includes('유일한 초기화') && guide.includes('은퇴·시즌 종료 같은 별도 초기화 버튼은 없습니다'));
}

// ── 2. 공모주 청약 피드백 ───────────────────────
{
  const g = createGame(2);
  const r = g.run(`(()=>{
    state.cash=5000000; state.ipo={offer:null,nextAt:0,history:[]};
    tickIPO();
    const offer=ensureIPO().offer;
    document.getElementById('ipo-amount').value='1000000';
    subscribeIPO();
    const afterSub=ensureIPO().offer.lastAction;
    ipoPage();
    const subscribedHtml=document.getElementById('ipo').innerHTML;
    cancelIPO();
    const afterCancel=ensureIPO().offer.lastAction;
    const canceledHtml=document.getElementById('ipo').innerHTML;
    return {
      offer:!!offer, subType:afterSub&&afterSub.type, subAmount:afterSub&&afterSub.amount,
      subHtml:subscribedHtml.includes('청약 접수 완료')&&subscribedHtml.includes('✅ 접수 완료'),
      cancelType:afterCancel&&afterCancel.type, cancelHtml:canceledHtml.includes('청약 취소 완료'),
      cash:state.cash, mine:ensureIPO().offer.mine, ratio:canceledHtml.includes('청약 경쟁률')
    };
  })()`);
  check('공모주 청약 직후 접수 피드백', r.offer && r.subType === 'subscribe' && r.subAmount === 1000000 && r.subHtml, JSON.stringify(r));
  check('공모주 취소 직후 환불 피드백', r.cancelType === 'cancel' && r.cancelHtml && r.cash === 5000000 && r.mine === 0, r.cash);
  check('공모주 KPI에 접수·경쟁률 표시', r.ratio);
}

// ── 3. 거래량·수급 ──────────────────────────────
{
  const g = createGame(3);
  const r = g.run(`(()=>{
    stockPage('domestic','국내','test');
    const s=stock('future_ai');
    s.volume=0; s.foreignFlow=0; s.instFlow=0; state.tick=10;
    tickMarket();
    const once={v:s.volume,f:s.foreignFlow,i:s.instFlow};
    tickMarket();
    const twice={v:s.volume,f:s.foreignFlow,i:s.instFlow};
    const saved=buildSaveData().stocks.find(x=>x.id===s.id);
    const card=document.getElementById('grid-domestic').innerHTML;
    return {once,twice,saved,card:card.includes('flow-line')&&card.includes('거래량')};
  })()`);
  check('거래량이 틱마다 누적', r.once.v > 0 && r.twice.v > r.once.v, `${r.once.v}→${r.twice.v}`);
  check('외국인·기관 수급 생성', Number.isFinite(r.twice.f) && Number.isFinite(r.twice.i), `${r.twice.f}/${r.twice.i}`);
  check('거래량·수급 저장', r.saved && r.saved.volume === r.twice.v && r.saved.foreignFlow === r.twice.f);
  check('주식 카드에 수급 줄 표시', r.card === true);
}

// ── 4. 실적 캘린더·공시 ─────────────────────────
{
  const g = createGame(4);
  const r = g.run(`(()=>{
    state.marketSeconds=1000; state.calendar=[]; ensureCalendar(true);
    const scheduled=state.calendar.length;
    state.news=[]; state.marketSeconds=1;
    state.calendar=[{stockId:'future_ai',at:0,kind:'earnings'}];
    tickCalendar();
    const earningsNews=state.news.some(n=>String(n).includes('실적 발표'));
    const nextCalendar=state.calendar.length;
    state.disclosures=[];
    publishDisclosure(stock('future_ai'));
    const disc=state.disclosures[0];
    economyPage();
    const page=document.getElementById('economy').innerHTML;
    return {scheduled,earningsNews,nextCalendar,disc,page:page.includes('실적 캘린더')&&page.includes('기업 공시')};
  })()`);
  check('실적 캘린더 일정 생성', r.scheduled >= 3, r.scheduled);
  check('일정 도달 시 실적 발표', r.earningsNews === true && r.nextCalendar >= 3, r.nextCalendar);
  check('기업 공시 기록 생성', !!r.disc && typeof r.disc.title === 'string' && r.disc.text.length > 0, r.disc && r.disc.title);
  check('경제 화면에 캘린더·공시 패널', r.page === true);
}

// ── 5. 세금 로트·계좌 ───────────────────────────
{
  const g = createGame(5);
  const lots = g.run(`(()=>{
    const s=stock('future_ai');
    s.price=100000; s.own=0; s.avgBuy=0; s.taxLots=[]; state.marketOpen=true; state.marketSeconds=100;
    state.cash=10000000; state.loan=0; state.realizedYTD=0; state.taxPaid=0;
    state.tax={mode:'general',carryLoss:0,pensionDeferred:0,isaGains:0,isaTaxed:0};
    marketBuyShares(s,10);
    s.price=120000;
    marketSellShares(s,4);
    return {qty:s.own,lots:s.taxLots.map(l=>l.qty),basis:s.taxLots.reduce((a,l)=>a+l.qty*l.price,0),realized:state.realizedYTD};
  })()`);
  check('매수 로트가 FIFO로 쌓임', lots.qty === 6 && lots.lots.length === 1 && lots.lots[0] === 6, JSON.stringify(lots));
  check('매도 후 남은 로트 원가 유지', Math.abs(lots.basis - 600900) < 1, lots.basis);

  const taxes = g.run(`(()=>{
    state.cash=100000000; state.loan=0; state.realizedYTD=0; state.taxPaid=0;
    state.tax={mode:'general',carryLoss:0,pensionDeferred:0,isaGains:0,isaTaxed:0};
    settleTax(-500000);
    const loss={realized:state.realizedYTD,carry:state.tax.carryLoss};
    state.realizedYTD=0; state.taxPaid=0; state.tax={mode:'isa',carryLoss:0,pensionDeferred:0,isaGains:0,isaTaxed:0};
    const isa=settleTax(2500000);
    const isaState={gains:state.tax.isaGains,taxed:state.tax.isaTaxed,paid:state.taxPaid};
    state.realizedYTD=0; state.taxPaid=0; state.tax={mode:'pension',carryLoss:0,pensionDeferred:0,isaGains:0,isaTaxed:0};
    const pension=settleTax(1000000);
    withdrawPensionTax();
    return {loss,isa,isaState,pension,deferred:state.tax.pensionDeferred,paid:state.taxPaid};
  })()`);
  check('당해 손실·이월 손실 기록', taxes.loss.realized === -500000 && taxes.loss.carry === 500000, JSON.stringify(taxes.loss));
  check('ISA 200만 공제 후 9.9%', Math.abs(taxes.isa - 49500) < 1 && taxes.isaState.taxed === 500000, taxes.isa);
  check('연금 매도는 이연, 인출 시 5.5%', taxes.pension === 0 && taxes.deferred === 0 && Math.abs(taxes.paid - 55000) < 1, taxes.paid);

  const saved = g.run(`(()=>{
    const s=stock('future_ai');
    const data=JSON.parse(JSON.stringify(buildSaveData()));
    s.taxLots=[]; s.own=0; state.tax.mode='general';
    applySaveData(data);
    return {lots:stock('future_ai').taxLots.reduce((a,l)=>a+l.qty,0),mode:state.tax.mode};
  })()`);
  check('세금 로트·계좌 저장/복원', saved.lots === 6 && saved.mode === 'pension', JSON.stringify(saved));
}

// ── 6. 노동 경력·컨디션·스킬 ─────────────────────
{
  const g = createGame(6);
  const career = g.run(`(()=>{
    state.labor={shifts:0,earned:0,lastAt:{},warned:false,xp:120,points:2,stamina:50,skills:{focus:0,stamina:0,service:0}};
    state.cash=0;
    const level=laborCareerLevel();
    const normal=laborShiftPay({pay:100000},['perfect','perfect','perfect'],1).pay;
    const tired=laborShiftPay({pay:100000},['perfect','perfect','perfect'],.6).pay;
    buyLaborSkill('focus');
    restLabor();
    const after={points:state.labor.points,focus:state.labor.skills.focus,stamina:state.labor.stamina};
    return {level,normal,tired,after,zone:laborZoneFor({zone:.2})};
  })()`);
  check('노동 경력 레벨 계산', career.level === 2, career.level);
  check('컨디션이 낮으면 일당 감소', career.tired < career.normal, `${career.normal}/${career.tired}`);
  check('스킬 구매·휴식 반영', career.after.points === 1 && career.after.focus === 1 && career.after.stamina === 80, JSON.stringify(career.after));
  check('집중력 스킬이 성공 구간 확대', career.zone > 0.2, career.zone);

  const shift = g.run(`(()=>{
    state.labor={shifts:0,earned:0,lastAt:{},warned:false,xp:0,points:0,stamina:100,skills:{focus:0,stamina:0,service:0}};
    state.cash=0; laborSession={job:laborJob('convenience'),round:3,results:[{grade:'perfect'},{grade:'perfect'},{grade:'perfect'}],paid:false};
    laborFinishShift();
    return {xp:state.labor.xp,stamina:state.labor.stamina,cash:state.cash,shifts:state.labor.shifts};
  })()`);
  check('노동 완료 시 XP·컨디션·일당 반영', shift.xp > 0 && shift.stamina < 100 && shift.cash === 60000 && shift.shifts === 1, JSON.stringify(shift));
}

// ── 7. OCO·브래킷 ───────────────────────────────
{
  const g = createGame(7);
  const r = g.run(`(()=>{
    state.orders=[]; state.marketOpen=true; state.marketSeconds=100;
    const s=stock('future_ai'); s.price=120000; s.own=10; s.avgBuy=100000; s.taxLots=[{qty:10,price:100000,at:0}];
    state.cash=100000000; state.loan=0; state.realizedYTD=0; state.taxPaid=0;
    state.orders.push({id:'oco',stockId:s.id,type:'oco',side:'sell',qty:2,takeProfit:110000,stopPrice:90000});
    processOrders();
    const oco={own:s.own,orders:state.orders.map(o=>o.type),realized:state.realizedYTD};
    const b=stock('hanbit_semi'); b.price=100000; b.own=0; b.avgBuy=0; b.taxLots=[];
    state.orders=[{id:'br',stockId:b.id,type:'bracket',side:'buy',qty:1,entry:105000,takeProfit:120000,stopPrice:90000}];
    b.price=110000; processOrders();
    const bracket={own:b.own,orders:state.orders.map(o=>o.type),tp:state.orders[0]&&state.orders[0].takeProfit};
    return {oco,bracket};
  })()`);
  check('OCO 익절 체결 후 주문 제거', r.oco.own === 8 && !r.oco.orders.includes('oco') && r.oco.realized > 0, JSON.stringify(r.oco));
  check('브래킷 돌파 매수 후 OCO 등록', r.bracket.own === 1 && r.bracket.orders.includes('oco') && r.bracket.tp === 120000, JSON.stringify(r.bracket));
}

// ── 8. 리스크 대시보드 ──────────────────────────
{
  const g = createGame(8);
  const r = g.run(`(()=>{
    state.cash=10000000; state.loan=1000000; state.bonds={qty:0,avg:0};
    const s=stock('future_ai'); s.price=100000; s.own=100; s.avgBuy=90000;
    assetHistory.points=[{v:12000000},{v:15000000},{v:11000000},{v:13000000}];
    const m=riskMetrics(), crash=stressTest('crash'), rate=stressTest('rate');
    state.ui.assetTab='risk'; portfolio();
    const page=document.getElementById('portfolio').innerHTML;
    return {dd:m.maxDD,vol:m.vol,top:m.top.top.name,pct:m.top.pct,crash:crash.delta,rate:rate.delta,page:page.includes('스트레스 테스트')&&page.includes('리스크')&&page.includes('최대 낙폭')};
  })()`);
  check('최대 낙폭·변동성 계산', r.dd > 0 && r.vol >= 0, `${r.dd}/${r.vol}`);
  check('최대 보유 종목·집중도 계산', r.top === '미래AI전자' && r.pct > 0, `${r.top}/${r.pct}`);
  check('시장 충격 스트레스 테스트', r.crash < 0 && r.rate < 0, `${r.crash}/${r.rate}`);
  check('리스크 탭 렌더', r.page === true);
}

// ── 9. 시나리오 챌린지 ──────────────────────────
{
  const g = createGame(9);
  const r = g.run(`(()=>{
    state.cash=10000000; state.loan=0; state.challenge={active:null,history:[],best:0,last:null}; state.marketSeconds=0;
    const started=startChallenge('sprint');
    const active=state.challenge.active;
    state.cash=11000000; state.marketSeconds=10; tickChallenges();
    return {started,active:!!active,startNet:active&&active.startNet,reward:state.challenge.history[0]&&state.challenge.history[0].reward,cash:state.cash,history:state.challenge.history[0],left:state.challenge.active};
  })()`);
  check('챌린지 시작 시 현재 순자산 기록', r.started === true && r.active === true && r.startNet === 10000000, r.startNet);
  check('목표 달성 시 보상 지급·기록', r.left === null && r.history && r.history.status === 'success' && r.cash === 13000000, r.cash);
  check('챌린지는 진행을 초기화하지 않음', r.history && r.history.finalNet === 11000000, r.history && r.history.finalNet);
  check('순자산 0원은 챌린지 시작 불가', g.run("state.cash=0; state.challenge={active:null,history:[],best:0,last:null}; startChallenge('sprint')") === false && g.run('state.challenge.active') === null);
}

// ── 10. 모바일 빠른 거래 ────────────────────────
{
  const g = createGame(10);
  const r = g.run(`(()=>{
    state.cash=10000000; state.marketOpen=true; state.settings.confirmTrades=false;
    const s=stock('future_ai'); s.price=s.start; s.own=0; s.taxLots=[];
    document.getElementById('mobile-stock').value=s.id;
    document.getElementById('mobile-trade-qty').value='2';
    mobileTrade('buy');
    const bought=s.own;
    document.getElementById('mobile-trade-qty').value='1';
    mobileTrade('sell');
    const sold=s.own;
    portfolio();
    const page=document.getElementById('portfolio').innerHTML;
    return {bought,sold,bar:document.getElementById('mobileTradeBar')!==undefined,page:page.includes('내 자산')};
  })()`);
  check('모바일 바에서 매수', r.bought === 2, r.bought);
  check('모바일 바에서 매도', r.sold === 1, r.sold);
  check('모바일 거래 바 DOM·렌더 연결', r.bar === true);
  check('모바일 거래 바 페이지 렌더', r.page === true);
  const shell = g.run("document.getElementById('mobileTradeBar') && document.getElementById('mobileTradeBar').id");
  check('모바일 거래 바 마크업 존재', shell === 'mobileTradeBar', shell);
}

console.log('');
console.log(`== ${pass}/${pass + fail} passed ==`);
process.exit(fail ? 1 : 0);
