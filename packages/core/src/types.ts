import type { Logger } from "pino";

export type ToolName = "claude-code" | "codex";

export interface SessionSource {
  sourcePath: string;
  projectPath: string;
  tool: ToolName;
}

export interface SessionFileMetadata {
  mtimeMs: number;
  sourceSizeBytes: number;
  metadataBytesRead: number;
}

export interface DiscoveredSessionSource
  extends SessionSource,
    SessionFileMetadata {}

export interface SkippedSessionSource {
  sourcePath: string;
  projectPath: null;
  tool: ToolName;
  mtimeMs: number;
  sourceSizeBytes: number;
  metadataBytesRead: number;
}

export type SessionDiscovery =
  | DiscoveredSessionSource
  | SkippedSessionSource;

export interface ExtractedMessage {
  role: string;
  text: string;
  timestamp: string | null;
}

export interface TokenUsage {
  inputTokens: number | null;
  baseInputTokens: number | null;
  cacheReadInputTokens: number | null;
  cacheCreationInputTokens: number | null;
  outputTokens: number | null;
  reasoningOutputTokens: number | null;
  providerTotalTokens: number | null;
  totalTokens: number | null;
  observedAt: string | null;
}

export interface TokenUsageEvent extends TokenUsage {
  providerMessageId: string;
  model: string | null;
}

export interface UsageExtraction {
  model: string | null;
  cumulativeUsage: TokenUsage | null;
  usageEvents: TokenUsageEvent[];
}

export interface RuleExtraction extends UsageExtraction {
  messages: ExtractedMessage[];
  touchedFiles: string[];
  startedAt: string | null;
  endedAt: string | null;
  gitBranch: string | null;
}

export interface ParseSuccess {
  ok: true;
  bytesParsed: number;
  nextOffset: number;
  extraction: RuleExtraction;
}

export interface ParseFailure {
  ok: false;
  bytesParsed: 0;
  nextOffset: number;
  error: string;
}

export type ParseResult = ParseSuccess | ParseFailure;

export interface ParseOptions {
  signal?: AbortSignal;
  usageOnly?: boolean;
}

export interface UsageBackfillSuccess {
  ok: true;
  bytesRead: number;
  coveredFromOffset: number;
  coveredToOffset: number;
  extraction: UsageExtraction;
}

export interface UsageBackfillFailure {
  ok: false;
  bytesRead: number;
  error: string;
}

export type UsageBackfillResult =
  | UsageBackfillSuccess
  | UsageBackfillFailure;

export interface SessionAdapter {
  readonly tool: ToolName;
  discover(): AsyncGenerator<SessionDiscovery>;
  parseIncrement(
    source: SessionSource,
    scanOffset: number,
    options?: ParseOptions,
  ): Promise<ParseResult>;
  backfillUsage?(
    source: DiscoveredSessionSource,
    options?: ParseOptions,
  ): Promise<UsageBackfillResult>;
}

export type CoreLogger = Pick<
  Logger,
  "debug" | "error" | "info" | "warn"
>;

export interface GitSnapshot {
  branch: string | null;
  dirty: boolean;
  lastCommitSubject: string | null;
  lastCommitAt: string | null;
}

export interface ScanMetrics {
  discoveredFiles: number;
  discoveredSourceBytes: number;
  metadataBytesRead: number;
  selectedFiles: number;
  selectedSourceBytes: number;
  deferredFiles: number;
  parsedFiles: number;
  unchangedFiles: number;
  skippedFiles: number;
  parsedBytes: number;
  usageBackfillFiles?: number;
  usageBackfillBytes?: number;
  usageBackfillDeferred?: number;
  projectCount: number;
}

export interface ScanOptions {
  signal?: AbortSignal;
  usageBackfillBudgetBytes?: number;
}
