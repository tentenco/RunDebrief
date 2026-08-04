import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const RUNTIME_MANIFEST_NAME = "runtime-manifest.json";
export const RUNTIME_SCHEMA_VERSION = 1;
export const NODE_RUNTIME_LICENSE_PATH = "licenses/node/LICENSE";

export interface RuntimeManifestFile {
  path: string;
  sha256: string;
  mode: number;
}

export interface RuntimeManifest {
  schemaVersion: typeof RUNTIME_SCHEMA_VERSION;
  version: string;
  nodeVersion: string;
  nodeAbi: string;
  platform: NodeJS.Platform;
  arch: string;
  nodePath: string;
  entryPath: string;
  files: RuntimeManifestFile[];
}

export interface StagedRuntime {
  runtimePath: string;
  runtimeVersion: string;
  nodePath: string;
  entryPath: string;
  manifestDigest: string;
  reused: boolean;
  repaired: boolean;
  quarantinePath: string | null;
}

export async function stageRuntimePackage(
  sourceDirectory: string,
  debriefHome: string,
): Promise<StagedRuntime> {
  const source = await fs.realpath(sourceDirectory);
  const validated = await validateRuntimePackage(source);
  const runtimeRoot = await ensureRuntimeRoot(debriefHome);

  const runtimeName = `${validated.manifest.version}-${validated.manifestDigest.slice(0, 16)}`;
  const target = path.join(runtimeRoot, runtimeName);
  let quarantinePath: string | null = null;
  const targetKind = await entryKind(target);
  if (targetKind === "directory") {
    try {
      const existing = await validateRuntimePackage(target);
      await verifyRuntimeExecutable(existing);
      return stagedRuntime(existing, true, null);
    } catch {
      quarantinePath = path.join(
        runtimeRoot,
        `.${runtimeName}.corrupt-${Date.now()}-${randomUUID()}`,
      );
      await fs.rename(target, quarantinePath);
    }
  } else if (targetKind !== "missing") {
    quarantinePath = path.join(
      runtimeRoot,
      `.${runtimeName}.corrupt-${Date.now()}-${randomUUID()}`,
    );
    await fs.rename(target, quarantinePath);
  }

  const temporary = path.join(
    runtimeRoot,
    `.${runtimeName}.tmp-${process.pid}-${randomUUID()}`,
  );
  await fs.mkdir(temporary, { mode: 0o700 });
  try {
    for (const file of validated.manifest.files) {
      const sourcePath = safeRuntimePath(source, file.path);
      const targetPath = safeRuntimePath(temporary, file.path);
      await fs.mkdir(path.dirname(targetPath), {
        recursive: true,
        mode: 0o700,
      });
      await fs.copyFile(sourcePath, targetPath);
      await fs.chmod(targetPath, file.mode);
    }
    await fs.copyFile(
      path.join(source, RUNTIME_MANIFEST_NAME),
      path.join(temporary, RUNTIME_MANIFEST_NAME),
    );
    await fs.chmod(path.join(temporary, RUNTIME_MANIFEST_NAME), 0o600);

    const candidate = await validateRuntimePackage(temporary);
    await verifyRuntimeExecutable(candidate);
    try {
      await fs.rename(temporary, target);
    } catch (error) {
      if ((await entryKind(target)) !== "directory") throw error;
      const concurrent = await validateRuntimePackage(target);
      await verifyRuntimeExecutable(concurrent);
    }

    const installed = await validateRuntimePackage(target);
    await verifyRuntimeExecutable(installed);
    return stagedRuntime(installed, false, quarantinePath);
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
}

export async function validateRuntimePackage(
  runtimeDirectory: string,
): Promise<{
  root: string;
  manifest: RuntimeManifest;
  manifestDigest: string;
}> {
  const root = path.resolve(runtimeDirectory);
  const manifestPath = path.join(root, RUNTIME_MANIFEST_NAME);
  const raw = await fs.readFile(manifestPath, "utf8");
  if (Buffer.byteLength(raw) > 1024 * 1024) {
    throw new Error("Daemon runtime manifest is unexpectedly large");
  }
  const manifest = decodeManifest(JSON.parse(raw) as unknown);
  if (manifest.platform !== process.platform || manifest.arch !== process.arch) {
    throw new Error(
      `Daemon runtime targets ${manifest.platform}/${manifest.arch}, not ${process.platform}/${process.arch}`,
    );
  }
  if (
    manifest.nodeVersion !== process.version ||
    manifest.nodeAbi !== process.versions.modules
  ) {
    throw new Error(
      `Daemon runtime Node ${manifest.nodeVersion} ABI ${manifest.nodeAbi} does not match ${process.version} ABI ${process.versions.modules}`,
    );
  }

  const required = new Set([
    manifest.nodePath,
    manifest.entryPath,
    NODE_RUNTIME_LICENSE_PATH,
  ]);
  const seen = new Set<string>();
  for (const file of manifest.files) {
    if (seen.has(file.path)) {
      throw new Error(`Daemon runtime manifest repeats ${file.path}`);
    }
    seen.add(file.path);
    required.delete(file.path);
    const filePath = safeRuntimePath(root, file.path);
    const stat = await fs.lstat(filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error(`Daemon runtime entry is not a regular file: ${file.path}`);
    }
    const digest = await sha256File(filePath);
    if (digest !== file.sha256) {
      throw new Error(`Daemon runtime hash mismatch: ${file.path}`);
    }
  }
  if (required.size > 0) {
    throw new Error(
      `Daemon runtime manifest omits ${[...required].join(", ")}`,
    );
  }

  return {
    root,
    manifest,
    manifestDigest: createHash("sha256").update(raw).digest("hex"),
  };
}

async function verifyRuntimeExecutable(runtime: {
  root: string;
  manifest: RuntimeManifest;
}): Promise<void> {
  const executable = safeRuntimePath(runtime.root, runtime.manifest.nodePath);
  const result = await execFileAsync(
    executable,
    [
      "-p",
      "JSON.stringify({version:process.version,abi:process.versions.modules,platform:process.platform,arch:process.arch})",
    ],
    { encoding: "utf8", timeout: 5_000, maxBuffer: 64 * 1024 },
  );
  const details = JSON.parse(result.stdout) as {
    version?: unknown;
    abi?: unknown;
    platform?: unknown;
    arch?: unknown;
  };
  if (
    details.version !== runtime.manifest.nodeVersion ||
    details.abi !== runtime.manifest.nodeAbi ||
    details.platform !== runtime.manifest.platform ||
    details.arch !== runtime.manifest.arch
  ) {
    throw new Error("Staged daemon Node executable does not match its manifest");
  }
}

function stagedRuntime(
  runtime: {
    root: string;
    manifest: RuntimeManifest;
    manifestDigest: string;
  },
  reused: boolean,
  quarantinePath: string | null,
): StagedRuntime {
  return {
    runtimePath: runtime.root,
    runtimeVersion: runtime.manifest.version,
    nodePath: safeRuntimePath(runtime.root, runtime.manifest.nodePath),
    entryPath: safeRuntimePath(runtime.root, runtime.manifest.entryPath),
    manifestDigest: runtime.manifestDigest,
    reused,
    repaired: quarantinePath !== null,
    quarantinePath,
  };
}

function decodeManifest(value: unknown): RuntimeManifest {
  if (!isRecord(value)) throw new Error("Daemon runtime manifest is not an object");
  if (
    value.schemaVersion !== RUNTIME_SCHEMA_VERSION ||
    typeof value.version !== "string" ||
    !/^[0-9A-Za-z][0-9A-Za-z._-]{0,63}$/.test(value.version) ||
    typeof value.nodeVersion !== "string" ||
    typeof value.nodeAbi !== "string" ||
    typeof value.platform !== "string" ||
    typeof value.arch !== "string" ||
    typeof value.nodePath !== "string" ||
    typeof value.entryPath !== "string" ||
    !Array.isArray(value.files)
  ) {
    throw new Error("Daemon runtime manifest fields are invalid");
  }

  const files = value.files.map((file): RuntimeManifestFile => {
    if (
      !isRecord(file) ||
      typeof file.path !== "string" ||
      typeof file.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(file.sha256) ||
      typeof file.mode !== "number" ||
      !Number.isInteger(file.mode) ||
      file.mode < 0o400 ||
      file.mode > 0o777
    ) {
      throw new Error("Daemon runtime file entry is invalid");
    }
    safeRelativePath(file.path);
    return {
      path: file.path,
      sha256: file.sha256,
      mode: file.mode,
    };
  });

  safeRelativePath(value.nodePath);
  safeRelativePath(value.entryPath);
  return {
    schemaVersion: RUNTIME_SCHEMA_VERSION,
    version: value.version,
    nodeVersion: value.nodeVersion,
    nodeAbi: value.nodeAbi,
    platform: value.platform as NodeJS.Platform,
    arch: value.arch,
    nodePath: value.nodePath,
    entryPath: value.entryPath,
    files,
  };
}

function safeRuntimePath(root: string, relativePath: string): string {
  safeRelativePath(relativePath);
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relativePath);
  if (!resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`Daemon runtime path escapes its root: ${relativePath}`);
  }
  return resolved;
}

function safeRelativePath(value: string): void {
  if (
    !value ||
    path.isAbsolute(value) ||
    path.normalize(value) !== value ||
    value.includes("\0") ||
    value.split(/[\\/]/).some((segment) => segment === "..")
  ) {
    throw new Error(`Unsafe daemon runtime path: ${value}`);
  }
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const input = createReadStream(filePath);
    input.on("data", (chunk) => hash.update(chunk));
    input.once("error", reject);
    input.once("end", resolve);
  });
  return hash.digest("hex");
}

async function ensureRuntimeRoot(debriefHome: string): Promise<string> {
  const root = path.resolve(debriefHome, "runtime");
  const before = await entryKind(root);
  if (before === "missing") {
    await fs.mkdir(root, { recursive: true, mode: 0o700 });
  } else if (before !== "directory") {
    throw new Error("Debrief runtime root must be a real directory");
  }
  if ((await entryKind(root)) !== "directory") {
    throw new Error("Debrief runtime root changed during setup");
  }
  return root;
}

async function entryKind(
  target: string,
): Promise<"missing" | "directory" | "symlink" | "other"> {
  try {
    const stat = await fs.lstat(target);
    if (stat.isSymbolicLink()) return "symlink";
    if (stat.isDirectory()) return "directory";
    return "other";
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return "missing";
    }
    throw error;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
