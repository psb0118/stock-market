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
  check('하향 후에도 확정 이율로 이자 지급', Math.abs(gained - before * 0.018 * 0.015) < 1e-6, gained.toFixed(2));
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
  check('배당금 지급', Math.round(g.run('state.cash')) === 4000, g.run('state.cash'));

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

  // 배당 예상: 국내 10주 × 10만원 × 0.4%
  g.run(RESET(0) + `
    state.cash = 0; state.usd = 0; state.loan = 0;
    stocks.forEach(s => { s.own = 0; });
    stock('future_ai').own = 10; stock('future_ai').price = 100000;
    state.marketSeconds = 30;
    1
  `);
  check('예상 배당금 계산', Math.round(g.run('expectedDividend()')) === 4000, g.run('expectedDividend()'));
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
  g.run(RESET(10000000) + 'state.loan = 0; portfolio(); 1');
  const html = g.run("document.getElementById('portfolio').innerHTML");
  check('내 자산 대시보드 렌더', html.includes('순자산 추이') && html.includes('다음 배당') && html.includes('alloc-bar'));
  check('전액 상환 버튼 렌더', html.includes('repayLoanFull()'));

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
  g.run('state.speed=10; state.paused=false; state.marketSeconds=0; gameLoop(); 1');
  check('10x에서 10초 진행', g.run('state.marketSeconds') === 10, g.run('state.marketSeconds'));
  g.run('state.paused=true; const beforePause=state.marketSeconds; gameLoop(); state.paused=false; 1');
  check('일시정지 중 시간 정지', g.run('state.marketSeconds') === 10, g.run('state.marketSeconds'));

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
  const idxBefore = g.run('marketIndex()');
  g.run('tickMarket(); 1');
  check('ETF가 지수를 추종', Math.abs(g.run("stock('market_etf').price") - Math.max(100, Math.round(idxBefore*10/100)*100)) < 1, g.run("stock('market_etf').price"));

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
  check('PWA 서비스워커 파일', fs.readFileSync(path.join(root, 'sw.js'), 'utf8').includes('addEventListener("fetch"'));
  check('PWA 아이콘', fs.existsSync(path.join(root, 'icon.svg')));
  check('index.html PWA 연결', html.includes('rel="manifest"') && html.includes('serviceWorker'));
}

const failed = results.filter(r => !r.pass);
console.log(`\n== ${results.length - failed.length}/${results.length} passed ==`);
if (failed.length) process.exit(1);
