import {
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Clipboard,
  Copy,
  FileCode2,
  TerminalSquare,
  X,
} from "lucide-react";
import {
  type FocusEvent as ReactFocusEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { idleTurnLogState } from "../hooks/use-dashboard";
import { projectStatus } from "../lib/project-status";
import { formatDateTime, formatRelative } from "../lib/time";
import type {
  Project,
  ProjectDetail,
  SessionTurnLogState,
} from "../types";
import {
  AgentUsageCell,
  SessionUsageStrip,
} from "./AgentUsage";
import { MarkdownContent } from "./MarkdownContent";
import { StatusBadge } from "./StatusBadge";
import { SummaryMarkdown } from "./SummaryMarkdown";

interface DetailPanelProps {
  detail: ProjectDetail | null;
  loading: boolean;
  turnLogs: ReadonlyMap<number, SessionTurnLogState>;
  onClose(): void;
  onCopyRecap(project: Project): void;
  onOpenTerminal(project: Project): void;
  onAcknowledge(summaryId: number): void;
  onLoadTurnLog(sessionId: number): void;
}

export function DetailPanel({
  detail,
  loading,
  turnLogs,
  onClose,
  onCopyRecap,
  onOpenTerminal,
  onAcknowledge,
  onLoadTurnLog,
}: DetailPanelProps) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const wasOpenRef = useRef(false);
  const lastProjectIdRef = useRef<number | null>(null);
  const rememberedFocusRef = useRef<RememberedInspectorFocus | null>(null);
  const isOpen = Boolean(detail || loading);
  const projectId = detail?.project.id ?? null;

  useLayoutEffect(() => {
    if (!isOpen) {
      wasOpenRef.current = false;
      lastProjectIdRef.current = null;
      rememberedFocusRef.current = null;
      return;
    }

    const opened = !wasOpenRef.current;
    const changedProject =
      !opened &&
      projectId !== null &&
      lastProjectIdRef.current !== null &&
      projectId !== lastProjectIdRef.current;

    if (opened || changedProject) {
      closeRef.current?.focus();
    } else {
      restoreRemovedInspectorFocus(
        panelRef.current,
        closeRef.current,
        rememberedFocusRef.current,
      );
    }

    wasOpenRef.current = true;
    if (projectId !== null) lastProjectIdRef.current = projectId;
  }, [detail, isOpen, projectId, turnLogs]);

  const rememberFocus = (event: ReactFocusEvent<HTMLElement>) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const controls = inspectorFocusControls(event.currentTarget);
    const index = controls.indexOf(target);
    if (index !== -1) {
      rememberedFocusRef.current = { element: target, index };
    }
  };

  if (!detail && !loading) return null;

  const project = detail?.project ?? null;
  const latestSession = project?.latestSession ?? null;
  const latestSummary = latestSession?.summary ?? null;

  return (
    <aside
      ref={panelRef}
      className="detail-panel handoff-inspector"
      role="dialog"
      aria-modal="false"
      aria-label={
        project
          ? t("detail.ariaLabel", { project: project.name })
          : t("detail.loadingAria")
      }
      aria-live="polite"
      onFocusCapture={rememberFocus}
    >
      <header className="inspector-identity">
        <button
          type="button"
          className="icon-button inspector-close"
          ref={closeRef}
          aria-label={t("detail.close")}
          aria-keyshortcuts="Escape"
          onClick={onClose}
        >
          <X aria-hidden="true" />
        </button>
        {project ? (
          <>
            <span className="project-avatar" aria-hidden="true">
              {project.name.slice(0, 1).toLocaleUpperCase()}
            </span>
            <div>
              <h2 id="detail-title">{project.name}</h2>
              <p>{project.path}</p>
            </div>
          </>
        ) : (
          <div
            className="detail-title-skeleton"
            aria-label={t("detail.loading")}
          />
        )}
      </header>

      {project && (
        <>
          <div className="inspector-live-strip">
            <StatusBadge status={projectStatus(project)} />
            <span>
              {latestSession
                ? latestSession.tool === "claude-code"
                  ? t("common.claude")
                  : t("common.codex")
                : t("common.noSession")}
            </span>
            <code>{latestSession?.gitBranch ?? t("common.noBranch")}</code>
            <time>{formatRelative(project.lastActivityAt)}</time>
          </div>

          <div className="inspector-scroll">
            <section className="inspector-summary">
              <header>
                <span>{t("detail.progress")}</span>
                <small>
                  {project.summaryState === "ready"
                    ? t("detail.sessionSummary")
                    : project.summaryState === "degraded"
                      ? t("detail.fallbackSummary")
                      : t("detail.awaitingSummary")}
                </small>
              </header>
              {latestSummary ? (
                <SummaryMarkdown
                  key={`latest-summary-${latestSummary.id}`}
                  summary={latestSummary}
                />
              ) : (
                <p>{t("detail.summaryPending")}</p>
              )}
            </section>

            {latestSession && (
              <SessionUsageStrip
                session={latestSession}
                running={project.liveStatus !== null}
              />
            )}

            {latestSummary?.nextSteps[0] && (
              <section className="inspector-next-step">
                <ArrowUpRight aria-hidden="true" />
                <div>
                  <span>{t("detail.nextStep")}</span>
                  <MarkdownContent
                    className="summary-markdown summary-markdown-compact"
                    markdown={latestSummary.nextSteps[0]}
                  />
                </div>
              </section>
            )}

            {latestSummary?.blocked && (
              <section className="inspector-blocker">
                <CircleAlert aria-hidden="true" />
                <div>
                  <span>{t("detail.blocked")}</span>
                  <MarkdownContent
                    className="summary-markdown summary-markdown-compact"
                    markdown={
                      latestSummary.blockedReason ??
                      t("detail.blockedFallback")
                    }
                  />
                </div>
              </section>
            )}

            {latestSummary && (
              <section
                className="inspector-accordions"
                aria-label={t("detail.evidence")}
              >
                <InspectorSection
                  title={t("detail.openItems")}
                  items={latestSummary.openItems}
                  countKey="detail.openItemCount"
                  defaultOpen
                />
                <InspectorSection
                  title={t("detail.decisions")}
                  items={latestSummary.decisions}
                  countKey="detail.decisionCount"
                />
                <InspectorSection
                  title={t("detail.keyFiles")}
                  items={latestSummary.keyFiles}
                  countKey="detail.fileCount"
                  files
                />
              </section>
            )}

            <section
              className="inspector-timeline"
              aria-labelledby="recent-sessions-title"
            >
              <header>
                <h3 id="recent-sessions-title">
                  {t("detail.recentSessions")}
                </h3>
                <span
                  aria-label={t("detail.sessionCount", {
                    count: detail?.sessions.length ?? 0,
                  })}
                >
                  {detail?.sessions.length ?? 0}
                </span>
              </header>
              {detail?.sessions.length === 0 ? (
                <p className="detail-empty">{t("detail.noSessions")}</p>
              ) : (
                <ol>
                  {detail?.sessions.map((session) => (
                    <li key={session.id}>
                      <span className="timeline-node" aria-hidden="true" />
                      <article className="session-entry">
                        <header>
                          <div className="session-entry-identity">
                            <strong>{formatDateTime(session.endedAt)}</strong>
                            <span>
                              {session.gitBranch ?? t("common.noBranch")}
                            </span>
                            <AgentUsageCell
                              session={session}
                              running={
                                project.liveStatus !== null &&
                                session.id === latestSession?.id
                              }
                              variant="recent"
                            />
                          </div>
                          {session.summary &&
                            !session.summary.acknowledged && (
                              <button
                                className="quiet-text-button"
                                type="button"
                                onClick={() =>
                                  onAcknowledge(session.summary!.id)
                                }
                              >
                                <Check aria-hidden="true" />
                                {t("detail.acknowledge")}
                              </button>
                            )}
                        </header>
                        {session.summary ? (
                          <SummaryMarkdown
                            key={`session-summary-${session.summary.id}`}
                            className="session-summary"
                            summary={session.summary}
                          />
                        ) : (
                          <p className="session-summary-state">
                            {t("detail.sessionPending")}
                          </p>
                        )}
                        <TurnLog
                          state={
                            turnLogs.get(session.id) ?? idleTurnLogState()
                          }
                          onLoad={() => onLoadTurnLog(session.id)}
                        />
                      </article>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>

          <footer className="inspector-actions">
            <button
              className="primary-button"
              type="button"
              aria-keyshortcuts="Meta+Enter"
              onClick={() => onCopyRecap(project)}
            >
              <Clipboard aria-hidden="true" />
              {t("detail.copy")}
              <kbd>⌘↩</kbd>
            </button>
            <button
              className="secondary-icon-button"
              type="button"
              aria-label={t("detail.openTerminal")}
              onClick={() => onOpenTerminal(project)}
            >
              <TerminalSquare aria-hidden="true" />
            </button>
            {latestSummary && !latestSummary.acknowledged && (
              <button
                className="secondary-icon-button"
                type="button"
                aria-label={t("detail.markAcknowledged")}
                onClick={() => onAcknowledge(latestSummary.id)}
              >
                <Check aria-hidden="true" />
              </button>
            )}
          </footer>
        </>
      )}
    </aside>
  );
}

interface RememberedInspectorFocus {
  element: HTMLElement;
  index: number;
}

const INSPECTOR_FOCUS_SELECTOR = [
  "button:not(:disabled)",
  "summary",
  "a[href]",
  "input:not(:disabled)",
  "select:not(:disabled)",
  "textarea:not(:disabled)",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function restoreRemovedInspectorFocus(
  panel: HTMLElement | null,
  close: HTMLButtonElement | null,
  remembered: RememberedInspectorFocus | null,
) {
  if (!panel || !remembered || remembered.element.isConnected) return;
  if (document.activeElement && panel.contains(document.activeElement)) return;

  const controls = inspectorFocusControls(panel);
  const nearest = controls[Math.min(remembered.index, controls.length - 1)];
  (nearest ?? close)?.focus();
}

function inspectorFocusControls(panel: HTMLElement): HTMLElement[] {
  const hasLayout = panel.getClientRects().length > 0;
  return Array.from(
    panel.querySelectorAll<HTMLElement>(INSPECTOR_FOCUS_SELECTOR),
  ).filter((control) => {
    if (control.closest('[hidden], [aria-hidden="true"]')) return false;
    return !hasLayout || control.getClientRects().length > 0;
  });
}

function InspectorSection({
  title,
  items,
  countKey,
  files = false,
  defaultOpen = false,
}: {
  title: string;
  items: string[];
  countKey:
    | "detail.openItemCount"
    | "detail.decisionCount"
    | "detail.fileCount";
  files?: boolean;
  defaultOpen?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <details open={defaultOpen}>
      <summary>
        <span>
          {title}
          <small aria-label={t(countKey, { count: items.length })}>
            {items.length}
          </small>
        </span>
        <ChevronDown aria-hidden="true" />
      </summary>
      <DetailList title={title} items={items} files={files} hideTitle />
    </details>
  );
}

function TurnLog({
  state,
  onLoad,
}: {
  state: SessionTurnLogState;
  onLoad(): void;
}) {
  const { t } = useTranslation();
  if (state.status === "idle") {
    return (
      <section className="turn-log" aria-label={t("detail.originalConversation")}>
        <button className="turn-log-load" type="button" onClick={onLoad}>
          {t("detail.viewConversation")}
        </button>
      </section>
    );
  }
  if (state.status === "loading") {
    return (
      <section className="turn-log" aria-label={t("detail.originalConversation")}>
        <p className="turn-log-state" role="status">
          {t("detail.loadingConversation")}
        </p>
      </section>
    );
  }
  if (state.status === "error") {
    return (
      <section className="turn-log" aria-label={t("detail.originalConversation")}>
        <div className="turn-log-error" role="alert">
          <p>{state.error}</p>
          <button type="button" onClick={onLoad}>
            {t("common.retry")}
          </button>
        </div>
      </section>
    );
  }
  const page = state.page;
  if (!page || page.turns.length === 0) {
    return (
      <section className="turn-log" aria-label={t("detail.originalConversation")}>
        <p className="turn-log-state">{t("detail.emptyConversation")}</p>
      </section>
    );
  }

  return (
    <details className="turn-log" aria-label={t("detail.originalConversation")}>
      <summary className="turn-log-summary">
        <ChevronRight className="turn-log-chevron" aria-hidden="true" />
        <span className="turn-log-header">
          <strong>{t("detail.originalConversation")}</strong>
          <span>
            {page.hasEarlier
              ? t("detail.latestTurns", {
                  visible: page.turns.length,
                  total: page.totalTurns,
                  count: page.totalTurns,
                })
              : t("detail.totalTurns", { count: page.totalTurns })}
          </span>
        </span>
      </summary>
      <div className="turn-log-content">
        <div className="turn-log-toolbar">
          <CopyAction
            text={serializeTurnLog(page.turns, t)}
            label={
              page.hasEarlier
                ? t("detail.copyLoadedConversation")
                : t("detail.copyFullConversation")
            }
            scope={
              page.hasEarlier
                ? t("detail.loadedConversationScope", {
                    visible: page.turns.length,
                    total: page.totalTurns,
                  })
                : t("detail.fullConversationScope", {
                    count: page.totalTurns,
                  })
            }
          />
        </div>
        {page.skippedLines > 0 && (
          <p className="turn-log-warning">
            {t("detail.skippedLines", { count: page.skippedLines })}
          </p>
        )}
        <ol className="turn-log-list" start={page.turns[0]?.ordinal}>
          {page.turns.map((turn) => (
            <li key={turn.ordinal}>
              <section
                className="turn-log-prompt-card"
                aria-labelledby={`turn-${page.sessionId}-${turn.ordinal}-prompt`}
              >
                <header>
                  <p
                    className="turn-log-meta"
                    id={`turn-${page.sessionId}-${turn.ordinal}-prompt`}
                  >
                    {turn.timestamp
                      ? `${formatDateTime(turn.timestamp)} · `
                      : ""}
                    {t("detail.userPrompt")}
                  </p>
                  <CopyAction
                    text={turn.userPrompt}
                    label={t("detail.copyPrompt")}
                    scope={t("detail.promptScope", {
                      turn: turn.ordinal,
                    })}
                  />
                </header>
                <MarkdownContent
                  className="turn-log-prompt"
                  markdown={turn.userPrompt}
                />
              </section>
              <details className="turn-response">
                <summary>{t("detail.viewAgentResponse")}</summary>
                <section
                  className="turn-response-card"
                  aria-labelledby={`turn-${page.sessionId}-${turn.ordinal}-response`}
                >
                  <header>
                    <strong
                      id={`turn-${page.sessionId}-${turn.ordinal}-response`}
                    >
                      {t("detail.agentResponse")}
                    </strong>
                    <CopyAction
                      text={turn.assistantResponse ?? ""}
                      label={t("detail.copyAgentResponse")}
                      scope={t("detail.responseScope", {
                        turn: turn.ordinal,
                      })}
                      disabled={turn.assistantResponse === null}
                    />
                  </header>
                  <MarkdownContent
                    markdown={
                      turn.assistantResponse ??
                      t("detail.noAgentResponse")
                    }
                  />
                </section>
              </details>
            </li>
          ))}
        </ol>
      </div>
    </details>
  );
}

type CopyState = "idle" | "copying" | "copied" | "failed";

function CopyAction({
  text,
  label,
  scope,
  disabled = false,
}: {
  text: string;
  label: string;
  scope: string;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const [state, setState] = useState<CopyState>("idle");
  const visibleLabel =
    state === "copying"
      ? t("detail.copying")
      : state === "copied"
        ? t("detail.copied")
        : state === "failed"
          ? t("detail.copyFailedRetry")
          : label;
  const ariaLabel =
    state === "copying"
      ? t("detail.copyingScope", { scope })
      : state === "copied"
        ? t("detail.copiedScope", { scope })
        : state === "failed"
          ? t("detail.retryCopyScope", { scope })
          : t("detail.copyScope", { scope });

  const copy = async () => {
    if (disabled || state === "copying") return;
    setState("copying");
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      setState("failed");
    }
  };

  return (
    <button
      className="turn-copy-button"
      type="button"
      disabled={disabled}
      aria-disabled={disabled || state === "copying"}
      aria-busy={state === "copying"}
      data-copy-state={state}
      aria-label={ariaLabel}
      onClick={() => void copy()}
    >
      <Copy aria-hidden="true" />
      <span aria-live="polite">{visibleLabel}</span>
    </button>
  );
}

function serializeTurnLog(
  turns: Array<{
    ordinal: number;
    userPrompt: string;
    assistantResponse: string | null;
  }>,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  return turns
    .map((turn) => {
      const sections = [
        t("detail.transcriptTurn", { turn: turn.ordinal }),
        `${t("detail.userPrompt")}\n${turn.userPrompt}`,
      ];
      if (turn.assistantResponse !== null) {
        sections.push(
          `${t("detail.agentResponse")}\n${turn.assistantResponse}`,
        );
      }
      return sections.join("\n\n");
    })
    .join("\n\n---\n\n");
}

function DetailList({
  title,
  items,
  files = false,
  hideTitle = false,
}: {
  title: string;
  items: string[];
  files?: boolean;
  hideTitle?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <section className="detail-list">
      {!hideTitle && <h3>{title}</h3>}
      {items.length > 0 ? (
        <ul>
          {items.map((item) => (
            <li key={item}>
              {files ? (
                <>
                  <FileCode2 aria-hidden="true" />
                  <code>{item}</code>
                </>
              ) : (
                <MarkdownContent
                  className="summary-markdown summary-markdown-compact"
                  markdown={item}
                />
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p>{t("detail.emptyItems")}</p>
      )}
    </section>
  );
}
