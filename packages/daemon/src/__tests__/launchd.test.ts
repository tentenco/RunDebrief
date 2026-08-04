import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  LAUNCHD_LABEL,
  LAUNCHD_SAFE_PATH,
  LaunchdManager,
} from "../launchd.js";
import type { CommandRunner } from "../types.js";
import { temporaryDirectory } from "./helpers.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      fs.rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("LaunchdManager", () => {
  it("installs, starts, and queries only the approved launchd label", async () => {
    const root = await temporaryDirectory("debrief-launchd-");
    temporaryDirectories.push(root);
    const calls: Array<{ executable: string; args: readonly string[] }> = [];
    const runner: CommandRunner = {
      async run(executable, args) {
        calls.push({ executable, args });
        if (args[0] === "bootout") throw new Error("not loaded");
        if (args[0] === "print") {
          return {
            stdout: `service = ${LAUNCHD_LABEL}\n\tstate = running\n\tpid = 4242\n`,
            stderr: "",
          };
        }
        return { stdout: "", stderr: "" };
      },
    };
    const manager = new LaunchdManager(
      {
        launchAgentsDir: path.join(root, "LaunchAgents"),
        nodeExecutablePath: path.join(root, "runtime", "bin", "node"),
        daemonEntryPath: path.join(root, "daemon", "cli.js"),
        runtimePath: path.join(root, "runtime"),
        debriefHome: path.join(root, ".debrief"),
        logDir: path.join(root, ".debrief", "logs"),
        uid: 501,
      },
      runner,
    );

    const status = await manager.install();
    const plist = await fs.readFile(manager.plistPath, "utf8");

    expect(path.basename(manager.plistPath)).toBe(`${LAUNCHD_LABEL}.plist`);
    expect(plist).toContain(`<string>${LAUNCHD_LABEL}</string>`);
    expect(plist).toContain(`<string>${LAUNCHD_SAFE_PATH}</string>`);
    expect(plist).toContain(
      `<string>${path.join(root, "runtime", "bin", "node")}</string>`,
    );
    expect(plist).not.toContain(`<string>${process.execPath}</string>`);
    expect(plist.match(/<key>Label<\/key>/g)).toHaveLength(1);
    expect(status).toEqual({
      label: LAUNCHD_LABEL,
      installed: true,
      running: true,
      pid: 4242,
      state: "running",
      plistPath: manager.plistPath,
    });
    expect(calls.map((call) => call.args)).toEqual([
      ["bootout", `gui/501/${LAUNCHD_LABEL}`],
      ["bootstrap", "gui/501", manager.plistPath],
      ["enable", `gui/501/${LAUNCHD_LABEL}`],
      ["kickstart", "-k", `gui/501/${LAUNCHD_LABEL}`],
      ["print", `gui/501/${LAUNCHD_LABEL}`],
    ]);
    expect(
      calls.every(
        (call) =>
          call.executable === "launchctl" &&
          call.args.join(" ").includes(LAUNCHD_LABEL),
      ),
    ).toBe(true);
  });

  it("returns recent daemon and launchd logs", async () => {
    const root = await temporaryDirectory("debrief-launchd-logs-");
    temporaryDirectories.push(root);
    const logDir = path.join(root, "logs");
    await fs.mkdir(logDir);
    await fs.writeFile(
      path.join(logDir, "daemon-2026-07-29.log"),
      "{\"event\":\"one\"}\n{\"event\":\"two\"}\n",
    );
    await fs.writeFile(
      path.join(logDir, "launchd.stderr.log"),
      "stderr-line\n",
    );
    const manager = new LaunchdManager(
      {
        launchAgentsDir: path.join(root, "LaunchAgents"),
        nodeExecutablePath: process.execPath,
        daemonEntryPath: path.join(root, "daemon", "cli.js"),
        runtimePath: null,
        debriefHome: path.join(root, ".debrief"),
        logDir,
        uid: 501,
      },
      { run: async () => ({ stdout: "", stderr: "" }) },
    );

    expect(await manager.logs(2)).toBe(
      [
        "daemon-2026-07-29.log {\"event\":\"two\"}",
        "launchd.stderr.log stderr-line",
      ].join("\n"),
    );
  });
});
