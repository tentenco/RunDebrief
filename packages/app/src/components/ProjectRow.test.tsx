// @vitest-environment jsdom

import {
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { projectFixture, usageFixture } from "../test/fixtures";
import type { Project } from "../types";
import { ProjectRow } from "./ProjectRow";

const applications: ComponentProps<typeof ProjectRow>["applications"] = {
  visualStudioCode: true,
  warp: true,
  editor: {
    kind: "visual-studio-code",
    name: "Visual Studio Code",
    available: true,
  },
};

function renderRow(
  project: Project,
  overrides: Partial<ComponentProps<typeof ProjectRow>> = {},
) {
  return render(
    <ProjectRow
      project={project}
      busy={false}
      rowIndex={0}
      active
      selected={false}
      applications={applications}
      onOpen={vi.fn()}
      onFocus={vi.fn()}
      onNavigate={vi.fn()}
      onTerminal={vi.fn()}
      onEditor={vi.fn()}
      onVisualStudioCode={vi.fn()}
      onWarp={vi.fn()}
      onCopyRecap={vi.fn()}
      onAcknowledge={vi.fn()}
      onUpdate={vi.fn()}
      {...overrides}
    />,
  );
}

function projectWithUsage(
  usage: ReturnType<typeof usageFixture> | null,
  live = false,
) {
  const project = projectFixture();
  return {
    ...project,
    liveStatus: live
      ? {
          pid: 77,
          tool: "codex" as const,
          tmuxTarget: null,
          detectedAt: "2026-07-31T02:00:00.000Z",
        }
      : null,
    latestSession: {
      ...project.latestSession!,
      usage,
    },
  };
}

describe("ProjectRow Agent usage", () => {
  it("shows exact provider model, compact large total, and exact accessible total", () => {
    const longModel =
      "gpt-5.6-sol-2026-07-31-high-reasoning-preview-ultra-long-provider-native-identifier";
    renderRow(
      projectWithUsage(
        usageFixture({
          model: longModel,
          totalTokens: 15_789_321,
        }),
      ),
    );

    const usage = document.querySelector(".agent-usage-row");
    expect(usage).not.toBeNull();
    expect(within(usage as HTMLElement).getByText("OpenAI")).toBeInTheDocument();
    expect(within(usage as HTMLElement).getByText(longModel)).toHaveAttribute(
      "title",
      longModel,
    );
    expect(
      within(usage as HTMLElement).getByText("1578.9萬"),
    ).toBeInTheDocument();
    expect(usage).toHaveAttribute(
      "title",
      expect.stringContaining("15,789,321 tokens"),
    );
    expect(
      screen.getByRole("button", { name: /最新模型.*整個 session/ }),
    ).toBeInTheDocument();
  });

  it("never turns missing usage into zero", () => {
    renderRow(projectWithUsage(null));

    const usage = document.querySelector(".agent-usage-row");
    expect(usage).toHaveAttribute("data-usage-state", "missing");
    expect(usage).toHaveAttribute(
      "title",
      expect.stringContaining("不可用"),
    );
    expect(within(usage as HTMLElement).queryByText("0")).not.toBeInTheDocument();
  });

  it("renders explicit zero and both partial live qualifiers", () => {
    renderRow(
      projectWithUsage(
        usageFixture({
          totalTokens: 0,
          coverage: "partial",
        }),
        true,
      ),
    );

    const usage = document.querySelector(".agent-usage-row");
    expect(within(usage as HTMLElement).getByText("0")).toBeInTheDocument();
    expect(usage).toHaveTextContent("截至目前");
    expect(usage).toHaveTextContent("自建立索引起");
    expect(usage).toHaveAttribute(
      "title",
      expect.stringContaining("總量 0 tokens"),
    );
  });
});

describe("ProjectRow handoff structure", () => {
  it.each([
    {
      name: "blocker",
      summaryState: "ready" as const,
      summary: {
        blocked: true,
        blockedReason: "等待 API contract 確認",
      },
      label: "目前阻塞",
      content: "等待 API contract 確認",
    },
    {
      name: "awaiting summary",
      summaryState: "awaiting-summary" as const,
      summary: null,
      label: "建議下一步",
      content: "等待背景服務完成摘要",
    },
    {
      name: "no next step",
      summaryState: "ready" as const,
      summary: {
        blocked: false,
        blockedReason: null,
        nextSteps: [],
      },
      label: "建議下一步",
      content: "目前沒有可用的下一步",
    },
  ])("keeps the $name handoff in the primary row order", (candidate) => {
    const project = projectFixture();
    const latestSession = project.latestSession!;
    const nextSummary =
      candidate.summary === null
        ? null
        : {
            ...latestSession.summary!,
            ...candidate.summary,
          };
    const { container } = renderRow({
      ...project,
      summaryState: candidate.summaryState,
      latestSession: {
        ...latestSession,
        summary: nextSummary,
      },
    });

    const main = container.querySelector(".handoff-row-main");
    const handoff = container.querySelector(".handoff-row-next");
    expect(main?.children[0]).toHaveClass("handoff-row-status");
    expect(main?.children[1]).toHaveClass("handoff-row-project");
    expect(main?.children[2]).toHaveClass("agent-usage-row");
    expect(main?.children[3]).toBe(handoff);
    expect(main?.children[4]).toHaveClass("handoff-row-activity");
    expect(handoff?.querySelector("small")).toHaveTextContent(candidate.label);
    expect(handoff?.lastElementChild).toHaveTextContent(candidate.content);
  });
});

describe("ProjectRow action geometry and named applications", () => {
  it("closes an open action menu on Escape and restores summary focus", () => {
    const onNavigate = vi.fn();
    const onOpen = vi.fn();
    const { container } = renderRow(projectFixture(), {
      onNavigate,
      onOpen,
    });
    const menu = container.querySelector(".handoff-row-menu");
    const menuSummary = menu?.querySelector("summary");
    expect(menu).not.toBeNull();
    expect(menuSummary).not.toBeNull();

    fireEvent.click(menuSummary!);
    expect(menu).toHaveAttribute("open");
    menuSummary!.focus();
    fireEvent.keyDown(menuSummary!, { key: "Escape" });
    expect(menu).not.toHaveAttribute("open");
    expect(menuSummary).toHaveFocus();

    fireEvent.click(menuSummary!);
    const terminal = screen.getByRole("button", {
      name: "在 Terminal 開啟",
    });
    terminal.focus();
    fireEvent.keyDown(terminal, { key: "Escape" });
    expect(menu).not.toHaveAttribute("open");
    expect(menuSummary).toHaveFocus();
    expect(onNavigate).not.toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("keeps the action menu in its own cell when inline edit opens", () => {
    const { container } = renderRow(projectFixture());
    const row = container.querySelector(".handoff-project-row");
    const main = container.querySelector(".handoff-row-main");
    const action = container.querySelector(".handoff-row-action");
    expect(row?.children[0]).toBe(main);
    expect(row?.children[1]).toBe(action);

    fireEvent.click(
      screen.getByRole("button", {
        name: "編輯名稱與 client",
      }),
    );
    const editor = container.querySelector(".handoff-row-editor");
    expect(editor).not.toBeNull();
    expect(row?.children[1]).toBe(action);
    expect(row?.children[2]).toBe(editor);
  });

  it("deduplicates a detected VS Code editor and exposes Warp by actual name", () => {
    renderRow(projectFixture());

    expect(
      screen.getAllByRole("button", {
        name: "在 Visual Studio Code 開啟",
      }),
    ).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: "在 Warp 開啟專案目錄" }),
    ).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: /Editor/ }),
    ).not.toBeInTheDocument();
  });

  it("keeps unavailable applications visible with disabled explanations", () => {
    renderRow(projectFixture(), {
      applications: {
        visualStudioCode: false,
        warp: false,
        editor: null,
      },
    });

    expect(
      screen.getByRole("button", {
        name: "Visual Studio Code 未安裝",
      }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Warp 未安裝" }),
    ).toBeDisabled();
  });

  it("keeps a configured Cursor action separate from explicit VS Code", () => {
    renderRow(projectFixture(), {
      applications: {
        visualStudioCode: true,
        warp: true,
        editor: {
          kind: "cursor",
          name: "Cursor",
          available: true,
        },
      },
    });

    expect(
      screen.getByRole("button", { name: "在 Cursor 開啟" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", {
        name: "在 Visual Studio Code 開啟",
      }),
    ).toBeEnabled();
  });

  it("uses one enabled VS Code action when only its configured CLI is available", () => {
    renderRow(projectFixture(), {
      applications: {
        visualStudioCode: false,
        warp: false,
        editor: {
          kind: "visual-studio-code",
          name: "Visual Studio Code",
          available: true,
        },
      },
    });

    expect(
      screen.getAllByRole("button", {
        name: "在 Visual Studio Code 開啟",
      }),
    ).toHaveLength(1);
    expect(
      screen.getByRole("button", {
        name: "在 Visual Studio Code 開啟",
      }),
    ).toBeEnabled();
  });
});
