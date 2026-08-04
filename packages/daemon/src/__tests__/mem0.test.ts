import { describe, expect, it } from "vitest";
import { Mem0Writer } from "../mem0.js";
import { silentLogger, startJsonServer } from "./helpers.js";

describe("Mem0Writer", () => {
  it("writes the opted-in user id without exporting the project root", async () => {
    const server = await startJsonServer(() => ({
      status: 503,
      body: { error: "fixture unavailable" },
    }));
    const warnings: Array<Record<string, unknown>> = [];
    const base = silentLogger();
    const logger = {
      debug: base.debug.bind(base),
      error: base.error.bind(base),
      info: base.info.bind(base),
      warn(object: Record<string, unknown>) {
        warnings.push(object);
      },
    };
    const writer = new Mem0Writer(
      server.url,
      "fixture-key",
      "fixture-user",
      logger,
    );

    try {
      expect(() =>
        writer.writeOutcome({
          projectName: "fixture",
          projectPath: "/tmp/fixture",
          sessionId: 42,
          stateSummary: "Updated /tmp/fixture/src.\nLine two.",
        }),
      ).not.toThrow();

      await waitFor(() => warnings.length === 1);
      const request = server.requests()[0] as {
        user_id: string;
        messages: Array<{ content: string }>;
        metadata: Record<string, unknown>;
      };
      expect(request.user_id).toBe("fixture-user");
      expect(request.messages[0]?.content).toBe(
        "fixture: Updated <project-root>/src. Line two.",
      );
      expect(request.metadata).toEqual({
        project_name: "fixture",
        session_id: 42,
        source: "debrief",
      });
      expect(JSON.stringify(request)).not.toContain("/tmp/fixture");
      expect(warnings).toContainEqual(
        expect.objectContaining({
          event: "mem0_write_failed",
          projectPath: "/tmp/fixture",
          reason: "Mem0 returned HTTP 503",
        }),
      );
    } finally {
      await server.close();
    }
  });

  it.each([
    {
      name: "endpoint",
      endpoint: null,
      userId: "fixture-user",
      reason: "endpoint_not_configured",
    },
    {
      name: "user id",
      endpoint: "https://mem0.example.invalid",
      userId: null,
      reason: "user_id_not_configured",
    },
  ])("skips when the $name is not configured", (candidate) => {
    const infos: Array<Record<string, unknown>> = [];
    const base = silentLogger();
    const logger = {
      debug: base.debug.bind(base),
      error: base.error.bind(base),
      info(object: Record<string, unknown>) {
        infos.push(object);
      },
      warn: base.warn.bind(base),
    };
    let requests = 0;
    const writer = new Mem0Writer(
      candidate.endpoint,
      null,
      candidate.userId,
      logger,
      async () => {
        requests += 1;
        return new Response(null, { status: 204 });
      },
    );

    writer.writeOutcome({
      projectName: "fixture",
      projectPath: "/tmp/fixture",
      sessionId: 42,
      stateSummary: "Done.",
    });

    expect(requests).toBe(0);
    expect(infos).toContainEqual(
      expect.objectContaining({
        event: "mem0_write_skipped",
        reason: candidate.reason,
      }),
    );
  });
});

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for Mem0 call");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
