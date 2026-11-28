#!/usr/bin/env node
/**
 * 초기화 권한 게이트 테스트
 *
 * 초기화는 일반 사용자에게 노출되지 않아야 합니다.
 * - 관리자 이메일로 로그인하지 않으면 강제 초기화 모달·실행·관리자 패널이 모두 막힘
 * - 플레이 화면 마크업에 초기화 진입점(버튼)이 없음
 * 실행: node tests/reset-gate.test.js
 */
'use strict';

const { html, createGame } = require('./harness');

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log(`PASS ${name}${detail !== undefined ? `  [${detail}]` : ''}`); }
  else { fail++; console.log(`FAIL ${name}${detail !== undefined ? `  [${detail}]` : ''}`); }
}

// ── 비관리자: 모달도, 실행도, 패널도 막힘 ─────────────────────
{
  const g = createGame();
  const denied = g.run(`(()=>{
    fbUser={uid:'u1',email:'user@x.com',displayName:'일반'};
    fbAdminUsers=[{uid:'u1',nickname:'나',email:'user@x.com',online:true,lastSeen:Date.now()}];
    state.cash=5000000; saveGame(); snapshotSave('import');
    document.getElementById('modalRoot').innerHTML='';
    adminResetPrompt('u1');
    return {admin:isAdminUser(), modal:document.getElementById('modalRoot').innerHTML||'', cash:state.cash, backups:saveBackupList().length};
  })()`);
  check('비관리자는 관리자로 판별되지 않음', denied.admin === false);
  check('비관리자는 강제 초기화 모달을 열 수 없음', denied.modal === '' && denied.cash === 5000000 && denied.backups >= 1, JSON.stringify({ modal: denied.modal, cash: denied.cash, backups: denied.backups }));

  const blocked = g.run(`(()=>{
    const alerts=[]; const orig=alert; alert=m=>alerts.push(String(m));
    try { adminResetTarget('u1','run'); adminResetTarget('u1','all'); } finally { alert=orig; }
    return {alerts, cash:state.cash, busy:fbAdminBusy};
  })()`);
  check('비관리자는 원격 초기화를 실행할 수 없음', blocked.alerts.length === 2 && blocked.alerts.every(m => m.includes('관리자 계정')) && blocked.cash === 5000000 && !blocked.busy, JSON.stringify(blocked.alerts));

  const panels = g.run(`(()=>{
    fbUser={uid:'u1',email:'user@x.com'};
    const userPanel=firebasePanelHtml(), userAdmin=fbAdminPanelHtml();
    fbUser={uid:'admin',email:'soundpsb1@gmail.com'};
    return {userPanel, userAdmin, adminPanel:fbAdminPanelHtml()};
  })()`);
  check('일반 사용자 클라우드 화면에 초기화 도구 없음', !panels.userPanel.includes('admin-reset-uid') && !panels.userPanel.includes('강제 초기화') && panels.userAdmin === '', JSON.stringify({ user: panels.userAdmin }));
  check('관리자 화면에만 초기화 도구가 보임', panels.adminPanel.includes('admin-reset-uid') && panels.adminPanel.includes('adminResetPrompt'), panels.adminPanel.length);
}

// ── 플레이 화면에 초기화 진입점이 없음 ─────────────────────────
{
  const markup = html.replace(/<script>[\s\S]*?<\/script>/g, '');
  check('마크업에 초기화 onclick이 없음', !/onclick="[^"]*(clearGame|adminReset)/.test(markup));

  const script = /<script>([\s\S]*?)<\/script>/.exec(html)[1];
  const calls = [...script.matchAll(/clearGame\(/g)].length;
  check('clearGame 호출은 내부 초기화 경로에서만 사용', calls === 2, calls);
  check('도움말도 초기화 버튼이 없다고 안내', script.includes('별도 초기화 버튼은 없습니다'));
}

console.log(`\n== ${pass}/${pass + fail} passed ==`);
if (fail) process.exit(1);
