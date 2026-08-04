import fs from "node:fs";
import path from "node:path";
import { Writable } from "node:stream";
import pino, { type Logger } from "pino";
import type { Clock } from "./types.js";
import { systemClock } from "./types.js";

const RETENTION_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1_000;
const LOG_PATTERN = /^daemon-(\d{4}-\d{2}-\d{2})\.log$/;

export function createDaemonLogger(
  logDir: string,
  clock: Clock = systemClock,
): Logger {
  const destination = new DailyRotatingDestination(logDir, clock);
  return pino(
    {
      base: { service: "debrief-daemon" },
      level: process.env.DEBRIEF_LOG_LEVEL ?? "info",
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    destination,
  );
}

export class DailyRotatingDestination extends Writable {
  private activeDate = "";
  private activeStream: fs.WriteStream | null = null;

  constructor(
    private readonly logDir: string,
    private readonly clock: Clock = systemClock,
  ) {
    super();
    fs.mkdirSync(logDir, { recursive: true, mode: 0o700 });
    this.rotateIfNeeded();
  }

  override _write(
    chunk: Buffer | string,
    encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    try {
      this.rotateIfNeeded();
      this.activeStream?.write(chunk, encoding, callback);
    } catch (error) {
      callback(error instanceof Error ? error : new Error(String(error)));
    }
  }

  override _final(callback: (error?: Error | null) => void): void {
    if (!this.activeStream) {
      callback();
      return;
    }
    this.activeStream.end(callback);
  }

  private rotateIfNeeded(): void {
    const date = dateKey(this.clock.now());
    if (date === this.activeDate && this.activeStream) return;

    this.activeStream?.end();
    this.activeDate = date;
    this.pruneExpired();
    this.activeStream = fs.createWriteStream(
      path.join(this.logDir, `daemon-${date}.log`),
      { flags: "a", mode: 0o600 },
    );
  }

  private pruneExpired(): void {
    const cutoff = this.clock.now().getTime() - RETENTION_DAYS * DAY_MS;
    for (const entry of fs.readdirSync(this.logDir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const match = LOG_PATTERN.exec(entry.name);
      if (!match?.[1]) continue;
      const timestamp = Date.parse(`${match[1]}T00:00:00.000Z`);
      if (Number.isFinite(timestamp) && timestamp < cutoff) {
        fs.rmSync(path.join(this.logDir, entry.name));
      }
    }
  }
}

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}
