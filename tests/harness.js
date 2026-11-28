'use strict';
/**
 * 테스트 공통 하네스
 *
 * index.html의 <script>를 vm 컨텍스트에서 실행해 게임 함수를 그대로 호출합니다.
 * createGame(globals)로 Math(시드 고정)·performance 같은 추가 전역을 넣을 수 있고,
 * 호출할 때마다 독립된 localStorage·DOM을 새로 만듭니다.
 *
 * 사용:
 *   const { createGame, mulberry32 } = require('./harness');
 *   const g = createGame();
 *   g.run('state.cash = 1000; 1');
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const source = /<script>([\s\S]*?)<\/script>/.exec(html)[1];

function makeElement(id) {
  const classes = new Set();
  return {
    id, value: '', textContent: '', innerHTML: '', disabled: false, className: '', style: {}, checked: false,
    classList: {
      add(c) { classes.add(c); }, remove(c) { classes.delete(c); }, contains: c => classes.has(c),
      toggle(c, on) { const next = on === undefined ? !classes.has(c) : !!on; if (next) classes.add(c); else classes.delete(c); return next; },
      _set: classes
    },
    appendChild(child) { child.parentNode = this; (this.children || (this.children = [])).push(child); },
    removeChild(child) { const i = (this.children || []).indexOf(child); if (i >= 0) this.children.splice(i, 1); },
    click() {},
    setAttribute(k, v) { this[k] = v; },
    getAttribute(k) { return this[k] == null ? null : this[k]; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    getBoundingClientRect() { return { width: 0, height: 0, left: 0, top: 0 }; }
  };
}

// 결정론적 난수(같은 시드 → 같은 시장).
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function seededMath(seed) {
  const m = Object.create(Math);
  m.random = mulberry32(seed);
  return m;
}

function createGame(globals) {
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
    addEventListener() {},
    removeEventListener() {}
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
  if (globals) Object.assign(ctx, globals);
  vm.createContext(ctx);
  vm.runInContext(source, ctx, { filename: 'index.html#script' });
  const run = code => vm.runInContext(code, ctx);
  // 날짜는 실제 시각으로 흐르므로, 테스트는 하루 경계 바로 뒤(2026-01-01 01:00 KST)로 시계를 고정합니다.
  run('setDayClock(GAME_DAY_EPOCH_MS+3600*1000); clearGame(true); state.marketOpen=true; state.settings.confirmTrades=false; state.savedAt=0; 1');
  return { run, el, ctx, store };
}

module.exports = { html, source, makeElement, createGame, mulberry32, seededMath };
