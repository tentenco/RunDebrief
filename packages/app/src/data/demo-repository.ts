import type {
  DashboardRepository,
  DashboardSnapshot,
  Project,
  ProjectDetail,
  ProjectPatch,
  RuntimeStatus,
  Session,
  SessionUsage,
  SessionTurnLogPage,
  Summary,
} from "../types";
import i18n, { currentLocale } from "../i18n";

function demoText(en: string, zhHant: string, zhHans: string): string {
  return {
    en,
    "zh-Hant": zhHant,
    "zh-CN": zhHans,
  }[currentLocale()];
}

const now = Date.now();
const hoursAgo = (hours: number) =>
  new Date(now - hours * 60 * 60 * 1_000).toISOString();

const summary = (
  id: number,
  sessionId: number,
  stateSummary: string,
  options: Partial<Summary> = {},
): Summary => ({
  id,
  sessionId,
  generatedAt: hoursAgo(1),
  model: "deepseek-chat",
  stateSummary,
  openItems: [
    demoText(
      "Verify the current gate evidence",
      "確認目前 gate evidence",
      "确认当前 gate 证据",
    ),
    demoText(
      "Define the next implementation scope",
      "整理下一步 implementation scope",
      "整理下一步实现范围",
    ),
  ],
  nextSteps: [
    demoText(
      "Complete the remaining verification and hand off to QA",
      "完成剩餘驗證並交付 QA",
      "完成其余验证并交付 QA",
    ),
  ],
  decisions: [
    demoText(
      "Keep the SQLite query surface read-only",
      "維持 read-only SQLite query surface",
      "保持 SQLite 查询接口只读",
    ),
  ],
  keyFiles: ["packages/app/src/App.tsx", "DESIGN.md"],
  blocked: false,
  blockedReason: null,
  acknowledged: false,
  ...options,
});

const session = (
  id: number,
  projectId: number,
  tool: "claude-code" | "codex",
  branch: string,
  endedAt: string,
  latestSummary: Summary | null,
  usage: SessionUsage | null = null,
): Session => ({
  id,
  projectId,
  tool,
  startedAt: hoursAgo(5),
  endedAt,
  gitBranch: branch,
  summary: latestSummary,
  usage,
});

const sessions = new Map<number, Session[]>([
  [
    1,
    [
      session(
        11,
        1,
        "codex",
        "phase-3/app-shell",
        hoursAgo(0.4),
        summary(
          101,
          11,
          demoText(
            "The App shell and data-reading contract are connected; card states and native actions are being completed.",
            "App shell 與資料讀取契約已接好，正在完成 card states 與 native actions。",
            "App shell 与数据读取协议已经接通，正在完善卡片状态与原生操作。",
          ),
        ),
      ),
    ],
  ],
  [
    2,
    [
      session(
        21,
        2,
        "claude-code",
        "feat/router",
        hoursAgo(2),
        summary(
          102,
          21,
          demoText(
            "The Watcher-to-router event bridge is complete; the classifier fallback is not connected yet.",
            "Watcher 到 router 的事件橋接完成，classifier fallback 尚未接上。",
            "Watcher 到 router 的事件桥接已完成，classifier fallback 尚未接入。",
          ),
          {
            blocked: true,
            blockedReason: demoText(
              "Waiting for API contract confirmation",
              "等待 API contract 確認",
              "等待确认 API 协议",
            ),
            openItems: [
              demoText(
                "Confirm the classifier response schema",
                "確認 classifier response schema",
                "确认 classifier 响应结构",
              ),
              demoText(
                "Complete the fallback integration",
                "補上 fallback integration",
                "补全 fallback 集成",
              ),
              demoText(
                "Rerun the event-order tests",
                "重跑事件順序測試",
                "重新运行事件顺序测试",
              ),
            ],
          },
        ),
      ),
    ],
  ],
  [
    3,
    [
      session(
        31,
        3,
        "codex",
        "main",
        hoursAgo(8),
        summary(
          103,
          31,
          demoText(
            "The proposal portal template integration and static preview are complete.",
            "Proposal portal 已完成模板整合與靜態預覽。",
            "Proposal portal 已完成模板集成与静态预览。",
          ),
        ),
      ),
    ],
  ],
  [
    4,
    [
      session(
        41,
        4,
        "claude-code",
        "chore/index",
        hoursAgo(96),
        summary(
          104,
          41,
          demoText(
            "The research catalog is synchronized and waiting for the next manual review batch.",
            "Research catalog 已同步，等待下一批人工審核。",
            "Research catalog 已同步，正在等待下一批人工审核。",
          ),
        ),
      ),
    ],
  ],
  [
    5,
    [session(51, 5, "codex", "feat/scanner", hoursAgo(0.2), null)],
  ],
  [
    6,
    [
      session(
        61,
        6,
        "claude-code",
        "fix/summary",
        hoursAgo(3),
        summary(106, 61, demoText(
          "The Gateway could not produce a structured summary, so the rules-based result was preserved.",
          "Gateway 無法產生結構化摘要，已保留規則式結果。",
          "Gateway 无法生成结构化摘要，已保留基于规则的结果。",
        ), {
          model: "rules-fallback",
          openItems: [
            demoText(
              "Check Gateway availability, then refresh",
              "檢查 gateway availability 後重新整理",
              "检查 Gateway 可用性后刷新",
            ),
          ],
        }),
      ),
    ],
  ],
]);

let projects: Project[] = [
  {
    id: 1,
    path: "/Users/demo/Projects/debrief",
    name: "debrief",
    client: null,
    pinned: true,
    hidden: false,
    brainLinked: false,
    lastActivityAt: hoursAgo(0.4),
    latestSession: sessions.get(1)?.[0] ?? null,
    liveStatus: {
      pid: 42881,
      tool: "codex",
      tmuxTarget: "debrief:0.0",
      detectedAt: hoursAgo(0.01),
    },
    summaryState: "ready",
  },
  {
    id: 2,
    path: "/Users/demo/Projects/api-console",
    name: "api-console",
    client: "Demo Labs",
    pinned: false,
    hidden: false,
    brainLinked: true,
    lastActivityAt: hoursAgo(2),
    latestSession: sessions.get(2)?.[0] ?? null,
    liveStatus: null,
    summaryState: "ready",
  },
  {
    id: 3,
    path: "/Users/demo/Projects/proposal-portal",
    name: "proposal-portal",
    client: "Sample Co",
    pinned: true,
    hidden: false,
    brainLinked: false,
    lastActivityAt: hoursAgo(8),
    latestSession: sessions.get(3)?.[0] ?? null,
    liveStatus: null,
    summaryState: "ready",
  },
  {
    id: 4,
    path: "/Users/demo/Projects/research-catalog",
    name: "research-catalog",
    client: "Example Co",
    pinned: false,
    hidden: false,
    brainLinked: false,
    lastActivityAt: hoursAgo(96),
    latestSession: sessions.get(4)?.[0] ?? null,
    liveStatus: null,
    summaryState: "ready",
  },
  {
    id: 5,
    path: "/Users/demo/Projects/session-index",
    name: "session-index",
    client: null,
    pinned: false,
    hidden: false,
    brainLinked: false,
    lastActivityAt: hoursAgo(0.2),
    latestSession: sessions.get(5)?.[0] ?? null,
    liveStatus: null,
    summaryState: "awaiting-summary",
  },
  {
    id: 6,
    path: "/Users/demo/Projects/summary-worker",
    name: "summary-worker",
    client: null,
    pinned: false,
    hidden: true,
    brainLinked: false,
    lastActivityAt: hoursAgo(3),
    latestSession: sessions.get(6)?.[0] ?? null,
    liveStatus: null,
    summaryState: "degraded",
  },
];

const d012Summary = summary(
  1201,
  1201,
  [
    "Git phase-4/runtime-fix; dirty; last commit test: fixture",
    "developer: Preserve internal transport scaffolding.",
    "<environment_context>",
    "  <cwd>/Users/demo/Projects/d012-summary-fixture</cwd>",
    "</environment_context>",
    "user: Continue the D-012 work.",
    "assistant: ## Verified D-012 outcome",
    "",
    "- Historical fallback now selects the latest Agent outcome.",
    "- Original turn evidence remains unchanged.",
    "- Safe Markdown preserves lists and fenced code.",
    "",
    "The long preview intentionally keeps the full Markdown document in the accessibility tree while the visual inspector starts compact. Expanding the summary enables its code-copy action without changing the source summary or raw conversation.",
    "",
    "```ts",
    "const presentation = {",
    '  source: "rules-fallback",',
    "  sanitized: true,",
    "};",
    "```",
    "",
    "<oai-mem-citation>",
    "<citation_entries>",
    "MEMORY.md:1-2|note=[fixture transport]",
    "</citation_entries>",
    "</oai-mem-citation>",
  ].join("\n"),
  {
    model: "rules-fallback",
    openItems: [
      "Verify `Copy code` preserves indentation.",
      "Confirm the compact preview at 320 and 408 pixels.",
    ],
    nextSteps: ["Run the focused **D-012** accessibility gate."],
    decisions: [
      "Keep the original turn as canonical evidence.",
      "Disable code actions only while a long summary is visually collapsed.",
    ],
    keyFiles: [
      "packages/app/src/lib/summary-presentation.ts",
      "packages/app/src/components/MarkdownContent.tsx",
    ],
  },
);

const d012Session = session(
  1201,
  1201,
  "codex",
  "phase-4/runtime-fix",
  hoursAgo(0.1),
  d012Summary,
);

const d012Sessions = new Map<number, Session[]>([[1201, [d012Session]]]);

const d012Projects: Project[] = [
  {
    id: 1201,
    path: "/Users/demo/Projects/d012-summary-fixture",
    name: "d012-summary-fixture",
    client: "QA fixture",
    pinned: true,
    hidden: false,
    brainLinked: false,
    lastActivityAt: hoursAgo(0.1),
    latestSession: d012Session,
    liveStatus: null,
    summaryState: "degraded",
  },
];

const usage = (
  provider: "claude-code" | "codex",
  model: string | null,
  values: Partial<SessionUsage> = {},
): SessionUsage => ({
  provider,
  model,
  inputTokens: 10_000,
  baseInputTokens: 1_000,
  cacheReadInputTokens: 7_500,
  cacheCreationInputTokens: 1_500,
  outputTokens: 2_000,
  reasoningOutputTokens: null,
  providerTotalTokens: null,
  totalTokens: 12_000,
  observedAt: hoursAgo(0.1),
  coverage: "complete",
  coveredFromOffset: 0,
  coveredToOffset: 120_000,
  ...values,
});

const d013Session = (
  id: number,
  projectId: number,
  tool: "claude-code" | "codex",
  projectName: string,
  latestUsage: SessionUsage | null,
): Session =>
  session(
    id,
    projectId,
    tool,
    "phase-4/session-usage",
    hoursAgo(projectId - 1_300),
    summary(
      id + 10_000,
      id,
      demoText(
        `${projectName} preserves provider-native model and session usage evidence.`,
        `${projectName} 保留 provider-native model 與 session usage evidence。`,
        `${projectName} 保留 provider-native 模型与会话用量证据。`,
      ),
      {
        nextSteps: [
          demoText(
            "Verify Token usage and coverage presentation.",
            "驗證 Token 用量與 coverage 呈現。",
            "验证 Token 用量与 coverage 显示。",
          ),
        ],
      },
    ),
    latestUsage,
  );

const d013Sessions = new Map<number, Session[]>([
  [
    1_301,
    [
      d013Session(
        13_011,
        1_301,
        "claude-code",
        "Claude complete",
        usage("claude-code", "claude-opus-5-20260731", {
          inputTokens: 12_500,
          baseInputTokens: 1_200,
          cacheReadInputTokens: 9_500,
          cacheCreationInputTokens: 1_800,
          outputTokens: 2_820,
          totalTokens: 15_320,
        }),
      ),
    ],
  ],
  [
    1_302,
    [
      d013Session(
        13_021,
        1_302,
        "codex",
        "Codex live",
        usage("codex", "gpt-5.6-sol", {
          inputTokens: 120_000,
          baseInputTokens: null,
          cacheReadInputTokens: 40_000,
          cacheCreationInputTokens: 0,
          outputTokens: 8_000,
          reasoningOutputTokens: 2_000,
          providerTotalTokens: 128_000,
          totalTokens: 128_000,
        }),
      ),
    ],
  ],
  [
    1_303,
    [
      d013Session(
        13_031,
        1_303,
        "claude-code",
        "Partial index",
        usage("claude-code", "claude-sonnet-4-5", {
          inputTokens: 3_200,
          baseInputTokens: 200,
          cacheReadInputTokens: 2_500,
          cacheCreationInputTokens: 500,
          outputTokens: 1_000,
          totalTokens: 4_200,
          coverage: "partial",
          coveredFromOffset: 48_000,
        }),
      ),
    ],
  ],
  [
    1_304,
    [
      d013Session(
        13_041,
        1_304,
        "codex",
        "Usage missing",
        null,
      ),
    ],
  ],
  [
    1_305,
    [
      d013Session(
        13_051,
        1_305,
        "claude-code",
        "Explicit zero",
        usage("claude-code", "claude-haiku-4-5", {
          inputTokens: 0,
          baseInputTokens: 0,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          coveredToOffset: 0,
        }),
      ),
    ],
  ],
  [
    1_306,
    [
      d013Session(
        13_061,
        1_306,
        "codex",
        "Large long model",
        usage(
          "codex",
          "gpt-5.6-sol-2026-07-31-high-reasoning-preview-ultra-long-provider-native-identifier",
          {
            inputTokens: 15_000_000,
            baseInputTokens: null,
            cacheReadInputTokens: 10_000_000,
            cacheCreationInputTokens: 0,
            outputTokens: 789_321,
            reasoningOutputTokens: 456_789,
            providerTotalTokens: 15_789_321,
            totalTokens: 15_789_321,
          },
        ),
      ),
    ],
  ],
]);

const d013Projects: Project[] = [
  {
    id: 1_301,
    path: "/Users/demo/Projects/claude-complete",
    name: "claude-complete",
    client: "Usage QA",
    pinned: true,
    hidden: false,
    brainLinked: false,
    lastActivityAt: hoursAgo(1),
    latestSession: d013Sessions.get(1_301)?.[0] ?? null,
    liveStatus: null,
    summaryState: "ready",
  },
  {
    id: 1_302,
    path: "/Users/demo/Projects/codex-live",
    name: "codex-live",
    client: "Usage QA",
    pinned: true,
    hidden: false,
    brainLinked: false,
    lastActivityAt: hoursAgo(0.1),
    latestSession: d013Sessions.get(1_302)?.[0] ?? null,
    liveStatus: {
      pid: 42_881,
      tool: "codex",
      tmuxTarget: "usage-qa:0.0",
      detectedAt: hoursAgo(0.01),
    },
    summaryState: "ready",
  },
  {
    id: 1_303,
    path: "/Users/demo/Projects/partial-index",
    name: "partial-index",
    client: "Usage QA",
    pinned: false,
    hidden: false,
    brainLinked: false,
    lastActivityAt: hoursAgo(2),
    latestSession: d013Sessions.get(1_303)?.[0] ?? null,
    liveStatus: null,
    summaryState: "ready",
  },
  {
    id: 1_304,
    path: "/Users/demo/Projects/usage-missing",
    name: "usage-missing",
    client: "Usage QA",
    pinned: false,
    hidden: false,
    brainLinked: false,
    lastActivityAt: hoursAgo(3),
    latestSession: d013Sessions.get(1_304)?.[0] ?? null,
    liveStatus: null,
    summaryState: "ready",
  },
  {
    id: 1_305,
    path: "/Users/demo/Projects/explicit-zero",
    name: "explicit-zero",
    client: "Usage QA",
    pinned: false,
    hidden: false,
    brainLinked: false,
    lastActivityAt: hoursAgo(4),
    latestSession: d013Sessions.get(1_305)?.[0] ?? null,
    liveStatus: null,
    summaryState: "ready",
  },
  {
    id: 1_306,
    path: "/Users/demo/Projects/large-long-model",
    name: "large-long-model",
    client: "Usage QA",
    pinned: false,
    hidden: false,
    brainLinked: false,
    lastActivityAt: hoursAgo(5),
    latestSession: d013Sessions.get(1_306)?.[0] ?? null,
    liveStatus: null,
    summaryState: "ready",
  },
];

const d016Projects: Project[] = [
  ...d013Projects,
  ...d013Projects.map((project, index) => {
    const id = 1_401 + index;
    const latestSession = project.latestSession
      ? {
          ...project.latestSession,
          id: project.latestSession.id + 1_000,
          projectId: id,
          summary: project.latestSession.summary
            ? {
                ...project.latestSession.summary,
                id: project.latestSession.summary.id + 1_000,
                sessionId: project.latestSession.id + 1_000,
              }
            : null,
        }
      : null;
    return {
      ...project,
      id,
      path: `${project.path}-archive`,
      name: `${project.name}-archive`,
      latestSession,
      liveStatus: null,
    };
  }),
];

const d016Sessions = new Map<number, Session[]>(
  d016Projects.map((project) => [
    project.id,
    project.latestSession ? [project.latestSession] : [],
  ]),
);

export class DemoRepository implements DashboardRepository {
  private runtimeStatus: RuntimeStatus;

  constructor(
    private readonly mode: "default" | "empty" | "error" = "default",
    runtimeMode: "healthy" | "setup" | "fallback" = "healthy",
    private readonly fixture:
      | "default"
      | "d012"
      | "d013"
      | "d014"
      | "d016" = "default",
    private readonly applicationsMode: "present" | "absent" = "present",
  ) {
    this.runtimeStatus = runtimeStatusFixture(runtimeMode, applicationsMode);
  }

  async loadSnapshot(): Promise<DashboardSnapshot> {
    if (this.mode === "error") {
      throw new Error(i18n.t("errors.demoIndexError"));
    }
    return {
      projects:
        this.mode === "empty"
          ? []
          : structuredClone(this.activeProjects()),
      loadedAt: new Date().toISOString(),
    };
  }

  async loadProjectDetail(projectId: number): Promise<ProjectDetail> {
    const project = this.activeProjects().find(
      (candidate) => candidate.id === projectId,
    );
    if (!project) throw new Error(i18n.t("errors.projectMissing"));
    return {
      project: structuredClone(project),
      sessions: structuredClone(this.activeSessions().get(projectId) ?? []),
    };
  }

  async loadSessionTurnLog(
    sessionId: number,
    limit = 20,
  ): Promise<SessionTurnLogPage> {
    const currentSession = [...this.activeSessions().values()]
      .flat()
      .find((candidate) => candidate.id === sessionId);
    if (!currentSession) throw new Error(i18n.t("errors.turnLogMissing"));
    if (this.fixture === "d014") {
      return {
        sessionId,
        turns: [
          {
            ordinal: 23,
            timestamp: currentSession.startedAt,
            userPrompt:
              "Keep this exact user prompt.\n\nPreserve its spacing and punctuation.",
            assistantResponse:
              "This exact Agent response remains local.\n\nNo earlier turn is implied.",
          },
          {
            ordinal: 24,
            timestamp: currentSession.endedAt,
            userPrompt:
              "Verify the scoped copy controls without selecting rendered text.",
            assistantResponse:
              "Verified: prompt, response, and loaded-log copy states remain independent.",
          },
        ],
        totalTurns: 24,
        hasEarlier: true,
        skippedLines: 0,
        limit: Math.max(1, Math.min(limit, 20)),
      };
    }
    if (this.fixture === "d012") {
      return {
        sessionId,
        turns: [
          {
            ordinal: 1,
            timestamp: currentSession.startedAt,
            userPrompt: [
              "Validate the original evidence renderer.",
              "",
              '<script data-fixture="true">window.bad = true</script>',
              "![remote fixture](https://tracker.invalid/fixture.png)",
              "[External fixture link](https://example.invalid/docs)",
            ].join("\n"),
            assistantResponse: [
              "## Agent response",
              "",
              "The raw response remains authoritative.",
              "",
              "```json",
              "{",
              '  "status": "verified",',
              '  "source": "original-turn"',
              "}",
              "```",
              "",
              "```bash",
              "pnpm --filter @debrief/app test",
              "```",
            ].join("\n"),
          },
        ],
        totalTurns: 1,
        hasEarlier: false,
        skippedLines: 0,
        limit: Math.max(1, Math.min(limit, 20)),
      };
    }
    return {
      sessionId,
      turns: [
        {
          ordinal: 1,
          timestamp: currentSession.startedAt,
          userPrompt: demoText(
            "Confirm the current progress, preserve existing data, and complete the next verifiable step.",
            "請確認目前進度，保留既有資料，並完成下一個可驗證的步驟。",
            "请确认当前进度，保留现有数据，并完成下一个可验证的步骤。",
          ),
          assistantResponse: demoText(
            "I reviewed the current state and completed the safe in-scope update. The next step is to run the corresponding gate.",
            "已讀取目前狀態並完成安全範圍內的更新；下一步是執行對應 gate。",
            "已读取当前状态并完成安全范围内的更新；下一步是运行对应 gate。",
          ),
        },
        {
          ordinal: 2,
          timestamp: currentSession.endedAt,
          userPrompt: [
            "# Release checklist",
            "",
            "- Preserve context",
            "- Run the gate",
            "",
            "| Check | State |",
            "| --- | --- |",
            "| Build | Passed |",
            "",
            "```ts",
            "const ready = true;",
            "```",
          ].join("\n"),
          assistantResponse: demoText(
            "## Result\n\nThe implementation is complete. Verification and delivery remain.",
            "## Result\n\n目前 implementation 已完成，剩餘工作是驗證與交付。",
            "## 结果\n\n当前实现已完成，剩余工作是验证与交付。",
          ),
        },
      ].slice(-Math.max(1, Math.min(limit, 20))),
      totalTurns: 2,
      hasEarlier: false,
      skippedLines: 0,
      limit: Math.max(1, Math.min(limit, 20)),
    };
  }

  async loadRuntimeStatus(): Promise<RuntimeStatus> {
    return structuredClone(this.runtimeStatus);
  }

  async installDaemon(): Promise<RuntimeStatus> {
    this.runtimeStatus = runtimeStatusFixture(
      "healthy",
      this.applicationsMode,
    );
    return structuredClone(this.runtimeStatus);
  }

  async openPrivacySecurity(): Promise<void> {}

  async setAcknowledged(
    summaryId: number,
    acknowledged: boolean,
  ): Promise<void> {
    projects = projects.map((project) => {
      if (project.latestSession?.summary?.id !== summaryId) return project;
      return {
        ...project,
        latestSession: {
          ...project.latestSession,
          summary: { ...project.latestSession.summary, acknowledged },
        },
      };
    });
  }

  async updateProject(
    projectId: number,
    patch: ProjectPatch,
  ): Promise<void> {
    projects = projects.map((project) =>
      project.id === projectId ? { ...project, ...patch } : project,
    );
  }

  async openTerminal(): Promise<void> {}
  async openEditor(): Promise<void> {}
  async openVisualStudioCode(): Promise<void> {}
  async openWarp(): Promise<void> {}
  async copyRecap(recap: string): Promise<void> {
    await navigator.clipboard.writeText(recap);
  }
  async reportFirstPaint(): Promise<null> {
    return null;
  }

  private activeProjects(): Project[] {
    if (this.fixture === "d012") return d012Projects;
    if (this.fixture === "d013") return d013Projects;
    if (this.fixture === "d016") return d016Projects;
    return projects;
  }

  private activeSessions(): Map<number, Session[]> {
    if (this.fixture === "d012") return d012Sessions;
    if (this.fixture === "d013") return d013Sessions;
    if (this.fixture === "d016") return d016Sessions;
    return sessions;
  }
}

function runtimeStatusFixture(
  mode: "healthy" | "setup" | "fallback",
  applicationsMode: "present" | "absent",
): RuntimeStatus {
  const needsSetup = mode === "setup";
  const fallback = mode === "fallback";
  return {
    daemon: {
      label: "com.tenten.debrief-daemon",
      installed: !needsSetup,
      running: !needsSetup,
      pid: needsSetup ? null : 5151,
      state: needsSetup ? null : "running",
      runtimeVersion: needsSetup ? null : "0.1.0",
    },
    config: {
      exists: !needsSetup && !fallback,
      gatewayConfigured: !needsSetup && !fallback,
      summaryModelConfigured: !needsSetup && !fallback,
    },
    applications: {
      visualStudioCode: applicationsMode === "present",
      warp: applicationsMode === "present",
      editor:
        applicationsMode === "present"
          ? {
              kind: "visual-studio-code",
              name: "Visual Studio Code",
              available: true,
            }
          : null,
    },
    databaseExists: true,
  };
}
