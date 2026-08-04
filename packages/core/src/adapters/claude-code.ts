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
  TokenUsageEvent,
  UsageBackfillResult,
} from "../types.js";
import {
  appendBoundedMessage,
  cleanMessageText,
  extractionFromParts,
  normalizeTouchedFile,
  readIncrementalJsonl,
  successfulParse,
} from "./incremental.js";
import {
  claudeTokenUsage,
  exactProviderIdentifier,
} from "./usage.js";

interface JsonObject {
  [key: string]: unknown;
}

const DISCOVERY_READ_LIMIT = 64 * 1024;
const MAX_USAGE_EVENTS_PER_INCREMENT = 50_000;
const SYNTHETIC_MODEL_PLACEHOLDER = "<synthetic>";

export class ClaudeCodeAdapter implements SessionAdapter {
  readonly tool = "claude-code" as const;

  constructor(
    private readonly projectsRoot: string,
    private readonly logger: CoreLogger,
  ) {}

  async *discover(): AsyncGenerator<SessionDiscovery> {
    let projectDirectories: Dirent[];
    try {
      projectDirectories = await fs.readdir(this.projectsRoot, {
        withFileTypes: true,
      });
    } catch (error) {
      this.logger.warn(
        {
          event: "source_root_unavailable",
          tool: this.tool,
          path: this.projectsRoot,
          reason: error instanceof Error ? error.message : String(error),
        },
        "Claude Code source root unavailable",
      );
      return;
    }

    for (const projectDirectory of projectDirectories) {
      if (!projectDirectory.isDirectory()) continue;

      const encodedPath = projectDirectory.name;
      const directoryPath = path.join(this.projectsRoot, encodedPath);
      let entries: Dirent[];

      try {
        entries = await fs.readdir(directoryPath, { withFileTypes: true });
      } catch (error) {
        this.logger.warn(
          {
            event: "source_directory_unreadable",
            tool: this.tool,
            path: directoryPath,
            reason: error instanceof Error ? error.message : String(error),
          },
          "Skipping unreadable Claude Code project directory",
        );
        continue;
      }

      const resolvedProjectPath =
        await resolveExistingClaudeProjectPath(encodedPath);
      const fallbackProjectPath =
        resolvedProjectPath ?? fallbackClaudeProjectPath(encodedPath);
      const sessionFiles: Array<{
        sourcePath: string;
        mtimeMs: number;
        sourceSizeBytes: number;
      }> = [];
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
        const sourcePath = path.join(directoryPath, entry.name);
        const fileMetadata = await readFileMetadata(
          sourcePath,
          this.tool,
          this.logger,
        );
        if (!fileMetadata) continue;
        sessionFiles.push({ sourcePath, ...fileMetadata });
      }

      let headerProjectPath: string | null = null;
      const headerBytesBySource = new Map<string, number>();
      if (resolvedProjectPath === null) {
        const headerCandidates = [...sessionFiles].sort(compareRecentFiles);
        for (const candidate of headerCandidates) {
          const header = await readClaudeSessionHeader(candidate.sourcePath);
          headerBytesBySource.set(candidate.sourcePath, header.bytesRead);
          if (header.cwd) {
            headerProjectPath = header.cwd;
            break;
          }
        }
      }

      for (const file of sessionFiles) {
        yield {
          sourcePath: file.sourcePath,
          projectPath:
            resolvedProjectPath ?? headerProjectPath ?? fallbackProjectPath,
          tool: this.tool,
          mtimeMs: file.mtimeMs,
          sourceSizeBytes: file.sourceSizeBytes,
          metadataBytesRead: headerBytesBySource.get(file.sourcePath) ?? 0,
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
    let gitBranch: string | null = null;
    let model: string | null = null;
    const usageEvents = new Map<string, TokenUsageEvent>();

    const data = await readIncrementalJsonl(
      source.sourcePath,
      scanOffset,
      this.logger,
      {
        signal: options.signal,
        onRecord(unknownRecord) {
          if (!isObject(unknownRecord)) return;
          const record = unknownRecord;
          if (
            typeof record.gitBranch === "string" &&
            record.gitBranch.trim()
          ) {
            gitBranch = record.gitBranch;
          }
          const timestamp =
            typeof record.timestamp === "string" ? record.timestamp : null;
          if (timestamp) {
            timestamps.startedAt =
              timestamps.startedAt === null ||
              timestamp < timestamps.startedAt
                ? timestamp
                : timestamps.startedAt;
            timestamps.endedAt =
              timestamps.endedAt === null || timestamp > timestamps.endedAt
                ? timestamp
                : timestamps.endedAt;
          }

          const recordType = record.type;
          if (recordType !== "user" && recordType !== "assistant") return;
          const message = isObject(record.message) ? record.message : null;
          if (!message) return;
          if (recordType === "assistant") {
            const messageModel = exactClaudeModelIdentifier(message.model);
            if (messageModel !== null) model = messageModel;
            const providerMessageId = exactProviderIdentifier(message.id);
            const usage = claudeTokenUsage(message.usage, timestamp);
            if (providerMessageId !== null && usage !== null) {
              if (
                !usageEvents.has(providerMessageId) &&
                usageEvents.size >= MAX_USAGE_EVENTS_PER_INCREMENT
              ) {
                throw new Error(
                  `Claude usage event limit exceeded (${MAX_USAGE_EVENTS_PER_INCREMENT})`,
                );
              }
              usageEvents.set(providerMessageId, {
                ...usage,
                providerMessageId,
                model: messageModel,
              });
            }
          }

          if (options.usageOnly) return;

          const textParts: string[] = [];
          const content = message.content;
          if (typeof content === "string") {
            textParts.push(content);
          } else if (Array.isArray(content)) {
            for (const block of content) {
              if (!isObject(block)) continue;
              if (typeof block.text === "string") textParts.push(block.text);
              if (block.type === "tool_use" && isObject(block.input)) {
                collectToolPaths(
                  block.input,
                  source.projectPath,
                  touchedFiles,
                );
              }
            }
          }

          const text = cleanMessageText(textParts.join(" "));
          if (text) {
            appendBoundedMessage(messages, {
              role: recordType,
              text,
              timestamp,
            });
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
        gitBranch,
        {
          model,
          cumulativeUsage: null,
          usageEvents: [...usageEvents.values()],
        },
      ),
    );
  }

  async backfillUsage(
    source: DiscoveredSessionSource,
    options: ParseOptions = {},
  ): Promise<UsageBackfillResult> {
    const parsed = await this.parseIncrement(source, 0, {
      ...options,
      usageOnly: true,
    });
    if (!parsed.ok) {
      return {
        ok: false,
        bytesRead: parsed.bytesParsed,
        error: parsed.error,
      };
    }
    return {
      ok: true,
      bytesRead: parsed.bytesParsed,
      coveredFromOffset: 0,
      coveredToOffset: parsed.nextOffset,
      extraction: {
        model: parsed.extraction.model,
        cumulativeUsage: null,
        usageEvents: parsed.extraction.usageEvents,
      },
    };
  }
}

async function readClaudeSessionHeader(
  sourcePath: string,
): Promise<{ cwd: string | null; bytesRead: number }> {
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
        if (
          isObject(record) &&
          typeof record.cwd === "string" &&
          path.isAbsolute(record.cwd)
        ) {
          return { cwd: record.cwd, bytesRead };
        }
      } catch {
        continue;
      }
    }
    return { cwd: null, bytesRead };
  } catch {
    return { cwd: null, bytesRead: 0 };
  } finally {
    await handle?.close();
  }
}

export async function decodeClaudeProjectPath(
  encodedPath: string,
): Promise<string> {
  return (
    (await resolveExistingClaudeProjectPath(encodedPath)) ??
    fallbackClaudeProjectPath(encodedPath)
  );
}

async function resolveExistingClaudeProjectPath(
  encodedPath: string,
): Promise<string | null> {
  const tokens = encodedPath.split("-").filter(Boolean);
  if (tokens.length === 0) return path.parse(process.cwd()).root;

  return resolveExistingPath(path.parse(process.cwd()).root, tokens, 0);
}

function fallbackClaudeProjectPath(encodedPath: string): string {
  const tokens = encodedPath.split("-").filter(Boolean);
  return tokens.length === 0
    ? path.parse(process.cwd()).root
    : `${path.sep}${tokens.join(path.sep)}`;
}

async function resolveExistingPath(
  currentPath: string,
  tokens: string[],
  index: number,
): Promise<string | null> {
  if (index >= tokens.length) return currentPath;

  for (let end = tokens.length; end > index; end -= 1) {
    const segment = tokens.slice(index, end).join("-");
    const candidate = path.join(currentPath, segment);
    try {
      if (!(await fs.stat(candidate)).isDirectory()) continue;
    } catch {
      continue;
    }

    const resolved = await resolveExistingPath(candidate, tokens, end);
    if (resolved) return resolved;
  }

  return null;
}

async function readFileMetadata(
  sourcePath: string,
  tool: "claude-code",
  logger: CoreLogger,
): Promise<{ mtimeMs: number; sourceSizeBytes: number } | null> {
  try {
    const stat = await fs.stat(sourcePath);
    return { mtimeMs: stat.mtimeMs, sourceSizeBytes: stat.size };
  } catch (error) {
    logger.warn(
      {
        event: "source_metadata_unavailable",
        tool,
        sourcePath,
        reason: error instanceof Error ? error.message : String(error),
      },
      "Skipping session with unavailable file metadata",
    );
    return null;
  }
}

function compareRecentFiles(
  left: { sourcePath: string; mtimeMs: number },
  right: { sourcePath: string; mtimeMs: number },
): number {
  if (left.mtimeMs !== right.mtimeMs) return right.mtimeMs - left.mtimeMs;
  return right.sourcePath.localeCompare(left.sourcePath);
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactClaudeModelIdentifier(value: unknown): string | null {
  const model = exactProviderIdentifier(value);
  return model !== null &&
    model.trim().toLowerCase() !== SYNTHETIC_MODEL_PLACEHOLDER
    ? model
    : null;
}

function collectToolPaths(
  value: JsonObject,
  projectPath: string,
  output: Set<string>,
): void {
  for (const [key, child] of Object.entries(value)) {
    if (
      typeof child === "string" &&
      ["file_path", "notebook_path", "path"].includes(key)
    ) {
      const normalized = normalizeTouchedFile(child, projectPath);
      if (normalized) output.add(normalized);
      continue;
    }

    if (isObject(child)) collectToolPaths(child, projectPath, output);
    if (Array.isArray(child)) {
      for (const item of child) {
        if (isObject(item)) collectToolPaths(item, projectPath, output);
      }
    }
  }
}
