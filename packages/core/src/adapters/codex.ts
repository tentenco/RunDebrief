import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type {
  CoreLogger,
  DiscoveredSessionSource,
  ExtractedMessage,
  ParseOptions,
  ParseResult,
  SessionAdapter,
  SessionDiscovery,
  SessionSource,
  TokenUsage,
  UsageBackfillResult,
} from "../types.js";
import {
  appendBoundedMessage,
  cleanMessageText,
  extractionFromParts,
  normalizeTouchedFile,
  readIncrementalJsonl,
  resolveJsonlTailStart,
  successfulParse,
} from "./incremental.js";
import {
  codexTokenUsage,
  exactProviderIdentifier,
  preferCumulativeUsage,
} from "./usage.js";

interface JsonObject {
  [key: string]: unknown;
}

const DISCOVERY_READ_LIMIT = 64 * 1024;
const USAGE_TAIL_READ_LIMIT = 8 * 1024 * 1024;

interface CodexUsageState {
  model: string | null;
  cumulativeUsage: TokenUsage | null;
}

export class CodexAdapter implements SessionAdapter {
  readonly tool = "codex" as const;

  constructor(
    private readonly sessionsRoot: string,
    private readonly logger: CoreLogger,
  ) {}

  async *discover(): AsyncGenerator<SessionDiscovery> {
    for await (const sourcePath of walkJsonl(this.sessionsRoot, this.logger)) {
      const metadata = await readCodexSessionMetadata(sourcePath);
      if (!metadata) {
        this.logger.warn(
          { event: "source_metadata_unavailable", tool: this.tool, sourcePath },
          "Skipping session with unavailable file metadata",
        );
        continue;
      }
      const projectPath = metadata.projectPath;
      if (!projectPath || !path.isAbsolute(projectPath)) {
        this.logger.warn(
          { event: "project_path_missing", tool: this.tool, sourcePath },
          "Skipping Codex session without an absolute cwd",
        );
        yield {
          sourcePath,
          projectPath: null,
          tool: this.tool,
          mtimeMs: metadata.mtimeMs,
          sourceSizeBytes: metadata.sourceSizeBytes,
          metadataBytesRead: metadata.metadataBytesRead,
        };
      } else {
        yield {
          sourcePath,
          projectPath,
          tool: this.tool,
          mtimeMs: metadata.mtimeMs,
          sourceSizeBytes: metadata.sourceSizeBytes,
          metadataBytesRead: metadata.metadataBytesRead,
        };
      }
    }
  }

  async parseIncrement(
    source: SessionSource,
    scanOffset: number,
    options: ParseOptions = {},
  ): Promise<ParseResult> {
    const messages: ExtractedMessage[] = [];
    const touchedFiles = new Set<string>();
    const timestamps: {
      startedAt: string | null;
      endedAt: string | null;
    } = { startedAt: null, endedAt: null };
    const usageState: CodexUsageState = {
      model: null,
      cumulativeUsage: null,
    };

    const data = await readIncrementalJsonl(
      source.sourcePath,
      scanOffset,
      this.logger,
      {
        signal: options.signal,
        onRecord(unknownRecord) {
          if (!isObject(unknownRecord)) return;
          const timestamp =
            typeof unknownRecord.timestamp === "string"
              ? unknownRecord.timestamp
              : null;
          if (timestamp) {
            timestamps.startedAt =
              timestamps.startedAt === null ||
              timestamp < timestamps.startedAt
                ? timestamp
                : timestamps.startedAt;
            timestamps.endedAt =
              timestamps.endedAt === null ||
              timestamp > timestamps.endedAt
                ? timestamp
                : timestamps.endedAt;
          }

          collectCodexUsage(unknownRecord, timestamp, usageState);
          if (options.usageOnly) return;
          if (unknownRecord.type !== "response_item") return;
          const payload = isObject(unknownRecord.payload)
            ? unknownRecord.payload
            : null;
          if (!payload) return;

          if (
            payload.type === "message" &&
            (payload.role === "user" || payload.role === "assistant") &&
            Array.isArray(payload.content)
          ) {
            const textParts = payload.content
              .filter(isObject)
              .map((item) =>
                typeof item.text === "string"
                  ? item.text
                  : typeof item.input_text === "string"
                    ? item.input_text
                    : typeof item.output_text === "string"
                      ? item.output_text
                      : "",
              );
            const text = cleanMessageText(textParts.join(" "));
            if (text) {
              appendBoundedMessage(messages, {
                role: payload.role,
                text,
                timestamp,
              });
            }
          }

          if (
            (payload.type === "function_call" ||
              payload.type === "custom_tool_call") &&
            typeof payload.arguments === "string"
          ) {
            collectCodexToolPaths(
              payload.arguments,
              source.projectPath,
              touchedFiles,
            );
          }
        },
      },
    );
    if ("ok" in data) return data;

    return successfulParse(
      data,
      extractionFromParts(
        messages,
        touchedFiles,
        [timestamps.startedAt, timestamps.endedAt].filter(
          (timestamp): timestamp is string => timestamp !== null,
        ),
        null,
        {
          model: usageState.model,
          cumulativeUsage: usageState.cumulativeUsage,
          usageEvents: [],
        },
      ),
    );
  }

  async backfillUsage(
    source: DiscoveredSessionSource,
    options: ParseOptions = {},
  ): Promise<UsageBackfillResult> {
    let tail: {
      startOffset: number;
      sourceSize: number;
      alignmentBytesRead: number;
    };
    try {
      tail = await resolveJsonlTailStart(
        source.sourcePath,
        USAGE_TAIL_READ_LIMIT,
        options.signal,
      );
    } catch (error) {
      return {
        ok: false,
        bytesRead: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    const usageState: CodexUsageState = {
      model: null,
      cumulativeUsage: null,
    };
    const data = await readIncrementalJsonl(
      source.sourcePath,
      tail.startOffset,
      this.logger,
      {
        signal: options.signal,
        onRecord(unknownRecord) {
          if (!isObject(unknownRecord)) return;
          const timestamp =
            typeof unknownRecord.timestamp === "string"
              ? unknownRecord.timestamp
              : null;
          collectCodexUsage(unknownRecord, timestamp, usageState);
        },
      },
    );
    if ("ok" in data) {
      return {
        ok: false,
        bytesRead: tail.alignmentBytesRead + data.bytesParsed,
        error: data.error,
      };
    }
    return {
      ok: true,
      bytesRead: tail.alignmentBytesRead + data.bytesParsed,
      coveredFromOffset: tail.startOffset,
      coveredToOffset: data.nextOffset,
      extraction: {
        model: usageState.model,
        cumulativeUsage: usageState.cumulativeUsage,
        usageEvents: [],
      },
    };
  }
}

function collectCodexUsage(
  record: JsonObject,
  timestamp: string | null,
  state: CodexUsageState,
): void {
  const payload = isObject(record.payload) ? record.payload : null;
  if (!payload) return;
  if (record.type === "turn_context") {
    const model = exactProviderIdentifier(payload.model);
    if (model !== null) state.model = model;
    return;
  }
  if (
    record.type !== "event_msg" ||
    payload.type !== "token_count" ||
    !isObject(payload.info)
  ) {
    return;
  }
  const usage = codexTokenUsage(
    payload.info.total_token_usage,
    timestamp,
  );
  if (usage !== null) {
    state.cumulativeUsage = preferCumulativeUsage(
      state.cumulativeUsage,
      usage,
    );
  }
}

async function* walkJsonl(
  root: string,
  logger: CoreLogger,
): AsyncGenerator<string> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch (error) {
    logger.warn(
      {
        event: "source_root_unavailable",
        tool: "codex",
        path: root,
        reason: error instanceof Error ? error.message : String(error),
      },
      "Codex source root unavailable",
    );
    return;
  }

  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      yield* walkJsonl(entryPath, logger);
    } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      yield entryPath;
    }
  }
}

async function readCodexSessionMetadata(sourcePath: string): Promise<{
  projectPath: string | null;
  mtimeMs: number;
  sourceSizeBytes: number;
  metadataBytesRead: number;
} | null> {
  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(sourcePath, "r");
    const stat = await handle.stat();
    const length = Math.min(stat.size, DISCOVERY_READ_LIMIT);
    const buffer = Buffer.allocUnsafe(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    const lines = buffer.subarray(0, bytesRead).toString("utf8").split("\n");

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const record: unknown = JSON.parse(line);
        if (!isObject(record) || !isObject(record.payload)) continue;
        if (
          (record.type === "session_meta" || record.type === "turn_context") &&
          typeof record.payload.cwd === "string"
        ) {
          return {
            projectPath: record.payload.cwd,
            mtimeMs: stat.mtimeMs,
            sourceSizeBytes: stat.size,
            metadataBytesRead: bytesRead,
          };
        }
      } catch {
        continue;
      }
    }
    return {
      projectPath: null,
      mtimeMs: stat.mtimeMs,
      sourceSizeBytes: stat.size,
      metadataBytesRead: bytesRead,
    };
  } catch {
    return null;
  } finally {
    await handle?.close();
  }
}

function collectCodexToolPaths(
  rawArguments: string,
  projectPath: string,
  output: Set<string>,
): void {
  let decoded: unknown;
  try {
    decoded = JSON.parse(rawArguments);
  } catch {
    decoded = rawArguments;
  }

  if (isObject(decoded)) {
    collectPathKeys(decoded, projectPath, output);
  }

  const patchText =
    typeof decoded === "string"
      ? decoded
      : isObject(decoded) && typeof decoded.input === "string"
        ? decoded.input
        : rawArguments;
  for (const match of patchText.matchAll(
    /^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm,
  )) {
    const candidate = match[1];
    if (!candidate) continue;
    const normalized = normalizeTouchedFile(candidate, projectPath);
    if (normalized) output.add(normalized);
  }
}

function collectPathKeys(
  value: JsonObject,
  projectPath: string,
  output: Set<string>,
): void {
  for (const [key, child] of Object.entries(value)) {
    if (
      typeof child === "string" &&
      ["file_path", "path", "notebook_path"].includes(key)
    ) {
      const normalized = normalizeTouchedFile(child, projectPath);
      if (normalized) output.add(normalized);
    } else if (isObject(child)) {
      collectPathKeys(child, projectPath, output);
    } else if (Array.isArray(child)) {
      for (const item of child) {
        if (isObject(item)) collectPathKeys(item, projectPath, output);
      }
    }
  }
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
