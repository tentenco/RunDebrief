// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RuntimeStatus } from "../types";
import {
  EmptyProjects,
  Onboarding,
  RuntimeSetup,
  ScanProgress,
} from "./ExperienceStates";

const runtimeStatus: RuntimeStatus = {
  daemon: {
    label: "com.tenten.debrief-daemon",
    installed: true,
    running: true,
    pid: 5151,
    state: "running",
    runtimeVersion: "0.1.0",
  },
  config: {
    exists: true,
    gatewayConfigured: true,
    summaryModelConfigured: true,
  },
  applications: {
    visualStudioCode: true,
    warp: true,
    editor: {
      kind: "visual-studio-code",
      name: "Visual Studio Code",
      available: true,
    },
  },
  databaseExists: true,
};

describe("first-run and empty states", () => {
  it("explains local reads before starting the actual index load", () => {
    const onStart = vi.fn();
    render(
      <Onboarding
        runtimeStatus={runtimeStatus}
        runtimeBusy={false}
        runtimeError={null}
        indexError={null}
        onStart={onStart}
        onInstallDaemon={vi.fn()}
        onRetryRuntime={vi.fn()}
      />,
    );

    expect(screen.getByText(/~\/.claude/)).toBeInTheDocument();
    expect(screen.getByText(/~\/.codex/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /讀取本機索引/ }));
    expect(onStart).toHaveBeenCalledOnce();
  });

  it("describes an index query rather than a new scan", () => {
    render(<ScanProgress />);

    expect(screen.getByText(/這不是重新掃描 session/)).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-label",
      "索引讀取狀態",
    );
  });

  it("offers explicit daemon recovery without a generic privacy action", () => {
    const onInstall = vi.fn();
    render(
      <RuntimeSetup
        status={{
          ...runtimeStatus,
          daemon: {
            ...runtimeStatus.daemon,
            installed: false,
            running: false,
            pid: null,
            state: null,
          },
          config: {
            exists: false,
            gatewayConfigured: false,
            summaryModelConfigured: false,
          },
        }}
        busy={false}
        error={null}
        onInstall={onInstall}
        onRetry={vi.fn()}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "安裝並啟動背景服務" }),
    );
    expect(onInstall).toHaveBeenCalledOnce();
    expect(
      screen.queryByRole("button", {
        name: "開啟 macOS「隱私權與安全性」",
      }),
    ).not.toBeInTheDocument();
  });

  it("keeps AI summaries degraded until both gateway and model are configured", () => {
    render(
      <RuntimeSetup
        status={{
          ...runtimeStatus,
          config: {
            exists: true,
            gatewayConfigured: true,
            summaryModelConfigured: false,
          },
        }}
        busy={false}
        error={null}
        onInstall={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("heading", {
        name: "背景服務正在執行 · 規則式摘要",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/摘要 model 未設定/)).toBeInTheDocument();
    expect(screen.getByText(/摘要設定：未完整設定/)).toBeInTheDocument();
  });

  it("offers status retry for a service error with cached healthy status", () => {
    const onRetry = vi.fn();
    const view = render(
      <RuntimeSetup
        compact
        status={runtimeStatus}
        busy={false}
        error="status unavailable"
        onInstall={vi.fn()}
        onRetry={onRetry}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "重新檢查狀態" }),
    );
    expect(onRetry).toHaveBeenCalledOnce();
    expect(
      screen.queryByRole("button", { name: "重新啟動背景服務" }),
    ).not.toBeInTheDocument();

    view.rerender(
      <RuntimeSetup
        compact
        status={runtimeStatus}
        busy
        error="status unavailable"
        onInstall={vi.fn()}
        onRetry={onRetry}
      />,
    );
    expect(
      screen.getByRole("button", { name: "重新檢查狀態" }),
    ).toBeDisabled();
  });

  it("shows an illustrated empty-state instruction", () => {
    render(<EmptyProjects />);
    expect(
      screen.getByRole("img", { name: "等待第一個專案出現" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/第一個 session/)).toBeInTheDocument();
  });
});
