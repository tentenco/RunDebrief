import { describe, expect, it } from "vitest";
import i18n from "../i18n";
import { projectFixture, usageFixture } from "../test/fixtures";
import {
  formatCompactTokens,
  formatExactTokens,
  sessionUsageDescription,
  usageScopeLabel,
} from "./session-usage";

describe("session usage presentation", () => {
  it("keeps missing, explicit zero, compact large, and exact values distinct", () => {
    expect(formatCompactTokens(null, "en")).toBe("—");
    expect(formatCompactTokens(0, "en")).toBe("0");
    expect(formatCompactTokens(15_789_321, "en")).toBe("15.8M");
    expect(formatExactTokens(15_789_321, "en")).toBe("15,789,321");
  });

  it("labels partial live coverage with both honest scopes", () => {
    const session = {
      ...projectFixture().latestSession!,
      usage: usageFixture({ coverage: "partial" }),
    };

    expect(usageScopeLabel(session, true, i18n.t)).toBe(
      "截至目前 · 自建立索引起",
    );
  });

  it("describes latest-model and total scope in both locales", async () => {
    const session = {
      ...projectFixture().latestSession!,
      usage: usageFixture({
        model: "provider-native-model-v2",
        totalTokens: 15_789_321,
      }),
    };

    await i18n.changeLanguage("zh-Hant");
    expect(
      sessionUsageDescription(session, false, i18n.t, "zh-Hant"),
    ).toBe(
      "Token 用量：OpenAI；最新模型 provider-native-model-v2；總量 15,789,321 tokens；範圍 整個 session",
    );

    await i18n.changeLanguage("en");
    expect(sessionUsageDescription(session, false, i18n.t, "en")).toBe(
      "Token usage: OpenAI; latest model provider-native-model-v2; total 15,789,321 tokens; scope Whole session",
    );
  });
});
