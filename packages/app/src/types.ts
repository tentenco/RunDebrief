export type AgentTool = "claude-code" | "codex";
export type UsageCoverage = "complete" | "partial";

export interface SessionUsage {
  provider: AgentTool;
  model: string | null;
  inputTokens: number | null;
  baseInputTokens: number | null;
  cacheReadInputTokens: number | null;
  cacheCreationInputTokens: number | null;
  outputTokens: number | null;
  reasoningOutputTokens: number | null;
  providerTotalTokens: number | null;
  totalTokens: number | null;
  observedAt: string | null;
  coverage: UsageCoverage;
  coveredFromOffset: number;
  coveredToOffset: number;
}

export interface Summary {
  id: number;
  sessionId: number;
  generatedAt: string | null;
  model: string;
  stateSummary: string;
  openItems: string[];
  nextSteps: string[];
  decisions: string[];
  keyFiles: string[];
  blocked: boolean;
  blockedReason: string | null;
  acknowledged: boolean;
}

export interface Session {
  id: number;
  projectId: number;
  tool: AgentTool;
  startedAt: string | null;
  endedAt: string | null;
  gitBranch: string | null;
  summary: Summary | null;
  usage: SessionUsage | null;
}

export interface LiveStatus {
  pid: number | null;
  tool: AgentTool | null;
  tmuxTarget: string | null;
  detectedAt: string | null;
}

export interface Project {
  id: number;
  path: string;
  name: string;
  client: string | null;
  pinned: boolean;
  hidden: boolean;
  brainLinked: boolean;
  lastActivityAt: string | null;
  latestSession: Session | null;
  liveStatus: LiveStatus | null;
  summaryState: SummaryState;
}

export type SummaryState = "ready" | "awaiting-summary" | "degraded";

export interface DashboardSnapshot {
  projects: Project[];
  loadedAt: string;
}

export interface ProjectDetail {
  project: Project;
  sessions: Session[];
}

export interface SessionTurn {
  ordinal: number;
  timestamp: string | null;
  userPrompt: string;
  assistantResponse: string | null;
}

export interface SessionTurnLogPage {
  sessionId: number;
  turns: SessionTurn[];
  totalTurns: number;
  hasEarlier: boolean;
  skippedLines: number;
  limit: number;
}

export interface SessionTurnLogState {
  status: "idle" | "loading" | "ready" | "error";
  page: SessionTurnLogPage | null;
  error: string | null;
}

export interface ProjectPatch {
  name?: string;
  client?: string | null;
  pinned?: boolean;
  hidden?: boolean;
}

export interface DashboardRepository {
  loadSnapshot(): Promise<DashboardSnapshot>;
  loadProjectDetail(projectId: number): Promise<ProjectDetail>;
  loadSessionTurnLog(
    sessionId: number,
    limit?: number,
  ): Promise<SessionTurnLogPage>;
  loadRuntimeStatus(): Promise<RuntimeStatus>;
  installDaemon(): Promise<RuntimeStatus>;
  openPrivacySecurity(): Promise<void>;
  setAcknowledged(summaryId: number, acknowledged: boolean): Promise<void>;
  updateProject(projectId: number, patch: ProjectPatch): Promise<void>;
  openTerminal(project: Project): Promise<void>;
  openEditor(project: Project): Promise<void>;
  openVisualStudioCode(project: Project): Promise<void>;
  openWarp(project: Project): Promise<void>;
  copyRecap(recap: string): Promise<void>;
  reportFirstPaint(): Promise<number | null>;
}

export type EditorApplicationKind =
  | "visual-studio-code"
  | "cursor"
  | "zed";

export interface ApplicationCapabilities {
  visualStudioCode: boolean;
  warp: boolean;
  editor: {
    kind: EditorApplicationKind;
    name: string;
    available: boolean;
  } | null;
}

export interface RuntimeStatus {
  daemon: {
    label: "com.tenten.debrief-daemon";
    installed: boolean;
    running: boolean;
    pid: number | null;
    state: string | null;
    runtimeVersion: string | null;
  };
  config: {
    exists: boolean;
    gatewayConfigured: boolean;
    summaryModelConfigured: boolean;
  };
  applications: ApplicationCapabilities;
  databaseExists: boolean;
}

export type ProjectStatus = "attention" | "running" | "idle" | "stale";
export type SidebarSelection =
  | { kind: "all" }
  | { kind: "attention" }
  | { kind: "running" }
  | { kind: "recent" }
  | { kind: "pinned" }
  | { kind: "client"; value: string }
  | { kind: "internal" }
  | { kind: "hidden" }
  | { kind: "sources" }
  | { kind: "settings" };
