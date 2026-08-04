import type { Scanner } from "@debrief/core";
import type { SessionEndProcessor } from "./session-end.js";
import type { DaemonLogger, LiveStatusProvider } from "./types.js";
import type { SessionFileWatcher } from "./watcher.js";

const POLL_INTERVAL_MS = 30_000;
const INITIAL_BACKFILL_BATCH_SIZE = 10;

export class DebriefDaemon {
  private interval: NodeJS.Timeout | null = null;
  private cyclePromise: Promise<void> | null = null;
  private scanAbortController: AbortController | null = null;
  private needsScan = true;
  private stopping = false;

  constructor(
    private readonly scanner: Pick<Scanner, "scan">,
    private readonly liveStatus: LiveStatusProvider,
    private readonly processor: SessionEndProcessor,
    private readonly watcher: SessionFileWatcher,
    private readonly logger: DaemonLogger,
    private readonly pollIntervalMs = POLL_INTERVAL_MS,
  ) {}

  async start(): Promise<void> {
    this.watcher.start();
    await this.runCycle();
    if (this.stopping) return;
    this.interval = setInterval(() => {
      void this.runCycle();
    }, this.pollIntervalMs);
    this.interval.unref();
    this.logger.info(
      { event: "daemon_started", pollIntervalMs: this.pollIntervalMs },
      "Debrief daemon started",
    );
  }

  noteSessionObserved(sourcePath: string, observedAt: Date): void {
    this.processor.observe(sourcePath, observedAt);
    this.needsScan = true;
  }

  noteSessionRemoved(sourcePath: string): void {
    this.processor.forget(sourcePath);
  }

  async runCycle(): Promise<void> {
    if (this.cyclePromise) return this.cyclePromise;
    this.cyclePromise = this.performCycle().finally(() => {
      this.cyclePromise = null;
    });
    return this.cyclePromise;
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
    this.scanAbortController?.abort(new Error("Debrief daemon is stopping"));
    await this.cyclePromise;
    await this.watcher.close();
    this.logger.info({ event: "daemon_stopped" }, "Debrief daemon stopped");
  }

  private async performCycle(): Promise<void> {
    try {
      if (this.needsScan) {
        const abortController = new AbortController();
        this.scanAbortController = abortController;
        this.needsScan = false;
        try {
          await this.scanner.scan({ signal: abortController.signal });
        } finally {
          if (this.scanAbortController === abortController) {
            this.scanAbortController = null;
          }
        }
      }
    } catch (error) {
      this.needsScan = true;
      const details = {
        reason: error instanceof Error ? error.message : String(error),
      };
      if (this.stopping) {
        this.logger.info(
          { event: "daemon_scan_aborted", ...details },
          "Scanner stopped with the daemon",
        );
      } else {
        this.logger.error(
          { event: "daemon_scan_failed", ...details },
          "Scanner failed; daemon cycle continues",
        );
      }
    }
    if (this.stopping) return;

    try {
      await this.liveStatus.poll();
    } catch (error) {
      this.logger.error(
        {
          event: "live_poll_failed",
          reason: error instanceof Error ? error.message : String(error),
        },
        "Live status poll failed; daemon cycle continues",
      );
    }
    if (this.stopping) return;

    try {
      await this.processor.seedLatestUnsummarized(
        INITIAL_BACKFILL_BATCH_SIZE,
      );
    } catch (error) {
      this.logger.error(
        {
          event: "initial_backfill_seed_failed",
          reason: error instanceof Error ? error.message : String(error),
        },
        "Historical summary seeding failed; daemon cycle continues",
      );
    }

    await this.processor.processAllObserved();
  }
}
