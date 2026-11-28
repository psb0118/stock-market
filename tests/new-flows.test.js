#!/usr/bin/env node
/**
 * 새 흐름 회귀 테스트: 상단 자산 순서 · 자동 현금 수익 표시·수령 설정 · 종목 상세 ·
 * 자산 추이 호버 · 은행 이율 안내 · 세금 원장 · 튜토리얼 · 리더보드 ·
 * 리서치 기억 게임 · 관리자 UID 검사 · 저장 파일 미리보기 · 자동 백업 ·
 * 저장 값 스키마 보정.
 * 실행: node tests/new-flows.test.js
 */
'use strict';

const { html, createGame } = require('./harness');

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log(`PASS ${name}${detail !== undefined ? `  [${detail}]` : ''}`); }
  else { fail++; console.log(`FAIL ${name}${detail !== undefined ? `  [${detail}]` : ''}`); }
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
    fbUser={uid:'u1',displayName:'테스터'};
    leaderboardPage();
    nav();
    return {html:document.getElementById('leaderboard').innerHTML,nav:document.getElementById('nav').innerHTML,season:seasonKey()};
  })()`);
  check('리더보드 페이지에 월간 순위·내 기록 표시', page.html.includes('리더보드') && page.html.includes('월간 순위') && page.html.includes('내 기록'), page.html.length);
  check('리더보드에 시즌·닉네임 표시', page.html.includes(page.season) && page.html.includes('테스터'), page.html.includes(page.season));
  check('서버 미설정이면 클라우드 순위 카드 없음', !page.html.includes('기기 클라우드') && !page.html.includes('3위'));
  check('로그인 전 안내 표시', page.html.includes('아직 로그인하지 않았습니다'));
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

// ── 환생 전 저장 파일 되돌리기 방어 ─────────────────────────────
{
  const g = createGame();

  const rollback = g.run(`(()=>{
    clearGame(true);
    state.cash=120000000; state.peakNet=120000000;
    const before=JSON.parse(JSON.stringify(buildSaveData()));
    rebirthNow(true);
    const after={count:ensureRebirth().count,points:ensureRebirth().points,cash:state.cash};
    let code="", msg="";
    try{ applySaveData(before); }catch(e){ code=e.code; msg=saveStaleRebirth(e)?SAVE_STALE_REBIRTH_MSG:""; }
    return {after, code, msg, kept:{count:ensureRebirth().count,points:ensureRebirth().points,cash:state.cash}};
  })()`);
  check('환생 전 저장 파일은 불러오기를 거부', rollback.code === 'stale_rebirth' && rollback.msg.includes('환생 전'), JSON.stringify(rollback));
  check('거부된 파일은 현재 진행을 건드리지 않음', rollback.kept.count === rollback.after.count && rollback.kept.points === rollback.after.points && rollback.kept.cash === rollback.after.cash, JSON.stringify(rollback.kept));

  const sameCount = g.run(`(()=>{
    const data=JSON.parse(JSON.stringify(buildSaveData()));
    data.state.cash=5000; data.state.rebirth.count=1; data.state.rebirth.points=0;
    state.rebirth.count=0; state.rebirth.points=0;
    applySaveData(data);
    return {count:ensureRebirth().count, cash:state.cash};
  })()`);
  check('환생 횟수가 같거나 많아진 저장은 정상 복원', sameCount.count === 1 && sameCount.cash === 5000, JSON.stringify(sameCount));

  const staleLocal = g.run(`(()=>{
    clearGame(true); state.cash=120000000; state.peakNet=120000000;
    const before=JSON.parse(JSON.stringify(buildSaveData()));
    rebirthNow(true);
    localStorage.setItem(SAVE_KEY,JSON.stringify(before));
    const prev={count:ensureRebirth().count,cash:state.cash};
    loadGame();
    return {prev, now:{count:ensureRebirth().count,cash:state.cash}};
  })()`);
  check('자동 저장 칸의 예전 진행도 환생 기록을 되돌리지 못함', staleLocal.now.count === staleLocal.prev.count && staleLocal.now.cash === staleLocal.prev.cash, JSON.stringify(staleLocal));

  const legacySave = g.run(`(()=>{
    let code="";
    try{ applySaveData({version:SAVE_VERSION,state:{cash:1234}}); }catch(e){ code=e.code; }
    return {code, count:ensureRebirth().count, cash:state.cash};
  })()`);
  check('환생 정보가 없는 예전 저장도 환생 기록을 되돌리지 못함', legacySave.code === 'stale_rebirth' && legacySave.count === staleLocal.prev.count && legacySave.cash === staleLocal.prev.cash, JSON.stringify(legacySave));

  const genesis = createGame();
  const firstSave = genesis.run(`(()=>{
    applySaveData({version:SAVE_VERSION,state:{cash:777}});
    return {count:ensureRebirth().count, cash:state.cash};
  })()`);
  check('환생 0회에서는 환생 정보 없는 저장도 적용', firstSave.count === 0 && firstSave.cash === 777, JSON.stringify(firstSave));
}

// ── 보고된 이상 동작 수정(기업명 XSS·뉴스 이스케이프·노동 시간/자산 판정) ──
{
  const g = createGame();

  const companyModal = g.run(`(()=>{
    clearGame(true);
    state.company={name:'<img src=x onerror=1>',level:1,valuation:100000000,book:100000000,revenue:2000000,profit:600000,payout:.3,upkeep:0,risk:0,listed:null,acquired:{}};
    closeModal(); openAssetDetail('company');
    return document.getElementById('modalRoot').innerHTML||'';
  })()`);
  check('기업 상세 모달이 기업명을 이스케이프', companyModal.includes('&lt;img') && !companyModal.includes('<img'), companyModal.slice(0, 120));

  const nameLimit = g.run(`(()=>{
    applySaveData({version:SAVE_VERSION,state:{cash:1,company:{name:'가'.repeat(40)+'\\u0007',level:1,valuation:100,revenue:0,profit:0,payout:.3}}});
    return {name:state.company.name, len:state.company.name.length};
  })()`);
  check('저장 파일의 기업명은 12자·제어문자 제한', nameLimit.len === 12 && !/[\u0000-\u001f]/.test(nameLimit.name), JSON.stringify(nameLimit));

  const newsHtml = g.run(`(()=>{
    state.news=['<img src=x onerror=1>'];
    news(); const page=document.getElementById('news').innerHTML||'';
    dashboardPage(); const dash=document.getElementById('dashboard').innerHTML||'';
    economyPage(); const eco=document.getElementById('economy').innerHTML||'';
    state.notify=Object.assign({},state.notify,{news:true,master:false}); breakingShownAt=0;
    publishBreakingNews('<img src=x onerror=1>','<b>본문</b>');
    return {page,dash,eco,banner:document.getElementById('breaking').innerHTML||''};
  })()`);
  check('뉴스 화면이 저장된 뉴스 문자열을 이스케이프', newsHtml.page.includes('&lt;img') && !newsHtml.page.includes('<img'), newsHtml.page.slice(0, 120));
  check('대시보드·경제 화면 뉴스도 이스케이프', !newsHtml.dash.includes('<img') && !newsHtml.eco.includes('<img'), JSON.stringify([newsHtml.dash.length, newsHtml.eco.length]));
  check('속보 배너도 제목·본문을 이스케이프', newsHtml.banner.includes('&lt;img') && !newsHtml.banner.includes('<img') && newsHtml.banner.includes('&lt;b&gt;'), newsHtml.banner.slice(0, 120));

  const emergency = g.run(`(()=>{
    clearGame(true); state.cash=0;
    stocks.forEach(s=>{s.own=0}); products.forEach(p=>{p.amount=0});
    state.estate={}; state.metals={gold:{qty:0,avg:0},silver:{qty:0,avg:0}}; state.company=null; state.shorts=[]; state.bonds={qty:10,avg:10000};
    const withBonds=laborEmergency();
    state.bonds={qty:0,avg:0}; state.shorts=[{id:'s1',stockId:'future_ai',qty:1,entry:1000,margin:500000,at:0}];
    const withMargin=laborEmergency();
    state.shorts=[];
    const broke=laborEmergency();
    return {withBonds,withMargin,broke};
  })()`);
  check('채권·공매도 증거금이 있으면 생계 위기가 아님', emergency.withBonds === false && emergency.withMargin === false && emergency.broke === true, JSON.stringify(emergency));

  const cooldown = g.run(`(()=>{
    state.labor.lastAt.convenience=Date.now()+600000;
    const remain=laborRemaining(laborJob('convenience'));
    state.labor.stamina=0; state.labor.restAt=Date.now()+600000;
    ensureLabor();
    const restAt=state.labor.restAt;
    const rested=restLabor();
    return {remain, restAt, rested, stamina:state.labor.stamina};
  })()`);
  check('미래 시각이 적힌 저장도 쿨다운·휴식을 잠그지 않음', cooldown.remain === 0 && cooldown.restAt === 0 && cooldown.rested === true && cooldown.stamina > 0, JSON.stringify(cooldown));

  const beginner = g.run(`(()=>{
    state.rebirth.count=0; state.labor.shifts=0; const before=laborBeginnerHelp();
    state.rebirth.count=1; const after=laborBeginnerHelp();
    return {before, after};
  })()`);
  check('환생 후에는 초보자 도움을 다시 켜지 않음', beginner.before === true && beginner.after === false, JSON.stringify(beginner));
}

// ── 저장 파일 문자열이 남은 화면에도 원시 HTML로 들어가지 않는지 전수 확인 ──
{
  const g = createGame();
  const EVIL = "<img src=x onerror=1>";

  const bar = g.run(`(()=>{
    clearGame(true);
    state.ipo={offer:{id:'ipo_med',name:'<img src=x onerror=1>',ticker:'<b>t</b>',theme:'<i>y</i>',group:'domestic',vol:.038,price:42000,qty:60000,closesAt:99999,subscribed:0,mine:0,reminded:false},nextAt:0,history:[]};
    ipoPage();
    return {bar:marketDayBarHTML(), page:document.getElementById('ipo').innerHTML||''};
  })()`);
  check('시장 일차 바가 공모주 이름을 이스케이프', bar.bar.includes('&lt;img') && !bar.bar.includes('<img'), bar.bar.slice(0, 120));
  check('공모주 화면이 티커·테마를 이스케이프', !bar.page.includes('<img') && !bar.page.includes('<b>t</b>') && !bar.page.includes('<i>y</i>'), bar.page.slice(0, 160));

  const weekly = g.run(`(()=>{
    const orig=ensureWeekly;
    ensureWeekly=()=>state.weekly; // 저장 파일에서 온 키를 그대로 그려 보기 위해 키 정규화를 잠시 끕니다.
    state.weekly={key:'<img src=x onerror=1>',counts:{},claimed:{}};
    let html='';
    try{ html=weeklyPanelHtml(); } finally { ensureWeekly=orig; }
    return html;
  })()`);
  check('주간 패널이 주간 키를 이스케이프', weekly.includes('&lt;img') && !weekly.includes('<img'), weekly.slice(0, 160));

  // 저장 파일에서 온 문자열을 모두 악성 값으로 바꾼 뒤 화면 전체를 그려 봅니다.
  g.run(`(()=>{
    clearGame(true);
    const evil='${EVIL}';
    state.cash=50000000; state.usd=0; state.loan=0;
    state.news=[evil];
    state.logs=[evil];
    state.alerts=[{at:0,kind:'system',title:evil,text:evil,read:false}];
    state.journal=[{at:0,side:'buy',name:evil,qty:1,valueKRW:1,fee:0,profit:0}];
    state.journalFilter={q:evil,side:'all'};
    state.company={name:evil,level:1,valuation:100000000,book:100000000,revenue:2000000,profit:600000,payout:.3,upkeep:0,risk:0,listed:null,acquired:{}};
    state.weekly={key:evil,counts:{},claimed:{}};
    state.ipo={offer:{id:'ipo_med',name:evil,ticker:evil,theme:evil,group:'domestic',vol:.038,price:42000,qty:60000,closesAt:99999,subscribed:0,mine:0,reminded:false},nextAt:0,history:[]};
    state.disclosures=[{at:0,stockId:'future_ai',name:evil,title:evil,text:evil,move:1}];
    state.watch=[];
    const stock0=stocks[0]; stock0.own=1; stock0.avgBuy=stock0.start;
    products[0].amount=100000;
    return 1;
  })()`);

  const renders = [
    ["dashboardPage"], ["portfolio"], ["stockPage", "domestic"], ["stockPage", "foreign"],
    ["stockPage", "mega"], ["stockPage", "special"], ["holdingsPage"], ["news"], ["economyPage"],
    ["ipoPage"], ["loanPage"], ["taxPage"], ["ordersPage"], ["banking"], ["fxPage"],
    ["realestatePage"], ["companyPage"], ["leaderboardPage"], ["rebirthPage"], ["settingsPage"],
    ["guidePage"], ["shortPage"], ["openNotifModal"], ["openReport"]
  ];
  renders.forEach(args => {
    const call = args.length === 1
      ? `${args[0]}()`
      : `${args[0]}(${args.slice(1).map(a => JSON.stringify(a)).join(",")}, '테스트', '테스트')`;
    try { g.run(call); } catch (e) { /* 화면 상태에 따라 그리지 못하는 페이지는 건너뜁니다 */ }
  });

  const ids = ["dashboard", "portfolio", "domestic", "foreign", "mega", "special", "holdings", "news",
    "economy", "ipo", "loan", "tax", "orders", "banking", "fx", "realestate", "company",
    "leaderboard", "rebirth", "settings", "guide", "short"];
  let combined = "";
  ids.forEach(id => { try { combined += (g.el(id).innerHTML || ""); } catch (e) {} });
  try { combined += g.el("modalRoot").innerHTML || ""; } catch (e) {}
  const rawAt = combined.toLowerCase().indexOf("<img");
  check('저장 파일 문자열이 어떤 화면에도 원시 HTML로 들어가지 않음', rawAt < 0,
    rawAt < 0 ? "clean" : combined.slice(Math.max(0, rawAt - 100), rawAt + 100));
  const escapedHits = (combined.match(/&lt;img src=x onerror=1&gt;/g) || []).length;
  check('악성 값이 글자로는 실제 화면에 표시됨', escapedHits >= 3, escapedHits);
  check('전수 확인이 실제로 화면을 그렸음', combined.length > 5000, combined.length);
}

// ── 저장 파일 미리보기 · 자동 백업 ─────────────────────────────
{
  const g = createGame();

  const preview = g.run(`(()=>{
    clearGame(true);
    localStorage.removeItem(SAVE_BACKUP_KEY);
    state.cash=12345678; state.marketSeconds=600;
    const data=JSON.parse(JSON.stringify(buildSaveData()));
    state.cash=0;
    previewImportSave(data,'내저장.json');
    return {modal:document.getElementById('modalRoot').innerHTML||'', pending:!!pendingImport, summary:saveFileSummary(data)};
  })()`);
  check('가져오기 전에 저장 내용을 먼저 보여 줌', preview.pending === true && preview.modal.includes('저장 파일 불러오기') && preview.modal.includes('내저장.json') && preview.summary.cash === 12345678 && preview.summary.marketSeconds === 600, JSON.stringify(preview.summary));
  check('확인 전에는 진행을 덮어쓰지 않음', g.run('state.cash') === 0, g.run('state.cash'));

  const applied = g.run(`(()=>{ applyPendingImport(); return {cash:state.cash,pending:pendingImport}; })()`);
  check('확인을 누르면 저장 파일을 적용', applied.cash === 12345678 && applied.pending === null, JSON.stringify(applied));

  const cancelled = g.run(`(()=>{
    const data=JSON.parse(JSON.stringify(buildSaveData()));
    data.state.cash=999;
    previewImportSave(data,'cancel.json');
    cancelPendingImport();
    return {cash:state.cash, pending:pendingImport};
  })()`);
  check('취소하면 아무것도 바뀌지 않음', cancelled.cash === 12345678 && cancelled.pending === null, JSON.stringify(cancelled));

  const fileName = g.run(`(()=>{
    const data=JSON.parse(JSON.stringify(buildSaveData()));
    previewImportSave(data,'<img src=x onerror=1>.json');
    return document.getElementById('modalRoot').innerHTML||'';
  })()`);
  check('파일 이름도 이스케이프해서 표시', fileName.includes('&lt;img') && !fileName.includes('<img'), fileName.slice(0, 140));

  const stale = g.run(`(()=>{
    clearGame(true);
    state.cash=120000000; state.peakNet=120000000;
    const old=JSON.parse(JSON.stringify(buildSaveData()));
    rebirthNow(true);
    previewImportSave(old,'old.json');
    return {modal:document.getElementById('modalRoot').innerHTML||'', stale:saveFileSummary(old).stale};
  })()`);
  check('환생 전 파일은 미리보기 단계에서부터 막힘', stale.stale === true && stale.modal.includes('불러올 수 없습니다') && /disabled/.test(stale.modal), stale.modal.slice(0, 160));

  const invalid = g.run(`(()=>{ pendingImport=null; previewImportSave({foo:1},'x.json'); return pendingImport; })()`);
  check('형식이 아닌 파일은 미리보기를 열지 않음', invalid === null);

  const backups = g.run(`(()=>{
    clearGame(true); localStorage.removeItem(SAVE_BACKUP_KEY);
    for(let i=0;i<5;i++){ state.cash=1000+i; saveGame(); snapshotSave('import', Date.now()+i*1000); }
    const list=saveBackupList();
    return {count:list.length, cash:list.map(b=>JSON.parse(b.data).state.cash)};
  })()`);
  check('자동 백업은 최대 3개만 보관', backups.count === 3 && backups.cash[0] === 1004 && backups.cash[2] === 1002, JSON.stringify(backups));

  const restored = g.run(`(()=>{ restoreLatestBackup(); return state.cash; })()`);
  check('직전 세이브로 복원', restored === 1004, restored);

  const big = g.run(`(()=>{
    const keep=localStorage.getItem(SAVE_KEY);
    localStorage.setItem(SAVE_KEY,'x'.repeat(SAVE_BACKUP_BYTES+1));
    const r=snapshotSave('import');
    if(keep==null) localStorage.removeItem(SAVE_KEY); else localStorage.setItem(SAVE_KEY,keep);
    return r;
  })()`);
  check('너무 큰 저장은 백업하지 않음', big === false, String(big));

  const panel = g.run('savePanelHtml()');
  check('설정 화면에 백업 복원 버튼·시각 표시', panel.includes('직전 세이브로 복원') && panel.includes('최근 백업'), panel.slice(0, 80));
}

// ── 저장 값 스키마 보정 보고 ────────────────────────────────────
{
  const g = createGame();
  const norm = g.run(`(()=>{
    clearGame(true);
    applySaveData({version:SAVE_VERSION,state:{cash:-5,usd:'abc',loanRate:9,speed:99,marketSeconds:'x',riskScenario:'evil',targetGoal:0,revision:-3}});
    return {cash:state.cash,usd:state.usd,loanRate:state.loanRate,speed:state.speed,marketSeconds:state.marketSeconds,riskScenario:state.riskScenario,targetGoal:state.targetGoal,revision:state.revision,fixes:lastSaveFixReport.map(f=>f.key)};
  })()`);
  check('숫자 범위·열거형 저장 값을 규칙표로 보정', norm.cash === 0 && norm.usd === 0 && norm.loanRate === 1 && norm.speed === 5 && norm.marketSeconds === 0 && norm.riskScenario === 'base' && norm.targetGoal === 1000000 && norm.revision === 0, JSON.stringify(norm));
  check('보정한 항목을 보고', ['cash', 'usd', 'loanRate', 'speed', 'marketSeconds', 'riskScenario', 'targetGoal', 'revision'].every(k => norm.fixes.includes(k)), JSON.stringify(norm.fixes));

  const clean = g.run(`(()=>{ clearGame(true); const d=JSON.parse(JSON.stringify(buildSaveData())); applySaveData(d); return lastSaveFixReport.length; })()`);
  check('정상 저장 파일은 보정 보고가 없음', clean === 0, clean);
}

// ── 노동 미니게임 키보드 조작 · 라이브 영역 ─────────────────────
{
  const g = createGame();
  const laborHtml = g.run("laborGameHtml(laborJob('convenience'))");
  check('노동 화면에 키보드 안내·라이브 영역', laborHtml.includes('Space') && laborHtml.includes('aria-live="polite"') && laborHtml.includes('role="status"'), laborHtml.slice(0, 60));

  const timing = g.run(`(()=>{
    clearGame(true);
    workLabor('convenience');
    const s=laborSession; if(!s) return {started:false};
    s.pos=.5; s.accepting=true;
    const handled=laborKeydown({key:' ',preventDefault(){}});
    return {started:true, handled, round:laborSession?laborSession.round:'none', grade:((laborSession&&laborSession.results[0])||{}).grade};
  })()`);
  check('Space로 타이밍 멈추기', timing.started === true && timing.handled === true && timing.round === 1 && ['perfect', 'good', 'miss'].includes(timing.grade), JSON.stringify(timing));

  const memory = g.run(`(()=>{
    laborAbortShift(true);
    laborSession={job:laborJob('stockcheck'),mode:'memory',round:0,results:[],paid:false,accepting:true,phase:'input',seq:['a','b'],icons:['a','b','c','d'],input:[],mistakes:0};
    const handled=laborKeydown({key:'1',preventDefault(){}});
    return {handled, input:((laborSession&&laborSession.input)||[]).length};
  })()`);
  check('숫자 키로 기억 게임 선택', memory.handled === true && memory.input >= 1, JSON.stringify(memory));

  const math = g.run(`(()=>{
    laborAbortShift(true);
    laborSession={job:laborJob('stockcheck'),mode:'math',round:0,results:[],paid:false,accepting:true,phase:'input',q:{text:'2 × 3',answer:6,options:[5,6,7,8]},qStart:Date.now()};
    const handled=laborKeydown({key:'2',preventDefault(){}});
    return {handled, round:laborSession?laborSession.round:null, results:((laborSession&&laborSession.results)||[]).length};
  })()`);
  check('숫자 키로 계산 게임 정답 선택', math.handled === true && math.results === 1, JSON.stringify(math));

  const detach = g.run(`(()=>{ laborAbortShift(true); return {session:laborSession, ref:laborKeyRef, handled:laborKeydown({key:' '})}; })()`);
  check('노동을 끝내면 키보드 핸들러 해제', detach.session === null && detach.ref === null && detach.handled === false, JSON.stringify(detach));
}

// ── 초기화하면 백업도 사라져 '처음부터'가 유지되는지 ─────────────
{
  const g = createGame();

  const wiped = g.run(`(()=>{
    clearGame(true);
    state.cash=777; saveGame(); snapshotSave('import');
    state.cash=888; saveGame(); snapshotSave('import');
    const before=saveBackupList().length;
    clearGame(true);
    const fresh=JSON.parse(localStorage.getItem(SAVE_KEY)||'null');
    return {before, after:saveBackupList().length, cash:(fresh&&fresh.state&&fresh.state.cash)||0, label:backupLabel()};
  })()`);
  check('초기화하면 자동 백업도 함께 삭제', wiped.before >= 1 && wiped.after === 0 && wiped.cash === 0 && wiped.label === '백업 없음', JSON.stringify(wiped));

  const cannotRestore = g.run(`(()=>{
    const alerts=[]; const orig=alert; alert=(m)=>alerts.push(String(m));
    state.cash=5;
    try{ restoreLatestBackup(); } finally { alert=orig; }
    return {alerts, cash:state.cash, modal:document.getElementById('modalRoot').innerHTML||''};
  })()`);
  check('초기화 뒤에는 예전 진행을 복원할 수 없음', cannotRestore.cash === 5 && cannotRestore.alerts.some(a => a.includes('복원할 백업이 없습니다')), JSON.stringify(cannotRestore));

  const fresh = g.run(`(()=>{
    state.cash=1000; saveGame(); saveGame();
    const list=saveBackupList();
    return {backups:list.length, cashes:list.map(b=>JSON.parse(b.data).state.cash)};
  })()`);
  check('초기화 뒤 쌓이는 백업에 예전 진행이 없음', fresh.cashes.every(c => c !== 777 && c !== 888), JSON.stringify(fresh));
}

// ── 저장 파일 가져오기 안전장치 · 옛 클라우드 열쇠 정리 ─────────
{
  const g = createGame();

  const closed = g.run(`(()=>{
    const data=JSON.parse(JSON.stringify(buildSaveData()));
    previewImportSave(data,'x.json');
    closeModal();
    return {pending:pendingImport, modal:document.getElementById('modalRoot').innerHTML||''};
  })()`);
  check('미리보기를 닫으면 대기 중인 파일도 버림', closed.pending === null && closed.modal === '', JSON.stringify(closed));

  const oversize = g.run(`(()=>{
    const alerts=[]; const orig=alert; alert=m=>alerts.push(String(m));
    try{ handleImport({target:{files:[{size:IMPORT_MAX_BYTES+1,name:'big.json'}],value:'x'}}); } finally { alert=orig; }
    return alerts;
  })()`);
  check('5MB 넘는 저장 파일은 읽지 않음', oversize.length === 1 && oversize[0].includes('너무 큽니다'), JSON.stringify(oversize));

  const legacy = g.run(`(()=>{
    localStorage.setItem('mp_cloud_creds','{"token":"x"}');
    clearGame(true);
    return localStorage.getItem('mp_cloud_creds');
  })()`);
  check('초기화하면 옛 클라우드 연결 열쇠도 삭제', legacy === null);
}

console.log(`\n== ${pass}/${pass + fail} passed ==`);
if (fail) process.exit(1);
