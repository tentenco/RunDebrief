import { describe, expect, it } from "vitest";
import { projectFixture } from "../test/fixtures";
import { buildRecap } from "./recap";

describe("buildRecap", () => {
  it("renders the exact DESIGN section order and continuation guard", () => {
    const recap = buildRecap(projectFixture());

    expect(recap).toContain("# Recap — debrief (Internal)");
    expect(recap.indexOf("## State")).toBeLessThan(
      recap.indexOf("## Decisions made"),
    );
    expect(recap.indexOf("## Decisions made")).toBeLessThan(
      recap.indexOf("## Open items"),
    );
    expect(recap).toContain("- packages/app/src/App.tsx");
    expect(recap).toContain(
      "Continue from here. Verify the open items above before starting new work.",
    );
  });

  it("exports only the latest assistant outcome from a polluted rules fallback", () => {
    const project = projectFixture();
    project.latestSession!.summary = {
      ...project.latestSession!.summary!,
      model: "rules-fallback",
      stateSummary: [
        "Git phase-4/runtime-fix; dirty; last commit test: fixture",
        "developer: Do not expose this internal envelope.",
        "<environment_context><cwd>/private/worktree</cwd></environment_context>",
        "user: Continue.",
        "assistant: ## Verified outcome",
        "",
        "Preserve the real Agent result and fenced code.",
        "",
        "```ts",
        "const ready = true;",
        "```",
        "",
        "<oai-mem-citation>",
        "<citation_entries>transport only</citation_entries>",
        "</oai-mem-citation>",
      ].join("\n"),
    };

    const recap = buildRecap(project);

    expect(recap).toContain("## Verified outcome");
    expect(recap).toContain("```ts\nconst ready = true;\n```");
    expect(recap).not.toContain("developer:");
    expect(recap).not.toContain("<environment_context>");
    expect(recap).not.toContain("<oai-mem-citation>");
    expect(recap).not.toContain("user: Continue.");
  });

  it("uses a readable recap fallback when no assistant outcome remains", () => {
    const project = projectFixture();
    project.latestSession!.summary = {
      ...project.latestSession!.summary!,
      model: "rules-fallback",
      stateSummary: [
        "developer: Internal envelope.",
        "user: Continue.",
        "assistant:",
        "<oai-mem-citation>transport</oai-mem-citation>",
      ].join("\n"),
    };

    const recap = buildRecap(project);

    expect(recap).toContain(
      "Structured summary unavailable. Review the original conversation.",
    );
    expect(recap).not.toContain("Internal envelope");
  });

  it("keeps gateway summary text verbatim", () => {
    const project = projectFixture();
    const gatewaySummary = [
      "developer: Agent-authored gateway example",
      "<oai-mem-citation>verbatim gateway text</oai-mem-citation>",
      "```bash",
      "pnpm test",
      "```",
    ].join("\n");
    project.latestSession!.summary = {
      ...project.latestSession!.summary!,
      model: "deepseek-chat",
      stateSummary: gatewaySummary,
    };

    expect(buildRecap(project)).toContain(gatewaySummary);
  });
});
