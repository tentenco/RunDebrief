// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TEST_NOW, projectFixture } from "../test/fixtures";
import { ProjectCard } from "./ProjectCard";

beforeEach(() => {
  vi.useFakeTimers({ now: TEST_NOW, toFake: ["Date"] });
});

afterEach(() => {
  vi.useRealTimers();
});

function renderCard(
  project = projectFixture(),
  overrides: Partial<React.ComponentProps<typeof ProjectCard>> = {},
) {
  const props: React.ComponentProps<typeof ProjectCard> = {
    project,
    busy: false,
    cardIndex: 0,
    active: true,
    onOpen: vi.fn(),
    onFocus: vi.fn(),
    onNavigate: vi.fn(),
    onTerminal: vi.fn(),
    onEditor: vi.fn(),
    onCopyRecap: vi.fn(),
    onAcknowledge: vi.fn(),
    onUpdate: vi.fn(),
    onRetry: vi.fn(),
    ...overrides,
  };
  render(<ProjectCard {...props} />);
  return props;
}

describe("ProjectCard", () => {
  it("exposes status, summary, and all four primary actions", () => {
    renderCard();

    expect(screen.getByText("Idle")).toBeInTheDocument();
    expect(
      screen.getByText("The app shell renders real project data."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Terminal/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Editor/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Recap/ })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Acknowledge/ }),
    ).toBeInTheDocument();
  });

  it("renders awaiting-summary and degraded state matrices", () => {
    const { rerender } = render(
      <ProjectCard
        {...renderProps(
          projectFixture({
            summaryState: "awaiting-summary",
            latestSession: {
              ...projectFixture().latestSession!,
              summary: null,
            },
          }),
        )}
      />,
    );
    expect(screen.getByText("等待完整摘要")).toBeInTheDocument();
    expect(screen.queryByLabelText("摘要生成中")).not.toBeInTheDocument();

    rerender(
      <ProjectCard
        {...renderProps(projectFixture({ summaryState: "degraded" }))}
      />,
    );
    expect(
      screen.getByText(/Gateway 未設定或暫時不可用/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "重新整理" }),
    ).toBeInTheDocument();
  });

  it("calls pin, inline edit, hide, and command-enter recap handlers", () => {
    const onUpdate = vi.fn();
    const onCopyRecap = vi.fn();
    renderCard(projectFixture(), { onUpdate, onCopyRecap });

    fireEvent.click(screen.getByRole("button", { name: "置頂" }));
    expect(onUpdate).toHaveBeenCalledWith({ pinned: true });

    fireEvent.click(screen.getByRole("button", { name: "編輯名稱與 client" }));
    fireEvent.change(screen.getByLabelText("名稱"), {
      target: { value: "Debrief App" },
    });
    fireEvent.change(screen.getByLabelText("Client"), {
      target: { value: "Example Co" },
    });
    fireEvent.click(screen.getByRole("button", { name: "儲存" }));
    expect(onUpdate).toHaveBeenCalledWith({
      name: "Debrief App",
      client: "Example Co",
    });

    fireEvent.click(screen.getByRole("button", { name: "隱藏專案" }));
    expect(onUpdate).toHaveBeenCalledWith({ hidden: true });

    fireEvent.keyDown(screen.getByRole("button", { name: /debrief, Idle/ }), {
      key: "Enter",
      metaKey: true,
    });
    expect(onCopyRecap).toHaveBeenCalledOnce();
  });

  it("maps arrows and space to roving focus and quick preview", () => {
    const onNavigate = vi.fn();
    const onOpen = vi.fn();
    renderCard(projectFixture(), { onNavigate, onOpen });
    const card = screen.getByRole("button", { name: /debrief, Idle/ });

    fireEvent.keyDown(card, { key: "ArrowRight" });
    fireEvent.keyDown(card, { key: " " });

    expect(onNavigate).toHaveBeenCalledWith("right");
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it("can restore a project from the Hidden group", () => {
    const onUpdate = vi.fn();
    renderCard(projectFixture({ hidden: true }), { onUpdate });

    fireEvent.click(screen.getByRole("button", { name: "顯示專案" }));
    expect(onUpdate).toHaveBeenCalledWith({ hidden: false });
  });
});

function renderProps(project = projectFixture()) {
  return {
    project,
    busy: false,
    cardIndex: 0,
    active: true,
    onOpen: vi.fn(),
    onFocus: vi.fn(),
    onNavigate: vi.fn(),
    onTerminal: vi.fn(),
    onEditor: vi.fn(),
    onCopyRecap: vi.fn(),
    onAcknowledge: vi.fn(),
    onUpdate: vi.fn(),
    onRetry: vi.fn(),
  };
}
