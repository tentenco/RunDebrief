import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  NODE_RUNTIME_LICENSE_PATH,
  RUNTIME_MANIFEST_NAME,
  stageRuntimePackage,
  type RuntimeManifest,
} from "../runtime-package.js";
import { temporaryDirectory } from "./helpers.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      fs.rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("daemon runtime staging", () => {
  it("stages once and reuses the validated immutable target", async () => {
    const root = await temporaryDirectory("debrief-runtime-");
    temporaryDirectories.push(root);
    const source = await fixtureRuntime(root);
    const debriefHome = path.join(root, ".debrief");

    const first = await stageRuntimePackage(source, debriefHome);
    const second = await stageRuntimePackage(source, debriefHome);

    expect(first.runtimePath).toBe(second.runtimePath);
    expect(first.reused).toBe(false);
    expect(first.repaired).toBe(false);
    expect(second.reused).toBe(true);
    expect(second.repaired).toBe(false);
    expect(await fs.readFile(second.entryPath, "utf8")).toContain("fixture");
    expect(
      await fs.readFile(
        path.join(second.runtimePath, NODE_RUNTIME_LICENSE_PATH),
        "utf8",
      ),
    ).toContain("Node.js fixture license");
  });

  it("quarantines a corrupt exact target before replacing it", async () => {
    const root = await temporaryDirectory("debrief-runtime-repair-");
    temporaryDirectories.push(root);
    const source = await fixtureRuntime(root);
    const debriefHome = path.join(root, ".debrief");
    const installed = await stageRuntimePackage(source, debriefHome);
    await fs.writeFile(installed.entryPath, "corrupt\n");

    const repaired = await stageRuntimePackage(source, debriefHome);

    expect(repaired.runtimePath).toBe(installed.runtimePath);
    expect(repaired.repaired).toBe(true);
    expect(repaired.quarantinePath).not.toBeNull();
    expect(await fs.readFile(repaired.entryPath, "utf8")).toContain("fixture");
    expect(
      await fs.readFile(
        path.join(repaired.quarantinePath!, "dist", "cli.mjs"),
        "utf8",
      ),
    ).toBe("corrupt\n");
  });

  it("quarantines an exact-target symlink without traversing it", async () => {
    const root = await temporaryDirectory("debrief-runtime-symlink-");
    temporaryDirectories.push(root);
    const source = await fixtureRuntime(root);
    const debriefHome = path.join(root, ".debrief");
    const installed = await stageRuntimePackage(source, debriefHome);
    const retained = `${installed.runtimePath}.retained`;
    await fs.rename(installed.runtimePath, retained);
    const outside = path.join(root, "outside");
    await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, "marker"), "untouched\n");
    await fs.symlink(outside, installed.runtimePath);

    const repaired = await stageRuntimePackage(source, debriefHome);

    expect(repaired.repaired).toBe(true);
    expect(await fs.readFile(path.join(outside, "marker"), "utf8")).toBe(
      "untouched\n",
    );
    expect((await fs.lstat(repaired.quarantinePath!)).isSymbolicLink()).toBe(
      true,
    );
    expect((await fs.lstat(repaired.runtimePath)).isDirectory()).toBe(true);
    expect((await fs.lstat(retained)).isDirectory()).toBe(true);
  });

  it("rejects a symlinked runtime root", async () => {
    const root = await temporaryDirectory("debrief-runtime-root-link-");
    temporaryDirectories.push(root);
    const source = await fixtureRuntime(root);
    const debriefHome = path.join(root, ".debrief");
    const outside = path.join(root, "outside-runtime");
    await fs.mkdir(debriefHome);
    await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, "marker"), "untouched\n");
    await fs.symlink(outside, path.join(debriefHome, "runtime"));

    await expect(stageRuntimePackage(source, debriefHome)).rejects.toThrow(
      "runtime root must be a real directory",
    );
    expect(await fs.readFile(path.join(outside, "marker"), "utf8")).toBe(
      "untouched\n",
    );
  });

  it("rejects a runtime manifest that omits the Node license", async () => {
    const root = await temporaryDirectory("debrief-runtime-license-");
    temporaryDirectories.push(root);
    const source = await fixtureRuntime(root);
    const manifestPath = path.join(source, RUNTIME_MANIFEST_NAME);
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as RuntimeManifest;
    manifest.files = manifest.files.filter(
      (file) => file.path !== NODE_RUNTIME_LICENSE_PATH,
    );
    await fs.writeFile(manifestPath, `${JSON.stringify(manifest)}\n`);

    await expect(
      stageRuntimePackage(source, path.join(root, ".debrief")),
    ).rejects.toThrow(`Daemon runtime manifest omits ${NODE_RUNTIME_LICENSE_PATH}`);
  });
});

async function fixtureRuntime(root: string): Promise<string> {
  const source = path.join(root, "source");
  const files = new Map<string, { content: string; mode: number }>([
    [
      "bin/node",
      {
        content: `#!/bin/sh\nexec ${shellQuote(process.execPath)} "$@"\n`,
        mode: 0o700,
      },
    ],
    ["dist/cli.mjs", { content: "console.log('fixture');\n", mode: 0o600 }],
    [
      NODE_RUNTIME_LICENSE_PATH,
      { content: "Node.js fixture license\n", mode: 0o600 },
    ],
  ]);
  for (const [relativePath, file] of files) {
    const target = path.join(source, relativePath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, file.content, { mode: file.mode });
  }
  const manifest: RuntimeManifest = {
    schemaVersion: 1,
    version: "0.1.0-test",
    nodeVersion: process.version,
    nodeAbi: process.versions.modules,
    platform: process.platform,
    arch: process.arch,
    nodePath: "bin/node",
    entryPath: "dist/cli.mjs",
    files: [...files].map(([relativePath, file]) => ({
      path: relativePath,
      sha256: createHash("sha256").update(file.content).digest("hex"),
      mode: file.mode,
    })),
  };
  await fs.writeFile(
    path.join(source, RUNTIME_MANIFEST_NAME),
    `${JSON.stringify(manifest)}\n`,
  );
  return source;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
