#!/usr/bin/env node
/**
 * 새 버전 적용(서비스워커 업데이트) 안전장치 테스트
 * - 저장을 먼저 보장하고 새로고침하는지
 * - 백그라운드 탭·주문 입력 중·확인창 열림 상태에서는 미루고, 화면 복귀 시 적용하는지
 * 실행: node tests/sw-update.test.js
 */
'use strict';
const harness = require('./harness');

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

function makeElement(tag = 'DIV') {
  return {
    tagName: tag, value: '', textContent: '', innerHTML: '', disabled: false, className: '', style: {},
    checked: false, contains: () => false,
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener() {}, getBoundingClientRect: () => ({ width: 0, height: 0, right: 0, bottom: 0, left: 0, top: 0 })
  };
}

function createEnv({ visibility = 'visible', modal = null, activeElement = null } = {}) {
  // 실제 DOM처럼: 게임 모달은 #modalRoot에 .on 클래스가 붙어 열립니다.
  const matchesModal = sel => String(sel).split(',').map(s => s.trim()).some(s => {
    if (s === '#modalRoot.on' || s === '.modal.on') return modal === 'open';
    if (s === 'dialog[open]' || s === '.modal.show' || s === '.modal-backdrop') return modal === 'dialog';
    return false;
  });
  const store = {};
  const listeners = { doc: {}, nav: {} };
  const calls = { reload: 0, messages: [] };

  const els = new Map();
  const getEl = id => { if (!els.has(id)) els.set(id, Object.assign(makeElement(id), { id })); return els.get(id); };

  const doc = {
    visibilityState: visibility,
    activeElement,
    body: makeElement('BODY'),
    head: makeElement('HEAD'),
    getElementById: getEl,
    querySelectorAll: () => [],
    querySelector: sel => (matchesModal(sel) ? { tagName: 'DIV' } : null),
    createElement: tag => makeElement(String(tag).toUpperCase()),
    addEventListener(type, fn) { (listeners.doc[type] = listeners.doc[type] || []).push(fn); }
  };

  const navigator = {
    serviceWorker: {
      controller: null,
      addEventListener(type, fn) { (listeners.nav[type] = listeners.nav[type] || []).push(fn); },
      register: () => Promise.resolve({ update() {} })
    }
  };

  const storage = {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; }
  };
  const h = harness.createGame({
    document: doc, navigator,
    location: { protocol: 'http:', reload: () => { calls.reload++; } },
    sessionStorage: storage,
    localStorage: storage,
    window: {}
  });

  const env = {
    run: h.run,
    store, calls, listeners, doc,
    fireNav(type, payload) { (listeners.nav[type] || []).forEach(fn => fn(payload)); },
    fireDoc(type, payload) { (listeners.doc[type] || []).forEach(fn => fn(payload)); }
  };
  env.run('clearGame(true); state.marketOpen=true; 1');
  return env;
}

// ── 1. 저장이 먼저, 그 다음 새로고침 ───────────────────────────
{
  const env = createEnv();
  check('처음에는 새 버전 대기 상태가 아님', env.run('swUpdateReady') === false);
  check('준비되지 않았을 때는 새로고침하지 않음', env.run('swUpdateApply()') === false && env.calls.reload === 0);

  env.run('state.cash=12345678; swUpdateNotify(); 1');
  const saved = (() => { try { return JSON.parse(env.store[env.run('SAVE_KEY')] || 'null'); } catch (e) { return null; } })();
  check('새 버전 알림을 받으면 한 번 새로고침', env.calls.reload === 1, env.calls.reload);
  check('새로고침 전에 현재 상태를 저장', saved && saved.state && saved.state.cash === 12345678, saved && saved.state && saved.state.cash);
  check('같은 버전으로 다시 새로고침하지 않음', env.run('swUpdateNotify(); swUpdateApply(); 1') === 1 && env.calls.reload === 1, env.calls.reload);
}

// ── 2. 백그라운드 탭은 미루고, 화면 복귀 때 적용 ───────────────
{
  const env = createEnv({ visibility: 'hidden' });
  env.run('state.cash=7777777; swUpdateNotify(); 1');
  check('숨겨진 탭에서는 새로고침하지 않음', env.calls.reload === 0 && env.run('swUpdateApplied') === false);
  check('숨겨진 탭에서는 대기 상태 유지', env.run('swUpdateReady') === true);

  env.run('1');
  env.doc.visibilityState = 'visible';
  env.run('swUpdateApply()');
  const saved = (() => { try { return JSON.parse(env.store[env.run('SAVE_KEY')] || 'null'); } catch (e) { return null; } })();
  check('화면으로 돌아오면 저장 후 새로고침', env.calls.reload === 1 && saved.state.cash === 7777777, `${env.calls.reload}회`);
}

// ── 3. 주문 입력 중·확인창·직전 클릭은 기다림 3 ───────────────────
{
  const env = createEnv();
  env.run('1');
  env.doc.activeElement = { tagName: 'INPUT' };
  env.run('swUpdateNotify(); 1');
  check('주문 금액 입력 중에는 새로고침하지 않음', env.calls.reload === 0);

  env.doc.activeElement = null;
  env.run('swUpdateMarkInput(); swUpdateApply(); 1');
  check('방금 누른 직후(2.5초)에는 기다림', env.calls.reload === 0);
  env.run('swLastInput=0; swUpdateApply(); 1');
  check('입력이 끝나면 저장 후 새로고침', env.calls.reload === 1);
}

{
  const env = createEnv({ modal: 'open' });
  env.run('1');
  env.run('swUpdateNotify(); 1');
  check('게임 모달(#modalRoot.on)이 열려 있으면 기다림', env.calls.reload === 0);
  env.doc.querySelector = () => null;
  env.run('swUpdateApply(); 1');
  check('창을 닫으면 새로고침', env.calls.reload === 1);
}

// ── 3-1. 다른 탭이 저장 중이면(Multi-tab) 절대 자동 새로고침하지 않음 ──
{
  const env = createEnv();
  env.run('1');
  env.run('multiTab=true; state.cash=5555; swUpdateNotify(); 1');
  check('다른 탭이 플레이 중이면 새로고침 보류', env.calls.reload === 0 && env.run('swUpdateApplied') === false);
  env.run('multiTab=false; swUpdateApply(); 1');
  check('다른 탭을 정리한 뒤에만 적용', env.calls.reload === 1);
}

// ── 4. 서비스워커 메시지로 갱신 ────────────────────────────────
{
  const env = createEnv();
  env.run('1');
  env.fireNav('message', { data: { type: 'MPG_SW_UPDATE', version: 'mpg-v3' } });
  check('서비스워커 메시지로 저장·새로고침', env.calls.reload === 1 && env.run('swUpdateApplied') === true);
}

// ── 5. visibilitychange 이벤트로 갱신 ──────────────────────────
{
  const env = createEnv({ visibility: 'hidden' });
  env.run('1');
  env.fireNav('message', { data: { type: 'MPG_SW_UPDATE' } });
  const before = env.calls.reload;
  env.doc.visibilityState = 'visible';
  env.fireDoc('visibilitychange', {});
  check('visibilitychange만으로도 복귀 시 갱신', env.calls.reload === before + 1, `${before}→${env.calls.reload}`);
}

console.log('');
console.log(`== ${pass}/${pass + fail} passed ==`);
process.exit(fail ? 1 : 0);
