// @vitest-environment jsdom

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import {
  FixtureRepository,
  TEST_NOW,
  projectFixture,
  turnLogFixture,
  usageFixture,
} from "./test/fixtures";
import type { Project, SessionTurnLogPage } from "./types";

describe("App", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: TEST_NOW, toFake: ["Date"] });
    window.localStorage.clear();
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1_280,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the project workspace and opens the session detail panel", async () => {
    const repository = new FixtureRepository();
    render(<App repository={repository} />);

    expect(await screen.findByText("debrief")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /debrief, Idle/ }));
    expect(
      await screen.findByRole("dialog", {
        name: "debrief session 詳情",
      }),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/phase-3\/app-shell/)).toHaveLength(3);
    expect(
      await screen.findByText("請完成原始對話 fixture。"),
    ).toBeInTheDocument();
  });

  it("filters by search and routes native actions through the repository", async () => {
    const repository = new FixtureRepository([
      projectFixture(),
      projectFixture({
        id: 2,
        name: "hermes",
        path: "/Users/demo/Projects/hermes",
      }),
    ]);
    render(<App repository={repository} />);
    await screen.findByText("hermes");

    fireEvent.change(
      screen.getByRole("searchbox", {
        name: "搜尋專案、分支與摘要",
      }),
      {
      target: { value: "debrief" },
      },
    );
    expect(screen.queryByText("hermes")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Terminal/ }));
    await waitFor(() => expect(repository.terminalProjects).toEqual([1]));
  });

  it("sorts filtered projects, persists the choice, and keeps Recent honest", async () => {
    const projects = [
      sortableProject(1, "Alpha missing", null, null),
      sortableProject(
        2,
        "Bravo partial",
        1_200,
        "2026-07-29T10:00:00.000Z",
        "partial",
      ),
      sortableProject(
        3,
        "Charlie high",
        9_000,
        "2026-07-29T11:00:00.000Z",
      ),
      sortableProject(4, "Delta zero", 0, "not-a-date"),
    ];
    const repository = new FixtureRepository(projects);
    const first = render(<App repository={repository} />);
    const sort = await screen.findByRole("combobox", { name: "排序" });

    fireEvent.change(sort, { target: { value: "usage-desc" } });
    expect(projectCardOrder()).toEqual([3, 2, 4, 1]);
    expect(window.localStorage.getItem("debrief-project-sort")).toBe(
      "usage-desc",
    );

    fireEvent.change(
      screen.getByRole("searchbox", {
        name: "搜尋專案、分支與摘要",
      }),
      { target: { value: "partial" } },
    );
    expect(projectCardOrder()).toEqual([2]);
    fireEvent.change(
      screen.getByRole("searchbox", {
        name: "搜尋專案、分支與摘要",
      }),
      { target: { value: "" } },
    );
    expect(projectCardOrder()).toEqual([3, 2, 4, 1]);

    first.unmount();
    render(<App repository={repository} />);
    const restoredSort = await screen.findByRole("combobox", {
      name: "排序",
    });
    expect(restoredSort).toHaveValue("usage-desc");
    expect(projectCardOrder()).toEqual([3, 2, 4, 1]);

    fireEvent.click(screen.getByRole("button", { name: /^最近/ }));
    expect(restoredSort).toBeDisabled();
    expect(restoredSort).toHaveValue("activity-desc");
    expect(projectCardOrder()).toEqual([3, 2, 1, 4]);
    expect(
      screen.getByText("依最後活動排序的 4 個未隱藏專案。"),
    ).toBeInTheDocument();
    expect(window.localStorage.getItem("debrief-project-sort")).toBe(
      "usage-desc",
    );

    fireEvent.click(screen.getByRole("button", { name: /^接手總覽/ }));
    expect(restoredSort).not.toBeDisabled();
    expect(restoredSort).toHaveValue("usage-desc");
    expect(projectCardOrder()).toEqual([3, 2, 4, 1]);
  });

  it("implements search, refresh, card navigation, preview, and escape shortcuts", async () => {
    const repository = new FixtureRepository([
      projectFixture(),
      projectFixture({
        id: 2,
        name: "hermes",
        path: "/Users/demo/Projects/hermes",
      }),
    ]);
    render(<App repository={repository} />);
    const firstCard = await screen.findByRole("button", {
      name: /debrief, Idle/,
    });

    fireEvent.keyDown(window, { key: "f", metaKey: true });
    await waitFor(() =>
      expect(
        screen.getByRole("searchbox", {
          name: "搜尋專案、分支與摘要",
        }),
      ).toHaveFocus(),
    );

    fireEvent.keyDown(window, { key: "r", metaKey: true });
    await waitFor(() => expect(repository.snapshotLoads).toBeGreaterThan(1));

    fireEvent.focus(firstCard);
    fireEvent.keyDown(firstCard, { key: "ArrowDown" });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /hermes, Idle/ }),
      ).toHaveFocus(),
    );

    fireEvent.click(document.activeElement!);
    expect(
      await screen.findByRole("dialog", { name: "hermes session 詳情" }),
    ).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "hermes session 詳情" }),
      ).not.toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /hermes, Idle/ }),
      ).toHaveFocus(),
    );
  });

  it("toggles and restores the persistent sidebar without losing search access", async () => {
    const repository = new FixtureRepository();
    const first = render(<App repository={repository} />);
    await screen.findByText("debrief");
    const sidebar = screen.getByRole("complementary", {
      name: "專案導覽",
    });

    fireEvent.click(
      screen.getAllByRole("button", { name: "隱藏側邊欄" })[0]!,
    );
    expect(sidebar).toHaveAttribute("hidden");
    expect(window.localStorage.getItem("debrief-sidebar-visible")).toBe(
      "false",
    );
    expect(
      screen.getByRole("button", { name: "顯示側邊欄" }),
    ).toBeInTheDocument();

    first.unmount();
    render(<App repository={repository} />);
    await screen.findByText("debrief");
    expect(
      screen.getByRole("button", { name: "顯示側邊欄" }),
    ).toBeInTheDocument();

    fireEvent.keyDown(window, {
      key: "s",
      metaKey: true,
      shiftKey: true,
    });
    expect(
      screen.getAllByRole("button", { name: "隱藏側邊欄" }),
    ).not.toHaveLength(0);
    fireEvent.click(
      screen.getAllByRole("button", { name: "隱藏側邊欄" })[0]!,
    );
    fireEvent.keyDown(window, { key: "f", metaKey: true });
    await waitFor(() =>
      expect(
        screen.getByRole("searchbox", {
          name: "搜尋專案、分支與摘要",
        }),
      ).toHaveFocus(),
    );
    expect(window.localStorage.getItem("debrief-sidebar-visible")).toBe(
      "false",
    );
  });

  it("auto-collapses the sidebar for compact detail and restores it from the toolbar", async () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 980,
    });
    const repository = new FixtureRepository();
    render(<App repository={repository} />);
    await screen.findByText("debrief");
    const sidebar = screen.getByRole("complementary", {
      name: "專案導覽",
    });
    expect(sidebar).not.toHaveAttribute("hidden");

    fireEvent.click(
      screen.getByRole("button", { name: /debrief, Idle/ }),
    );
    expect(
      await screen.findByRole("dialog", {
        name: "debrief session 詳情",
      }),
    ).toBeInTheDocument();
    expect(sidebar).toHaveAttribute("hidden");

    fireEvent.click(
      screen.getByRole("button", { name: "顯示側邊欄" }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", {
          name: "debrief session 詳情",
        }),
      ).not.toBeInTheDocument(),
    );
    expect(sidebar).not.toHaveAttribute("hidden");
  });

  it("opens the command palette and navigates to honest source evidence", async () => {
    const repository = new FixtureRepository();
    render(<App repository={repository} />);
    await screen.findByText("debrief");

    const commandButton = screen.getByRole("button", {
      name: "開啟快速前往",
    });
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    expect(
      await screen.findByRole("dialog", { name: "快速前往" }),
    ).toBeInTheDocument();
    const commandSearch = screen.getByRole("combobox", {
      name: "搜尋頁面或專案",
    });
    expect(commandSearch).toHaveFocus();
    const lastOption = screen.getAllByRole("option").at(-1)!;
    fireEvent.keyDown(commandSearch, {
      key: "Tab",
      shiftKey: true,
    });
    expect(lastOption).toHaveFocus();
    fireEvent.keyDown(lastOption, { key: "Tab" });
    expect(commandSearch).toHaveFocus();

    fireEvent.keyDown(commandSearch, { key: "Escape" });
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "快速前往" }),
      ).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(commandButton).toHaveFocus());

    fireEvent.keyDown(window, { key: "k", metaKey: true });
    const reopenedSearch = await screen.findByRole("combobox", {
      name: "搜尋頁面或專案",
    });
    fireEvent.change(reopenedSearch, { target: { value: "資料來源" } });
    fireEvent.keyDown(reopenedSearch, { key: "Enter" });

    expect(
      await screen.findByRole("heading", { name: "資料來源" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Dashboard 無獨立 health signal · 選用"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/不可用時使用 canonical raw JSONL/),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "開啟設定" }));
    await waitFor(() =>
      expect(repository.privacySecurityOpens).toBe(1),
    );
  });

  it("opens Settings with Cmd+, switches locale, and restores search, selection, and detail", async () => {
    const repository = new FixtureRepository();
    render(<App repository={repository} />);
    await screen.findByText("debrief");

    fireEvent.click(
      screen.getByRole("button", { name: /debrief, Idle/ }),
    );
    expect(
      await screen.findByRole("dialog", {
        name: "debrief session 詳情",
      }),
    ).toBeInTheDocument();

    const search = screen.getByRole("searchbox", {
      name: "搜尋專案、分支與摘要",
    });
    fireEvent.change(search, { target: { value: "debrief" } });
    fireEvent.keyDown(window, { key: ",", metaKey: true });

    const settingsHeading = await screen.findByRole("heading", {
      name: "設定",
      level: 1,
    });
    expect(settingsHeading).toBeInTheDocument();
    expect(
      screen.queryByRole("dialog", {
        name: "debrief session 詳情",
      }),
    ).not.toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.getByRole("radio", { name: "繁體中文" }),
      ).toHaveFocus(),
    );
    fireEvent.click(
      screen.getByRole("radio", { name: "English" }),
    );

    expect(
      await screen.findByRole("heading", { name: "Settings", level: 1 }),
    ).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("en");
    expect(window.localStorage.getItem("debrief-locale")).toBe("en");
    expect(
      screen.getByRole("searchbox", {
        name: "Search projects, branches, and summaries",
      }),
    ).toHaveValue("debrief");
    expect(
      screen.getByRole("radio", { name: "English" }),
    ).toBeChecked();

    fireEvent.click(
      screen.getByRole("button", { name: /^Handoff Overview/ }),
    );
    expect(
      await screen.findByRole("dialog", {
        name: "debrief session details",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("searchbox", {
        name: "Search projects, branches, and summaries",
      }),
    ).toHaveValue("debrief");

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", {
          name: "debrief session details",
        }),
      ).not.toBeInTheDocument(),
    );

    fireEvent.keyDown(window, { key: ",", metaKey: true });
    fireEvent.click(
      screen.getByRole("button", {
        name: "Open macOS Privacy & Security",
      }),
    );
    await waitFor(() => expect(repository.privacySecurityOpens).toBe(1));
  });

  it("keeps service recovery actionable without leaking service errors into Privacy", async () => {
    const repository = new FixtureRepository();
    const loadRuntimeStatus = repository.loadRuntimeStatus.bind(repository);
    let serviceAvailable = true;
    repository.loadRuntimeStatus = async () => {
      if (!serviceAvailable) throw new Error("service unavailable");
      return loadRuntimeStatus();
    };
    render(<App repository={repository} />);
    await screen.findByText("debrief");
    await waitFor(() => expect(repository.runtimeStatusLoads).toBeGreaterThan(0));

    serviceAvailable = false;
    fireEvent.click(
      screen.getByRole("button", { name: /重新讀取/ }),
    );
    expect(
      await screen.findByRole("button", { name: "重新檢查狀態" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "service unavailable",
    );

    fireEvent.click(
      screen.getByRole("button", { name: /^資料來源:/ }),
    );
    expect(
      await screen.findByRole("button", { name: "重新檢查狀態" }),
    ).toBeInTheDocument();

    fireEvent.keyDown(window, { key: ",", metaKey: true });
    expect(
      await screen.findByRole("heading", { name: "設定", level: 1 }),
    ).toBeInTheDocument();
    expect(screen.queryByText("service unavailable")).not.toBeInTheDocument();

    repository.openPrivacySecurity = async () => {
      throw new Error("privacy unavailable");
    };
    fireEvent.click(
      screen.getByRole("button", {
        name: "開啟 macOS「隱私權與安全性」",
      }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "privacy unavailable",
    );

    fireEvent.click(
      screen.getByRole("button", { name: /^資料來源:/ }),
    );
    expect(screen.getByText("privacy unavailable")).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: "重新檢查狀態" }),
    ).toBeInTheDocument();
    serviceAvailable = true;
    fireEvent.click(
      screen.getByRole("button", { name: "重新檢查狀態" }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "重新檢查狀態" }),
      ).not.toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: /^接手總覽/ }));
    expect(
      screen.queryByRole("button", { name: "重新檢查狀態" }),
    ).not.toBeInTheDocument();
  });

  it("persists the explicit light and dark theme preference", async () => {
    const repository = new FixtureRepository();
    const first = render(<App repository={repository} />);
    await screen.findByText("debrief");

    expect(document.documentElement.dataset.theme).toBe("light");
    fireEvent.click(
      screen.getByRole("button", { name: "切換深色模式" }),
    );
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(window.localStorage.getItem("debrief-theme")).toBe("dark");

    first.unmount();
    render(<App repository={repository} />);
    await screen.findByText("debrief");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(
      screen.getByRole("button", { name: "切換淺色模式" }),
    ).toBeInTheDocument();
  });

  it("times out the initial index query and recovers on retry", async () => {
    vi.useRealTimers();
    vi.useFakeTimers({ now: TEST_NOW });
    const repository = new FixtureRepository();
    let blocked = true;
    const originalLoad = repository.loadSnapshot.bind(repository);
    repository.loadSnapshot = () =>
      blocked ? new Promise(() => undefined) : originalLoad();

    render(<App repository={repository} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    expect(screen.getByRole("alert")).toHaveTextContent(/5 秒內沒有回應/);
    blocked = false;
    fireEvent.click(screen.getByRole("button", { name: "再試一次" }));
    await act(async () => {
      await Promise.resolve();
    });
    vi.useRealTimers();
    expect(await screen.findByText("debrief")).toBeInTheDocument();
  });

  it("keeps the last snapshot visible when a later refresh fails", async () => {
    const repository = new FixtureRepository();
    render(<App repository={repository} />);
    expect(await screen.findByText("debrief")).toBeInTheDocument();

    repository.loadSnapshot = async () => {
      throw new Error("refresh unavailable");
    };
    fireEvent.click(
      screen.getByRole("button", { name: /重新讀取/ }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "refresh unavailable",
    );
    expect(screen.getByText("debrief")).toBeInTheDocument();
  });

  it("installs the approved background service from the runtime banner", async () => {
    const repository = new FixtureRepository();
    repository.runtimeStatus = {
      ...repository.runtimeStatus,
      daemon: {
        ...repository.runtimeStatus.daemon,
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
    };
    render(<App repository={repository} />);

    expect(
      screen.queryByRole("button", {
        name: "開啟 macOS「隱私權與安全性」",
      }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      await screen.findByRole("button", {
        name: "安裝並啟動背景服務",
      }),
    );
    await waitFor(() => expect(repository.daemonInstalls).toBe(1));
    expect(repository.runtimeStatus.daemon.running).toBe(true);
  });

  it("does not show a health banner for a usable rules fallback", async () => {
    const repository = new FixtureRepository();
    repository.runtimeStatus = {
      ...repository.runtimeStatus,
      config: {
        exists: true,
        gatewayConfigured: true,
        summaryModelConfigured: false,
      },
    };

    render(<App repository={repository} />);

    expect(await screen.findByText("debrief")).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", {
        name: "背景服務正在執行 · 規則式摘要",
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: "開啟 macOS「隱私權與安全性」",
      }),
    ).not.toBeInTheDocument();
  });

  it("renders detail immediately while the newest turn log loads independently", async () => {
    const repository = new FixtureRepository();
    let resolveTurnLog: (page: SessionTurnLogPage) => void =
      () => undefined;
    repository.loadSessionTurnLog = vi.fn(
      () =>
        new Promise<SessionTurnLogPage>((resolve) => {
          resolveTurnLog = resolve;
        }),
    );
    render(<App repository={repository} />);

    fireEvent.click(
      await screen.findByRole("button", { name: /debrief, Idle/ }),
    );
    expect(
      await screen.findByRole("dialog", { name: "debrief session 詳情" }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText("The app shell renders real project data."),
    ).toHaveLength(2);
    expect(screen.getByRole("status")).toHaveTextContent(
      "正在讀取原始對話",
    );

    await act(async () => {
      resolveTurnLog(turnLogFixture());
    });
    expect(
      await screen.findByText("請完成原始對話 fixture。"),
    ).toBeInTheDocument();
  });

  it("auto-loads only the newest session and leaves older logs on demand", async () => {
    const project = projectFixture();
    const newest = project.latestSession!;
    const older = {
      ...newest,
      id: 9,
      endedAt: "2026-07-28T12:00:00.000Z",
      summary: {
        ...newest.summary!,
        id: 19,
        sessionId: 9,
      },
    };
    const repository = new FixtureRepository([project]);
    repository.loadProjectDetail = async () => ({
      project,
      sessions: [newest, older],
    });
    render(<App repository={repository} />);

    fireEvent.click(
      await screen.findByRole("button", { name: /debrief, Idle/ }),
    );
    await waitFor(() => expect(repository.turnLogLoads).toEqual([10]));
    fireEvent.click(
      screen.getByRole("button", { name: "查看原始對話" }),
    );
    await waitFor(() => expect(repository.turnLogLoads).toEqual([10, 9]));
  });
});

function sortableProject(
  id: number,
  name: string,
  totalTokens: number | null,
  lastActivityAt: string | null,
  coverage: "complete" | "partial" = "complete",
): Project {
  const base = projectFixture({ id, name, lastActivityAt });
  return {
    ...base,
    latestSession: {
      ...base.latestSession!,
      id: id * 10,
      projectId: id,
      usage: usageFixture({ totalTokens, coverage }),
    },
  };
}

function projectCardOrder(): number[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>(".handoff-project-row"),
  ).map((row) => Number(row.dataset.testid?.replace("project-card-", "")));
}
