#!/usr/bin/env node
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ClaudeCodeAdapter,
  CodexAdapter,
  createCoreLogger,
  GitAdapter,
  openDatabase,
  resolveRuntimePaths,
  Scanner,
} from "@debrief/core";
import { LaunchdManager } from "./launchd.js";
import { stageRuntimePackage } from "./runtime-package.js";
import { runDaemon } from "./runtime.js";

async function main(): Promise<void> {
  const [command, subcommand, ...args] = process.argv.slice(2);
  if (command === "runtime" && subcommand === "verify") {
    verifyRuntime();
    return;
  }
  if (command === "scan") {
    await runScan();
    return;
  }
  if (command !== "daemon") {
    usage();
    process.exitCode = 1;
    return;
  }

  if (subcommand === "run") {
    await runDaemon({
      cliEntryPath: fileURLToPath(import.meta.url),
      nodeArguments: process.execArgv,
    });
    return;
  }

  const paths = resolveRuntimePaths();
  let nodeExecutablePath = process.execPath;
  let daemonEntryPath = fileURLToPath(import.meta.url);
  let runtimePath: string | null = null;
  let staged:
    | Awaited<ReturnType<typeof stageRuntimePackage>>
    | undefined;
  if (subcommand === "install") {
    const runtimeSource =
      optionValue(args, "--runtime-source") ??
      process.env.DEBRIEF_RUNTIME_SOURCE;
    if (!runtimeSource) {
      throw new Error(
        "A packaged runtime is required. Pass --runtime-source <directory>.",
      );
    }
    staged = await stageRuntimePackage(
      path.resolve(runtimeSource),
      paths.debriefHome,
    );
    nodeExecutablePath = staged.nodePath;
    daemonEntryPath = staged.entryPath;
    runtimePath = staged.runtimePath;
  }
  const launchd = new LaunchdManager({
    launchAgentsDir:
      process.env.DEBRIEF_LAUNCH_AGENTS_DIR ??
      path.join(os.homedir(), "Library", "LaunchAgents"),
    nodeExecutablePath,
    daemonEntryPath,
    runtimePath,
    debriefHome: paths.debriefHome,
    logDir: paths.logDir,
    uid: process.getuid?.() ?? 0,
  });

  if (subcommand === "install") {
    const status = await launchd.install();
    process.stdout.write(
      `${JSON.stringify({
        ...status,
        runtimePath: staged!.runtimePath,
        runtimeVersion: staged!.runtimeVersion,
        reused: staged!.reused,
        repaired: staged!.repaired,
        quarantinePath: staged!.quarantinePath,
      })}\n`,
    );
    return;
  }
  if (subcommand === "status") {
    const status = await launchd.status();
    process.stdout.write(`${JSON.stringify(status)}\n`);
    return;
  }
  if (subcommand === "logs") {
    const lines = parseLineCount(args);
    const output = await launchd.logs(lines);
    if (output) process.stdout.write(`${output}\n`);
    return;
  }

  usage();
  process.exitCode = 1;
}

async function runScan(): Promise<void> {
  const paths = resolveRuntimePaths();
  const logger = createCoreLogger(paths.logDir);
  const db = openDatabase(paths.dbPath);
  const abortController = new AbortController();
  const interrupt = (): void => {
    abortController.abort(new Error("Scan interrupted by SIGINT"));
  };
  process.once("SIGINT", interrupt);
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
    process.stdout.write(
      `${JSON.stringify(
        await scanner.scan({ signal: abortController.signal }),
      )}\n`,
    );
  } catch (error) {
    if (!abortController.signal.aborted) throw error;
    process.stderr.write("debrief scan interrupted\n");
    process.exitCode = 130;
  } finally {
    process.removeListener("SIGINT", interrupt);
    db.close();
  }
}

function parseLineCount(args: string[]): number {
  const index = args.indexOf("--lines");
  if (index < 0) return 100;
  const value = Number(args[index + 1]);
  return Number.isInteger(value) && value > 0 ? value : 100;
}

function optionValue(args: string[], option: string): string | null {
  const index = args.indexOf(option);
  if (index < 0) return null;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${option} requires a value`);
  }
  return value;
}

function verifyRuntime(): void {
  const db = openDatabase(":memory:");
  try {
    const database = db.prepare("SELECT sqlite_version() AS version").get() as {
      version: string;
    };
    process.stdout.write(
      `${JSON.stringify({
        nodeVersion: process.version,
        nodeAbi: process.versions.modules,
        platform: process.platform,
        arch: process.arch,
        database: database.version ? "ok" : "failed",
      })}\n`,
    );
  } finally {
    db.close();
  }
}

function usage(): void {
  process.stderr.write(
    "Usage: debrief scan | debrief daemon install --runtime-source <directory> | debrief daemon status|logs [--lines N] | debrief daemon run | debrief runtime verify\n",
  );
}

await main().catch((error) => {
  const reason = error instanceof Error ? error.message : String(error);
  process.stderr.write(`debrief failed: ${reason}\n`);
  process.exitCode = 1;
});
