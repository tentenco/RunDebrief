import type { DaemonLogger } from "./types.js";
import type { FetchLike } from "./summarizer.js";

const MEM0_TIMEOUT_MS = 10_000;

export interface MemoryOutcome {
  projectName: string;
  projectPath: string;
  sessionId: number;
  stateSummary: string;
}

export interface MemoryWriter {
  writeOutcome(outcome: MemoryOutcome): void;
}

export class Mem0Writer implements MemoryWriter {
  constructor(
    private readonly endpoint: string | null,
    private readonly apiKey: string | null,
    private readonly userId: string | null,
    private readonly logger: DaemonLogger,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  writeOutcome(outcome: MemoryOutcome): void {
    const endpoint = this.endpoint;
    const userId = this.userId;
    if (!endpoint || !userId) {
      this.logger.info(
        {
          event: "mem0_write_skipped",
          projectPath: outcome.projectPath,
          reason: this.endpoint
            ? "user_id_not_configured"
            : "endpoint_not_configured",
        },
        "Mem0 write-back skipped",
      );
      return;
    }

    void this.send(outcome, endpoint, userId).catch((error) => {
      this.logger.warn(
        {
          event: "mem0_write_failed",
          projectPath: outcome.projectPath,
          reason: error instanceof Error ? error.message : String(error),
        },
        "Mem0 write-back failed without blocking summary",
      );
    });
  }

  private async send(
    outcome: MemoryOutcome,
    endpoint: string,
    userId: string,
  ): Promise<void> {
    const response = await this.fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({
        user_id: userId,
        messages: [
          {
            role: "assistant",
            content: `${outcome.projectName}: ${redactProjectRoot(
              oneLine(outcome.stateSummary),
              outcome.projectPath,
            )}`,
          },
        ],
        metadata: {
          project_name: outcome.projectName,
          session_id: outcome.sessionId,
          source: "debrief",
        },
      }),
      signal: AbortSignal.timeout(MEM0_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`Mem0 returned HTTP ${response.status}`);
    }
    this.logger.info(
      {
        event: "mem0_write_complete",
        projectPath: outcome.projectPath,
        sessionId: outcome.sessionId,
      },
      "Mem0 outcome stored",
    );
  }
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function redactProjectRoot(value: string, projectPath: string): string {
  const root = projectPath.trim();
  return root ? value.replaceAll(root, "<project-root>") : value;
}
