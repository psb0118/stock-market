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
  g.run(RESET(10000000) + 'state.loan = 0; 1');
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

const failed = results.filter(r => !r.pass);
console.log(`\n== ${results.length - failed.length}/${results.length} passed ==`);
if (failed.length) process.exit(1);
