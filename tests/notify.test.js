#!/usr/bin/env node
/**
 * 알림 설정 테스트: 전체 끄기 · 표시 방식(토스트/알림 센터/시황 속보) · 종류별 끄기 · 저장 복원
 * 실행: node tests/notify.test.js
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
  const classes = new Set();
  const el = {
    id, tagName: 'DIV', value: '', textContent: '', innerHTML: '', disabled: false, className: '', style: {},
    checked: false, children: [],
    classList: {
      add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c),
      toggle: c => (classes.has(c) ? classes.delete(c) : classes.add(c)), _set: classes
    },
    appendChild(child) { this.children.push(child); return child; },
    removeChild(child) { this.children = this.children.filter(c => c !== child); return child; },
    contains: () => false, addEventListener() {},
    getBoundingClientRect: () => ({ width: 0, height: 0, right: 0, bottom: 0, left: 0, top: 0 })
  };
  return el;
}

function createGame(seed = 5) {
  const els = new Map();
  const el = id => { if (!els.has(id)) els.set(id, makeElement(id)); return els.get(id); };
  const document = {
    getElementById: el, querySelector: () => null, querySelectorAll: () => [],
    createElement: () => makeElement('toast'), body: makeElement('body'), addEventListener() {}
  };
  const store = {};
  let seedState = seed;
  const rand = () => { seedState = (seedState * 1103515245 + 12345) & 0x7fffffff; return seedState / 0x7fffffff; };
  const seededMath = Object.create(Math); seededMath.random = rand;
  const ctx = {
    console, Math: seededMath, Date, JSON, Number, isFinite, Intl, Promise,
    setTimeout: () => 0, setInterval: () => 0, clearInterval: () => 0,
    alert: () => {}, confirm: () => true, document,
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    window: {}
  };
  vm.createContext(ctx);
  vm.runInContext(source, ctx, { filename: 'index.html#script' });
  const run = code => vm.runInContext(code, ctx);
  run('clearGame(true); state.marketOpen=true; state.settings.confirmTrades=false; 1');
  return { run, el, store };
}

// ── 기본값 ───────────────────────────────────────
{
  const g = createGame();
  check('기본: 전체 알림 켜짐', g.run('state.notify.master') === false);
  check('기본: 토스트·알림센터·시황속보 켜짐', g.run('state.notify.toast') === true && g.run('state.notify.center') === true && g.run('state.notify.news') === true);
  check('종류별 기본값은 켜짐', g.run('NOTIFY_KINDS.every(([k])=>state.notify[k]!==false)') === true, g.run('NOTIFY_KINDS.length'));
}

// ── 토스트 / 알림 센터 분리 ────────────────────────
{
  const g = createGame();
  g.run('state.alerts=[]; showToast=(t,x)=>{window.__toasts=(window.__toasts||0)+1}; 1');
  g.run("notify('dividend','배당 알림','1,000원'); 1");
  check('기본 상태: 알림 기록 + 토스트', g.run('state.alerts.length') === 1 && g.run('window.__toasts') === 1);

  g.run("setNotify('toast',false); notify('dividend','배당2','2,000원'); 1");
  check('토스트만 끄면 기록은 계속', g.run('state.alerts.length') === 2 && g.run('window.__toasts') === 1, g.run('window.__toasts'));

  g.run("setNotify('toast',true); setNotify('center',false); notify('dividend','배당3','3,000원'); 1");
  check('알림 센터만 끄면 토스트는 계속', g.run('state.alerts.length') === 2 && g.run('window.__toasts') === 2);
}

// ── 종류별 끄기 ─────────────────────────────────
{
  const g = createGame();
  g.run('state.alerts=[]; showToast=()=>{}; 1');
  g.run("setNotify('stock',false); notify('stock','급등','5%'); notify('dividend','배당','1원'); 1");
  check('끈 종류만 걸러짐', g.run('state.alerts.length') === 1 && g.run("state.alerts[0].kind") === 'dividend');
}

// ── 모든 알림 끄기 ───────────────────────────────
{
  const g = createGame();
  g.run('state.alerts=[]; window.__toasts=0; showToast=()=>{window.__toasts++}; 1');
  g.run("setNotify('master',true); notify('dividend','배당','1원'); notify('system','저장','완료'); 1");
  check('모든 알림 끄기: 기록·토스트 모두 없음', g.run('state.alerts.length') === 0 && g.run('window.__toasts') === 0);

  const banner = g.run("(()=>{ const b=document.getElementById('breaking'); b.classList.remove('show'); publishBreakingNews('시황 속보','테스트'); return {shown:b.classList.contains('show'), news:state.news.length}; })()");
  check('모든 알림 끄기: 시황 속보 배너도 숨김', banner.shown === false, banner.shown);
  check('배너를 꺼도 뉴스 기록은 남음', banner.news > 0, banner.news);
}

// ── 시황 속보만 끄기 ─────────────────────────────
{
  const g = createGame();
  const r = g.run("(()=>{ const b=document.getElementById('breaking'); b.classList.remove('show'); setNotify('news',false); publishBreakingNews('시황 속보','테스트'); return {shown:b.classList.contains('show'), news:state.news.length}; })()");
  check('시황 속보 끄면 배너는 안 뜸', r.shown === false);
  check('시황 속보를 꺼도 뉴스 기록은 유지', r.news > 0, r.news);
}

// ── 일괄 켜기/끄기 ───────────────────────────────
{
  const g = createGame();
  g.run('setAllNotify(false); 1');
  check('종류 모두 끄기', g.run('NOTIFY_KINDS.every(([k])=>state.notify[k]===false)') === true);
  g.run('setAllNotify(true); 1');
  check('종류 모두 켜기', g.run('NOTIFY_KINDS.every(([k])=>state.notify[k]===true)') === true);
}

// ── 저장/복원 ────────────────────────────────────
{
  const g = createGame();
  g.run("setNotify('master',true); setNotify('news',false); saveGame(); 1");
  g.run('state.notify.master=false; state.notify.news=true; loadGame(); 1');
  check('알림 설정 저장·복원', g.run('state.notify.master') === true && g.run('state.notify.news') === false);
}

// ── 종 아이콘 배지 ──────────────────────────────
{
  const g = createGame();
  g.run("state.alerts=[{at:Date.now(),kind:'system',title:'배지',text:'',read:false}]; state.notify.master=false; state.notify.center=true; updateBell(); 1");
  check('알림이 있으면 배지 표시', g.el('bellBadge').style.display === 'inline-flex' && g.el('bbBadge').style.display === 'inline-flex');

  g.run("setNotify('center',false); 1");
  check('알림 센터 기록을 끄면 배지 숨김', g.el('bellBadge').style.display === 'none' && g.el('bbBadge').style.display === 'none');

  g.run("setNotify('center',true); updateBell(); 1");
  check('다시 켜면 배지 복귀', g.el('bellBadge').style.display === 'inline-flex', g.el('bellBadge').style.display);

  g.run("setNotify('master',true); 1");
  check('모든 알림 끌 때도 배지 숨김', g.el('bellBadge').style.display === 'none');
  g.run("setNotify('master',false); 1");
}

// ── 시황 속보 최소 표시 간격 ────────────────────
{
  const g = createGame();
  const shown = () => g.el('breaking').classList.contains('show');
  check('기본 최소 간격은 15초', g.run('state.notify.newsGap') === 15, g.run('state.notify.newsGap'));

  g.run("setNotifyGap(30); publishBreakingNews('시황 속보','첫 번째'); 1");
  check('첫 속보는 바로 표시', shown() === true);

  g.run("document.getElementById('breaking').classList.remove('show'); publishBreakingNews('시황 속보','두 번째'); 1");
  check('간격 안의 두 번째 속보는 숨김', shown() === false);
  check('숨겨도 뉴스 기록은 저장', g.run("state.news[0].includes('두 번째')") === true);

  g.run("breakingShownAt=0; publishBreakingNews('시황 속보','세 번째'); 1");
  check('간격이 지나면 다시 표시', shown() === true);

  g.run("setNotifyGap(0); 1");
  g.run("document.getElementById('breaking').classList.remove('show'); publishBreakingNews('시황 속보','네 번째'); 1");
  check('제한 없음은 매번 표시', shown() === true);

  g.run("setNotifyGap(20); saveGame(); 1");
  g.run("state.notify.newsGap=15; loadGame(); 1");
  check('최소 간격 저장·복원', g.run('state.notify.newsGap') === 20, g.run('state.notify.newsGap'));
}

// ── 화면 렌더 ────────────────────────────────────
{
  const g = createGame();
  const settingsHtml = g.run("document.getElementById('settings').innerHTML=''; settingsPage(); document.getElementById('settings').innerHTML");
  check('설정에 모든 알림 끄기 스위치', settingsHtml.includes('알림 표시 (모든 알림 끄기)') && settingsHtml.includes('표시 중'));
  check('설정에 표시 방식 3종', settingsHtml.includes('화면 토스트') && settingsHtml.includes('알림 센터 기록') && settingsHtml.includes('시황 속보 배너'));
  check('설정에 종류별 알림', settingsHtml.includes('종류별 알림') && settingsHtml.includes('주가 급등·급락') && settingsHtml.includes('시장 뉴스'));
  check('설정에 일괄 켜기/끄기 버튼', settingsHtml.includes('종류 모두 끄기') && settingsHtml.includes('종류 모두 켜기'));
  check('설정에 시황 속보 최소 간격 선택', settingsHtml.includes('시황 속보 최소 간격') && settingsHtml.includes('제한 없음') && settingsHtml.includes('<option value="30"'));

  g.run("state.alerts=[]; notify('tax','세금','1원'); openNotifModal(); 1");
  const modal = g.run("document.getElementById('modalRoot').innerHTML");
  check('알림 센터에 시장 뉴스 토글', modal.includes('시장 뉴스') && modal.includes('시황 속보') === false);
  g.run("setNotify('master',true); openNotifModal(); 1");
  check('전체 끄기 상태를 알림 센터에 표시', g.run("document.getElementById('modalRoot').innerHTML").includes('모든 알림이 꺼져 있습니다'));
  const guide = g.run("document.getElementById('guide').innerHTML=''; guidePage(); document.getElementById('guide').innerHTML");
  check('도움말에 알림 설정 안내', guide.includes('14. 알림 설정') && guide.includes('모든 알림 끄기'));
}

console.log('');
console.log(`== ${pass}/${pass + fail} passed ==`);
process.exit(fail ? 1 : 0);
