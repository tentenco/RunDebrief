import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const execFileAsync = promisify(execFile);
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const packageDirectory = path.resolve(scriptDirectory, "..");
const repoRoot = path.resolve(packageDirectory, "../..");
const outputDirectory = path.join(packageDirectory, "runtime-dist");
const nodeLicenseRelativePath = "licenses/node/LICENSE";
const requireFromCore = createRequire(
  path.join(repoRoot, "packages", "core", "package.json"),
);
const requireFromDaemon = createRequire(
  path.join(packageDirectory, "package.json"),
);

await fs.rm(outputDirectory, { recursive: true, force: true });
await Promise.all([
  fs.mkdir(path.join(outputDirectory, "bin"), { recursive: true }),
  fs.mkdir(path.join(outputDirectory, "dist"), { recursive: true }),
  fs.mkdir(path.join(outputDirectory, "licenses", "node"), { recursive: true }),
  fs.mkdir(path.join(outputDirectory, "migrations"), { recursive: true }),
  fs.mkdir(path.join(outputDirectory, "node_modules"), { recursive: true }),
]);

await esbuild.build({
  entryPoints: [path.join(packageDirectory, "src", "cli.ts")],
  outfile: path.join(outputDirectory, "dist", "cli.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  external: ["better-sqlite3", "fsevents"],
  banner: {
    js: 'import { createRequire as __debriefCreateRequire } from "node:module"; const require = __debriefCreateRequire(import.meta.url);',
  },
  logLevel: "info",
});

const nodeExecutable = await fs.realpath(process.execPath);
const nodeLicense = await resolveNodeLicense(nodeExecutable);
await fs.copyFile(nodeExecutable, path.join(outputDirectory, "bin", "node"));
await fs.chmod(path.join(outputDirectory, "bin", "node"), 0o755);
await fs.copyFile(
  nodeLicense,
  path.join(outputDirectory, nodeLicenseRelativePath),
);
await fs.copyFile(
  path.join(repoRoot, "packages", "core", "migrations", "001_initial.sql"),
  path.join(outputDirectory, "migrations", "001_initial.sql"),
);

const betterSqliteRoot = await copyPackage(requireFromCore, "better-sqlite3", [
  "package.json",
  "LICENSE",
  "lib",
  path.join("build", "Release", "better_sqlite3.node"),
]);
const requireFromBetterSqlite = createRequire(
  path.join(betterSqliteRoot, "package.json"),
);
const bindingsRoot = await copyPackage(requireFromBetterSqlite, "bindings", [
  "package.json",
  "LICENSE.md",
  "bindings.js",
]);
const requireFromBindings = createRequire(
  path.join(bindingsRoot, "package.json"),
);
await copyPackage(requireFromBindings, "file-uri-to-path", [
  "package.json",
  "LICENSE",
  "index.js",
]);
const chokidarRoot = path.dirname(
  requireFromDaemon.resolve("chokidar/package.json"),
);
const requireFromChokidar = createRequire(
  path.join(chokidarRoot, "package.json"),
);
await copyPackage(requireFromChokidar, "fsevents", [
  "package.json",
  "LICENSE",
  "fsevents.js",
  "fsevents.node",
]);

const packageJson = JSON.parse(
  await fs.readFile(path.join(packageDirectory, "package.json"), "utf8"),
);
const files = [];
for (const relativePath of await walkFiles(outputDirectory)) {
  files.push({
    path: relativePath,
    sha256: await sha256File(path.join(outputDirectory, relativePath)),
    mode: executableRuntimeFile(relativePath) ? 0o700 : 0o600,
  });
}
files.sort((left, right) => left.path.localeCompare(right.path));
if (!files.some((file) => file.path === nodeLicenseRelativePath)) {
  throw new Error("Packaged daemon runtime is missing the Node LICENSE");
}

const manifest = {
  schemaVersion: 1,
  version: packageJson.version,
  nodeVersion: process.version,
  nodeAbi: process.versions.modules,
  platform: process.platform,
  arch: process.arch,
  nodePath: "bin/node",
  entryPath: "dist/cli.mjs",
  files,
};
await fs.writeFile(
  path.join(outputDirectory, "runtime-manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  { mode: 0o600 },
);

const smoke = await execFileAsync(
  path.join(outputDirectory, "bin", "node"),
  [path.join(outputDirectory, "dist", "cli.mjs"), "runtime", "verify"],
  {
    cwd: outputDirectory,
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
  },
);
const details = JSON.parse(smoke.stdout);
if (
  details.nodeVersion !== manifest.nodeVersion ||
  details.nodeAbi !== manifest.nodeAbi ||
  details.platform !== manifest.platform ||
  details.arch !== manifest.arch ||
  details.database !== "ok"
) {
  throw new Error(`Packaged daemon runtime smoke failed: ${smoke.stdout}`);
}

const size = await directorySize(outputDirectory);
process.stdout.write(
  `${JSON.stringify({
    event: "daemon_runtime_built",
    outputDirectory,
    bytes: size,
    files: files.length + 1,
    nodeVersion: manifest.nodeVersion,
    nodeAbi: manifest.nodeAbi,
    platform: manifest.platform,
    arch: manifest.arch,
  })}\n`,
);

async function copyPackage(resolver, packageName, entries) {
  const packageJsonPath = resolver.resolve(`${packageName}/package.json`);
  const sourceRoot = path.dirname(packageJsonPath);
  const targetRoot = path.join(outputDirectory, "node_modules", packageName);
  for (const entry of entries) {
    const source = path.join(sourceRoot, entry);
    const target = path.join(targetRoot, entry);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.cp(source, target, {
      recursive: true,
      errorOnExist: false,
      force: true,
    });
  }
  return sourceRoot;
}

async function resolveNodeLicense(nodeExecutable) {
  const binaryDirectory = path.dirname(nodeExecutable);
  const candidates = [
    path.join(binaryDirectory, "LICENSE"),
    path.join(path.dirname(binaryDirectory), "LICENSE"),
  ];
  for (const candidate of candidates) {
    try {
      const stat = await fs.stat(candidate);
      if (stat.isFile()) return candidate;
    } catch (error) {
      if (!isMissingFile(error)) throw error;
    }
  }
  throw new Error(
    `Node LICENSE was not found for the canonical executable ${nodeExecutable}`,
  );
}

function isMissingFile(error) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

async function walkFiles(root, relative = "") {
  const directory = path.join(root, relative);
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    const entryRelative = path.join(relative, entry.name);
    if (entry.isDirectory()) {
      result.push(...(await walkFiles(root, entryRelative)));
    } else if (entry.isFile() && entry.name !== "runtime-manifest.json") {
      result.push(entryRelative);
    }
  }
  return result;
}

async function sha256File(filePath) {
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    const input = createReadStream(filePath);
    input.on("data", (chunk) => hash.update(chunk));
    input.once("error", reject);
    input.once("end", resolve);
  });
  return hash.digest("hex");
}

function executableRuntimeFile(relativePath) {
  return (
    relativePath === "bin/node" ||
    relativePath.endsWith(".node")
  );
}

async function directorySize(root) {
  let bytes = 0;
  for (const relativePath of await walkFiles(root)) {
    bytes += (await fs.stat(path.join(root, relativePath))).size;
  }
  bytes += (
    await fs.stat(path.join(root, "runtime-manifest.json"))
  ).size;
  return bytes;
}
