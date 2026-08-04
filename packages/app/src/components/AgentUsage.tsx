import { useTranslation } from "react-i18next";
import {
  formatCompactTokens,
  formatExactTokens,
  sessionUsageDescription,
  unavailableMark,
  usageProviderLabel,
  usageScopeLabel,
} from "../lib/session-usage";
import type { Session } from "../types";

export function AgentUsageCell({
  session,
  running,
  variant,
}: {
  session: Session | null;
  running: boolean;
  variant: "row" | "recent";
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const usage = session?.usage ?? null;
  const provider = session
    ? usageProviderLabel(usage?.provider ?? session.tool, t)
    : unavailableMark();
  const model = usage?.model ?? unavailableMark();
  const total = formatCompactTokens(usage?.totalTokens ?? null, locale);
  const description = sessionUsageDescription(
    session,
    running,
    t,
    locale,
  );
  const scope = session
    ? usageScopeLabel(session, running, t)
    : t("usage.unavailable");

  return (
    <span
      className={`agent-usage agent-usage-${variant}`}
      data-usage-state={
        usage
          ? usage.coverage === "partial"
            ? "partial"
            : running
              ? "live"
              : "complete"
          : "missing"
      }
      title={description}
      aria-label={description}
    >
      <span className="agent-usage-identity">
        <span>{provider}</span>
        <span aria-hidden="true">{t("usage.separator")}</span>
        <code title={usage?.model ?? t("usage.modelUnavailable")}>
          {model}
        </code>
      </span>
      <span className="agent-usage-total">
        <strong>{total}</strong>
        <small>
          {t("usage.tokens")} {t("usage.separator")} {scope}
        </small>
      </span>
    </span>
  );
}

export function SessionUsageStrip({
  session,
  running,
}: {
  session: Session;
  running: boolean;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const usage = session.usage;
  const provider = usageProviderLabel(usage?.provider ?? session.tool, t);
  const model = usage?.model ?? unavailableMark();
  const scope = usageScopeLabel(session, running, t);
  const description = sessionUsageDescription(
    session,
    running,
    t,
    locale,
  );
  const showReasoning =
    usage?.provider === "codex" &&
    usage.reasoningOutputTokens !== null;

  return (
    <section
      className="inspector-usage"
      aria-labelledby="latest-session-usage-title"
    >
      <header>
        <div>
          <h3 id="latest-session-usage-title">{t("usage.agentUsage")}</h3>
          <span>{provider}</span>
          <span aria-hidden="true">{t("usage.separator")}</span>
          <code title={usage?.model ?? t("usage.modelUnavailable")}>
            {model}
          </code>
        </div>
        <small title={description}>
          {t("usage.latestModel")} {t("usage.separator")} {scope}
        </small>
      </header>
      <div className="usage-metrics">
        <UsageMetric
          label={t("usage.total")}
          value={usage?.totalTokens ?? null}
          locale={locale}
        />
        <UsageMetric
          label={t("usage.input")}
          value={usage?.inputTokens ?? null}
          locale={locale}
        />
        <UsageMetric
          label={t("usage.output")}
          value={usage?.outputTokens ?? null}
          locale={locale}
        />
        <CacheMetric
          read={usage?.cacheReadInputTokens ?? null}
          creation={usage?.cacheCreationInputTokens ?? null}
          locale={locale}
        />
        {showReasoning && (
          <UsageMetric
            label={t("usage.reasoning")}
            value={usage.reasoningOutputTokens}
            locale={locale}
          />
        )}
      </div>
    </section>
  );
}

function UsageMetric({
  label,
  value,
  locale,
}: {
  label: string;
  value: number | null;
  locale: string;
}) {
  const { t } = useTranslation();
  const exact =
    value === null
      ? t("usage.metricUnavailable", { label })
      : t("usage.metricExact", {
          label,
          value: formatExactTokens(value, locale),
        });
  return (
    <div className="usage-metric" title={exact} aria-label={exact}>
      <small>{label}</small>
      <strong>{formatCompactTokens(value, locale)}</strong>
    </div>
  );
}

function CacheMetric({
  read,
  creation,
  locale,
}: {
  read: number | null;
  creation: number | null;
  locale: string;
}) {
  const { t } = useTranslation();
  const unavailable = read === null && creation === null;
  const exact = unavailable
    ? t("usage.metricUnavailable", { label: t("usage.cache") })
    : t("usage.cacheExact", {
        read:
          read === null
            ? t("usage.unavailable")
            : formatExactTokens(read, locale),
        creation:
          creation === null
            ? t("usage.unavailable")
            : formatExactTokens(creation, locale),
      });
  return (
    <div className="usage-metric usage-metric-cache" title={exact} aria-label={exact}>
      <small>{t("usage.cache")}</small>
      {unavailable ? (
        <strong>{unavailableMark()}</strong>
      ) : (
        <span>
          <b>{t("usage.cacheReadShort")}</b>{" "}
          {formatCompactTokens(read, locale)}
          <b>{t("usage.cacheCreationShort")}</b>{" "}
          {formatCompactTokens(creation, locale)}
        </span>
      )}
    </div>
  );
}
