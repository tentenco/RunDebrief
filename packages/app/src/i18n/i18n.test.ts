// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import {
  LOCALE_STORAGE_KEY,
  localeFromLanguages,
  localeFromSearch,
  normalizeLocale,
  readLocalePreference,
  resolveInitialLocale,
  writeLocalePreference,
} from ".";
import i18n from ".";
import { en, zhHans, zhHant } from "./resources";

function leafKeys(value: unknown, prefix = ""): string[] {
  if (!value || typeof value !== "object") return [prefix];
  return Object.entries(value).flatMap(([key, nested]) =>
    leafKeys(nested, prefix ? `${prefix}.${key}` : key),
  );
}

describe("locale preferences", () => {
  it("normalizes supported English, Traditional Chinese, and Simplified Chinese locales", () => {
    expect(normalizeLocale("zh-TW")).toBe("zh-Hant");
    expect(normalizeLocale("zh_Hant")).toBe("zh-Hant");
    expect(normalizeLocale("zh-HK")).toBe("zh-Hant");
    expect(normalizeLocale("zh-MO")).toBe("zh-Hant");
    expect(normalizeLocale("zh-CN")).toBe("zh-CN");
    expect(normalizeLocale("zh_Hans")).toBe("zh-CN");
    expect(normalizeLocale("zh-SG")).toBe("zh-CN");
    expect(normalizeLocale("en-US")).toBe("en");
    expect(normalizeLocale("fr")).toBeNull();
  });

  it("uses navigator language order and falls back to English", () => {
    expect(localeFromLanguages(["fr-FR", "zh-TW"])).toBe("zh-Hant");
    expect(localeFromLanguages(["fr-FR", "zh-CN"])).toBe("zh-CN");
    expect(localeFromLanguages(["en-US", "zh-TW"])).toBe("en");
    expect(localeFromLanguages(["fr-FR"])).toBe("en");
  });

  it("reads and writes only an explicit supported preference", () => {
    writeLocalePreference(window.localStorage, "zh-Hant");
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("zh-Hant");
    expect(readLocalePreference(window.localStorage)).toBe("zh-Hant");
    writeLocalePreference(window.localStorage, "zh-CN");
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("zh-CN");
    expect(readLocalePreference(window.localStorage)).toBe("zh-CN");
    window.localStorage.setItem(LOCALE_STORAGE_KEY, "fr");
    expect(readLocalePreference(window.localStorage)).toBeNull();
  });

  it("uses a demo query override without replacing stored preference", () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, "zh-Hant");
    expect(localeFromSearch("?locale=en")).toBe("en");
    expect(localeFromSearch("?locale=zh-CN")).toBe("zh-CN");
    expect(localeFromSearch("?locale=zh-Hans")).toBe("zh-CN");
    expect(
      resolveInitialLocale({
        storage: window.localStorage,
        languages: ["zh-TW"],
        search: "?locale=en",
        demo: true,
      }),
    ).toEqual({ locale: "en", forced: true });
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("zh-Hant");
  });
});

describe("translation resources", () => {
  it("keeps all three locale leaf keys in exact parity", () => {
    expect(leafKeys(en).sort()).toEqual(leafKeys(zhHant).sort());
    expect(leafKeys(en).sort()).toEqual(leafKeys(zhHans).sort());
  });

  it("keeps Simplified Chinese UI copy free of Traditional-only glyphs", () => {
    const values = JSON.stringify(zhHans);
    expect(values).not.toMatch(
      /[專設儲開載選尋導覽執機檢應隱權介檔資庫錄連線獲讀偵測複製調曳雙擊鎖碼覆體]/,
    );
  });

  it("describes asynchronous native application opens as in progress", async () => {
    await i18n.changeLanguage("en");
    expect(
      i18n.t("app.visualStudioCodeOpening", { project: "Debrief" }),
    ).toBe("Opening Debrief in Visual Studio Code");
    expect(i18n.t("app.warpOpening", { project: "Debrief" })).toBe(
      "Opening the Debrief project directory in Warp",
    );

    await i18n.changeLanguage("zh-Hant");
    expect(
      i18n.t("app.visualStudioCodeOpening", { project: "Debrief" }),
    ).toBe("正在 Visual Studio Code 開啟 Debrief");
    expect(i18n.t("app.warpOpening", { project: "Debrief" })).toBe(
      "正在 Warp 開啟 Debrief 專案目錄",
    );

    await i18n.changeLanguage("zh-CN");
    expect(
      i18n.t("app.visualStudioCodeOpening", { project: "Debrief" }),
    ).toBe("正在 Visual Studio Code 打开 Debrief");
    expect(i18n.t("app.warpOpening", { project: "Debrief" })).toBe(
      "正在 Warp 打开 Debrief 项目目录",
    );
  });

  it("uses singular and plural English leaves for every count-bearing phrase", async () => {
    await i18n.changeLanguage("en");
    const cases = [
      [
        "sidebar.projectCount",
        ["0 projects", "1 project", "2 projects"],
      ],
      [
        "app.reviewAttention",
        [
          "Review 0 projects with blockers or pending decisions first.",
          "Review 1 project with blockers or pending decisions first.",
          "Review 2 projects with blockers or pending decisions first.",
        ],
      ],
      ["app.projectCount", ["0 projects", "1 project", "2 projects"]],
      [
        "app.overviewRunning",
        [
          "0 Agents are working",
          "1 Agent is working",
          "2 Agents are working",
        ],
      ],
      [
        "app.overviewAttention",
        [
          "0 projects need a decision or verification",
          "1 project needs a decision or verification",
          "2 projects need a decision or verification",
        ],
      ],
      [
        "app.recentDescription",
        [
          "0 visible projects sorted by last activity.",
          "1 visible project sorted by last activity.",
          "2 visible projects sorted by last activity.",
        ],
      ],
      [
        "sources.readyCount",
        ["0 ready sources", "1 ready source", "2 ready sources"],
      ],
      [
        "sources.indexLoaded",
        ["0 projects loaded", "1 project loaded", "2 projects loaded"],
      ],
      [
        "sources.claudeDetail",
        [
          "Latest indexed session evidence for 0 projects",
          "Latest indexed session evidence for 1 project",
          "Latest indexed session evidence for 2 projects",
        ],
      ],
      [
        "sources.codexDetail",
        [
          "Latest indexed session evidence for 0 projects",
          "Latest indexed session evidence for 1 project",
          "Latest indexed session evidence for 2 projects",
        ],
      ],
      [
        "sources.liveDetail",
        [
          "0 projects have current live_status evidence",
          "1 project has current live_status evidence",
          "2 projects have current live_status evidence",
        ],
      ],
      ["detail.sessionCount", ["0 sessions", "1 session", "2 sessions"]],
      [
        "detail.openItemCount",
        ["0 open items", "1 open item", "2 open items"],
      ],
      [
        "detail.decisionCount",
        ["0 key decisions", "1 key decision", "2 key decisions"],
      ],
      ["detail.fileCount", ["0 key files", "1 key file", "2 key files"]],
      ["detail.totalTurns", ["0 turns", "1 turn", "2 turns"]],
      [
        "detail.skippedLines",
        [
          "Skipped 0 oversized or unrecognized lines.",
          "Skipped 1 oversized or unrecognized line.",
          "Skipped 2 oversized or unrecognized lines.",
        ],
      ],
    ] as const;

    for (const [key, expected] of cases) {
      expect([0, 1, 2].map((count) => i18n.t(key, { count }))).toEqual(
        expected,
      );
    }
    expect(
      [0, 1, 2].map((count) =>
        i18n.t("detail.latestTurns", {
          count,
          visible: count,
          total: count,
        }),
      ),
    ).toEqual([
      "Showing the latest 0 of 0 turns",
      "Showing the latest 1 of 1 turn",
      "Showing the latest 2 of 2 turns",
    ]);
    await i18n.changeLanguage("zh-Hant");
  });
});
