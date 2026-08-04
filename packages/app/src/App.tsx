import { AlertTriangle, Filter, RefreshCw, RotateCcw } from "lucide-react";
import type { TFunction } from "i18next";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { CommandPalette } from "./components/CommandPalette";
import { DataSourcesView } from "./components/DataSourcesView";
import { DetailInspector } from "./components/DetailInspector";
import { DetailPanel } from "./components/DetailPanel";
import {
  EmptyProjects,
  Onboarding,
  RuntimeSetup,
  ScanProgress,
} from "./components/ExperienceStates";
import { ProjectRow } from "./components/ProjectRow";
import { SettingsView } from "./components/SettingsView";
import { Sidebar, sidebarDestinations } from "./components/Sidebar";
import { Toolbar } from "./components/Toolbar";
import { createRepository } from "./data/repository";
import {
  reportRuntimeError,
  reportRuntimeMilestone,
} from "./data/runtime-diagnostics";
import { useDashboard } from "./hooks/use-dashboard";
import { useRuntimeStatus } from "./hooks/use-runtime-status";
import { currentLocale } from "./i18n";
import { buildRecap } from "./lib/recap";
import {
  isProjectSortOrder,
  projectStatus,
  sortProjects,
} from "./lib/project-status";
import { runtimeNeedsAttention } from "./lib/runtime-health";
import {
  COMPACT_LAYOUT_MAX_WIDTH,
  hasStoredThemePreference,
  readProjectSortPreference,
  readSidebarVisibility,
  readThemePreference,
  type ThemePreference,
  writeProjectSortPreference,
  writeSidebarVisibility,
  writeThemePreference,
} from "./lib/view-preferences";
import type {
  AgentTool,
  DashboardRepository,
  Project,
  SidebarSelection,
} from "./types";

interface AppProps {
  repository?: DashboardRepository;
}

type ToolFilter = "all" | AgentTool;

export default function App({ repository: suppliedRepository }: AppProps) {
  const { t } = useTranslation();
  const forcedState = useMemo(() => demoStateFromUrl(), []);
  const forcedTheme = useMemo(() => demoThemeFromUrl(), []);
  const { repository, startupError } = useMemo(() => {
    if (suppliedRepository) {
      return { repository: suppliedRepository, startupError: null };
    }
    try {
      return { repository: createRepository(), startupError: null };
    } catch (error) {
      return {
        repository: null,
        startupError: error instanceof Error ? error.message : String(error),
      };
    }
  }, [suppliedRepository]);
  const dashboard = useDashboard(repository);
  const runtime = useRuntimeStatus(repository);
  const [selection, setSelection] = useState<SidebarSelection>({ kind: "all" });
  const [query, setQuery] = useState("");
  const [toolFilter, setToolFilter] = useState<ToolFilter>("all");
  const [sortOrder, setSortOrder] = useState(() =>
    readProjectSortPreference(window.localStorage),
  );
  const [sidebarVisible, setSidebarVisible] = useState(() =>
    readSidebarVisibility(window.localStorage),
  );
  const [compactLayout, setCompactLayout] = useState(
    () => window.innerWidth <= COMPACT_LAYOUT_MAX_WIDTH,
  );
  const [theme, setTheme] = useState<ThemePreference>(
    () =>
      forcedTheme ??
      readThemePreference(window.localStorage, systemPrefersDark()),
  );
  const [commandOpen, setCommandOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [focusedRowIndex, setFocusedRowIndex] = useState(0);
  const [showOnboarding, setShowOnboarding] = useState(
    () =>
      forcedState === "onboarding" ||
      (!suppliedRepository &&
        !isDemoMode() &&
        window.localStorage.getItem("debrief-onboarding-complete") !== "true"),
  );
  const [showScanProgress, setShowScanProgress] = useState(
    forcedState === "scanning",
  );
  const searchRef = useRef<HTMLInputElement>(null);
  const commandButtonRef = useRef<HTMLButtonElement>(null);
  const projectListRef = useRef<HTMLElement>(null);
  const restoreRowIndex = useRef(0);
  const firstPaintReported = useRef(false);
  const domCommitReported = useRef(false);

  const allProjects = dashboard.snapshot?.projects ?? [];
  const effectiveSortOrder =
    selection.kind === "recent" ? "activity-desc" : sortOrder;
  const filteredProjects = useMemo(() => {
    const normalizedQuery = query
      .trim()
      .toLocaleLowerCase(currentLocale());
    const matched = allProjects.filter((project) => {
      if (!matchesSelection(project, selection)) return false;
      if (
        toolFilter !== "all" &&
        project.latestSession?.tool !== toolFilter
      ) {
        return false;
      }
      if (!normalizedQuery) return true;
      const summary = project.latestSession?.summary;
      return [
        project.name,
        project.path,
        project.client ?? t("common.internal"),
        project.latestSession?.tool ?? "",
        project.latestSession?.gitBranch ?? "",
        summary?.stateSummary ?? "",
        ...(summary?.openItems ?? []),
        ...(summary?.nextSteps ?? []),
      ]
        .join(" ")
        .toLocaleLowerCase(currentLocale())
        .includes(normalizedQuery);
    });
    return sortProjects(matched, effectiveSortOrder);
  }, [
    allProjects,
    effectiveSortOrder,
    query,
    selection,
    t,
    toolFilter,
  ]);
  const destinations = useMemo(
    () => sidebarDestinations(allProjects),
    [allProjects],
  );
  const counts = useMemo(
    () => ({
      attention: allProjects.filter(
        (project) =>
          !project.hidden && projectStatus(project) === "attention",
      ).length,
      running: allProjects.filter(
        (project) => !project.hidden && projectStatus(project) === "running",
      ).length,
      total: allProjects.filter((project) => !project.hidden).length,
    }),
    [allProjects],
  );
  const isSources = selection.kind === "sources";
  const isSettings = selection.kind === "settings";
  const detailVisible =
    !isSources &&
    !isSettings &&
    (dashboard.detail !== null ||
      (dashboard.selectedProjectId !== null &&
        dashboard.busy === `detail:${dashboard.selectedProjectId}`));
  const compactDetailVisible = compactLayout && detailVisible;
  const effectiveSidebarVisible =
    sidebarVisible && !compactDetailVisible;

  const focusRow = useCallback((index: number) => {
    const list = projectListRef.current;
    if (!list) return;
    const rows =
      list.querySelectorAll<HTMLButtonElement>("[data-project-index]");
    if (rows.length === 0) return;
    const nextIndex = Math.max(0, Math.min(index, rows.length - 1));
    setFocusedRowIndex(nextIndex);
    rows[nextIndex]?.focus();
  }, []);

  const closeDetail = useCallback(async () => {
    await dashboard.selectProject(null);
    requestAnimationFrame(() => focusRow(restoreRowIndex.current));
  }, [dashboard.selectProject, focusRow]);

  const copyRecap = useCallback(
    async (project: Project) => {
      if (!repository) return;
      try {
        await repository.copyRecap(buildRecap(project));
        setNotice(t("app.recapCopied", { project: project.name }));
      } catch (error) {
        setNotice(error instanceof Error ? error.message : String(error));
      }
    },
    [repository, t],
  );

  const toggleSidebar = useCallback(() => {
    if (compactDetailVisible) {
      setSidebarVisible(true);
      void closeDetail();
      return;
    }
    setSidebarVisible((visible) => !visible);
  }, [closeDetail, compactDetailVisible]);

  const refreshAll = useCallback(async () => {
    await Promise.all([dashboard.refresh(), runtime.refresh()]);
  }, [dashboard.refresh, runtime.refresh]);

  const selectWorkspace = useCallback(
    (nextSelection: SidebarSelection) => {
      setSelection(nextSelection);
      setFocusedRowIndex(0);
    },
    [],
  );

  const closeCommand = useCallback(() => {
    setCommandOpen(false);
    requestAnimationFrame(() => commandButtonRef.current?.focus());
  }, []);
  const keyboardStateRef = useRef({
    commandOpen,
    selectedProjectId: dashboard.selectedProjectId,
    selectedProject: dashboard.detail?.project ?? null,
    detailVisible,
    projects: filteredProjects,
    focusedRowIndex,
    destinations,
  });
  keyboardStateRef.current = {
    commandOpen,
    selectedProjectId: dashboard.selectedProjectId,
    selectedProject: dashboard.detail?.project ?? null,
    detailVisible,
    projects: filteredProjects,
    focusedRowIndex,
    destinations,
  };

  useEffect(() => {
    writeSidebarVisibility(window.localStorage, sidebarVisible);
  }, [sidebarVisible]);

  useEffect(() => {
    writeProjectSortPreference(window.localStorage, sortOrder);
  }, [sortOrder]);

  useEffect(() => {
    const onResize = () =>
      setCompactLayout(
        window.innerWidth <= COMPACT_LAYOUT_MAX_WIDTH,
      );
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    if (!forcedTheme) {
      writeThemePreference(window.localStorage, theme);
    }
  }, [forcedTheme, theme]);

  useEffect(() => {
    if (
      forcedTheme ||
      hasStoredThemePreference(window.localStorage) ||
      typeof window.matchMedia !== "function"
    ) {
      return;
    }
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const syncTheme = () => setTheme(media.matches ? "dark" : "light");
    media.addEventListener?.("change", syncTheme);
    return () => media.removeEventListener?.("change", syncTheme);
  }, [forcedTheme]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLocaleLowerCase();
      const shortcutState = keyboardStateRef.current;
      if (event.metaKey && event.shiftKey && key === "s") {
        event.preventDefault();
        toggleSidebar();
        return;
      }
      if (event.metaKey && key === "k") {
        event.preventDefault();
        if (shortcutState.commandOpen) closeCommand();
        else setCommandOpen(true);
        return;
      }
      if (event.metaKey && key === "f") {
        event.preventDefault();
        if (shortcutState.commandOpen) setCommandOpen(false);
        requestAnimationFrame(() => searchRef.current?.focus());
        return;
      }
      if (event.metaKey && key === "r") {
        event.preventDefault();
        void refreshAll();
        return;
      }
      if (event.metaKey && event.key === ",") {
        event.preventDefault();
        if (shortcutState.commandOpen) setCommandOpen(false);
        selectWorkspace({ kind: "settings" });
        return;
      }
      if (event.metaKey && /^[1-9]$/.test(event.key)) {
        const destination =
          shortcutState.destinations[Number(event.key) - 1];
        if (destination) {
          event.preventDefault();
          selectWorkspace(destination);
        }
        return;
      }
      if (event.key === "Escape") {
        if (shortcutState.commandOpen) {
          event.preventDefault();
          closeCommand();
          return;
        }
        if (
          shortcutState.detailVisible &&
          shortcutState.selectedProjectId !== null
        ) {
          event.preventDefault();
          void closeDetail();
        }
        return;
      }
      if (event.metaKey && event.key === "Enter") {
        const selected = shortcutState.selectedProject;
        const focused =
          shortcutState.projects[shortcutState.focusedRowIndex];
        const project = selected ?? focused;
        if (project) {
          event.preventDefault();
          void copyRecap(project);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    closeCommand,
    closeDetail,
    copyRecap,
    refreshAll,
    selectWorkspace,
    toggleSidebar,
  ]);

  useEffect(() => {
    if (focusedRowIndex < filteredProjects.length) return;
    setFocusedRowIndex(Math.max(0, filteredProjects.length - 1));
  }, [filteredProjects.length, focusedRowIndex]);

  useEffect(() => {
    if (!dashboard.snapshot || firstPaintReported.current || !repository) return;
    firstPaintReported.current = true;
    let painted = false;
    const fallback = window.setTimeout(() => {
      if (!painted) reportRuntimeMilestone("raf-unavailable");
    }, 250);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        painted = true;
        window.clearTimeout(fallback);
        void repository
          .reportFirstPaint()
          .then((elapsedMs) => {
            if (elapsedMs !== null) {
              console.info(
                JSON.stringify({
                  event: "debrief_first_data_paint",
                  elapsedMs,
                }),
              );
            }
          })
          .catch(reportRuntimeError);
      });
    });
  }, [dashboard.snapshot, repository]);

  useLayoutEffect(() => {
    if (!dashboard.snapshot || domCommitReported.current) return;
    domCommitReported.current = true;
    reportRuntimeMilestone("dom-commit");
  }, [dashboard.snapshot]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 2_500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const runAction = async (
    action: () => Promise<void>,
    successNotice?: string,
  ) => {
    try {
      await action();
      if (successNotice) setNotice(successNotice);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  };

  const error = startupError ?? dashboard.error;
  const title = selectionTitle(selection, t);

  if (showOnboarding) {
    return (
      <Onboarding
        runtimeStatus={runtime.status}
        runtimeBusy={runtime.busy !== null}
        runtimeError={runtime.serviceError}
        indexError={dashboard.error}
        onInstallDaemon={async () => {
          if (await runtime.install()) {
            setNotice(t("app.daemonStarted"));
          }
        }}
        onRetryRuntime={() => {
          void runtime.refresh();
        }}
        onStart={async () => {
          setShowOnboarding(false);
          setShowScanProgress(true);
          const loaded = await dashboard.refresh();
          setShowScanProgress(false);
          if (loaded) {
            window.localStorage.setItem("debrief-onboarding-complete", "true");
          } else {
            setShowOnboarding(true);
          }
        }}
      />
    );
  }

  if (showScanProgress) {
    return <ScanProgress />;
  }

  return (
    <div
      className="app-shell handoff-shell"
      data-sidebar-visible={effectiveSidebarVisible}
      data-detail-visible={detailVisible}
    >
      <Toolbar
        query={query}
        sidebarVisible={effectiveSidebarVisible}
        theme={theme}
        searchRef={searchRef}
        commandButtonRef={commandButtonRef}
        onQueryChange={setQuery}
        onToggleSidebar={toggleSidebar}
        onOpenCommand={() => setCommandOpen(true)}
        onToggleTheme={() =>
          setTheme((current) => (current === "light" ? "dark" : "light"))
        }
      />

      <Sidebar
        projects={allProjects}
        selection={selection}
        visible={effectiveSidebarVisible}
        runtimeStatus={runtime.status}
        runtimeError={runtime.serviceError}
        onSelect={selectWorkspace}
        onHide={() => setSidebarVisible(false)}
      />

      <main className="workspace handoff-workspace">
        <section className="handoff-content-header">
          <div>
            <p className="eyebrow">
              {isSources
                ? t("app.localDataPlane")
                : isSettings
                  ? t("app.settingsPlane")
                  : t("app.agentWorkspace")}
              <span aria-hidden="true">·</span>
              {dashboard.snapshot
                ? t("app.indexUpdated", {
                    time: new Intl.DateTimeFormat(currentLocale(), {
                      timeStyle: "medium",
                    }).format(new Date(dashboard.snapshot.loadedAt)),
                  })
                : t("app.indexLoading")}
            </p>
            <h1>{title}</h1>
            <p>{selectionDescription(selection, counts, t)}</p>
          </div>
          <div className="handoff-header-actions">
            {!isSources && !isSettings && (
              <div
                className="segmented-control"
                aria-label={t("app.toolFilter")}
              >
                {(
                  [
                    ["all", t("app.allTools")],
                    ["codex", t("common.codex")],
                    ["claude-code", t("common.claude")],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={toolFilter === value}
                    onClick={() => setToolFilter(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
            {!isSettings && (
              <button
                className="secondary-button refresh-button"
                type="button"
                disabled={dashboard.busy === "refresh"}
                aria-keyshortcuts="Meta+R"
                onClick={() => void refreshAll()}
              >
                <RefreshCw
                  className={
                    dashboard.busy === "refresh" ? "is-spinning" : ""
                  }
                  aria-hidden="true"
                />
                {dashboard.busy === "refresh"
                  ? t("app.refreshing")
                  : t("app.refresh")}
                <kbd>⌘R</kbd>
              </button>
            )}
          </div>
        </section>

        {!isSources &&
          !isSettings &&
          runtimeNeedsAttention(runtime.status, runtime.serviceError) && (
            <RuntimeSetup
              compact
              status={runtime.status}
              busy={runtime.busy !== null}
              error={runtime.serviceError}
              onInstall={async () => {
                if (await runtime.install()) {
                  setNotice(t("app.daemonStarted"));
                }
              }}
              onRetry={() => {
                void runtime.refresh();
              }}
            />
          )}

        {error && !dashboard.snapshot ? (
          <div className="state-screen" role="alert">
            <AlertTriangle aria-hidden="true" />
            <h2>{t("app.loadErrorTitle")}</h2>
            <p>{error}</p>
            <button type="button" onClick={() => void dashboard.refresh()}>
              <RotateCcw aria-hidden="true" />
              {t("common.retry")}
            </button>
          </div>
        ) : isSources ? (
          <DataSourcesView
            projects={allProjects}
            loadedAt={dashboard.snapshot?.loadedAt ?? null}
            runtimeStatus={runtime.status}
            serviceError={runtime.serviceError}
            privacyError={runtime.privacyError}
            runtimeBusy={runtime.busy !== null}
            onInstallDaemon={() => {
              void runtime.install();
            }}
            onRetryStatus={() => {
              void runtime.refresh();
            }}
            onOpenPrivacySecurity={() => {
              void runtime.openPrivacySecurity();
            }}
          />
        ) : isSettings ? (
          <SettingsView
            runtimeBusy={runtime.busy !== null}
            privacyError={runtime.privacyError}
            onOpenPrivacySecurity={() => {
              void runtime.openPrivacySecurity();
            }}
          />
        ) : !dashboard.snapshot ? (
          <LoadingList />
        ) : allProjects.length === 0 ? (
          <EmptyProjects />
        ) : (
          <>
            {selection.kind === "all" && !query && (
              <section
                className="handoff-summary-strip"
                aria-label={t("app.handoffSummary")}
              >
                <div>
                  <strong>{t("app.synced")}</strong>
                  <p>
                    {counts.attention > 0
                      ? t("app.reviewAttention", {
                          count: counts.attention,
                        })
                      : t("app.noAttention")}
                  </p>
                </div>
                <SummaryStat
                  label={t("app.attention")}
                  value={counts.attention}
                  tone="attention"
                />
                <SummaryStat
                  label={t("app.running")}
                  value={counts.running}
                  tone="running"
                />
                <SummaryStat label={t("app.projects")} value={counts.total} />
              </section>
            )}

            <section className="handoff-project-section">
              <header>
                <p>
                  <strong>
                    {t("app.projectCount", {
                      count: filteredProjects.length,
                    })}
                  </strong>
                  {(query || toolFilter !== "all") && (
                    <span className="filtered-label">
                      <Filter aria-hidden="true" />
                      {t("app.filtered")}
                    </span>
                  )}
                </p>
                <label
                  className="project-sort-control"
                  title={
                    selection.kind === "recent"
                      ? t("app.recentSortFixed")
                      : undefined
                  }
                >
                  <span>{t("app.sortLabel")}</span>
                  <select
                    value={effectiveSortOrder}
                    disabled={selection.kind === "recent"}
                    onChange={(event) => {
                      if (!isProjectSortOrder(event.target.value)) return;
                      setSortOrder(event.target.value);
                      setFocusedRowIndex(0);
                    }}
                  >
                    <option value="priority">
                      {t("app.sortPriority")}
                    </option>
                    <option value="activity-desc">
                      {t("app.sortActivityNewest")}
                    </option>
                    <option value="activity-asc">
                      {t("app.sortActivityOldest")}
                    </option>
                    <option value="usage-desc">
                      {t("app.sortUsageHighest")}
                    </option>
                    <option value="usage-asc">
                      {t("app.sortUsageLowest")}
                    </option>
                  </select>
                </label>
              </header>

              {filteredProjects.length === 0 ? (
                <div className="state-screen filtered-zero">
                  <h2>{t("app.filteredEmptyTitle")}</h2>
                  <p>{t("app.filteredEmptyDescription")}</p>
                  <button
                    type="button"
                    onClick={() => {
                      setQuery("");
                      setToolFilter("all");
                      setSelection({ kind: "all" });
                    }}
                  >
                    {t("app.clearFilters")}
                  </button>
                </div>
              ) : (
                <section
                  className="handoff-project-list"
                  ref={projectListRef}
                  role="list"
                  aria-label={t("app.projectList", { title })}
                >
                  {filteredProjects.map((project, index) => (
                    <ProjectRow
                      key={project.id}
                      project={project}
                      busy={dashboard.busy === `project:${project.id}`}
                      rowIndex={index}
                      active={index === focusedRowIndex}
                      selected={dashboard.selectedProjectId === project.id}
                      applications={runtime.status?.applications ?? null}
                      onFocus={() => setFocusedRowIndex(index)}
                      onNavigate={(direction) => {
                        if (direction === "first") focusRow(0);
                        else if (direction === "last") {
                          focusRow(filteredProjects.length - 1);
                        } else {
                          focusRow(index + (direction === "up" ? -1 : 1));
                        }
                      }}
                      onOpen={() => {
                        restoreRowIndex.current = index;
                        void dashboard.selectProject(project.id);
                      }}
                      onTerminal={() =>
                        void runAction(
                          () => repository!.openTerminal(project),
                          t("app.terminalOpened", { project: project.name }),
                        )
                      }
                      onEditor={() =>
                        void runAction(
                          () => repository!.openEditor(project),
                          t("app.editorOpened", {
                            project: project.name,
                            editor:
                              runtime.status?.applications.editor?.name ??
                              t("common.unknown"),
                          }),
                        )
                      }
                      onVisualStudioCode={() =>
                        void runAction(
                          () => repository!.openVisualStudioCode(project),
                          t("app.visualStudioCodeOpening", {
                            project: project.name,
                          }),
                        )
                      }
                      onWarp={() =>
                        void runAction(
                          () => repository!.openWarp(project),
                          t("app.warpOpening", { project: project.name }),
                        )
                      }
                      onCopyRecap={() => void copyRecap(project)}
                      onAcknowledge={() => {
                        const summaryId = project.latestSession?.summary?.id;
                        if (summaryId) void dashboard.acknowledge(summaryId);
                      }}
                      onUpdate={(patch) =>
                        void dashboard.updateProject(project.id, patch)
                      }
                    />
                  ))}
                </section>
              )}
            </section>
          </>
        )}

        {error && dashboard.snapshot && (
          <div className="error-toast" role="alert">
            {error}
          </div>
        )}
      </main>

      {detailVisible && (
        <DetailInspector sidebarVisible={effectiveSidebarVisible}>
          <DetailPanel
            detail={dashboard.detail}
            loading={
              dashboard.selectedProjectId !== null &&
              dashboard.busy === `detail:${dashboard.selectedProjectId}`
            }
            turnLogs={dashboard.turnLogs}
            onClose={() => void closeDetail()}
            onCopyRecap={(project) => void copyRecap(project)}
            onOpenTerminal={(project) =>
              void runAction(
                () => repository!.openTerminal(project),
                t("app.terminalOpened", { project: project.name }),
              )
            }
            onAcknowledge={(summaryId) =>
              void dashboard.acknowledge(summaryId)
            }
            onLoadTurnLog={(sessionId) =>
              void dashboard.loadTurnLog(sessionId)
            }
          />
        </DetailInspector>
      )}

      {commandOpen && (
        <CommandPalette
          projects={allProjects}
          onClose={closeCommand}
          onPage={(nextSelection) => {
            selectWorkspace(nextSelection);
            setCommandOpen(false);
          }}
          onProject={(project) => {
            setSelection(project.hidden ? { kind: "hidden" } : { kind: "all" });
            setCommandOpen(false);
            void dashboard.selectProject(project.id);
          }}
        />
      )}

      {notice && (
        <div className="notice-toast" role="status">
          {notice}
        </div>
      )}
    </div>
  );
}

function SummaryStat({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number;
  tone?: "attention" | "running" | "neutral";
}) {
  return (
    <div className="handoff-summary-stat" data-tone={tone}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function isDemoMode(): boolean {
  return import.meta.env.VITE_DEBRIEF_DEMO === "1";
}

function demoStateFromUrl(): string | null {
  if (!isDemoMode()) return null;
  return new URLSearchParams(window.location.search).get("state");
}

function demoThemeFromUrl(): ThemePreference | null {
  if (!isDemoMode()) return null;
  const theme = new URLSearchParams(window.location.search).get("theme");
  return theme === "light" || theme === "dark" ? theme : null;
}

function systemPrefersDark(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

function matchesSelection(
  project: Project,
  selection: SidebarSelection,
): boolean {
  switch (selection.kind) {
    case "all":
    case "recent":
      return !project.hidden;
    case "attention":
      return !project.hidden && projectStatus(project) === "attention";
    case "running":
      return !project.hidden && projectStatus(project) === "running";
    case "pinned":
      return project.pinned && !project.hidden;
    case "client":
      return project.client === selection.value && !project.hidden;
    case "internal":
      return !project.client && !project.hidden;
    case "hidden":
      return project.hidden;
    case "sources":
    case "settings":
      return false;
  }
}

function selectionTitle(
  selection: SidebarSelection,
  t: TFunction,
): string {
  switch (selection.kind) {
    case "all":
      return t("app.overviewTitle");
    case "attention":
      return t("app.attentionTitle");
    case "running":
      return t("app.runningTitle");
    case "recent":
      return t("app.recentTitle");
    case "pinned":
      return t("app.pinnedTitle");
    case "client":
      return selection.value;
    case "internal":
      return t("app.internalTitle");
    case "hidden":
      return t("app.hiddenTitle");
    case "sources":
      return t("app.sourcesTitle");
    case "settings":
      return t("app.settingsTitle");
  }
}

function selectionDescription(
  selection: SidebarSelection,
  counts: { attention: number; running: number; total: number },
  t: TFunction,
): string {
  switch (selection.kind) {
    case "all":
      return t("app.overviewDescription", {
        running: t("app.overviewRunning", {
          count: counts.running,
        }),
        attention: t("app.overviewAttention", {
          count: counts.attention,
        }),
      });
    case "attention":
      return t("app.attentionDescription");
    case "running":
      return t("app.runningDescription");
    case "recent":
      return t("app.recentDescription", { count: counts.total });
    case "pinned":
      return t("app.pinnedDescription");
    case "client":
      return t("app.clientDescription");
    case "internal":
      return t("app.internalDescription");
    case "hidden":
      return t("app.hiddenDescription");
    case "sources":
      return t("app.sourcesDescription");
    case "settings":
      return t("app.settingsDescription");
  }
}

function LoadingList() {
  const { t } = useTranslation();
  return (
    <section
      className="handoff-loading-list"
      aria-label={t("app.loadingProjects")}
    >
      {[0, 1, 2, 3, 4, 5].map((index) => (
        <div className="handoff-loading-row" key={index}>
          <div className="summary-skeleton">
            <span />
            <span />
            <span />
          </div>
        </div>
      ))}
    </section>
  );
}
