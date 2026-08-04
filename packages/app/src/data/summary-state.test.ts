import { describe, expect, it } from "vitest";
import { projectFixture } from "../test/fixtures";
import { classifySummaryState } from "./summary-state";

describe("summary availability", () => {
  const ready = projectFixture().latestSession!.summary!;

  it("does not classify a completed database query as loading", () => {
    expect(classifySummaryState(null)).toBe("awaiting-summary");
  });

  it("distinguishes deterministic fallback from a final model summary", () => {
    expect(classifySummaryState(ready)).toBe("ready");
    expect(
      classifySummaryState({ ...ready, model: "rules-fallback" }),
    ).toBe("degraded");
  });
});
