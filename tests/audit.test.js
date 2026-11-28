#!/usr/bin/env node
/**
 * 이스케이프 감사 스크립트 자체의 회귀 테스트
 * - 이스케이프 없이 저장 파일 문자열을 보간하면 실패해야 한다
 * - escHtml로 감싸거나 audit-ok 주석을 달면 통과해야 한다
 * - 실제 index.html은 통과해야 한다
 * 실행: node tests/audit.test.js
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log(`PASS ${name}${detail !== undefined ? `  [${detail}]` : ''}`); }
  else { fail++; console.log(`FAIL ${name}${detail !== undefined ? `  [${detail}]` : ''}`); }
}

const script = path.join(__dirname, '..', 'scripts', 'audit-escapes.js');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-audit-'));

function runAudit(file) {
  const args = file ? [script, file] : [script];
  const res = spawnSync(process.execPath, args, { encoding: 'utf8' });
  return { status: res.status, out: `${res.stdout || ''}${res.stderr || ''}` };
}
function runOnHtml(name, html) {
  const file = path.join(tmpDir, `${name}.html`);
  fs.writeFileSync(file, html);
  return runAudit(file);
}

const bad = runOnHtml('bad', '<script>const x = `<div>${state.news[0]}</div>`;</script>');
check('이스케이프 없는 저장 문자열 보간을 잡아냄', bad.status === 1 && bad.out.includes('state.news'), bad.out.split('\n')[1] || '');

const good = runOnHtml('good', '<script>const x = `<div>${escHtml(state.news[0])}</div>`;</script>');
check('escHtml로 감싼 보간은 통과', good.status === 0, good.out.trim());

const annotated = runOnHtml('annotated', '<script>const x = `${state.news[0]}`; // audit-ok: 텍스트 전용</script>');
check('audit-ok 예외 주석은 허용', annotated.status === 0, annotated.out.trim());

const countOnly = runOnHtml('count', '<script>const x = `${(state.news || []).length}`;</script>');
check('개수(.length)만 쓰는 보간은 통과', countOnly.status === 0, countOnly.out.trim());

const real = runAudit();
check('실제 index.html 감사 통과', real.status === 0, real.out.trim());

fs.rmSync(tmpDir, { recursive: true, force: true });

console.log(`\n== ${pass}/${pass + fail} passed ==`);
if (fail) process.exit(1);
