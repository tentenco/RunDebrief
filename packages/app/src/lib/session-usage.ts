import type { TFunction } from "i18next";
import type { AgentTool, Session } from "../types";

const UNAVAILABLE = "—";

export function formatCompactTokens(
  value: number | null,
  locale: string,
): string {
  if (value === null) return UNAVAILABLE;
  return new Intl.NumberFormat(locale, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

export function formatExactTokens(
  value: number | null,
  locale: string,
): string {
  if (value === null) return UNAVAILABLE;
  return new Intl.NumberFormat(locale).format(value);
}

export function usageProviderLabel(
  provider: AgentTool,
  t: TFunction,
): string {
  return provider === "claude-code"
    ? t("usage.providerClaude")
    : t("usage.providerOpenAI");
}

export function usageScopeLabel(
  session: Session,
  running: boolean,
  t: TFunction,
): string {
  if (!session.usage) return t("usage.unavailable");
  const labels: string[] = [];
  if (running) labels.push(t("usage.soFar"));
  if (session.usage.coverage === "partial") {
    labels.push(t("usage.sinceIndexing"));
  }
  return labels.length > 0
    ? labels.join(` ${t("usage.separator")} `)
    : t("usage.wholeSession");
}

export function sessionUsageDescription(
  session: Session | null,
  running: boolean,
  t: TFunction,
  locale: string,
): string {
  if (!session) return t("usage.sessionUnavailable");
  const usage = session.usage;
  const provider = usageProviderLabel(usage?.provider ?? session.tool, t);
  const model = usage?.model ?? t("usage.unavailable");
  const total =
    usage?.totalTokens == null
      ? t("usage.unavailable")
      : t("usage.tokenValue", {
          value: formatExactTokens(usage.totalTokens, locale),
        });
  return t("usage.accessibleSummary", {
    provider,
    model,
    total,
    scope: usageScopeLabel(session, running, t),
  });
}

export function unavailableMark(): string {
  return UNAVAILABLE;
}
