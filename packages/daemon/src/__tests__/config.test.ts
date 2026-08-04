import { describe, expect, it } from "vitest";
import { loadDaemonConfig } from "../config.js";

const missingConfig = "/debrief-test-config-does-not-exist/config.json";

describe("daemon config", () => {
  it("loads an explicit Mem0 user id from the environment", async () => {
    const config = await loadDaemonConfig(missingConfig, {
      DEBRIEF_MEM0_URL: " https://mem0.example.invalid ",
      DEBRIEF_MEM0_KEY: " fixture-key ",
      DEBRIEF_MEM0_USER_ID: " fixture-user ",
    });

    expect(config).toEqual(
      expect.objectContaining({
        mem0Url: "https://mem0.example.invalid",
        mem0Key: "fixture-key",
        mem0UserId: "fixture-user",
      }),
    );
  });

  it("does not infer a Mem0 user id from the endpoint or API key", async () => {
    const config = await loadDaemonConfig(missingConfig, {
      DEBRIEF_MEM0_URL: "https://mem0.example.invalid",
      DEBRIEF_MEM0_KEY: "fixture-key",
    });

    expect(config.mem0UserId).toBeNull();
  });
});
