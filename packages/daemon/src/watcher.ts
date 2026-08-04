import fs from "node:fs/promises";
import path from "node:path";
import chokidar, { type FSWatcher, type WatchOptions } from "chokidar";
import type { Clock, DaemonLogger } from "./types.js";
import { systemClock } from "./types.js";

export interface SessionRoots {
  claudeProjectsRoot: string;
  codexSessionsRoot: string;
}

export type SessionObserved = (
  sourcePath: string,
  observedAt: Date,
) => void;

export type WatchFactory = (
  paths: string | readonly string[],
  options?: WatchOptions,
) => FSWatcher;

export class SessionFileWatcher {
  private watcher: FSWatcher | null = null;

  constructor(
    private readonly roots: SessionRoots,
    private readonly onObserved: SessionObserved,
    private readonly onRemoved: (sourcePath: string) => void,
    private readonly logger: DaemonLogger,
    private readonly clock: Clock = systemClock,
    private readonly watchFactory: WatchFactory = chokidar.watch,
  ) {}

  start(): void {
    if (this.watcher) return;
    const patterns = buildWatchPatterns(this.roots);
    this.watcher = this.watchFactory(patterns, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 1_000,
        pollInterval: 100,
      },
    });
    this.watcher.on("add", (sourcePath) => {
      void this.observeExisting(sourcePath);
    });
    this.watcher.on("change", (sourcePath) => {
      this.onObserved(sourcePath, this.clock.now());
    });
    this.watcher.on("unlink", (sourcePath) => {
      this.onRemoved(sourcePath);
    });
    this.watcher.on("error", (error) => {
      this.logger.error(
        {
          event: "watcher_error",
          reason: error instanceof Error ? error.message : String(error),
        },
        "Session watcher error; daemon remains alive",
      );
    });
    this.logger.info(
      { event: "watcher_started", patterns },
      "Session watcher started",
    );
  }

  async close(): Promise<void> {
    const watcher = this.watcher;
    this.watcher = null;
    await watcher?.close();
  }

  private async observeExisting(sourcePath: string): Promise<void> {
    try {
      const stat = await fs.stat(sourcePath);
      this.onObserved(sourcePath, stat.mtime);
    } catch (error) {
      this.logger.warn(
        {
          event: "watched_file_stat_failed",
          sourcePath,
          reason: error instanceof Error ? error.message : String(error),
        },
        "Could not inspect watched session",
      );
    }
  }
}

export function buildWatchPatterns(roots: SessionRoots): string[] {
  return [
    path.join(roots.claudeProjectsRoot, "*", "*.jsonl"),
    path.join(roots.codexSessionsRoot, "**", "*.jsonl"),
  ];
}
