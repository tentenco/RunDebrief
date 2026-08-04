import fs from "node:fs/promises";
import type { MemoryWriter } from "./mem0.js";
import type { GatewaySummarizer, SummaryInput } from "./summarizer.js";
import type {
  Clock,
  DaemonLogger,
  DebriefDatabase,
  LiveStatusProvider,
} from "./types.js";
import { systemClock } from "./types.js";

export const SESSION_QUIET_MS = 10 * 60 * 1_000;

interface SessionContext extends SummaryInput {
  sessionId: number;
  projectId: number;
  brainLinked: boolean;
}

interface FinalSummaryRow {
  id: number;
  generated_at: string | null;
}

type PersistResult = "inserted" | "updated" | "covered";

export type ProcessResult =
  | "not-quiet"
  | "not-scanned"
  | "live"
  | "already-summarized"
  | "summarized"
  | "degraded";

export class SessionEndProcessor {
  private readonly observedAt = new Map<string, number>();
  private readonly inFlight = new Set<number>();
  private readonly unavailableBackfillSources = new Set<string>();

  constructor(
    private readonly db: DebriefDatabase,
    private readonly liveStatus: LiveStatusProvider,
    private readonly summarizer: GatewaySummarizer,
    private readonly memories: MemoryWriter,
    private readonly logger: DaemonLogger,
    private readonly clock: Clock = systemClock,
    private readonly quietMs = SESSION_QUIET_MS,
  ) {}

  observe(sourcePath: string, timestamp = this.clock.now()): void {
    this.unavailableBackfillSources.delete(sourcePath);
    this.observedAt.set(sourcePath, timestamp.getTime());
  }

  forget(sourcePath: string): void {
    this.observedAt.delete(sourcePath);
  }

  async seedLatestUnsummarized(limit = 10): Promise<number> {
    if (!Number.isInteger(limit) || limit < 1) return 0;
    const candidates = this.db
      .prepare(
        `WITH ranked AS (
           SELECT
             sessions.id,
             sessions.source_path,
             sessions.project_id,
             ROW_NUMBER() OVER (
               PARTITION BY sessions.project_id
               ORDER BY
                 COALESCE(sessions.ended_at, sessions.started_at, '') DESC,
                 sessions.id DESC
             ) AS project_rank
           FROM sessions
         )
         SELECT ranked.source_path
         FROM ranked
         WHERE ranked.project_rank = 1
           AND NOT EXISTS (
             SELECT 1
             FROM summaries
             WHERE summaries.session_id = ranked.id
               AND summaries.model <> 'rules-extraction'
           )
         ORDER BY ranked.id DESC`,
      )
      .all() as Array<{ source_path: string }>;

    let seeded = 0;
    for (const candidate of candidates) {
      if (seeded >= limit) break;
      if (this.observedAt.has(candidate.source_path)) continue;
      if (this.unavailableBackfillSources.has(candidate.source_path)) continue;
      try {
        const stat = await fs.stat(candidate.source_path);
        this.observe(candidate.source_path, stat.mtime);
        seeded += 1;
      } catch (error) {
        const suppressed = isMissingSource(error);
        if (suppressed) {
          this.unavailableBackfillSources.add(candidate.source_path);
        }
        this.logger.warn(
          {
            event: "backfill_candidate_stat_failed",
            sourcePath: candidate.source_path,
            reason: error instanceof Error ? error.message : String(error),
            suppressed,
          },
          suppressed
            ? "Suppressing missing historical session until it is observed again"
            : "Skipping unavailable historical session",
        );
      }
    }
    if (seeded > 0) {
      this.logger.info(
        {
          event: "initial_backfill_seeded",
          count: seeded,
          limit,
        },
        "Seeded bounded newest-per-project summary backfill",
      );
    }
    return seeded;
  }

  async process(sourcePath: string): Promise<ProcessResult> {
    const observed = this.observedAt.get(sourcePath);
    if (observed === undefined || this.clock.now().getTime() - observed < this.quietMs) {
      return "not-quiet";
    }

    const context = this.loadContext(sourcePath);
    if (!context) return "not-scanned";
    if (this.liveStatus.isProjectLive(context.projectId)) return "live";
    if (isCovered(this.latestFinalSummary(context.sessionId), observed)) {
      return "already-summarized";
    }
    if (this.inFlight.has(context.sessionId)) return "already-summarized";

    this.inFlight.add(context.sessionId);
    try {
      const result = await this.summarizer.summarize(context);
      const currentObserved = this.observedAt.get(sourcePath);
      const generatedAt =
        currentObserved !== undefined && currentObserved > observed
          ? new Date(observed).toISOString()
          : new Date(
              Math.max(observed, this.clock.now().getTime()),
            ).toISOString();
      const persisted = this.persistFinal(
        context,
        result,
        observed,
        generatedAt,
      );
      if (persisted === "covered") return "already-summarized";

      this.logger.info(
        {
          event: "session_summary_stored",
          sessionId: context.sessionId,
          projectId: context.projectId,
          model: result.model,
          degraded: result.degraded,
          action: persisted,
        },
        "Session summary stored",
      );

      if (context.brainLinked) {
        this.memories.writeOutcome({
          projectName: context.projectName,
          projectPath: context.projectPath,
          sessionId: context.sessionId,
          stateSummary: result.summary.state_summary,
        });
      }
      return result.degraded ? "degraded" : "summarized";
    } finally {
      this.inFlight.delete(context.sessionId);
    }
  }

  async processAllObserved(): Promise<Map<string, ProcessResult>> {
    const results = new Map<string, ProcessResult>();
    for (const [sourcePath, candidateObservedAt] of [
      ...this.observedAt.entries(),
    ]) {
      try {
        const result = await this.process(sourcePath);
        results.set(sourcePath, result);
        if (
          isTerminal(result) &&
          this.observedAt.get(sourcePath) === candidateObservedAt
        ) {
          this.observedAt.delete(sourcePath);
        }
      } catch (error) {
        this.logger.error(
          {
            event: "session_summary_failed",
            sourcePath,
            reason: error instanceof Error ? error.message : String(error),
          },
          "Session summary failed; daemon will continue",
        );
      }
    }
    return results;
  }

  private loadContext(sourcePath: string): SessionContext | null {
    const row = this.db
      .prepare(
        `SELECT
           sessions.id AS session_id,
           sessions.project_id,
           sessions.tool,
           sessions.started_at,
           sessions.ended_at,
           sessions.git_branch,
           projects.name AS project_name,
           projects.path AS project_path,
           projects.brain_linked,
           summaries.state_summary AS rule_state_summary,
           summaries.key_files
         FROM sessions
         JOIN projects ON projects.id = sessions.project_id
         JOIN summaries
           ON summaries.session_id = sessions.id
          AND summaries.model = 'rules-extraction'
         WHERE sessions.source_path = ?
         ORDER BY summaries.id DESC
         LIMIT 1`,
      )
      .get(sourcePath) as
      | {
          session_id: number;
          project_id: number;
          tool: "claude-code" | "codex";
          started_at: string | null;
          ended_at: string | null;
          git_branch: string | null;
          project_name: string;
          project_path: string;
          brain_linked: number | null;
          rule_state_summary: string;
          key_files: string | null;
        }
      | undefined;

    if (!row) return null;
    return {
      sessionId: row.session_id,
      projectId: row.project_id,
      projectName: row.project_name,
      projectPath: row.project_path,
      tool: row.tool,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      gitBranch: row.git_branch,
      brainLinked: row.brain_linked === 1,
      ruleStateSummary: row.rule_state_summary,
      keyFiles: decodeStringArray(row.key_files),
    };
  }

  private latestFinalSummary(sessionId: number): FinalSummaryRow | undefined {
    return this.db
      .prepare(
        `SELECT id, generated_at
         FROM summaries
         WHERE session_id = ? AND model <> 'rules-extraction'
         ORDER BY generated_at DESC, id DESC
         LIMIT 1`,
      )
      .get(sessionId) as FinalSummaryRow | undefined;
  }

  private persistFinal(
    context: SessionContext,
    result: Awaited<ReturnType<GatewaySummarizer["summarize"]>>,
    observedAt: number,
    generatedAt: string,
  ): PersistResult {
    const persist = this.db.transaction((): PersistResult => {
      const existing = this.latestFinalSummary(context.sessionId);
      if (isCovered(existing, observedAt)) return "covered";
      const summary = result.summary;
      const values = [
        context.projectId,
        generatedAt,
        result.model,
        summary.state_summary,
        JSON.stringify(summary.open_items),
        JSON.stringify(summary.next_steps),
        JSON.stringify(summary.decisions),
        JSON.stringify(summary.key_files),
        summary.blocked ? 1 : 0,
        summary.blocked_reason,
      ];
      if (existing) {
        this.db
          .prepare(
            `UPDATE summaries SET
               project_id = ?,
               generated_at = ?,
               model = ?,
               state_summary = ?,
               open_items = ?,
               next_steps = ?,
               decisions = ?,
               key_files = ?,
               blocked = ?,
               blocked_reason = ?,
               acknowledged = 0
             WHERE id = ?`,
          )
          .run(...values, existing.id);
        return "updated";
      }
      this.db
        .prepare(
          `INSERT INTO summaries (
             project_id, generated_at, model, state_summary,
             open_items, next_steps, decisions, key_files,
             blocked, blocked_reason, acknowledged, session_id
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
        )
        .run(...values, context.sessionId);
      return "inserted";
    });
    return persist();
  }
}

function isCovered(
  finalSummary: FinalSummaryRow | undefined,
  observedAt: number,
): boolean {
  if (!finalSummary?.generated_at) return false;
  const generatedAt = Date.parse(finalSummary.generated_at);
  return Number.isFinite(generatedAt) && generatedAt >= observedAt;
}

function isTerminal(result: ProcessResult): boolean {
  return (
    result === "summarized" ||
    result === "degraded" ||
    result === "already-summarized"
  );
}

function decodeStringArray(value: string | null): string[] {
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

function isMissingSource(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR")
  );
}
