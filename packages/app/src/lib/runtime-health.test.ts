import { describe, expect, it } from "vitest";
import { runtimeNeedsAttention } from "./runtime-health";
import type { RuntimeStatus } from "../types";

function status(
  patch: Partial<{
    running: boolean;
    databaseExists: boolean;
    gatewayConfigured: boolean;
    summaryModelConfigured: boolean;
  }> = {},
): RuntimeStatus {
  return {
    daemon: {
      label: "com.tenten.debrief-daemon",
      installed: true,
      running: patch.running ?? true,
      pid: 123,
      state: "running",
      runtimeVersion: "0.1.0",
    },
    config: {
      exists: false,
      gatewayConfigured: patch.gatewayConfigured ?? false,
      summaryModelConfigured: patch.summaryModelConfigured ?? false,
    },
    applications: {
      visualStudioCode: false,
      warp: false,
      editor: null,
    },
    databaseExists: patch.databaseExists ?? true,
  };
}

describe("runtimeNeedsAttention", () => {
  it("does not alert for a healthy rules-fallback runtime", () => {
    expect(runtimeNeedsAttention(status(), null)).toBe(false);
  });

  it("does not alert when optional routing is only partially configured", () => {
    expect(
      runtimeNeedsAttention(
        status({ gatewayConfigured: true, summaryModelConfigured: false }),
        null,
      ),
    ).toBe(false);
  });

  it("alerts for a stopped daemon, missing database, or runtime error", () => {
    expect(runtimeNeedsAttention(status({ running: false }), null)).toBe(true);
    expect(
      runtimeNeedsAttention(status({ databaseExists: false }), null),
    ).toBe(true);
    expect(runtimeNeedsAttention(status(), "status failed")).toBe(true);
  });

  it("waits for a loaded status before showing a health alert", () => {
    expect(runtimeNeedsAttention(null, null)).toBe(false);
  });
});
