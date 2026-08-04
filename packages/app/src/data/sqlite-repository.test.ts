import { describe, expect, it, vi } from "vitest";
import {
  isMissingSessionUsageTable,
  loadSessionRows,
  mapSessionUsage,
  type SessionRow,
} from "./sqlite-repository";

const baseSession: SessionRow = {
  id: 7,
  project_id: 3,
  tool: "codex",
  started_at: "2026-07-31T02:00:00.000Z",
  ended_at: "2026-07-31T03:00:00.000Z",
  git_branch: "phase-4/runtime-fix",
};

describe("session usage repository mapping", () => {
  it("preserves nullable values and explicit provider zero", () => {
    expect(
      mapSessionUsage({
        ...baseSession,
        usage_session_id: 7,
        usage_provider: "codex",
        usage_model: "gpt-5.6-sol",
        usage_input_tokens: 0,
        usage_base_input_tokens: null,
        usage_cache_read_input_tokens: 0,
        usage_cache_creation_input_tokens: null,
        usage_output_tokens: 0,
        usage_reasoning_output_tokens: 0,
        usage_provider_total_tokens: 0,
        usage_total_tokens: 0,
        usage_observed_at: "2026-07-31T03:00:00.000Z",
        usage_coverage: "complete",
        usage_covered_from_offset: 0,
        usage_covered_to_offset: 120,
      }),
    ).toEqual({
      provider: "codex",
      model: "gpt-5.6-sol",
      inputTokens: 0,
      baseInputTokens: null,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: null,
      outputTokens: 0,
      reasoningOutputTokens: 0,
      providerTotalTokens: 0,
      totalTokens: 0,
      observedAt: "2026-07-31T03:00:00.000Z",
      coverage: "complete",
      coveredFromOffset: 0,
      coveredToOffset: 120,
    });
  });

  it("maps an absent LEFT JOIN row to missing usage", () => {
    expect(mapSessionUsage(baseSession)).toBeNull();
  });

  it("falls back only when an older database has no usage table", async () => {
    const select = vi
      .fn()
      .mockRejectedValueOnce(
        new Error("database error: no such table: session_usage"),
      )
      .mockResolvedValueOnce([baseSession]);

    await expect(loadSessionRows({ select })).resolves.toEqual([baseSession]);
    expect(select).toHaveBeenCalledTimes(2);
    expect(select.mock.calls[0]?.[0]).toContain(
      "LEFT JOIN session_usage",
    );
    expect(select.mock.calls[1]?.[0]).not.toContain("session_usage");
  });

  it.each([
    "database error: no such table: session_usage",
    "database error: no such table: main.session_usage",
    'database error: no such table: "main"."session_usage"',
    "database error: no such table: [main].[session_usage]",
    "database error: no such table: `main`.`session_usage`",
  ])("accepts the exact missing usage-table identifier: %s", (message) => {
    expect(isMissingSessionUsageTable(new Error(message))).toBe(true);
  });

  it.each([
    "database error: no such table: session_usage_events",
    "database error: no such table: sessions; SQL SELECT * FROM session_usage",
  ])("rejects a different missing-table identifier: %s", (message) => {
    expect(isMissingSessionUsageTable(new Error(message))).toBe(false);
  });

  it("does not hide unrelated database failures", async () => {
    const failure = new Error("database is locked");
    const select = vi.fn().mockRejectedValue(failure);

    await expect(loadSessionRows({ select })).rejects.toBe(failure);
    expect(isMissingSessionUsageTable(failure)).toBe(false);
  });
});
