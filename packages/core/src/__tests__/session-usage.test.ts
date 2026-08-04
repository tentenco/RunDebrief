import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ClaudeCodeAdapter } from "../adapters/claude-code.js";
import { CodexAdapter } from "../adapters/codex.js";
import { GitAdapter } from "../adapters/git.js";
import type { DebriefDatabase } from "../db.js";
import { openDatabase } from "../db.js";
import { Scanner } from "../scanner.js";
import type { ToolName } from "../types.js";
import { silentLogger } from "./helpers.js";

const temporaryDirectories: string[] = [];
const claudeUsageFixture = path.resolve(
  "packages/core/fixtures/claude-usage/session.jsonl",
);
const codexUsageFixture = path.resolve(
  "packages/core/fixtures/codex-usage/rollout.jsonl",
);
const CLAUDE_FILE_LIMIT = 64 * 1024 * 1024;
const CODEX_TAIL_LIMIT = 8 * 1024 * 1024;

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      fs.rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("session usage persistence", () => {
  it("aggregates deduped Claude events once across repeated scans", async () => {
    const fixture = await claudeFixtureWorkspace();
    const db = openDatabase(path.join(fixture.root, "debrief.db"));
    const scanner = scannerForClaude(db, fixture.claudeRoot);

    const first = await scanner.scan();
    const duplicate = `${JSON.stringify({
      type: "assistant",
      timestamp: "2026-03-01T00:00:05.000Z",
      message: {
        id: "msg_REDACTED_B",
        model: "claude-sonnet-4-5",
        role: "assistant",
        content: [{ type: "text", text: "Duplicate transport record." }],
        usage: {
          input_tokens: 0,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 900,
          output_tokens: 50,
        },
      },
    })}\n`;
    await fs.appendFile(fixture.sourcePath, duplicate);
    const second = await scanner.scan();
    const third = await scanner.scan();

    expect(first.usageBackfillFiles).toBe(0);
    expect(second.parsedBytes).toBe(Buffer.byteLength(duplicate));
    expect(third.parsedBytes).toBe(0);
    expect(readUsage(db)).toMatchObject({
      provider: "claude-code",
      model: "claude-sonnet-4-5",
      input_tokens: 1902,
      base_input_tokens: 2,
      cache_read_input_tokens: 900,
      cache_creation_input_tokens: 1000,
      output_tokens: 150,
      reasoning_output_tokens: null,
      provider_total_tokens: null,
      total_tokens: 2052,
      coverage: "complete",
      covered_from_offset: 0,
      covered_to_offset: fixture.sourceSize + Buffer.byteLength(duplicate),
    });
    expect(eventCount(db)).toBe(2);
    db.close();
  });

  it("persists only the maximum Codex cumulative snapshot", async () => {
    const root = await temporaryDirectory("debrief-codex-usage-");
    const codexRoot = path.join(root, "codex");
    await fs.mkdir(codexRoot);
    const sourcePath = path.join(codexRoot, "rollout.jsonl");
    await fs.copyFile(codexUsageFixture, sourcePath);
    const db = openDatabase(path.join(root, "debrief.db"));
    const scanner = scannerForCodex(db, codexRoot);

    await scanner.scan();

    expect(readUsage(db)).toMatchObject({
      provider: "codex",
      model: "gpt-5.6-terra",
      input_tokens: 100,
      base_input_tokens: 100,
      cache_read_input_tokens: 40,
      cache_creation_input_tokens: 10,
      output_tokens: 20,
      reasoning_output_tokens: 5,
      provider_total_tokens: 120,
      total_tokens: 120,
      coverage: "complete",
    });
    expect(eventCount(db)).toBe(0);

    const lowerIncrement = [
      JSON.stringify({
        timestamp: "2026-03-02T00:00:06.000Z",
        type: "turn_context",
        payload: {
          cwd: "/REDACTED/usage-repo",
          model: "gpt-5.6-mini",
        },
      }),
      JSON.stringify({
        timestamp: "2026-03-02T00:00:07.000Z",
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: {
              input_tokens: 50,
              cached_input_tokens: 40,
              cache_write_input_tokens: 0,
              output_tokens: 10,
              reasoning_output_tokens: 8,
              total_tokens: 60,
            },
          },
        },
      }),
      "",
    ].join("\n");
    await fs.appendFile(sourcePath, lowerIncrement);
    await scanner.scan();

    expect(readUsage(db)).toMatchObject({
      model: "gpt-5.6-mini",
      input_tokens: 100,
      output_tokens: 20,
      total_tokens: 120,
    });
    db.close();
  });

  it("defers an existing Claude backfill when the budget is exhausted, then completes without moving its prior offset", async () => {
    const fixture = await claudeFixtureWorkspace();
    const db = openDatabase(path.join(fixture.root, "debrief.db"));
    seedIndexedSession(
      db,
      fixture.projectPath,
      fixture.sourcePath,
      "claude-code",
      fixture.sourceSize,
    );
    const scanner = scannerForClaude(db, fixture.claudeRoot);

    const deferred = await scanner.scan({ usageBackfillBudgetBytes: 0 });
    expect(deferred).toMatchObject({
      parsedBytes: 0,
      usageBackfillFiles: 0,
      usageBackfillBytes: 0,
      usageBackfillDeferred: 1,
    });
    expect(readUsage(db)).toBeUndefined();
    expect(readOffset(db)).toBe(fixture.sourceSize);

    const completed = await scanner.scan();
    expect(completed).toMatchObject({
      parsedBytes: 0,
      usageBackfillFiles: 1,
      usageBackfillBytes: fixture.sourceSize,
    });
    expect(readUsage(db)).toMatchObject({
      total_tokens: 2052,
      coverage: "complete",
      covered_from_offset: 0,
      covered_to_offset: fixture.sourceSize,
    });
    expect(readOffset(db)).toBe(fixture.sourceSize);
    db.close();
  });

  it("recovers complete existing Codex usage from a bounded aligned tail", async () => {
    const root = await temporaryDirectory("debrief-codex-tail-");
    const codexRoot = path.join(root, "codex");
    const projectPath = path.join(root, "project");
    const sourcePath = path.join(codexRoot, "rollout.jsonl");
    await fs.mkdir(codexRoot);
    await fs.mkdir(projectPath);
    const header = `${JSON.stringify({
      timestamp: "2026-03-03T00:00:00.000Z",
      type: "session_meta",
      payload: { cwd: projectPath, model_provider: "synthetic-router" },
    })}\n`;
    const padding = `${JSON.stringify({
      type: "event_msg",
      payload: { type: "other", padding: "x".repeat(CODEX_TAIL_LIMIT + 1024) },
    })}\n`;
    const tail = [
      JSON.stringify({
        timestamp: "2026-03-03T00:00:01.000Z",
        type: "turn_context",
        payload: { cwd: projectPath, model: "gpt-5.6-sol" },
      }),
      JSON.stringify({
        timestamp: "2026-03-03T00:00:02.000Z",
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: {
              input_tokens: 200,
              cached_input_tokens: 150,
              cache_write_input_tokens: 25,
              output_tokens: 40,
              reasoning_output_tokens: 30,
              total_tokens: 240,
            },
          },
        },
      }),
      "",
    ].join("\n");
    await fs.writeFile(sourcePath, `${header}${padding}${tail}`);
    const sourceSize = (await fs.stat(sourcePath)).size;
    const db = openDatabase(path.join(root, "debrief.db"));
    seedIndexedSession(db, projectPath, sourcePath, "codex", sourceSize);

    const result = await scannerForCodex(db, codexRoot).scan();

    expect(result.parsedBytes).toBe(0);
    expect(result.usageBackfillFiles).toBe(1);
    expect(result.usageBackfillBytes).toBeLessThanOrEqual(CODEX_TAIL_LIMIT);
    expect(readUsage(db)).toMatchObject({
      provider: "codex",
      model: "gpt-5.6-sol",
      total_tokens: 240,
      coverage: "complete",
      covered_from_offset: 0,
      covered_to_offset: sourceSize,
    });
    expect(readOffset(db)).toBe(sourceSize);
    db.close();
  });

  it("marks an oversized existing Claude session partial without inventing zero", async () => {
    const root = await temporaryDirectory("debrief-claude-partial-");
    const projectPath = path.join(root, "project");
    const claudeRoot = path.join(root, "claude");
    const sourceDirectory = path.join(
      claudeRoot,
      projectPath.replaceAll(path.sep, "-"),
    );
    const sourcePath = path.join(sourceDirectory, "session.jsonl");
    await fs.mkdir(projectPath);
    await fs.mkdir(sourceDirectory, { recursive: true });
    await fs.writeFile(
      sourcePath,
      `${JSON.stringify({
        type: "user",
        timestamp: "2026-03-04T00:00:00.000Z",
        message: { role: "user", content: "Existing session." },
      })}\n`,
    );
    await fs.truncate(sourcePath, CLAUDE_FILE_LIMIT + 1);
    const sourceSize = (await fs.stat(sourcePath)).size;
    const db = openDatabase(path.join(root, "debrief.db"));
    seedIndexedSession(
      db,
      projectPath,
      sourcePath,
      "claude-code",
      sourceSize,
    );

    const result = await scannerForClaude(db, claudeRoot).scan();

    expect(result).toMatchObject({
      parsedBytes: 0,
      usageBackfillFiles: 0,
      usageBackfillDeferred: 1,
    });
    expect(readUsage(db)).toMatchObject({
      provider: "claude-code",
      model: null,
      input_tokens: null,
      total_tokens: null,
      coverage: "partial",
      covered_from_offset: sourceSize,
      covered_to_offset: sourceSize,
    });
    db.close();
  });

  it("clears dedupe history after source truncation and preserves explicit zero", async () => {
    const fixture = await claudeFixtureWorkspace();
    const db = openDatabase(path.join(fixture.root, "debrief.db"));
    const scanner = scannerForClaude(db, fixture.claudeRoot);
    await scanner.scan();
    const replacement = `${JSON.stringify({
      type: "assistant",
      timestamp: "2026-03-05T00:00:00.000Z",
      message: {
        id: "msg_REDACTED_ZERO",
        model: "claude-haiku-4-5",
        role: "assistant",
        content: [{ type: "text", text: "No tokens reported." }],
        usage: {
          input_tokens: 0,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
          output_tokens: 0,
        },
      },
    })}\n`;
    await fs.writeFile(fixture.sourcePath, replacement);

    await scanner.scan();

    expect(eventCount(db)).toBe(1);
    expect(readUsage(db)).toMatchObject({
      model: "claude-haiku-4-5",
      input_tokens: 0,
      base_input_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
      coverage: "complete",
      covered_from_offset: 0,
      covered_to_offset: Buffer.byteLength(replacement),
    });
    expect(readOffset(db)).toBe(Buffer.byteLength(replacement));
    db.close();
  });

  it("persists large safe token totals without rounding", async () => {
    const root = await temporaryDirectory("debrief-claude-large-");
    const projectPath = path.join(root, "project");
    const claudeRoot = path.join(root, "claude");
    const sourceDirectory = path.join(
      claudeRoot,
      projectPath.replaceAll(path.sep, "-"),
    );
    const sourcePath = path.join(sourceDirectory, "session.jsonl");
    await fs.mkdir(projectPath);
    await fs.mkdir(sourceDirectory, { recursive: true });
    await fs.writeFile(
      sourcePath,
      `${JSON.stringify({
        type: "assistant",
        timestamp: "2026-03-06T00:00:00.000Z",
        message: {
          id: "msg_REDACTED_LARGE",
          model: "claude-opus-5",
          role: "assistant",
          content: [{ type: "text", text: "Large fixture." }],
          usage: {
            input_tokens: 0,
            cache_creation_input_tokens: 3_000_000_000_000,
            cache_read_input_tokens: 4_000_000_000_000,
            output_tokens: 2_000_000_000_000,
          },
        },
      })}\n`,
    );
    const db = openDatabase(path.join(root, "debrief.db"));

    await scannerForClaude(db, claudeRoot).scan();

    expect(readUsage(db)).toMatchObject({
      input_tokens: 7_000_000_000_000,
      output_tokens: 2_000_000_000_000,
      total_tokens: 9_000_000_000_000,
    });
    db.close();
  });
});

async function claudeFixtureWorkspace(): Promise<{
  root: string;
  projectPath: string;
  claudeRoot: string;
  sourcePath: string;
  sourceSize: number;
}> {
  const root = await temporaryDirectory("debrief-claude-usage-");
  const projectPath = path.join(root, "project");
  const claudeRoot = path.join(root, "claude");
  const sourceDirectory = path.join(
    claudeRoot,
    projectPath.replaceAll(path.sep, "-"),
  );
  const sourcePath = path.join(sourceDirectory, "session.jsonl");
  await fs.mkdir(projectPath);
  await fs.mkdir(sourceDirectory, { recursive: true });
  await fs.copyFile(claudeUsageFixture, sourcePath);
  return {
    root,
    projectPath,
    claudeRoot,
    sourcePath,
    sourceSize: (await fs.stat(sourcePath)).size,
  };
}

function scannerForClaude(
  db: DebriefDatabase,
  claudeRoot: string,
): Scanner {
  const logger = silentLogger();
  return new Scanner(
    db,
    [new ClaudeCodeAdapter(claudeRoot, logger)],
    new GitAdapter(logger),
    logger,
  );
}

function scannerForCodex(
  db: DebriefDatabase,
  codexRoot: string,
): Scanner {
  const logger = silentLogger();
  return new Scanner(
    db,
    [new CodexAdapter(codexRoot, logger)],
    new GitAdapter(logger),
    logger,
  );
}

function seedIndexedSession(
  db: DebriefDatabase,
  projectPath: string,
  sourcePath: string,
  tool: ToolName,
  scanOffset: number,
): void {
  db.prepare(
    `INSERT INTO projects (path, name)
     VALUES (?, 'fixture-project')`,
  ).run(projectPath);
  const project = db
    .prepare("SELECT id FROM projects WHERE path = ?")
    .get(projectPath) as { id: number };
  db.prepare(
    `INSERT INTO sessions (
       project_id, tool, source_path, scan_offset
     ) VALUES (?, ?, ?, ?)`,
  ).run(project.id, tool, sourcePath, scanOffset);
}

function readUsage(db: DebriefDatabase) {
  return db
    .prepare(
      `SELECT provider, model, input_tokens, base_input_tokens,
              cache_read_input_tokens, cache_creation_input_tokens,
              output_tokens, reasoning_output_tokens,
              provider_total_tokens, total_tokens, coverage,
              covered_from_offset, covered_to_offset
       FROM session_usage`,
    )
    .get();
}

function eventCount(db: DebriefDatabase): number {
  return (
    db
      .prepare("SELECT COUNT(*) AS count FROM session_usage_events")
      .get() as { count: number }
  ).count;
}

function readOffset(db: DebriefDatabase): number {
  return (
    db.prepare("SELECT scan_offset FROM sessions").get() as {
      scan_offset: number;
    }
  ).scan_offset;
}

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}
