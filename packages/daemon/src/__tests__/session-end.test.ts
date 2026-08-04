import fs from "node:fs/promises";
import path from "node:path";
import { openDatabase } from "@debrief/core";
import { afterEach, describe, expect, it } from "vitest";
import { Mem0Writer } from "../mem0.js";
import { SessionEndProcessor, SESSION_QUIET_MS } from "../session-end.js";
import { GatewaySummarizer } from "../summarizer.js";
import type { LiveStatusProvider } from "../types.js";
import { FakeClock, silentLogger, startJsonServer, temporaryDirectory } from "./helpers.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      fs.rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("SessionEndProcessor", () => {
  it("stores one final summary without replacing rules extraction", async () => {
    const root = await temporaryDirectory("debrief-daemon-end-");
    temporaryDirectories.push(root);
    const sourcePath = path.join(root, "session.jsonl");
    await fs.writeFile(sourcePath, "{}\n");
    const db = openDatabase(path.join(root, "debrief.db"));
    seedSession(db, sourcePath);
    const server = await startJsonServer(() => ({
      body: {
        choices: [
          {
            message: {
              content: JSON.stringify({
                state_summary: "The daemon summary is valid.",
                open_items: [],
                next_steps: ["Run G2"],
                decisions: ["Keep rules extraction"],
                key_files: ["src/daemon.ts"],
                blocked: false,
                blocked_reason: null,
              }),
            },
          },
        ],
      },
    }));
    const clock = new FakeClock(Date.parse("2026-07-29T12:00:00.000Z"));
    let memoryWrites = 0;
    const processor = new SessionEndProcessor(
      db,
      alwaysIdle(),
      new GatewaySummarizer(
        {
          gatewayUrl: server.url,
          gatewayKey: "",
          summaryModel: "fixture-model",
        },
        silentLogger(),
      ),
      {
        writeOutcome() {
          memoryWrites += 1;
        },
      },
      silentLogger(),
      clock,
    );

    try {
      processor.observe(sourcePath);
      expect(await processor.process(sourcePath)).toBe("not-quiet");
      clock.advance(SESSION_QUIET_MS);
      expect(await processor.process(sourcePath)).toBe("summarized");
      expect(await processor.process(sourcePath)).toBe("already-summarized");

      const rows = db
        .prepare(
          "SELECT model, state_summary FROM summaries ORDER BY id",
        )
        .all() as Array<{ model: string; state_summary: string }>;
      expect(rows).toHaveLength(2);
      expect(rows[0]?.model).toBe("rules-extraction");
      expect(JSON.parse(rows[0]!.state_summary)).toMatchObject({ version: 1 });
      expect(rows[1]).toEqual({
        model: "fixture-model",
        state_summary: "The daemon summary is valid.",
      });
      expect(server.requests()).toHaveLength(1);
      expect(memoryWrites).toBe(0);
    } finally {
      db.close();
      await server.close();
    }
  });

  it("stores rules fallback after a killed gateway and remains callable", async () => {
    const root = await temporaryDirectory("debrief-daemon-fallback-");
    temporaryDirectories.push(root);
    const sourcePath = path.join(root, "session.jsonl");
    await fs.writeFile(sourcePath, "{}\n");
    const db = openDatabase(path.join(root, "debrief.db"));
    seedSession(db, sourcePath);
    const server = await startJsonServer(() => ({ body: {} }));
    const unreachableUrl = server.url;
    await server.close();
    const clock = new FakeClock(Date.parse("2026-07-29T12:00:00.000Z"));
    const processor = new SessionEndProcessor(
      db,
      alwaysIdle(),
      new GatewaySummarizer(
        {
          gatewayUrl: unreachableUrl,
          gatewayKey: "",
          summaryModel: "fixture-model",
        },
        silentLogger(),
      ),
      { writeOutcome() {} },
      silentLogger(),
      clock,
      0,
    );
    processor.observe(sourcePath);

    expect(await processor.process(sourcePath)).toBe("degraded");
    expect(await processor.process(sourcePath)).toBe("already-summarized");
    const final = db
      .prepare(
        "SELECT model, blocked_reason FROM summaries WHERE model <> 'rules-extraction'",
      )
      .get() as { model: string; blocked_reason: string | null };
    expect(final).toEqual({ model: "rules-fallback", blocked_reason: null });
    db.close();
  });

  it("waits through the quiet window when an observed timestamp is ahead of the clock", async () => {
    const root = await temporaryDirectory("debrief-daemon-future-observation-");
    temporaryDirectories.push(root);
    const sourcePath = path.join(root, "session.jsonl");
    await fs.writeFile(sourcePath, "{}\n");
    const db = openDatabase(path.join(root, "debrief.db"));
    seedSession(db, sourcePath);
    const clock = new FakeClock(Date.parse("2026-07-29T12:00:00.000Z"));
    const processor = new SessionEndProcessor(
      db,
      alwaysIdle(),
      new GatewaySummarizer(
        {
          gatewayUrl: "",
          gatewayKey: "",
          summaryModel: "fixture-model",
        },
        silentLogger(),
      ),
      { writeOutcome() {} },
      silentLogger(),
      clock,
    );
    const observedAt = new Date(clock.now().getTime() + 1_000);
    processor.observe(sourcePath, observedAt);

    expect(await processor.process(sourcePath)).toBe("not-quiet");
    clock.advance(1_000 + SESSION_QUIET_MS - 1);
    expect(await processor.process(sourcePath)).toBe("not-quiet");
    clock.advance(1);
    expect(await processor.process(sourcePath)).toBe("degraded");
    db.close();
  });

  it("writes one brain-linked outcome and does not block on Mem0 HTTP failure", async () => {
    const root = await temporaryDirectory("debrief-daemon-mem0-");
    temporaryDirectories.push(root);
    const sourcePath = path.join(root, "session.jsonl");
    await fs.writeFile(sourcePath, "{}\n");
    const db = openDatabase(path.join(root, "debrief.db"));
    seedSession(db, sourcePath, true);
    const gateway = await startJsonServer(() => ({
      body: {
        choices: [
          {
            message: {
              content: JSON.stringify({
                state_summary: "Brain-linked summary.",
                open_items: [],
                next_steps: [],
                decisions: [],
                key_files: [],
                blocked: false,
                blocked_reason: null,
              }),
            },
          },
        ],
      },
    }));
    const mem0 = await startJsonServer(() => ({
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
    const processor = new SessionEndProcessor(
      db,
      alwaysIdle(),
      new GatewaySummarizer(
        {
          gatewayUrl: gateway.url,
          gatewayKey: "",
          summaryModel: "fixture-model",
        },
        logger,
      ),
      new Mem0Writer(mem0.url, "", "fixture-user", logger),
      logger,
      new FakeClock(Date.parse("2026-07-29T12:00:00.000Z")),
      0,
    );
    processor.observe(sourcePath);

    try {
      await expect(processor.process(sourcePath)).resolves.toBe("summarized");
      await expect(processor.process(sourcePath)).resolves.toBe(
        "already-summarized",
      );
      await waitFor(() => warnings.some((event) => event.event === "mem0_write_failed"));
      expect(mem0.requests()).toHaveLength(1);
      expect(mem0.requests()[0]).toMatchObject({
        user_id: "fixture-user",
        metadata: {
          project_name: "fixture-project",
          session_id: expect.any(Number),
          source: "debrief",
        },
      });
      expect(JSON.stringify(mem0.requests()[0])).not.toContain(root);
      expect(warnings).toContainEqual(
        expect.objectContaining({
          event: "mem0_write_failed",
          reason: "Mem0 returned HTTP 503",
        }),
      );
    } finally {
      db.close();
      await gateway.close();
      await mem0.close();
    }
  });

  it("drops terminal candidates and updates one final row after a later change", async () => {
    const root = await temporaryDirectory("debrief-daemon-resumed-");
    temporaryDirectories.push(root);
    const sourcePath = path.join(root, "session.jsonl");
    await fs.writeFile(sourcePath, "{}\n");
    const db = openDatabase(path.join(root, "debrief.db"));
    seedSession(db, sourcePath);
    const gateway = await startJsonServer((requestNumber) => ({
      body: {
        choices: [
          {
            message: {
              content: JSON.stringify({
                state_summary: `Summary version ${requestNumber}.`,
                open_items: [],
                next_steps: [],
                decisions: [],
                key_files: [],
                blocked: false,
                blocked_reason: null,
              }),
            },
          },
        ],
      },
    }));
    const clock = new FakeClock(Date.parse("2026-07-29T12:00:00.000Z"));
    const processor = new SessionEndProcessor(
      db,
      alwaysIdle(),
      new GatewaySummarizer(
        {
          gatewayUrl: gateway.url,
          gatewayKey: "",
          summaryModel: "fixture-model",
        },
        silentLogger(),
      ),
      { writeOutcome() {} },
      silentLogger(),
      clock,
      0,
    );
    processor.observe(sourcePath);

    try {
      const first = await processor.processAllObserved();
      expect(first.get(sourcePath)).toBe("summarized");
      expect(await processor.processAllObserved()).toEqual(new Map());
      const initial = db
        .prepare(
          `SELECT id, generated_at, state_summary
           FROM summaries WHERE model <> 'rules-extraction'`,
        )
        .get() as {
        id: number;
        generated_at: string;
        state_summary: string;
      };

      processor.observe(sourcePath, new Date(initial.generated_at));
      const covered = await processor.processAllObserved();
      expect(covered.get(sourcePath)).toBe("already-summarized");
      expect(await processor.processAllObserved()).toEqual(new Map());

      clock.advance(60_000);
      processor.observe(sourcePath, clock.now());
      const resumed = await processor.processAllObserved();
      expect(resumed.get(sourcePath)).toBe("summarized");
      expect(await processor.processAllObserved()).toEqual(new Map());

      const finalRows = db
        .prepare(
          `SELECT id, generated_at, state_summary
           FROM summaries WHERE model <> 'rules-extraction'`,
        )
        .all() as Array<{
        id: number;
        generated_at: string;
        state_summary: string;
      }>;
      expect(finalRows).toEqual([
        {
          id: initial.id,
          generated_at: "2026-07-29T12:01:00.000Z",
          state_summary: "Summary version 2.",
        },
      ]);
      expect(Date.parse(finalRows[0]!.generated_at)).toBeGreaterThan(
        Date.parse(initial.generated_at),
      );
      expect(
        db
          .prepare(
            "SELECT COUNT(*) AS count FROM summaries WHERE model = 'rules-extraction'",
          )
          .get(),
      ).toEqual({ count: 1 });
      expect(gateway.requests()).toHaveLength(2);
    } finally {
      db.close();
      await gateway.close();
    }
  });

  it("backfills only the newest unsummarized session per project in a bounded batch", async () => {
    const root = await temporaryDirectory("debrief-daemon-backfill-");
    temporaryDirectories.push(root);
    const oldSource = path.join(root, "old.jsonl");
    const latestSource = path.join(root, "latest.jsonl");
    await fs.writeFile(oldSource, "{}\n");
    await fs.writeFile(latestSource, "{}\n");
    const historicalTime = new Date("2026-07-29T01:00:00.000Z");
    await fs.utimes(oldSource, historicalTime, historicalTime);
    await fs.utimes(latestSource, historicalTime, historicalTime);
    const db = openDatabase(path.join(root, "debrief.db"));
    const project = db
      .prepare("INSERT INTO projects (path, name) VALUES (?, 'fixture-project')")
      .run(root);
    insertRulesSession(
      db,
      Number(project.lastInsertRowid),
      oldSource,
      "2026-07-28T01:00:00.000Z",
    );
    insertRulesSession(
      db,
      Number(project.lastInsertRowid),
      latestSource,
      "2026-07-29T01:00:00.000Z",
    );
    const processor = new SessionEndProcessor(
      db,
      alwaysIdle(),
      new GatewaySummarizer(
        {
          gatewayUrl: "",
          gatewayKey: "",
          summaryModel: "fixture-model",
        },
        silentLogger(),
      ),
      { writeOutcome() {} },
      silentLogger(),
      new FakeClock(Date.parse("2026-07-30T12:00:00.000Z")),
      0,
    );

    expect(await processor.seedLatestUnsummarized(1)).toBe(1);
    expect(await processor.processAllObserved()).toEqual(
      new Map([[latestSource, "degraded"]]),
    );
    const finals = db
      .prepare(
        `SELECT sessions.source_path
         FROM summaries
         JOIN sessions ON sessions.id = summaries.session_id
         WHERE summaries.model <> 'rules-extraction'`,
      )
      .all() as Array<{ source_path: string }>;
    expect(finals).toEqual([{ source_path: latestSource }]);
    expect(await processor.seedLatestUnsummarized(1)).toBe(0);
    db.close();
  });

  it("suppresses a missing newest backfill source until the watcher observes it again", async () => {
    const root = await temporaryDirectory("debrief-daemon-missing-backfill-");
    temporaryDirectories.push(root);
    const availableSource = path.join(root, "available.jsonl");
    const olderSource = path.join(root, "older.jsonl");
    const missingSource = path.join(root, "missing-latest.jsonl");
    await fs.writeFile(availableSource, "{}\n");
    await fs.writeFile(olderSource, "{}\n");
    const historicalTime = new Date("2026-07-29T01:00:00.000Z");
    await fs.utimes(availableSource, historicalTime, historicalTime);
    await fs.utimes(olderSource, historicalTime, historicalTime);
    const db = openDatabase(path.join(root, "debrief.db"));
    const availableProject = db
      .prepare("INSERT INTO projects (path, name) VALUES (?, 'available')")
      .run(path.join(root, "available-project"));
    insertRulesSession(
      db,
      Number(availableProject.lastInsertRowid),
      availableSource,
      "2026-07-29T02:00:00.000Z",
    );
    const missingProject = db
      .prepare("INSERT INTO projects (path, name) VALUES (?, 'missing')")
      .run(path.join(root, "missing-project"));
    insertRulesSession(
      db,
      Number(missingProject.lastInsertRowid),
      olderSource,
      "2026-07-28T01:00:00.000Z",
    );
    insertRulesSession(
      db,
      Number(missingProject.lastInsertRowid),
      missingSource,
      "2026-07-29T03:00:00.000Z",
    );
    const warnings: Array<Record<string, unknown>> = [];
    const baseLogger = silentLogger();
    const logger = {
      debug: baseLogger.debug.bind(baseLogger),
      error: baseLogger.error.bind(baseLogger),
      info: baseLogger.info.bind(baseLogger),
      warn(object: Record<string, unknown>) {
        warnings.push(object);
      },
    };
    const processor = new SessionEndProcessor(
      db,
      alwaysIdle(),
      new GatewaySummarizer(
        {
          gatewayUrl: "",
          gatewayKey: "",
          summaryModel: "fixture-model",
        },
        logger,
      ),
      { writeOutcome() {} },
      logger,
      new FakeClock(Date.parse("2026-07-30T12:00:00.000Z")),
      0,
    );

    expect(await processor.seedLatestUnsummarized(1)).toBe(1);
    expect(warnings).toEqual([
      expect.objectContaining({
        event: "backfill_candidate_stat_failed",
        sourcePath: missingSource,
        suppressed: true,
      }),
    ]);
    expect(await processor.processAllObserved()).toEqual(
      new Map([[availableSource, "degraded"]]),
    );

    expect(await processor.seedLatestUnsummarized(1)).toBe(0);
    expect(await processor.seedLatestUnsummarized(1)).toBe(0);
    expect(warnings).toHaveLength(1);
    expect(
      db
        .prepare(
          `SELECT COUNT(*) AS count
           FROM summaries
           JOIN sessions ON sessions.id = summaries.session_id
           WHERE summaries.model <> 'rules-extraction'
             AND sessions.source_path = ?`,
        )
        .get(olderSource),
    ).toEqual({ count: 0 });

    await fs.writeFile(missingSource, "{}\n");
    expect(await processor.seedLatestUnsummarized(1)).toBe(0);
    expect(await processor.processAllObserved()).toEqual(new Map());
    processor.observe(missingSource);
    expect(await processor.processAllObserved()).toEqual(
      new Map([[missingSource, "degraded"]]),
    );
    expect(warnings).toHaveLength(1);
    db.close();
  });
});

function seedSession(
  db: ReturnType<typeof openDatabase>,
  sourcePath: string,
  brainLinked = false,
): void {
  const project = db
    .prepare(
      `INSERT INTO projects (path, name, brain_linked)
       VALUES (?, 'fixture-project', ?)`,
    )
    .run(path.dirname(sourcePath), brainLinked ? 1 : 0);
  const session = db
    .prepare(
      `INSERT INTO sessions (
         project_id, tool, source_path, started_at, ended_at, git_branch
       ) VALUES (?, 'codex', ?, ?, ?, 'phase-2/daemon')`,
    )
    .run(
      Number(project.lastInsertRowid),
      sourcePath,
      "2026-07-29T01:00:00.000Z",
      "2026-07-29T01:05:00.000Z",
    );
  db.prepare(
    `INSERT INTO summaries (
       session_id, project_id, generated_at, model, state_summary,
       open_items, next_steps, decisions, key_files, blocked
     ) VALUES (?, ?, ?, 'rules-extraction', ?, '[]', '[]', '[]', ?, 0)`,
  ).run(
    Number(session.lastInsertRowid),
    Number(project.lastInsertRowid),
    "2026-07-29T01:05:00.000Z",
    JSON.stringify({
      version: 1,
      digest: "Deterministic extraction remains intact.",
      messages: [],
      git: null,
    }),
    JSON.stringify(["src/daemon.ts"]),
  );
}

function insertRulesSession(
  db: ReturnType<typeof openDatabase>,
  projectId: number,
  sourcePath: string,
  endedAt: string,
): void {
  const session = db
    .prepare(
      `INSERT INTO sessions (
         project_id, tool, source_path, started_at, ended_at
       ) VALUES (?, 'codex', ?, ?, ?)`,
    )
    .run(projectId, sourcePath, endedAt, endedAt);
  db.prepare(
    `INSERT INTO summaries (
       session_id, project_id, generated_at, model, state_summary,
       open_items, next_steps, decisions, key_files, blocked
     ) VALUES (?, ?, ?, 'rules-extraction', ?, '[]', '[]', '[]', '[]', 0)`,
  ).run(
    Number(session.lastInsertRowid),
    projectId,
    endedAt,
    JSON.stringify({
      version: 1,
      digest: `Extraction for ${path.basename(sourcePath)}`,
      messages: [],
      git: null,
    }),
  );
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for Mem0 call");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function alwaysIdle(): LiveStatusProvider {
  return {
    poll: async () => [],
    isProjectLive: () => false,
  };
}
