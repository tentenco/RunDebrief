import { describe, expect, it } from "vitest";
import { formatDateTime, formatRelative } from "./time";

describe("locale-aware time formatting", () => {
  const now = new Date("2026-07-30T08:00:00.000Z");
  const oneHourEarlier = "2026-07-30T07:00:00.000Z";

  it("formats relative time with the selected locale", () => {
    expect(formatRelative(oneHourEarlier, now, "en")).toBe(
      new Intl.RelativeTimeFormat("en", { numeric: "auto" }).format(
        -1,
        "hour",
      ),
    );
    expect(formatRelative(oneHourEarlier, now, "zh-Hant")).toBe(
      new Intl.RelativeTimeFormat("zh-Hant", { numeric: "auto" }).format(
        -1,
        "hour",
      ),
    );
  });

  it("localizes empty, invalid, and absolute time states", () => {
    expect(formatRelative(null, now, "en")).toBe("No activity recorded");
    expect(formatRelative(null, now, "zh-Hant")).toBe("沒有活動紀錄");
    expect(formatDateTime("not-a-date", "en")).toBe("Unknown time");
    expect(formatDateTime("not-a-date", "zh-Hant")).toBe("時間未知");
    expect(formatDateTime(oneHourEarlier, "en")).toBe(
      new Intl.DateTimeFormat("en", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(oneHourEarlier)),
    );
  });
});
