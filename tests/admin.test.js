#!/usr/bin/env node
/**
 * 관리자 접속자 목록 · 강제 초기화 테스트.
 * 실행: node tests/admin.test.js
 */
'use strict';
const harness = require('./harness');

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const rules = fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8');
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
    appendChild() {}, removeChild() {}, setAttribute() {}
  };
}

function createGame() {
  return harness.createGame();
}


function fakeDb(calls) {
  return {
    doc: (db, col, id) => ({ col, id, path: `${col}/${id}` }),
    collection: (db, ...parts) => ({ path: parts.join('/'), parts }),
    query: (col, ...rest) => ({ col, rest }),
    where: (field, op, value) => ({ where: [field, op, value] }),
    limit: n => ({ limit: n }),
    orderBy: (field, dir) => ({ orderBy: [field, dir] }),
    serverTimestamp: () => 'SERVER_TS',
    setDoc: async (ref, data, opts) => { calls.push({ op: 'setDoc', ref, data, opts }); },
    deleteDoc: async ref => { calls.push({ op: 'deleteDoc', ref }); },
    getDocs: async q => {
      calls.push({ op: 'getDocs', q });
      return { docs: [] };
    },
    getDoc: async ref => {
      calls.push({ op: 'getDoc', ref });
      return { exists: () => false, data: () => null };
    },
    onSnapshot: () => () => {}
  };
}

// ── 접속자 정렬 · 하트비트 신선도 ────────────────────────────
{
  const g = createGame();
  const result = g.run(`(()=>{
    const now=Date.now();
    const list=fbAdminFromDocs([
      {id:'u1',data:()=>({uid:'u1',nickname:'활성',email:'a@x.com',online:true,lastSeen:now-1000})},
      {id:'u2',data:()=>({uid:'u2',nickname:'오래됨',email:'b@x.com',online:true,lastSeen:now-200000})},
      {id:'u3',data:()=>({uid:'u3',nickname:'오프라인',email:'c@x.com',online:false,lastSeen:now})},
      {id:'u4',data:()=>({uid:'u4',nickname:'방금',email:'d@x.com',online:true,lastSeen:now-2000})}
    ]);
    return {ids:list.map(x=>x.uid), online:fbPresenceOnline({online:true,lastSeen:now-1000},now), stale:fbPresenceOnline({online:true,lastSeen:now-200000},now)};
  })()`);
  check('접속 중인 사용자를 먼저 정렬', result.ids[0] === 'u1' && result.ids[1] === 'u4', result.ids.join(','));
  check('오프라인 사용자도 목록에 남김', result.ids.includes('u3') && result.ids.length === 4, result.ids.join(','));
  check('오래된 하트비트는 오프라인 취급', result.online === true && result.stale === false);
}

// ── 관리자 전체 사용자 목록(오프라인 포함) ───────────────────
{
  const g = createGame();
  const result = g.run(`(()=>{
    const now=Date.now();
    const list=fbAdminFromDocs([
      {id:'u1',data:()=>({uid:'u1',nickname:'활성',email:'a@x.com',online:true,lastSeen:now-1000})},
      {id:'u2',data:()=>({uid:'u2',nickname:'오프라인',email:'b@x.com',online:false,lastSeen:now-3000})},
      {id:'u3',data:()=>({uid:'u3',nickname:'오래됨',email:'c@x.com',online:true,lastSeen:now-200000})}
    ]);
    return {ids:list.map(x=>x.uid), online:list.map(x=>fbPresenceOnline(x,now))};
  })()`);
  check('관리자 목록은 오프라인 사용자도 포함', result.ids.length === 3 && result.ids.includes('u2'), result.ids.join(','));
  check('온라인 사용자를 먼저 정렬', result.ids[0] === 'u1' && result.ids[1] === 'u2', result.ids.join(','));
}

// ── 관리자 화면 표시 ───────────────────────────────────────
{
  const g = createGame();
  const panel = g.run(`(()=>{
    const keep=FIREBASE_CONFIG; FIREBASE_CONFIG={apiKey:'k',projectId:'p',appId:'a'};
    fbUser={uid:'admin',email:'26007@changshin.ms.kr',displayName:'관리자'};
    fbAdminUsers=[
      {uid:'u1',nickname:'활성',email:'a@x.com',online:true,lastSeen:Date.now()-1000},
      {uid:'u2',nickname:'오래됨',email:'b@x.com',online:true,lastSeen:Date.now()-200000}
    ];
    const h=fbAdminPanelHtml();
    const settings=firebasePanelHtml();
    fbAdminUsers=null;
    const empty=fbAdminPanelHtml();
    fbUser={uid:'user',email:'user@x.com'};
    const normal=fbAdminPanelHtml();
    fbAdminUsers=null; fbUser=null; FIREBASE_CONFIG=keep;
    return {h,settings,empty,normal};
  })()`);
  check('관리자에게 전체 사용자 목록 패널 표시', panel.h.includes('관리자 · 전체 사용자') && panel.h.includes('a@x.com'), panel.h.slice(0, 80));
  check('설정 화면에도 관리자 패널 포함', panel.settings.includes('관리자 · 전체 사용자'));
  check('관리자에게 목록이 없으면 빈 상태 안내', panel.empty.includes('새로고침'));
  check('비관리자에게는 관리자 패널을 그리지 않음', panel.normal === '', panel.normal.slice(0, 40));
}

// ── 강제 초기화 확인 모달 ─────────────────────────────────
{
  const g = createGame();
  const modal = g.run(`(()=>{
    fbUser={uid:'admin',email:'soundpsb1@gmail.com',displayName:'관리자'};
    fbAdminUsers=[{uid:'u1',nickname:'대상',email:'u@x.com',online:true,lastSeen:Date.now()}];
    adminResetPrompt('u1');
    return document.getElementById('modalRoot').innerHTML;
  })()`);
  check('강제 초기화 모달에 대상 표시', modal.includes('대상') && modal.includes('u@x.com'));
  check('진행만/전체 초기화 선택 제공', modal.includes("adminResetTarget('u1','run')") && modal.includes("adminResetTarget('u1','all')"));
}

// ── 목록에 없는 오프라인 사용자를 UID로 직접 초기화 ──────────
{
  const g = createGame();
  const modal = g.run(`(()=>{
    fbUser={uid:'admin',email:'soundpsb1@gmail.com',displayName:'관리자'};
    fbAdminUsers=[];
    document.getElementById('admin-reset-uid').value='offline-uid';
    adminResetByUid();
    return document.getElementById('modalRoot').innerHTML;
  })()`);
  check('UID 직접 입력으로 오프라인 대상 지정', modal.includes('offline-uid') && modal.includes("adminResetTarget('offline-uid','run')"), modal.slice(0, 100));
}

// ── 대상 기기의 초기화 적용 ────────────────────────────────
{
  const g = createGame();
  const runReset = g.run(`(()=>{
    state.cash=123456; state.peakNet=123456;
    state.rebirth={count:2,points:5,spent:0,upgrades:{start:1},bestNet:1,history:[],notified:true};
    state.onboard={done:true,dismissed:true,seen:{rebirth:true},unlocked:{rebirth:true},firstTrade:true};
    localStorage.setItem(SAVE_KEY,'old');
    fbUser={uid:'u1',email:'u@x.com'};
    fbAutoPaused=false;
    fbApplyForcedReset({mode:'run',by:'admin@x.com'});
    return {cash:state.cash,rebirth:state.rebirth.count,onboard:state.onboard.unlocked.rebirth,paused:fbAutoPaused,local:localStorage.getItem(SAVE_KEY)!==null,modal:document.getElementById('modalRoot').innerHTML};
  })()`);
  check('진행만 초기화는 자산을 시작값으로 되돌림', runReset.cash === g.run('START_CASH'));
  check('진행만 초기화는 환생 기록 유지', runReset.rebirth === 2 && runReset.onboard === true);
  check('서버 정리 완료 전에는 자동 저장 대기', runReset.paused === true);
  check('초기화 후 로컬 저장은 새 진행으로 갱신', runReset.local === true);
  check('초기화 안내 모달 표시', runReset.modal.includes('관리자 초기화'));
}

{
  const g = createGame();
  const all = g.run(`(()=>{
    state.rebirth={count:2,points:5,spent:0,upgrades:{start:1},bestNet:1,history:[],notified:true};
    state.onboard={done:true,dismissed:true,seen:{rebirth:true},unlocked:{rebirth:true},firstTrade:true};
    fbUser={uid:'u1',email:'u@x.com'};
    fbApplyForcedReset({mode:'all',by:'admin@x.com'});
    return {rebirth:state.rebirth.count,points:state.rebirth.points,onboard:state.onboard.unlocked.rebirth};
  })()`);
  check('전체 초기화는 환생 기록·포인트 삭제', all.rebirth === 0 && all.points === 0);
  check('전체 초기화는 환생 탭 해금도 삭제', all.onboard !== true);
}

// ── 접속 하트비트와 관리자 서버 초기화 ─────────────────────
(async () => {
  const g = createGame();
  const calls = [];
  g.ctx.__fakeDb = fakeDb(calls);
  await g.run(`(async()=>{
    FIREBASE_CONFIG={apiKey:'k',projectId:'p',appId:'a'};
    fbDb={}; fbApi={db:__fakeDb};
    fbUser={uid:'u1',email:'u@x.com',displayName:'대상'};
    await fbPresenceBeat('u1');
    await fbPresenceOffline('u1');
  })()`);
  const beat = calls.find(c => c.op === 'setDoc' && c.ref.path === 'presence/u1' && c.data.online === true);
  const offline = calls.find(c => c.op === 'setDoc' && c.ref.path === 'presence/u1' && c.data.online === false);
  check('로그인 중 접속 하트비트 기록', !!beat && beat.data.email === 'u@x.com' && beat.opts.merge === true);
  check('로그아웃 시 오프라인 기록', !!offline);

  calls.length = 0;
  await g.run(`(async()=>{
    fbUser={uid:'admin',email:'soundpsb1@gmail.com',displayName:'관리자'};
    fbAdminUsers=null;
    await fbAdminRefresh();
  })()`);
  const presenceQuery = calls.find(c => c.op === 'getDocs' && c.q.col && c.q.col.path === 'presence');
  check('관리자 조회는 online 필터 없이 전체 접속 기록을 읽음', !!presenceQuery && !presenceQuery.q.rest.some(x => x.where), presenceQuery && presenceQuery.q.rest.length);

  calls.length = 0;
  await g.run(`(async()=>{
    FIREBASE_CONFIG={apiKey:'k',projectId:'p',appId:'a'};
    fbDb={}; fbApi={db:__fakeDb};
    fbUser={uid:'admin',email:'soundpsb1@gmail.com',displayName:'관리자'};
    fbAdminUsers=[{uid:'u1',nickname:'대상',email:'u@x.com',online:true,lastSeen:Date.now()}];
    await adminResetTarget('u1','run');
    return true;
  })()`);
  const marker = calls.find(c => c.op === 'setDoc' && c.ref.path === 'admin_resets/u1');
  const saveDelete = calls.find(c => c.op === 'deleteDoc' && c.ref.path === 'saves/u1');
  const scoreQuery = calls.find(c => c.op === 'getDocs' && c.q.col && c.q.col.path === 'scores');
  check('초기화 신호를 먼저 저장', !!marker && marker.data.mode === 'run' && !!marker.data.requestId);
  check('서버 저장 삭제 요청', !!saveDelete);
  check('대상의 점수 조회·삭제 경로 사용', !!scoreQuery);
  check('초기화 완료 메시지 표시', g.run('fbAdminMsg').includes('초기화했습니다'));
  const markerIdx = calls.findIndex(c => c.op === 'setDoc' && c.ref.path === 'admin_resets/u1');
  const deleteIdx = calls.findIndex(c => c.op === 'deleteDoc' && c.ref.path === 'saves/u1');
  const completeIdx = calls.findIndex(c => c.op === 'setDoc' && c.ref.path === 'admin_resets/u1' && c.data.completedAt === 'SERVER_TS');
  check('서버 정리 완료 신호를 삭제 뒤에 기록', markerIdx >= 0 && deleteIdx > markerIdx && completeIdx > deleteIdx);

  // 초기화된 새 진행은 다시 로그인하지 않아도 즉시 자동 저장되어야 합니다.
  {
    const g2 = createGame();
    const autoCalls = [];
    g2.ctx.__fakeDb = fakeDb(autoCalls);
    const result = await g2.run(`(async()=>{
      FIREBASE_CONFIG={apiKey:'k',projectId:'p',appId:'a'};
      fbDb={}; fbApi={db:__fakeDb};
      fbUser={uid:'u1',email:'u@x.com',displayName:'대상'};
      state.cash=999999; fbAutoPaused=false; fbLastSync=0; fbLastScorePush=0;
      await fbApplyForcedReset({requestId:'r-auto',mode:'run',completedAt:'done',by:'admin@x.com'});
      if(fbCloudWrite) await fbCloudWrite;
      return {paused:fbAutoPaused,pending:!!fbResetPending};
    })()`);
    const saves = autoCalls.filter(c => c.op === 'setDoc' && c.ref.path === 'saves/u1');
    const scores = autoCalls.filter(c => c.op === 'setDoc' && c.ref.path === 'scores/' + g2.run('seasonKey()') + '_u1');
    const oldSave = saves.find(c => c.data.save && c.data.save.state && c.data.save.state.cash === 999999);
    const freshSave = saves.find(c => c.data.save && c.data.save.state && c.data.save.state.cash === g2.run('START_CASH'));
    check('초기화 후 자동 저장이 다시 켜짐', result.paused === false && result.pending === false);
    check('초기화된 새 진행이 즉시 저장됨', !!freshSave);
    check('옛 진행은 저장되지 않음', !oldSave);
    check('초기화 후 새 점수도 즉시 기록', scores.length > 0);
  }

  // 초기화 중이던 옛 자동 저장이 늦게 끝나도 옛 진행을 덮어쓰지 않아야 합니다.
  {
    const g3 = createGame();
    const raceCalls = [];
    const gate = {};
    gate.promise = new Promise(resolve => { gate.release = resolve; });
    const raceDb = fakeDb(raceCalls);
    raceDb.getDoc = async ref => {
      if(ref.path === 'saves/u3') await gate.promise;
      return { exists: () => false, data: () => null };
    };
    g3.ctx.__raceDb = raceDb;
    await g3.run(`(async()=>{
      FIREBASE_CONFIG={apiKey:'k',projectId:'p',appId:'a'};
      fbDb={}; fbApi={db:__raceDb};
      fbUser={uid:'u3',email:'u3@x.com',displayName:'대상3'};
      state.cash=777777; fbAutoPaused=false; fbLastSync=0; fbLastScorePush=0;
      firebaseAutoUpload();
    })()`);
    await new Promise(r => setImmediate(r));
    const resetPromise = g3.run(`fbApplyForcedReset({requestId:'r-race',mode:'run',completedAt:'done',by:'admin@x.com'})`);
    await new Promise(r => setImmediate(r));
    gate.release();
    await resetPromise;
    if(g3.run('fbCloudWrite')) await g3.run('fbCloudWrite');
    const raceSaves = raceCalls.filter(c => c.op === 'setDoc' && c.ref.path === 'saves/u3');
    const raceOld = raceSaves.find(c => c.data.save && c.data.save.state && c.data.save.state.cash === 777777);
    check('진행 중이던 옛 저장은 초기화 후 무시됨', !raceOld);
    check('경쟁 후 새 진행만 저장됨', raceSaves.some(c => c.data.save && c.data.save.state && c.data.save.state.cash === g3.run('START_CASH')));
  }

  // 오래된 초기화 신호가 새 기기에서 현재 진행을 지우지 않는지 확인합니다.
  const staleG = createGame();
  staleG.ctx.__resetApi = { db: { doc: () => ({}), getDoc: async () => ({ exists: () => true, data: () => ({ updatedAt: Date.now() + 10000 }) }) } };
  const stale = await staleG.run('fbResetIsStale(__resetApi,"u1",{at:Date.now()})');
  staleG.ctx.__resetApi.db.getDoc = async () => ({ exists: () => true, data: () => ({ updatedAt: Date.now() - 10000 }) });
  const fresh = await staleG.run('fbResetIsStale(__resetApi,"u1",{at:Date.now()})');
  check('초기화 뒤 저장된 진행이 있으면 옛 신호 무시', stale === true && fresh === false);

  // ── 보안 규칙 ────────────────────────────────────────────
  check('규칙에 관리자 판별 존재', rules.includes('function isAdmin()') && rules.includes('email_verified'));
  check('규칙에 접속 상태·초기화 신호 경로 존재', rules.includes('match /presence/{uid}') && rules.includes('match /admin_resets/{uid}'));
  check('규칙에서 저장·점수 삭제는 관리자만 허용', /match \/saves\/\{uid\}[\s\S]*?allow delete: if isAdmin\(\);/.test(rules) && /match \/scores\/\{docId\}[\s\S]*?allow delete: if isAdmin\(\);/.test(rules));

  console.log(`\n== ${pass}/${pass + fail} passed ==`);
  process.exit(fail ? 1 : 0);
})();
