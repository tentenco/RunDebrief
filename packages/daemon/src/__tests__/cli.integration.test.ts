import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { LAUNCHD_LABEL } from "../launchd.js";
import { NODE_RUNTIME_LICENSE_PATH } from "../runtime-package.js";
import { temporaryDirectory } from "./helpers.js";

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      fs.rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("debrief daemon CLI", () => {
  it("executes install, status, and logs against an isolated launchctl mock", async () => {
    const root = await temporaryDirectory("debrief-cli-");
    temporaryDirectories.push(root);
    const binDir = path.join(root, "bin");
    const debriefHome = path.join(root, ".debrief");
    const launchAgentsDir = path.join(root, "LaunchAgents");
    const runtimeSource = await createRuntimeSource(root);
    const callsPath = path.join(root, "launchctl.calls");
    const launchctlPath = path.join(binDir, "launchctl");
    await fs.mkdir(binDir);
    await fs.writeFile(
      launchctlPath,
      `#!/bin/sh
printf '%s\\n' "$*" >> "$FAKE_LAUNCHCTL_CALLS"
if [ "$1" = "bootout" ]; then exit 3; fi
if [ "$1" = "print" ]; then
  printf 'service = ${LAUNCHD_LABEL}\\n\\tstate = running\\n\\tpid = 5151\\n'
fi
`,
      { mode: 0o700 },
    );
    const env = {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH ?? ""}`,
      DEBRIEF_HOME: debriefHome,
      DEBRIEF_LAUNCH_AGENTS_DIR: launchAgentsDir,
      FAKE_LAUNCHCTL_CALLS: callsPath,
    };
    const tsx = path.resolve("node_modules/.bin/tsx");
    const cli = path.resolve("packages/daemon/src/cli.ts");

    const installed = await execFileAsync(
      tsx,
      [cli, "daemon", "install", "--runtime-source", runtimeSource],
      { env, encoding: "utf8" },
    );
    const status = await execFileAsync(
      tsx,
      [cli, "daemon", "status"],
      { env, encoding: "utf8" },
    );
    await fs.writeFile(
      path.join(debriefHome, "logs", "daemon-2026-07-29.log"),
      "{\"event\":\"daemon_started\"}\n",
    );
    const logs = await execFileAsync(
      tsx,
      [cli, "daemon", "logs", "--lines", "1"],
      { env, encoding: "utf8" },
    );

    expect(JSON.parse(installed.stdout)).toMatchObject({
      label: LAUNCHD_LABEL,
      installed: true,
      running: true,
      pid: 5151,
      runtimeVersion: "0.1.0-test",
      repaired: false,
    });
    expect(JSON.parse(status.stdout)).toMatchObject({
      label: LAUNCHD_LABEL,
      installed: true,
      running: true,
      pid: 5151,
    });
    expect(logs.stdout).toContain(
      'daemon-2026-07-29.log {"event":"daemon_started"}',
    );

    const calls = (await fs.readFile(callsPath, "utf8"))
      .trim()
      .split("\n");
    expect(calls).toHaveLength(6);
    expect(calls.every((call) => call.includes(LAUNCHD_LABEL))).toBe(true);
  });
});

async function createRuntimeSource(root: string): Promise<string> {
  const source = path.join(root, "runtime-source");
  const nodeContents = `#!/bin/sh\nexec '${process.execPath.replaceAll("'", "'\\''")}' "$@"\n`;
  const cliContents = "console.log('fixture runtime');\n";
  const nodeLicenseContents = "Node.js fixture license\n";
  const files = [
    { path: "bin/node", contents: nodeContents, mode: 0o700 },
    { path: "dist/cli.mjs", contents: cliContents, mode: 0o600 },
    {
      path: NODE_RUNTIME_LICENSE_PATH,
      contents: nodeLicenseContents,
      mode: 0o600,
    },
  ];
  for (const file of files) {
    const target = path.join(source, file.path);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, file.contents, { mode: file.mode });
  }
  await fs.writeFile(
    path.join(source, "runtime-manifest.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      version: "0.1.0-test",
      nodeVersion: process.version,
      nodeAbi: process.versions.modules,
      platform: process.platform,
      arch: process.arch,
      nodePath: "bin/node",
      entryPath: "dist/cli.mjs",
      files: files.map((file) => ({
        path: file.path,
        sha256: createHash("sha256").update(file.contents).digest("hex"),
        mode: file.mode,
      })),
    })}\n`,
  );
  return source;
}
