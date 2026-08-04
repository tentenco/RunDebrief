import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ClaudeCodeAdapter } from "../adapters/claude-code.js";
import { CodexAdapter } from "../adapters/codex.js";
import { GitAdapter } from "../adapters/git.js";
import { openDatabase } from "../db.js";
import { buildDigest, Scanner } from "../scanner.js";
import { silentLogger } from "./helpers.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      fs.rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("Scanner", () => {
  it("persists extraction and offsets, then reports zero new bytes", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "debrief-scan-"));
    temporaryDirectories.push(root);
    const codexRoot = path.join(root, "codex", "2026", "01", "03");
    await fs.mkdir(codexRoot, { recursive: true });
    await fs.copyFile(
      path.resolve("packages/core/fixtures/codex/rollout.jsonl"),
      path.join(codexRoot, "rollout.jsonl"),
    );
    const db = openDatabase(path.join(root, "debrief.db"));
    const logger = silentLogger();
    const scanner = new Scanner(
      db,
      [
        new ClaudeCodeAdapter(path.join(root, "missing-claude"), logger),
        new CodexAdapter(path.join(root, "codex"), logger),
      ],
      new GitAdapter(logger),
      logger,
    );

    const first = await scanner.scan();
    const second = await scanner.scan();
    const session = db
      .prepare("SELECT scan_offset FROM sessions")
      .get() as { scan_offset: number };
    const summary = db
      .prepare(
        "SELECT model, state_summary, key_files FROM summaries WHERE session_id IS NOT NULL",
      )
      .get() as {
      model: string;
      state_summary: string;
      key_files: string;
    };

    expect(first.parsedBytes).toBeGreaterThan(0);
    expect(second.parsedBytes).toBe(0);
    expect(session.scan_offset).toBe(first.parsedBytes);
    expect(summary.model).toBe("rules-extraction");
    expect(JSON.parse(summary.state_summary)).toMatchObject({
      version: 1,
      digest: "The fixture-safe example was added.",
      messages: expect.arrayContaining([
        expect.objectContaining({ role: "user" }),
      ]),
      git: null,
    });
    expect(JSON.parse(summary.key_files)).toEqual(["src/example.ts"]);
    db.close();
  });

  it("discovers historical metadata but parses only the newest session per project", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "debrief-select-"));
    temporaryDirectories.push(root);
    const codexRoot = path.join(root, "codex");
    const projectPath = path.join(root, "project");
    await fs.mkdir(codexRoot);
    await fs.mkdir(projectPath);
    const olderPath = path.join(codexRoot, "older.jsonl");
    const newerPath = path.join(codexRoot, "newer.jsonl");
    const olderHeader = JSON.stringify({
      type: "session_meta",
      payload: { cwd: projectPath },
    });
    await fs.writeFile(
      olderPath,
      `${olderHeader}\n${"x".repeat(1024 * 1024)}`,
    );
    const newerContent = codexSession(
      projectPath,
      "Newest recap candidate",
      "2026-01-02T00:00:00.000Z",
    );
    await fs.writeFile(newerPath, newerContent);
    await fs.utimes(
      olderPath,
      new Date("2026-01-01T00:00:00.000Z"),
      new Date("2026-01-01T00:00:00.000Z"),
    );
    await fs.utimes(
      newerPath,
      new Date("2026-01-02T00:00:00.000Z"),
      new Date("2026-01-02T00:00:00.000Z"),
    );

    const logger = silentLogger();
    const db = openDatabase(path.join(root, "debrief.db"));
    const scanner = new Scanner(
      db,
      [new CodexAdapter(codexRoot, logger)],
      new GitAdapter(logger),
      logger,
    );

    const first = await scanner.scan();
    const second = await scanner.scan();
    const sessions = db
      .prepare("SELECT source_path, scan_offset FROM sessions")
      .all() as Array<{ source_path: string; scan_offset: number }>;
    const olderSize = (await fs.stat(olderPath)).size;
    const newerSize = (await fs.stat(newerPath)).size;

    expect(first).toMatchObject({
      discoveredFiles: 2,
      discoveredSourceBytes: olderSize + newerSize,
      selectedFiles: 1,
      selectedSourceBytes: newerSize,
      deferredFiles: 1,
      parsedFiles: 1,
      parsedBytes: newerSize,
      skippedFiles: 0,
    });
    expect(first.metadataBytesRead).toBeLessThan(
      first.discoveredSourceBytes,
    );
    expect(sessions).toEqual([
      { source_path: newerPath, scan_offset: newerSize },
    ]);
    expect(second).toMatchObject({
      discoveredFiles: 2,
      selectedFiles: 1,
      deferredFiles: 1,
      parsedFiles: 0,
      parsedBytes: 0,
      unchangedFiles: 1,
    });
    db.close();
  });

  it("uses source path as the deterministic tie-breaker", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "debrief-tie-"));
    temporaryDirectories.push(root);
    const codexRoot = path.join(root, "codex");
    const projectPath = path.join(root, "project");
    await fs.mkdir(codexRoot);
    await fs.mkdir(projectPath);
    const firstPath = path.join(codexRoot, "a-session.jsonl");
    const tiedWinnerPath = path.join(codexRoot, "z-session.jsonl");
    await fs.writeFile(
      firstPath,
      codexSession(projectPath, "First path", "2026-01-01T00:00:00.000Z"),
    );
    await fs.writeFile(
      tiedWinnerPath,
      codexSession(projectPath, "Tie winner", "2026-01-01T00:00:00.000Z"),
    );
    const tiedTime = new Date("2026-01-03T00:00:00.000Z");
    await fs.utimes(firstPath, tiedTime, tiedTime);
    await fs.utimes(tiedWinnerPath, tiedTime, tiedTime);

    const logger = silentLogger();
    const db = openDatabase(path.join(root, "debrief.db"));
    const scanner = new Scanner(
      db,
      [new CodexAdapter(codexRoot, logger)],
      new GitAdapter(logger),
      logger,
    );

    const result = await scanner.scan();
    const session = db
      .prepare("SELECT source_path FROM sessions")
      .get() as { source_path: string };

    expect(result).toMatchObject({
      discoveredFiles: 2,
      selectedFiles: 1,
      deferredFiles: 1,
    });
    expect(session.source_path).toBe(tiedWinnerPath);
    db.close();
  });

  it("selects the newest session across Claude Code and Codex for the same project", async () => {
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), "debrief-cross-tool-"),
    );
    temporaryDirectories.push(root);
    const projectPath = path.join(root, "shared-project");
    const claudeRoot = path.join(root, "claude");
    const codexRoot = path.join(root, "codex");
    const encodedProjectPath = projectPath.replaceAll(path.sep, "-");
    const claudeProjectRoot = path.join(claudeRoot, encodedProjectPath);
    await fs.mkdir(projectPath);
    await fs.mkdir(claudeProjectRoot, { recursive: true });
    await fs.mkdir(codexRoot);
    const claudePath = path.join(claudeProjectRoot, "claude-session.jsonl");
    const codexPath = path.join(codexRoot, "codex-session.jsonl");
    await fs.writeFile(
      claudePath,
      `${JSON.stringify({
        type: "assistant",
        timestamp: "2026-01-01T00:00:00.000Z",
        cwd: projectPath,
        message: { content: "Older Claude recap" },
      })}\n`,
    );
    await fs.writeFile(
      codexPath,
      codexSession(
        projectPath,
        "Newer Codex recap",
        "2026-01-02T00:00:00.000Z",
      ),
    );
    await fs.utimes(
      claudePath,
      new Date("2026-01-01T00:00:00.000Z"),
      new Date("2026-01-01T00:00:00.000Z"),
    );
    await fs.utimes(
      codexPath,
      new Date("2026-01-02T00:00:00.000Z"),
      new Date("2026-01-02T00:00:00.000Z"),
    );

    const logger = silentLogger();
    const db = openDatabase(path.join(root, "debrief.db"));
    const scanner = new Scanner(
      db,
      [
        new ClaudeCodeAdapter(claudeRoot, logger),
        new CodexAdapter(codexRoot, logger),
      ],
      new GitAdapter(logger),
      logger,
    );

    const result = await scanner.scan();
    const session = db
      .prepare("SELECT tool, source_path FROM sessions")
      .get() as { tool: string; source_path: string };

    expect(result).toMatchObject({
      discoveredFiles: 2,
      selectedFiles: 1,
      deferredFiles: 1,
      parsedFiles: 1,
    });
    expect(session).toEqual({ tool: "codex", source_path: codexPath });
    db.close();
  });

  it("keeps indexed history while new and updated sessions become selected", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "debrief-follow-"));
    temporaryDirectories.push(root);
    const codexRoot = path.join(root, "codex");
    const projectPath = path.join(root, "project");
    await fs.mkdir(codexRoot);
    await fs.mkdir(projectPath);
    const originalPath = path.join(codexRoot, "original.jsonl");
    const newPath = path.join(codexRoot, "new.jsonl");
    const originalContent = codexSession(
      projectPath,
      "Original recap",
      "2026-01-01T00:00:00.000Z",
    );
    await fs.writeFile(originalPath, originalContent);
    await fs.utimes(
      originalPath,
      new Date("2026-01-01T00:00:00.000Z"),
      new Date("2026-01-01T00:00:00.000Z"),
    );

    const logger = silentLogger();
    const db = openDatabase(path.join(root, "debrief.db"));
    const scanner = new Scanner(
      db,
      [new CodexAdapter(codexRoot, logger)],
      new GitAdapter(logger),
      logger,
    );

    await scanner.scan();
    await fs.writeFile(
      newPath,
      codexSession(
        projectPath,
        "New session recap",
        "2026-01-02T00:00:00.000Z",
      ),
    );
    await fs.utimes(
      newPath,
      new Date("2026-01-02T00:00:00.000Z"),
      new Date("2026-01-02T00:00:00.000Z"),
    );
    const newScan = await scanner.scan();
    const appendedRecord = `${JSON.stringify({
      timestamp: "2026-01-03T00:00:00.000Z",
      type: "response_item",
      payload: {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "Original updated again" }],
      },
    })}\n`;
    await fs.appendFile(originalPath, appendedRecord);
    await fs.utimes(
      originalPath,
      new Date("2026-01-03T00:00:00.000Z"),
      new Date("2026-01-03T00:00:00.000Z"),
    );
    const updatedScan = await scanner.scan();
    const sessions = db
      .prepare(
        "SELECT source_path, scan_offset FROM sessions ORDER BY source_path",
      )
      .all() as Array<{ source_path: string; scan_offset: number }>;

    expect(newScan).toMatchObject({
      discoveredFiles: 2,
      selectedFiles: 1,
      deferredFiles: 1,
      parsedFiles: 1,
    });
    expect(updatedScan).toMatchObject({
      discoveredFiles: 2,
      selectedFiles: 1,
      deferredFiles: 1,
      parsedFiles: 1,
      parsedBytes: Buffer.byteLength(appendedRecord),
    });
    expect(sessions).toEqual([
      {
        source_path: newPath,
        scan_offset: (await fs.stat(newPath)).size,
      },
      {
        source_path: originalPath,
        scan_offset: (await fs.stat(originalPath)).size,
      },
    ]);
    db.close();
  });

  it("drops legacy internal roles when merging an incremental extraction", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "debrief-roles-"));
    temporaryDirectories.push(root);
    const codexRoot = path.join(root, "codex");
    const projectPath = path.join(root, "project");
    const sourcePath = path.join(codexRoot, "session.jsonl");
    await fs.mkdir(codexRoot);
    await fs.mkdir(projectPath);
    await fs.writeFile(
      sourcePath,
      codexSession(
        projectPath,
        "Existing assistant outcome.",
        "2026-01-01T00:00:00.000Z",
      ),
    );

    const logger = silentLogger();
    const db = openDatabase(path.join(root, "debrief.db"));
    const scanner = new Scanner(
      db,
      [new CodexAdapter(codexRoot, logger)],
      new GitAdapter(logger),
      logger,
    );
    await scanner.scan();
    const summaryRow = db
      .prepare("SELECT id, state_summary FROM summaries")
      .get() as { id: number; state_summary: string };
    const stored = JSON.parse(summaryRow.state_summary) as {
      messages: Array<ReturnType<typeof message>>;
    };
    stored.messages.unshift(
      message("developer", "<environment_context>private</environment_context>"),
    );
    db.prepare("UPDATE summaries SET state_summary = ? WHERE id = ?").run(
      JSON.stringify(stored),
      summaryRow.id,
    );
    const appendedRecord = `${JSON.stringify({
      timestamp: "2026-01-02T00:00:00.000Z",
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "A later prompt." }],
      },
    })}\n`;
    await fs.appendFile(sourcePath, appendedRecord);

    const result = await scanner.scan();
    const updated = db
      .prepare("SELECT state_summary FROM summaries WHERE id = ?")
      .get(summaryRow.id) as { state_summary: string };
    const extraction = JSON.parse(updated.state_summary) as {
      digest: string;
      messages: Array<{ role: string }>;
    };

    expect(result.parsedBytes).toBe(Buffer.byteLength(appendedRecord));
    expect(extraction.messages.map(({ role }) => role)).toEqual([
      "assistant",
      "user",
    ]);
    expect(extraction.digest).toBe("Existing assistant outcome.");
    db.close();
  });

  it("logs malformed JSONL, leaves its offset unchanged, and keeps scanning", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "debrief-broken-"));
    temporaryDirectories.push(root);
    const codexRoot = path.join(root, "codex");
    await fs.mkdir(codexRoot);
    await fs.copyFile(
      path.resolve("packages/core/fixtures/malformed/broken.jsonl"),
      path.join(codexRoot, "broken.jsonl"),
    );
    const events: Array<Record<string, unknown>> = [];
    const base = silentLogger();
    const logger = {
      debug: base.debug.bind(base),
      info: base.info.bind(base),
      warn: base.warn.bind(base),
      error(object: Record<string, unknown>) {
        events.push(object);
      },
    };
    const db = openDatabase(path.join(root, "debrief.db"));
    const scanner = new Scanner(
      db,
      [new CodexAdapter(codexRoot, logger)],
      new GitAdapter(logger),
      logger,
    );

    const result = await scanner.scan();
    const session = db
      .prepare("SELECT scan_offset FROM sessions")
      .get() as { scan_offset: number };

    expect(result.skippedFiles).toBe(1);
    expect(session.scan_offset).toBe(0);
    expect(events).toContainEqual(
      expect.objectContaining({ event: "malformed_jsonl" }),
    );
    db.close();
  });

  it("counts a discovered session without a project path as skipped", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "debrief-missing-cwd-"));
    temporaryDirectories.push(root);
    const codexRoot = path.join(root, "codex");
    await fs.mkdir(codexRoot);
    await fs.writeFile(
      path.join(codexRoot, "missing-cwd.jsonl"),
      `${JSON.stringify({ type: "response_item", payload: {} })}\n`,
    );
    const logger = silentLogger();
    const db = openDatabase(path.join(root, "debrief.db"));
    const scanner = new Scanner(
      db,
      [new CodexAdapter(codexRoot, logger)],
      new GitAdapter(logger),
      logger,
    );

    const result = await scanner.scan();
    const sessionCount = (
      db.prepare("SELECT COUNT(*) AS count FROM sessions").get() as {
        count: number;
      }
    ).count;

    expect(result).toMatchObject({ discoveredFiles: 1, skippedFiles: 1 });
    expect(sessionCount).toBe(0);
    db.close();
  });
});

describe("buildDigest", () => {
  it("uses the latest meaningful assistant outcome and removes memory transport", () => {
    expect(
      buildDigest([
        message("user", "Please inspect the parser."),
        message("assistant", "An older outcome."),
        message(
          "assistant",
          [
            "Implemented the parser.",
            "",
            "<oai-mem-citation>",
            "<citation_entries>private transport</citation_entries>",
            "</oai-mem-citation>",
          ].join("\n"),
        ),
      ]),
    ).toBe("Implemented the parser.");
  });

  it("skips an assistant message that contains only memory transport", () => {
    expect(
      buildDigest([
        message("assistant", "Earlier meaningful outcome."),
        message(
          "assistant",
          "<oai-mem-citation>transport only</oai-mem-citation>",
        ),
      ]),
    ).toBe("Earlier meaningful outcome.");
  });

  it("removes repeated complete blocks and an incomplete trailing transport block", () => {
    expect(
      buildDigest([
        message(
          "assistant",
          [
            "Outcome remains.",
            "<oai-mem-citation>first</oai-mem-citation>",
            "<oai-mem-citation source=\"local\">second</oai-mem-citation>",
            "<oai-mem-citation>trailing transport",
          ].join("\n"),
        ),
      ]),
    ).toBe("Outcome remains.");
  });

  it("uses a bounded generic fallback when no assistant outcome exists", () => {
    const digest = buildDigest([
      message("developer", "<environment_context>private</environment_context>"),
      message("user", "A prompt must not become the outcome."),
    ]);

    expect(digest).toBe(
      "No assistant outcome was captured for this session.",
    );
    expect(digest.length).toBeLessThan(80);
  });

  it("preserves legitimate Markdown, fenced code, and unrelated XML", () => {
    const outcome = [
      "## Result",
      "",
      "The parser keeps `<component-state>` as authored.",
      "",
      "```ts",
      "const ready = true;",
      "```",
    ].join("\n");

    expect(buildDigest([message("assistant", outcome)])).toBe(outcome);
  });
});

function codexSession(
  projectPath: string,
  message: string,
  timestamp: string,
): string {
  return [
    JSON.stringify({
      timestamp,
      type: "session_meta",
      payload: { cwd: projectPath },
    }),
    JSON.stringify({
      timestamp,
      type: "response_item",
      payload: {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: message }],
      },
    }),
    "",
  ].join("\n");
}

function message(role: string, text: string) {
  return {
    role,
    text,
    timestamp: "2026-01-01T00:00:00.000Z",
  };
}
