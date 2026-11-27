#!/usr/bin/env node
/**
 * PWA 앱 밖 알림 테스트: 권한 게이팅 · 백그라운드에서만 전송 · 중요 알림만 전송 ·
 * 중복 억제 · 설정 저장 · 서비스워커 클릭/푸시 핸들러.
 * 실행: node tests/push.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const source = /<script>([\s\S]*?)<\/script>/.exec(html)[1];
const sw = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log(`PASS ${name}${detail !== undefined ? `  [${detail}]` : ''}`); }
  else { fail++; console.log(`FAIL ${name}${detail !== undefined ? `  [${detail}]` : ''}`); }
}

function makeElement(id) {
  return { id, value: '', textContent: '', innerHTML: '', disabled: false, className: '', style: {}, children: [], checked: false,
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    appendChild(c) { this.children.push(c); }, removeChild(c) { this.children = this.children.filter(x => x !== c); } };
}

function createGame() {
  const els = new Map();
  const el = id => { if (!els.has(id)) els.set(id, makeElement(id)); return els.get(id); };
  const sent = [];
  const registration = {
    showNotification(title, opts) { sent.push({ title, opts, via: 'sw' }); return Promise.resolve(); }
  };
  const notification = function (title, opts) { sent.push({ title, opts, via: 'constructor' }); };
  notification.permission = 'granted';
  notification.requestPermission = () => Promise.resolve('granted');
  const document = {
    visibilityState: 'hidden',
    getElementById: el, querySelector: () => null, querySelectorAll: () => [],
    createElement: () => makeElement('toast'), body: makeElement('body'), addEventListener() {}
  };
  const store = {};
  const ctx = {
    console, Math, Date, JSON, Number, isFinite, Intl, Promise,
    setTimeout: () => 0, setInterval: () => 0, clearInterval: () => 0,
    alert: () => {}, confirm: () => true, document,
    navigator: { serviceWorker: { ready: Promise.resolve(registration) } },
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    window: { Notification: notification }
  };
  vm.createContext(ctx);
  vm.runInContext(source, ctx, { filename: 'index.html#script' });
  const run = code => vm.runInContext(code, ctx);
  run('clearGame(true); state.settings.confirmTrades=false; 1');
  return { run, el, sent, document, store, registration, notification };
}

(async () => {
  {
    const g = createGame();
    check('앱 밖 알림 기본값은 꺼짐', g.run('state.notify.push') === false);
    check('알림 지원 감지', g.run('pushSupported()') === true);
    check('권한 전 게이팅', g.run('pushEnabled()') === false);
    check('설정 화면에 알림 허용 버튼', g.run('pushControlHtml()').includes('알림 허용'));

    const enabled = await g.run('enablePushNotifications()');
    check('권한 허용 후 켜짐', enabled === true && g.run('state.notify.push') === true && g.run('pushEnabled()') === true);
    check('켜짐 확인 알림 1건', g.sent.length === 1 && g.sent[0].via === 'sw', JSON.stringify(g.sent[0]));
    check('서비스워커 알림에 태그·아이콘', g.sent[0].opts && g.sent[0].opts.tag === 'mpg-test' && g.sent[0].opts.icon === 'icon.svg');

    // 백그라운드: 중요 알림은 전송
    g.run("state.alerts=[]; notify('system','체결','1주 매수'); 1");
    await new Promise(r => setImmediate(r));
    check('백그라운드에서 중요 알림 전송', g.sent.some(x => x.title === '체결'), g.sent.length);

    // 같은 알림은 15초 안에 중복 전송하지 않음
    const before = g.sent.length;
    g.run("notify('system','체결','1주 매수'); 1");
    await new Promise(r => setImmediate(r));
    check('같은 알림 중복 전송 억제', g.sent.length === before, `${before}→${g.sent.length}`);

    // 시장 뉴스는 앱 밖 알림 대상이 아님
    g.run("notify('news','시장 뉴스','금리 동결'); 1");
    await new Promise(r => setImmediate(r));
    check('시장 뉴스는 앱 밖 알림 제외', !g.sent.some(x => x.title === '시장 뉴스'));

    // 화면이 보이면 중복 알림을 보내지 않음
    g.document.visibilityState = 'visible';
    const visibleBefore = g.sent.length;
    g.run("notify('dividend','배당','1,000원'); 1");
    await new Promise(r => setImmediate(r));
    check('화면이 보일 때 앱 밖 알림 생략', g.sent.length === visibleBefore, `${visibleBefore}→${g.sent.length}`);

    // 강제 전송(설정 확인용)
    g.run("sendPushNotification('테스트','강제',{force:true,tag:'force'}); 1");
    await new Promise(r => setImmediate(r));
    check('강제 테스트 알림 전송', g.sent.some(x => x.title === '테스트' && x.opts.tag === 'mpg-force'));

    // 끄면 더 이상 전송하지 않음
    g.run('disablePushNotifications(); 1');
    const offBefore = g.sent.length;
    g.document.visibilityState = 'hidden';
    g.run("sendPushNotification('꺼짐','전송되면 안 됨',{force:true}); 1");
    await new Promise(r => setImmediate(r));
    check('끄면 전송하지 않음', g.sent.length === offBefore);

    // 설정 저장·복원
    g.run('state.notify.push=true; saveGame(); state.notify.push=false; loadGame(); 1');
    check('앱 밖 알림 설정 저장·복원', g.run('state.notify.push') === true);

    const settings = g.run("document.getElementById('settings').innerHTML=''; settingsPage(); document.getElementById('settings').innerHTML");
    check('설정에 앱 밖 알림 항목', settings.includes('앱 밖 알림 (PWA)') && settings.includes('백그라운드') && (settings.includes('알림 허용') || settings.includes('켜짐')));
    const guide = g.run("document.getElementById('guide').innerHTML=''; guidePage(); document.getElementById('guide').innerHTML");
    check('도움말에 앱 밖 알림 안내', guide.includes('14. 알림 설정'));
  }

  {
    check('서비스워커에 push 핸들러', sw.includes('addEventListener("push"') && sw.includes('showNotification'));
    check('서비스워커에 알림 클릭 핸들러', sw.includes('addEventListener("notificationclick"') && sw.includes('openWindow'));
    check('서비스워커 캐시 버전 갱신', /const CACHE = "mpg-v4"/.test(sw));
  }

  console.log('');
  console.log(`== ${pass}/${pass + fail} passed ==`);
  process.exit(fail ? 1 : 0);
})().catch(e => {
  console.error('FAIL 테스트 실행 오류', e);
  process.exit(1);
});
