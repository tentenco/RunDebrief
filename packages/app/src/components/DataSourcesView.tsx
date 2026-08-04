import {
  Activity,
  Bot,
  Braces,
  CheckCircle2,
  CircleAlert,
  Database,
  Route,
  ServerCog,
  Settings,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { formatDateTime } from "../lib/time";
import type { Project, RuntimeStatus } from "../types";

interface DataSourcesViewProps {
  projects: Project[];
  loadedAt: string | null;
  runtimeStatus: RuntimeStatus | null;
  serviceError: string | null;
  privacyError: string | null;
  runtimeBusy: boolean;
  onInstallDaemon(): void;
  onRetryStatus(): void;
  onOpenPrivacySecurity(): void;
}

type SourceState = "ready" | "attention" | "limited" | "checking";

interface SourceFact {
  id: string;
  label: string;
  detail: string;
  evidence: string;
  state: SourceState;
  icon: React.ReactNode;
}

export function DataSourcesView({
  projects,
  loadedAt,
  runtimeStatus,
  serviceError,
  privacyError,
  runtimeBusy,
  onInstallDaemon,
  onRetryStatus,
  onOpenPrivacySecurity,
}: DataSourcesViewProps) {
  const { t } = useTranslation();
  const claudeProjects = projects.filter(
    (project) => project.latestSession?.tool === "claude-code",
  ).length;
  const codexProjects = projects.filter(
    (project) => project.latestSession?.tool === "codex",
  ).length;
  const liveProjects = projects.filter((project) => project.liveStatus).length;
  const daemonReady = Boolean(runtimeStatus?.daemon.running);
  const needsService = Boolean(
    runtimeStatus &&
      (!runtimeStatus.daemon.running || !runtimeStatus.databaseExists),
  );
  const routingReady = Boolean(
    runtimeStatus?.config.gatewayConfigured &&
      runtimeStatus.config.summaryModelConfigured,
  );

  const sources: SourceFact[] = [
    {
      id: "index",
      label: t("sources.indexLabel"),
      detail: runtimeStatus?.databaseExists
        ? t("sources.indexLoaded", { count: projects.length })
        : t("sources.indexMissing"),
      evidence: loadedAt
        ? t("sources.snapshot", { time: formatDateTime(loadedAt) })
        : t("sources.snapshotMissing"),
      state: runtimeStatus
        ? runtimeStatus.databaseExists
          ? "ready"
          : "attention"
        : "checking",
      icon: <Database />,
    },
    {
      id: "claude",
      label: t("sources.claudeLabel"),
      detail: t("sources.claudeDetail", { count: claudeProjects }),
      evidence: t("sources.claudeEvidence"),
      state: serviceError ? "attention" : "ready",
      icon: <Bot />,
    },
    {
      id: "codex",
      label: t("sources.codexLabel"),
      detail: t("sources.codexDetail", { count: codexProjects }),
      evidence: t("sources.codexEvidence"),
      state: serviceError ? "attention" : "ready",
      icon: <Braces />,
    },
    {
      id: "daemon",
      label: t("sources.daemonLabel"),
      detail: daemonLabel(runtimeStatus, t),
      evidence: daemonEvidence(runtimeStatus, t),
      state: runtimeStatus
        ? daemonReady
          ? "ready"
          : "attention"
        : "checking",
      icon: <ServerCog />,
    },
    {
      id: "routing",
      label: t("sources.routingLabel"),
      detail: routingReady
        ? t("sources.routingReady")
        : t("sources.routingFallback"),
      evidence: runtimeStatus?.config.exists
        ? t("sources.configExists")
        : t("sources.configMissing"),
      state: runtimeStatus
        ? routingReady
          ? "ready"
          : "limited"
        : "checking",
      icon: <Route />,
    },
    {
      id: "live",
      label: t("sources.liveLabel"),
      detail: t("sources.liveDetail", { count: liveProjects }),
      evidence:
        liveProjects > 0
          ? liveToolEvidence(projects)
          : t("sources.noLiveEvidence"),
      state: "ready",
      icon: <Activity />,
    },
    {
      id: "claude-mem",
      label: t("sources.enrichmentLabel"),
      detail: t("sources.enrichmentDetail"),
      evidence: t("sources.enrichmentEvidence"),
      state: "limited",
      icon: <Sparkles />,
    },
  ];

  return (
    <div className="sources-content">
      <section className="sources-privacy">
        <span aria-hidden="true">
          <ShieldCheck />
        </span>
        <div>
          <strong>{t("sources.localFirstTitle")}</strong>
          <p>{t("sources.localFirstDescription")}</p>
        </div>
      </section>

      {serviceError && (
        <p className="sources-error" role="alert">
          <CircleAlert aria-hidden="true" />
          {serviceError}
        </p>
      )}

      <section className="source-list-card" aria-labelledby="sources-list-title">
        <header>
          <div>
            <h2 id="sources-list-title">{t("sources.listTitle")}</h2>
            <p>{t("sources.listDescription")}</p>
          </div>
          <span>
            {t("sources.readyCount", {
              count: sources.filter((source) => source.state === "ready")
                .length,
            })}
          </span>
        </header>
        <div className="source-list">
          {sources.map((source) => (
            <article className="source-row" key={source.id}>
              <span
                className="source-row-icon"
                data-state={source.state}
                aria-hidden="true"
              >
                {source.icon}
              </span>
              <div className="source-row-primary">
                <strong>{source.label}</strong>
                <span>{source.evidence}</span>
              </div>
              <p>{source.detail}</p>
              <SourceBadge state={source.state} />
            </article>
          ))}
        </div>
      </section>

      <section className="source-recovery-grid">
        <article>
          <ServerCog aria-hidden="true" />
          <div>
            <strong>{t("sources.serviceTitle")}</strong>
            <p>
              {!needsService
                ? t("sources.serviceReady")
                : t("sources.serviceRecovery")}
            </p>
          </div>
          {(needsService || serviceError) && (
            <button
              type="button"
              disabled={runtimeBusy}
              onClick={needsService ? onInstallDaemon : onRetryStatus}
            >
              {needsService
                ? runtimeStatus?.daemon.installed
                  ? t("common.restart")
                  : t("common.installAndStart")
                : t("runtime.retryStatus")}
            </button>
          )}
        </article>
        <article>
          <Settings aria-hidden="true" />
          <div>
            <strong>{t("sources.privacyTitle")}</strong>
            <p>{t("sources.privacyDescription")}</p>
            {privacyError && (
              <p className="settings-error" role="alert">
                <CircleAlert aria-hidden="true" />
                {privacyError}
              </p>
            )}
          </div>
          <button
            type="button"
            disabled={runtimeBusy}
            onClick={onOpenPrivacySecurity}
          >
            {t("common.openSettings")}
          </button>
        </article>
      </section>
    </div>
  );
}

function SourceBadge({ state }: { state: SourceState }) {
  const { t } = useTranslation();
  const label =
    state === "ready"
      ? t("common.ready")
      : state === "attention"
        ? t("common.needsAttention")
        : state === "limited"
          ? t("common.optional")
          : t("common.checking");
  return (
    <span className="source-badge" data-state={state}>
      {state === "ready" ? (
        <CheckCircle2 aria-hidden="true" />
      ) : (
        <CircleAlert aria-hidden="true" />
      )}
      {label}
    </span>
  );
}

function daemonLabel(
  status: RuntimeStatus | null,
  t: TFunction,
): string {
  if (!status) return t("sources.daemonChecking");
  if (!status.daemon.installed) return t("sources.daemonNotInstalled");
  if (!status.daemon.running) return t("sources.daemonStopped");
  return t("sources.daemonRunning", {
    pid: status.daemon.pid ? ` · PID ${status.daemon.pid}` : "",
  });
}

function daemonEvidence(
  status: RuntimeStatus | null,
  t: TFunction,
): string {
  if (!status) return "com.tenten.debrief-daemon";
  const version =
    status.daemon.runtimeVersion ?? t("sources.versionUnavailable");
  return `${status.daemon.label} · ${version}`;
}

function liveToolEvidence(projects: Project[]): string {
  const claude = projects.filter(
    (project) => project.liveStatus?.tool === "claude-code",
  ).length;
  const codex = projects.filter(
    (project) => project.liveStatus?.tool === "codex",
  ).length;
  return `Claude ${claude} · Codex ${codex}`;
}
