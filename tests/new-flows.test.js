#!/usr/bin/env node
/**
 * 새 흐름 회귀 테스트: 상단 자산 순서 · 자동 현금 수익 표시·수령 설정 · 종목 상세 ·
 * 자산 추이 호버 · 은행 이율 안내 · 세금 원장 · 튜토리얼 · 리더보드 ·
 * 리서치 기억 게임 · 관리자 UID 검사.
 * 실행: node tests/new-flows.test.js
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
  return {
    id, value: '', textContent: '', innerHTML: '', disabled: false, className: '', style: {}, checked: false,
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    appendChild(child) { child.parentNode = this; (this.children || (this.children = [])).push(child); },
    removeChild(child) { const i = (this.children || []).indexOf(child); if (i >= 0) this.children.splice(i, 1); },
    setAttribute(k, v) { this[k] = v; },
    getAttribute(k) { return this[k] == null ? null : this[k]; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    getBoundingClientRect() { return { width: 0, height: 0, left: 0, top: 0 }; }
  };
}
function createGame() {
  const elements = new Map();
  const el = id => { if (!elements.has(id)) elements.set(id, makeElement(id)); return elements.get(id); };
  const body = makeElement('body');
  const document = {
    visibilityState: 'visible',
    getElementById: el,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: id => { const node = makeElement(id || 'div'); if (id) elements.set(id, node); return node; },
    body,
    documentElement: {},
    addEventListener() {}
  };
  const store = {};
  const ctx = {
    console, Math, Date, JSON, Number, isFinite, Intl, Promise,
    setTimeout: () => 0, setInterval: () => 0, clearInterval: () => 0, clearTimeout: () => 0,
    alert: () => {}, confirm: () => true, document,
    localStorage: {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: k => { delete store[k]; }
    },
    window: { addEventListener() {}, location: { hostname: 'test.local' } },
    navigator: {}
  };
  vm.createContext(ctx);
  vm.runInContext(source, ctx, { filename: 'index.html#script' });
  const run = code => vm.runInContext(code, ctx);
  run('clearGame(true); state.marketOpen=true; state.settings.confirmTrades=false; state.savedAt=0; 1');
  return { run, el, ctx };
}

// ── 상단 자산 바: 정확히 12개, 사용자가 지정한 순서 ──────────────
{
  const stats = /<section class="stats"[\s\S]*?<\/section>/.exec(html)[0];
  const labels = [...stats.matchAll(/<div class="box"><small>([\s\S]*?)<\/small>/g)].map(m => m[1].replace(/<[^>]+>/g, '').trim());
  const expected = ['현금 (원화)', '달러 평가액', '주식 평가액', '금융상품 평가액', '부동산 평가액', '실물자산 (금·은)', '기업 가치', '대출 부채', '채권 평가액', '공매도 평가손익', '누적 납부 세금', '순자산 (총자산)'];
  check('상단 자산 바는 12개', (stats.match(/<div class="box">/g) || []).length === 12, (stats.match(/<div class="box">/g) || []).length);
  check('상단 자산 바 순서가 지정값과 일치', labels.join('|') === expected.join('|'), labels.join(' | '));

  const g = createGame();
  g.run(`clearGame(true); state.cash=0; state.usd=0; state.loan=10000000; state.loanRate=.12;
    products.forEach(p=>{p.amount=0}); product('deposit').amount=50000000;
    state.estate={}; state.metals={gold:{qty:0,avg:0},silver:{qty:0,avg:0}}; state.company=null;
    state.bonds={qty:0,avg:0}; state.shorts=[]; state.taxPaid=330000; update(); 1`);
  const text = g.run(`({
    cash:document.getElementById('cash').textContent,
    product:document.getElementById('productValueTop').textContent,
    debt:document.getElementById('debtValueTop').textContent,
    net:document.getElementById('totalValue').textContent,
    gross:document.getElementById('grossValueTop').textContent,
    tax:document.getElementById('taxValueTop').textContent
  })`);
  check('상단 12번째 카드가 순자산', text.net === g.run('won(40000000)'), text.net);
  check('순자산 카드 아래 총자산 보조 표시', text.gross === g.run('"총자산 "+won(50000000)'), text.gross);
  check('상단 부채·세금 표시 유지', text.debt === g.run('won(10000000)') && text.tax === g.run('won(330000)'), JSON.stringify(text));
}

// ── 자동 현금 수익: 채권 이자를 숨기지 않고 표시 ─────────────────
{
  const g = createGame();
  const idle = g.run(`(()=>{
    products.forEach(p=>{p.amount=0;p.rate=0});
    state.bonds={qty:0,avg:0}; state.company=null; state.estate={}; state.loan=0; state.cash=1000000;
    state.marketSeconds=15; const before=state.cash; interest(); return state.cash-before;
  })()`);
  check('자동 수익 자산이 없으면 무활동 현금 불변', idle === 0, idle);

  const bond = g.run(`(()=>{
    products.forEach(p=>{p.amount=0;p.rate=0});
    state.bonds={qty:1,avg:100000}; state.company=null; state.estate={}; state.loan=0; state.cash=0;
    state.logs=[]; state.marketSeconds=60;
    const flow=cashFlowSummary(); interest();
    return {cash:state.cash,flow,log:state.logs[0]||''};
  })()`);
  check('채권 이자가 현금으로 지급', Math.abs(bond.cash - 54) < 1e-9, bond.cash);
  check('현금 카드에 자동 수익 출처 표시', bond.flow.text.includes('자동 수익') && bond.flow.title.includes('채권 이자'), bond.flow.text);
  check('채권 이자 지급이 로그에 기록', bond.log.includes('채권 이자') && bond.log.includes('15초마다'), bond.log);

  const company = g.run(`(()=>{
    clearGame(true); state.cash=0; state.bonds={qty:0,avg:0}; state.estate={};
    products.forEach(p=>{p.amount=0;p.rate=0});
    state.company={name:'테스트기업',level:1,valuation:50000000,book:50000000,revenue:2000000,profit:1000000,payout:.5,upkeep:0,risk:0};
    state.marketSeconds=30; state.rewardedGrade=gradeIndex(currentGrade());
    state.special=Object.fromEntries(SPECIAL_MISSIONS.map(m=>[m.id,true]));
    const flow=cashFlowSummary(); state.logs=[]; tickAlt();
    return {flow,cash:state.cash,log:state.logs.find(x=>x.includes('기업 배당'))||''};
  })()`);
  check('기업 배당도 자동 수익 출처에 표시', company.flow.text.includes('자동 수익') && company.flow.title.includes('기업 배당') && company.flow.title.includes('30초마다'), company.flow.title);
  check('기업 배당 지급이 로그에 기록', company.cash === 500000 && company.log.includes('기업 배당'), `${company.cash}/${company.log}`);

  const none = g.run(`(()=>{ state.bonds={qty:0,avg:0}; state.company=null; state.estate={}; products.forEach(p=>p.amount=0); return cashFlowSummary().text; })()`);
  check('자동 수익이 없으면 없다고 표시', none === '자동 수익 없음', none);
}

// ── 자산 추이 그래프: 포인터 위치의 당시 자산액 ─────────────────
{
  const g = createGame();
  g.run(`assetHistory.points=[{t:0,v:10000000},{t:600,v:20000000},{t:1200,v:15000000}]; 1`);
  const point = g.run('assetTrendPointAt(.5)');
  check('그래프 중간 위치의 자산액', point.value === 20000000 && point.index === 1, JSON.stringify(point));
  check('그래프 시점 라벨', g.run('assetTrendTimeLabel(assetHistory.points[1])') === '2일차 · 0초', g.run('assetTrendTimeLabel(assetHistory.points[1])'));
  const svg = g.run('assetTrendSVG()');
  check('그래프에 호버 이벤트·툴팁 포함', svg.includes('onpointermove="assetTrendHover(event)"') && svg.includes('trend-tip') && svg.includes('trend-guide'), svg.slice(0, 120));

  const hover = g.run(`(()=>{
    const tip={innerHTML:'',style:{},classList:{on:false,add(){this.on=true},remove(){this.on=false}}};
    const guide={style:{},setAttribute(k,v){this[k]=v}};
    const dot={style:{},setAttribute(k,v){this[k]=v}};
    const chart={querySelector(s){return s==='svg'?{getBoundingClientRect:()=>({left:0,width:600})}:s==='.trend-tip'?tip:s==='.trend-guide'?guide:s==='.trend-dot'?dot:null},querySelectorAll(){return [guide,dot]}};
    assetTrendHover({currentTarget:chart,clientX:300});
    return {html:tip.innerHTML,on:tip.classList.on,left:tip.style.left,guide:guide.x1,dot:dot.cy};
  })()`);
  check('그래프 호버 시 당시 자산액·시각 툴팁', hover.html.includes(g.run('won(20000000)')) && hover.html.includes('2일차') && hover.on === true, hover.html);
  check('그래프 호버 가이드·점 표시', hover.guide === '300.0' && hover.dot > 0, `${hover.guide}/${hover.dot}`);
}

// ── 은행 이율 안내와 가입 시 확정 이율 ───────────────────────────
{
  const g = createGame();
  const page = g.run('banking(); document.getElementById("banking").innerHTML');
  check('은행 안내에 실제 예상 연이율 설명', page.includes('실제 예상 연이율') && page.includes('기본 +16%'));
  check('은행 안내가 16% 수익률 오해를 바로잡음', page.includes('예금 수익률 자체가 16%') && page.includes('현재 등급 연'));

  const bank = g.run(`(()=>{
    const p=product('deposit');
    const base=bankRateForProduct(p,BANKS[0]);
    const jeil=bankRateForProduct(p,BANKS[2]);
    return {base,jeil,option:bankOptionLabel(p,BANKS[2]),preview:bankPreviewText(p,BANKS[2]),sub:productSubText(p,true,false)};
  })()`);
  check('은행별 실제 이율이 기본 이율보다 높음', bank.jeil > bank.base && bank.jeil > 0, `${bank.base}→${bank.jeil}`);
  check('은행 옵션에 연이율·+16% 보너스 표시', /연 \d+\.\d+%/.test(bank.option) && bank.option.includes('기본 +16%'), bank.option);
  check('은행 미리보기에 선택 시 예상 연이율 표시', bank.preview.includes('선택 시 예상 연') && bank.preview.includes('가입 시 확정'), bank.preview);
  check('상품 카드 부제에 현재 등급 연이율 표시', bank.sub.includes('현재 등급 연'), bank.sub);

  const joined = g.run(`(()=>{
    clearGame(true); state.cash=100000000; state.economy.rateAdj=0;
    products.forEach(p=>{p.amount=0;p.rate=0;p.bank=null;p.startedAt=null;p.matured=false});
    document.getElementById('prod-deposit').value='1000000';
    document.getElementById('bank-deposit').value='jeil';
    join('deposit');
    const p=product('deposit');
    return {bank:p.bank,rate:p.rate,expected:bankRateForProduct(p,BANKS[2]),log:(state.logs[0]||'')};
  })()`);
  check('가입 시 선택 은행과 확정 이율 저장', joined.bank === 'jeil' && Math.abs(joined.rate - joined.expected) < 1e-12, `${joined.bank}/${joined.rate}`);
  check('가입 로그에 은행·확정 연이율 기록', joined.log.includes('제일은행') && joined.log.includes('확정 연'), joined.log);
}

// ── 세금 원장: 거래세·양도세 기록과 80건 제한 ───────────────────
{
  const g = createGame();
  const trade = g.run(`(()=>{
    clearGame(true); state.cash=10000000; state.marketOpen=true; state.settings.confirmTrades=false;
    state.achievements=Object.fromEntries(ACHIEVEMENTS.map(a=>[a.id,true]));
    stock('future_ai').price=100000; stock('future_ai').start=100000;
    document.getElementById('qty-future_ai-domestic').value='1';
    buy('future_ai'); sell('future_ai');
    return {rows:state.taxLedger.slice(),paid:state.tradeTaxPaid,html:taxLedgerHtml()};
  })()`);
  const tradeRow = trade.rows.find(r => r.kind === 'trade');
  check('매도 거래세가 세금 원장에 기록', !!tradeRow && tradeRow.tax > 0 && tradeRow.note.includes('매도'), JSON.stringify(tradeRow));
  check('거래세 누적액과 원장 합계 표시', trade.paid > 0 && trade.html.includes('증권거래세') && trade.html.includes('원장 합계'));
  check('세금 화면에 납부 원장 섹션', g.run('taxPanelHtml()').includes('세금 납부 원장'));

  const general = g.run(`(()=>{
    state.cash=10000000; state.realizedYTD=0; state.taxedProfit=0; state.taxPaid=0; state.taxLedger=[];
    state.tax={mode:'general',carryLoss:0,carryLossBase:0,pensionDeferred:0,isaGains:0,isaTaxed:0,contributions:{general:0,isa:0,pension:0},taxPaidByAccount:{general:0,isa:0,pension:0},year:1,yearStart:0};
    settleTax(3000000);
    return {rows:state.taxLedger.slice(),paid:state.taxPaid,html:taxLedgerHtml()};
  })()`);
  check('일반 양도세가 원장에 과세표준·세율과 함께 기록', general.rows.length === 1 && general.rows[0].kind === 'general' && general.rows[0].base === 500000 && general.rows[0].rate === .22, JSON.stringify(general.rows[0]));
  check('원장에 납부 세금·계좌 표시', general.html.includes('일반 양도세') && general.html.includes('일반') && general.paid === 110000, general.paid);

  const cap = g.run(`(()=>{ state.taxLedger=[]; for(let i=0;i<90;i++) recordTaxLedger({kind:'general',label:'테스트',tax:1}); return state.taxLedger.length; })()`);
  check('세금 원장은 최근 80건까지만 보관', cap === 80, cap);
}

// ── 튜토리얼: 5단계·완료 저장·재시작 ─────────────────────────────
{
  const g = createGame();
  const steps = g.run('TUTORIAL_STEPS.map(s=>({page:s.page,title:s.title}))');
  check('튜토리얼은 5단계', steps.length === 5, steps.length);
  check('튜토리얼에 은행·리더보드·설정 포함', ['banking', 'leaderboard', 'settings'].every(p => steps.some(s => s.page === p)), steps.map(s => s.page).join(','));

  const flow = g.run(`(()=>{
    state.onboard={done:false,dismissed:false,seen:{},unlocked:{},firstTrade:false,tutorialDone:false};
    startTutorial(true);
    const first={active:tutorialActive,step:tutorialStep,title:(document.getElementById('tutorialRoot').innerHTML||'')};
    tutorialNext(); tutorialNext(); tutorialNext(); tutorialNext();
    const last={step:tutorialStep,active:tutorialActive};
    finishTutorial();
    return {first,last,done:state.onboard.tutorialDone,active:tutorialActive};
  })()`);
  check('튜토리얼 시작 시 첫 단계 표시', flow.first.active === true && flow.first.step === 0 && flow.first.title.includes('노동으로 첫 돈 벌기'), flow.first.step);
  check('튜토리얼 다음으로 마지막 단계 이동', flow.last.step === 4 && flow.last.active === true, flow.last.step);
  check('튜토리얼 완료 상태 저장', flow.done === true && flow.active === false, `${flow.done}/${flow.active}`);

  const again = g.run(`(()=>{ startTutorialIfNeeded(); return tutorialActive; })()`);
  check('완료한 튜토리얼은 자동으로 다시 뜨지 않음', again === false, again);
  const skip = g.run(`(()=>{ state.onboard.tutorialDone=false; startTutorial(true); skipTutorial(); return {done:state.onboard.tutorialDone,active:tutorialActive}; })()`);
  check('건너뛰기도 완료로 저장', skip.done === true && skip.active === false, JSON.stringify(skip));
}

// ── 리더보드 화면과 내비게이션 ───────────────────────────────────
{
  const g = createGame();
  const page = g.run(`(()=>{
    state.cloud=Object.assign({},state.cloud,{nickname:'테스터',rank:3});
    leaderboardPage();
    nav();
    return {html:document.getElementById('leaderboard').innerHTML,nav:document.getElementById('nav').innerHTML,season:seasonKey()};
  })()`);
  check('리더보드 페이지에 월간 순위·내 기록 표시', page.html.includes('리더보드') && page.html.includes('월간 순위') && page.html.includes('내 기록'), page.html.length);
  check('리더보드에 시즌·닉네임·순위 표시', page.html.includes(page.season) && page.html.includes('테스터') && page.html.includes('3위'));
  check('리더보드 미연결 안내 표시', page.html.includes('아직 리더보드가 연결되지 않았습니다'));
  check('사이드바 리더보드 내비게이션', page.nav.includes('data-page="leaderboard"') && page.nav.includes('리더보드') && html.includes('data-page="leaderboard"'), page.nav.slice(0, 120));
}

// ── 리서치 보조 기억 게임: 표시 시간과 입력 판정 ─────────────────
{
  const g = createGame();
  check('기억 게임 표시 시간은 4개부터 충분함', g.run('laborMemoryShowMs([1,2,3,4])') >= 2000, g.run('laborMemoryShowMs([1,2,3,4])'));
  check('순서가 길수록 표시 시간이 늘어남', g.run('laborMemoryShowMs([1,2,3,4,5,6])') > g.run('laborMemoryShowMs([1,2,3,4])'));
  const correct = g.run(`(()=>{
    laborSession={job:laborJob('research'),mode:'memory',round:0,results:[],paid:false,accepting:true,phase:'input',seq:['🍎','🍋'],icons:['🍎','🍋','🍇'],input:[],mistakes:0};
    laborMemoryClick(0); const mid=laborSession.input.length;
    laborMemoryClick(1); const out={mid,round:laborSession.round,grade:laborSession.results[0]&&laborSession.results[0].grade};
    laborAbortShift(true); return out;
  })()`);
  check('기억 게임 정답 입력 진행', correct.mid === 1 && correct.round === 1 && correct.grade === 'perfect', JSON.stringify(correct));
  const wrong = g.run(`(()=>{
    laborSession={job:laborJob('research'),mode:'memory',round:0,results:[],paid:false,accepting:true,phase:'input',seq:['🍎','🍋'],icons:['🍎','🍋','🍇'],input:[],mistakes:0};
    laborMemoryClick(1); const one=laborSession.mistakes;
    laborMemoryClick(1); const out={one,grade:laborSession.results[0]&&laborSession.results[0].grade};
    laborAbortShift(true); return out;
  })()`);
  check('기억 게임 두 번 틀리면 실패', wrong.one === 1 && wrong.grade === 'miss', JSON.stringify(wrong));
  check('기억 게임 안내에 순서 개수·시간 표시', g.run("laborGameHtml(laborJob('research')).includes('순서를 기억하세요')") === true);
}

// ── 관리자 전체 목록은 오프라인 사용자도 조회 ────────────────────
{
  const g = createGame();
  const panel = g.run(`(()=>{
    const now=Date.now();
    fbUser={uid:'admin',email:'soundpsb1@gmail.com',displayName:'관리자'};
    fbAdminUsers=[{uid:'off1',nickname:'오프라인',email:'off@x.com',online:false,lastSeen:now-10000}];
    return fbAdminPanelHtml();
  })()`);
  check('관리자 패널이 오프라인 사용자 표시', panel.includes('off@x.com') && panel.includes('오프라인'));
  check('관리자 패널에 UID 직접 입력 제공', panel.includes('admin-reset-uid') && panel.includes('adminResetByUid()'));
}

// ── 자동 수익: 즉시 지급 · 모아 받기 · 받지 않음 ──────────────────
{
  const g = createGame();
  const setup = `(()=>{
    clearGame(true); state.cash=0; state.usd=0; state.bonds={qty:0,avg:0}; state.estate={};
    products.forEach(p=>{p.amount=0;p.rate=0});
    state.company={name:'테스트기업',level:1,valuation:50000000,book:50000000,revenue:2000000,profit:1000000,payout:.5,upkeep:200000,risk:0};
    state.marketSeconds=30; state.rewardedGrade=gradeIndex(currentGrade());
    state.special=Object.fromEntries(SPECIAL_MISSIONS.map(m=>[m.id,true]));
  })()`;

  const auto = g.run(setup + `;(()=>{
    const flow=cashFlowSummary(); tickAlt();
    return {mode:autoIncomeMode(),cash:state.cash,pending:ensureAutoIncome().pending,flow};
  })()`);
  check('자동 수익 기본 설정은 즉시 지급', auto.mode === 'auto', auto.mode);
  check('자동 지급이면 현금이 바로 늘어남', auto.cash === 300000 && auto.pending === 0, `${auto.cash}/${auto.pending}`);
  check('자동 수익 표시에 기업 유지비가 순액으로 반영', auto.flow.parts.some(p => p.label === '기업 유지비' && p.per15 < 0), JSON.stringify(auto.flow.parts));
  check('자동 수익 15초 평균이 실제 지급액과 일치', Math.abs(auto.flow.per15 - (500000 - 200000) / 2) < 1e-9, auto.flow.per15);
  check('자동 수익 표시가 유지비를 뺀 순액임', auto.flow.text.includes('자동 수익') && Math.abs(auto.flow.per15 - 150000) < 1e-9, auto.flow.text);

  const manual = g.run(setup + `;(()=>{
    setAutoIncomeMode('manual');
    state.logs=[]; tickAlt();
    const before=state.cash, pending=ensureAutoIncome().pending, text=cashFlowSummary().text;
    update(); const collectShown=document.getElementById('cashCollect').style.display;
    const collected=collectAutoIncome();
    return {before,pending,text,collected,after:state.cash,left:ensureAutoIncome().pending,collectShown,log:state.logs.find(l=>l.includes('모아 둔'))||''};
  })()`);
  check('모아 받기 설정이면 현금 대신 대기액에 쌓음', manual.before === 0 && manual.pending === 500000, `${manual.before}/${manual.pending}`);
  check('모아 받기 중 현금 카드에 대기액 표시', manual.text.includes('모아 둔') && manual.text.includes('500,000'), manual.text);
  check('모아 둔 금액이 있으면 받기 버튼 표시', manual.collectShown !== 'none', manual.collectShown);
  check('모아 받기 버튼이 대기액을 현금으로 이동', manual.collected === 500000 && manual.after === 500000 && manual.left === 0, `${manual.collected}/${manual.after}/${manual.left}`);
  check('모아 받은 수익이 로그에 기록', manual.log.includes('모아 둔 자동 수익'), manual.log);

  const off = g.run(setup + `;(()=>{
    setAutoIncomeMode('off'); state.marketSeconds=60; tickAlt();
    return {cash:state.cash,pending:ensureAutoIncome().pending,skipped:ensureAutoIncome().skipped,text:cashFlowSummary().text};
  })()`);
  check('받지 않음이면 자동 수익이 현금에 들어오지 않음', off.cash === 0 && off.pending === 0 && off.skipped === 500000, JSON.stringify(off));
  check('받지 않음 상태를 현금 카드에 표시', off.text.includes('자동 수익 꺼짐'), off.text);

  const dividend = g.run(`(()=>{
    clearGame(true); state.cash=0; state.usd=0;
    state.autoIncome={mode:'manual',pending:0,detail:{},skipped:0};
    stocks.forEach(s=>{s.own=0});
    const s=stock('future_ai'); s.own=10; s.price=100000; payDividends();
    return {cash:state.cash,usd:state.usd,pending:ensureAutoIncome().pending,log:(state.logs[0]||'')};
  })()`);
  check('주식 배당도 모아 받기 대상', dividend.cash === 0 && dividend.pending === 1000, JSON.stringify(dividend));
  check('모아 받는 배당은 지급 알림 대신 발생 로그', dividend.log.includes('배당금 발생') && dividend.log.includes('모아 둠'), dividend.log);

  const skippedDividend = g.run(`(()=>{
    setAutoIncomeMode('off'); const before=state.dividendTotal;
    stocks.forEach(s=>{s.own=0}); stock('future_ai').own=1; stock('future_ai').price=100000;
    payDividends(); return state.dividendTotal-before;
  })()`);
  check('받지 않은 배당은 누적 배당에 포함되지 않음', skippedDividend === 0, skippedDividend);
  g.run("setAutoIncomeMode('manual'); 1");

  const foreign = g.run(`(()=>{
    stocks.forEach(x=>{x.own=0});
    const s=stocks.find(x=>isForeignStock(x)); s.own=1; s.price=100;
    const before=ensureAutoIncome().pending; payDividends();
    return {gain:ensureAutoIncome().pending-before,usd:state.usd,expected:100*1*DIVIDEND_YIELD*fx.usd};
  })()`);
  check('해외 주식 배당도 원화 대기액으로 환산', Math.abs(foreign.gain - foreign.expected) < 1e-6 && foreign.usd === 0, JSON.stringify(foreign));

  const offline = g.run(`(()=>{
    clearGame(true); state.cash=0; state.usd=0; state.loan=0;
    state.autoIncome={mode:'manual',pending:0,detail:{},skipped:0};
    products.forEach(p=>{p.amount=0;p.rate=0});
    state.company={name:'x',level:1,valuation:10000000,book:10000000,revenue:1000000,profit:300000,payout:.3,upkeep:0,risk:0};
    stocks.forEach(s=>{s.own=0}); stock('future_ai').own=1; stock('future_ai').price=100000;
    const before=state.cash;
    offlineSettle(120,{idxBefore:marketIndex(),fxBefore:fx.usd,heldBefore:{}});
    return {cash:state.cash-before,pending:ensureAutoIncome().pending};
  })()`);
  check('오프라인 정산도 모아 받기 설정을 따름', offline.cash === 0 && offline.pending > 0, JSON.stringify(offline));

  const saved = g.run(`(()=>{
    state.autoIncome={mode:'off',pending:123,detail:{'기업 배당':123},skipped:456};
    saveGame(); state.autoIncome=null; loadGame(); return ensureAutoIncome();
  })()`);
  check('자동 수익 설정·대기액이 저장됨', saved.mode === 'off' && saved.pending === 123 && saved.skipped === 456, JSON.stringify(saved));
  check('자동 수익 설정이 설정 화면에 표시', g.run('settingsPage(); document.getElementById("settings").innerHTML').includes('자동 수익'));
}

// ── 종목 상세 정보 ──────────────────────────────────────────────
{
  const g = createGame();
  const cardHtml = g.run("card(stock('future_ai'),'domestic')");
  check('주식 카드 이름·가격을 누르면 상세 열기', (cardHtml.match(/onclick="openStockDetail\('future_ai'\)"/g) || []).length >= 2);
  check('보유 카드에서도 상세 열기', /onclick="openStockDetail\('future_ai'\)"/.test(g.run("holdingCard(stock('future_ai'))")));

  const missing = g.run("(()=>{ closeModal(); openStockDetail('no_such_stock'); return document.getElementById('modalRoot').innerHTML; })()");
  check('없는 종목은 상세를 열지 않음', missing === '', missing.slice(0, 40));

  const detail = g.run(`(()=>{
    clearGame(true);
    const s=stock('future_ai'); s.own=5; s.avgBuy=90000; s.price=100000; s.prevClose=99000; s.dayOpen=99500; s.hist=[90000,100000];
    s.taxLots=[{qty:3,price:90000,at:0,account:'general'},{qty:2,price:95000,at:0,account:'isa'}];
    openStockDetail('future_ai');
    return document.getElementById('modalRoot').innerHTML;
  })()`);
  check('주식 상세에 시세·전일 종가·차트 범위 표시', detail.includes('전일 종가') && detail.includes('시가') && detail.includes('차트 최고') && detail.includes('차트 최저'));
  check('주식 상세에 실적 표시', detail.includes('영업이익') && detail.includes('영업이익률'));
  check('주식 상세에 내 보유·계좌별 수량 표시', detail.includes('평가손익') && detail.includes('수익률') && detail.includes('ISA'));
  check('주식 상세에서 관심종목·거래 화면 이동 제공', detail.includes('관심') && detail.includes('거래 화면으로'));
}

// ── 관리자 UID 직접 입력 검사 ───────────────────────────────────
{
  const g = createGame();
  const uids = g.run(`({ok:adminUid('abc123'),email:adminUid('a@b.com'),slash:adminUid('../saves/x'),space:adminUid('a b'),long:adminUid('a'.repeat(200)),empty:adminUid('  ')})`);
  check('관리자 UID는 영숫자·-·_만 허용', uids.ok === 'abc123' && uids.email === '' && uids.slash === '' && uids.space === '' && uids.long === '' && uids.empty === '', JSON.stringify(uids));

  const email = g.run(`(()=>{
    fbUser={uid:'admin',email:'soundpsb1@gmail.com',displayName:'관리자'}; fbAdminUsers=[];
    closeModal(); document.getElementById('admin-reset-uid').value='a@b.com'; adminResetByUid();
    return document.getElementById('modalRoot').innerHTML;
  })()`);
  check('이메일 입력만으로 초기화 대상을 만들지 않음', email === '', email.slice(0, 40));

  const direct = g.run(`(()=>{
    document.getElementById('admin-reset-uid').value='u1'; adminResetByUid();
    return document.getElementById('modalRoot').innerHTML;
  })()`);
  check('목록에 없는 UID도 경고와 함께 지정', direct.includes("adminResetTarget('u1','run')") && direct.includes('목록에서 확인되지 않은 UID'), direct.slice(0, 120));

  const injection = g.run(`(()=>{ closeModal(); adminResetPrompt("u1' onmouseover='x"); return document.getElementById('modalRoot').innerHTML; })()`);
  check('UID에 따옴표·공백이 섞이면 거부', injection === '', injection.slice(0, 40));
}

// ── 조작된 저장 파일 방어(HTML 삽입·형식 검사) ──────────────────
{
  const g = createGame();

  const toast = g.run(`(()=>{ showToast('<img src=x onerror="alert(1)">','<b>본문</b>'); const w=document.getElementById('toastWrap'); return w.children[w.children.length-1].innerHTML; })()`);
  check('토스트가 HTML을 실행하지 않고 글자로 표시', toast.includes('&lt;img') && !toast.includes('<img') && toast.includes('&lt;b&gt;'), toast);

  const notif = g.run(`(()=>{
    state.alerts=[{at:0,kind:'system',title:'<img src=x onerror=1>',text:'<script>bad()</script>',read:false}];
    openNotifModal(); return document.getElementById('modalRoot').innerHTML;
  })()`);
  check('알림 센터가 알림 제목·본문을 이스케이프', notif.includes('&lt;img') && !notif.includes('<img') && !notif.includes('<script>bad'), notif.slice(0, 160));

  const logHtml = g.run(`(()=>{ state.logs=['<img src=x onerror=1>']; state.ui=Object.assign({},state.ui,{assetTab:'journal'}); portfolio(); return document.getElementById('portfolio').innerHTML; })()`);
  check('최근 거래 로그가 HTML을 실행하지 않음', logHtml.includes('&lt;img') && !logHtml.includes('<img'), logHtml.slice(0, 160));

  const loaded = g.run(`(()=>{
    clearGame(true);
    const evil={version:SAVE_VERSION,state:{cash:'<img src=x>',journal:[{name:'<img src=x>',side:'weird',qty:'5',valueKRW:'1',profit:'-2',at:'3'},{},null],alerts:[{title:'<b>t</b>',text:'<script>x</script>',at:'1'}],logs:['<img src=x>',42]}};
    localStorage.setItem(SAVE_KEY,JSON.stringify(evil)); loadGame();
    return {cash:typeof state.cash,journal:state.journal,alerts:state.alerts,logs:state.logs};
  })()`);
  check('저장 파일의 숫자 자리를 숫자로 보정', loaded.cash === 'number', loaded.cash);
  check('저장된 거래 기록의 형식·길이 보정', loaded.journal.length === 2 && loaded.journal[0].qty === 5 && loaded.journal[0].profit === -2 && loaded.journal[0].side === 'buy' && typeof loaded.journal[0].name === 'string', JSON.stringify(loaded.journal[0]));
  check('저장된 알림 기록은 문자열로 제한', loaded.alerts.length === 1 && loaded.alerts[0].title === '<b>t</b>' && typeof loaded.alerts[0].at === 'number', JSON.stringify(loaded.alerts[0]));
  check('저장된 로그는 문자열만 유지', loaded.logs.length === 1 && loaded.logs[0] === '<img src=x>', JSON.stringify(loaded.logs));

  const evilRender = g.run(`(()=>{ state.ui=Object.assign({},state.ui,{assetTab:'journal'}); portfolio(); return document.getElementById('portfolio').innerHTML; })()`);
  check('불러온 악성 거래명도 글자로 표시', evilRender.includes('&lt;img') && !evilRender.includes('<img'), evilRender.slice(0, 160));

  const arraySave = g.run(`(()=>{ clearGame(true); const before=state.cash; localStorage.setItem(SAVE_KEY,'[1,2,3]'); let threw=false; try{ loadGame(); }catch(e){ threw=true; } return {threw,same:state.cash===before}; })()`);
  check('객체가 아닌 저장 파일은 무시', arraySave.threw === false && arraySave.same === true, JSON.stringify(arraySave));

  const weirdState = g.run(`(()=>{ localStorage.setItem(SAVE_KEY,JSON.stringify({version:SAVE_VERSION,state:'not-an-object'})); loadGame(); return typeof state.cash; })()`);
  check('state가 객체가 아니면 기본 상태 유지', weirdState === 'number', weirdState);
}

// ── CSV 수식 삽입 방어 ──────────────────────────────────────────
{
  const g = createGame();
  const APO = "'", DQ = '"';
  const quoted = v => DQ + v + DQ;

  const cells = g.run(`({
    eq: csvCell('=1+1'),
    plus: csvCell('+82 10-1234-5678'),
    minus: csvCell("-cmd|/c calc|'!A1'"),
    at: csvCell('@SUM(A1:A9)'),
    tab: csvCell('\\t=1+1'),
    cr: csvCell('\\r=1+1'),
    comma: csvCell('=1,2'),
    quote: csvCell('=HYPERLINK("http://evil","x")'),
    negNum: csvCell(-5000),
    negNumText: csvCell('-5000'),
    decNum: csvCell(1234.5),
    plain: csvCell('삼성전자'),
    empty: csvCell(null)
  })`);
  check('=로 시작하는 셀은 수식이 되지 않게 고정', cells.eq === APO + '=1+1', cells.eq);
  check('+·-·@로 시작하는 셀도 고정', cells.plus === APO + '+82 10-1234-5678' && cells.minus.startsWith(APO + '-cmd') && cells.at === APO + '@SUM(A1:A9)', JSON.stringify([cells.plus, cells.minus, cells.at]));
  check('탭·CR로 시작하는 셀도 수식이 되지 않게 고정', cells.tab === APO + '=1+1' && cells.cr === APO + '=1+1', JSON.stringify([cells.tab, cells.cr]));
  check('쉼표·따옴표가 있으면 인용부호로 감싸고 앞에 고정', cells.comma === quoted(APO + '=1,2') && cells.quote === quoted(APO + '=HYPERLINK(""http://evil"",""x"")'), JSON.stringify([cells.comma, cells.quote]));
  check('숫자 셀은 그대로 두어 계산 가능', cells.negNum === '-5000' && cells.negNumText === '-5000' && cells.decNum === '1234.5', JSON.stringify([cells.negNum, cells.negNumText, cells.decNum]));
  check('일반 문자열·빈 값은 그대로', cells.plain === '삼성전자' && cells.empty === '', JSON.stringify([cells.plain, cells.empty]));

  const journalCsv = g.run(`(()=>{
    clearGame(true);
    const captured=[];
    const prev=downloadCsv;
    downloadCsv=(filename,rows)=>{ captured.push({ filename, csv: rows.map(r=>r.map(csvCell).join(',')).join('\\r\\n') }); };
    state.journal=[{ at:0, side:'buy', name:'=HYPERLINK("http://evil","x")', qty:1, valueKRW:100, fee:0, profit:-5 }];
    exportCsv('journal');
    downloadCsv=prev;
    return captured[0];
  })()`);
  const journalRow = journalCsv.csv.split('\r\n')[1];
  check('거래 내역 CSV가 악성 종목명을 수식으로 내보내지 않음', !journalCsv.csv.includes(',=HYPERLINK') && journalCsv.csv.includes(APO + '=HYPERLINK') && journalCsv.csv.includes('""http://evil""'), journalRow);
  check('거래 내역 CSV의 숫자 열은 그대로', /,1,100,0,-5$/.test(journalCsv.csv), journalRow);
  check('거래 내역 CSV 파일명 유지', /^money-playground-journal-\d{4}-\d{2}-\d{2}\.csv$/.test(journalCsv.filename), journalCsv.filename);

  const holdingsCsv = g.run(`(()=>{
    clearGame(true);
    const captured=[];
    const prev=downloadCsv;
    downloadCsv=(filename,rows)=>{ captured.push({ filename, csv: rows.map(r=>r.map(csvCell).join(',')).join('\\r\\n') }); };
    const s=stock('future_ai'); s.name='=1+1'; s.ticker='@SUM(A1)'; s.own=3; s.avgBuy=1000;
    exportCsv('holdings');
    downloadCsv=prev;
    return captured[0];
  })()`);
  const holdingsRow = holdingsCsv.csv.split('\r\n')[1];
  check('보유 종목 CSV도 수식 시작 값을 고정', !holdingsCsv.csv.includes(',=1+1') && holdingsCsv.csv.includes(APO + '=1+1') && holdingsCsv.csv.includes(APO + '@SUM(A1)'), holdingsRow);
}

console.log(`\n== ${pass}/${pass + fail} passed ==`);
if (fail) process.exit(1);
