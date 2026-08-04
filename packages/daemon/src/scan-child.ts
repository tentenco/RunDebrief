import { spawn, type ChildProcess } from "node:child_process";
import type { ScanMetrics, ScanOptions } from "@debrief/core";
import type { DaemonLogger } from "./types.js";

const OUTPUT_LIMIT_BYTES = 64 * 1024;
const KILL_GRACE_MS = 5_000;

export type SpawnChild = typeof spawn;

export class ChildScanRunner {
  constructor(
    private readonly nodeExecutablePath: string,
    private readonly cliEntryPath: string,
    private readonly logger: DaemonLogger,
    private readonly nodeArguments: readonly string[] = [],
    private readonly spawnChild: SpawnChild = spawn,
    private readonly killGraceMs = KILL_GRACE_MS,
  ) {}

  async scan(options: ScanOptions = {}): Promise<ScanMetrics> {
    if (options.signal?.aborted) throw abortReason(options.signal);
    const child = this.spawnChild(
      this.nodeExecutablePath,
      [...this.nodeArguments, this.cliEntryPath, "scan"],
      {
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const stdout = captureBounded(child.stdout, OUTPUT_LIMIT_BYTES);
    const stderr = captureBounded(child.stderr, OUTPUT_LIMIT_BYTES);
    this.logger.info(
      {
        event: "scan_child_started",
        pid: child.pid ?? null,
      },
      "Scanner child started",
    );

    const exit = await waitForChild(
      child,
      options.signal,
      this.killGraceMs,
    );
    const stdoutResult = stdout.result();
    const stderrResult = stderr.result();
    if (options.signal?.aborted) throw abortReason(options.signal);
    if (exit.code !== 0) {
      throw new Error(
        `Scanner child exited ${exit.code ?? `by ${exit.signal ?? "signal"}`}: ${boundedMessage(stderrResult)}`,
      );
    }
    if (stdoutResult.truncated) {
      throw new Error("Scanner child stdout exceeded its bounded capture");
    }

    const metrics = decodeScanMetrics(stdoutResult.text);
    this.logger.info(
      {
        event: "scan_child_complete",
        pid: child.pid ?? null,
        ...metrics,
      },
      "Scanner child completed",
    );
    return metrics;
  }
}

function waitForChild(
  child: ChildProcess,
  signal: AbortSignal | undefined,
  killGraceMs: number,
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => {
    let killTimer: NodeJS.Timeout | undefined;
    const cleanup = (): void => {
      signal?.removeEventListener("abort", abort);
      if (killTimer) clearTimeout(killTimer);
    };
    const abort = (): void => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill("SIGINT");
      killTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill("SIGKILL");
        }
      }, killGraceMs);
      killTimer.unref();
    };
    signal?.addEventListener("abort", abort, { once: true });
    child.once("error", (error) => {
      cleanup();
      reject(error);
    });
    child.once("close", (code, childSignal) => {
      cleanup();
      resolve({ code, signal: childSignal });
    });
    if (signal?.aborted) abort();
  });
}

function captureBounded(
  stream: NodeJS.ReadableStream | null,
  limit: number,
): {
  result(): { text: string; truncated: boolean };
} {
  const chunks: Buffer[] = [];
  let captured = 0;
  let truncated = false;
  stream?.on("data", (value: Buffer | string) => {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    const available = Math.max(0, limit - captured);
    if (available > 0) {
      const retained = chunk.subarray(0, available);
      chunks.push(retained);
      captured += retained.length;
    }
    if (chunk.length > available) truncated = true;
  });
  return {
    result: () => ({
      text: Buffer.concat(chunks, captured).toString("utf8"),
      truncated,
    }),
  };
}

function decodeScanMetrics(output: string): ScanMetrics {
  const line = output
    .split("\n")
    .map((candidate) => candidate.trim())
    .filter(Boolean)
    .at(-1);
  if (!line) throw new Error("Scanner child returned no metrics");
  const value: unknown = JSON.parse(line);
  if (
    !isRecord(value) ||
    !numeric(value.discoveredFiles) ||
    !numeric(value.discoveredSourceBytes) ||
    !numeric(value.metadataBytesRead) ||
    !numeric(value.selectedFiles) ||
    !numeric(value.selectedSourceBytes) ||
    !numeric(value.deferredFiles) ||
    !numeric(value.parsedFiles) ||
    !numeric(value.unchangedFiles) ||
    !numeric(value.skippedFiles) ||
    !numeric(value.parsedBytes) ||
    !numeric(value.projectCount)
  ) {
    throw new Error("Scanner child returned invalid metrics");
  }
  return {
    discoveredFiles: value.discoveredFiles,
    discoveredSourceBytes: value.discoveredSourceBytes,
    metadataBytesRead: value.metadataBytesRead,
    selectedFiles: value.selectedFiles,
    selectedSourceBytes: value.selectedSourceBytes,
    deferredFiles: value.deferredFiles,
    parsedFiles: value.parsedFiles,
    unchangedFiles: value.unchangedFiles,
    skippedFiles: value.skippedFiles,
    parsedBytes: value.parsedBytes,
    projectCount: value.projectCount,
  };
}

function boundedMessage(output: {
  text: string;
  truncated: boolean;
}): string {
  const normalized = output.text.replace(/\s+/g, " ").trim().slice(0, 400);
  const message = normalized || "no stderr";
  return output.truncated ? `${message} [truncated]` : message;
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("The scan was aborted", "AbortError");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numeric(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
