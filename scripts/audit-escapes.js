#!/usr/bin/env node
/**
 * 저장 파일에서 온 문자열이 이스케이프 없이 HTML 템플릿에 들어가는 곳을 찾습니다.
 *
 * 검사 방식
 * - index.html의 <script>에서 모든 `${...}` 보간을 뽑아낸다.
 * - 저장 데이터의 문자열을 담는 식(TAINT)이 보간 안에 있고,
 *   escHtml/escAttr 같은 이스케이프가 함께 쓰이지 않았으면 실패로 본다.
 * - 텍스트 전용(HTML이 아닌) 곳은 해당 줄 끝에 `audit-ok` 주석으로 예외 처리한다.
 *
 * 실행: npm run audit
 */
"use strict";

const fs = require("fs");
const path = require("path");

const file = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, "..", "index.html");
const html = fs.readFileSync(file, "utf8");
const match = /<script>([\s\S]*?)<\/script>/.exec(html);
if (!match) {
  console.error("index.html에서 <script> 블록을 찾지 못했습니다.");
  process.exit(1);
}
const source = match[1];
const scriptStartLine = html.slice(0, match.index).split("\n").length;

// 저장 파일에서 온 문자열이 화면 HTML로 흘러갈 수 있는 식들입니다.
const TAINT = [
  /state\.news\b/,
  /state\.logs\b/,
  /state\.alerts\b/,
  /state\.journal\b/,
  /state\.disclosures\b/,
  /state\.company\.name\b/,
  /state\.weekly\.key\b/,
  /state\.cloud\.nickname\b/,
  /state\.taxLedger\b/,
  /state\.journalFilter\.q\b/,
  /state\.ipo\.offer\b/,
  /\boffer\.(name|ticker|theme)\b/,
  /\bmarketDayText\(\)/
];
const ESCAPED = /escHtml\(|escAttr\(|encodeURIComponent\(/;

function lineOf(index) {
  return scriptStartLine + source.slice(0, index).split("\n").length - 1;
}

const problems = [];
let inspected = 0;
for (let i = 0; i < source.length; i++) {
  if (source[i] !== "$" || source[i + 1] !== "{") continue;
  let depth = 0;
  let j = i + 1;
  for (; j < source.length; j++) {
    if (source[j] === "{") depth++;
    else if (source[j] === "}") {
      depth--;
      if (depth === 0) break;
    }
  }
  const expr = source.slice(i + 2, j);
  i = j;
  if (!TAINT.some((re) => re.test(expr))) continue;
  inspected++;
  if (ESCAPED.test(expr)) continue;
  // 개수만 쓰는 식(.length)은 HTML이 아니므로 통과시킵니다.
  if (/\.length\s*\)*\s*$/.test(expr)) continue;
  const line = lineOf(i);
  const text = source.split("\n")[line - scriptStartLine];
  if (/\baudit-ok\b/.test(text)) continue;
  problems.push({ line, expr: expr.replace(/\s+/g, " ").slice(0, 120) });
}

if (problems.length) {
  console.error(`저장 파일 문자열이 이스케이프 없이 HTML로 들어갑니다 (${problems.length}건):`);
  problems.forEach((p) => console.error(`  index.html:${p.line}  \${${p.expr}}`));
  console.error("\nescHtml()/escAttr()로 감싸거나, HTML이 아니면 해당 줄에 audit-ok 주석을 남기세요.");
  process.exit(1);
}
console.log(`이스케이프 감사 통과: 저장 데이터 문자열 보간 ${inspected}건 문제 없음`);
