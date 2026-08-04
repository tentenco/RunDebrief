import type {
  DashboardRepository,
  DashboardSnapshot,
  Project,
  ProjectDetail,
  ProjectPatch,
  RuntimeStatus,
  SessionUsage,
  SessionTurnLogPage,
} from "../types";

export const TEST_NOW = new Date("2026-07-29T12:00:00.000Z");

function testTimestamp(offsetMs = 0): string {
  return new Date(TEST_NOW.getTime() + offsetMs).toISOString();
}

export function usageFixture(
  overrides: Partial<SessionUsage> = {},
): SessionUsage {
  return {
    provider: "codex",
    model: "gpt-5.6-sol",
    inputTokens: 1_000,
    baseInputTokens: null,
    cacheReadInputTokens: 400,
    cacheCreationInputTokens: 0,
    outputTokens: 200,
    reasoningOutputTokens: 50,
    providerTotalTokens: 1_200,
    totalTokens: 1_200,
    observedAt: testTimestamp(),
    coverage: "complete",
    coveredFromOffset: 0,
    coveredToOffset: 1_024,
    ...overrides,
  };
}

export function projectFixture(overrides: Partial<Project> = {}): Project {
  return {
    id: 1,
    path: "/Users/demo/Projects/debrief",
    name: "debrief",
    client: null,
    pinned: false,
    hidden: false,
    brainLinked: false,
    lastActivityAt: testTimestamp(),
    liveStatus: null,
    summaryState: "ready",
    latestSession: {
      id: 10,
      projectId: 1,
      tool: "codex",
      startedAt: testTimestamp(-2 * 60 * 60 * 1_000),
      endedAt: testTimestamp(),
      gitBranch: "phase-3/app-shell",
      usage: null,
      summary: {
        id: 20,
        sessionId: 10,
        generatedAt: testTimestamp(5 * 60 * 1_000),
        model: "deepseek-chat",
        stateSummary: "The app shell renders real project data.",
        openItems: ["Run G3"],
        nextSteps: ["Verify native actions"],
        decisions: ["Keep SQL reads read-only"],
        keyFiles: ["packages/app/src/App.tsx"],
        blocked: false,
        blockedReason: null,
        acknowledged: false,
      },
    },
    ...overrides,
  };
}

export function turnLogFixture(
  sessionId = 10,
  overrides: Partial<SessionTurnLogPage> = {},
): SessionTurnLogPage {
  return {
    sessionId,
    turns: [
      {
        ordinal: 1,
        timestamp: testTimestamp(-2 * 60 * 60 * 1_000),
        userPrompt: "請完成原始對話 fixture。",
        assistantResponse: "Fixture 已完成，並保留完整回覆。",
      },
    ],
    totalTurns: 1,
    hasEarlier: false,
    skippedLines: 0,
    limit: 20,
    ...overrides,
  };
}

export class FixtureRepository implements DashboardRepository {
  projects: Project[];
  acknowledged: number[] = [];
  patches: Array<{ projectId: number; patch: ProjectPatch }> = [];
  terminalProjects: number[] = [];
  editorProjects: number[] = [];
  snapshotLoads = 0;
  runtimeStatusLoads = 0;
  daemonInstalls = 0;
  privacySecurityOpens = 0;
  turnLogLoads: number[] = [];
  turnLogs = new Map<number, SessionTurnLogPage>();
  runtimeStatus: RuntimeStatus = {
    daemon: {
      label: "com.tenten.debrief-daemon",
      installed: true,
      running: true,
      pid: 5151,
      state: "running",
      runtimeVersion: "0.1.0",
    },
    config: {
      exists: true,
      gatewayConfigured: true,
      summaryModelConfigured: true,
    },
    applications: {
      visualStudioCode: true,
      warp: true,
      editor: {
        kind: "visual-studio-code",
        name: "Visual Studio Code",
        available: true,
      },
    },
    databaseExists: true,
  };

  constructor(projects = [projectFixture()]) {
    this.projects = projects;
  }

  async loadSnapshot(): Promise<DashboardSnapshot> {
    this.snapshotLoads += 1;
    return {
      projects: structuredClone(this.projects),
      loadedAt: testTimestamp(6 * 60 * 1_000),
    };
  }

  async loadProjectDetail(projectId: number): Promise<ProjectDetail> {
    const project = this.projects.find((candidate) => candidate.id === projectId);
    if (!project) throw new Error("Missing fixture project");
    return {
      project: structuredClone(project),
      sessions: project.latestSession
        ? [structuredClone(project.latestSession)]
        : [],
    };
  }

  async loadSessionTurnLog(sessionId: number): Promise<SessionTurnLogPage> {
    this.turnLogLoads.push(sessionId);
    return structuredClone(
      this.turnLogs.get(sessionId) ?? turnLogFixture(sessionId),
    );
  }

  async loadRuntimeStatus(): Promise<RuntimeStatus> {
    this.runtimeStatusLoads += 1;
    return structuredClone(this.runtimeStatus);
  }

  async installDaemon(): Promise<RuntimeStatus> {
    this.daemonInstalls += 1;
    this.runtimeStatus = {
      ...this.runtimeStatus,
      daemon: {
        ...this.runtimeStatus.daemon,
        installed: true,
        running: true,
        pid: 5151,
        state: "running",
      },
    };
    return structuredClone(this.runtimeStatus);
  }

  async openPrivacySecurity(): Promise<void> {
    this.privacySecurityOpens += 1;
  }

  async setAcknowledged(summaryId: number): Promise<void> {
    this.acknowledged.push(summaryId);
  }

  async updateProject(
    projectId: number,
    patch: ProjectPatch,
  ): Promise<void> {
    this.patches.push({ projectId, patch });
    this.projects = this.projects.map((project) =>
      project.id === projectId ? { ...project, ...patch } : project,
    );
  }

  async openTerminal(project: Project): Promise<void> {
    this.terminalProjects.push(project.id);
  }

  async openEditor(project: Project): Promise<void> {
    this.editorProjects.push(project.id);
  }

  async openVisualStudioCode(project: Project): Promise<void> {
    this.editorProjects.push(project.id);
  }

  async openWarp(project: Project): Promise<void> {
    this.terminalProjects.push(project.id);
  }

  async copyRecap(recap: string): Promise<void> {
    await navigator.clipboard.writeText(recap);
  }

  async reportFirstPaint(): Promise<null> {
    return null;
  }
}
