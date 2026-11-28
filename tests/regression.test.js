#!/usr/bin/env node
/**
 * 주식 금융 게임 회귀 테스트
 * 실행: node tests/regression.test.js
 *
 * index.html의 인라인 스크립트를 최소 DOM 스텁에서 실행합니다(외부 의존성 없음).
 * 중점 검증: 등급이 오르내려도 사용자가 입력 중인 가입 금액이 보존되고,
 *           카드의 잠금/보유 표시와 배너만 갱신되는지(전체 재렌더 금지).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const scriptTag = /<script>([\s\S]*?)<\/script>/.exec(html);
if (!scriptTag) throw new Error('index.html에서 인라인 스크립트를 찾지 못했습니다');
const source = scriptTag[1];

function createDom() {
  const els = new Map();
  const cards = new Map();
  let renderCount = 0;       // 금융 화면 전체 렌더 횟수
  let renderedIds = new Set(); // 현재 렌더된 상품 카드 id
  let activePageId;

  const mk = id => ({
    id, value: '', textContent: '', disabled: false, className: '', style: {},
    classList: { add() {}, remove() {}, toggle() {} }
  });
  const el = id => { if (!els.has(id)) els.set(id, mk(id)); return els.get(id); };

  const banking = el('banking');
  let markup = '';
  // 브라우저에서 innerHTML을 다시 쓰면 입력 요소가 새로 만들어지고
  // 값도 마크업의 기본값(최소 금액)으로 초기화된다는 점을 흉내 냅니다.
  Object.defineProperty(banking, 'innerHTML', {
    get: () => markup,
    set: value => {
      markup = value;
      renderCount++;
      renderedIds = new Set([...value.matchAll(/data-card="([^"]+)"/g)].map(m => m[1]));
      for (const id of [...els.keys()]) {
        if (!id.startsWith('prod-')) continue;
        const min = new RegExp('id="' + id + '" type="number" value="(\\d+)"').exec(value);
        els.set(id, Object.assign(mk(id), { value: min ? min[1] : '' }));
      }
      cards.clear();
    }
  });

  const cardFor = id => {
    if (!cards.has(id)) cards.set(id, {
      id, className: '', sub: mk('sub-' + id), join: mk('join-' + id),
      querySelector(sel) {
        const m = /^\[data-(sub|join)="(.+)"\]$/.exec(sel);
        return m ? (m[1] === 'sub' ? this.sub : this.join) : null;
      }
    });
    return cards.get(id);
  };

  return {
    document: {
      getElementById: id => (id === 'banking' ? banking : el(id)),
      querySelector: sel => {
        const m = /^\[data-card="(.+)"\]$/.exec(sel);
        if (m) return renderedIds.has(m[1]) ? cardFor(m[1]) : null;
        if (sel === '.page.on') return activePageId === undefined ? null : { id: activePageId };
        return null;
      },
      querySelectorAll: () => [],
      createElement: id => mk(id),
      body: mk('body')
    },
    setPage: id => { activePageId = id; },
    get renderCount() { return renderCount; }
  };
}

function createGame() {
  const dom = createDom();
  const store = {};
  const alerts = [];
  const context = {
    console, Math, Date, JSON, Number, isFinite, Intl,
    setTimeout: () => 0, setInterval: () => 0, clearInterval: () => 0,
    alert: m => alerts.push(m), confirm: () => true,
    document: dom.document,
    localStorage: {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: k => { delete store[k]; }
    },
    window: {}
  };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'index.html#script' });
  return { dom, alerts, run: code => vm.runInContext(code, context) };
}

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass });
  const suffix = detail === undefined ? '' : '  [' + detail + ']';
  console.log((pass ? 'PASS ' : 'FAIL ') + name + suffix);
}

// 게임 상태를 특정 총자산으로 초기화하는 헬퍼 (스크립트 스코프 안에서 실행)
const RESET = total => `
  products.forEach(p => { p.amount = 0; p.rate = 0; });
  stocks.forEach(s => { s.own = 0; s.avgBuy = 0; s.realizedProfit = 0; });
  state.usd = 0; fx.usd = START_FX; fx.anchor = START_FX;
  state.marketOpen = true; state.cash = ${total};
`;

// ── 1. 등급 하향: 입력값 보존 + 잠금+보유 표시 + 재렌더 없음 ──────────────
{
  const g = createGame();
  // 실버(3,000만원): 현금 1,000만 + 파킹 2,000만
  g.run(RESET(10000000) + `
    product('parking').amount = 20000000;
    product('parking').rate = 0.018;
    banking();
    1;
  `);
  const inputRef = g.run("document.getElementById('prod-parking')");
  g.run("document.getElementById('prod-parking').value = '4444444'");
  g.dom.setPage('banking');
  const rendersBefore = g.dom.renderCount;
  const gradeBefore = g.run('currentGrade()');

  // 현금을 900만원으로 줄여 총자산 2,900만원 → 브론즈 강등
  g.run("state.cash = 9000000; update(); 1");

  const after = g.run(`({
    grade: currentGrade(),
    value: document.getElementById('prod-parking').value,
    cardClass: document.querySelector('[data-card="parking"]').className,
    sub: document.querySelector('[data-card="parking"]').querySelector('[data-sub="parking"]').textContent,
    joinDisabled: document.querySelector('[data-card="parking"]').querySelector('[data-join="parking"]').disabled,
    banner: document.getElementById('gradeBanner').innerHTML,
    canJoin: canJoin('parking')
  })`);

  check('하향 전 등급은 실버', gradeBefore === '실버', gradeBefore);
  check('하향 후 등급은 브론즈', after.grade === '브론즈', after.grade);
  check('하향 시 입력값 유지', after.value === '4444444', after.value);
  check('하향 시 입력 요소 동일(재생성 없음)', g.run("document.getElementById('prod-parking')") === inputRef);
  check('하향 시 전체 재렌더 없음', g.dom.renderCount === rendersBefore, rendersBefore + ' → ' + g.dom.renderCount);
  check('하향 시 카드가 잠금+보유 상태', after.cardClass === 'product locked holding', after.cardClass);
  check('하향 시 보유 안내 문구 노출', after.sub.includes('보유 중(이자는 확정 이율로 유지)'), after.sub);
  check('하향 시 가입 버튼 비활성', after.joinDisabled === true);
  check('하향 시 가입 불가 판정', after.canJoin === false);
  check('하향 시 배너 갱신', after.banner.includes('브론즈'), (after.banner.match(/현재 등급: <b>[^<]+<\/b>/) || [''])[0]);

  const before = g.run("product('parking').amount");
  g.run('interest(); 1');
  const gained = g.run("product('parking').amount") - before;
  check('하향 후에도 확정 이율로 이자 지급', Math.abs(gained - before * 0.018 * g.run('INTEREST_PERIOD')) < 1e-6, gained.toFixed(2));
  check('하향 후 확정 이율 유지(1.8%)', Math.abs(g.run("product('parking').rate") - 0.018) < 1e-12, g.run("product('parking').rate"));
}

// ── 2. 등급 상향: 입력값 보존 + 잠금 해제 ────────────────────────────────
{
  const g = createGame();
  g.run(RESET(9000000) + `
    product('parking').amount = 20000000;
    product('parking').rate = 0.018;
    banking();
    1;
  `);
  g.run("document.getElementById('prod-parking').value = '3333333'");
  g.dom.setPage('banking');
  const rendersBefore = g.dom.renderCount;
  g.run("state.cash = 10000000; update(); 1"); // 총 3,000만원 → 실버
  const after = g.run(`({
    grade: currentGrade(),
    value: document.getElementById('prod-parking').value,
    cardClass: document.querySelector('[data-card="parking"]').className,
    sub: document.querySelector('[data-card="parking"]').querySelector('[data-sub="parking"]').textContent,
    joinDisabled: document.querySelector('[data-card="parking"]').querySelector('[data-join="parking"]').disabled,
    inputDisabled: document.getElementById('prod-parking').disabled
  })`);
  check('상향 후 등급은 실버', after.grade === '실버', after.grade);
  check('상향 시 입력값 유지', after.value === '3333333', after.value);
  check('상향 시 전체 재렌더 없음', g.dom.renderCount === rendersBefore, rendersBefore + ' → ' + g.dom.renderCount);
  check('상향 시 잠금 해제', after.cardClass === 'product' && after.joinDisabled === false && after.inputDisabled === false, after.cardClass);
  check('상향 시 현재 등급 이율 표시', after.sub.includes('현재 등급 연 1.8%'), after.sub);
}

// ── 3. 등급 변화가 없으면 입력값이 그대로 (재렌더 없음) ──────────────────
{
  const g = createGame();
  g.run(RESET(10000000) + 'banking(); 1');
  g.run("document.getElementById('prod-deposit').value = '9876543'");
  g.dom.setPage('banking');
  const rendersBefore = g.dom.renderCount;
  g.run("update(); update(); 1");
  check('동일 등급 반복 갱신에서도 입력값 유지', g.run("document.getElementById('prod-deposit').value") === '9876543');
  check('동일 등급 반복 갱신에서도 재렌더 없음', g.dom.renderCount === rendersBefore, rendersBefore + ' → ' + g.dom.renderCount);
}

// ── 4. 순자산·대출·세금·예약주문·목표·배당·저장 ─────────────────────
{
  const g = createGame();
  g.run(RESET(10000000) + `
    state.loan = 0; state.loanRate = 0; state.orders = []; state.goals = {};
    state.realizedYTD = 0; state.taxedProfit = 0; state.taxPaid = 0;
    1;
  `);

  g.run('state.loan = 2000000; state.loanRate = 0.12; 1');
  check('순자산은 대출 잔액을 차감', Math.round(g.run('totalAssetsKRW()')) === 8000000, g.run('totalAssetsKRW()'));

  // 대출 실행: 현금 증가, 부채 증가, 순자산 불변
  g.run("state.loan = 0; state.cash = 30000000; document.getElementById('loan-amt').value = '5000000'; borrowLoan(); 1");
  const loan = g.run('({cash: state.cash, loan: state.loan, rate: state.loanRate, total: totalAssetsKRW()})');
  check('대출 실행 시 현금 증가', loan.cash === 35000000, loan.cash);
  check('대출 잔액·금리 기록', loan.loan === 5000000 && loan.rate === 0.12, loan.loan + '/' + loan.rate);
  check('대출은 순자산을 바꾸지 않음', Math.round(loan.total) === 30000000, loan.total);

  // 대출 이자: 현금이 없으면 잔액에 가산
  g.run('state.cash = 0; state.loan = 1000000; state.loanRate = 0.12; interest(); 1');
  check('대출 이자가 잔액에 가산', Math.abs(g.run('state.loan') - 1001800) < 1e-6, g.run('state.loan'));

  // 세금을 현금으로 내지 못한 부족분도 무이자 대출이 아니라 기본 금리 부채가 되어야 합니다.
  const taxLoan = createGame();
  taxLoan.run(`clearGame(true); state.cash=0; state.loan=0; state.loanRate=0; state.realizedYTD=0; state.taxedProfit=0; state.taxPaid=0;
    state.tax={mode:'general',carryLoss:0,carryLossBase:0,pensionDeferred:0,isaGains:0,isaTaxed:0,contributions:{general:0,isa:0,pension:0},taxPaidByAccount:{general:0,isa:0,pension:0},year:1,yearStart:0};
    settleTax(3000000); 1`);
  const taxLoanState = taxLoan.run('({loan:state.loan,rate:state.loanRate,paid:state.taxPaid,cash:state.cash,panel:taxPanelHtml(),loanPanel:loanPanelHtml()})');
  check('세금 부족분은 0%가 아닌 대출로 기록', Math.round(taxLoanState.loan) === 110000 && taxLoanState.rate === 0.08 && taxLoanState.cash === 0, JSON.stringify(taxLoanState));
  check('세금 화면에 대출 부채·이자 안내', taxLoanState.panel.includes('대출 부채') && taxLoanState.panel.includes('세금을 현금으로 낼 수 없으면'));
  check('대출 화면에 세금 전환·다음 이자 안내', taxLoanState.loanPanel.includes('세금·수수료를 현금으로 내지 못하면') && taxLoanState.loanPanel.includes('다음 15초 이자'));

  // 기존 대출 금리를 새 대출 금리로 덮어쓰지 않고 금액 가중 평균을 씁니다.
  const blend = createGame();
  blend.run("clearGame(true); state.cash=40000000; state.loan=5000000; state.loanRate=.08; document.getElementById('loan-amt').value='5000000'; borrowLoan(); 1");
  check('추가 대출은 기존 금리와 가중 평균', Math.abs(blend.run('state.loanRate') - 0.10) < 1e-9 && Math.round(blend.run('state.loan')) === 10000000, blend.run('({loan:state.loan,rate:state.loanRate})'));

  // 예전 저장의 0% 대출도 다음 이자 계산에서 기본 금리로 복구됩니다.
  const legacyLoan = createGame();
  legacyLoan.run('clearGame(true); state.cash=0; state.loan=1000000; state.loanRate=0; products.forEach(p=>{p.rate=0;}); interest(); 1');
  check('0% 구버전 대출은 기본 금리로 복구', legacyLoan.run('state.loanRate') === 0.08 && legacyLoan.run('state.loan') > 1000000, legacyLoan.run('({rate:state.loanRate,loan:state.loan})'));

  // 거래세: 즉시 매도 손실 = 매수 수수료 + 매도 수수료 + 거래세
  // 업적 보상이 현금 검증을 흐리지 않도록 이 테스트에서는 보상을 미리 수령 처리합니다.
  g.run(RESET(10000000) + 'state.loan = 0; state.achievements = Object.fromEntries(ACHIEVEMENTS.map(a=>[a.id,true])); 1');
  g.run("stock('future_ai').price = 100000; stock('future_ai').start = 100000; buy('future_ai'); sell('future_ai'); 1");
  check('매도 시 거래세 0.2% 반영', g.run("stock('future_ai').realizedProfit") === -500, g.run("stock('future_ai').realizedProfit"));
  check('거래세 반영 후 현금', Math.round(g.run('state.cash')) === 9999500, g.run('state.cash'));

  // 양도세: 연 250만원 공제 후 22% 원천징수
  g.run('state.cash = 10000000; state.realizedYTD = 0; state.taxedProfit = 0; state.taxPaid = 0; settleTax(3000000); 1');
  const tax1 = g.run('({cash: state.cash, paid: state.taxPaid, taxed: state.taxedProfit})');
  check('양도세 공제 초과분 22% 징수', Math.round(tax1.paid) === 110000, tax1.paid);
  check('양도세 납부 후 현금', Math.round(tax1.cash) === 9890000, tax1.cash);
  g.run('settleTax(1000000); 1');
  check('연간 누적 과세', Math.round(g.run('state.taxPaid')) === 330000, g.run('state.taxPaid'));

  // 예약 주문
  g.run(RESET(10000000) + `
    state.orders = []; state.marketOpen = true; state.loan = 0;
    stock('future_ai').price = 50000; stock('future_ai').own = 0; stock('future_ai').avgBuy = 0;
    state.orders.push({id:'o1', stockId:'future_ai', side:'buy', qty:2, limit:60000});
    state.orders.push({id:'o2', stockId:'future_ai', side:'buy', qty:1, limit:40000});
    processOrders();
    1;
  `);
  check('지정가 도달 주문 체결', g.run("stock('future_ai').own") === 2, g.run("stock('future_ai').own"));
  check('미도달 주문은 대기', g.run('state.orders.length') === 1 && g.run("state.orders[0].id") === 'o2', g.run('state.orders.length'));

  // 목표 달성
  g.run(RESET(30000000) + 'state.goals = {}; checkGoals(); 1');
  check('목표 달성 보상 지급', g.run('state.cash') === 30500000 && g.run('!!state.goals.m30') === true, g.run('state.cash'));
  g.run('checkGoals(); 1');
  check('목표 보상은 한 번만 지급', g.run('state.cash') === 30500000, g.run('state.cash'));

  // 배당
  g.run(RESET(0) + `
    state.cash = 0; state.usd = 0; state.loan = 0;
    stock('future_ai').own = 10; stock('future_ai').price = 100000; stock('future_ai').avgBuy = 100000;
    payDividends();
    1;
  `);
  check('배당금 지급', Math.round(g.run('state.cash')) === 1000, g.run('state.cash'));

  // 저장/불러오기 라운드트립
  g.run(`
    state.loan = 1500000; state.loanRate = 0.09; state.realizedYTD = 1234567;
    state.orders = [{id:'x', stockId:'future_ai', side:'sell', qty:3, limit:120000}];
    state.goals = {m30:true};
    saveGame();
    state.loan = 0; state.orders = []; state.goals = {}; state.realizedYTD = 0;
    loadGame();
    1;
  `);
  const rt = g.run('({loan: state.loan, rate: state.loanRate, orders: state.orders.length, goal: !!state.goals.m30, ytd: state.realizedYTD})');
  check('저장/불러오기: 대출 복원', rt.loan === 1500000 && rt.rate === 0.09, rt.loan);
  check('저장/불러오기: 주문·목표 복원', rt.orders === 1 && rt.goal === true, rt.orders);
  check('저장/불러오기: 실현손익 복원', rt.ytd === 1234567, rt.ytd);

  // 등급별 환전 수수료 우대
  g.run(RESET(100000000) + 'state.loan = 0; state.loanRate = 0; 1');
  check('골드 환전 수수료 0.7%', Math.abs(g.run('fxFeeRate()') - 0.007) < 1e-9, g.run('fxFeeRate()'));
  g.run(RESET(1000000) + '1');
  check('브론즈 환전 수수료 1%', Math.abs(g.run('fxFeeRate()') - 0.01) < 1e-9, g.run('fxFeeRate()'));

  // 차트 데이터
  check('스파크라인 좌표 생성', g.run("sparklineSVG(stock('future_ai')).includes('<polyline')") === true);
  check('가격 히스토리 기록', g.run("stock('future_ai').hist.push(1); stock('future_ai').hist.length > 1") === true);
}

// ── 5. 상위 등급 전용 상품에 전액 가입해도 가입 시점 이율이 확정되는지 ──────
// 현금을 먼저 차감하면 총자산이 줄어 등급이 내려가고, 플래티넘 전용 상품은
// 이율이 0으로 굳어 이자가 영원히 지급되지 않는 버그가 있었다.
{
  const g = createGame();
  g.run(RESET(300000000) + `
    state.loan = 0; state.loanRate = 0;
    product('etf').amount = 0; product('etf').rate = 0;
    document.getElementById('prod-etf').value = String(state.cash);
    join('etf');
    1;
  `);
  const after = g.run("({amount: product('etf').amount, rate: product('etf').rate, cash: state.cash, grade: currentGrade()})");
  check('전액 가입해도 가입 등급 이율 확정(ETF 8.5%)', Math.abs(after.rate - 0.085) < 1e-12, after.rate);
  check('전액 가입 후 현금 0·예금 전액 반영', after.cash === 0 && after.amount === 300000000, after.cash + '/' + after.amount);

  g.run('interest(); 1');
  const gained = g.run("product('etf').amount") - after.amount;
  check('전액 가입 후에도 이자 지급', gained > 0, gained.toFixed(2));

  // 골드 등급에서 채권 전액 가입도 가입 시점 이율(4%)로 고정
  const g2 = createGame();
  g2.run(RESET(100000000) + `
    state.loan = 0;
    product('bond').amount = 0; product('bond').rate = 0;
    document.getElementById('prod-bond').value = String(state.cash);
    join('bond');
    1;
  `);
  check('골드 채권 전액 가입 이율 확정(4%)', Math.abs(g2.run("product('bond').rate") - 0.04) < 1e-12, g2.run("product('bond').rate"));

  // 브론즈 사용자는 상위 상품 가입 불가(기존 동작 유지)
  const g3 = createGame();
  g3.run(RESET(10000000) + `
    product('etf').amount = 0; product('etf').rate = 0;
    document.getElementById('prod-etf').value = '1000000';
    join('etf');
    1;
  `);
  check('브론즈는 ETF 가입 차단', g3.run("product('etf').amount") === 0 && g3.alerts.length > 0, g3.run("product('etf').amount"));
}

// ── 6. 자산 대시보드·전액 상환·금액 요약 ─────────────────────────
{
  const g = createGame();
  g.run(RESET(10000000) + `
    state.loan = 0; state.loanRate = 0; state.usd = 0;
    state.marketSeconds = 0;
    assetHistory.points = []; assetHistory.peak = 0;
    1;
  `);

  check('금액 요약: 1.2억원', g.run('wonShort(123456789)') === '1.2억원', g.run('wonShort(123456789)'));
  check('금액 요약: 1.2조원', g.run('wonShort(1200000000000)') === '1.2조원', g.run('wonShort(1200000000000)'));
  check('금액 요약: 만원 단위', g.run('wonShort(12345678)') === '1,235만원', g.run('wonShort(12345678)'));

  g.run('recordAssetHistory(); state.cash = 20000000; recordAssetHistory(); 1');
  check('자산 추이 기록', g.run('assetHistory.points.length') === 2, g.run('assetHistory.points.length'));
  check('자산 고점 갱신', g.run('assetHistory.peak') === 20000000, g.run('assetHistory.peak'));
  check('추이 차트 SVG 생성', g.run('assetTrendSVG()').includes('<polygon') === true);
  g.run('for(let i=0;i<300;i++){ state.cash += 1000; recordAssetHistory(); } 1');
  check('추이 기록은 180개로 제한', g.run('assetHistory.points.length') === 180, g.run('assetHistory.points.length'));

  // 새로고침 직후처럼 기록이 1개뿐이면 시작 금액을 끼워 넣은 가짜 선을 그리지 않는다.
  g.run('assetHistory.points = []; recordAssetHistory(); 1');
  check('기록 1개면 추이선 없음', g.run('assetTrendSVG()') === '', g.run('assetTrendSVG()'));
  g.run('portfolio(); 1');
  const trendHtml = g.run("document.getElementById('portfolio').innerHTML");
  check('기록 1개면 그래프 대신 안내', trendHtml.includes('자산 기록을 모으는 중') && !trendHtml.includes('<polyline'));
  check('기록 1개면 구간 수익률 숨김', trendHtml.includes('기록 수집 중') && !trendHtml.includes('구간 수익률'));
  g.run('state.cash += 1000000; recordAssetHistory(); 1');
  check('기록 2개면 추이선 표시', g.run('assetTrendSVG()').includes('<polyline') === true);

  // 자산 배분: 현금 500만 + 주식 500만 → 각 50%
  g.run(RESET(5000000) + `
    state.loan = 0; state.usd = 0;
    stock('future_ai').own = 10; stock('future_ai').price = 500000;
    stock('future_ai').avgBuy = 500000;
    1;
  `);
  const alloc = g.run('allocation()');
  check('자산 배분 비중 합 100%', Math.abs(alloc.parts.reduce((a, p) => a + p.pct, 0) - 100) < 1e-9);
  check('자산 배분 현금·주식 50%', Math.abs(alloc.parts[0].pct - 50) < 1e-6 && Math.abs(alloc.parts[2].pct - 50) < 1e-6, alloc.parts.map(p => p.pct.toFixed(1)).join('/'));

  // 배당 예상: 국내 10주 × 10만원 × 0.1%
  g.run(RESET(0) + `
    state.cash = 0; state.usd = 0; state.loan = 0;
    stocks.forEach(s => { s.own = 0; });
    stock('future_ai').own = 10; stock('future_ai').price = 100000;
    state.marketSeconds = 30;
    1
  `);
  check('예상 배당금 계산', Math.round(g.run('expectedDividend()')) === 1000, g.run('expectedDividend()'));
  check('다음 배당까지 남은 시간', g.run('secondsToDividend()') === 90, g.run('secondsToDividend()'));

  // 전액 상환
  g.run(RESET(10000000) + `
    state.loan = 3000000; state.loanRate = 0.09;
    repayLoanFull();
    1
  `);
  const repaid = g.run('({loan: state.loan, rate: state.loanRate, cash: state.cash})');
  check('전액 상환 후 대출 0', repaid.loan === 0 && repaid.rate === 0, repaid.loan);
  check('전액 상환 후 현금 차감', Math.round(repaid.cash) === 7000000, repaid.cash);

  // 대시보드 렌더
  g.run(RESET(10000000) + 'state.loan = 0; portfolio(); loanPage(); 1');
  const html = g.run("document.getElementById('portfolio').innerHTML");
  check('내 자산 대시보드 렌더', html.includes('순자산') && html.includes('다음 배당') && html.includes('alloc-bar'));
  const loanHtml = g.run("document.getElementById('loan').innerHTML");
  check('전액 상환 버튼 렌더', loanHtml.includes('repayLoanFull()'));

  // clearGame이 추이 기록을 초기화
  g.run(RESET(10000000) + 'recordAssetHistory(); state.cash = 50000000; recordAssetHistory(); clearGame(true); 1');
  check('초기화 시 추이 기록 리셋', g.run('assetHistory.points.length') === 1, g.run('assetHistory.points.length'));

  // 자산이 0인 상태에서도 NaN 없이 대시보드가 그려지는지
  g.run('state.cash = 0; state.usd = 0; state.loan = 0; products.forEach(p => { p.amount = 0; p.rate = 0; }); stocks.forEach(s => { s.own = 0; s.avgBuy = 0; }); assetHistory.points = []; assetHistory.peak = 0; portfolio(); 1');
  const emptyHtml = g.run("document.getElementById('portfolio').innerHTML");
  check('자산 0원 대시보드에 NaN 없음', !emptyHtml.includes('NaN'), (emptyHtml.match(/NaN/g) || []).length);
  check('자산 0원 배분 비중 0%', g.run('allocation().parts.every(p => p.pct === 0)') === true);
}

// ── 7. 관심종목·알림·저널·자동화·미션·속도·오프라인·지수·PWA ──────────
{
  const g = createGame();
  g.run(RESET(10000000) + `
    state.loan = 0; state.loanRate = 0; state.usd = 0;
    state.watch = []; state.journal = []; state.alerts = [];
    state.achievements = Object.fromEntries(ACHIEVEMENTS.map(a=>[a.id,true]));
    state.dividendTotal = 0; state.feesTotal = 0; state.loanTotal = 0;
    state.daily = {date:"", counts:{}, claimed:{}};
    state.notify = {order:true,dividend:true,goal:true,grade:true,tax:true,sound:false,haptic:false};
    state.auto = {enabled:false, stockPct:60, minCash:1000000, every:60};
    1;
  `);

  // 관심종목·검색·정렬
  g.run("toggleWatch('future_ai'); 1");
  check('관심종목 추가', g.run("isWatched('future_ai')") === true && g.run('state.watch.length') === 1);
  g.run("stockView.watchOnly=true; 1");
  check('관심종목만 보기', g.run("visibleStocks('domestic').length") === 1, g.run("visibleStocks('domestic').length"));
  g.run("stockView.watchOnly=false; stockView.query='반도체'; 1");
  check('종목 검색', g.run("visibleStocks('domestic').every(s=>(s.theme+s.name).includes('반도체'))") === true);
  g.run("stockView.query=''; toggleWatch('future_ai'); 1");
  check('관심종목 해제', g.run('state.watch.length') === 0);

  // 알림
  g.run("state.alerts=[]; notify('dividend','테스트 배당','1,000원'); 1");
  check('알림 저장', g.run('state.alerts.length') === 1 && g.run("state.alerts[0].title") === '테스트 배당');
  g.run("state.notify.dividend=false; state.alerts=[]; notify('dividend','꺼짐','x'); 1");
  check('알림 종류별 끄기', g.run('state.alerts.length') === 0);
  g.run("state.notify.dividend=true; state.alerts=[]; notify('tax','세금','1원'); openNotifModal(); 1");
  check('알림 센터 읽음 처리', g.run('state.alerts.every(a=>a.read)') === true);

  // 거래 저널·성과
  g.run("state.journal=[]; state.feesTotal=0; state.realizedYTD=0; state.taxedProfit=0; state.cash=10000000; 1");
  g.run("stock('future_ai').price=100000; stock('future_ai').start=100000; stock('future_ai').own=0; buy('future_ai'); stock('future_ai').price=120000; sell('future_ai'); 1");
  const perf = g.run('performanceStats()');
  check('거래 저널 기록', perf.trades === 2, perf.trades);
  check('매도 승률 계산', Math.abs(perf.winRate - 1) < 1e-9, perf.winRate);
  check('실현손익 집계', perf.realized > 0, Math.round(perf.realized));
  check('수수료 누적', perf.fees > 0, perf.fees.toFixed(1));

  // 자동 적립
  g.run("state.cash=100000000; state.usd=0; stocks.forEach(s=>{s.own=0;s.avgBuy=0}); products.forEach(p=>{p.amount=0;p.rate=0}); state.auto={enabled:true,stockPct:60,minCash:1000000,every:60}; autoInvest(true); 1");
  const auto = g.run("({cash: state.cash, stock: stockValueKRW(), prod: productValueKRW(), own: stocks.filter(s=>s.own>0).length})");
  check('자동 적립 주식 매수', auto.stock > 0 && auto.own > 0, Math.round(auto.stock));
  check('자동 적립 최소 현금 유지', auto.cash >= 1000000 - 1, Math.round(auto.cash));
  check('자동 적립 예금 분배', auto.prod > 0, Math.round(auto.prod));

  // 일일 미션
  g.run("state.daily={date:todayKey(),counts:{},claimed:{}}; const miss=dailyMissions()[0]; state.daily.counts[miss.id]=miss.target; 1");
  const missionId = g.run('dailyMissions()[0].id');
  const cashBefore = g.run('state.cash');
  g.run(`claimDaily('${missionId}'); 1`);
  check('일일 미션 보상 수령', g.run(`!!state.daily.claimed['${missionId}']`) === true);
  check('일일 미션 보상 지급', g.run('state.cash') > cashBefore, g.run('state.cash') - cashBefore);
  const cashAfterClaim = g.run('state.cash');
  g.run(`claimDaily('${missionId}'); 1`);
  check('일일 미션 중복 수령 방지', g.run('state.cash') === cashAfterClaim, g.run('state.cash'));

  // 업적
  g.run("state.achievements={}; state.journal=[{side:'buy',name:'x',qty:1,valueKRW:1,profit:0}]; checkAchievements(); 1");
  check('업적 달성 처리', g.run('!!state.achievements.first_trade') === true);

  // 속도·일시정지
  g.run('setSpeed(10); state.paused=false; state.marketSeconds=0; gameLoop(); 1');
  check('속도는 최대 5배속으로 제한', g.run('speedNow()') === 5 && g.run('state.speed') === 5, g.run('state.speed'));
  check('5배속에서 게임 시간 5초 진행', g.run('state.marketSeconds') === 5, g.run('state.marketSeconds'));
  g.run('state.paused=true; const beforePause=state.marketSeconds; gameLoop(); state.paused=false; 1');
  check('일시정지 중 시간 정지', g.run('state.marketSeconds') === 5, g.run('state.marketSeconds'));

  // 배속에서도 화면 카운트다운은 실제 시간 기준으로 1초씩 줄어야 합니다.
  g.run('state.speed=3; state.paused=false; state.marketSeconds=0; state.marketOpen=true; tickSeconds(); tickSeconds(); tickSeconds(); 1');
  const bar3 = g.run("document.getElementById('marketTimeBar').textContent");
  check('3배속 장중 카운트다운 실제 초', bar3.includes('실제 59초') && bar3.includes('3x'), bar3);
  check('게임 시간→실제 초 환산', g.run('realSeconds(179)') === 60 && g.run('realSeconds(90)') === 30 && g.run('realSeconds(0)') === 0, g.run('realSeconds(179)'));

  g.run('setSpeed(5); state.marketSeconds=180; tickSeconds(); 1');
  const bar10 = g.run("document.getElementById('marketTimeBar').textContent");
  check('5배속 휴장 카운트다운 실제 초', bar10.includes('실제 12초') && bar10.includes('5x'), bar10);
  g.run('state.speed=3; state.marketSeconds=300; product("deposit").amount=1000000; product("deposit").startedAt=0; product("deposit").term=600; product("deposit").matured=false; 1');
  check('상품 만기 카운트다운 실제 초', g.run('productMaturityText(product("deposit"))') === '실제 100초 남음', g.run('productMaturityText(product("deposit"))'));

  g.run('state.paused=true; updateSpeedUI(); 1');
  check('일시정지 시장 바 표시', g.run("document.getElementById('marketTimeBar').textContent").includes('일시정지'));
  g.run('state.marketSeconds=180; state.marketOpen=false; state.paused=false; updateSpeedUI(); 1');
  check('재개 시 시장 바 즉시 복원', g.run("document.getElementById('marketTimeBar').textContent").includes('휴장 중'));

  // 경기 전환 타이머는 tickAlt(15게임초)마다 15초씩 줄어야 합니다.
  g.run(`
    state.economy={phase:'중립',baseRate:.03,cycleLeft:30,rateAdj:0};
    state.marketSeconds=60; state.estate={}; state.company=null;
    state.metals={gold:{qty:0,avg:0},silver:{qty:0,avg:0}};
    state.rewardedGrade=7; tickAlt();
    1
  `);
  check('경기 전환 타이머 15초 감소', g.run('state.economy.cycleLeft') === 15, g.run('state.economy.cycleLeft'));

  // 전체 초기화는 경제 국면과 부동산 가격도 새 게임 기본값으로 돌려야 합니다.
  g.run('state.economy={phase:"호황",baseRate:.08,cycleLeft:7,rateAdj:.004}; state.altPrices={apt:999999999}; clearGame(true); 1');
  check('초기화 시 경제·부동산 가격 리셋', g.run('state.economy.phase') === '중립' && g.run('state.economy.cycleLeft') === 90 && !g.run('state.altPrices.apt'), g.run('state.economy.phase') + '/' + g.run('state.economy.cycleLeft'));

  // 다중 탭 저장 충돌 가드
  g.run('localStorage.setItem("money_playground_save","SENTINEL"); multiTab=false; handleExternalSave(); saveGame(); 1');
  check('다른 탭 감지 시 저장 중단', g.run('localStorage.getItem("money_playground_save")') === 'SENTINEL', g.run('localStorage.getItem("money_playground_save")'));
  check('다른 탭 감지 시 일시정지', g.run('multiTab') === true && g.run('state.paused') === true);
  g.run('multiTab=false; state.paused=false; 1');

  // 오프라인 정산(최대 2시간)
  g.run(`
    products.forEach(p=>{p.amount=0;p.rate=0});
    product('deposit').amount=10000000; product('deposit').rate=0.042;
    state.cash=0; state.usd=0; state.loan=0; stocks.forEach(s=>{s.own=0});
    state.dividendTotal=0; state.lastSeen=Date.now()-3600*1000;
    1
  `);
  const off = g.run('applyOfflineProgress()');
  check('오프라인 이자 정산', !!off && off.interest > 0, off && Math.round(off.interest));
  check('오프라인 정산 상한 2시간', !!off && off.sec <= 7200, off && off.sec);

  // 시장 지수·ETF
  g.run("stocks.forEach(s=>{s.price=s.start}); 1");
  check('시장 지수 기준 1000', Math.abs(g.run('marketIndex()') - 1000) < 1e-9, g.run('marketIndex()'));
  g.run('tickMarket(); 1');
  check('ETF가 지수를 추종', Math.abs(g.run("stock('market_etf').price") - Math.max(100, Math.round(g.run('marketIndex()')*10/100)*100)) < 1, g.run("stock('market_etf').price"));

  // 확장 필드 저장/복원
  g.run("state.watch=['future_ai']; state.auto={enabled:true,stockPct:40,minCash:500000,every:60}; state.notify.sound=true; state.journal=[{side:'buy',name:'x',qty:1,valueKRW:1,profit:0}]; state.achievements={x:true}; saveGame(); state.watch=[]; state.auto.enabled=false; state.journal=[]; state.achievements={}; state.notify.sound=false; loadGame(); 1");
  check('관심종목 저장/복원', g.run('state.watch.length') === 1 && g.run("state.watch[0]") === 'future_ai');
  check('자동 적립 설정 저장/복원', g.run('state.auto.enabled') === true && g.run('state.auto.stockPct') === 40);
  check('알림 설정 저장/복원', g.run('state.notify.sound') === true);
  check('저널·업적 저장/복원', g.run('state.journal.length') === 1 && g.run('state.achievements.x') === true);

  // 결산 리포트
  g.run('state.seasonBase=10000000; state.seasonBaseIndex=1000; state.cash=20000000; 1');
  check('결산 리포트 생성', g.run('reportHTML()').includes('시장 대비') && g.run('reportHTML()').includes('매도 승률'));
}

// ── 8. PWA 파일 ────────────────────────────────
{
  const root = path.join(__dirname, '..');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
  check('PWA 매니페스트', manifest.name.includes('머니') && manifest.display === 'standalone');
  const swSource = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  check('PWA 서비스워커 파일', swSource.includes('addEventListener("fetch"'));
  check('서비스워커는 API 응답을 캐시하지 않음', swSource.includes('url.pathname.includes("/api/")') && swSource.includes('url.origin !== self.location.origin'));
  check('서비스워커가 HTML을 HTTP 캐시 없이 새로 받음', /cache:\s*"no-store"/.test(swSource) && swSource.includes('request.mode === "navigate"'));
  check('서비스워커 등록이 HTTP 캐시를 건너뜀', html.includes('updateViaCache:"none"'));
  check('새 서비스워커 적용 시 새로고침', html.includes('controllerchange'));
  check('업데이트된 서비스워커가 열린 탭에 알림', swSource.includes('clients.matchAll') && swSource.includes('c.postMessage(') && !swSource.includes('c.navigate('));
  check('새 버전은 저장 후 안전한 시점에 적용', html.includes('swUpdateApply') && html.includes('MPG_SW_UPDATE') && html.includes('function swUpdateBusy'));
  // 게임 모달은 .modal.on으로 열리므로 이 셀렉터가 반드시 포함되어야 합니다.
  check('게임 모달(#modalRoot.on)을 거래 중으로 감지', html.includes('#modalRoot.on'));
  check('업데이트 때는 열린 탭의 제어를 빼앗지 않음', swSource.includes('isUpdate ? null : self.clients.claim()'));
  check('PWA 아이콘', fs.existsSync(path.join(root, 'icon.svg')));
  check('index.html PWA 연결', html.includes('rel="manifest"') && html.includes('serviceWorker'));
}

// ── 9. 리더보드 시즌 키 · 기기 클라우드 클라이언트 제거 확인 ──────
{
  const g = createGame();
  check('시즌 키 YYYY-MM', /^\d{4}-\d{2}$/.test(g.run('seasonKey()')), g.run('seasonKey()'));
  check('기기 클라우드 클라이언트가 남아 있지 않음', ['cloudConfigured', 'cloudPanelHTML', 'openGlobalRanking', 'cloudCall', 'CLOUD_API'].every(n => g.run(`typeof ${n}`) === 'undefined'));
  const board = g.run(`(()=>{ leaderboardPage(); return document.getElementById('leaderboard').innerHTML||''; })()`);
  check('리더보드는 Google 로그인 기준', board.includes('Google 계정으로 로그인') && !board.includes('기기 클라우드'), board.slice(0, 60));
  check('저장 데이터에 클라우드 연결 정보가 없음', !('cloud' in g.run('buildSaveData().state')) && !g.run('JSON.stringify(buildSaveData())').includes('mp_cloud_creds'));
}

// ── 10. 대규모 확장: 8단계 등급·부동산·금은·기업·주간 미션·만기·설정 ──
{
  const g = createGame();
  g.run(RESET(10000000) + `
    state.estate={}; state.metals={gold:{qty:0,avg:0},silver:{qty:0,avg:0}}; state.company=null;
    state.altPrices={}; state.economy={phase:"중립",baseRate:.03,cycleLeft:99,rateAdj:0};
    1
  `);
  g.run('state.cash=500000000; 1');
  check('다이아몬드 등급', g.run('currentGrade()') === '다이아몬드', g.run('currentGrade()'));
  g.run('state.cash=1000000000; 1');
  check('마스터 등급', g.run('currentGrade()') === '마스터', g.run('currentGrade()'));
  g.run('state.cash=10000000000; 1');
  check('레전드 등급', g.run('currentGrade()') === '레전드', g.run('currentGrade()'));
  check('레전드 칭호', g.run('currentTitle()') === '전설의 투자자', g.run('currentTitle()'));

  // 부동산 가치·매수
  g.run('state.cash=100000000; state.estate={apt:{qty:1,avgBuy:300000000}}; state.altPrices={apt:300000000}; 1');
  check('부동산이 순자산에 포함', Math.round(g.run('totalAssetsKRW()')) === 400000000, g.run('totalAssetsKRW()'));
  check('자산 배분에 부동산', g.run('allocation().parts.some(p=>p.label==="부동산"&&p.value>0)') === true);
  g.run('state.cash=400000000; state.estate={}; state.altPrices={apt:300000000}; buyEstate("apt"); 1');
  check('부동산 매수', g.run('state.estate.apt.qty') === 1 && Math.round(g.run('state.cash')) === 100000000, g.run('state.cash'));

  // 금 매수
  g.run('state.cash=1000000; state.metals={gold:{qty:0,avg:0},silver:{qty:0,avg:0}}; document.getElementById("metal-qty-gold").value="10"; buyMetal("gold"); 1');
  check('금 매수', g.run('state.metals.gold.qty') === 10 && g.run('metalValue()') > 0, g.run('state.metals.gold.qty'));

  // 기업 설립·확장
  g.run('state.estate={}; state.metals={gold:{qty:0,avg:0},silver:{qty:0,avg:0}}; state.cash=100000000; state.company=null; foundCompany(); 1');
  check('기업 설립', g.run('!!state.company') === true && Math.round(g.run('totalAssetsKRW()')) === 100000000, g.run('totalAssetsKRW()'));
  g.run('state.cash=100000000; expandCompany(); 1');
  check('기업 확장', g.run('state.company.level') === 2, g.run('state.company.level'));

  // 만기 보너스
  g.run('state.estate={}; state.metals={gold:{qty:0,avg:0},silver:{qty:0,avg:0}}; state.company=null; state.cash=30000000; state.marketSeconds=0; state.economy.rateAdj=0; products.forEach(p=>{p.amount=0;p.rate=0;p.bank=null;p.startedAt=null;p.matured=false}); document.getElementById("prod-deposit").value="1000000"; document.getElementById("bank-deposit").value=""; join("deposit"); 1');
  check('예금 가입 이율 확정', Math.abs(g.run('product("deposit").rate') - 0.02) < 1e-9, g.run('product("deposit").rate'));
  g.run('state.marketSeconds=600; interest(); 1');
  check('만기 보너스 지급', g.run('product("deposit").matured') === true && g.run('product("deposit").amount') > 1000000, g.run('product("deposit").amount'));

  // 은행별 금리
  g.run('state.estate={}; state.metals={gold:{qty:0,avg:0},silver:{qty:0,avg:0}}; state.company=null; state.cash=30000000; products.forEach(p=>{p.amount=0;p.rate=0;p.bank=null;p.startedAt=null;p.matured=false}); document.getElementById("prod-deposit").value="1000000"; document.getElementById("bank-deposit").value="jeil"; join("deposit"); 1');
  check('은행별 금리 경쟁', Math.abs(g.run('product("deposit").rate') - 0.0232) < 1e-9, g.run('product("deposit").rate'));

  // 주간 미션
  g.run('state.weekly={key:isoWeekKey(),counts:{trades:20},claimed:{}}; state.cash=0; claimWeekly("trades"); 1');
  check('주간 미션 보상', g.run('state.cash') === 1200000, g.run('state.cash'));

  // 자동 배분
  g.run('state.cash=100000000; state.estate={}; state.metals={gold:{qty:0,avg:0},silver:{qty:0,avg:0}}; state.auto={enabled:true,stockPct:0,minCash:0,goldPct:50,estatePct:0,every:60}; autoInvest(true); 1');
  check('자동 배분 금 매수', g.run('state.metals.gold.qty') > 0, g.run('state.metals.gold.qty'));

  // 거래 검색·필터
  g.run("state.journal=[{at:1,name:'미래AI전자',side:'buy',qty:1,valueKRW:100,profit:0},{at:2,name:'한빛반도체',side:'sell',qty:1,valueKRW:200,profit:50}]; state.journalFilter={q:'미래',side:'all'}; 1");
  check('거래 검색', g.run('journalFiltered().length') === 1, g.run('journalFiltered().length'));
  g.run("state.journalFilter={q:'',side:'sell'}; 1");
  check('거래 필터', g.run('journalFiltered().length') === 1);

  // 설정·저장 복원
  g.run("setSetting('theme','dark'); 1");
  check('다크 테마 저장', g.run('state.settings.theme') === 'dark');
  g.run('state.peakNet=123456789; state.targetGoal=2000000000; state.estate={apt:{qty:2,avgBuy:300000000}}; saveGame(); state.estate={}; state.peakNet=0; loadGame(); 1');
  check('확장 자산 저장/복원', g.run('state.estate.apt.qty') === 2 && g.run('state.peakNet') >= 123456789, g.run('state.estate.apt.qty') + '/' + g.run('state.peakNet'));

  // 임대 수익·유지비 틱
  g.run(`
    state.cash=0; state.estate={apt:{qty:1,avgBuy:300000000}}; state.altPrices={apt:300000000};
    state.metals={gold:{qty:0,avg:0},silver:{qty:0,avg:0}};
    state.special={sp_estate:true,sp_company:true,sp_billion:true,sp_gold:true}; state.company=null;
    state.rewardedGrade=7; state.marketSeconds=60; state.economy.cycleLeft=99;
    tickAlt();
    1
  `);
  const rentExpected = g.run('state.estate.apt.qty*estatePrice("apt")*(.0007-.00016)');
  check('부동산 월세·유지비 정산', Math.abs(g.run('state.cash') - rentExpected) < 1, g.run('state.cash') + ' vs ' + rentExpected.toFixed(2));

  // 기업 배당 틱
  g.run(`
    state.cash=0; state.estate={}; state.marketSeconds=30;
    state.metals={gold:{qty:0,avg:0},silver:{qty:0,avg:0}};
    state.special={sp_estate:true,sp_company:true,sp_billion:true,sp_gold:true};
    state.company={name:'테스트기업',level:1,valuation:50000000,revenue:2000000,profit:1000000,payout:0.5};
    state.rewardedGrade=7; state.economy.cycleLeft=99;
    tickAlt();
    1
  `);
  check('기업 배당 지급', Math.round(g.run('state.cash')) === 500000, g.run('state.cash'));

  // 오프라인 임대 정산
  g.run(`
    state.estate={apt:{qty:1,avgBuy:300000000}}; state.altPrices={apt:300000000};
    state.cash=0; state.company=null; products.forEach(p=>{p.amount=0});
    state.lastSeen=Date.now()-3600*1000;
    1
  `);
  const off = g.run('applyOfflineProgress()');
  check('오프라인 임대 수익 정산', off && off.rent > 0 && off.sec <= 7200, off && Math.round(off.rent));

  // 자동 배분: 부동산
  g.run(`
    state.cash=1000000000; state.estate={}; state.metals={gold:{qty:0,avg:0},silver:{qty:0,avg:0}};
    state.auto={enabled:true,stockPct:0,minCash:0,goldPct:0,estatePct:100,every:60};
    autoInvest(true);
    1
  `);
  check('자동 배분 부동산 매수', g.run('Object.keys(state.estate).length') > 0, g.run('JSON.stringify(state.estate)'));

  // 자동 매매(익절)와 알림 설정
  g.run(`
    state.marketOpen=true; state.cash=0; state.loan=0; state.realizedYTD=0; state.taxedProfit=0;
    stocks.forEach(s=>{s.own=0;s.avgBuy=0;s.realizedProfit=0});
    const s=stock('future_ai'); s.own=10; s.avgBuy=100000; s.price=130000;
    state.auto={enabled:true,autoSell:true,takeProfit:20,stopLoss:10,stockPct:0,minCash:0,every:60};
    autoSellRules();
    1
  `);
  check('자동 매매 익절', g.run("stock('future_ai').own") === 0 && g.run('state.cash') > 0, Math.round(g.run('state.cash')));
  g.run("setNotify('dividend',false); 1");
  check('알림 설정 저장', g.run('state.notify.dividend') === false);
  g.run("setNotify('dividend',true); portfolio(); 1");
  check('포트폴리오에 클라우드 저장·랭킹 섹션이 없음', !g.run("document.getElementById('portfolio').innerHTML").includes('클라우드 저장·랭킹'));
}

// ── 11. 고정 시드 1시간 시뮬레이션(자산 폭주 회귀) ─────────────────
{
  const { runSimulation } = require('./simulate-1h');
  const seed = 20261123;
  const hourA = runSimulation({ seconds: 3600, seed });
  const hourB = runSimulation({ seconds: 3600, seed });
  check('고정 시드 시뮬레이션 재현', hourA.end.total === hourB.end.total && hourA.max === hourB.max, Math.round(hourA.end.total));
  // 시장 기대 수익을 소폭 올린 뒤(주가 상·하한 제거) 1시간 최대치가 1.5B를 살짝 넘습니다.
  // 폭주(1시간에 2배 이상)를 잡는 것이 목적이므로 상한만 1.75B로 맞췄습니다.
  check('1배속 1시간 자산 폭주 없음', hourA.end.total > 600000000 && hourA.end.total < 1750000000 && hourA.max < 1750000000, Math.round(hourA.end.total) + '/' + Math.round(hourA.max));

  const stress = runSimulation({ seconds: 36000, seed });
  check('10배속 1시간 자산 폭주 없음', stress.end.total > 0 && stress.end.total < 2200000000 && stress.max < 2200000000, Math.round(stress.end.total) + '/' + Math.round(stress.max));

  const deposit = runSimulation({ seconds: 36000, seed, mode: 'deposit' });
  check('10억 예금 10배속 1시간 폭주 없음', deposit.end.total > 0 && deposit.end.total < 2000000000, Math.round(deposit.end.total));

  check('시뮬레이션 손익 유한값', [hourA, stress, deposit].every(r => Number.isFinite(r.end.total) && Number.isFinite(r.max)), 'finite');
}

// ── 12. 노동·생계 시스템 ──────────────────────────────────────
{
  const g = createGame();
  // 판정 사이에는 반드시 다음 회차를 열어야 합니다. 연타로 회차를 건너뛰지 못하는지도 함께 검증합니다.
  const laborPlayShift=(game,pos=".5")=>game.run(`laborStopAt(${pos}); if(laborSession) laborBeginRound(); laborStopAt(${pos}); if(laborSession) laborBeginRound(); laborStopAt(${pos}); 1`);
  g.run(`
    clearGame(true);
    state.cash=0; state.usd=0; state.loan=0;
    state.labor={shifts:0,earned:0,lastAt:{},warned:false};
    portfolio();
    1;
  `);
  const brokeHtml = g.run("document.getElementById('portfolio').innerHTML");
  check('노동 섹션·12종 직업 렌더', brokeHtml.includes('labor-section') && brokeHtml.includes('편의점 야간') && brokeHtml.includes('주방 보조') && brokeHtml.includes('재고 조사') && brokeHtml.includes('세무 보조') && brokeHtml.includes('긴급 외주') && brokeHtml.includes('전략 컨설팅') && g.run('LABOR_JOBS.length') === 12);
  g.run("state.ui.assetTab='journal'; openLabor(); 1");
  check('노동 진입 시 자산 개요 탭', g.run('state.ui.assetTab') === 'overview', g.run('state.ui.assetTab'));
  check('노동 미니게임 안내 문구', brokeHtml.includes('타이밍 작업 3회') && brokeHtml.includes('완벽 100%'));
  check('현금 0원 생계 위기 안내', brokeHtml.includes('현금과 자산이 바닥났습니다') && g.run('laborEmergency()') === true);

  // 잠긴 직업은 현금을 주지 않습니다.
  g.run("workLabor('delivery'); 1");
  check('경력 부족 직업 잠금', g.run('state.cash') === 0 && g.run('state.labor.shifts') === 0, g.run('state.cash'));

  // 노동 미니게임 판정·일당 계산 (타이밍 작업 3회)
  check('노동 판정: 중앙 완벽', g.run("laborRoundResult({pay:60000,zone:.2},.5).grade") === 'perfect');
  check('노동 판정: 구간 안 성공', g.run("laborRoundResult({pay:60000,zone:.2},.62).grade") === 'good');
  check('노동 판정: 구간 밖 실패', g.run("laborRoundResult({pay:60000,zone:.2},.1).grade") === 'miss');
  check('노동 일당: 3회 완벽', g.run("laborShiftPay({pay:60000},['perfect','perfect','perfect']).pay") === 60000);
  check('노동 일당: 성과만큼 삭감', g.run("laborShiftPay({pay:60000},['perfect','good','miss']).pay") === 33000, g.run("laborShiftPay({pay:60000},['perfect','good','miss']).pay"));
  check('노동 일당: 전부 실패면 0원', g.run("laborShiftPay({pay:60000},['miss','miss','miss']).pay") === 0);

  // 버튼만 눌러서는 돈이 들어오지 않고, 작업 3회를 마쳐야 일당이 지급됩니다.
  const started = g.run("workLabor('convenience')");
  check('노동 시작만으로는 미지급', started === true && g.run('state.cash') === 0 && g.run('state.labor.shifts') === 0, g.run('state.cash'));
  g.run("laborStopAt(.5); if(laborSession) laborBeginRound(); laborStopAt(.5); 1");
  check('작업 2회까지 미지급', g.run('state.cash') === 0 && g.run('state.labor.shifts') === 0);
  g.run("if(laborSession) laborBeginRound(); laborStopAt(.5); 1");
  check('기본 노동 수입 지급', g.run('state.cash') === 60000 && g.run('state.labor.shifts') === 1 && g.run('state.labor.earned') === 60000, g.run('state.cash'));

  g.run("workLabor('convenience'); 1");
  check('쿨다운 중 중복 노동 차단', g.run('state.cash') === 60000 && g.run('state.labor.shifts') === 1, g.run('state.cash'));

  g.run("workLabor('cafe'); 1");
  laborPlayShift(g);
  check('두 번째 기본 노동으로 최소 생활비 달성', g.run('state.cash') === 110000 && g.run('state.labor.shifts') === 2 && g.run('laborEmergency()') === false, g.run('state.cash'));

  g.run("workLabor('delivery'); 1");
  laborPlayShift(g);
  check('경력 2회에 퀵배달 해금', g.run('state.cash') === 210000 && g.run('state.labor.shifts') === 3, g.run('state.cash'));

  // 작업을 모두 놓치면 일당도 경력도 없고, 바로 재도전할 수 있습니다.
  const gf = createGame();
  gf.run("clearGame(true); state.cash=0; state.labor={shifts:0,earned:0,lastAt:{},warned:false}; workLabor('convenience'); 1");
  laborPlayShift(gf,0);
  check('전부 실패하면 일당·경력 없음', gf.run('state.cash') === 0 && gf.run('state.labor.shifts') === 0, gf.run('state.cash'));
  check('실패 후 쿨다운 없이 재도전', gf.run("laborRemaining(laborJob('convenience'))") === 0 && gf.run("workLabor('convenience')") === true);

  const gh = createGame();
  gh.run("clearGame(true); state.cash=0; state.labor={shifts:10,earned:0,lastAt:{},warned:false}; workLabor('freelance'); 1");
  laborPlayShift(gh,0);
  check('고임금 노동 실패는 복귀 쿨다운', gh.run('state.cash') === 0 && gh.run('state.labor.shifts') === 10 && gh.run("laborRemaining(laborJob('freelance'))") > 0, gh.run("laborRemaining(laborJob('freelance'))"));

  // 표시선이 중앙에서 시작하면 열자마자 3연타로 만점이 나왔으므로 왼쪽 끝에서 출발합니다.
  check('노동 시작 위치는 왼쪽 끝', gf.run('laborSession.pos') === 0 && gf.run("laborRoundResult(laborJob('convenience'),laborSession.pos).grade") === 'miss', gf.run('laborSession.pos'));
  gf.run('laborStop(); laborStop(); laborStop(); 1');
  check('시작 직후 연타는 일당 0원', gf.run('state.cash') === 0 && gf.run('state.labor.shifts') === 0, gf.run('state.cash'));
  gf.run('laborAbortShift(true); 1');
  gf.run("workLabor('convenience'); laborStopAt(.5); 1");
  check('판정 후 표시선을 다시 왼쪽 끝으로', gf.run('laborSession.pos') === 0 && gf.run('laborSession.results[0].grade') === 'perfect', gf.run('laborSession.pos'));

  // 일시정지 중 멈추기 버튼을 연타해도 한 회차의 완벽 판정이 3회로 복제되지 않아야 합니다.
  const spam = createGame();
  spam.run("clearGame(true); state.cash=0; state.labor={shifts:0,earned:0,lastAt:{},warned:false}; state.paused=true; workLabor('convenience'); 1");
  spam.run("laborStopAt(.5); laborStopAt(.5); laborStopAt(.5); laborStopAt(.5); 1");
  check('일시정지 연타로 완벽 3회 복제 방지', spam.run('laborSession.results.length') === 1 && spam.run('laborSession.round') === 1 && spam.run('state.cash') === 0 && spam.run('state.labor.shifts') === 0, JSON.stringify(spam.run('({results:laborSession.results,round:laborSession.round,cash:state.cash,shifts:state.labor.shifts})')));

  // 경력이 쌓이면 고소득 노동이 열립니다.
  g.run("state.labor.shifts=10; state.labor.lastAt={}; workLabor('freelance'); 1");
  laborPlayShift(g);
  // 일당은 경력 레벨 배율이 붙어 정확한 금액 대신 "지급되었는지"를 확인합니다.
  const freelancePay = g.run('state.cash');
  check('경력 10회에 긴급 외주 해금', freelancePay > 0 && g.run('state.labor.shifts') === 11, freelancePay);
  check('노동 경력·수입 저장', g.run('buildSaveData().state.labor.shifts') === 11 && g.run('buildSaveData().state.labor.earned') === freelancePay, freelancePay);

  const saved = JSON.parse(JSON.stringify(g.run('buildSaveData()')));
  const g2 = createGame();
  g2.run('applySaveData(' + JSON.stringify(saved) + '); 1');
  check('노동 저장 복원', g2.run('state.labor.shifts') === 11 && g2.run('state.labor.earned') === freelancePay, g2.run('state.labor.shifts'));

  g2.run('clearGame(true); 1');
  check('초기화 시 노동 경력 리셋', g2.run('state.labor.shifts') === 0 && g2.run('state.labor.earned') === 0);

  // 노동 필드가 없던 구버전 저장도 기본값으로 복구합니다.
  const g3 = createGame();
  g3.run('delete state.labor; applySaveData({state:{cash:5000}}); 1');
  check('구버전 저장 노동 기본값 보정', g3.run('state.labor.shifts') === 0 && g3.run('state.labor.earned') === 0 && !!g3.run('state.labor.lastAt'));
}

// ── 13. 경제 지표·기업 등급·실적·투자 성향 ───────────────────
{
  const g = createGame();
  g.run('clearGame(true); 1');
  check('경제 지표 기본값', g.run('state.economy.inflation') === 0.025 && g.run('state.economy.unemployment') === 0.035 && g.run('state.economy.gdpGrowth') === 0.02);
  check('기업 등급: 스타트업', g.run('companyGradeInfo({valuation:50000000}).name') === '스타트업');
  check('기업 등급: 성장기업', g.run('companyGradeInfo({valuation:200000000}).name') === '성장기업');
  check('기업 등급: 최고 등급 도달 가능', g.run('companyGradeInfo({valuation:3000000000}).name') === '초우량 기업');

  g.run(`
    state.company={name:'테스트기업',level:1,valuation:50000000,book:50000000,revenue:2000000,profit:600000,payout:.3};
    state.cash=1000000000; state.achievements={}; acquireRival('r1');
    1
  `);
  check('기업 인수 비용·가치 반영', g.run('state.company.acquired.r1') === true && g.run('state.company.valuation') === 200000000, g.run('state.company.valuation'));
  check('인수 후 기업 등급 상승', g.run('companyGradeInfo().name') === '성장기업', g.run('companyGradeInfo().name'));
  check('첫 기업 인수 업적', g.run('state.achievements.first_acquisition') === true);

  const originalRandom = Math.random;
  g.run(`
    state.news=[]; stocks.forEach(s=>{s.own=0;s.price=s.start});
    Math.random=()=>0.5; earningsSurprise();
    1
  `);
  const earningsNews = g.run('state.news[0]');
  check('실적 발표에 매출·영업이익 포함', typeof earningsNews === 'string' && earningsNews.includes('매출') && earningsNews.includes('영업이익') && earningsNews.includes('주가'), earningsNews);
  check('실적 발표가 주가에 반영', g.run('stocks.some(s=>s.id!=="market_etf"&&Number.isFinite(s.lastMove)&&s.lastMove!==0)') === true);
  Math.random = originalRandom;

  try {
    g.run(`
      state.news=[]; state.company=null; state.cash=1000000;
      state.economy=Object.assign({},ECON_DEFAULT,{cycleLeft:15,phase:'중립',gdpGrowth:.02,unemployment:.035,inflation:.025});
      enterEconomyPhase('호황');
      1
    `);
    check('경기 호황 이벤트 발생', g.run('state.news.some(n=>n.includes("경기 호황"))') === true, g.run('state.news[0]'));
    check('호황에 성장률·물가 상승', g.run('state.economy.gdpGrowth') > 0.02 && g.run('state.economy.inflation') > 0.025, g.run('state.economy.gdpGrowth') + '/' + g.run('state.economy.inflation'));

    g.run(`
      state.news=[];
      state.economy=Object.assign({},ECON_DEFAULT,{cycleLeft:15,phase:'호황',gdpGrowth:.02,unemployment:.035,inflation:.025});
      enterEconomyPhase('불황');
      1
    `);
    check('금융 위기·경기 침체 이벤트 발생', g.run('state.news.some(n=>n.includes("금융 위기")&&n.includes("경기 침체"))') === true, g.run('state.news[0]'));
    check('불황에 실업률 상승·주가 하락', g.run('state.economy.unemployment') > 0.035 && g.run('stocks.some(s=>s.lastMove<0)') === true, g.run('state.economy.unemployment'));
  } finally {
    Math.random = originalRandom;
  }

  g.run(`
    state.journal=[]; state.cash=10000000; state.usd=0; state.loan=0;
    state.estate={}; state.company=null; products.forEach(p=>p.amount=0);
    stocks.forEach(s=>s.own=0);
    state.achievements={}; state.journal=Array.from({length:10},(_,i)=>({side:'buy',name:'x',qty:1,valueKRW:1,profit:0}));
    checkAchievements();
    1
  `);
  check('거래 10회 업적', g.run('state.achievements.trade_10') === true);
  check('투자 성향: 장기 보유형', g.run('investmentStyle().style') === '장기 보유형', g.run('investmentStyle().style'));
  g.run("portfolio(); economyPage(); 1");
  const portfolioHtml = g.run("document.getElementById('portfolio').innerHTML");
  const economyHtml = g.run("document.getElementById('economy').innerHTML");
  check('포트폴리오에 투자 성향 분석', portfolioHtml.includes('투자 성향 분석') && portfolioHtml.includes('장기 보유형'));
  check('경제 화면에 물가·실업률 지표', economyHtml.includes('물가 상승률') && economyHtml.includes('실업률') && economyHtml.includes('GDP 성장률'));
}

// ── 13. 경제·설정·속도·환생 통합 ────────────────────────────
{
  const g = createGame();
  g.run(`
    clearGame(true);
    state.cash = START_CASH; state.usd = 0; state.loan = 0; state.paused = false;
    state.auto.enabled = false;
    state.achievements = Object.fromEntries(ACHIEVEMENTS.map(a => [a.id, true]));
    state.goals = Object.fromEntries(MILESTONES.map(m => [m.id, true]));
    state.special = Object.fromEntries(SPECIAL_MISSIONS.map(m => [m.id, true]));
    state.rewardedGrade = gradeIndex(currentGrade());
    state.notifySeen = {};
    1;
  `);
  g.run('for(let i=0;i<120;i++) gameLoop(); 1');
  check('신규 게임 120초 무활동 현금 불변', g.run('state.cash') === g.run('START_CASH'), g.run('state.cash'));
  check('무활동 상태에서 총자산 불변', g.run('grossAssetsKRW()') === g.run('START_CASH'), g.run('grossAssetsKRW()'));
  check('첫 시작 자금은 0원', g.run('START_CASH') === 0 && g.run('state.cash') === 0, g.run('state.cash'));
  check('환생 업그레이드 없으면 시작 자금도 0원', g.run('rebirthStartCash()') === 0, g.run('rebirthStartCash()'));

  // 총자산·순자산 공식
  g.run(`
    state.cash = 10000000; state.loan = 3000000; state.usd = 1000; fx.usd = 1000;
    stocks.forEach(s => { s.own = 0; });
    stock('future_ai').own = 10; stock('future_ai').price = 100000;
    products.forEach(p => { p.amount = 0; }); product('deposit').amount = 5000000;
    state.estate = { apt: { qty: 1, avgBuy: 90000000 } };
    state.metals = { gold: { qty: 10, avg: 100000 }, silver: { qty: 0, avg: 0 } };
    state.altPrices = { apt: 100000000, gold: 200000 };
    state.company = { name: 't', level: 1, valuation: 20000000, book: 20000000, revenue: 0, profit: 0, payout: 0.3 };
    1;
  `);
  const formula = g.run('({gross:grossAssetsKRW(), net:netAssetsKRW(), cash:state.cash, stock:stockValueKRW(), product:productValueKRW(), estate:estateValue(), metal:metalValue(), company:companyValue()})');
  const expectedGross = formula.cash + 1000000 + formula.stock + formula.product + formula.estate + formula.metal + formula.company;
  check('총자산 = 현금+주식+금융+부동산+실물+기업', Math.round(formula.gross) === Math.round(expectedGross), formula.gross);
  check('순자산 = 총자산 - 부채', Math.round(formula.net) === Math.round(formula.gross - 3000000), formula.net);

  // 금융상품 5,000만원 + 대출 1,000만원이면 총자산 5,000만원, 순자산 4,000만원으로
  // 상단에 부채가 함께 보여야 합니다. 상단 바와 총자산 공식이 같은 숫자를 쓰는지 검증합니다.
  const top = createGame();
  top.run(`clearGame(true); state.cash=0; state.usd=0; state.loan=10000000; state.loanRate=.12; state.taxPaid=330000;
    products.forEach(p=>{p.amount=0;}); product('deposit').amount=50000000;
    state.estate={}; state.metals={gold:{qty:0,avg:0},silver:{qty:0,avg:0}}; state.company=null; state.bonds={qty:0,avg:0}; state.shorts=[];
    update(); 1`);
  const topText = top.run(`({
    product:document.getElementById('productValueTop').textContent,
    gross:document.getElementById('grossValueTop').textContent,
    debt:document.getElementById('debtValueTop').textContent,
    net:document.getElementById('totalValue').textContent,
    tax:document.getElementById('taxValueTop').textContent,
    estate:document.getElementById('estateValueTop').textContent,
    usd:document.getElementById('usdValue').textContent
  })`);
  check('상단 금융상품 5천만·부채 1천만 표시', topText.product === top.run("won(50000000)") && topText.debt === top.run("won(10000000)"), JSON.stringify(topText));
  check('상단 순자산 카드에 총자산 함께 표시', topText.gross === top.run('"총자산 "+won(50000000)') && topText.net === top.run("won(40000000)"), JSON.stringify(topText));
  check('상단 부동산·달러·누적 세금 항목 표시', topText.estate === top.run("won(0)") && topText.usd === top.run("won(0)") && topText.tax === top.run("won(330000)"), JSON.stringify(topText));

  const cashBefore = g.run('state.cash');
  g.run(`stock('future_ai').price = 150000; 1`);
  check('미실현 평가익은 현금에 반영되지 않음', g.run('state.cash') === cashBefore, g.run('state.cash') - cashBefore);
  check('미실현 평가익은 총자산에 반영', Math.round(g.run('grossAssetsKRW()')) === Math.round(expectedGross + 500000), g.run('grossAssetsKRW()'));

  // 속도 저장·복원·클램프
  g.run('setSpeed(4); 1');
  check('속도 설정 즉시 반영', g.run('state.speed') === 4 && g.run('state.settings.speed') === 4);
  const savedSpeed = g.run('JSON.parse(JSON.stringify(buildSaveData()))');
  g.run('setSpeed(1); 1');
  g.run(`applySaveData(${JSON.stringify(savedSpeed)}); 1`);
  check('새로고침 후 속도 유지', g.run('state.speed') === 4, g.run('state.speed'));
  g.run(`
    const bad = JSON.parse(JSON.stringify(buildSaveData()));
    bad.state.speed = 99; bad.state.settings.speed = -3;
    bad.state.settings.numberFormat = 'weird'; bad.state.settings.theme = 'neon';
    applySaveData(bad);
    1;
  `);
  check('잘못된 속도는 1~5로 보정', g.run('state.speed') === 5 && g.run('state.settings.speed') === 5, g.run('state.speed'));
  check('잘못된 설정값 보정', g.run("state.settings.numberFormat === 'full' && state.settings.theme === 'light'"), g.run('state.settings.numberFormat'));
  g.run(`
    state.cash=200000000; state.seasonBase=10000000; state.seasonBaseIndex=1000; state.reportMonth='1999-01';
    const oldReport=JSON.parse(JSON.stringify(buildSaveData()));
    applySaveData(oldReport);
    1;
  `);
  check('월간 리포트 기준점 자동 갱신', g.run('state.reportMonth') === g.run('seasonKey()') && Math.abs(g.run('reportData().ret')) < 1e-9, g.run('reportData().ret'));

  // 알림 개별 토글·중복 억제
  g.run('state.notify.dividend = false; state.alerts = []; state.notifySeen = {}; notify("dividend","배당","테스트"); 1');
  check('알림 끄면 기록되지 않음', g.run('state.alerts.length') === 0, g.run('state.alerts.length'));
  g.run('state.notify.dividend = true; notify("dividend","배당","테스트"); notify("dividend","배당","테스트"); 1');
  check('동일 알림 중복 억제', g.run('state.alerts.filter(a=>a.kind==="dividend").length') === 1, g.run('state.alerts.length'));

  // 환생: 조건·포인트·업그레이드·데이터 보존
  g.run(`
    state.cash = 200000000; state.usd = 0; state.loan = 0;
    stocks.forEach(s => { s.own = 0; s.avgBuy = 0; });
    products.forEach(p => { p.amount = 0; });
    state.estate = {}; state.company = null;
    state.metals = { gold: { qty: 0, avg: 0 }, silver: { qty: 0, avg: 0 } };
    state.altPrices = {}; state.paused = false;
    state.rebirth = { count: 0, points: 0, spent: 0, upgrades: {}, bestNet: 0, history: [], notified: false };
    ensureRebirth();
    1;
  `);
  check('환생 조건 순자산 1억', g.run('canRebirth()') === true);
  check('환생 포인트 계산', g.run('rebirthPointsFor(200000000)') === 4, g.run('rebirthPointsFor(200000000)'));
  g.run('ensureRebirth().points = 20; 1');
  const upgradeCost = g.run("rebirthCost('start')");
  g.run("buyRebirthUpgrade('start'); 1");
  check('영구 업그레이드 구매·포인트 차감', g.run("rebirthLevel('start')") === 1 && g.run('ensureRebirth().points') === 20 - upgradeCost, g.run('ensureRebirth().points'));
  check('시작 자금 업그레이드 반영', g.run('rebirthStartCash()') === g.run('START_CASH + 2000000'), g.run('rebirthStartCash()'));
  g.run('setSetting("theme","dark"); setSetting("numberFormat","short"); state.achievements={first_trade:true}; 1');
  const pointsBefore = g.run('ensureRebirth().points');
  const startCash = g.run('rebirthStartCash()');
  g.run('rebirthNow(true); 1');
  const afterRebirth = g.run('({count:ensureRebirth().count,cash:state.cash,loan:state.loan,stock:stockValueKRW(),product:productValueKRW(),history:ensureRebirth().history.length,points:ensureRebirth().points,theme:state.settings.theme,format:state.settings.numberFormat,ach:!!state.achievements.first_trade,can:canRebirth()})');
  check('환생 실행·횟수·기록', afterRebirth.count === 1 && afterRebirth.history === 1, afterRebirth.count);
  check('환생 후 시작 자금 지급', Math.round(afterRebirth.cash) === Math.round(startCash), afterRebirth.cash);
  check('환생 후 진행 자산 초기화', afterRebirth.loan === 0 && afterRebirth.stock === 0 && afterRebirth.product === 0);
  check('환생 포인트 누적 지급', afterRebirth.points === pointsBefore + 4, afterRebirth.points);
  check('환생 후 설정·업적 보존', afterRebirth.theme === 'dark' && afterRebirth.format === 'short' && afterRebirth.ach === true);
  check('환생 직후 재환생 불가', afterRebirth.can === false);

  g.run("ensureRebirth().upgrades.fee = 5; ensureRebirth().upgrades.offline = 1; 1");
  check('거래 수수료 업그레이드 50% 감소', Math.abs(g.run('stockFeeRate()') - g.run('FEE_STOCK*0.5')) < 1e-12, g.run('stockFeeRate()'));
  check('오프라인 정산 상한 증가', g.run('offlineMaxSeconds()') === 4 * 3600, g.run('offlineMaxSeconds()'));

  // 새 페이지 렌더
  g.run('dashboardPage(); portfolio(); settingsPage(); rebirthPage(); realestatePage(); companyPage(); economyPage(); loanPage(); taxPage(); ordersPage(); 1');
  const pageText = g.run('["dashboard","portfolio","settings","rebirth","realestate","company","economy","loan","tax","orders"].map(id=>document.getElementById(id).innerHTML).join("")');
  check('새 페이지 렌더에 NaN·undefined 없음', !pageText.includes('NaN') && !pageText.includes('undefined'), (pageText.match(/NaN|undefined/g) || []).length);
  check('설정 페이지에 속도·알림·데이터 저장 안내', pageText.includes('게임 속도') && pageText.includes('알림') && pageText.includes('수동 저장') && !pageText.includes('설정만 초기화'));
}

const failed = results.filter(r => !r.pass);
console.log(`\n== ${results.length - failed.length}/${results.length} passed ==`);
if (failed.length) process.exit(1);
