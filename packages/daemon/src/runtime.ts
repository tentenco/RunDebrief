import {
  openDatabase,
  resolveRuntimePaths,
} from "@debrief/core";
import { DebriefDaemon } from "./daemon.js";
import { loadDaemonConfig } from "./config.js";
import { LiveProcessDetector } from "./live-detection.js";
import { createDaemonLogger } from "./logger.js";
import { Mem0Writer } from "./mem0.js";
import { ChildScanRunner } from "./scan-child.js";
import { SessionEndProcessor } from "./session-end.js";
import { GatewaySummarizer } from "./summarizer.js";
import { SessionFileWatcher } from "./watcher.js";

export interface RunDaemonOptions {
  cliEntryPath: string;
  nodeArguments?: readonly string[];
}

export async function runDaemon(options: RunDaemonOptions): Promise<void> {
  const paths = resolveRuntimePaths();
  const logger = createDaemonLogger(paths.logDir);
  const config = await loadDaemonConfig(paths.configPath);
  const db = openDatabase(paths.dbPath);
  const scanner = new ChildScanRunner(
    process.execPath,
    options.cliEntryPath,
    logger,
    options.nodeArguments,
  );
  const liveStatus = new LiveProcessDetector(db, logger);
  const summarizer = new GatewaySummarizer(config, logger);
  const memories = new Mem0Writer(
    config.mem0Url,
    config.mem0Key,
    config.mem0UserId,
    logger,
  );
  const processor = new SessionEndProcessor(
    db,
    liveStatus,
    summarizer,
    memories,
    logger,
  );

  let daemon: DebriefDaemon | undefined;
  const watcher = new SessionFileWatcher(
    {
      claudeProjectsRoot: paths.claudeProjectsRoot,
      codexSessionsRoot: paths.codexSessionsRoot,
    },
    (sourcePath, observedAt) => daemon?.noteSessionObserved(sourcePath, observedAt),
    (sourcePath) => daemon?.noteSessionRemoved(sourcePath),
    logger,
  );
  daemon = new DebriefDaemon(
    scanner,
    liveStatus,
    processor,
    watcher,
    logger,
  );

  let stopping = false;
  const stop = async (signal: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    logger.info({ event: "daemon_signal", signal }, "Stopping daemon");
    await daemon!.stop();
    db.close();
  };
  process.once("SIGINT", () => {
    void stop("SIGINT");
  });
  process.once("SIGTERM", () => {
    void stop("SIGTERM");
  });

  try {
    await daemon.start();
    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (stopping) {
          clearInterval(check);
          resolve();
        }
      }, 50);
    });
  } catch (error) {
    if (!stopping) {
      await daemon.stop().catch(() => undefined);
      db.close();
    }
    throw error;
  }
}
