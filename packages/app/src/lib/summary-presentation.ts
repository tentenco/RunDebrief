import type { Summary } from "../types";

export const SUMMARY_PREVIEW_MAX_CHARACTERS = 420;
export const SUMMARY_PREVIEW_MAX_LINES = 8;

const completeMemoryCitation =
  /<oai-mem-citation>[\s\S]*?<\/oai-mem-citation>/gi;
const trailingMemoryCitation =
  /(?:^|\n)[\t ]*<oai-mem-citation>[\s\S]*$/i;
const roleMarker =
  /^[\t ]*(developer|system|user|assistant)\s*:\s*/gim;
const legacyGitDigestPrefix =
  /^(?:Git metadata unavailable|Git [^\n]*;\s*(?:dirty|clean);\s*last commit [^\n]*)(?:\n|$)/i;

export function presentSummaryState(
  summary: Pick<Summary, "model" | "stateSummary">,
): string | null {
  if (summary.model !== "rules-fallback") {
    return summary.stateSummary;
  }

  const withoutCitations = stripMemoryCitations(summary.stateSummary);
  const markers = [...withoutCitations.matchAll(roleMarker)];
  const roles = new Set(
    markers.map((marker) => marker[1]?.toLocaleLowerCase()),
  );
  const hasStrongLegacySignature =
    roles.has("assistant") &&
    ([...roles].some(
      (role) =>
        role === "developer" || role === "system" || role === "user",
    ) ||
      legacyGitDigestPrefix.test(withoutCitations));

  if (hasStrongLegacySignature) {
    let latestAssistant: string | null = null;
    markers.forEach((marker, index) => {
      if (marker[1]?.toLocaleLowerCase() !== "assistant") return;
      const start = (marker.index ?? 0) + marker[0].length;
      const end = markers[index + 1]?.index ?? withoutCitations.length;
      const candidate = stripMemoryCitations(
        withoutCitations.slice(start, end),
      ).trim();
      if (candidate) latestAssistant = candidate;
    });
    return latestAssistant;
  }

  const candidate = withoutCitations.trim();
  return candidate || null;
}

export function shouldCollapseSummary(markdown: string): boolean {
  return (
    Array.from(markdown).length > SUMMARY_PREVIEW_MAX_CHARACTERS ||
    markdown.split(/\r?\n/).length > SUMMARY_PREVIEW_MAX_LINES
  );
}

function stripMemoryCitations(value: string): string {
  return value
    .replace(completeMemoryCitation, "")
    .replace(trailingMemoryCitation, "");
}
