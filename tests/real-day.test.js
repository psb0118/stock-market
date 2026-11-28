#!/usr/bin/env node
/**
 * 실제 시간 1일 = 게임 하루 모델 검증
 * - 날짜가 실제 시각(한국 자정 경계)으로 흐르고 모든 플레이어가 같은 날짜를 보는지
 * - 접속하지 않은 동안 지난 날짜의 시세가 복귀할 때 반영되는지
 * - 보유 탭 일괄 매도, 배당금 확실 지급, 대시보드 수령 안내
 * 실행: node tests/real-day.test.js
 */
'use strict';
const harness = require('./harness');

let pass = 0;
let fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log(`PASS ${name}${detail !== undefined ? `  [${detail}]` : ''}`); }
  else { fail++; console.log(`FAIL ${name}${detail !== undefined ? `  [${detail}]` : ''}`); }
}

// ── 하루 = 실제 24시간 · 모두 같은 날짜 ────────────────
{
  const g = harness.createGame();
  check('하루 길이는 실제 24시간', g.run('REAL_DAY_MS') === 86400000);
  check('날짜 경계는 한국 자정', g.run('marketDayIndex(dayStartMs(10))') === 10
    && g.run('marketDayIndex(dayStartMs(10)+REAL_DAY_MS-1)') === 10
    && g.run('marketDayIndex(dayStartMs(10)+REAL_DAY_MS)') === 11,
    `${g.run('marketDayIndex(dayStartMs(10))')}/${g.run('marketDayIndex(dayStartMs(10)+REAL_DAY_MS)')}`);
  g.run('setDayClock(dayStartMs(10)+5000); 1');
  check('날짜를 바꾸면 시장 일차도 바뀜', g.run('marketDayNumber()') === 11, g.run('marketDayNumber()'));
  check('다음 날까지 남은 실제 초', Math.round(g.run('marketDaySecondsLeft()')) === 86400 - 5, g.run('marketDaySecondsLeft()'));
  check('날짜 표시는 한국 날짜', g.run('marketDayDateText()') === '2026-01-11', g.run('marketDayDateText()'));
  check('주식 화면에 실제 날짜·하루 안내', /2026-01-11/.test(g.run('marketDayText()')) && /실제 1일 = 하루/.test(g.run('marketDayText()')), g.run('marketDayText()'));
  g.run('setDayClock(null); 1');
  check('고정 시계가 없으면 실제 시각을 씀', Math.abs(g.run('dayClockMs()') - Date.now()) < 5000
    && g.run('marketDayIndex()') === g.run('gameDayIndexAt(Date.now())'), g.run('dayClockMs()'));
  g.run('setDayClock(dayStartMs(10)+5000); 1');
  const t1 = g.run('state.speed=1; marketDayText()');
  const t5 = g.run('state.speed=5; marketDayText()');
  check('배속과 관계없이 날짜·남은 시간이 같음', t1 === t5, `${t1} / ${t5}`);
}

// ── 자리를 비운 동안 시세가 흐름 ────────────────────
{
  const g = harness.createGame();
  g.run(`setDayClock(dayStartMs(20)+1000);
    dailyMarketReturn=()=>0; dailyStockReturn=()=>0.05;
    const s=stock('future_ai'); s.dayIndex=17; s.price=s.start; s.prevClose=s.start; s.dayOpen=s.start;
    window.__p0=s.price; 1`);
  g.run('tickMarket(); 1');
  const r = g.run(`(()=>{ const s=stock('future_ai'); return {idx:s.dayIndex, today:marketDayIndex(), price:s.price, prev:s.prevClose, ratio:s.price/window.__p0}; })()`);
  check('비운 3일을 한 번에 반영', r.idx === 20 && r.today === 20, `${r.idx}/${r.today}`);
  check('3일치 변동이 복리로 적용', r.ratio > 1.14, r.ratio.toFixed(4));
  check('전일 종가 기준으로 새 날이 시작', r.prev > 100000 && r.prev < r.price, JSON.stringify(r));

  // 아주 오래 비워도 계산은 최근 120일까지만 (폭주 방지)
  g.run(`const s2=stock('hanbit_semi'); s2.dayIndex=0; s2.price=s2.start; setDayClock(dayStartMs(400)+1000); tickMarket(); 1`);
  check('오래 비운 경우도 날짜는 오늘로 맞춤', g.run("stock('hanbit_semi').dayIndex") === 400, g.run("stock('hanbit_semi').dayIndex"));
}

// ── 보유 탭 일괄 매도 ────────────────────────────
{
  const g = harness.createGame();
  g.run(`state.cash=0; state.marketOpen=true; state.settings.confirmTrades=false; state.tax.mode='general';
    ['future_ai','nova_sys','aurora_bio'].forEach(id=>{ const s=stock(id); s.own=3; s.avgBuy=s.price;
      s.taxLots=[{qty:3,price:s.price,at:0,account:'general'}]; });
    { const s=stock('core_net'); s.own=2; s.avgBuy=s.price; s.taxLots=[{qty:2,price:s.price,at:0,account:'isa'}]; }
    1`);
  check('일괄 매도 대상 수집(다른 계좌 포함)', g.run('sellAllRows().length') === 4, g.run('sellAllRows().length'));
  const res = g.run('executeSellAll()');
  check('네 건 모두 매도(일반·ISA)', res.done === 4 && g.run("['future_ai','nova_sys','aurora_bio','core_net'].every(id=>stock(id).own===0)"), JSON.stringify(res));
  check('세후 현금이 실제로 들어옴', g.run('state.cash') > 0 && res.net > 0, `${Math.round(g.run('state.cash'))}/${Math.round(res.net)}`);
  check('매도 후에는 일괄 대상이 없음', g.run('sellAllRows().length') === 0);
  g.run('openSellAllSheet(); 1');
  check('매도할 종목이 없으면 주문 창을 열지 않음', !g.run('document.getElementById("modalRoot").innerHTML').includes('전부 매도'));
  check('보유 탭에 일괄 매도 버튼', g.run(`(()=>{ const s=stock('future_ai'); s.own=1; s.avgBuy=s.price; holdingsPage(); return document.getElementById('holdings').innerHTML; })()`).includes('openSellAllSheet()'));
}

// ── 배당금은 설정과 상관없이 확실히 남는다 ─────────────
{
  const g = harness.createGame();
  g.run(`state.autoIncome={mode:'manual',pending:0,detail:{},skipped:0};
    const s=stock('future_ai'); s.own=10; s.price=100000; s.avgBuy=100000;
    state.cash=0; state.alerts=[]; state.notify=Object.assign({},state.notify,{master:false,center:true,dividend:true}); 1`);
  g.run('payDividends(); 1');
  const r = g.run('({pending:state.autoIncome.pending, cash:state.cash, log:(state.logs[0]||""), alerts:state.alerts.map(a=>a.title)})');
  check('모아 받기에서도 배당이 대기액으로 확실히 들어감', r.pending > 0, r.pending);
  check('배당이 나왔다는 기록이 남음', /배당금/.test(r.log), r.log);
  check('배당 발생 알림이 표시', r.alerts.some(t => t.indexOf('배당금') === 0), r.alerts.join(','));
  check('대시보드에 받기 안내', g.run('pendingIncomeBannerHtml()').includes('지금 받기'));
  g.run('collectAutoIncome(); 1');
  check('받기로 현금에 들어옴', Math.abs(g.run('state.cash') - r.pending) < 1 && g.run('state.autoIncome.pending') === 0, g.run('state.cash'));

  g.run("state.autoIncome={mode:'off',pending:0,detail:{},skipped:0}; state.cash=0; state.alerts=[]; payDividends(); 1");
  check('받지 않음 설정은 지급하지 않고 기록', g.run('state.cash') === 0 && g.run('state.autoIncome.skipped') > 0, g.run('state.autoIncome.skipped'));
  check('받지 않음도 대시보드에서 바로 바꿀 수 있게 안내', g.run('pendingIncomeBannerHtml()').includes('자동 지급으로 바꾸기'));
}

// ── 저장 형식 ─────────────────────────────────
{
  const g = harness.createGame();
  const raw = g.run('JSON.stringify(buildSaveData())');
  check('저장에 실제 날짜 모델 표시 포함', /"dayModelReal":1/.test(raw));
  check('저장 파일에 날짜 모델 표시', /"dayModel":"real"/.test(raw));
  const g2 = harness.createGame();
  g2.run(`applySaveData({version:SAVE_VERSION,state:{marketSeconds:5000,cash:1000},stocks:[{id:"future_ai",own:0,price:12345}],products:[]}); 1`);
  check('구버전 저장은 오늘 날짜로 한 번만 옮김', g2.run("stock('future_ai').dayIndex") === g2.run('marketDayIndex()') && g2.run('state.dayModelReal') === 1,
    g2.run("stock('future_ai').dayIndex"));

  // 새 저장은 저장된 일차를 그대로 복원해야 합니다(불러올 때 몰아서 적용하지 않음).
  const g3 = harness.createGame();
  g3.run('setDayClock(dayStartMs(40)+1000); tickMarket(); 1');
  const saved = g3.run('JSON.stringify(buildSaveData())');
  g3.run(`setDayClock(dayStartMs(50)+1000); applySaveData(${saved}); 1`);
  check('새 저장은 저장된 일차를 그대로 복원', g3.run("stock('future_ai').dayIndex") === 40, g3.run("stock('future_ai').dayIndex"));
}

console.log(`\n${pass}/${pass + fail} 통과`);
process.exit(fail ? 1 : 0);
