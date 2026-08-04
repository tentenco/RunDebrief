#!/usr/bin/env node
import {
  ClaudeCodeAdapter,
  CodexAdapter,
  createCoreLogger,
  GitAdapter,
  openDatabase,
  resolveRuntimePaths,
  Scanner,
} from "./index.js";

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command !== "scan") {
    process.stderr.write("Usage: debrief scan\n");
    process.exitCode = 1;
    return;
  }

  const paths = resolveRuntimePaths();
  const logger = createCoreLogger(paths.logDir);
  const db = openDatabase(paths.dbPath);
  const abortController = new AbortController();
  const handleInterrupt = (): void => {
    abortController.abort(new Error("Scan interrupted by SIGINT"));
  };
  process.once("SIGINT", handleInterrupt);

  try {
    const scanner = new Scanner(
      db,
      [
        new ClaudeCodeAdapter(paths.claudeProjectsRoot, logger),
        new CodexAdapter(paths.codexSessionsRoot, logger),
      ],
      new GitAdapter(logger),
      logger,
    );
    const metrics = await scanner.scan({ signal: abortController.signal });
    process.stdout.write(`${JSON.stringify(metrics)}\n`);
  } catch (error) {
    if (abortController.signal.aborted) {
      logger.info({ event: "scan_interrupted" }, "Debrief scan interrupted");
      process.stderr.write("debrief scan interrupted\n");
      process.exitCode = 130;
      return;
    }
    const reason = error instanceof Error ? error.message : String(error);
    logger.error(
      { event: "scan_fatal", reason },
      "Debrief scan failed unexpectedly",
    );
    process.stderr.write(`debrief scan failed: ${reason}\n`);
    process.exitCode = 1;
  } finally {
    process.removeListener("SIGINT", handleInterrupt);
    db.close();
  }
}

await main();
