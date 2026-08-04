import fs from "node:fs/promises";
import path from "node:path";
import { openDatabase } from "@debrief/core";
import { afterEach, describe, expect, it } from "vitest";
import { LiveProcessDetector } from "../live-detection.js";
import type { CommandRunner } from "../types.js";
import { FakeClock, silentLogger, temporaryDirectory } from "./helpers.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      fs.rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("LiveProcessDetector", () => {
  it("uses execFile-style argv for ps/lsof/tmux and upserts matching status", async () => {
    const root = await temporaryDirectory("debrief-live-");
    temporaryDirectories.push(root);
    const projectPath = path.join(root, "project with spaces");
    await fs.mkdir(projectPath);
    const db = openDatabase(path.join(root, "debrief.db"));
    const project = db
      .prepare("INSERT INTO projects (path, name) VALUES (?, 'fixture')")
      .run(projectPath);
    const calls: Array<{ executable: string; args: readonly string[] }> = [];
    const runner: CommandRunner = {
      async run(executable, args) {
        calls.push({ executable, args });
        if (executable === "ps") {
          return { stdout: "  101 /usr/local/bin/claude\n", stderr: "" };
        }
        if (executable === "lsof") {
          return {
            stdout: `p101\nfcwd\nn${path.join(projectPath, "src")}\n`,
            stderr: "",
          };
        }
        if (executable === "tmux") {
          return {
            stdout: `${projectPath}\twork:1.2\tzsh\n`,
            stderr: "",
          };
        }
        throw new Error(`Unexpected executable ${executable}`);
      },
    };
    const detector = new LiveProcessDetector(
      db,
      silentLogger(),
      runner,
      new FakeClock(Date.parse("2026-07-29T12:00:00.000Z")),
    );

    const live = await detector.poll();

    expect(live).toEqual([
      {
        projectId: Number(project.lastInsertRowid),
        projectPath,
        pid: 101,
        tool: "claude-code",
        tmuxTarget: "work:1.2",
      },
    ]);
    expect(detector.isProjectLive(Number(project.lastInsertRowid))).toBe(true);
    expect(calls).toEqual([
      {
        executable: "ps",
        args: ["-axo", "pid=,command="],
      },
      {
        executable: "lsof",
        args: ["-a", "-p", "101", "-d", "cwd", "-Fn"],
      },
      {
        executable: "tmux",
        args: [
          "list-panes",
          "-a",
          "-F",
          "#{pane_current_path}\t#{session_name}:#{window_index}.#{pane_index}\t#{pane_current_command}",
        ],
      },
    ]);
    expect(
      db.prepare("SELECT pid, tool, tmux_target FROM live_status").get(),
    ).toEqual({ pid: 101, tool: "claude-code", tmux_target: "work:1.2" });
    db.close();
  });

  it("treats an agent command in a tmux pane as live without a separate ps row", async () => {
    const root = await temporaryDirectory("debrief-tmux-");
    temporaryDirectories.push(root);
    const projectPath = path.join(root, "project");
    await fs.mkdir(projectPath);
    const db = openDatabase(path.join(root, "debrief.db"));
    const project = db
      .prepare("INSERT INTO projects (path, name) VALUES (?, 'fixture')")
      .run(projectPath);
    const runner: CommandRunner = {
      async run(executable) {
        if (executable === "ps") return { stdout: "", stderr: "" };
        if (executable === "tmux") {
          return {
            stdout: `${projectPath}\twork:0.0\tcodex\n`,
            stderr: "",
          };
        }
        throw new Error("No lsof call expected");
      },
    };
    const detector = new LiveProcessDetector(db, silentLogger(), runner);

    expect(await detector.poll()).toEqual([
      expect.objectContaining({
        projectId: Number(project.lastInsertRowid),
        pid: null,
        tool: "codex",
        tmuxTarget: "work:0.0",
      }),
    ]);
    db.close();
  });
});
