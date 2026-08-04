import { describe, expect, it } from "vitest";
import { GatewaySummarizer } from "../summarizer.js";
import { summarySchema } from "../summary-schema.js";
import { silentLogger, startJsonServer } from "./helpers.js";

const input = {
  projectName: "fixture-project",
  projectPath: "/tmp/fixture-project",
  tool: "codex" as const,
  startedAt: "2026-07-29T01:00:00.000Z",
  endedAt: "2026-07-29T01:05:00.000Z",
  gitBranch: "phase-2/daemon",
  ruleStateSummary: JSON.stringify({
    version: 1,
    digest: "Implemented the watcher.",
    messages: [],
  }),
  keyFiles: ["src/watcher.ts"],
};

describe("summary schema", () => {
  it("mirrors DESIGN 2.2 as one strict object", () => {
    expect(
      summarySchema.safeParse({
        state_summary: "Done",
        open_items: [],
        next_steps: ["Verify"],
        decisions: [],
        key_files: [],
        blocked: false,
        blocked_reason: null,
      }).success,
    ).toBe(true);

    expect(
      summarySchema.safeParse({
        state_summary: "Done",
        open_items: [],
        next_steps: [],
        decisions: [],
        key_files: [],
        blocked: false,
        blocked_reason: null,
        extra: "not allowed",
      }).success,
    ).toBe(false);
  });
});

describe("GatewaySummarizer", () => {
  it("uses fallback immediately when the gateway URL is not configured", async () => {
    let requests = 0;
    const result = await new GatewaySummarizer(
      {
        gatewayUrl: "",
        gatewayKey: "",
        summaryModel: "fixture-model",
      },
      silentLogger(),
      async () => {
        requests += 1;
        throw new Error("fetch must not be called");
      },
    ).summarize(input);

    expect(result).toEqual(
      expect.objectContaining({
        model: "rules-fallback",
        degraded: true,
        attempts: 0,
      }),
    );
    expect(result.summary.state_summary).toBe("Implemented the watcher.");
    expect(requests).toBe(0);
  });

  it("retries invalid JSON once and accepts the second valid strict response", async () => {
    const valid = {
      state_summary: "Watcher integration is complete.",
      open_items: ["Measure RSS"],
      next_steps: ["Run G2"],
      decisions: ["Use injected clocks"],
      key_files: ["src/watcher.ts"],
      blocked: false,
      blocked_reason: null,
    };
    const server = await startJsonServer((requestNumber) => ({
      body: {
        choices: [
          {
            message: {
              content: requestNumber === 1 ? "not-json" : JSON.stringify(valid),
            },
          },
        ],
      },
    }));
    const outboundInput = {
      ...input,
      ruleStateSummary: JSON.stringify({
        version: 1,
        digest: `Implemented ${input.projectPath}/src/watcher.ts.`,
        messages: [],
      }),
      keyFiles: [`${input.projectPath}/src/watcher.ts`],
    };

    try {
      const result = await new GatewaySummarizer(
        {
          gatewayUrl: server.url,
          gatewayKey: "fixture-secret",
          summaryModel: "fixture-model",
        },
        silentLogger(),
      ).summarize(outboundInput);

      expect(result).toEqual({
        summary: valid,
        model: "fixture-model",
        degraded: false,
        attempts: 2,
      });
      expect(server.requests()).toHaveLength(2);
      const request = server.requests()[1] as {
        messages: Array<{ role: string; content: string }>;
      };
      const prompt = request.messages.find((message) => message.role === "user")
        ?.content;
      expect(prompt).toContain('"name": "fixture-project"');
      expect(prompt).not.toContain(input.projectPath);
      expect(prompt).not.toContain('"path"');
      expect(prompt).toContain("<project-root>/src/watcher.ts");
    } finally {
      await server.close();
    }
  });

  it("stores a valid deterministic fallback after exactly two failures", async () => {
    const server = await startJsonServer(() => ({
      body: {
        choices: [{ message: { content: "{\"blocked\":\"wrong-type\"}" } }],
      },
    }));

    try {
      const result = await new GatewaySummarizer(
        {
          gatewayUrl: server.url,
          gatewayKey: "",
          summaryModel: "fixture-model",
        },
        silentLogger(),
      ).summarize(input);

      expect(result.model).toBe("rules-fallback");
      expect(result.degraded).toBe(true);
      expect(summarySchema.parse(result.summary)).toEqual(
        expect.objectContaining({
          state_summary: "Implemented the watcher.",
          key_files: ["src/watcher.ts"],
          blocked_reason: null,
        }),
      );
      expect(server.requests()).toHaveLength(2);
    } finally {
      await server.close();
    }
  });
});
