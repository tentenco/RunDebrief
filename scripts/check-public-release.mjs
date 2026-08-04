import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();
process.chdir(repoRoot);

const errors = [];
const trackedFiles = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  {
  encoding: "buffer",
  },
)
  .toString("utf8")
  .split("\0")
  .filter(Boolean);

const attributeInput = Buffer.from(`${trackedFiles.join("\0")}\0`);
const attributeResult = spawnSync(
  "git",
  ["check-attr", "-z", "--stdin", "export-ignore"],
  {
    cwd: repoRoot,
    input: attributeInput,
    maxBuffer: 16 * 1024 * 1024,
  },
);

if (attributeResult.status !== 0) {
  const detail = attributeResult.stderr?.toString("utf8").trim();
  throw new Error(`git check-attr failed${detail ? `: ${detail}` : ""}`);
}

const attributeTokens = attributeResult.stdout
  .toString("utf8")
  .split("\0")
  .filter(Boolean);
const exportAttributes = new Map();
for (let index = 0; index < attributeTokens.length; index += 3) {
  exportAttributes.set(attributeTokens[index], attributeTokens[index + 2]);
}

const publicFiles = trackedFiles.filter(
  (file) => exportAttributes.get(file) !== "set",
);
const publicFileSet = new Set(publicFiles);

const requiredFiles = [
  "README.md",
  "README.zh-TW.md",
  "README.zh-CN.md",
  "LICENSE",
  "NOTICE",
  "TRADEMARKS.md",
  "CONTRIBUTING.md",
  "CODE_OF_CONDUCT.md",
  "SECURITY.md",
  "CHANGELOG.md",
  ".github/PULL_REQUEST_TEMPLATE.md",
  ".github/CODEOWNERS",
  ".github/dependabot.yml",
  ".github/ISSUE_TEMPLATE/config.yml",
  ".github/ISSUE_TEMPLATE/bug.yml",
  ".github/ISSUE_TEMPLATE/feature.yml",
  ".github/ISSUE_TEMPLATE/adapter.yml",
  ".github/workflows/ci.yml",
  ".github/workflows/release.yml",
  "docs/ANNOUNCEMENT.md",
  "docs/RELEASE_NOTES_v0.1.0-alpha.md",
  "docs/APPLE_SIGNING_HANDOFF.md",
  "docs/PUBLIC_EXPORT.md",
  "scripts/check-public-release.mjs",
];

for (const file of requiredFiles) {
  if (!publicFileSet.has(file)) {
    errors.push(`required public file is missing or export-ignored: ${file}`);
  }
}

const forbiddenPublicPaths = [
  ".agents/",
  ".claude/",
  "artifacts/",
  "report/",
  "docs/brand/",
  "docs/research/",
  "docs/design-references/",
];
const forbiddenPublicFiles = new Set([
  "AGENTS.md",
  "CLAUDE.md",
  "PLANS.md",
  "DESIGN.md",
  "docs/launch/LAUNCH_STRATEGY.md",
  "docs/launch/MESSAGING.md",
  "scripts/build-naming-ledger.mjs",
]);

for (const file of publicFiles) {
  if (
    forbiddenPublicFiles.has(file) ||
    forbiddenPublicPaths.some((prefix) => file.startsWith(prefix))
  ) {
    errors.push(`internal path remains in intended public export: ${file}`);
  }
}

const expectedNavigation =
  "[English](./README.md) | [繁體中文](./README.zh-TW.md) | [简体中文](./README.zh-CN.md)";
const readmeFiles = ["README.md", "README.zh-TW.md", "README.zh-CN.md"];
const readmes = readmeFiles.map((file) => ({
  file,
  content: fs.readFileSync(path.join(repoRoot, file), "utf8"),
}));

for (const { file, content } of readmes) {
  if (content.split(/\r?\n/, 1)[0] !== expectedNavigation) {
    errors.push(`${file} must start with the exact three-language navigation`);
  }
}

const parityMarkers = readmes.map(({ file, content }) => {
  const match = content.match(
    /<!--\s*README_PARITY_VERSION:\s*([^\s]+)\s*-->/,
  );
  if (!match) errors.push(`${file} is missing README_PARITY_VERSION`);
  return match?.[1] ?? null;
});
if (new Set(parityMarkers).size !== 1) {
  errors.push("README parity markers do not match");
}

const fencedBlocks = ({ content }) =>
  [...content.matchAll(/```[^\n]*\n[\s\S]*?```/g)].map((match) => match[0]);
const referenceBlocks = JSON.stringify(fencedBlocks(readmes[0]));
for (const readme of readmes.slice(1)) {
  if (JSON.stringify(fencedBlocks(readme)) !== referenceBlocks) {
    errors.push(`${readme.file} fenced commands/configuration are not in parity`);
  }
}

const requiredRepositoryLinks = [
  "https://github.com/tentenco/RunDebrief",
  "https://github.com/tentenco/RunDebrief/issues",
  "https://github.com/tentenco/RunDebrief/security",
  "https://github.com/tentenco/RunDebrief/releases",
];
for (const { file, content } of readmes) {
  for (const link of requiredRepositoryLinks) {
    if (!content.includes(link)) {
      errors.push(`${file} is missing required repository link: ${link}`);
    }
  }
}

const textExtensions = new Set([
  "",
  ".cjs",
  ".css",
  ".html",
  ".js",
  ".json",
  ".jsonl",
  ".jsx",
  ".md",
  ".mjs",
  ".rs",
  ".sh",
  ".sql",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml",
]);

const assembledTerms = [
  ["ekc", "m5max"].join("-"),
  ["Claude", "Code", "Local"].join("-"),
  ["Net", "eon"].join(""),
  ["A", "MED"].join(""),
  ["AL", "UXE"].join(""),
  ["Ba", "tom"].join(""),
  ["hermes", "agent"].join("-"),
  [["a", "med"].join(""), "portal"].join("-"),
  ["cmo", "catalog"].join("-"),
];

const escapeRegExp = (value) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const sensitiveIdentifiers = assembledTerms.map((term) => ({
  term,
  pattern: new RegExp(
    `(?<![A-Za-z0-9])${escapeRegExp(term)}(?![A-Za-z0-9])`,
    "i",
  ),
}));

const sensitivePatterns = [
  {
    name: "real macOS home path",
    pattern: /\/Users\/(?!demo(?:\/|\b)|runner(?:\/|\b)|example(?:\/|\b))[A-Za-z0-9._-]+/i,
  },
  {
    name: "private key material",
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  },
  { name: "GitHub token", pattern: /(?:ghp_|github_pat_)[A-Za-z0-9_]{30,}/ },
  { name: "OpenAI-style secret", pattern: /\bsk-[A-Za-z0-9_-]{20,}/ },
  { name: "Slack token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}/ },
  { name: "AWS access key", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  {
    name: "internal gateway name",
    pattern: new RegExp(`\\b${["new", "api"].join("-")}\\b`, "i"),
  },
  {
    name: "fixed internal memory tenant",
    pattern: new RegExp(
      `${["user", "id"].join("_")}\\s*[:=]\\s*[\\"']${[
        "ten",
        "ten",
      ].join("")}[\\"']`,
      "i",
    ),
  },
];

const lineNumberAt = (content, offset) =>
  content.slice(0, offset).split("\n").length;

for (const file of publicFiles) {
  const extension = path.extname(file).toLowerCase();
  if (!textExtensions.has(extension)) continue;
  const absolutePath = path.join(repoRoot, file);
  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) continue;
  const content = fs.readFileSync(absolutePath, "utf8");

  for (const { pattern } of sensitiveIdentifiers) {
    const match = pattern.exec(content);
    if (match?.index !== undefined) {
      errors.push(
        `sensitive customer/host identifier in ${file}:${lineNumberAt(content, match.index)}`,
      );
    }
  }

  for (const { name, pattern } of sensitivePatterns) {
    const match = pattern.exec(content);
    if (match?.index !== undefined) {
      errors.push(`${name} in ${file}:${lineNumberAt(content, match.index)}`);
    }
    pattern.lastIndex = 0;
  }
}

for (const file of publicFiles) {
  if (/\.(?:dmg|p12|pem|key|mobileprovision)$/i.test(file)) {
    errors.push(`release credential or binary must not be tracked: ${file}`);
  }
}

if (errors.length > 0) {
  console.error("Public release check failed:");
  for (const error of [...new Set(errors)].sort()) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log(
  `Public release check passed: ${publicFiles.length} intended public files, ${requiredFiles.length} required files, README parity verified.`,
);
