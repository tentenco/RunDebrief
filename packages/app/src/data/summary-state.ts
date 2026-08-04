import type { Summary, SummaryState } from "../types";

export function classifySummaryState(
  summary: Summary | null,
): SummaryState {
  if (!summary) return "awaiting-summary";
  return summary.model === "rules-fallback" ? "degraded" : "ready";
}
