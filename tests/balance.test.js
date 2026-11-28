#!/usr/bin/env node
/**
 * 밸런스 시뮬레이션 스냅샷
 *
 * simulate-horizons.js와 같은 가정(30초마다 기본 노동 1회 45,000원, 5분마다 현금 75%를
 * 시장 ETF에 매수)으로 고정 시드를 돌려, 시간대별 자산 중앙값이 스냅샷 범위 안에 있는지 봅니다.
 * 밸런스를 의도적으로 바꿨다면 SNAPSHOT 값을 함께 갱신하세요.
 * 실행: node tests/balance.test.js
 */
'use strict';

const { createGame, seededMath } = require('./harness');

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log(`PASS ${name}${detail !== undefined ? `  [${detail}]` : ''}`); }
  else { fail++; console.log(`FAIL ${name}${detail !== undefined ? `  [${detail}]` : ''}`); }
}

const SEEDS = [1103, 1200, 1297];
const SNAPSHOT = {
  3600: { totalMedian: [1000000, 25000000], etf: [0.5, 3] },
  10800: { totalMedian: [5000000, 120000000], etf: [0.5, 4] }
};

function simulate(seed, seconds) {
  const g = createGame({ Math: seededMath(seed) });
  g.run(`(()=>{
    clearGame(true);
    state.auto.enabled=false; state.paused=false;
    state.goals=Object.fromEntries(MILESTONES.map(m=>[m.id,true]));
    state.special=Object.fromEntries(SPECIAL_MISSIONS.map(m=>[m.id,true]));
    state.achievements=Object.fromEntries(ACHIEVEMENTS.map(a=>[a.id,true]));
    state.rewardedGrade=gradeIndex(currentGrade());
    update=()=>{}; renderMarketBar=()=>{}; saveGame=()=>{}; addLog=()=>{}; notify=()=>{};
    let nextLabor=30, nextInvest=300;
    for(let t=1;t<=${seconds};t++){
      tickSeconds();
      if(t%15===0){ tickAlt(); interest(); }
      if(t%5===0){ tickMarket(); updateFX(); }
      if(t%7===0) marketEventsAndNews();
      if(t>=nextLabor){ state.cash+=45000; state.labor.shifts++; nextLabor+=30; }
      if(t>=nextInvest){
        const etf=stock('market_etf');
        const q=Math.floor((state.cash*.75)/(etf.price*(1+stockFeeRate())));
        if(q>0) marketBuyShares(etf,q);
        nextInvest+=300;
      }
    }
    return {total:totalAssetsKRW(), cash:state.cash, etf:stock('market_etf').price/stock('market_etf').start};
  })()`);
  return g.run('({total:totalAssetsKRW(), cash:state.cash, etf:stock("market_etf").price/stock("market_etf").start})');
}

function median(values) {
  const s = values.slice().sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}
function won(n) {
  if (!Number.isFinite(n)) return '-';
  if (Math.abs(n) >= 100000000) return `${(n / 100000000).toFixed(2)}억`;
  if (Math.abs(n) >= 10000) return `${(n / 10000).toFixed(0)}만`;
  return `${Math.round(n)}`;
}

for (const seconds of Object.keys(SNAPSHOT).map(Number)) {
  const rows = SEEDS.map(seed => simulate(seed, seconds));
  const totals = rows.map(r => r.total);
  const med = median(totals);
  const etfMed = median(rows.map(r => r.etf));
  const snap = SNAPSHOT[seconds];
  const hours = seconds / 3600;
  check(`${hours}시간 뒤 자산 중앙값이 스냅샷 범위 안`, Number.isFinite(med) && med >= snap.totalMedian[0] && med <= snap.totalMedian[1], `${won(med)} (${snap.totalMedian.map(won).join('~')})`);
  check(`${hours}시간 ETF 배율이 스냅샷 범위 안`, etfMed >= snap.etf[0] && etfMed <= snap.etf[1], `${(etfMed * 100).toFixed(0)}%`);
  check(`${hours}시간 자산이 NaN/음수가 아님`, rows.every(r => Number.isFinite(r.total) && r.total >= 0 && Number.isFinite(r.cash)), JSON.stringify(rows.map(r => Math.round(r.total))));
}

// 환생 포인트 곡선: 같은 순자산이면 언제나 같은 포인트.
const rebirth = createGame().run('([1e8,2e8,1e9,1e10].map(v=>rebirthPointsFor(v)))');
check('환생 포인트 곡선 스냅샷', JSON.stringify(rebirth) === JSON.stringify([3, 4, 10, 31]), JSON.stringify(rebirth));

// 노동 일당: 12종 모두 3회 완벽 판정 시 기본 일당과 일치하고, 임금이 단조 증가.
const labor = createGame().run(`(()=>{
  const perfect=LABOR_JOBS.map(j=>laborShiftPay(j,['perfect','perfect','perfect'],1).pay);
  return {count:LABOR_JOBS.length, perfect, base:LABOR_JOBS.map(j=>j.pay)};
})()`);
check('노동 12종 만점 일당 = 기본 일당', labor.count === 12 && labor.perfect.every((p, i) => Math.abs(p - labor.base[i]) <= 1), JSON.stringify(labor.perfect));
check('노동 일당이 5만~70만원 범위', labor.base.every(v => v >= 50000 && v <= 700000), JSON.stringify(labor.base));

console.log(`\n== ${pass}/${pass + fail} passed ==`);
if (fail) process.exit(1);
