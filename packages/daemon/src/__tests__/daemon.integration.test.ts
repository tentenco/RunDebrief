import fs from "node:fs/promises";
import path from "node:path";
import { EventEmitter } from "node:events";
import type { FSWatcher } from "chokidar";
import {
  ClaudeCodeAdapter,
  CodexAdapter,
  GitAdapter,
  openDatabase,
  Scanner,
} from "@debrief/core";
import { afterEach, describe, expect, it } from "vitest";
import { DebriefDaemon } from "../daemon.js";
import { SessionEndProcessor, SESSION_QUIET_MS } from "../session-end.js";
import { GatewaySummarizer } from "../summarizer.js";
import type { LiveStatusProvider } from "../types.js";
import { SessionFileWatcher } from "../watcher.js";
import {
  FakeClock,
  silentLogger,
  startJsonServer,
  temporaryDirectory,
} from "./helpers.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      fs.rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("DebriefDaemon integration", () => {
  it("scans a simulated quiet session and stores one schema-valid final summary", async () => {
    const root = await temporaryDirectory("debrief-daemon-integration-");
    temporaryDirectories.push(root);
    const projectPath = path.join(root, "project");
    const claudeRoot = path.join(root, "claude");
    const codexRoot = path.join(root, "codex", "2026", "07", "29");
    const sourcePath = path.join(codexRoot, "rollout.jsonl");
    await fs.mkdir(projectPath);
    await fs.mkdir(claudeRoot);
    await fs.mkdir(codexRoot, { recursive: true });
    await fs.writeFile(
      sourcePath,
      [
        JSON.stringify({
          timestamp: "2026-07-29T01:00:00.000Z",
          type: "session_meta",
          payload: { cwd: projectPath },
        }),
        JSON.stringify({
          timestamp: "2026-07-29T01:01:00.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "Implement the daemon." }],
          },
        }),
        JSON.stringify({
          timestamp: "2026-07-29T01:05:00.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "Daemon implemented." }],
          },
        }),
      ].join("\n"),
    );

    const valid = {
      state_summary: "The daemon integration is implemented.",
      open_items: ["Document reboot verification"],
      next_steps: ["Measure steady RSS"],
      decisions: ["Inject the clock"],
      key_files: ["packages/daemon/src/daemon.ts"],
      blocked: false,
      blocked_reason: null,
    };
    const gateway = await startJsonServer(() => ({
      body: {
        choices: [{ message: { content: JSON.stringify(valid) } }],
      },
    }));
    const logger = silentLogger();
    const db = openDatabase(path.join(root, "debrief.db"));
    const scanner = new Scanner(
      db,
      [
        new ClaudeCodeAdapter(claudeRoot, logger),
        new CodexAdapter(path.join(root, "codex"), logger),
      ],
      new GitAdapter(logger),
      logger,
    );
    let live = true;
    const liveStatus: LiveStatusProvider = {
      poll: async () => [],
      isProjectLive: () => live,
    };
    const clock = new FakeClock(Date.parse("2026-07-29T12:00:00.000Z"));
    const processor = new SessionEndProcessor(
      db,
      liveStatus,
      new GatewaySummarizer(
        {
          gatewayUrl: gateway.url,
          gatewayKey: "",
          summaryModel: "fixture-model",
        },
        logger,
      ),
      { writeOutcome() {} },
      logger,
      clock,
    );
    const fakeFsWatcher = new EventEmitter() as EventEmitter & {
      close: () => Promise<void>;
    };
    fakeFsWatcher.close = async () => undefined;
    let daemon: DebriefDaemon;
    const watcher = new SessionFileWatcher(
      {
        claudeProjectsRoot: claudeRoot,
        codexSessionsRoot: path.join(root, "codex"),
      },
      (watchedPath, observedAt) =>
        daemon.noteSessionObserved(watchedPath, observedAt),
      (watchedPath) => daemon.noteSessionRemoved(watchedPath),
      logger,
      clock,
      () => fakeFsWatcher as unknown as FSWatcher,
    );
    daemon = new DebriefDaemon(
      scanner,
      liveStatus,
      processor,
      watcher,
      logger,
    );

    try {
      await daemon.start();
      fakeFsWatcher.emit("change", sourcePath);
      clock.advance(SESSION_QUIET_MS);
      await daemon.runCycle();
      expect(
        db
          .prepare(
            "SELECT COUNT(*) AS count FROM summaries WHERE model <> 'rules-extraction'",
          )
          .get(),
      ).toEqual({ count: 0 });
      expect(gateway.requests()).toHaveLength(0);

      live = false;
      await daemon.runCycle();
      await daemon.runCycle();

      const rows = db
        .prepare(
          `SELECT model, state_summary, open_items, next_steps, decisions,
                  key_files, blocked, blocked_reason
           FROM summaries ORDER BY id`,
        )
        .all() as Array<Record<string, unknown>>;
      expect(rows).toHaveLength(2);
      expect(rows[0]?.model).toBe("rules-extraction");
      expect(rows[1]).toEqual({
        model: "fixture-model",
        state_summary: valid.state_summary,
        open_items: JSON.stringify(valid.open_items),
        next_steps: JSON.stringify(valid.next_steps),
        decisions: JSON.stringify(valid.decisions),
        key_files: JSON.stringify(valid.key_files),
        blocked: 0,
        blocked_reason: null,
      });
      expect(gateway.requests()).toHaveLength(1);
    } finally {
      await daemon.stop();
      db.close();
      await gateway.close();
    }
  });
});
