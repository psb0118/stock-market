#!/usr/bin/env node
/**
 * 자산 게이트(1억·5억·10억)와 배당 밸런스 테스트.
 *  - 순자산 기준 해금·진행률·해금 알림
 *  - 1억: 사모펀드, 블록딜 수수료 우대, 오프라인 +2시간
 *  - 5억: 기업 인수 게이트, 배당 재투자(DRIP), 공모주 우선 배정
 *  - 10억: 헤지펀드, 부동산 개발, 세무 컨설팅, 오프라인 +4시간
 *  - 하루 배당 0.5% 모델
 * 실행: node tests/gates.test.js
 */
'use strict';
const { createGame } = require('./harness');

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log(`PASS ${name}${detail !== undefined ? `  [${detail}]` : ''}`); }
  else { fail++; console.log(`FAIL ${name}${detail !== undefined ? `  [${detail}]` : ''}`); }
}

const g = createGame();

// ── 게이트 판정 ──────────────────────────────────────────
{
  const r = g.run(`(()=>{
    clearGame(true);
    state.cash=99999999; const below1=gateUnlocked('g1');
    state.cash=100000000; const at1=gateUnlocked('g1'), p1=gateProgress('g1');
    state.cash=499999999; const below5=gateUnlocked('g5');
    state.cash=500000000; const at5=gateUnlocked('g5'), lv5=gateLevel();
    state.cash=1000000000; const at10=gateUnlocked('g10'), lv10=gateLevel();
    return {below1,at1,p1,below5,at5,lv5,at10,lv10};
  })()`);
  check('1억 미만은 잠김', r.below1 === false && r.at1 === true, JSON.stringify(r));
  check('1억 진행률 100%', Math.abs(r.p1 - 1) < 1e-9, r.p1);
  check('5억 미만은 잠김', r.below5 === false && r.at5 === true, JSON.stringify(r));
  check('게이트 레벨 계산', r.lv5 === 2 && r.lv10 === 3, `${r.lv5}/${r.lv10}`);
}

// ── 1억: 사모펀드 · 블록딜 · 오프라인 +2시간 ────────────────
{
  const r = g.run(`(()=>{
    clearGame(true);
    state.cash=50000000; const peLocked=canJoin('pe');
    state.cash=100000000; const peOpen=canJoin('pe');
    const peRate=gradeRateFor('pe', currentGrade());
    const offlineAt1=offlineMaxSeconds();
    state.cash=2000000000; const offlineAt10=offlineMaxSeconds();
    const hedgeOpen=canJoin('hedge');
    return {peLocked,peOpen,peRate,offlineAt1,offlineAt10,hedgeOpen};
  })()`);
  check('사모펀드는 1억 미만 잠김', r.peLocked === false && r.peOpen === true, JSON.stringify(r));
  check('사모펀드는 등급과 무관한 고정 이율', r.peRate === 0.10, r.peRate);
  check('1억 게이트 오프라인 +2시간', r.offlineAt1 === 7200 + 7200, r.offlineAt1);
  check('10억 게이트 오프라인 +4시간', r.offlineAt10 === 7200 + 14400, r.offlineAt10);
  check('헤지펀드는 10억 게이트', r.hedgeOpen === true, r.hedgeOpen);

  const hedge = g.run(`(()=>{ clearGame(true); state.cash=999999999; return {locked:canJoin('hedge')}; })()`);
  check('헤지펀드는 10억 미만 잠김', hedge.locked === false, JSON.stringify(hedge));

  // 블록딜: 순자산 1억 미만이면 환급 없음
  const locked = g.run(`(()=>{
    clearGame(true); state.cash=0;
    stocks.forEach(s=>{s.own=0;});
    const s=stock('future_ai'); s.own=1000; s.price=20000; s.avgBuy=20000;
    state.tax.mode='general'; addTaxLot(s,1000,20000,'general');
    const r=executeSellAll();
    return {blockDeal:!!r.blockDeal, net:r.net, cash:state.cash};
  })()`);
  check('1억 미만 블록딜 우대 없음', locked.blockDeal === false, JSON.stringify(locked));

  const open = g.run(`(()=>{
    clearGame(true); state.cash=200000000;
    stocks.forEach(s=>{s.own=0;});
    const s=stock('future_ai'); s.own=1000; s.price=20000; s.avgBuy=20000;
    state.tax.mode='general'; addTaxLot(s,1000,20000,'general');
    const r=executeSellAll();
    return {blockDeal:!!r.blockDeal, net:r.net, cash:state.cash, fee:stockFeeRate()};
  })()`);
  check('1억 이상 블록딜 우대 적용', open.blockDeal === true && open.net > 0, JSON.stringify(open));
}

// ── 하루 배당 0.5% · DRIP ────────────────────────────────
{
  const r = g.run(`(()=>{
    clearGame(true); state.cash=0; state.usd=0;
    stocks.forEach(s=>{s.own=0;});
    const s=stock('future_ai'); s.own=10; s.price=100000;
    const perPay=expectedDividend();
    return {perPay, daily:perPay*720, holdings:10*100000};
  })()`);
  check('지급 1회분 = 하루 0.5% ÷ 720', Math.abs(r.perPay * 720 - r.holdings * 0.005) < 1e-6, JSON.stringify(r));
  check('하루 배당이 보유액의 0.5%', Math.abs(r.daily / r.holdings - 0.005) < 1e-9, r.daily / r.holdings);

  const drip = g.run(`(()=>{
    clearGame(true); state.cash=450000000; state.usd=0;
    stocks.forEach(s=>{s.own=0;});
    const s=stock('future_ai'); s.own=1000000; s.price=1000;
    setAutoIncomeMode('auto'); setPerk('drip',true);
    // 업적·목표 보상이 섞이지 않게 잠시 끕니다(배당 지급 자체만 확인).
    const ach=checkAchievements, goals=checkGoals;
    checkAchievements=()=>{}; checkGoals=()=>{};
    const before=s.own, cashBefore=state.cash;
    payDividends();
    checkAchievements=ach; checkGoals=goals;
    return {own:s.own, before, cash:state.cash, cashBefore, price:s.price, drip:perked('drip')};
  })()`);
  check('DRIP: 배당금으로 같은 종목 재매수', drip.drip === true && drip.own > drip.before, JSON.stringify(drip));
  check('DRIP: 1주 미만 잔액만 현금으로', drip.cash - drip.cashBefore >= 0 && drip.cash - drip.cashBefore < drip.price, `${drip.cash - drip.cashBefore}/${drip.price}`);

  const lockedDrip = g.run(`(()=>{
    clearGame(true); state.cash=1000; state.usd=0;
    stocks.forEach(s=>{s.own=0;});
    const s=stock('future_ai'); s.own=100000; s.price=1000;
    setAutoIncomeMode('auto');
    const ok=setPerk('drip',true);
    return {ok, drip:perked('drip')};
  })()`);
  check('5억 미만은 DRIP 켜기 거부', lockedDrip.ok === undefined && lockedDrip.drip === false, JSON.stringify(lockedDrip));
}

// ── 5억: 기업 인수 · 공모주 우선 배정 ─────────────────────
{
  const r = g.run(`(()=>{
    clearGame(true); state.cash=1000000;
    state.company={name:'x',level:1,valuation:10000000,book:10000000,revenue:0,profit:0,payout:.3,upkeep:0,risk:0,acquired:{}};
    const rival=RIVALS[0];
    const cashBefore=state.cash;
    acquireRival(rival.id);
    return {locked:state.cash===cashBefore, cash:state.cash};
  })()`);
  check('5억 미만 기업 인수 차단', r.locked === true, JSON.stringify(r));

  const alloc = g.run(`(()=>{
    clearGame(true); state.cash=1000000;
    const locked=ipoAllocation(1000,.3);
    state.cash=500000000;
    const open=ipoAllocation(1000,.3);
    const capped=ipoAllocation(100,.9);
    return {locked,open,capped};
  })()`);
  check('공모주 우선 배정 전 30%', alloc.locked === 300, alloc.locked);
  check('공모주 우선 배정 후 45%', alloc.open === 450, alloc.open);
  check('우선 배정도 청약 수량 초과 불가', alloc.capped === 100, alloc.capped);
}

// ── 10억: 부동산 개발 · 세무 컨설팅 ──────────────────────
{
  const r = g.run(`(()=>{
    clearGame(true); state.cash=200000000;
    const id=ESTATES[0].id;
    state.altPrices[id]=100000000;
    state.estate[id]={qty:1,avgBuy:100000000};
    developEstate(id);
    const locked={lv:estateDevLevel(id), price:estatePrice(id)};
    state.cash=2000000000;
    developEstate(id);
    return {locked, lv:estateDevLevel(id), price:estatePrice(id), cash:state.cash};
  })()`);
  check('10억 미만 부동산 개발 차단', r.locked.lv === 0 && r.locked.price === 100000000, JSON.stringify(r.locked));
  check('부동산 개발 1단계 가치 +12%', r.lv === 1 && r.price === 112000000, `${r.lv}/${r.price}`);

  const tax = g.run(`(()=>{
    clearGame(true); state.cash=2000000000;
    state.realizedYTD=0; state.taxedProfit=0; state.tax.carryLossBase=0;
    const before=taxProjection(20000000,'general').tax;
    setPerk('taxConsulting',true);
    const after=taxProjection(20000000,'general').tax;
    const rate=gainsTaxRate();
    return {before,after,rate};
  })()`);
  check('세무 컨설팅 세율 22% → 18%', Math.abs(tax.rate - 0.18) < 1e-9, tax.rate);
  check('세무 컨설팅 세금 감소', tax.after > 0 && tax.after < tax.before, JSON.stringify(tax));
}

// ── 해금 알림 · UI · 저장 ────────────────────────────────
{
  const r = g.run(`(()=>{
    clearGame(true); state.cash=100000000;
    checkAssetGates(); const first=!!state.gatesSeen.g1;
    checkAssetGates();
    const html = gatePanelHtml();
    return {first, seen:Object.keys(state.gatesSeen).length, html};
  })()`);
  check('게이트 해금 알림은 한 번만', r.first === true && r.seen === 1, JSON.stringify(r));
  check('대시보드 게이트 패널 표시', r.html.includes('자산 게이트') && r.html.includes('1억 클럽') && r.html.includes('10억 클럽'), r.html.length);

  const persist = g.run(`(()=>{
    clearGame(true);
    state.gatesSeen={g1:true}; state.estateDev={x:2}; state.perks={drip:true,taxConsulting:true};
    saveGame(); state.gatesSeen={}; state.estateDev={}; state.perks={};
    loadGame();
    return {seen:!!state.gatesSeen.g1, dev:state.estateDev.x, drip:perked('drip'), consulting:perked('taxConsulting')};
  })()`);
  check('게이트 상태 저장·복원', persist.seen && persist.dev === 2 && persist.drip && persist.consulting, JSON.stringify(persist));

  const settings = g.run("clearGame(true); state.cash=2000000000; settingsPage(); document.getElementById('settings').innerHTML");
  check('설정에 DRIP·세무 컨설팅 항목', settings.includes('배당 재투자') && settings.includes('세무 컨설팅'), settings.length);
}

// ── 모두에게 같은 하루 시세(실시간 공유 시세의 기반) ─────────
{
  const other = createGame();
  const days = '[1,2,50,180,331]';
  const a = g.run(`${days}.map(d=>dailyMarketReturn(d))`);
  const b = other.run(`${days}.map(d=>dailyMarketReturn(d))`);
  check('같은 날짜는 모든 플레이어에게 같은 시세', JSON.stringify(a) === JSON.stringify(b), JSON.stringify(a));
  check('하루 시세는 ±8% 안', a.every(v => Math.abs(v) <= 0.08), JSON.stringify(a));
}

console.log(`\n== ${pass}/${pass + fail} passed ==`);
process.exit(fail ? 1 : 0);
