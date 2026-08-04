import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "../db.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      fs.rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("database migration", () => {
  it("upgrades an existing database additively and idempotently", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "debrief-db-"));
    temporaryDirectories.push(root);
    const dbPath = path.join(root, "debrief.db");
    const legacy = new Database(dbPath);
    legacy.exec(`
      CREATE TABLE projects (
        id INTEGER PRIMARY KEY,
        path TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL
      );
      CREATE TABLE sessions (
        id INTEGER PRIMARY KEY,
        project_id INTEGER REFERENCES projects(id),
        tool TEXT,
        source_path TEXT UNIQUE,
        scan_offset INTEGER DEFAULT 0
      );
      INSERT INTO projects (id, path, name)
      VALUES (1, '/REDACTED/existing', 'existing');
      INSERT INTO sessions (
        id, project_id, tool, source_path, scan_offset
      ) VALUES (
        2, 1, 'codex', '/REDACTED/session.jsonl', 123
      );
    `);
    legacy.close();

    const migrated = openDatabase(dbPath);
    expect(
      migrated
        .prepare("SELECT id, scan_offset FROM sessions WHERE id = 2")
        .get(),
    ).toEqual({ id: 2, scan_offset: 123 });
    expect(
      migrated
        .prepare(
          `SELECT name FROM sqlite_master
           WHERE type = 'table'
             AND name IN ('session_usage', 'session_usage_events')
           ORDER BY name`,
        )
        .all(),
    ).toEqual([
      { name: "session_usage" },
      { name: "session_usage_events" },
    ]);
    migrated.close();

    const reopened = openDatabase(dbPath);
    expect(
      reopened
        .prepare(
          "SELECT COUNT(*) AS count FROM session_usage_events",
        )
        .get(),
    ).toEqual({ count: 0 });
    reopened.close();
  });
});
