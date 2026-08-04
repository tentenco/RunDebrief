import type { TokenUsage } from "../types.js";

interface JsonObject {
  [key: string]: unknown;
}

const MAX_PROVIDER_IDENTIFIER_LENGTH = 512;

export function exactProviderIdentifier(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_PROVIDER_IDENTIFIER_LENGTH ||
    !value.trim() ||
    value.includes("\0")
  ) {
    return null;
  }
  return value;
}

export function claudeTokenUsage(
  value: unknown,
  observedAt: string | null,
): TokenUsage | null {
  if (!isObject(value)) return null;

  const baseInputTokens = tokenInteger(value.input_tokens);
  const cacheReadInputTokens = tokenInteger(value.cache_read_input_tokens);
  const cacheCreationInputTokens = tokenInteger(
    value.cache_creation_input_tokens,
  );
  const outputTokens = tokenInteger(value.output_tokens);
  if (
    baseInputTokens === null &&
    cacheReadInputTokens === null &&
    cacheCreationInputTokens === null &&
    outputTokens === null
  ) {
    return null;
  }

  const inputTokens = safeTokenSum([
    baseInputTokens,
    cacheReadInputTokens,
    cacheCreationInputTokens,
  ]);
  return {
    inputTokens,
    baseInputTokens,
    cacheReadInputTokens,
    cacheCreationInputTokens,
    outputTokens,
    reasoningOutputTokens: null,
    providerTotalTokens: null,
    totalTokens: safeTokenSum([inputTokens, outputTokens]),
    observedAt,
  };
}

export function codexTokenUsage(
  value: unknown,
  observedAt: string | null,
): TokenUsage | null {
  if (!isObject(value)) return null;

  const inputTokens = tokenInteger(value.input_tokens);
  const cacheReadInputTokens = tokenInteger(value.cached_input_tokens);
  const cacheCreationInputTokens = tokenInteger(
    value.cache_write_input_tokens,
  );
  const outputTokens = tokenInteger(value.output_tokens);
  const reasoningOutputTokens = tokenInteger(value.reasoning_output_tokens);
  const providerTotalTokens = tokenInteger(value.total_tokens);
  if (
    inputTokens === null &&
    cacheReadInputTokens === null &&
    cacheCreationInputTokens === null &&
    outputTokens === null &&
    reasoningOutputTokens === null &&
    providerTotalTokens === null
  ) {
    return null;
  }

  return {
    inputTokens,
    baseInputTokens: inputTokens,
    cacheReadInputTokens,
    cacheCreationInputTokens,
    outputTokens,
    reasoningOutputTokens,
    providerTotalTokens,
    totalTokens: safeTokenSum([inputTokens, outputTokens]),
    observedAt,
  };
}

export function preferCumulativeUsage(
  current: TokenUsage | null,
  candidate: TokenUsage,
): TokenUsage {
  if (current === null) return candidate;
  if (candidate.totalTokens === null) {
    return current.totalTokens === null ? candidate : current;
  }
  if (current.totalTokens === null) return candidate;
  return candidate.totalTokens >= current.totalTokens ? candidate : current;
}

function tokenInteger(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
    ? value
    : null;
}

function safeTokenSum(values: Array<number | null>): number | null {
  if (values.some((value) => value === null)) return null;
  let total = 0;
  for (const value of values) {
    total += value!;
    if (!Number.isSafeInteger(total)) return null;
  }
  return total;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
