// @vitest-environment jsdom

import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { projectFixture, usageFixture } from "../test/fixtures";
import type {
  ProjectDetail,
  SessionTurnLogState,
} from "../types";
import { DetailPanel } from "./DetailPanel";

beforeEach(() => {
  vi.mocked(navigator.clipboard.writeText)
    .mockReset()
    .mockResolvedValue(undefined);
});

function renderDetail(
  detail: ProjectDetail,
  turnLogState?: SessionTurnLogState,
  onLoadTurnLog = vi.fn(),
) {
  const sessionId = detail.sessions[0]?.id;
  return render(
    <DetailPanel
      detail={detail}
      loading={false}
      turnLogs={
        sessionId !== undefined && turnLogState
          ? new Map([[sessionId, turnLogState]])
          : new Map()
      }
      onClose={vi.fn()}
      onCopyRecap={vi.fn()}
      onOpenTerminal={vi.fn()}
      onAcknowledge={vi.fn()}
      onLoadTurnLog={onLoadTurnLog}
    />,
  );
}

describe("DetailPanel summary states", () => {
  it("focuses close once when the Inspector opens", () => {
    const project = projectFixture();
    const detail = {
      project,
      sessions: [project.latestSession!],
    };
    const { rerender } = render(
      <DetailPanel {...detailPanelProps(null, false)} />,
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    rerender(
      <DetailPanel {...detailPanelProps(detail, false)} />,
    );

    expect(
      screen.getByRole("button", { name: "關閉詳情" }),
    ).toHaveFocus();
  });

  it("keeps Copy focused when a cloned detail for the same project arrives", () => {
    const project = projectFixture();
    const detail = {
      project,
      sessions: [project.latestSession!],
    };
    const { rerender } = render(
      <DetailPanel {...detailPanelProps(detail, false)} />,
    );
    const close = screen.getByRole("button", { name: "關閉詳情" });
    const copy = screen.getByRole("button", { name: /複製交接摘要/ });
    copy.focus();
    const closeFocus = vi.spyOn(close, "focus");

    rerender(
      <DetailPanel
        {...detailPanelProps(structuredClone(detail), false)}
      />,
    );

    expect(copy).toHaveFocus();
    expect(closeFocus).not.toHaveBeenCalled();
  });

  it("focuses close once when the Inspector switches projects", () => {
    const firstProject = projectFixture();
    const firstDetail = {
      project: firstProject,
      sessions: [firstProject.latestSession!],
    };
    const secondProject = projectFixture({
      id: 2,
      name: "hermes",
      path: "/Users/demo/Projects/hermes",
    });
    const secondDetail = {
      project: secondProject,
      sessions: [secondProject.latestSession!],
    };
    const { rerender } = render(
      <DetailPanel {...detailPanelProps(firstDetail, false)} />,
    );
    const close = screen.getByRole("button", { name: "關閉詳情" });
    screen.getByRole("button", { name: /複製交接摘要/ }).focus();
    const closeFocus = vi.spyOn(close, "focus");

    rerender(
      <DetailPanel {...detailPanelProps(secondDetail, false)} />,
    );

    expect(close).toHaveFocus();
    expect(closeFocus).toHaveBeenCalledOnce();

    rerender(
      <DetailPanel
        {...detailPanelProps(structuredClone(secondDetail), false)}
      />,
    );
    expect(closeFocus).toHaveBeenCalledOnce();
  });

  it("moves to the nearest Inspector control when refresh removes focus", () => {
    const project = projectFixture();
    const detail = {
      project,
      sessions: [project.latestSession!],
    };
    const { rerender } = render(
      <DetailPanel {...detailPanelProps(detail, false)} />,
    );
    screen.getByRole("button", { name: "標記已處理" }).focus();

    const acknowledgedSession = {
      ...project.latestSession!,
      summary: {
        ...project.latestSession!.summary!,
        acknowledged: true,
      },
    };
    rerender(
      <DetailPanel
        {...detailPanelProps(
          {
            project: {
              ...project,
              latestSession: acknowledgedSession,
            },
            sessions: [acknowledgedSession],
          },
          false,
        )}
      />,
    );

    expect(
      screen.getByRole("button", { name: "在 Terminal 開啟專案" }),
    ).toHaveFocus();
    expect(document.body).not.toHaveFocus();
  });

  it("renders a static awaiting-summary message instead of a shimmer", () => {
    const project = projectFixture({
      summaryState: "awaiting-summary",
    });
    const session = {
      ...project.latestSession!,
      summary: null,
    };
    const { container } = renderDetail({
      project: {
        ...project,
        latestSession: session,
      },
      sessions: [session],
    });

    expect(
      screen.getByText("索引已讀取；等待背景服務完成完整摘要。"),
    ).toBeInTheDocument();
    expect(container.querySelector(".session-loading")).not.toBeInTheDocument();
  });

  it("labels rules-fallback summaries as degraded while keeping them readable", () => {
    const project = projectFixture({
      summaryState: "degraded",
    });
    const session = {
      ...project.latestSession!,
      summary: {
        ...project.latestSession!.summary!,
        model: "rules-fallback",
        stateSummary: "保留可讀的規則式摘要。",
      },
    };
    renderDetail({
      project: {
        ...project,
        latestSession: session,
      },
      sessions: [session],
    });

    expect(
      screen.getByText("規則式摘要 · Gateway 未設定或暫時不可用"),
    ).toBeInTheDocument();
    const progress = screen.getByText("目前進度").closest("section");
    expect(progress).not.toBeNull();
    expect(
      within(progress!).getByText("保留可讀的規則式摘要。"),
    ).toBeInTheDocument();
  });

  it("keeps the ready turn log collapsed until opened and supports its nested response", () => {
    const project = projectFixture();
    const detail = {
      project,
      sessions: [project.latestSession!],
    };
    renderDetail(detail, {
      status: "ready",
      error: null,
      page: {
        sessionId: project.latestSession!.id,
        turns: [
          {
            ordinal: 4,
            timestamp: "2026-07-29T10:00:00.000Z",
            userPrompt: "第一行 prompt\n第二行仍須完整顯示。",
            assistantResponse: "完整的 Agent 回覆\n也保留換行。",
          },
        ],
        totalTurns: 4,
        hasEarlier: true,
        skippedLines: 1,
        limit: 20,
      },
    });

    expect(screen.getByText("顯示最新 1 / 4 個 turns")).toBeInTheDocument();
    const outerSummary = screen.getByText("原始對話").closest("summary");
    const outerDisclosure = outerSummary?.closest("details");
    expect(outerSummary).not.toBeNull();
    expect(outerDisclosure).not.toHaveAttribute("open");

    fireEvent.click(outerSummary!);
    expect(outerDisclosure).toHaveAttribute("open");
    expect(
      screen.getByRole("button", {
        name: "複製已載入的最新 1 / 4 個 turns，不包含較早 turns",
      }),
    ).toHaveTextContent("複製已載入的最新 turns");
    expect(
      screen.queryByRole("button", { name: /複製完整對話/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/第一行 prompt/).textContent,
    ).toBe("第一行 prompt\n第二行仍須完整顯示。");
    expect(screen.getByText(/已略過 1 行/)).toBeInTheDocument();

    const responseSummary = screen.getByText("查看 Agent 回覆");
    const responseDisclosure = responseSummary.closest("details");
    expect(responseDisclosure).not.toHaveAttribute("open");
    fireEvent.click(responseSummary);
    expect(responseDisclosure).toHaveAttribute("open");
    expect(
      screen.getByText(/完整的 Agent 回覆/).textContent,
    ).toBe("完整的 Agent 回覆\n也保留換行。");

    fireEvent.click(outerSummary!);
    expect(outerDisclosure).not.toHaveAttribute("open");
  });

  it("copies exact prompt, response, and loaded log with independent states", async () => {
    const project = projectFixture();
    renderDetail(
      {
        project,
        sessions: [project.latestSession!],
      },
      {
        status: "ready",
        error: null,
        page: {
          sessionId: project.latestSession!.id,
          turns: [
            {
              ordinal: 4,
              timestamp: null,
              userPrompt: "exact prompt\nwith spacing",
              assistantResponse: "exact response\nwith spacing",
            },
          ],
          totalTurns: 8,
          hasEarlier: true,
          skippedLines: 0,
          limit: 20,
        },
      },
    );

    fireEvent.click(screen.getByText("原始對話").closest("summary")!);
    const promptCopy = screen.getByRole("button", {
      name: "複製第 4 個 turn 的 User prompt",
    });
    promptCopy.focus();
    fireEvent.click(promptCopy);
    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        "exact prompt\nwith spacing",
      ),
    );
    expect(
      screen.getByRole("button", {
        name: "已複製第 4 個 turn 的 User prompt",
      }),
    ).toHaveFocus();

    fireEvent.click(screen.getByText("查看 Agent 回覆"));
    const responseCopy = screen.getByRole("button", {
      name: "複製第 4 個 turn 的完整 Agent 回覆",
    });
    fireEvent.click(responseCopy);
    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        "exact response\nwith spacing",
      ),
    );
    expect(
      screen.getByRole("button", {
        name: "已複製第 4 個 turn 的 User prompt",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "已複製第 4 個 turn 的完整 Agent 回覆",
      }),
    ).toHaveTextContent("已複製");

    const loadedCopy = screen.getByRole("button", {
      name: "複製已載入的最新 1 / 8 個 turns，不包含較早 turns",
    });
    fireEvent.click(loadedCopy);
    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith(
        [
          "Turn 4",
          "",
          "User prompt",
          "exact prompt\nwith spacing",
          "",
          "Agent 回覆",
          "exact response\nwith spacing",
        ].join("\n"),
      ),
    );
  });

  it("recovers a failed scoped copy without replacing the evidence", async () => {
    vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(
      new Error("denied"),
    );
    const project = projectFixture();
    renderDetail(
      {
        project,
        sessions: [project.latestSession!],
      },
      {
        status: "ready",
        error: null,
        page: {
          sessionId: project.latestSession!.id,
          turns: [
            {
              ordinal: 1,
              timestamp: null,
              userPrompt: "evidence remains visible",
              assistantResponse: null,
            },
          ],
          totalTurns: 1,
          hasEarlier: false,
          skippedLines: 0,
          limit: 20,
        },
      },
    );

    fireEvent.click(screen.getByText("原始對話").closest("summary")!);
    fireEvent.click(
      screen.getByRole("button", {
        name: "複製第 1 個 turn 的 User prompt",
      }),
    );
    const retry = await screen.findByRole("button", {
      name: "重新複製第 1 個 turn 的 User prompt",
    });
    expect(screen.getByText("evidence remains visible")).toBeInTheDocument();
    vi.mocked(navigator.clipboard.writeText).mockResolvedValueOnce(undefined);
    fireEvent.click(retry);
    expect(
      await screen.findByRole("button", {
        name: "已複製第 1 個 turn 的 User prompt",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "複製第 1 個 turn 的完整 Agent 回覆",
      }),
    ).toBeDisabled();
  });

  it("keeps turn-log loading independent from the session summary", () => {
    const project = projectFixture();
    renderDetail(
      {
        project,
        sessions: [project.latestSession!],
      },
      {
        status: "loading",
        page: null,
        error: null,
      },
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      "正在讀取原始對話",
    );
    const progress = screen.getByText("目前進度").closest("section");
    expect(progress).not.toBeNull();
    expect(
      within(progress!).getByText(
        "The app shell renders real project data.",
      ),
    ).toBeInTheDocument();
  });

  it("offers retry for a redacted turn-log error", () => {
    const project = projectFixture();
    const onLoadTurnLog = vi.fn();
    renderDetail(
      {
        project,
        sessions: [project.latestSession!],
      },
      {
        status: "error",
        page: null,
        error: "無法讀取這個 session 的原始紀錄。",
      },
      onLoadTurnLog,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "無法讀取這個 session 的原始紀錄。",
    );
    fireEvent.click(screen.getByRole("button", { name: "再試一次" }));
    expect(onLoadTurnLog).toHaveBeenCalledOnce();
  });

  it("reports an empty original log without affecting the summary", () => {
    const project = projectFixture();
    renderDetail(
      {
        project,
        sessions: [project.latestSession!],
      },
      {
        status: "ready",
        error: null,
        page: {
          sessionId: project.latestSession!.id,
          turns: [],
          totalTurns: 0,
          hasEarlier: false,
          skippedLines: 2,
          limit: 20,
        },
      },
    );

    expect(
      screen.getByText(/沒有可顯示的 user \/ assistant 文字/),
    ).toBeInTheDocument();
    const progress = screen.getByText("目前進度").closest("section");
    expect(progress).not.toBeNull();
    expect(
      within(progress!).getByText(
        "The app shell renders real project data.",
      ),
    ).toBeInTheDocument();
  });

  it("shows the latest breakdown before next-step and usage in recent headers", () => {
    const project = projectFixture();
    const latestSession = {
      ...project.latestSession!,
      usage: usageFixture({
        model: "gpt-5.6-sol",
        inputTokens: 10_000,
        cacheReadInputTokens: 4_000,
        cacheCreationInputTokens: 500,
        outputTokens: 2_000,
        reasoningOutputTokens: 750,
        totalTokens: 12_000,
      }),
    };
    const previousSession = {
      ...latestSession,
      id: 11,
      tool: "claude-code" as const,
      usage: usageFixture({
        provider: "claude-code",
        model: "claude-opus-5",
        reasoningOutputTokens: null,
        totalTokens: 5_000,
      }),
    };
    const { container } = renderDetail({
      project: {
        ...project,
        latestSession,
      },
      sessions: [latestSession, previousSession],
    });

    const usageStrip = container.querySelector(".inspector-usage");
    const nextStep = container.querySelector(".inspector-next-step");
    expect(usageStrip).not.toBeNull();
    expect(nextStep).not.toBeNull();
    expect(
      usageStrip!.compareDocumentPosition(nextStep!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(within(usageStrip as HTMLElement).getByText("總量")).toBeInTheDocument();
    expect(within(usageStrip as HTMLElement).getByText("輸入")).toBeInTheDocument();
    expect(within(usageStrip as HTMLElement).getByText("輸出")).toBeInTheDocument();
    expect(within(usageStrip as HTMLElement).getByText("快取")).toBeInTheDocument();
    expect(within(usageStrip as HTMLElement).getByText("推理")).toBeInTheDocument();
    expect(usageStrip).toHaveTextContent("最新模型");
    expect(usageStrip).toHaveTextContent("整個 session");

    const recent = container.querySelectorAll(".agent-usage-recent");
    expect(recent).toHaveLength(2);
    expect(recent[0]).toHaveTextContent("OpenAI");
    expect(recent[0]).toHaveTextContent("gpt-5.6-sol");
    expect(recent[0]).toHaveTextContent("1.2萬");
    expect(recent[1]).toHaveTextContent("Claude");
    expect(recent[1]).toHaveTextContent("claude-opus-5");
  });

  it("keeps a missing detail unavailable and hides Claude reasoning", () => {
    const project = projectFixture();
    const session = {
      ...project.latestSession!,
      tool: "claude-code" as const,
      usage: usageFixture({
        provider: "claude-code",
        model: "claude-sonnet-4-5",
        reasoningOutputTokens: 0,
      }),
    };
    const { container, rerender } = renderDetail({
      project: { ...project, latestSession: session },
      sessions: [session],
    });

    expect(
      within(container.querySelector(".inspector-usage") as HTMLElement)
        .queryByText("推理"),
    ).not.toBeInTheDocument();

    const missing = { ...session, usage: null };
    rerender(
      <DetailPanel
        detail={{
          project: { ...project, latestSession: missing },
          sessions: [missing],
        }}
        loading={false}
        turnLogs={new Map()}
        onClose={vi.fn()}
        onCopyRecap={vi.fn()}
        onOpenTerminal={vi.fn()}
        onAcknowledge={vi.fn()}
        onLoadTurnLog={vi.fn()}
      />,
    );
    const metrics = container.querySelector(".usage-metrics");
    expect(metrics).toHaveTextContent("—");
    expect(metrics).not.toHaveTextContent("0");
  });
});

function detailPanelProps(
  detail: ProjectDetail | null,
  loading: boolean,
): React.ComponentProps<typeof DetailPanel> {
  return {
    detail,
    loading,
    turnLogs: new Map(),
    onClose: vi.fn(),
    onCopyRecap: vi.fn(),
    onOpenTerminal: vi.fn(),
    onAcknowledge: vi.fn(),
    onLoadTurnLog: vi.fn(),
  };
}
