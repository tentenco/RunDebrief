import fs from "node:fs/promises";
import type {
  CoreLogger,
  ParseFailure,
  ParseSuccess,
  RuleExtraction,
  UsageExtraction,
} from "../types.js";

export const MESSAGE_LIMIT = 20;
const MAX_MESSAGE_LENGTH = 800;
const READ_BUFFER_BYTES = 64 * 1024;
const MAX_JSONL_RECORD_BYTES = 16 * 1024 * 1024;

export interface IncrementalRead {
  bytesParsed: number;
  nextOffset: number;
}

export interface IncrementalReadOptions {
  onRecord(record: unknown): void;
  signal?: AbortSignal;
}

export async function resolveJsonlTailStart(
  sourcePath: string,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<{
  startOffset: number;
  sourceSize: number;
  alignmentBytesRead: number;
}> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new Error("JSONL tail limit must be a positive safe integer");
  }
  throwIfAborted(signal);
  const handle = await fs.open(sourcePath, "r");
  try {
    const stat = await handle.stat();
    const rawStart = Math.max(0, stat.size - Math.max(1, maxBytes - 1));
    if (rawStart === 0) {
      return {
        startOffset: 0,
        sourceSize: stat.size,
        alignmentBytesRead: 0,
      };
    }

    const previous = Buffer.allocUnsafe(1);
    await handle.read(previous, 0, 1, rawStart - 1);
    let alignmentBytesRead = 1;
    throwIfAborted(signal);
    if (previous[0] === 0x0a) {
      return {
        startOffset: rawStart,
        sourceSize: stat.size,
        alignmentBytesRead,
      };
    }

    const buffer = Buffer.allocUnsafe(READ_BUFFER_BYTES);
    let cursor = rawStart;
    while (cursor < stat.size) {
      throwIfAborted(signal);
      const length = Math.min(buffer.length, stat.size - cursor);
      const { bytesRead } = await handle.read(buffer, 0, length, cursor);
      if (bytesRead === 0) break;
      alignmentBytesRead += bytesRead;
      const newline = buffer.subarray(0, bytesRead).indexOf(0x0a);
      if (newline >= 0) {
        return {
          startOffset: cursor + newline + 1,
          sourceSize: stat.size,
          alignmentBytesRead:
            alignmentBytesRead - bytesRead + newline + 1,
        };
      }
      cursor += bytesRead;
    }
    return {
      startOffset: stat.size,
      sourceSize: stat.size,
      alignmentBytesRead,
    };
  } finally {
    await handle.close();
  }
}

export async function readIncrementalJsonl(
  sourcePath: string,
  scanOffset: number,
  logger: CoreLogger,
  options: IncrementalReadOptions,
): Promise<IncrementalRead | ParseFailure> {
  let handle: fs.FileHandle | undefined;

  try {
    throwIfAborted(options.signal);
    handle = await fs.open(sourcePath, "r");
    const stat = await handle.stat();
    const effectiveOffset =
      scanOffset >= 0 && scanOffset <= stat.size ? scanOffset : 0;

    if (effectiveOffset !== scanOffset) {
      logger.warn(
        { event: "source_truncated", sourcePath, scanOffset, size: stat.size },
        "Session source shrank; restarting incremental scan",
      );
    }

    const bytesToRead = stat.size - effectiveOffset;
    if (bytesToRead === 0) {
      return { bytesParsed: 0, nextOffset: effectiveOffset };
    }

    const input = handle.createReadStream({
      start: effectiveOffset,
      end: stat.size - 1,
      autoClose: false,
      highWaterMark: READ_BUFFER_BYTES,
      signal: options.signal,
    });
    let lineNumber = 0;
    let consumedBytes = 0;
    let pendingBytes = 0;
    let pendingChunks: Buffer[] = [];
    let discardingOversizedLine = false;

    try {
      for await (const rawChunk of input) {
        throwIfAborted(options.signal);
        const chunk = Buffer.isBuffer(rawChunk)
          ? rawChunk
          : Buffer.from(rawChunk);
        let segmentStart = 0;

        for (let index = 0; index < chunk.length; index += 1) {
          if (chunk[index] !== 0x0a) continue;

          const segment = chunk.subarray(segmentStart, index);
          const lineBytes = pendingBytes + segment.length;
          if (
            discardingOversizedLine ||
            lineBytes > MAX_JSONL_RECORD_BYTES
          ) {
            lineNumber += 1;
            logOversizedRecord(
              logger,
              sourcePath,
              lineNumber,
              lineBytes,
            );
            consumedBytes += lineBytes + 1;
            pendingChunks = [];
            pendingBytes = 0;
            discardingOversizedLine = false;
            segmentStart = index + 1;
            continue;
          }

          const line =
            pendingChunks.length === 0
              ? segment
              : Buffer.concat([...pendingChunks, segment], lineBytes);
          lineNumber += 1;
          const failure = processJsonlLine(
            line,
            lineNumber,
            sourcePath,
            effectiveOffset,
            logger,
            options,
          );
          if (failure) return failure;

          consumedBytes += lineBytes + 1;
          pendingChunks = [];
          pendingBytes = 0;
          segmentStart = index + 1;
        }

        if (segmentStart < chunk.length) {
          const remainder = chunk.subarray(segmentStart);
          pendingBytes += remainder.length;
          if (discardingOversizedLine) continue;
          if (pendingBytes > MAX_JSONL_RECORD_BYTES) {
            pendingChunks = [];
            discardingOversizedLine = true;
          } else {
            pendingChunks.push(remainder);
          }
        }
      }

      if (pendingBytes > 0) {
        if (discardingOversizedLine) {
          logger.debug(
            {
              event: "partial_jsonl_record",
              sourcePath,
              line: lineNumber + 1,
              pendingBytes,
              scanOffset: effectiveOffset + consumedBytes,
              reason: "oversized record has no terminating newline yet",
            },
            "Leaving an incomplete JSONL record for the next scan",
          );
          return {
            bytesParsed: consumedBytes,
            nextOffset: effectiveOffset + consumedBytes,
          };
        }

        const finalLine =
          pendingChunks.length === 1
            ? pendingChunks[0]!
            : Buffer.concat(pendingChunks, pendingBytes);
        lineNumber += 1;

        try {
          processJsonlLineOrThrow(finalLine, options);
          consumedBytes += pendingBytes;
        } catch (error) {
          if (options.signal?.aborted) throw abortReason(options.signal);

          logger.debug(
            {
              event: "partial_jsonl_record",
              sourcePath,
              line: lineNumber,
              pendingBytes,
              scanOffset: effectiveOffset + consumedBytes,
              reason: error instanceof Error ? error.message : String(error),
            },
            "Leaving an incomplete JSONL record for the next scan",
          );
        }
      }

      return {
        bytesParsed: consumedBytes,
        nextOffset: effectiveOffset + consumedBytes,
      };
    } finally {
      input.destroy();
    }
  } catch (error) {
    if (options.signal?.aborted) throw abortReason(options.signal);
    const reason = error instanceof Error ? error.message : String(error);
    logger.error(
      { event: "session_read_failed", sourcePath, reason },
      "Skipping unreadable session",
    );
    return {
      ok: false,
      bytesParsed: 0,
      nextOffset: scanOffset,
      error: reason,
    };
  } finally {
    await handle?.close();
  }
}

export function successfulParse(
  data: IncrementalRead,
  extraction: RuleExtraction,
): ParseSuccess {
  return {
    ok: true,
    bytesParsed: data.bytesParsed,
    nextOffset: data.nextOffset,
    extraction,
  };
}

export function appendBoundedMessage(
  messages: RuleExtraction["messages"],
  message: RuleExtraction["messages"][number],
): void {
  messages.push(message);
  if (messages.length > MESSAGE_LIMIT) {
    messages.splice(0, messages.length - MESSAGE_LIMIT);
  }
}

export function cleanMessageText(value: string): string {
  return value.replace(/\r\n?/g, "\n").trim().slice(0, MAX_MESSAGE_LENGTH);
}

export function normalizeTouchedFile(
  value: string,
  projectPath: string,
): string | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes("\n") || trimmed.includes("\0")) return null;

  const normalizedProject = projectPath.replace(/\/+$/, "");
  if (trimmed.startsWith("/")) {
    if (!trimmed.startsWith(`${normalizedProject}/`)) return null;
    return trimmed.slice(normalizedProject.length + 1);
  }

  const relative = trimmed.replace(/^\.\//, "");
  if (
    relative === ".." ||
    relative.startsWith("../") ||
    relative.startsWith("~")
  ) {
    return null;
  }

  return relative || null;
}

export function extractionFromParts(
  messages: RuleExtraction["messages"],
  touchedFiles: Iterable<string>,
  timestamps: string[],
  gitBranch: string | null = null,
  usage: UsageExtraction = {
    model: null,
    cumulativeUsage: null,
    usageEvents: [],
  },
): RuleExtraction {
  const sortedTimestamps = timestamps
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));

  return {
    messages: messages.slice(-MESSAGE_LIMIT),
    touchedFiles: [...new Set(touchedFiles)].sort(),
    startedAt: sortedTimestamps[0] ?? null,
    endedAt: sortedTimestamps.at(-1) ?? null,
    gitBranch,
    ...usage,
  };
}

function processJsonlLine(
  line: Buffer,
  lineNumber: number,
  sourcePath: string,
  effectiveOffset: number,
  logger: CoreLogger,
  options: IncrementalReadOptions,
): ParseFailure | null {
  try {
    processJsonlLineOrThrow(line, options);
    return null;
  } catch (error) {
    if (options.signal?.aborted) throw abortReason(options.signal);
    return malformedLineFailure(
      logger,
      sourcePath,
      effectiveOffset,
      lineNumber,
      error,
    );
  }
}

function processJsonlLineOrThrow(
  line: Buffer,
  options: IncrementalReadOptions,
): void {
  throwIfAborted(options.signal);
  const text = line.toString("utf8").trim();
  if (!text) return;
  options.onRecord(JSON.parse(text));
}

function malformedLineFailure(
  logger: CoreLogger,
  sourcePath: string,
  effectiveOffset: number,
  lineNumber: number,
  error: unknown,
): ParseFailure {
  const reason = error instanceof Error ? error.message : String(error);
  logger.error(
    {
      event: "malformed_jsonl",
      sourcePath,
      line: lineNumber,
      reason,
    },
    "Skipping malformed session",
  );
  return {
    ok: false,
    bytesParsed: 0,
    nextOffset: effectiveOffset,
    error: `Malformed JSONL at incremental line ${lineNumber}: ${reason}`,
  };
}

function logOversizedRecord(
  logger: CoreLogger,
  sourcePath: string,
  lineNumber: number,
  recordBytes: number,
): void {
  logger.warn(
    {
      event: "jsonl_record_too_large",
      sourcePath,
      line: lineNumber,
      recordBytes,
      maxRecordBytes: MAX_JSONL_RECORD_BYTES,
    },
    "Skipping oversized JSONL record",
  );
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortReason(signal);
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("The scan was aborted", "AbortError");
}
