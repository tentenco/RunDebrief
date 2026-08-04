import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ClaudeCodeAdapter,
  decodeClaudeProjectPath,
} from "../adapters/claude-code.js";
import { silentLogger } from "./helpers.js";

const temporaryDirectories: string[] = [];
const fixturePath = path.resolve(
  "packages/core/fixtures/claude/session.jsonl",
);
const usageFixturePath = path.resolve(
  "packages/core/fixtures/claude-usage/session.jsonl",
);
const syntheticModelFixturePath = path.resolve(
  "packages/core/fixtures/claude-synthetic-model/session.jsonl",
);

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      fs.rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("ClaudeCodeAdapter", () => {
  it("decodes an encoded project directory and discovers JSONL sessions", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "debrief-claude-"));
    temporaryDirectories.push(root);
    const projectPath = path.join(root, "sample-project");
    await fs.mkdir(projectPath);
    const encoded = projectPath.replaceAll(path.sep, "-");
    const sourceDirectory = path.join(root, "sources", encoded);
    await fs.mkdir(sourceDirectory, { recursive: true });
    await fs.writeFile(
      path.join(sourceDirectory, "session.jsonl"),
      `${JSON.stringify({ type: "system", timestamp: "2026-01-01T00:00:00Z" })}\n`,
    );

    await expect(decodeClaudeProjectPath(encoded)).resolves.toBe(projectPath);
    const adapter = new ClaudeCodeAdapter(
      path.join(root, "sources"),
      silentLogger(),
    );
    const discovered = [];
    for await (const source of adapter.discover()) discovered.push(source);

    expect(discovered).toHaveLength(1);
    expect(discovered[0]?.projectPath).toBe(projectPath);
    expect(discovered[0]?.metadataBytesRead).toBe(0);
    expect(discovered[0]?.sourceSizeBytes).toBeGreaterThan(0);
    expect(discovered[0]?.mtimeMs).toBeGreaterThan(0);
  });

  it("resolves hyphenated and underscored project paths from a later cwd record", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "debrief-claude-"));
    temporaryDirectories.push(root);
    const projectPath = path.join(root, "team-alpha", "sample_repo");
    await fs.mkdir(projectPath, { recursive: true });
    const encoded = projectPath.replaceAll(/[\/_-]/g, "-");
    const sourceDirectory = path.join(root, "sources", encoded);
    await fs.mkdir(sourceDirectory, { recursive: true });
    await fs.writeFile(
      path.join(sourceDirectory, "session.jsonl"),
      [
        JSON.stringify({ type: "system", timestamp: "2026-01-01T00:00:00Z" }),
        JSON.stringify({ type: "queue-operation", operation: "dequeue" }),
        JSON.stringify({
          type: "user",
          cwd: projectPath,
          gitBranch: "phase-1/core-scanner",
          message: { role: "user", content: "Test later metadata." },
        }),
      ].join("\n"),
    );

    const adapter = new ClaudeCodeAdapter(
      path.join(root, "sources"),
      silentLogger(),
    );
    const discovered = [];
    for await (const source of adapter.discover()) discovered.push(source);

    expect(discovered).toHaveLength(1);
    expect(discovered[0]?.projectPath).toBe(projectPath);
    expect(discovered[0]?.metadataBytesRead).toBeGreaterThan(0);
    expect(discovered[0]?.metadataBytesRead).toBeLessThanOrEqual(64 * 1024);
    const source = discovered[0];
    expect(source?.projectPath).not.toBeNull();
    if (!source || source.projectPath === null) return;
    const parsed = await adapter.parseIncrement(source, 0);
    expect(parsed.ok && parsed.extraction.gitBranch).toBe(
      "phase-1/core-scanner",
    );
  });

  it("parses only bytes after scan_offset and extracts messages and files", async () => {
    const adapter = new ClaudeCodeAdapter("/unused", silentLogger());
    const source = {
      sourcePath: fixturePath,
      projectPath: "/REDACTED/sample-repo",
      tool: "claude-code" as const,
    };
    const first = await adapter.parseIncrement(source, 0);

    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.bytesParsed).toBeGreaterThan(0);
    expect(first.extraction.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
    ]);
    expect(first.extraction.touchedFiles).toEqual(["src/example.ts"]);

    const second = await adapter.parseIncrement(source, first.nextOffset);
    expect(second).toMatchObject({ ok: true, bytesParsed: 0 });
  });

  it("deduplicates provider message usage and keeps the latest exact model", async () => {
    const adapter = new ClaudeCodeAdapter("/unused", silentLogger());
    const parsed = await adapter.parseIncrement(
      {
        sourcePath: usageFixturePath,
        projectPath: "/REDACTED/usage-repo",
        tool: "claude-code",
      },
      0,
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.extraction.model).toBe("claude-sonnet-4-5");
    expect(parsed.extraction.cumulativeUsage).toBeNull();
    expect(parsed.extraction.usageEvents).toEqual([
      expect.objectContaining({
        providerMessageId: "msg_REDACTED_A",
        model: "claude-opus-5",
        inputTokens: 1002,
        baseInputTokens: 2,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 1000,
        outputTokens: 100,
        totalTokens: 1102,
        observedAt: "2026-03-01T00:00:03.000Z",
      }),
      expect.objectContaining({
        providerMessageId: "msg_REDACTED_B",
        model: "claude-sonnet-4-5",
        inputTokens: 900,
        baseInputTokens: 0,
        cacheReadInputTokens: 900,
        cacheCreationInputTokens: 0,
        outputTokens: 50,
        totalTokens: 950,
        observedAt: "2026-03-01T00:00:04.000Z",
      }),
    ]);
  });

  it("ignores a synthetic Claude model placeholder without dropping its usage", async () => {
    const adapter = new ClaudeCodeAdapter("/unused", silentLogger());
    const parsed = await adapter.parseIncrement(
      {
        sourcePath: syntheticModelFixturePath,
        projectPath: "/REDACTED/usage-repo",
        tool: "claude-code",
      },
      0,
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.extraction.model).toBe("claude-sonnet-4-5");
    expect(parsed.extraction.usageEvents).toEqual([
      expect.objectContaining({
        providerMessageId: "msg_REDACTED_REAL",
        model: "claude-sonnet-4-5",
        totalTokens: 8,
      }),
      expect.objectContaining({
        providerMessageId: "msg_REDACTED_SYNTHETIC",
        model: null,
        inputTokens: 11,
        outputTokens: 2,
        totalTokens: 13,
      }),
    ]);
  });

  it("supports a usage-only full-source backfill without transcript evidence", async () => {
    const adapter = new ClaudeCodeAdapter("/unused", silentLogger());
    const sourceSizeBytes = (await fs.stat(usageFixturePath)).size;
    const result = await adapter.backfillUsage(
      {
        sourcePath: usageFixturePath,
        projectPath: "/REDACTED/usage-repo",
        tool: "claude-code",
        mtimeMs: 1,
        sourceSizeBytes,
        metadataBytesRead: 0,
      },
    );

    expect(result).toMatchObject({
      ok: true,
      bytesRead: sourceSizeBytes,
      coveredFromOffset: 0,
      coveredToOffset: sourceSizeBytes,
      extraction: {
        model: "claude-sonnet-4-5",
        cumulativeUsage: null,
        usageEvents: expect.any(Array),
      },
    });
  });
});
