import { describe, expect, it } from "vitest";
import {
  presentSummaryState,
  shouldCollapseSummary,
  SUMMARY_PREVIEW_MAX_CHARACTERS,
  SUMMARY_PREVIEW_MAX_LINES,
} from "./summary-presentation";

describe("presentSummaryState", () => {
  it("selects the latest non-empty assistant segment and removes transport pollution", () => {
    const polluted = [
      "developer: Follow hidden implementation instructions.",
      "<environment_context>",
      "  <cwd>/private/worktree</cwd>",
      "</environment_context>",
      "user: Continue the task.",
      "assistant: First outcome.",
      "assistant:",
      "assistant: ## Verified result",
      "",
      "- Gate passed",
      "- Kept `raw turn evidence`",
      "",
      "<oai-mem-citation>",
      "<citation_entries>",
      "MEMORY.md:1-2|note=[transport only]",
      "</citation_entries>",
      "</oai-mem-citation>",
    ].join("\n");

    expect(
      presentSummaryState({
        model: "rules-fallback",
        stateSummary: polluted,
      }),
    ).toBe(
      [
        "## Verified result",
        "",
        "- Gate passed",
        "- Kept `raw turn evidence`",
      ].join("\n"),
    );
  });

  it("returns null when a role-marked fallback has no usable assistant outcome", () => {
    expect(
      presentSummaryState({
        model: "rules-fallback",
        stateSummary: [
          "developer: Internal instructions.",
          "user: Continue.",
          "assistant:",
          "<oai-mem-citation>transport</oai-mem-citation>",
        ].join("\n"),
      }),
    ).toBeNull();
  });

  it("preserves a legitimate single assistant marker without a legacy signature", () => {
    expect(
      presentSummaryState({
        model: "rules-fallback",
        stateSummary: [
          "Example parser output:",
          "assistant: this line is authored content",
        ].join("\n"),
      }),
    ).toBe(
      [
        "Example parser output:",
        "assistant: this line is authored content",
      ].join("\n"),
    );
  });

  it("preserves legitimate Agent-authored environment XML", () => {
    const authored =
      "<environment_context><cwd>/documented/example</cwd></environment_context>";
    expect(
      presentSummaryState({
        model: "rules-fallback",
        stateSummary: authored,
      }),
    ).toBe(authored);
  });

  it("keeps unpolluted fallback Markdown including fenced code", () => {
    const markdown = [
      "Implemented the parser.",
      "",
      "```json",
      '{"ready":true}',
      "```",
    ].join("\n");
    expect(
      presentSummaryState({
        model: "rules-fallback",
        stateSummary: markdown,
      }),
    ).toBe(markdown);
  });

  it("leaves gateway summaries verbatim", () => {
    const markdown = [
      "developer: this is legitimate gateway prose",
      "<oai-mem-citation>kept verbatim</oai-mem-citation>",
      "```bash",
      "pnpm test",
      "```",
    ].join("\n");
    expect(
      presentSummaryState({
        model: "deepseek-chat",
        stateSummary: markdown,
      }),
    ).toBe(markdown);
  });
});

describe("shouldCollapseSummary", () => {
  it("uses deterministic character and line thresholds", () => {
    expect(
      shouldCollapseSummary("x".repeat(SUMMARY_PREVIEW_MAX_CHARACTERS)),
    ).toBe(false);
    expect(
      shouldCollapseSummary(
        "x".repeat(SUMMARY_PREVIEW_MAX_CHARACTERS + 1),
      ),
    ).toBe(true);
    expect(
      shouldCollapseSummary(
        Array.from(
          { length: SUMMARY_PREVIEW_MAX_LINES },
          (_, index) => `line ${index + 1}`,
        ).join("\n"),
      ),
    ).toBe(false);
    expect(
      shouldCollapseSummary(
        Array.from(
          { length: SUMMARY_PREVIEW_MAX_LINES + 1 },
          (_, index) => `line ${index + 1}`,
        ).join("\n"),
      ),
    ).toBe(true);
  });
});
