#!/usr/bin/env node
/**
 * 밸런스 시뮬레이션 — 실제 게임 함수(index.html)를 그대로 돌려 확인합니다.
 *
 * 확인 항목
 *  1) 순자산 1억·5억·10억 게이트에 며칠 만에 도달하는가
 *  2) 종목별 하루 배당(기본 1.5%)이 실제 플레이에서 얼마나 들어오는가
 *  3) 배당·예금·노동이 최종 자산에서 차지하는 비중(예금 쏠림 여부)
 *
 * 가정(스크립트 안에서 명시)
 *  - 하루 = 실제 24시간. 플레이 시간 동안만 marketSeconds가 흐르고,
 *    자리를 비운 시간은 offlineMaxSeconds() 상한까지 오프라인 정산됩니다.
 *  - 노동: 초반 순자산 3천만원 미만일 때만, 플레이 시간의 절반을 노동에 쓰고
 *    30초당 6만원(성공 보상 기준)을 법니다.
 *  - 들어오는 현금의 절반을 예금, 절반을 국내 주식 8종 동일 비중으로 배분합니다
 *    (예금을 먼저 목표까지 채우면 주식 살 돈이 남지 않아 쏠림이 과장됩니다).
 *
 * 실행: node scripts/balance-sim.js
 *       node scripts/balance-sim.js 15 40 120   (하루 플레이 분)
 *       DAYS=240 node scripts/balance-sim.js 40
 *       DIV_MULT=1.3 RATE_MULT=1.2 node scripts/balance-sim.js 40   (조정안 비교)
 */
"use strict";
const { createGame } = require("../tests/harness");

const DAY_MS = 86400000;
const GATES = [
  ["1억", 100000000],
  ["5억", 500000000],
  ["10억", 1000000000],
];

function simulate(minutes, days = 120, speed = 5) {
  const g = createGame();
  // 긴 기간을 돌리기 위한 조정 실험값입니다(기본 1 = 현재 밸런스).
  const divMult = Math.max(0, Number(process.env.DIV_MULT) || 1);
  const rateMult = Math.max(0, Number(process.env.RATE_MULT) || 1);
  // 화면·저장은 밸런스에 영향이 없으므로 긴 시뮬레이션에서는 생략합니다.
  g.run(`clearGame(true); setAutoIncomeMode("auto"); state.settings.confirmTrades=false; state.speed=${speed};
    renderMarketBar=()=>{}; update=()=>{}; publishBreakingNews=()=>{}; saveGame=()=>{};
    if(${divMult}!==1) Object.keys(DIVIDEND_STOCK_RATES).forEach(k=>{DIVIDEND_STOCK_RATES[k]*=${divMult};}); 1`);
  const epochs = g.run("({epoch:GAME_DAY_EPOCH_MS, cap:offlineMaxSeconds()})");

  const reached = {};
  let dividendTotal = 0;
  let playDividendTotal = 0;
  let depositTotal = 0;
  let stockTotal = 0;
  let laborTotal = 0;
  let last = null;
  const daily = [];

  for (let d = 0; d < days; d++) {
    const step = g.run(`(()=>{
      setDayClock(GAME_DAY_EPOCH_MS + ${d} * 86400000 + 12 * 3600000);
      tickMarket();
      const netBefore = totalAssetsKRW();
      // ── 노동(초반만): 플레이 시간의 절반, 30초당 6만원 ──
      let labor = 0;
      if (netBefore < 30000000) {
        labor = Math.min(${Math.round(minutes * 0.5)}, 60) * 120000;
        state.cash += labor;
      }
      // ── 배분: 새 현금을 예금 50% / 국내주식 50%로 나눕니다 ──
      // (예금을 먼저 45%까지 채우면 주식 살 돈이 남지 않아 예금 쏠림이 과장됩니다.)
      const net = totalAssetsKRW();
      const investCash = state.cash;
      const dep = products.find(p => p.id === "deposit");
      const depRoom = Math.max(0, net * 0.45 - dep.amount);
      const depAdd = Math.min(investCash * 0.5, depRoom);
      if (depAdd > 0) {
        if (!(dep.rate > 0)) dep.rate = gradeRateFor("deposit", currentGrade()) * ${rateMult};
        dep.amount += depAdd; dep.startedAt = state.marketSeconds; state.cash -= depAdd;
      }
      const budget = Math.min(state.cash, investCash * 0.5);
      if (budget > 10000) {
        const picks = stocks.filter(s => !isIndexFund(s)).slice(0, 8);
        const each = budget / picks.length;
        picks.forEach(s => {
          const q = Math.floor(each / Math.max(1, s.price));
          if (q > 0) marketBuyShares(s, q, "general");
        });
      }
      // ── 플레이 시간(실제 초)만큼 틱 진행 ──
      const divBefore = state.dividendTotal || 0;
      // 실제 gameLoop와 같은 순서(단, 화면 렌더 update()만 생략)로 게임 초를 진행합니다.
      // 배속만큼 게임 초가 더 흐릅니다(5x → 같은 실제 시간에 5배).
      const gameSeconds = ${minutes * 60 * speed};
      for (let i = 0; i < gameSeconds; i++) {
        tickSeconds();
        // 15초 묶음으로 처리해 계산 비용을 줄입니다(뉴스 이벤트는 밸런스에 영향이 작아 생략).
        if (state.marketSeconds % 15 === 0) { tickAlt(); interest(); tickMarket(); updateFX(); }
      }
      const playDividend = (state.dividendTotal || 0) - divBefore;
      // ── 자리를 비운 시간: 상한까지 오프라인 정산 ──
      const away = Math.max(0, 86400 - ${minutes * 60} - 60);
      const sec = Math.min(offlineMaxSeconds(), away);
      const divBefore2 = state.dividendTotal || 0;
      OFFLINE_AWAY_FULL_SECONDS = away; // 실제 게임의 offlineElapsedSeconds()와 같은 값
      if (sec > 0) offlineSettle(sec, { idxBefore: marketIndex(), fxBefore: fx.usd, heldBefore: {} });
      const offlineDividend = (state.dividendTotal || 0) - divBefore2;
      return {
        net: totalAssetsKRW(), labor,
        playDividend, offlineDividend,
        dividend: (state.dividendTotal || 0) - divBefore,
        deposit: (products.find(p => p.id === "deposit") || {}).amount || 0,
        stocks: stocks.reduce((a, s) => a + (s.own || 0) * s.price * (isForeignStock(s) ? fx.usd : 1), 0),
        cash: state.cash, cap: offlineMaxSeconds(),
      };
    })()`);

    last = step;
    dividendTotal += step.dividend;
    playDividendTotal += step.playDividend;
    depositTotal = step.deposit;
    stockTotal = step.stocks;
    laborTotal += step.labor;
    daily.push({ day: d + 1, net: step.net, dividend: step.dividend });
    for (const [name, target] of GATES) {
      if (!reached[name] && step.net >= target) reached[name] = d + 1;
    }
  }

  return {
    minutes,
    speed,
    divMult,
    rateMult,
    capHours: +(epochs.cap / 3600).toFixed(1),
    reached,
    endNet: last.net,
    endDeposit: depositTotal,
    endStocks: stockTotal,
    endCash: last.cash,
    laborTotal,
    dividendTotal,
    playDividendTotal,
    offlineDividendTotal: dividendTotal - playDividendTotal,
    avgStock: daily.reduce((a, x) => a + x.net, 0) / Math.max(1, daily.length),
    daily,
  };
}

const args = process.argv.slice(2).map(Number).filter((n) => Number.isFinite(n) && n > 0);
const profiles = args.length ? args : [15, 40, 120];
const DAYS = Math.max(7, Math.floor(Number(process.env.DAYS) || 120));

console.log(`# 밸런스 시뮬레이션 (하루 ${DAYS}일, 실제 게임 함수 실행)\n`);
for (const minutes of profiles) {
  const r = simulate(minutes, DAYS);
  console.log(`## 하루 ${minutes}분 플레이(배속 ${r.speed}x) · 오프라인 상한 ${r.capHours}시간`);
  if (r.divMult !== 1 || r.rateMult !== 1) console.log(`조정 가정: 배당 ×${r.divMult} · 예금 이율 ×${r.rateMult}`);
  console.log(`도달: ${GATES.map(([n]) => `${n}=${r.reached[n] ? "D" + r.reached[n] : "미도달"}`).join(" · ")}`);
  const depShare = r.endNet > 0 ? r.endDeposit / r.endNet : 0;
  console.log(`최종 순자산: ${won(r.endNet)} (예금 ${won(r.endDeposit)} · 주식 ${won(r.endStocks)} · 현금 ${won(r.endCash)})`);
  console.log(`예금 비중: ${(depShare * 100).toFixed(1)}% (45% 이하면 균형, 60% 이상이면 쏠림)`);
  console.log(`누적 노동 ${won(r.laborTotal)} · 누적 배당 ${won(r.dividendTotal)} (플레이 중 ${won(r.playDividendTotal)} / 오프라인 ${won(r.offlineDividendTotal)})`);
  const divPct = r.dividendTotal / Math.max(1, r.avgStock);
  console.log(`평균 보유자산 대비 ${DAYS}일 배당률: ${(divPct * 100).toFixed(2)}%  (하루 ${(divPct / DAYS * 100).toFixed(3)}%)`);
  console.log("");
}

function won(n) {
  const v = Math.round(+n || 0);
  if (Math.abs(v) >= 1e8) return (v / 1e8).toFixed(2) + "억";
  if (Math.abs(v) >= 1e4) return Math.round(v / 1e4).toLocaleString("ko-KR") + "만";
  return v.toLocaleString("ko-KR");
}
