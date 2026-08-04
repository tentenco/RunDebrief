import {
  ArrowRight,
  CircleAlert,
  FolderSearch,
  ScanSearch,
  ServerCog,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { RuntimeStatus } from "../types";
import { AppMark } from "./AppMark";

export function Onboarding({
  onStart,
  runtimeStatus,
  runtimeBusy,
  runtimeError,
  indexError,
  onInstallDaemon,
  onRetryRuntime,
}: {
  onStart(): void | Promise<void>;
  runtimeStatus: RuntimeStatus | null;
  runtimeBusy: boolean;
  runtimeError: string | null;
  indexError: string | null;
  onInstallDaemon(): void | Promise<void>;
  onRetryRuntime(): void | Promise<void>;
}) {
  const { t } = useTranslation();
  return (
    <main className="experience-screen" aria-labelledby="onboarding-title">
      <div className="experience-card onboarding-card">
        <AppMark />
        <p className="eyebrow">{t("experience.welcome")}</p>
        <h1 id="onboarding-title">{t("experience.headline")}</h1>
        <p className="experience-copy">
          {t("experience.descriptionBeforeClaude")}
          <code>~/.claude</code>
          {t("experience.descriptionBetween")}
          <code>~/.codex</code>
          {t("experience.descriptionAfterCodex")}
        </p>
        <div className="privacy-callout">
          <FolderSearch aria-hidden="true" />
          <div>
            <strong>{t("experience.localTitle")}</strong>
            <span>{t("experience.localDescription")}</span>
          </div>
        </div>
        <RuntimeSetup
          status={runtimeStatus}
          busy={runtimeBusy}
          error={runtimeError}
          onInstall={onInstallDaemon}
          onRetry={onRetryRuntime}
        />
        {indexError && (
          <p className="setup-error" role="alert">
            <CircleAlert aria-hidden="true" />
            {indexError}
          </p>
        )}
        <button
          className="primary-button"
          type="button"
          onClick={() => void onStart()}
        >
          {t("experience.readIndex")}
          <ArrowRight aria-hidden="true" />
        </button>
      </div>
    </main>
  );
}

export function ScanProgress() {
  const { t } = useTranslation();
  return (
    <main
      className="experience-screen"
      aria-labelledby="scan-title"
      aria-busy="true"
    >
      <div className="experience-card scan-card">
        <span className="scan-orbit" aria-hidden="true">
          <ScanSearch />
        </span>
        <p className="eyebrow">{t("experience.loadingEyebrow")}</p>
        <h1 id="scan-title">{t("experience.loadingTitle")}</h1>
        <p className="experience-copy" aria-live="polite">
          {t("experience.loadingDescription")}
        </p>
        <div
          className="scan-progress"
          role="progressbar"
          aria-label={t("experience.loadingAria")}
        >
          <span />
        </div>
      </div>
    </main>
  );
}

export function RuntimeSetup({
  status,
  busy,
  error,
  compact = false,
  onInstall,
  onRetry,
}: {
  status: RuntimeStatus | null;
  busy: boolean;
  error: string | null;
  compact?: boolean;
  onInstall(): void | Promise<void>;
  onRetry(): void | Promise<void>;
}) {
  const { t } = useTranslation();
  const title = runtimeTitle(status, t);
  const description = runtimeDescription(status, t);
  const needsService = Boolean(
    status && (!status.daemon.running || !status.databaseExists),
  );
  const summaryConfigured = Boolean(
    status?.config.gatewayConfigured &&
      status.config.summaryModelConfigured,
  );

  return (
    <section
      className={`runtime-setup${compact ? " runtime-setup-compact" : ""}`}
      aria-labelledby={compact ? "runtime-status-title" : "setup-title"}
    >
      <ServerCog aria-hidden="true" />
      <div className="runtime-setup-content">
        <h2 id={compact ? "runtime-status-title" : "setup-title"}>{title}</h2>
        <p>{description}</p>
        {status && (
          <div className="runtime-facts" aria-label={t("runtime.ariaLabel")}>
            <span>
              {t("runtime.launchAgent", {
                state: status.daemon.running
                  ? t("runtime.running")
                  : t("runtime.notRunning"),
              })}
            </span>
            <span>
              {t("runtime.localIndex", {
                state: status.databaseExists
                  ? t("runtime.available")
                  : t("runtime.missing"),
              })}
            </span>
            <span>
              {t("runtime.summaryConfig", {
                state: summaryConfigured
                  ? t("runtime.configured")
                  : t("runtime.incomplete"),
              })}
            </span>
          </div>
        )}
        {error && (
          <p className="setup-error" role="alert">
            <CircleAlert aria-hidden="true" />
            {error}
          </p>
        )}
        <div className="runtime-actions">
          {needsService && (
            <button
              className="primary-button"
              type="button"
              disabled={busy}
              onClick={() => void onInstall()}
            >
              <ServerCog aria-hidden="true" />
              {status?.daemon.installed
                ? t("runtime.restartService")
                : t("runtime.installService")}
            </button>
          )}
          {!needsService && error && (
            <button
              className="primary-button"
              type="button"
              disabled={busy}
              onClick={() => void onRetry()}
            >
              <ServerCog aria-hidden="true" />
              {t("runtime.retryStatus")}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

type Translate = ReturnType<typeof useTranslation>["t"];

function runtimeTitle(status: RuntimeStatus | null, t: Translate): string {
  if (!status) return t("runtime.checkingTitle");
  if (!status.daemon.installed) return t("runtime.notInstalledTitle");
  if (!status.daemon.running) return t("runtime.notRunningTitle");
  if (!status.databaseExists) return t("runtime.indexMissingTitle");
  if (
    !status.config.gatewayConfigured ||
    !status.config.summaryModelConfigured
  ) {
    return t("runtime.fallbackTitle");
  }
  return t("runtime.runningTitle");
}

function runtimeDescription(
  status: RuntimeStatus | null,
  t: Translate,
): string {
  if (!status) return t("runtime.checkingDescription");
  if (!status.daemon.installed) {
    return t("runtime.notInstalledDescription");
  }
  if (!status.daemon.running) {
    return t("runtime.notRunningDescription");
  }
  if (!status.databaseExists) return t("runtime.indexMissingDescription");
  if (!status.config.gatewayConfigured) {
    return t("runtime.gatewayFallbackDescription");
  }
  if (!status.config.summaryModelConfigured) {
    return t("runtime.modelFallbackDescription");
  }
  return t("runtime.runningDescription");
}

export function EmptyProjects() {
  const { t } = useTranslation();
  return (
    <div className="state-screen empty-projects">
      <svg
        className="empty-illustration"
        viewBox="0 0 240 152"
        role="img"
        aria-label={t("experience.emptyImage")}
      >
        <path className="empty-window" d="M30 24h180v104H30z" />
        <path className="empty-sidebar" d="M30 24h50v104H30z" />
        <path className="empty-card" d="M96 48h86v54H96z" />
        <path className="empty-line" d="M109 64h47M109 76h59M109 88h36" />
        <circle className="empty-dot" cx="103" cy="64" r="3" />
      </svg>
      <p className="eyebrow">{t("experience.emptyEyebrow")}</p>
      <h2>{t("experience.emptyTitle")}</h2>
      <p>{t("experience.emptyDescription")}</p>
    </div>
  );
}
