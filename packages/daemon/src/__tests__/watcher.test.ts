import { EventEmitter } from "node:events";
import path from "node:path";
import type { FSWatcher, WatchOptions } from "chokidar";
import { describe, expect, it } from "vitest";
import { buildWatchPatterns, SessionFileWatcher } from "../watcher.js";
import { silentLogger } from "./helpers.js";

describe("session watch patterns", () => {
  it("keeps Claude top-level and Codex recursive scope from DESIGN 2.1", () => {
    expect(
      buildWatchPatterns({
        claudeProjectsRoot: "/sessions/claude/projects",
        codexSessionsRoot: "/sessions/codex",
      }),
    ).toEqual([
      path.join("/sessions/claude/projects", "*", "*.jsonl"),
      path.join("/sessions/codex", "**", "*.jsonl"),
    ]);
  });

  it("does not enqueue every historical file during watcher startup", async () => {
    let receivedOptions: WatchOptions | undefined;
    const fake = new EventEmitter() as EventEmitter & {
      close(): Promise<void>;
    };
    fake.close = async () => undefined;
    const watcher = new SessionFileWatcher(
      {
        claudeProjectsRoot: "/sessions/claude/projects",
        codexSessionsRoot: "/sessions/codex",
      },
      () => undefined,
      () => undefined,
      silentLogger(),
      undefined,
      (_patterns, options) => {
        receivedOptions = options;
        return fake as unknown as FSWatcher;
      },
    );

    watcher.start();
    expect(receivedOptions?.ignoreInitial).toBe(true);
    await watcher.close();
  });
});
