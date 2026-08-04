import { describe, expect, it } from "vitest";
import type { ScanMetrics } from "@debrief/core";
import { DebriefDaemon } from "../daemon.js";
import type { SessionEndProcessor } from "../session-end.js";
import type { DaemonLogger, LiveStatusProvider } from "../types.js";
import type { SessionFileWatcher } from "../watcher.js";

describe("DebriefDaemon lifecycle", () => {
  it("aborts an in-flight scan before waiting for shutdown", async () => {
    let scanSignal: AbortSignal | undefined;
    let scanStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      scanStarted = resolve;
    });
    const scanner = {
      scan: ({ signal }: { signal?: AbortSignal } = {}) => {
        scanSignal = signal;
        scanStarted();
        return new Promise<never>((_resolve, reject) => {
          signal?.addEventListener(
            "abort",
            () => reject(signal.reason),
            { once: true },
          );
        });
      },
    };
    let watcherClosed = false;
    const watcher = {
      start() {},
      async close() {
        watcherClosed = true;
      },
    } as unknown as SessionFileWatcher;
    const processor = {
      seedLatestUnsummarized: async () => 0,
      processAllObserved: async () => new Map(),
    } as unknown as SessionEndProcessor;
    const live: LiveStatusProvider = {
      poll: async () => [],
      isProjectLive: () => false,
    };
    const logger = silentDaemonLogger();
    const daemon = new DebriefDaemon(
      scanner,
      live,
      processor,
      watcher,
      logger,
      60_000,
    );

    const startPromise = daemon.start();
    await started;
    await daemon.stop();
    await startPromise;

    expect(scanSignal?.aborted).toBe(true);
    expect(watcherClosed).toBe(true);
  });

  it("keeps a watcher event queued when it arrives during a child scan", async () => {
    let releaseFirst!: () => void;
    let firstStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      firstStarted = resolve;
    });
    let scans = 0;
    const scanner = {
      async scan() {
        scans += 1;
        if (scans !== 1) return emptyMetrics();
        firstStarted();
        await new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
        return emptyMetrics();
      },
    };
    const daemon = testDaemon(scanner);

    const starting = daemon.start();
    await started;
    daemon.noteSessionObserved("/tmp/new-session.jsonl", new Date());
    releaseFirst();
    await starting;
    await daemon.runCycle();
    await daemon.stop();

    expect(scans).toBe(2);
  });

  it("requeues a failed child scan for the next cycle", async () => {
    let scans = 0;
    const scanner = {
      async scan() {
        scans += 1;
        if (scans === 1) throw new Error("fixture child failed");
        return emptyMetrics();
      },
    };
    const daemon = testDaemon(scanner);

    await daemon.start();
    await daemon.runCycle();
    await daemon.stop();

    expect(scans).toBe(2);
  });
});

function silentDaemonLogger(): DaemonLogger {
  return {
    debug() {},
    error() {},
    info() {},
    warn() {},
  };
}

function testDaemon(scanner: {
  scan(options?: { signal?: AbortSignal }): Promise<ScanMetrics>;
}): DebriefDaemon {
  const processor = {
    observe() {},
    forget() {},
    seedLatestUnsummarized: async () => 0,
    processAllObserved: async () => new Map(),
  } as unknown as SessionEndProcessor;
  const live: LiveStatusProvider = {
    poll: async () => [],
    isProjectLive: () => false,
  };
  const watcher = {
    start() {},
    async close() {},
  } as unknown as SessionFileWatcher;
  return new DebriefDaemon(
    scanner,
    live,
    processor,
    watcher,
    silentDaemonLogger(),
    60_000,
  );
}

function emptyMetrics(): ScanMetrics {
  return {
    discoveredFiles: 0,
    discoveredSourceBytes: 0,
    metadataBytesRead: 0,
    selectedFiles: 0,
    selectedSourceBytes: 0,
    deferredFiles: 0,
    parsedFiles: 0,
    unchangedFiles: 0,
    skippedFiles: 0,
    parsedBytes: 0,
    projectCount: 0,
  };
}
