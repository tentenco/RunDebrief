import type { Project } from "../types";
import { presentSummaryState } from "./summary-presentation";

export function buildRecap(project: Project): string {
  const session = project.latestSession;
  const summary = session?.summary;
  const stateSummary = summary
    ? presentSummaryState(summary) ??
      "Structured summary unavailable. Review the original conversation."
    : "The local index is available; the final summary is still pending.";
  const list = (items: string[] | undefined) =>
    items?.length ? items.map((item) => `- ${item}`).join("\n") : "- None";

  return `# Recap — ${project.name} (${project.client ?? "Internal"})
Last session: ${session?.endedAt ?? "Unknown"} · ${session?.tool ?? "Unknown"} · branch ${session?.gitBranch ?? "Unknown"}

## State
${stateSummary}

## Decisions made
${list(summary?.decisions)}

## Open items
${list(summary?.openItems)}

## Suggested next steps
${list(summary?.nextSteps)}

## Key files
${list(summary?.keyFiles)}

Continue from here. Verify the open items above before starting new work.`;
}
