import path from "node:path";
import type { DebriefDatabase } from "./db.js";
import type {
  CoreLogger,
  DiscoveredSessionSource,
  ExtractedMessage,
  GitSnapshot,
  RuleExtraction,
  ScanMetrics,
  ScanOptions,
  SessionAdapter,
  SessionSource,
  TokenUsage,
  TokenUsageEvent,
  ToolName,
  UsageBackfillSuccess,
  UsageExtraction,
} from "./types.js";
import { MESSAGE_LIMIT } from "./adapters/incremental.js";
import { preferCumulativeUsage } from "./adapters/usage.js";
import { GitAdapter } from "./adapters/git.js";

const CLAUDE_USAGE_BACKFILL_FILE_LIMIT = 64 * 1024 * 1024;
const CODEX_USAGE_BACKFILL_TAIL_LIMIT = 8 * 1024 * 1024;
const USAGE_BACKFILL_SCAN_BUDGET = 512 * 1024 * 1024;

interface ProjectRow {
  id: number;
}

interface SessionRow {
  id: number;
  scan_offset: number | null;
  started_at: string | null;
  ended_at: string | null;
  git_branch: string | null;
}

interface SummaryRow {
  id: number;
  state_summary: string | null;
  key_files: string | null;
}

interface SessionUsageRow {
  session_id: number;
  provider: ToolName;
  model: string | null;
  input_tokens: number | null;
  base_input_tokens: number | null;
  cache_read_input_tokens: number | null;
  cache_creation_input_tokens: number | null;
  output_tokens: number | null;
  reasoning_output_tokens: number | null;
  provider_total_tokens: number | null;
  total_tokens: number | null;
  observed_at: string | null;
  coverage: "complete" | "partial";
  covered_from_offset: number;
  covered_to_offset: number;
}

interface StoredRuleSummary {
  version: 1;
  digest: string;
  messages: ExtractedMessage[];
  git: GitSnapshot | null;
}

interface SelectedSession {
  adapter: SessionAdapter;
  source: DiscoveredSessionSource;
}

interface UsageBackfillBudget {
  remainingBytes: number;
}

interface PreparedUsageBackfill {
  result: UsageBackfillSuccess | null;
  partialBaseline: boolean;
}

type ScannerMetrics = ScanMetrics & {
  usageBackfillFiles: number;
  usageBackfillBytes: number;
  usageBackfillDeferred: number;
};

export class Scanner {
  constructor(
    private readonly db: DebriefDatabase,
    private readonly adapters: SessionAdapter[],
    private readonly gitAdapter: GitAdapter,
    private readonly logger: CoreLogger,
  ) {}

  async scan(options: ScanOptions = {}): Promise<ScanMetrics> {
    const metrics: ScannerMetrics = {
      discoveredFiles: 0,
      discoveredSourceBytes: 0,
      metadataBytesRead: 0,
      selectedFiles: 0,
      selectedSourceBytes: 0,
      deferredFiles: 0,
      parsedFiles: 0,
      unchangedFiles: 0,
      skippedFiles: 0,
      parsedBytes: 0,
      usageBackfillFiles: 0,
      usageBackfillBytes: 0,
      usageBackfillDeferred: 0,
      projectCount: 0,
    };
    const selectedByProject = new Map<string, SelectedSession>();
    let eligibleFiles = 0;
    const gitCache = new Map<string, GitSnapshot | null>();
    const usageBackfillBudget: UsageBackfillBudget = {
      remainingBytes: boundedBackfillBudget(
        options.usageBackfillBudgetBytes,
      ),
    };

    for (const adapter of this.adapters) {
      throwIfScanAborted(options.signal);
      try {
        for await (const source of adapter.discover()) {
          throwIfScanAborted(options.signal);
          metrics.discoveredFiles += 1;
          metrics.discoveredSourceBytes += source.sourceSizeBytes;
          metrics.metadataBytesRead += source.metadataBytesRead;
          if (source.projectPath === null) {
            metrics.skippedFiles += 1;
            continue;
          }
          eligibleFiles += 1;
          const current = selectedByProject.get(source.projectPath);
          if (!current || isMoreRecentSource(source, current.source)) {
            selectedByProject.set(source.projectPath, { adapter, source });
          }
        }
      } catch (error) {
        if (options.signal?.aborted) throw abortReason(options.signal);
        this.logger.error(
          {
            event: "adapter_scan_failed",
            tool: adapter.tool,
            reason: error instanceof Error ? error.message : String(error),
          },
          "Adapter failed; continuing with remaining sources",
        );
      }
    }

    const selected = [...selectedByProject.values()].sort((left, right) => {
      const projectOrder = left.source.projectPath.localeCompare(
        right.source.projectPath,
      );
      return (
        projectOrder ||
        left.source.sourcePath.localeCompare(right.source.sourcePath)
      );
    });
    metrics.selectedFiles = selected.length;
    metrics.deferredFiles = eligibleFiles - selected.length;
    metrics.selectedSourceBytes = selected.reduce(
      (total, candidate) => total + candidate.source.sourceSizeBytes,
      0,
    );
    this.logger.info(
      {
        event: "scan_selection_complete",
        discoveredFiles: metrics.discoveredFiles,
        discoveredSourceBytes: metrics.discoveredSourceBytes,
        metadataBytesRead: metrics.metadataBytesRead,
        selectedFiles: metrics.selectedFiles,
        selectedSourceBytes: metrics.selectedSourceBytes,
        deferredFiles: metrics.deferredFiles,
      },
      "Selected newest session per project",
    );

    for (const candidate of selected) {
      throwIfScanAborted(options.signal);
      try {
        await this.scanSource(
          candidate.adapter,
          candidate.source,
          gitCache,
          usageBackfillBudget,
          metrics,
          options,
        );
      } catch (error) {
        if (options.signal?.aborted) throw abortReason(options.signal);
        metrics.skippedFiles += 1;
        this.logger.error(
          {
            event: "session_scan_failed",
            sourcePath: candidate.source.sourcePath,
            tool: candidate.source.tool,
            reason: error instanceof Error ? error.message : String(error),
          },
          "Skipping session after unexpected scanner error",
        );
      }
    }

    metrics.projectCount = (
      this.db.prepare("SELECT COUNT(*) AS count FROM projects").get() as {
        count: number;
      }
    ).count;
    this.logger.info(
      { event: "scan_complete", ...metrics },
      "Debrief scan complete",
    );
    return metrics;
  }

  private async scanSource(
    adapter: SessionAdapter,
    source: DiscoveredSessionSource,
    gitCache: Map<string, GitSnapshot | null>,
    usageBackfillBudget: UsageBackfillBudget,
    metrics: ScannerMetrics,
    options: ScanOptions,
  ): Promise<void> {
    throwIfScanAborted(options.signal);
    const project = this.upsertProject(source.projectPath);
    const session = this.upsertSession(source, project.id);
    const scanOffset = session.scan_offset ?? 0;
    const parsed = await adapter.parseIncrement(source, scanOffset, options);

    if (!parsed.ok) {
      metrics.skippedFiles += 1;
      return;
    }

    if (parsed.bytesParsed === 0) {
      metrics.unchangedFiles += 1;
    } else {
      metrics.parsedFiles += 1;
      metrics.parsedBytes += parsed.bytesParsed;
    }

    const existingUsage = this.getSessionUsage(session.id);
    const sourceRestarted = scanOffset > source.sourceSizeBytes;
    const usageProviderChanged =
      existingUsage !== undefined &&
      existingUsage.provider !== source.tool;
    const usageReset = sourceRestarted || usageProviderChanged;
    const retainedUsage = usageReset ? undefined : existingUsage;
    const needsUsageBackfill =
      !sourceRestarted &&
      scanOffset > 0 &&
      (retainedUsage === undefined ||
        retainedUsage.coverage === "partial");
    const usageBackfill =
      needsUsageBackfill
        ? await this.prepareUsageBackfill(
            adapter,
            source,
            scanOffset,
            usageBackfillBudget,
            metrics,
            options,
          )
        : { result: null, partialBaseline: false };

    let git = gitCache.get(source.projectPath);
    if (git === undefined && !gitCache.has(source.projectPath)) {
      git = await this.gitAdapter.inspect(source.projectPath);
      gitCache.set(source.projectPath, git);
    }

    const existing = this.getRuleSummary(session.id);
    const merged = mergeExtraction(existing, parsed.extraction, git ?? null);
    const startedAt = earliest(
      session.started_at,
      parsed.extraction.startedAt,
    );
    const endedAt = latest(session.ended_at, parsed.extraction.endedAt);
    const gitBranch =
      parsed.extraction.gitBranch ?? session.git_branch ?? git?.branch ?? null;

    const persist = this.db.transaction(() => {
      if (usageReset) {
        this.clearSessionUsage(session.id);
      }
      this.db
        .prepare(
          `UPDATE sessions
             SET scan_offset = ?, started_at = ?, ended_at = ?, git_branch = ?
           WHERE id = ?`,
        )
        .run(
          parsed.nextOffset,
          startedAt,
          endedAt,
          gitBranch,
          session.id,
        );

      this.db
        .prepare(
          `UPDATE projects
             SET last_activity_at =
               CASE
                 WHEN ? IS NULL THEN last_activity_at
                 WHEN last_activity_at IS NULL OR ? > last_activity_at THEN ?
                 ELSE last_activity_at
               END
           WHERE id = ?`,
        )
        .run(endedAt, endedAt, endedAt, project.id);

      this.upsertRuleSummary(
        existing?.id ?? null,
        session.id,
        project.id,
        endedAt,
        merged,
      );
      this.persistSessionUsage({
        sessionId: session.id,
        provider: source.tool,
        previous: retainedUsage,
        incremental: parsed.extraction,
        backfill: usageBackfill,
        scanOffset: sourceRestarted ? 0 : scanOffset,
        nextOffset: parsed.nextOffset,
        sourceSize: source.sourceSizeBytes,
      });
    });
    persist();

    if (parsed.bytesParsed > 0) {
      this.logger.info(
        {
          event: "session_scanned",
          sourcePath: source.sourcePath,
          tool: source.tool,
          parsedBytes: parsed.bytesParsed,
          scanOffset: parsed.nextOffset,
        },
        "Session increment parsed",
      );
    }
  }

  private upsertProject(projectPath: string): ProjectRow {
    const name = path.basename(projectPath) || projectPath;
    this.db
      .prepare(
        `INSERT INTO projects (path, name, client)
         VALUES (?, ?, NULL)
         ON CONFLICT(path) DO UPDATE SET name = excluded.name`,
      )
      .run(projectPath, name);
    return this.db
      .prepare("SELECT id FROM projects WHERE path = ?")
      .get(projectPath) as ProjectRow;
  }

  private upsertSession(
    source: SessionSource,
    projectId: number,
  ): SessionRow {
    this.db
      .prepare(
        `INSERT INTO sessions (project_id, tool, source_path, scan_offset)
         VALUES (?, ?, ?, 0)
         ON CONFLICT(source_path) DO UPDATE SET
           project_id = excluded.project_id,
           tool = excluded.tool`,
      )
      .run(projectId, source.tool, source.sourcePath);
    return this.db
      .prepare(
        `SELECT id, scan_offset, started_at, ended_at, git_branch
         FROM sessions WHERE source_path = ?`,
      )
      .get(source.sourcePath) as SessionRow;
  }

  private getRuleSummary(sessionId: number): SummaryRow | undefined {
    return this.db
      .prepare(
        `SELECT id, state_summary, key_files
         FROM summaries
         WHERE session_id = ? AND model = 'rules-extraction'
         ORDER BY id DESC LIMIT 1`,
      )
      .get(sessionId) as SummaryRow | undefined;
  }

  private getSessionUsage(sessionId: number): SessionUsageRow | undefined {
    return this.db
      .prepare(
        `SELECT session_id, provider, model, input_tokens, base_input_tokens,
                cache_read_input_tokens, cache_creation_input_tokens,
                output_tokens, reasoning_output_tokens, provider_total_tokens,
                total_tokens, observed_at, coverage,
                covered_from_offset, covered_to_offset
         FROM session_usage
         WHERE session_id = ?`,
      )
      .get(sessionId) as SessionUsageRow | undefined;
  }

  private async prepareUsageBackfill(
    adapter: SessionAdapter,
    source: DiscoveredSessionSource,
    scanOffset: number,
    budget: UsageBackfillBudget,
    metrics: ScannerMetrics,
    options: ScanOptions,
  ): Promise<PreparedUsageBackfill> {
    if (source.tool === "claude-code") {
      if (source.sourceSizeBytes > CLAUDE_USAGE_BACKFILL_FILE_LIMIT) {
        metrics.usageBackfillDeferred += 1;
        return { result: null, partialBaseline: true };
      }
    }
    if (!adapter.backfillUsage) {
      metrics.usageBackfillDeferred += 1;
      return { result: null, partialBaseline: true };
    }

    const estimatedBytes =
      source.tool === "codex"
        ? Math.min(
            source.sourceSizeBytes,
            CODEX_USAGE_BACKFILL_TAIL_LIMIT,
          )
        : source.sourceSizeBytes;
    if (estimatedBytes > budget.remainingBytes) {
      metrics.usageBackfillDeferred += 1;
      return { result: null, partialBaseline: false };
    }

    budget.remainingBytes -= estimatedBytes;
    metrics.usageBackfillFiles += 1;
    const result = await adapter.backfillUsage(source, options);
    const actualBytes = Math.min(result.bytesRead, estimatedBytes);
    metrics.usageBackfillBytes += actualBytes;
    budget.remainingBytes += estimatedBytes - actualBytes;
    if (!result.ok) {
      this.logger.warn(
        {
          event: "usage_backfill_failed",
          tool: source.tool,
          sourcePath: source.sourcePath,
          scanOffset,
          reason: result.error,
        },
        "Usage-only backfill failed; retaining partial coverage",
      );
      return { result: null, partialBaseline: true };
    }
    return { result, partialBaseline: false };
  }

  private clearSessionUsage(sessionId: number): void {
    this.db
      .prepare("DELETE FROM session_usage_events WHERE session_id = ?")
      .run(sessionId);
    this.db
      .prepare("DELETE FROM session_usage WHERE session_id = ?")
      .run(sessionId);
  }

  private persistSessionUsage(input: {
    sessionId: number;
    provider: ToolName;
    previous: SessionUsageRow | undefined;
    incremental: UsageExtraction;
    backfill: PreparedUsageBackfill;
    scanOffset: number;
    nextOffset: number;
    sourceSize: number;
  }): void {
    const backfillExtraction = input.backfill.result?.extraction;
    const hasEvidence =
      input.previous !== undefined ||
      usageExtractionHasEvidence(input.incremental) ||
      (backfillExtraction !== undefined &&
        usageExtractionHasEvidence(backfillExtraction)) ||
      input.backfill.partialBaseline;
    if (!hasEvidence) return;

    if (input.provider === "claude-code") {
      for (const event of backfillExtraction?.usageEvents ?? []) {
        this.upsertUsageEvent(input.sessionId, event);
      }
      for (const event of input.incremental.usageEvents) {
        this.upsertUsageEvent(input.sessionId, event);
      }
    }

    const complete =
      input.previous?.coverage === "complete" ||
      (input.scanOffset === 0 && input.nextOffset >= input.sourceSize) ||
      (input.provider === "claude-code"
        ? input.backfill.result?.coveredFromOffset === 0 &&
          input.backfill.result.coveredToOffset >= input.sourceSize
        : backfillExtraction?.cumulativeUsage !== null &&
            backfillExtraction?.cumulativeUsage !== undefined) ||
      (input.provider === "codex" &&
        input.incremental.cumulativeUsage !== null);
    const coverage = complete ? "complete" : "partial";
    const coveredFromOffset = complete
      ? 0
      : Math.min(
          input.previous?.covered_from_offset ?? Number.MAX_SAFE_INTEGER,
          input.backfill.result?.coveredFromOffset ??
            Number.MAX_SAFE_INTEGER,
          input.backfill.partialBaseline || usageExtractionHasEvidence(input.incremental)
            ? input.scanOffset
            : Number.MAX_SAFE_INTEGER,
        );
    const resolvedCoveredFrom =
      coveredFromOffset === Number.MAX_SAFE_INTEGER
        ? input.scanOffset
        : coveredFromOffset;
    const coveredToOffset = Math.max(
      resolvedCoveredFrom,
      input.previous?.covered_to_offset ?? 0,
      input.backfill.result?.coveredToOffset ?? 0,
      input.nextOffset,
    );
    const model =
      input.incremental.model ??
      backfillExtraction?.model ??
      input.previous?.model ??
      null;
    const usage =
      input.provider === "claude-code"
        ? this.aggregateClaudeUsage(input.sessionId)
        : selectCodexUsage(
            input.previous,
            backfillExtraction?.cumulativeUsage ?? null,
            input.incremental.cumulativeUsage,
          );

    this.upsertSessionUsageRow({
      sessionId: input.sessionId,
      provider: input.provider,
      model,
      usage,
      coverage,
      coveredFromOffset: resolvedCoveredFrom,
      coveredToOffset,
    });
  }

  private upsertUsageEvent(
    sessionId: number,
    event: TokenUsageEvent,
  ): void {
    this.db
      .prepare(
        `INSERT INTO session_usage_events (
           session_id, provider_message_id, model,
           input_tokens, base_input_tokens,
           cache_read_input_tokens, cache_creation_input_tokens,
           output_tokens, reasoning_output_tokens,
           provider_total_tokens, total_tokens, observed_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(session_id, provider_message_id) DO UPDATE SET
           model = COALESCE(excluded.model, session_usage_events.model),
           input_tokens = COALESCE(excluded.input_tokens, session_usage_events.input_tokens),
           base_input_tokens = COALESCE(excluded.base_input_tokens, session_usage_events.base_input_tokens),
           cache_read_input_tokens = COALESCE(excluded.cache_read_input_tokens, session_usage_events.cache_read_input_tokens),
           cache_creation_input_tokens = COALESCE(excluded.cache_creation_input_tokens, session_usage_events.cache_creation_input_tokens),
           output_tokens = COALESCE(excluded.output_tokens, session_usage_events.output_tokens),
           reasoning_output_tokens = COALESCE(excluded.reasoning_output_tokens, session_usage_events.reasoning_output_tokens),
           provider_total_tokens = COALESCE(excluded.provider_total_tokens, session_usage_events.provider_total_tokens),
           total_tokens = COALESCE(excluded.total_tokens, session_usage_events.total_tokens),
           observed_at = COALESCE(excluded.observed_at, session_usage_events.observed_at)`,
      )
      .run(
        sessionId,
        event.providerMessageId,
        event.model,
        ...usageValues(event),
      );
  }

  private aggregateClaudeUsage(sessionId: number): TokenUsage {
    const row = this.db
      .prepare(
        `SELECT
           COUNT(*) AS event_count,
           CASE WHEN COUNT(*) = COUNT(input_tokens) THEN SUM(input_tokens) END AS input_tokens,
           CASE WHEN COUNT(*) = COUNT(base_input_tokens) THEN SUM(base_input_tokens) END AS base_input_tokens,
           CASE WHEN COUNT(*) = COUNT(cache_read_input_tokens) THEN SUM(cache_read_input_tokens) END AS cache_read_input_tokens,
           CASE WHEN COUNT(*) = COUNT(cache_creation_input_tokens) THEN SUM(cache_creation_input_tokens) END AS cache_creation_input_tokens,
           CASE WHEN COUNT(*) = COUNT(output_tokens) THEN SUM(output_tokens) END AS output_tokens,
           CASE WHEN COUNT(*) = COUNT(reasoning_output_tokens) THEN SUM(reasoning_output_tokens) END AS reasoning_output_tokens,
           CASE WHEN COUNT(*) = COUNT(provider_total_tokens) THEN SUM(provider_total_tokens) END AS provider_total_tokens,
           CASE WHEN COUNT(*) = COUNT(total_tokens) THEN SUM(total_tokens) END AS total_tokens,
           MAX(observed_at) AS observed_at
         FROM session_usage_events
         WHERE session_id = ?`,
      )
      .get(sessionId) as {
      event_count: number;
      input_tokens: number | null;
      base_input_tokens: number | null;
      cache_read_input_tokens: number | null;
      cache_creation_input_tokens: number | null;
      output_tokens: number | null;
      reasoning_output_tokens: number | null;
      provider_total_tokens: number | null;
      total_tokens: number | null;
      observed_at: string | null;
    };
    if (row.event_count === 0) return emptyTokenUsage();
    return tokenUsageFromRow(row);
  }

  private upsertSessionUsageRow(input: {
    sessionId: number;
    provider: ToolName;
    model: string | null;
    usage: TokenUsage;
    coverage: "complete" | "partial";
    coveredFromOffset: number;
    coveredToOffset: number;
  }): void {
    this.db
      .prepare(
        `INSERT INTO session_usage (
           session_id, provider, model,
           input_tokens, base_input_tokens,
           cache_read_input_tokens, cache_creation_input_tokens,
           output_tokens, reasoning_output_tokens,
           provider_total_tokens, total_tokens, observed_at,
           coverage, covered_from_offset, covered_to_offset
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(session_id) DO UPDATE SET
           provider = excluded.provider,
           model = excluded.model,
           input_tokens = excluded.input_tokens,
           base_input_tokens = excluded.base_input_tokens,
           cache_read_input_tokens = excluded.cache_read_input_tokens,
           cache_creation_input_tokens = excluded.cache_creation_input_tokens,
           output_tokens = excluded.output_tokens,
           reasoning_output_tokens = excluded.reasoning_output_tokens,
           provider_total_tokens = excluded.provider_total_tokens,
           total_tokens = excluded.total_tokens,
           observed_at = excluded.observed_at,
           coverage = excluded.coverage,
           covered_from_offset = excluded.covered_from_offset,
           covered_to_offset = excluded.covered_to_offset`,
      )
      .run(
        input.sessionId,
        input.provider,
        input.model,
        ...usageValues(input.usage),
        input.coverage,
        input.coveredFromOffset,
        input.coveredToOffset,
      );
  }

  private upsertRuleSummary(
    summaryId: number | null,
    sessionId: number,
    projectId: number,
    generatedAt: string | null,
    merged: { summary: StoredRuleSummary; touchedFiles: string[] },
  ): void {
    const values = [
      generatedAt ?? new Date().toISOString(),
      JSON.stringify(merged.summary),
      JSON.stringify([]),
      JSON.stringify([]),
      JSON.stringify([]),
      JSON.stringify(merged.touchedFiles),
      sessionId,
      projectId,
    ];

    if (summaryId === null) {
      this.db
        .prepare(
          `INSERT INTO summaries (
             generated_at, model, state_summary,
             open_items, next_steps, decisions, key_files,
             blocked, blocked_reason, acknowledged,
             session_id, project_id
           ) VALUES (?, 'rules-extraction', ?, ?, ?, ?, ?, 0, NULL, 0, ?, ?)`,
        )
        .run(...values);
      return;
    }

    this.db
      .prepare(
        `UPDATE summaries SET
           generated_at = ?,
           state_summary = ?,
           open_items = ?,
           next_steps = ?,
           decisions = ?,
           key_files = ?,
           session_id = ?,
           project_id = ?
         WHERE id = ?`,
      )
      .run(...values, summaryId);
  }
}

function usageExtractionHasEvidence(
  extraction: UsageExtraction,
): boolean {
  return (
    extraction.model !== null ||
    extraction.cumulativeUsage !== null ||
    extraction.usageEvents.length > 0
  );
}

function boundedBackfillBudget(requested: number | undefined): number {
  return requested !== undefined &&
    Number.isSafeInteger(requested) &&
    requested >= 0
    ? Math.min(requested, USAGE_BACKFILL_SCAN_BUDGET)
    : USAGE_BACKFILL_SCAN_BUDGET;
}

function selectCodexUsage(
  previous: SessionUsageRow | undefined,
  backfill: TokenUsage | null,
  incremental: TokenUsage | null,
): TokenUsage {
  let selected =
    previous?.provider === "codex"
      ? tokenUsageFromRow(previous)
      : null;
  if (backfill !== null) {
    selected = preferCumulativeUsage(selected, backfill);
  }
  if (incremental !== null) {
    selected = preferCumulativeUsage(selected, incremental);
  }
  return selected ?? emptyTokenUsage();
}

function tokenUsageFromRow(row: {
  input_tokens: number | null;
  base_input_tokens: number | null;
  cache_read_input_tokens: number | null;
  cache_creation_input_tokens: number | null;
  output_tokens: number | null;
  reasoning_output_tokens: number | null;
  provider_total_tokens: number | null;
  total_tokens: number | null;
  observed_at: string | null;
}): TokenUsage {
  return {
    inputTokens: safeStoredToken(row.input_tokens),
    baseInputTokens: safeStoredToken(row.base_input_tokens),
    cacheReadInputTokens: safeStoredToken(row.cache_read_input_tokens),
    cacheCreationInputTokens: safeStoredToken(
      row.cache_creation_input_tokens,
    ),
    outputTokens: safeStoredToken(row.output_tokens),
    reasoningOutputTokens: safeStoredToken(row.reasoning_output_tokens),
    providerTotalTokens: safeStoredToken(row.provider_total_tokens),
    totalTokens: safeStoredToken(row.total_tokens),
    observedAt: row.observed_at,
  };
}

function emptyTokenUsage(): TokenUsage {
  return {
    inputTokens: null,
    baseInputTokens: null,
    cacheReadInputTokens: null,
    cacheCreationInputTokens: null,
    outputTokens: null,
    reasoningOutputTokens: null,
    providerTotalTokens: null,
    totalTokens: null,
    observedAt: null,
  };
}

function safeStoredToken(value: number | null): number | null {
  return value !== null &&
    Number.isSafeInteger(value) &&
    value >= 0
    ? value
    : null;
}

function usageValues(usage: TokenUsage): Array<number | string | null> {
  return [
    usage.inputTokens,
    usage.baseInputTokens,
    usage.cacheReadInputTokens,
    usage.cacheCreationInputTokens,
    usage.outputTokens,
    usage.reasoningOutputTokens,
    usage.providerTotalTokens,
    usage.totalTokens,
    usage.observedAt,
  ];
}

function isMoreRecentSource(
  candidate: DiscoveredSessionSource,
  current: DiscoveredSessionSource,
): boolean {
  if (candidate.mtimeMs !== current.mtimeMs) {
    return candidate.mtimeMs > current.mtimeMs;
  }
  return candidate.sourcePath.localeCompare(current.sourcePath) > 0;
}

function mergeExtraction(
  existing: SummaryRow | undefined,
  incremental: RuleExtraction,
  git: GitSnapshot | null,
): { summary: StoredRuleSummary; touchedFiles: string[] } {
  const previous = decodeStoredSummary(existing?.state_summary);
  const previousFiles = decodeStringArray(existing?.key_files);
  const messages = [
    ...(previous?.messages ?? []),
    ...incremental.messages,
  ]
    .filter(isConversationMessage)
    .slice(-MESSAGE_LIMIT);
  const touchedFiles = [
    ...new Set([...previousFiles, ...incremental.touchedFiles]),
  ].sort();

  return {
    summary: {
      version: 1,
      digest: buildDigest(messages),
      messages,
      git,
    },
    touchedFiles,
  };
}

export function buildDigest(messages: ExtractedMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "assistant") continue;
    const outcome = stripMemoryCitationTransport(message.text);
    if (outcome) return outcome;
  }

  return "No assistant outcome was captured for this session.";
}

function stripMemoryCitationTransport(value: string): string {
  return value
    .replace(
      /<oai-mem-citation(?:\s[^>]*)?>[\s\S]*?<\/oai-mem-citation\s*>/gi,
      "",
    )
    .replace(/<oai-mem-citation(?:\s[^>]*)?>[\s\S]*$/gi, "")
    .trim();
}

function isConversationMessage(value: unknown): value is ExtractedMessage {
  if (typeof value !== "object" || value === null) return false;
  if (!("role" in value) || !("text" in value) || !("timestamp" in value)) {
    return false;
  }
  return (
    (value.role === "user" || value.role === "assistant") &&
    typeof value.text === "string" &&
    (value.timestamp === null || typeof value.timestamp === "string")
  );
}

function decodeStoredSummary(value: string | null | undefined): StoredRuleSummary | null {
  if (!value) return null;
  try {
    const decoded: unknown = JSON.parse(value);
    if (
      typeof decoded === "object" &&
      decoded !== null &&
      "version" in decoded &&
      decoded.version === 1 &&
      "messages" in decoded &&
      Array.isArray(decoded.messages)
    ) {
      return decoded as StoredRuleSummary;
    }
  } catch {
    return null;
  }
  return null;
}

function decodeStringArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const decoded: unknown = JSON.parse(value);
    return Array.isArray(decoded)
      ? decoded.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function earliest(
  left: string | null,
  right: string | null,
): string | null {
  if (!left) return right;
  if (!right) return left;
  return left < right ? left : right;
}

function latest(left: string | null, right: string | null): string | null {
  if (!left) return right;
  if (!right) return left;
  return left > right ? left : right;
}

function throwIfScanAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortReason(signal);
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("The scan was aborted", "AbortError");
}
