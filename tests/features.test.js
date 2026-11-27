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
  check('2X ETF가 지수 2배(±50% 한도)', Math.abs(tracked.x2 - Math.min(15000, x2Raw)) < 1, tracked.x2);
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
  check('그래프 툴팁은 차트 시작 대비 수익률 계산', Math.abs(point.pct - 0.2) < 1e-9, point.pct);
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

  const modes = g.run('LABOR_JOBS.map(j=>j.mode)');
  check('노동 미니게임 4종', new Set(modes).size === 4, modes.join(','));
  check('연타 일자리는 목표 횟수가 있음', g.run("LABOR_JOBS.filter(j=>j.mode==='tap').every(j=>j.tapTarget>=10)"));
  check('계산 문제는 정답 포함 4개 보기', g.run('(()=>{const q=laborMakeMath();return q.options.length===4&&q.options.includes(q.answer)})()'));
  const memLen = g.run("(()=>{laborSession={job:laborJob('research'),mode:'memory',round:0,results:[],paid:false};laborBeginRound();const n=laborSession.seq.length;laborAbortShift(true);return n;})()");
  check('기억 게임은 3개부터 시작', memLen === 3, memLen);
  const tapGrade = g.run("(()=>{laborSession={job:{tapTarget:10},mode:'tap',taps:10,results:[],round:0,paid:false};laborTapEnd();const g=laborSession.results[0].grade;laborAbortShift(true);return g;})()");
  check('연타 목표 달성은 완벽 판정', tapGrade === 'perfect', tapGrade);
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

// ── Firebase 미설정 · 가격 알림 ─────────────────
{
  const g = createGame(19);
  // 설정이 있으면 로그인 화면이, 비어 있으면 안내가 나와야 합니다.
  const on = g.run(`(()=>{ const keep=FIREBASE_CONFIG; FIREBASE_CONFIG={apiKey:'k',projectId:'p',appId:'a'}; const out={ configured:firebaseConfigured(), text:firebasePanelHtml() }; FIREBASE_CONFIG=keep; return out; })()`);
  check('Firebase 웹 앱 설정 인식', on.configured === true, on.text.slice(0,30));
  check('로그인 전에는 Google 로그인 버튼 표시', on.text.includes('Google로 로그인') === true);
  const off = g.run(`(()=>{ const keep=FIREBASE_CONFIG; FIREBASE_CONFIG=null; const out={ configured:firebaseConfigured(), text:firebasePanelHtml() }; FIREBASE_CONFIG=keep; return out; })()`);
  check('설정이 비면 로컬 저장 안내', off.configured === false && off.text.includes('Firebase 설정'), off.text.slice(0,40));

  // 오류 코드별 안내: 콘솔에서 무엇을 고쳐야 하는지 화면에 바로 나와야 합니다.
  const dom = g.run(`firebaseHelpFor('auth/unauthorized-domain')`);
  check('승인된 도메인 오류 안내', dom.title.includes('도메인') && dom.steps.join(' ').includes('승인된 도메인'), dom.title);
  const perm = g.run(`firebaseHelpFor('permission-denied')`);
  check('permission-denied → 규칙 게시 안내', perm.steps.join(' ').includes('firestore.rules'));
  const idx = g.run(`firebaseHelpFor('failed-precondition')`);
  check('failed-precondition → 색인 안내', idx.steps.join(' ').includes('색인') && idx.steps.join(' ').includes('scores'));
  const notAllowed = g.run(`firebaseHelpFor('auth/operation-not-allowed')`);
  check('Google 로그인 꺼짐 안내', notAllowed.steps.join(' ').includes('Sign-in method'));
  check('firestore/ 접두사도 같은 안내', g.run(`firebaseHelpFor('firestore/permission-denied').code`) === 'permission-denied');
  const unknown = g.run(`firebaseHelpFor('some/unknown-error')`);
  check('알 수 없는 코드도 안내를 반환', typeof unknown.title === 'string' && unknown.steps.length > 0 && unknown.code === 'some/unknown-error');
  const helpHtml = g.run(`(()=>{ fbLastError={code:'<b>x</b>',title:'t',steps:['s'],where:'테스트'}; const h=firebaseHelpHtml(fbLastError); fbLastError=null; return h; })()`);
  check('오류 안내 HTML은 코드를 이스케이프', helpHtml.includes('&lt;b&gt;') && !helpHtml.includes('<b>x</b>'));
  const note = g.run(`(()=>{ const r=firebaseNoteError({code:'permission-denied'},'자동 저장'); return {paused:fbAutoPaused, code:fbLastError.code, same:r.code==='permission-denied'}; })()`);
  check('자동 저장 실패 시 반복 실패를 막기 위해 일시중지', note.paused === true && note.same === true && note.code === 'permission-denied');

  // 로그인 상태에서만 클라우드로 자동 업로드합니다.
  const auto = g.run(`(()=>{
    fbAutoPaused=false; fbLastError=null; fbUser=null; state.settings.cloudAuto=true;
    const off = {wanted:fbAutoWanted(), text:fbSyncText()};
    fbUser={uid:'u1',displayName:'테스터',email:'t@example.com'};
    state.settings.cloudAuto=true;
    const on = {wanted:fbAutoWanted(), text:fbSyncText(), path:'saves/u1'};
    state.settings.cloudAuto=false;
    const disabled = fbAutoWanted();
    state.settings.cloudAuto=true; fbUser=null; fbAutoPaused=false; fbLastError=null;
    return {off,on,disabled};
  })()`);
  check('로그인 전에는 자동 업로드 안 함', auto.off.wanted === false && auto.off.text === '');
  check('로그인 후에는 자동 업로드 대상', auto.on.wanted === true && auto.on.text.includes('자동 저장'), auto.on.text);
  check('자동 클라우드 저장을 끄면 업로드 안 함', auto.disabled === false);
  const panel = g.run(`(()=>{ const keep=FIREBASE_CONFIG; FIREBASE_CONFIG={apiKey:'k',projectId:'p',appId:'a'}; fbAutoPaused=false; fbLastError=null; fbUser={uid:'u1',displayName:'T',email:'e'}; state.settings.cloudAuto=true; const h=firebasePanelHtml(); fbUser=null; FIREBASE_CONFIG=keep; return h; })()`);
  check('설정 화면에 자동 저장 설명', panel.includes('자동 클라우드 저장') && panel.includes('saves/{uid}'), panel.slice(0, 60));
  check('로그인 없이 자동 업로드를 불러도 조용히 넘어감', typeof g.run('firebaseAutoUpload()') === 'object');

  // 연결 상태 점검: 도메인 매칭 · 결과 표시 · 설정 없을 때
  const domOk = g.run(`[fbDiagDomainOk(['localhost','a.com'],'a.com'), fbDiagDomainOk(['localhost'],'127.0.0.1'), fbDiagDomainOk(['localhost'],'evil.com'), fbDiagDomainOk([],'a.com')]`);
  check('승인된 도메인 비교(정확 일치·localhost 예외)', domOk[0] === true && domOk[1] === true && domOk[2] === false && domOk[3] === false, JSON.stringify(domOk));
  check('점검 전에는 결과 없음', g.run('fbDiagHtml()') === '');
  const diagHtml = g.run(`(()=>{
    fbDiag={at:Date.now(),running:false,rows:[
      {key:'domain',label:'승인된 도메인',state:'pass',detail:'example.com 승인됨',fix:''},
      {key:'index',label:'리더보드 색인',state:'fail',detail:'복합 색인이 <아직> 없습니다',fix:'Firestore → 색인',link:'https://console.firebase.google.com/v1/r/project/p/firestore/indexes?create_composite=abc',linkLabel:'색인 만들기 화면 열기'},
      {key:'google',label:'Google 로그인',state:'warn',detail:'확인하지 못했습니다',fix:''}]};
    const h=fbDiagHtml(), b=fbDiagBtnHtml(); fbDiag=null; return {h,b};
  })()`);
  check('점검 결과에 통과/실패 아이콘', diagHtml.h.includes('✅') && diagHtml.h.includes('❌'));
  check('점검 결과 요약에 실패 개수', diagHtml.h.includes('1개 실패'), diagHtml.h.slice(0, 80));
  check('점검 결과 요약에 확인 불가 개수', diagHtml.h.includes('1개 확인 불가') && diagHtml.h.includes('1개 통과'), diagHtml.h.slice(0, 120));
  check('점검 상세 문구는 이스케이프', diagHtml.h.includes('&lt;아직&gt;') && !diagHtml.h.includes('<아직>'));
  check('색인 실패에 콘솔 링크 노출', diagHtml.h.includes('href="https://console.firebase.google.com/v1/r/project/p/firestore/indexes?create_composite=abc"') && diagHtml.h.includes('색인 만들기 화면 열기'));
  check('점검 버튼은 다시 점검으로 바뀜', diagHtml.b.includes('다시 점검'), diagHtml.b.slice(0, 60));
  const allPass = g.run(`(()=>{ fbDiag={at:0,running:false,rows:[{key:'a',label:'A',state:'pass'},{key:'b',label:'B',state:'pass'}]}; const h=fbDiagHtml(); fbDiag=null; return h; })()`);
  check('전부 통과하면 모두 통과로 표시', allPass.includes('2개 모두 통과'), allPass.slice(0, 90));
  const links = g.run(`(()=>{
    const withLink=fbIndexLinkFromError({message:'The query requires an index. You can create it here: https://console.firebase.google.com/v1/r/project/p/firestore/indexes?create_composite=AAA'}).toString();
    const noLink=fbIndexLinkFromError({message:'no url here'}).toString();
    return {withLink, noLink};
  })()`);
  check('오류 메시지의 색인 링크 추출', links.withLink === 'https://console.firebase.google.com/v1/r/project/p/firestore/indexes?create_composite=AAA', links.withLink);
  check('링크가 없으면 색인 목록으로 이동', links.noLink.includes('/firestore/indexes') && links.noLink.startsWith('https://console.firebase.google.com/project/'), links.noLink);
  const noCfg = g.run(`(()=>{ const keep=FIREBASE_CONFIG; FIREBASE_CONFIG=null; fbDiag=null; firebaseDiagnose(); const r={running:fbDiag.running, n:fbDiag.rows.length, state:fbDiag.rows[0].state}; fbDiag=null; FIREBASE_CONFIG=keep; return r; })()`);
  check('설정이 비면 점검 즉시 실패로 표시', noCfg.running === false && noCfg.n === 1 && noCfg.state === 'fail', JSON.stringify(noCfg));
  const hit = g.run(`(()=>{
    state.priceAlerts=[{stockId:'future_ai',price:1,dir:'above',armed:true}];
    const n=checkPriceAlerts();
    return {n, armed:state.priceAlerts[0].armed, alert:(state.alerts||[]).some(a=>a.title==='가격 알림')};
  })()`);
  check('가격 알림 1회 발동 후 해제', hit.n === 1 && hit.armed === false && hit.alert === true, JSON.stringify(hit));
}

// ── 공유 시장 · 자동 매수 차단 ─────────────────────
{
  // 난수 시드가 다른 두 플레이어가 같은 게임 시각에서 정확히 같은 시장을 보는지 확인합니다.
  const step = sec => `state.marketSeconds=${sec}; if(${sec}%5===0) tickMarket(); if(${sec}%15===0) tickAlt(); if(${sec}%7===0) marketEventsAndNews(); if(${sec}%15===0) updateFX(); 1`;
  const a = createGame(101), b = createGame(202);
  for (let sec = 1; sec <= 1200; sec++) { a.run(step(sec)); b.run(step(sec)); }
  const sig = g => g.run(`JSON.stringify({p:stocks.map(s=>s.price),alt:state.altPrices,fx:fx.usd,news:state.news.slice(0,4),eco:[state.economy.phase,state.economy.baseRate]})`);
  check('같은 게임 시각이면 모든 플레이어의 시세가 동일', sig(a) === sig(b), sig(a).length);
  check('같은 게임 시각이면 부동산·금·환율도 동일', a.run('state.altPrices.apt') === b.run('state.altPrices.apt') && a.run('fx.usd') === b.run('fx.usd'));
  check('같은 게임 시각이면 뉴스·경제도 동일', a.run('state.news[0]') === b.run('state.news[0]') && a.run('state.economy.phase') === b.run('state.economy.phase'));

  // 규칙 저장은 자동 투자를 켜지 않습니다(원치 않는 자동 매수의 원인 제거).
  const g = createGame(303);
  g.run('state.cash=50000000; state.auto.enabled=false; saveAutoSettings(); 1');
  check('규칙만 저장해도 자동 매수는 꺼짐', g.run('state.auto.enabled') === false);
  check('꺼진 상태에서는 자동 적립이 매수하지 않음', g.run('state.auto.enabled===false && autoInvest()===0'));
  g.run('saveAutoSettings(true); 1');
  check('켜기 버튼을 눌러야 자동 매수가 켜짐', g.run('state.auto.enabled') === true);
  g.run('state.orders=[{id:"d1",stockId:"future_ai",type:"dca",side:"buy",amount:100000,every:15,lastAt:0}]; 1');
  check('자동 매수 항목이 화면에 표시됨', g.run('autoBuySources().join(",")') === '자동 투자,분할 매수' && g.run('renderAutoBadge(),$("autoBadge").style.display') === 'block');
  const stopped = g.run('(()=>{ const ok=quickDisableAuto(); return {ok, auto:state.auto.enabled, orders:state.orders.length, label:document.getElementById("autoBadge").style.display}; })()');
  check('자동 매수 한 번에 끄기', stopped.ok === true && stopped.auto === false && stopped.orders === 0 && stopped.label === 'none', JSON.stringify(stopped));
}

// ── 세이브 리바이전·충돌 판단 ─────────────────
{
  const g = createGame(41);
  const rev = g.run(`(()=>{ const a=saveRevision(); saveGame(); const b=saveRevision(); saveGame(); return {a,b,c:saveRevision(), savedAt:state.savedAt>0}; })()`);
  check('저장할 때마다 리바이전 증가', rev.b === rev.a + 1 && rev.c === rev.a + 2 && rev.savedAt === true, JSON.stringify(rev));

  const cf = g.run(`(()=>{
    const remote={save:{state:{}}, score:500, revision:7, savedAt:123};
    return {same: cloudConflictInfo(3,7,remote), diff: cloudConflictInfo(3,6,remote), none: cloudConflictInfo(3,7,null), first: cloudConflictInfo(3,null,remote), noSave: cloudConflictInfo(3,6,{revision:9})};
  })()`);
  check('같은 리바이전이면 충돌 아님', cf.same === null);
  check('다른 리바이전이면 충돌로 판단', !!cf.diff && cf.diff.remoteRev === 7 && cf.diff.remoteScore === 500, JSON.stringify(cf.diff));
  check('클라우드 기록이 없으면 충돌 아님', cf.none === null && cf.noSave === null);
  check('처음 보는 클라우드도 충돌 정보를 돌려줌', !!cf.first && cf.first.remoteRev === 7);

  const old = g.run(`(()=>{
    const legacy={state:{cash:1234567, logs:[]}}; // version 필드가 없던 예전 세이브
    const migrated=migrateSaveData(JSON.parse(JSON.stringify(legacy)));
    applySaveData(migrated);
    return {version:migrated.version, rev:state.revision, savedAt:state.savedAt, cash:Math.round(state.cash), nan:!isFinite(state.cash)};
  })()`);
  check('예전 세이브(버전 없음)도 그대로 열림', old.version === 4 && old.cash === 1234567 && old.nan === false, JSON.stringify(old));
  check('예전 세이브의 리바이전은 0으로 보정', old.rev === 0 && old.savedAt >= 0);
  check('저장 데이터에 리바이전·저장 시각 포함', g.run('(()=>{ const d=buildSaveData(); saveGame(); return typeof d.state.revision==="number" && typeof d.state.savedAt==="number"; })()') === true);

  const box = g.run(`(()=>{ const before=fbConflictHtml(); fbConflict={remoteRev:9, localRev:4, remoteScore:777000, remoteAt:Date.now(), save:{state:{}}}; const after=fbConflictHtml(); fbConflict=null; return {before, after}; })()`);
  check('충돌이 없으면 안내 없음', box.before === '');
  check('충돌 시 두 기록과 선택 버튼 표시', box.after.includes('클라우드 불러오기') && box.after.includes('이 기기로 덮어쓰기') && box.after.includes('777,000'), box.after.slice(0, 60));
}

// ── 오프라인 시세 재생 ─────────────────────
{
  const g = createGame(51);
  const r = g.run(`(()=>{
    stocks.forEach(s=>{s.price=s.start; s.own=0}); state.cash=10000000; products.forEach(p=>{p.amount=0;p.rate=0}); state.loan=0;
    const before=stocks.map(s=>s.price), logsBefore=state.logs.length, secBefore=state.marketSeconds;
    state.lastSeen=Date.now()-3600*1000;
    const out=applyOfflineProgress();
    const changed=stocks.filter((s,i)=>s.price!==before[i]).length;
    return {changed, hasMarket:!!(out&&out.market), sec:out&&out.sec, advanced:state.marketSeconds-secBefore, flag:OFFLINE_REPLAY, logs:state.logs.length-logsBefore, open:state.marketOpen};
  })()`);
  check('오프라인 동안 시세가 실제로 변동', r.changed > 0, r.changed);
  check('오프라인 정산이 시장 요약을 포함', r.hasMarket === true && r.sec > 0);
  check('게임 시각이 오프라인 시간만큼 진행', r.advanced === r.sec, `${r.advanced}/${r.sec}`);
  check('재생 중 로그가 쏟아지지 않음', r.logs <= 1, r.logs);
  check('재생 후 플래그 해제·장 상태 복원', r.flag === false && typeof r.open === 'boolean');

  // 같은 시간을 "온라인으로 진행"한 것과 "오프라인 재생"한 결과가 같아야 합니다.
  const a = createGame(61), b = createGame(62);
  const setup = `stocks.forEach(s=>{s.price=s.start; s.own=0}); products.forEach(p=>{p.amount=0;p.rate=0}); state.cash=10000000; state.marketSeconds=0; 1`;
  a.run(setup); b.run(setup);
  a.run(`(()=>{ for(let i=1;i<=3600;i++){ state.marketSeconds++; if(state.marketSeconds%15===0) tickAlt(); if(state.marketSeconds%5===0){ tickMarket(); updateFX(); } if(state.marketSeconds%7===0) marketEventsAndNews(); } return 1; })()`);
  b.run('replayOfflineMarket(3600)');
  check('오프라인 재생 결과 = 온라인 진행 결과', a.run('JSON.stringify(stocks.map(s=>s.price))') === b.run('JSON.stringify(stocks.map(s=>s.price))'));
  check('오프라인 재생도 환율·부동산에 동일하게 반영', a.run('fx.usd') === b.run('fx.usd') && a.run('JSON.stringify(state.altPrices)') === b.run('JSON.stringify(state.altPrices)'));
}

// ── 관측성(오류·이벤트 기록) ─────────────────
{
  const g = createGame(71);
  const t = g.run(`(()=>{
    diagCache=null; localStorage.removeItem('money_playground_diag');
    trackEvent('app_open'); trackEvent('app_open'); trackEvent('first_trade',{a:1});
    logError('test',{message:'boom',code:'x/y'});
    const d=diagState();
    const stored=JSON.parse(localStorage.getItem('money_playground_diag')||'{}');
    return {open:d.events.app_open, trade:d.events.first_trade, errs:d.errors.length, code:d.errors[0].code, stored:stored.events&&stored.events.app_open, ga:gaId()};
  })()`);
  check('퍼널 이벤트가 누적 집계됨', t.open === 2 && t.trade === 1, JSON.stringify(t));
  check('이벤트가 localStorage에 저장됨', t.stored === 2);
  check('오류가 코드와 함께 기록됨', t.errs === 1 && t.code === 'x/y');
  check('GA4 설정이 없으면 전송하지 않음', t.ga === '');
  const bounded = g.run(`(()=>{ for(let i=0;i<40;i++) logError('loop',{message:'e'+i}); return diagState().errors.length; })()`);
  check('오류 기록은 최대 30건까지만 보관', bounded === 30, bounded);
  const panel = g.run('(()=>{ const h=diagPanelHtml(); return {h, txt:diagText()}; })()');
  check('설정 화면에 진단 패널 표시', panel.h.includes('기록된 오류') && panel.h.includes('GA4') && panel.h.includes('진단 정보 복사'));
  check('진단 텍스트에 버전·이벤트 포함', panel.txt.includes('앱 버전') && panel.txt.includes('event app_open'), panel.txt.slice(0, 60));
  const cleared = g.run(`(()=>{ diagClear(); const d=diagState(); return {e:d.errors.length, n:Object.keys(d.events).length}; })()`);
  check('진단 기록 지우기', cleared.e === 0 && cleared.n === 0);
}

// ── 온보딩 · 점진적 해금 ─────────────────────────
{
  const g = createGame(81);
  const d0 = g.run(`(()=>{ state.cash=0; state.peakNet=0; return {rebirth:isPageLocked('rebirth'), settings:isPageLocked('settings'), tax:isPageLocked('tax'), nav:document.getElementById('nav').innerHTML||''}; })()`);
  check('처음에는 환생·세금 화면이 잠금', d0.rebirth === true && d0.tax === true && d0.settings === false);
  const gated = g.run(`(()=>{ show('rebirth'); return {modal:document.getElementById('modalRoot').innerHTML||'', page:document.getElementById('rebirth').innerHTML||''}; })()`);
  check('잠긴 화면은 안내 창을 열고 이동하지 않음', gated.modal.includes('아직 잠겨') && !gated.page.includes('영구 업그레이드'), gated.modal.slice(0, 40));
  const unlocked = g.run(`(()=>{ state.cash=120000000; state.peakNet=120000000; show('rebirth'); return {locked:isPageLocked('rebirth'), page:(document.getElementById('rebirth').innerHTML||'').includes('영구 업그레이드')}; })()`);
  check('기준을 넘으면 잠금 해제·화면 표시', unlocked.locked === false && unlocked.page === true);

  const ob = g.run(`(()=>{
    state.onboard={done:false,dismissed:false,seen:{},firstTrade:false};
    const before=onboardPanelHtml();
    state.labor.shifts=1;
    const after=onboardPanelHtml();
    return {before, after, done:state.onboard.done};
  })()`);
  check('대시보드에 첫 걸음 체크리스트 표시', ob.before.includes('첫 걸음 0/3') && ob.before.includes('노동으로 첫 급여'));
  check('목표를 이루면 체크 표시', ob.after.includes('첫 걸음 1/3') && ob.after.includes('✅'), ob.after.slice(0, 60));
  const all = g.run(`(()=>{ state.labor.shifts=1; state.onboard.firstTrade=true; products[0].amount=1000; const h=onboardPanelHtml(); return {done:state.onboard.done, h}; })()`);
  check('세 단계 모두 끝나면 온보딩 완료 처리', all.done === true && all.h.includes('첫 걸음 3/3'));
  const hidden = g.run(`(()=>{ dismissOnboard(); return onboardPanelHtml(); })()`);
  check('온보딩 숨기기', hidden === '');
  const un = g.run(`(()=>{ unlockCheckAt=0; state.cash=120000000; state.peakNet=120000000; state.onboard={done:false,dismissed:false,seen:{},firstTrade:false}; checkUnlocks(); return {seen:state.onboard.seen, alerts:(state.alerts||[]).filter(a=>a.title==='새 기능 해금').length}; })()`);
  check('해금 시 한 번만 알림', un.seen.rebirth === true && un.alerts === 1, JSON.stringify(un));
  const legacy = g.run(`(()=>{ const d=migrateSaveData({state:{cash:100}}); applySaveData(d); return {onboard:!!state.onboard, dismissed:state.onboard.dismissed}; })()`);
  check('예전 세이브에도 온보딩 기본값 생성', legacy.onboard === true && legacy.dismissed === false);
}

// ── 클라우드 백업 주기 · 잠금 경로 · 관리자 계정 ───────────────
{
  const g = createGame(91);
  const snap = g.run(`(()=>{
    const now=Date.now();
    return {
      due:  fbShouldSnapshot(1000000,{at:now-11*60*1000, score:1000000}),
      soon: fbShouldSnapshot(1050000,{at:now-60*1000,    score:1000000}),
      jump: fbShouldSnapshot(1200000,{at:now-60*1000,    score:1000000}),
      drop: fbShouldSnapshot(  850000,{at:now-60*1000,    score:1000000}),
      empty: fbShouldSnapshot(0,{at:now-60*1000, score:0}),
      first: fbShouldSnapshot(5000,null)
    };
  })()`);
  check('10분이 지나면 백업', snap.due === true);
  check('10분 안이고 변화가 작으면 백업 안 함', snap.soon === false, JSON.stringify(snap));
  check('자산이 크게 늘거나 줄면 바로 백업', snap.jump === true && snap.drop === true);
  check('백업이 하나도 없으면 처음 한 번은 남김', snap.first === true && snap.empty === false);

  const nav = g.run(`(()=>{
    state.cash=0; state.peakNet=0;
    const before=document.getElementById('rebirth').innerHTML||'';
    quickNav('rebirth');
    const gated={page:document.getElementById('rebirth').innerHTML||'', modal:document.getElementById('modalRoot').innerHTML||''};
    goPage('rebirth', true);
    const forced=(document.getElementById('rebirth').innerHTML||'').includes('영구 업그레이드');
    return {before, gated, forced};
  })()`);
  check('quickNav도 잠금 검사를 거침', nav.gated.modal.includes('아직 잠겨') && !nav.gated.page.includes('영구 업그레이드'), nav.gated.modal.slice(0, 40));
  check('내부 이동(force)은 잠금을 건너뜀', nav.forced === true);

  const admin = g.run(`(()=>{
    const a={upper:isAdminEmail('SOUNDPSB1@Gmail.com'), space:isAdminEmail('  26007@changshin.ms.kr '), no:isAdminEmail('x@y.com'), empty:isAdminEmail('')};
    fbUser={uid:'u',displayName:'관리자',email:'soundpsb1@gmail.com'};
    const on=isAdminUser();
    fbUser={uid:'u2',displayName:'일반',email:'user@example.com'};
    const off=isAdminUser();
    fbUser=null;
    return {a,on,off,list:ADMIN_EMAILS.length};
  })()`);
  check('관리자 이메일 비교(대소문자·공백 무시)', admin.a.upper === true && admin.a.space === true && admin.a.no === false && admin.a.empty === false, JSON.stringify(admin.a));
  check('관리자 계정 두 개 등록', admin.list === 2 && admin.on === true && admin.off === false);
  const badge = g.run(`(()=>{
    const keep=FIREBASE_CONFIG; FIREBASE_CONFIG={apiKey:'k',projectId:'p',appId:'a'};
    fbUser={uid:'u',displayName:'관리자',email:'26007@changshin.ms.kr'}; state.settings.cloudAuto=true;
    const h=firebasePanelHtml(), d=diagPanelHtml();
    fbUser=null; FIREBASE_CONFIG=keep;
    return {h,d};
  })()`);
  check('관리자로 로그인하면 배지·계정 표시', badge.h.includes('관리자') && badge.d.includes('관리자 계정'), badge.h.slice(0, 80));
}

console.log('');
console.log(`== ${pass}/${pass + fail} passed ==`);
process.exit(fail ? 1 : 0);
