import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const migrationPath = fileURLToPath(
  new URL("../migrations/001_initial.sql", import.meta.url),
);

export type DebriefDatabase = Database.Database;

export function openDatabase(dbPath: string): DebriefDatabase {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true, mode: 0o700 });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(fs.readFileSync(migrationPath, "utf8"));
  return db;
}
