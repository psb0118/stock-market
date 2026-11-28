#!/usr/bin/env node
/**
 * 후반 밸런스 · 접근성 · 온라인 부분 갱신 테스트.
 *  - 10억원 초과 자산 관리 수수료(구간별 계산·현금 한도·60초 주기)
 *  - 큰 글씨/색약 설정과 CSS 토큰
 *  - 페이지 구조 키가 같으면 전체 렌더 없이 data-live만 갱신
 * 실행: node tests/late-game.test.js
 */
'use strict';
const harness = require('./harness');

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const source = /<script>([\s\S]*?)<\/script>/.exec(html)[1];
const css = /<style>([\s\S]*?)<\/style>/.exec(html)[1];

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log(`PASS ${name}${detail !== undefined ? `  [${detail}]` : ''}`); }
  else { fail++; console.log(`FAIL ${name}${detail !== undefined ? `  [${detail}]` : ''}`); }
}

function makeElement(id) {
  const classes = new Set();
  return {
    id, value: '', textContent: '', innerHTML: '', disabled: false, className: '', style: {}, children: [], checked: false,
    getAttribute() { return null; },
    classList: {
      add: c => classes.add(c), remove: c => classes.delete(c),
      toggle: (c, on) => (on === undefined ? (classes.has(c) ? classes.delete(c) : classes.add(c)) : (on ? classes.add(c) : classes.delete(c))),
      contains: c => classes.has(c), _set: classes
    },
    appendChild(c) { this.children.push(c); }, removeChild(c) { this.children = this.children.filter(x => x !== c); },
    matches: () => false, contains: () => false
  };
}

function createGame(options = {}) {
  const h = harness.createGame();
  const live = (options.live || []).map(([key, id]) => {
    const e = h.el(id);
    e.getAttribute = sel => (sel === 'data-live' ? key : null);
    return e;
  });
  const document = h.ctx.document;
  document.querySelectorAll = sel => (sel === '[data-live]' ? live : []);
  return { run: h.run, el: h.el, live, document };
}

// ── 후반 자산 관리 수수료 ─────────────────────────
{
  const g = createGame();
  const due = g.run(`(()=>{
    state.cash=0; const zero=wealthFeeDue();
    state.cash=1000000000; const atFree=wealthFeeDue();
    state.cash=1500000000; const half=wealthFeeDue();
    state.cash=11000000000; const over=wealthFeeDue();
    return {zero,atFree,half,over};
  })()`);
  check('10억원 이하 수수료 0원', due.zero === 0 && due.atFree === 0, JSON.stringify(due));
  check('10억원 초과분 0.01%/60초', due.half === 50000, due.half);
  check('100억원 초과분 0.02%/60초 구간 합산', due.over === 1100000, due.over);

  const paid = g.run(`(()=>{
    state.cash=2000000000; state.usd=0; state.marketSeconds=600;
    const before=state.cash; const p=chargeWealthFee();
    return {p, before, after:state.cash, total:state.wealthFeePaid};
  })()`);
  check('수수료를 현금에서 차감', paid.p === 100000 && paid.after === paid.before - paid.p && paid.total === paid.p, JSON.stringify(paid));

  const short = g.run(`(()=>{
    state.cash=1000; state.usd=1000000; state.wealthFeePaid=0; state.marketSeconds=660;
    const p=chargeWealthFee();
    return {p, cash:state.cash, total:state.wealthFeePaid};
  })()`);
  check('현금이 부족하면 0원까지만 차감', short.p === 1000 && short.cash === 0 && short.total === 1000, JSON.stringify(short));

  const wiring = g.run(`(()=>{
    clearGame(true); state.cash=2000000000;
    const original=chargeWealthFee; let hit=0; chargeWealthFee=()=>{hit++;};
    state.marketSeconds=59; tickSeconds(); const at60=hit;
    tickSeconds(); const at61=hit;
    chargeWealthFee=original;
    return {at60,at61};
  })()`);
  check('60초마다 수수료 계산 호출', wiring.at60 === 1 && wiring.at61 === 1, JSON.stringify(wiring));

  const persisted = g.run(`(()=>{
    state.wealthFeePaid=12345; saveGame(); state.wealthFeePaid=0; loadGame();
    return state.wealthFeePaid;
  })()`);
  check('누적 수수료 저장·복원', persisted === 12345, persisted);

  const reset = g.run(`(()=>{ state.wealthFeePaid=999; state.wealthFeeAt=60; clearGame(true); return {paid:state.wealthFeePaid, at:state.wealthFeeAt}; })()`);
  check('새 게임에서 누적 수수료 초기화', reset.paid === 0 && reset.at === 0, JSON.stringify(reset));

  const tax = g.run("document.getElementById('tax').innerHTML=''; taxPage(); document.getElementById('tax').innerHTML");
  check('세금 화면에 수수료 안내', tax.includes('고액 자산 관리 수수료') && tax.includes('다음 60초 예상'), tax.length);
}

// ── 접근성 설정 ───────────────────────────────────
{
  const g = createGame();
  check('큰 글씨·색약 설정 기본 꺼짐', g.run('state.settings.largeText') === false && g.run('state.settings.colorblind') === false);
  g.run('state.settings.largeText=true; state.settings.colorblind=true; applyTheme(); 1');
  const classes = g.run('Array.from(document.body.classList._set)');
  check('큰 글씨·색약 클래스 적용', classes.includes('large-text') && classes.includes('cb'), classes.join(','));
  g.run('state.settings.largeText=false; state.settings.colorblind=false; applyTheme(); 1');
  check('끄면 클래스 해제', !g.run('document.body.classList.contains("large-text")') && !g.run('document.body.classList.contains("cb")'));

  const settings = g.run("document.getElementById('settings').innerHTML=''; settingsPage(); document.getElementById('settings').innerHTML");
  check('설정에 큰 글씨·색약 항목', settings.includes('큰 글씨 모드') && settings.includes('색약 대응 팔레트'));

  g.run('state.settings.largeText=true; state.settings.colorblind=true; saveGame(); state.settings.largeText=false; state.settings.colorblind=false; applyTheme(); loadGame(); 1');
  check('불러온 접근성 설정 즉시 적용', g.run('document.body.classList.contains("large-text") && document.body.classList.contains("cb")'));
  g.run('state.settings.largeText=false; state.settings.colorblind=false; applyTheme(); 1');

  check('숫자 고정폭(tabular-nums)', css.includes('font-variant-numeric:tabular-nums'));
  check('큰 글씨 모드 CSS', css.includes('body.large-text') && css.includes('body.large-text .metric b'));
  check('색약 팔레트 CSS', css.includes('body.cb') && css.includes('--up:#b45309'));
  check('운영체제 동작 줄이기 존중', css.includes('prefers-reduced-motion') && css.includes('animation-duration:.001ms'));
}

// ── 온라인 부분 갱신 ──────────────────────────────
{
  const g = createGame({ live: [['netShort', 'live-net'], ['cashShort', 'live-cash'], ['reportRet', 'live-ret']] });
  g.run(`state.marketSeconds=0; activePage=()=>"dashboard"; livePageKeys.dashboard=livePageKey("dashboard"); __renders=0; dashboardPage=()=>{__renders++;}; update(); 1`);
  check('가격만 바뀌면 전체 렌더 생략', g.run('__renders') === 0, g.run('__renders'));
  check('data-live 순자산 갱신', g.live[0].textContent === g.run('wonShort(netAssetsKRW())'), g.live[0].textContent);
  check('data-live 현금 갱신', g.live[1].textContent === g.run('wonShort(state.cash)'), g.live[1].textContent);

  g.run("stock('future_ai').price*=1.1; update(); 1");
  check('주가 변동에도 전체 렌더 없음', g.run('__renders') === 0, g.run('__renders'));

  g.run("stock('future_ai').own=3; update(); 1");
  check('보유 종목이 바뀌면 전체 렌더', g.run('__renders') === 1, g.run('__renders'));

  const key = g.run('(()=>{const a=livePageKey("dashboard"); state.marketSeconds=20; const b=livePageKey("dashboard"); return {a,b};})()');
  check('15게임초마다 안전 재렌더', key.a !== key.b, `${key.a} / ${key.b}`);
}

console.log('');
console.log(`== ${pass}/${pass + fail} passed ==`);
process.exit(fail ? 1 : 0);
