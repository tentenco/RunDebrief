import { invoke } from "@tauri-apps/api/core";
import Database from "@tauri-apps/plugin-sql";
import i18n from "../i18n";
import type {
  AgentTool,
  DashboardRepository,
  DashboardSnapshot,
  LiveStatus,
  Project,
  ProjectDetail,
  ProjectPatch,
  Session,
  SessionUsage,
  SessionTurnLogPage,
  Summary,
  RuntimeStatus,
} from "../types";
import { classifySummaryState } from "./summary-state";

interface ProjectRow {
  id: number;
  path: string;
  name: string;
  client: string | null;
  pinned: number | null;
  hidden: number | null;
  brain_linked: number | null;
  last_activity_at: string | null;
}

export interface SessionRow {
  id: number;
  project_id: number;
  tool: AgentTool;
  started_at: string | null;
  ended_at: string | null;
  git_branch: string | null;
  usage_session_id?: number | null;
  usage_provider?: AgentTool | null;
  usage_model?: string | null;
  usage_input_tokens?: number | null;
  usage_base_input_tokens?: number | null;
  usage_cache_read_input_tokens?: number | null;
  usage_cache_creation_input_tokens?: number | null;
  usage_output_tokens?: number | null;
  usage_reasoning_output_tokens?: number | null;
  usage_provider_total_tokens?: number | null;
  usage_total_tokens?: number | null;
  usage_observed_at?: string | null;
  usage_coverage?: "complete" | "partial" | null;
  usage_covered_from_offset?: number | null;
  usage_covered_to_offset?: number | null;
}

interface SummaryRow {
  id: number;
  session_id: number;
  project_id: number;
  generated_at: string | null;
  model: string;
  state_summary: string | null;
  open_items: string | null;
  next_steps: string | null;
  decisions: string | null;
  key_files: string | null;
  blocked: number | null;
  blocked_reason: string | null;
  acknowledged: number | null;
}

interface LiveRow {
  project_id: number;
  pid: number | null;
  tool: AgentTool | null;
  tmux_target: string | null;
  detected_at: string | null;
}

interface MaterializedDashboard {
  projects: Project[];
  sessionsByProject: Map<number, Session[]>;
}

interface SessionRowReader {
  select<T>(query: string): Promise<T>;
}

let databasePromise: Promise<Database> | null = null;
let startupDiagnosticsClaimed = false;

async function database(): Promise<Database> {
  if (!databasePromise) {
    databasePromise = (async () => {
      const databaseUrl = await invoke<string>("get_database_url");
      const instance = await Database.load(databaseUrl);
      await reportCheckpoint("database-loaded");
      return instance;
    })();
  }
  return databasePromise;
}

async function materialize(): Promise<MaterializedDashboard> {
  const db = await database();
  const reportStartup = !startupDiagnosticsClaimed;
  startupDiagnosticsClaimed = true;
  const projectRows = await db.select<ProjectRow[]>(
    `SELECT id, path, name, client, pinned, hidden, brain_linked,
            last_activity_at
       FROM projects`,
  );
  if (reportStartup) await reportCheckpoint("projects-loaded");
  const sessionRows = await loadSessionRows(db);
  if (reportStartup) await reportCheckpoint("sessions-loaded");
  const summaryRows = await db.select<SummaryRow[]>(
    `SELECT id, session_id, project_id, generated_at, model, state_summary,
            open_items, next_steps, decisions, key_files, blocked,
            blocked_reason, acknowledged
       FROM summaries
      WHERE model <> 'rules-extraction'`,
  );
  if (reportStartup) await reportCheckpoint("summaries-loaded");
  const liveRows = await db.select<LiveRow[]>(
    `SELECT project_id, pid, tool, tmux_target, detected_at
       FROM live_status`,
  );
  if (reportStartup) await reportCheckpoint("live-status-loaded");

  const latestSummaryBySession = new Map<number, Summary>();
  for (const row of summaryRows) {
    const summary = toSummary(row);
    const existing = latestSummaryBySession.get(summary.sessionId);
    if (!existing || compareDates(summary.generatedAt, existing.generatedAt) > 0) {
      latestSummaryBySession.set(summary.sessionId, summary);
    }
  }

  const sessionsByProject = new Map<number, Session[]>();
  for (const row of sessionRows) {
    const session: Session = {
      id: row.id,
      projectId: row.project_id,
      tool: row.tool,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      gitBranch: row.git_branch,
      summary: latestSummaryBySession.get(row.id) ?? null,
      usage: mapSessionUsage(row),
    };
    const sessions = sessionsByProject.get(row.project_id) ?? [];
    sessions.push(session);
    sessionsByProject.set(row.project_id, sessions);
  }
  for (const sessions of sessionsByProject.values()) {
    sessions.sort((a, b) => sessionTime(b) - sessionTime(a));
  }

  const liveByProject = new Map<number, LiveStatus>();
  for (const row of liveRows) {
    liveByProject.set(row.project_id, {
      pid: row.pid,
      tool: row.tool,
      tmuxTarget: row.tmux_target,
      detectedAt: row.detected_at,
    });
  }

  const projects = projectRows.map((row): Project => {
    const latestSession = sessionsByProject.get(row.id)?.[0] ?? null;
    return {
      id: row.id,
      path: row.path,
      name: row.name,
      client: row.client,
      pinned: row.pinned === 1,
      hidden: row.hidden === 1,
      brainLinked: row.brain_linked === 1,
      lastActivityAt: row.last_activity_at,
      latestSession,
      liveStatus: liveByProject.get(row.id) ?? null,
      summaryState: classifySummaryState(latestSession?.summary ?? null),
    };
  });

  if (reportStartup) await reportCheckpoint("data-loaded");
  return { projects, sessionsByProject };
}

export async function loadSessionRows(
  db: SessionRowReader,
): Promise<SessionRow[]> {
  try {
    return await db.select<SessionRow[]>(
      `SELECT s.id, s.project_id, s.tool, s.started_at, s.ended_at,
              s.git_branch,
              u.session_id AS usage_session_id,
              u.provider AS usage_provider,
              u.model AS usage_model,
              u.input_tokens AS usage_input_tokens,
              u.base_input_tokens AS usage_base_input_tokens,
              u.cache_read_input_tokens AS usage_cache_read_input_tokens,
              u.cache_creation_input_tokens AS usage_cache_creation_input_tokens,
              u.output_tokens AS usage_output_tokens,
              u.reasoning_output_tokens AS usage_reasoning_output_tokens,
              u.provider_total_tokens AS usage_provider_total_tokens,
              u.total_tokens AS usage_total_tokens,
              u.observed_at AS usage_observed_at,
              u.coverage AS usage_coverage,
              u.covered_from_offset AS usage_covered_from_offset,
              u.covered_to_offset AS usage_covered_to_offset
         FROM sessions s
         LEFT JOIN session_usage u ON u.session_id = s.id`,
    );
  } catch (error) {
    if (!isMissingSessionUsageTable(error)) throw error;
    return db.select<SessionRow[]>(
      `SELECT id, project_id, tool, started_at, ended_at, git_branch
         FROM sessions`,
    );
  }
}

export function isMissingSessionUsageTable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const missingTableToken = /\bno such table:\s*([^\s;,]+)/iu.exec(
    message,
  )?.[1];
  if (!missingTableToken) return false;

  const segments = missingTableToken.split(".");
  if (segments.length > 2) return false;
  const tableIdentifier = segments.at(-1);
  if (!tableIdentifier) return false;

  return (
    unquoteSqliteIdentifier(tableIdentifier).toLocaleLowerCase() ===
    "session_usage"
  );
}

function unquoteSqliteIdentifier(identifier: string): string {
  const closingByOpening: Readonly<Record<string, string>> = {
    '"': '"',
    "'": "'",
    "`": "`",
    "[": "]",
  };
  const closing = closingByOpening[identifier[0] ?? ""];
  if (!closing) return identifier;
  return identifier.endsWith(closing)
    ? identifier.slice(1, -1)
    : identifier;
}

export function mapSessionUsage(row: SessionRow): SessionUsage | null {
  if (
    row.usage_session_id == null ||
    row.usage_provider == null ||
    row.usage_coverage == null ||
    row.usage_covered_from_offset == null ||
    row.usage_covered_to_offset == null
  ) {
    return null;
  }
  return {
    provider: row.usage_provider,
    model: row.usage_model ?? null,
    inputTokens: row.usage_input_tokens ?? null,
    baseInputTokens: row.usage_base_input_tokens ?? null,
    cacheReadInputTokens: row.usage_cache_read_input_tokens ?? null,
    cacheCreationInputTokens:
      row.usage_cache_creation_input_tokens ?? null,
    outputTokens: row.usage_output_tokens ?? null,
    reasoningOutputTokens: row.usage_reasoning_output_tokens ?? null,
    providerTotalTokens: row.usage_provider_total_tokens ?? null,
    totalTokens: row.usage_total_tokens ?? null,
    observedAt: row.usage_observed_at ?? null,
    coverage: row.usage_coverage,
    coveredFromOffset: row.usage_covered_from_offset,
    coveredToOffset: row.usage_covered_to_offset,
  };
}

async function reportCheckpoint(name: string): Promise<void> {
  await invoke("report_frontend_event", { name });
}

export class SqliteRepository implements DashboardRepository {
  async loadSnapshot(): Promise<DashboardSnapshot> {
    const { projects } = await materialize();
    return { projects, loadedAt: new Date().toISOString() };
  }

  async loadProjectDetail(projectId: number): Promise<ProjectDetail> {
    const { projects, sessionsByProject } = await materialize();
    const project = projects.find((candidate) => candidate.id === projectId);
    if (!project) throw new Error(i18n.t("errors.projectMissing"));
    return { project, sessions: sessionsByProject.get(projectId) ?? [] };
  }

  async loadSessionTurnLog(
    sessionId: number,
    limit = 20,
  ): Promise<SessionTurnLogPage> {
    return invoke<SessionTurnLogPage>("get_session_turn_log", {
      sessionId,
      limit,
    });
  }

  async loadRuntimeStatus(): Promise<RuntimeStatus> {
    return invoke<RuntimeStatus>("get_runtime_status");
  }

  async installDaemon(): Promise<RuntimeStatus> {
    return invoke<RuntimeStatus>("install_daemon");
  }

  async openPrivacySecurity(): Promise<void> {
    await invoke("open_privacy_security");
  }

  async setAcknowledged(
    summaryId: number,
    acknowledged: boolean,
  ): Promise<void> {
    await invoke("set_summary_acknowledged", { summaryId, acknowledged });
  }

  async updateProject(
    projectId: number,
    patch: ProjectPatch,
  ): Promise<void> {
    if (patch.pinned !== undefined) {
      await invoke("set_project_pinned", {
        projectId,
        pinned: patch.pinned,
      });
    }
    if (patch.hidden !== undefined) {
      await invoke("set_project_hidden", {
        projectId,
        hidden: patch.hidden,
      });
    }
    if (patch.client !== undefined) {
      await invoke("set_project_client", {
        projectId,
        client: patch.client,
      });
    }
    if (patch.name !== undefined) {
      await invoke("set_project_name", {
        projectId,
        name: patch.name,
      });
    }
  }

  async openTerminal(project: Project): Promise<void> {
    await invoke("open_in_terminal", {
      projectPath: project.path,
      tmuxTarget: project.liveStatus?.tmuxTarget ?? null,
    });
  }

  async openEditor(project: Project): Promise<void> {
    try {
      await invoke("open_in_editor", { projectPath: project.path });
    } catch {
      throw new Error(i18n.t("errors.editorOpenFailed"));
    }
  }

  async openVisualStudioCode(project: Project): Promise<void> {
    try {
      await invoke("open_in_visual_studio_code", {
        projectPath: project.path,
      });
    } catch {
      throw new Error(i18n.t("errors.visualStudioCodeOpenFailed"));
    }
  }

  async openWarp(project: Project): Promise<void> {
    try {
      await invoke("open_in_warp", { projectPath: project.path });
    } catch {
      throw new Error(i18n.t("errors.warpOpenFailed"));
    }
  }

  async copyRecap(recap: string): Promise<void> {
    await invoke("copy_recap", { recap });
  }

  async reportFirstPaint(): Promise<number> {
    return invoke<number>("report_first_paint");
  }
}

function toSummary(row: SummaryRow): Summary {
  return {
    id: row.id,
    sessionId: row.session_id,
    generatedAt: row.generated_at,
    model: row.model,
    stateSummary: row.state_summary ?? i18n.t("errors.summaryUnavailable"),
    openItems: decodeStringArray(row.open_items),
    nextSteps: decodeStringArray(row.next_steps),
    decisions: decodeStringArray(row.decisions),
    keyFiles: decodeStringArray(row.key_files),
    blocked: row.blocked === 1,
    blockedReason: row.blocked_reason,
    acknowledged: row.acknowledged === 1,
  };
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

function compareDates(a: string | null, b: string | null): number {
  return dateTime(a) - dateTime(b);
}

function sessionTime(session: Session): number {
  return dateTime(session.endedAt ?? session.startedAt);
}

function dateTime(value: string | null): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
