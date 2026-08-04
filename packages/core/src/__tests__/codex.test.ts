import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CodexAdapter } from "../adapters/codex.js";
import { silentLogger } from "./helpers.js";

const fixtureDirectory = path.resolve("packages/core/fixtures/codex");
const fixturePath = path.join(fixtureDirectory, "rollout.jsonl");
const roleFilteringFixtureDirectory = path.resolve(
  "packages/core/fixtures/codex-role-filtering",
);
const roleFilteringFixturePath = path.join(
  roleFilteringFixtureDirectory,
  "rollout.jsonl",
);
const usageFixtureDirectory = path.resolve(
  "packages/core/fixtures/codex-usage",
);
const usageFixturePath = path.join(usageFixtureDirectory, "rollout.jsonl");

describe("CodexAdapter", () => {
  it("discovers recursive rollout JSONL files from session_meta cwd", async () => {
    const adapter = new CodexAdapter(fixtureDirectory, silentLogger());
    const discovered = [];
    for await (const source of adapter.discover()) discovered.push(source);

    expect(discovered).toHaveLength(1);
    expect(discovered[0]).toMatchObject({
        sourcePath: fixturePath,
        projectPath: "/REDACTED/sample-repo",
        tool: "codex",
        sourceSizeBytes: 889,
        metadataBytesRead: 889,
    });
    expect(discovered[0]?.mtimeMs).toBeGreaterThan(0);
  });

  it("parses rollout messages, timestamps, and apply_patch files", async () => {
    const adapter = new CodexAdapter(fixtureDirectory, silentLogger());
    const parsed = await adapter.parseIncrement(
      {
        sourcePath: fixturePath,
        projectPath: "/REDACTED/sample-repo",
        tool: "codex",
      },
      0,
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.extraction.messages).toHaveLength(2);
    expect(parsed.extraction.touchedFiles).toEqual(["src/example.ts"]);
    expect(parsed.extraction.startedAt).toBe("2026-01-03T04:05:06.000Z");
    expect(parsed.extraction.endedAt).toBe("2026-01-03T04:05:09.000Z");
  });

  it("keeps only user and assistant conversation while preserving tool evidence", async () => {
    const adapter = new CodexAdapter(
      roleFilteringFixtureDirectory,
      silentLogger(),
    );
    const parsed = await adapter.parseIncrement(
      {
        sourcePath: roleFilteringFixturePath,
        projectPath: "/REDACTED/role-filter-repo",
        tool: "codex",
      },
      0,
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.extraction.messages).toEqual([
      {
        role: "user",
        text: "Show the fixture-safe result.",
        timestamp: "2026-02-04T05:06:10.000Z",
      },
      {
        role: "assistant",
        text: "Implemented the parser.\n\n```ts\nconst ready = true;\n```",
        timestamp: "2026-02-04T05:06:11.000Z",
      },
    ]);
    expect(parsed.extraction.touchedFiles).toEqual(["src/roles.ts"]);
    expect(parsed.extraction.startedAt).toBe("2026-02-04T05:06:07.000Z");
    expect(parsed.extraction.endedAt).toBe("2026-02-04T05:06:13.000Z");
  });

  it("keeps the maximum cumulative snapshot and latest transcript model", async () => {
    const adapter = new CodexAdapter(usageFixtureDirectory, silentLogger());
    const parsed = await adapter.parseIncrement(
      {
        sourcePath: usageFixturePath,
        projectPath: "/REDACTED/usage-repo",
        tool: "codex",
      },
      0,
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.extraction.model).toBe("gpt-5.6-terra");
    expect(parsed.extraction.usageEvents).toEqual([]);
    expect(parsed.extraction.cumulativeUsage).toEqual({
      inputTokens: 100,
      baseInputTokens: 100,
      cacheReadInputTokens: 40,
      cacheCreationInputTokens: 10,
      outputTokens: 20,
      reasoningOutputTokens: 5,
      providerTotalTokens: 120,
      totalTokens: 120,
      observedAt: "2026-03-02T00:00:02.000Z",
    });
  });

  it("uses a bounded tail for cumulative usage backfill", async () => {
    const adapter = new CodexAdapter(usageFixtureDirectory, silentLogger());
    const sourceSizeBytes = (await fs.stat(usageFixturePath)).size;
    const result = await adapter.backfillUsage(
      {
        sourcePath: usageFixturePath,
        projectPath: "/REDACTED/usage-repo",
        tool: "codex",
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
        model: "gpt-5.6-terra",
        cumulativeUsage: expect.objectContaining({ totalTokens: 120 }),
        usageEvents: [],
      },
    });
  });
});
