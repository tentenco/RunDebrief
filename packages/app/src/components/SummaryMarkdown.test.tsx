// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Summary } from "../types";
import { SummaryMarkdown } from "./SummaryMarkdown";

function summary(stateSummary: string, model = "deepseek-chat"): Summary {
  return {
    id: 20,
    sessionId: 10,
    generatedAt: "2026-07-31T09:00:00.000Z",
    model,
    stateSummary,
    openItems: [],
    nextSteps: [],
    decisions: [],
    keyFiles: [],
    blocked: false,
    blockedReason: null,
    acknowledged: false,
  };
}

describe("SummaryMarkdown", () => {
  it("keeps the full long summary available while toggling its visual preview", () => {
    const finalLine = "Final evidence remains in the full Markdown DOM.";
    const markdown = [
      "## Outcome",
      "",
      "A".repeat(430),
      "",
      finalLine,
    ].join("\n");
    render(<SummaryMarkdown summary={summary(markdown)} />);

    const toggle = screen.getByRole("button", { name: "顯示更多" });
    const preview = document.getElementById(
      toggle.getAttribute("aria-controls") ?? "",
    );
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(preview).toHaveClass("is-collapsed");
    expect(screen.getByText(finalLine)).toBeInTheDocument();

    toggle.focus();
    fireEvent.keyDown(toggle, { key: "Enter" });
    fireEvent.click(toggle);

    expect(toggle).toHaveFocus();
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveTextContent("顯示較少");
    expect(preview).not.toHaveClass("is-collapsed");
  });

  it("enables code actions only after a long summary is expanded", async () => {
    const code = ["const exact = {", "  ready: true,", "};", ""].join("\n");
    const markdown = [
      "## Verified result",
      "",
      "A".repeat(430),
      "",
      "```ts",
      code,
      "```",
    ].join("\n");
    render(<SummaryMarkdown summary={summary(markdown)} />);

    const toggle = screen.getByRole("button", { name: "顯示更多" });
    expect(
      screen.queryByRole("button", { name: "複製程式碼" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("ts")).toBeInTheDocument();

    fireEvent.click(toggle);
    const copy = screen.getByRole("button", { name: "複製程式碼" });
    copy.focus();
    fireEvent.click(copy);
    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(code),
    );

    fireEvent.click(toggle);
    expect(toggle).toHaveFocus();
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByRole("button", { name: /複製程式碼|已複製/ }),
    ).not.toBeInTheDocument();
  });

  it("keeps copy enabled for a short fenced-code summary", () => {
    render(
      <SummaryMarkdown
        summary={summary("```bash\npnpm test\n```")}
      />,
    );

    expect(screen.queryByText("顯示更多")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "複製程式碼" }),
    ).toBeInTheDocument();
    expect(screen.getByText("bash")).toBeInTheDocument();
  });

  it("shows localized unavailable copy when legacy pollution has no outcome", () => {
    render(
      <SummaryMarkdown
        summary={summary(
          [
            "developer: Internal scaffold.",
            "user: Continue.",
            "assistant:",
            "<oai-mem-citation>transport</oai-mem-citation>",
          ].join("\n"),
          "rules-fallback",
        )}
      />,
    );

    expect(
      screen.getByText("無法取得結構化摘要；請查看原始對話。"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Internal scaffold/)).not.toBeInTheDocument();
  });
});
