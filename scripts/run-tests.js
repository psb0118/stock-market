#!/usr/bin/env node
/**
 * tests/*.test.js 를 순서대로 실행하고 요약을 출력합니다.
 * - 실패한 파일이 하나라도 있으면 종료 코드 1
 * - 각 파일의 마지막 요약 줄(== N/N passed == 또는 N/N 통과)을 함께 보여 줍니다.
 * 실행: npm test
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const testsDir = path.join(__dirname, "..", "tests");
const files = fs.readdirSync(testsDir).filter((f) => f.endsWith(".test.js")).sort();
if (!files.length) {
  console.error("tests/*.test.js 파일을 찾지 못했습니다.");
  process.exit(1);
}

let failed = 0;
const rows = [];
for (const file of files) {
  const res = spawnSync(process.execPath, [path.join(testsDir, file)], { encoding: "utf8" });
  const out = `${res.stdout || ""}${res.stderr || ""}`;
  const summary = out
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^== .*(passed|통과) ==$/.test(l) || /^\d+\/\d+ 통과$/.test(l))
    .pop() || "(요약 없음)";
  const ok = res.status === 0;
  if (!ok) {
    failed++;
    const failures = out.split("\n").filter((l) => l.startsWith("FAIL")).slice(0, 10);
    rows.push({ file, ok, summary, failures });
  } else {
    rows.push({ file, ok, summary, failures: [] });
  }
}

for (const row of rows) {
  console.log(`${row.ok ? "PASS" : "FAIL"} ${row.file}  ${row.summary}`);
  row.failures.forEach((line) => console.log(`    ${line}`));
}
console.log(`\n${rows.length - failed}/${rows.length} 파일 통과${failed ? ` · 실패 ${failed}` : ""}`);
process.exit(failed ? 1 : 0);
