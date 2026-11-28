#!/usr/bin/env node
/**
 * 밸런스·편의 개선 6종 테스트
 *  1) 예금 이자 쏠림 완화(계수 하향 · 예금 비중 경고)
 *  2) 자산 게이트 예상 도달일(ETA)과 다음 목표 안내
 *  3) 배당주 시스템(종목별 배당률 + 배당 캘린더)
 *  4) 오프라인 복귀 리포트 항목별 분해
 *  5) 자산배분 코치(목표 비중 · 초과/부족 안내)
 *  6) 모바일 자산 게이트 패널 접기
 * 실행: node tests/improvements.test.js
 */
'use strict';
const { createGame } = require('./harness');

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log(`PASS ${name}${detail !== undefined ? `  [${detail}]` : ''}`); }
  else { fail++; console.log(`FAIL ${name}${detail !== undefined ? `  [${detail}]` : ''}`); }
}

const g = createGame();

// ── 1. 예금 이자 쏠림 완화 ─────────────────────────────────
{
  const r = g.run(`(()=>{
    clearGame(true);
    const p = product('deposit');
    p.amount = 10000000; p.rate = 0.012;
    const daily = productDailyInterest(p);
    const before = p.amount;
    state.marketSeconds = 15;
    interest();
    return { daily, share: daily / before, gained: p.amount - before, period: INTEREST_PERIOD };
  })()`);
  check('예금 하루 예상 이자 10~35% (24시간 접속 기준)', r.share > 0.10 && r.share < 0.35, (r.share * 100).toFixed(2) + '%');
  check('15초 이자가 계수와 일치', Math.abs(r.gained - 10000000 * 0.012 * r.period) < 0.01, r.gained.toFixed(2));

  // 예금 쏠림의 원인은 "큰 예금의 무한 복리"입니다. 실효 원금을 6,000만원에서 멈춥니다.
  const cap = g.run(`(()=>{
    clearGame(true);
    const p = product('deposit');
    p.amount = 1000000000; p.rate = 0.012;
    const before = p.amount, cashBefore = state.cash; state.marketSeconds = 15; interest();
    return { eff: effectiveDepositPrincipal(p.amount), amountAfter: p.amount, gained: state.cash - cashBefore, expected: 60000000 * 0.012 * INTEREST_PERIOD };
  })()`);
  check('예금 실효 원금 상한 6,000만원', cap.eff === 60000000, cap.eff);
  check('상한 초과 예금은 복리 없이 현금 지급', cap.amountAfter === 1000000000 && Math.abs(cap.gained - cap.expected) < 0.01, `${cap.amountAfter}/${cap.gained.toFixed(2)}`);

  const warn = g.run(`(()=>{
    clearGame(true);
    state.cash = 30000000; state.usd = 0;
    products.forEach(p => { p.amount = 0; });
    product('deposit').amount = 70000000;
    return { share: productValueKRW() / grossAssetsKRW(), html: depositConcentrationHtml() };
  })()`);
  check('예금 70%면 쏠림 경고 표시', warn.share > 0.6 && warn.html.includes('예금 쏠림') && warn.html.includes('자산배분 코치'), warn.share.toFixed(2));
}

// ── 2. 게이트 ETA · 다음 목표 안내 ──────────────────────────
{
  const r = g.run(`(()=>{
    clearGame(true); state.cash = 50000000; state.usd = 0; state.loan = 0;
    assetHistory.points.length = 0;
    assetHistory.points.push({t:0,v:50000000},{t:21600,v:54000000},{t:43200,v:60000000},{t:64800,v:66000000},{t:86400,v:72000000});
    return {
      growth: assetDailyGrowth(),
      days: gateEtaDays(100000000),
      text: gateEtaText(100000000),
      html: gatePanelHtml()
    };
  })()`);
  check('하루 성장률 계산(50M→72M)', r.growth > 0.4 && r.growth < 0.5, r.growth);
  check('1억까지 예상 일수(약 2일)', r.days > 1.8 && r.days < 2.2, r.days);
  check('게이트 ETA 문구 표시', r.text.includes('약') && r.text.includes('일'), r.text);
  check('게이트 패널에 다음 목표 안내', r.html.includes('다음 1억') && r.html.includes('자산 게이트'), r.html.length);

  const stale = g.run(`(()=>{
    clearGame(true); state.cash = 10000000;
    assetHistory.points.length = 0;
    return { days: gateEtaDays(100000000), text: gateEtaText(100000000) };
  })()`);
  check('기록이 없으면 ETA를 지어내지 않음', stale.days === null && stale.text === '예상 계산 중', stale.text);
}

// ── 3. 배당주 시스템 · 배당 캘린더 ──────────────────────────
{
  const r = g.run(`(()=>{
    clearGame(true); state.cash = 0; state.usd = 0; state.loan = 0;
    stocks.forEach(s => { s.own = 0; });
    const etf = stock('market_etf'), ai = stock('future_ai'), inv = stock('market_inv');
    [etf, ai, inv].forEach(s => { s.own = 100; s.price = 100000; });
    setAutoIncomeMode('auto');
    const expected = expectedDividend();
    payDividends();
    return {
      rateEtf: stockDailyDividendRate(etf), rateAi: stockDailyDividendRate(ai), rateInv: stockDailyDividendRate(inv),
      perEtf: stockDividendPerPayment(etf), perAi: stockDividendPerPayment(ai), perInv: stockDividendPerPayment(inv),
      cash: state.cash, expected, html: dividendCalendarHtml()
    };
  })()`);
  check('종목별 배당률이 다름(ETF 1.8% > 기본 1.5%)', r.rateEtf === 0.018 && r.rateAi === 0.015, `${r.rateEtf}/${r.rateAi}`);
  check('배당 없는 성장주(인버스)는 0%', r.rateInv === 0 && r.perInv === 0, r.rateInv);
  check('배당 지급도 종목별 배당률 사용', Math.abs(r.cash - r.expected) < 1e-6, `${r.cash}/${r.expected}`);
  check('배당 ETF가 기본 종목보다 많이 지급', r.perEtf > r.perAi, `${r.perEtf}/${r.perAi}`);
  check('배당 캘린더에 종목별 배당률 표시', r.html.includes('배당 캘린더') && r.html.includes('1.8%/일') && r.html.includes('이번 지급 예상'), r.html.length);
}

// ── 4. 오프라인 리포트 항목별 분해 ──────────────────────────
{
  const r = g.run(`(()=>{
    clearGame(true); state.cash = 0; state.usd = 0; state.loan = 0;
    stocks.forEach(s => { s.own = 0; });
    const s = stock('future_ai'); s.own = 1000; s.price = 100000;
    products.forEach(p => { p.amount = 0; p.rate = 0; });
    const dep = product('deposit'); dep.amount = 10000000; dep.rate = 0.012;
    setAutoIncomeMode('auto');
    OFFLINE_AWAY_FULL_SECONDS = 86400;
    const rep = offlineSettle(7200, { idxBefore: marketIndex(), fxBefore: fx.usd, heldBefore: {} });
    return {
      div: rep.dividends,
      divSum: (rep.divDetail || []).reduce((a, x) => a + x.amount, 0),
      divNames: (rep.divDetail || []).map(x => x.name),
      interestLen: (rep.interestDetail || []).length,
      interestSum: (rep.interestDetail || []).reduce((a, x) => a + x.amount, 0),
      capped: rep.capped, html: offlineReportHtml(rep)
    };
  })()`);
  check('배당 분해 합계 = 총 배당', Math.abs(r.divSum - r.div) < 1, `${r.divSum}/${r.div}`);
  check('배당 분해에 종목명 포함', r.divNames.includes('미래AI전자'), r.divNames.join(','));
  check('이자 분해에 상품별 금액', r.interestLen >= 1 && r.interestSum > 0, `${r.interestLen}/${r.interestSum.toFixed(0)}`);
  check('오프라인 상한 적용 표시', r.capped === true, r.capped);
  check('리포트에 항목별 분해·시간당 수익', r.html.includes('항목별 분해') && r.html.includes('시간당'), r.html.length);
}

// ── 5. 자산배분 코치 ────────────────────────────────────────
{
  const r = g.run(`(()=>{
    clearGame(true); state.cash = 30000000; state.usd = 0; state.loan = 0;
    stocks.forEach(s => { s.own = 0; });
    products.forEach(p => { p.amount = 0; });
    product('deposit').amount = 70000000;
    const t = allocationTargets();
    return {
      sum: Object.keys(t).reduce((a, k) => a + t[k], 0),
      finance: t.finance,
      html: allocationCoachHtml()
    };
  })()`);
  check('목표 비중 합계 100%', Math.abs(r.sum - 100) < 1e-9, r.sum);
  check('코치가 초과 비중을 지목', r.html.includes('자산배분 코치') && r.html.includes('금융상품 비중이 목표보다'), r.html.length);
  check('코치에 목표·현재·차이 표시', r.html.includes('목표') && r.html.includes('%p') && r.html.includes('줄이기'), r.html.length);
}

// ── 6. 모바일 게이트 패널 접기 ──────────────────────────────
{
  const r = g.run(`(()=>{
    clearGame(true); state.cash = 100000000;
    state.ui = Object.assign({}, state.ui, { gatesOpen: null });
    window.innerWidth = 600;
    const mobileOpen = gatesOpen();
    const collapsed = gatePanelHtml().includes('gate-body" hidden');
    toggleGates();
    const after = gatesOpen();
    const expanded = !gatePanelHtml().includes('gate-body" hidden') && gatePanelHtml().includes('접기');
    window.innerWidth = 1200;
    state.ui.gatesOpen = null;
    const desktopOpen = gatesOpen();
    return { mobileOpen, collapsed, after, expanded, desktopOpen };
  })()`);
  check('모바일은 기본 접힘', r.mobileOpen === false && r.collapsed === true, JSON.stringify(r));
  check('펼치기 버튼으로 열림', r.after === true && r.expanded === true, JSON.stringify(r));
  check('데스크톱은 기본 펼침', r.desktopOpen === true, r.desktopOpen);
}

console.log(`\n== ${pass}/${pass + fail} passed ==`);
if (fail) process.exit(1);
