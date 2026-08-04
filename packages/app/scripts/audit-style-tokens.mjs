import { readFile } from "node:fs/promises";

const stylesheetUrl = new URL("../src/styles.css", import.meta.url);
const css = await readFile(stylesheetUrl, "utf8");
const lines = css.split("\n");
const rootStart = lines.findIndex((line) => line.trim() === ":root {");
if (rootStart < 0) {
  fail(["styles.css is missing its :root token block"]);
}

let depth = 0;
let rootEnd = -1;
for (let index = rootStart; index < lines.length; index += 1) {
  depth += count(lines[index], "{");
  depth -= count(lines[index], "}");
  if (index > rootStart && depth === 0) {
    rootEnd = index;
    break;
  }
}
if (rootEnd < 0) {
  fail(["styles.css has an unterminated :root token block"]);
}

const tokenDefinitions = new Set(
  lines
    .slice(rootStart, rootEnd + 1)
    .map((line) => line.match(/^\s*(--[\w-]+):/u)?.[1])
    .filter(Boolean),
);
const tokenReferences = [...css.matchAll(/var\((--[\w-]+)/gu)].map(
  (match) => match[1],
);
const findings = [];

for (const token of tokenReferences) {
  if (!tokenDefinitions.has(token)) {
    findings.push(`undefined token ${token}`);
  }
}

for (let index = 0; index < lines.length; index += 1) {
  if (index >= rootStart && index <= rootEnd) continue;
  const declaration = lines[index].match(/^\s*[\w-]+:\s*(.+);\s*$/u);
  if (!declaration) continue;
  const value = declaration[1];
  if (
    /#[\da-f]{3,8}\b|rgba?\(|hsla?\(|oklch\(|lab\(/iu.test(value)
  ) {
    findings.push(`${index + 1}: raw color: ${value}`);
  }
  if (/-?(?:\d*\.)?\d+(?:px|ms|s|em|rem|vh|vw|%)\b/u.test(value)) {
    findings.push(`${index + 1}: raw dimension or duration: ${value}`);
  }
  if (
    /(^|[\s,])(ease|ease-in|ease-out|ease-in-out|linear)(?=[\s,]|$)/u.test(
      value,
    )
  ) {
    findings.push(`${index + 1}: raw easing: ${value}`);
  }
  const valueWithoutTokens = value.replace(/var\(--[\w-]+\)/gu, "");
  const nonZeroNumbers = [
    ...valueWithoutTokens.matchAll(/-?(?:\d*\.)?\d+/gu),
  ]
    .map((match) => Number(match[0]))
    .filter((number) => number !== 0);
  if (nonZeroNumbers.length > 0) {
    findings.push(`${index + 1}: raw numeric value: ${value}`);
  }
}

if (findings.length > 0) {
  fail([...new Set(findings)]);
}

console.log(
  `Token audit passed: ${tokenDefinitions.size} tokens, zero raw style literals.`,
);

function count(value, character) {
  return [...value].filter((candidate) => candidate === character).length;
}

function fail(messages) {
  console.error("Design-token audit failed:");
  for (const message of messages) console.error(`- ${message}`);
  process.exit(1);
}
