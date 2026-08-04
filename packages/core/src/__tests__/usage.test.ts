import { describe, expect, it } from "vitest";
import {
  claudeTokenUsage,
  codexTokenUsage,
} from "../adapters/usage.js";

describe("provider token normalization", () => {
  it("keeps explicit zero and large safe Claude values exact", () => {
    expect(
      claudeTokenUsage(
        {
          input_tokens: 0,
          cache_read_input_tokens: 4_000_000_000_000,
          cache_creation_input_tokens: 3_000_000_000_000,
          output_tokens: 2_000_000_000_000,
        },
        null,
      ),
    ).toMatchObject({
      baseInputTokens: 0,
      inputTokens: 7_000_000_000_000,
      outputTokens: 2_000_000_000_000,
      totalTokens: 9_000_000_000_000,
    });
  });

  it("does not add Codex cache or reasoning subsets twice", () => {
    expect(
      codexTokenUsage(
        {
          input_tokens: 1000,
          cached_input_tokens: 800,
          cache_write_input_tokens: 100,
          output_tokens: 200,
          reasoning_output_tokens: 150,
          total_tokens: 1200,
        },
        null,
      ),
    ).toMatchObject({
      inputTokens: 1000,
      cacheReadInputTokens: 800,
      cacheCreationInputTokens: 100,
      outputTokens: 200,
      reasoningOutputTokens: 150,
      providerTotalTokens: 1200,
      totalTokens: 1200,
    });
  });

  it("keeps missing and unsafe components unknown instead of inventing zero", () => {
    expect(
      claudeTokenUsage(
        {
          input_tokens: 10,
          output_tokens: 5,
        },
        null,
      ),
    ).toMatchObject({
      inputTokens: null,
      totalTokens: null,
    });
    expect(
      codexTokenUsage(
        {
          input_tokens: Number.MAX_SAFE_INTEGER,
          output_tokens: 1,
        },
        null,
      ),
    ).toMatchObject({
      inputTokens: Number.MAX_SAFE_INTEGER,
      totalTokens: null,
    });
  });
});
