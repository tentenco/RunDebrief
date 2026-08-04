import type { DaemonLogger } from "./types.js";
import {
  summarySchema,
  type StructuredSummary,
} from "./summary-schema.js";

const REQUEST_TIMEOUT_MS = 30_000;

export interface SummaryInput {
  projectName: string;
  projectPath: string;
  tool: "claude-code" | "codex";
  startedAt: string | null;
  endedAt: string | null;
  gitBranch: string | null;
  ruleStateSummary: string;
  keyFiles: string[];
}

export interface SummaryResult {
  summary: StructuredSummary;
  model: string;
  degraded: boolean;
  attempts: number;
}

export interface SummarizerConfig {
  gatewayUrl: string;
  gatewayKey: string;
  summaryModel: string;
}

export type FetchLike = typeof fetch;

export class GatewaySummarizer {
  constructor(
    private readonly config: SummarizerConfig,
    private readonly logger: DaemonLogger,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async summarize(input: SummaryInput): Promise<SummaryResult> {
    if (!this.config.gatewayUrl.trim()) {
      this.logger.info(
        {
          event: "summary_gateway_skipped",
          reason: "gateway_url_not_configured",
        },
        "Storing deterministic rules fallback without gateway retries",
      );
      return {
        summary: buildRulesFallback(input),
        model: "rules-fallback",
        degraded: true,
        attempts: 0,
      };
    }

    let lastReason = "unknown gateway failure";

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const summary = await this.request(input, attempt);
        return {
          summary,
          model: this.config.summaryModel,
          degraded: false,
          attempts: attempt,
        };
      } catch (error) {
        lastReason = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          {
            event: "summary_attempt_failed",
            attempt,
            reason: lastReason,
          },
          "Summary gateway attempt failed",
        );
      }
    }

    this.logger.error(
      { event: "summary_degraded", reason: lastReason },
      "Storing deterministic rules fallback",
    );
    return {
      summary: buildRulesFallback(input),
      model: "rules-fallback",
      degraded: true,
      attempts: 2,
    };
  }

  private async request(
    input: SummaryInput,
    attempt: number,
  ): Promise<StructuredSummary> {
    if (!this.config.gatewayUrl) {
      throw new Error("Gateway URL is not configured");
    }

    const response = await this.fetchImpl(
      gatewayEndpoint(this.config.gatewayUrl),
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this.config.gatewayKey
            ? { authorization: `Bearer ${this.config.gatewayKey}` }
            : {}),
        },
        body: JSON.stringify({
          model: this.config.summaryModel,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content:
                "Return one strict JSON object with exactly these keys: state_summary, open_items, next_steps, decisions, key_files, blocked, blocked_reason. Arrays contain only strings. blocked is boolean. blocked_reason is string or null. Do not include markdown.",
            },
            {
              role: "user",
              content:
                attempt === 1
                  ? buildPrompt(input)
                  : `${buildPrompt(input)}\n\nYour previous response was invalid. Output JSON only, with no extra keys or prose.`,
            },
          ],
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );

    if (!response.ok) {
      throw new Error(`Gateway returned HTTP ${response.status}`);
    }

    const body: unknown = await response.json();
    const content = extractContent(body);
    let decoded: unknown;
    try {
      decoded = JSON.parse(content);
    } catch (error) {
      throw new Error(
        `Gateway content was not valid JSON: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    const validated = summarySchema.safeParse(decoded);
    if (!validated.success) {
      throw new Error(`Gateway JSON failed schema validation: ${validated.error.message}`);
    }
    return validated.data;
  }
}

function buildPrompt(input: SummaryInput): string {
  return JSON.stringify(
    {
      project: {
        name: input.projectName,
      },
      session: {
        tool: input.tool,
        started_at: input.startedAt,
        ended_at: input.endedAt,
        git_branch: input.gitBranch,
      },
      deterministic_extraction: redactProjectRoot(
        decodeRuleExtraction(input.ruleStateSummary),
        input.projectPath,
      ),
      touched_files: redactProjectRoot(input.keyFiles, input.projectPath),
    },
    null,
    2,
  );
}

function buildRulesFallback(input: SummaryInput): StructuredSummary {
  const extraction = decodeRuleExtraction(input.ruleStateSummary);
  const digest =
    isRecord(extraction) && typeof extraction.digest === "string"
      ? extraction.digest
      : input.ruleStateSummary.trim();

  return {
    state_summary:
      digest || `Session ended for ${input.projectName}; structured summary unavailable.`,
    open_items: [],
    next_steps: ["Review the deterministic session extraction before continuing."],
    decisions: [],
    key_files: [...new Set(input.keyFiles)].sort(),
    blocked: false,
    blocked_reason: null,
  };
}

function decodeRuleExtraction(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function redactProjectRoot(value: unknown, projectPath: string): unknown {
  const root = projectPath.trim();
  if (!root) return value;
  if (typeof value === "string") {
    return value.replaceAll(root, "<project-root>");
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactProjectRoot(item, root));
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        redactProjectRoot(item, root),
      ]),
    );
  }
  return value;
}

function gatewayEndpoint(base: string): string {
  const normalized = base.replace(/\/+$/, "");
  if (normalized.endsWith("/v1/chat/completions")) return normalized;
  if (normalized.endsWith("/v1")) return `${normalized}/chat/completions`;
  return `${normalized}/v1/chat/completions`;
}

function extractContent(value: unknown): string {
  if (!isRecord(value) || !Array.isArray(value.choices)) {
    throw new Error("Gateway response has no choices array");
  }
  const first = value.choices[0];
  if (!isRecord(first) || !isRecord(first.message)) {
    throw new Error("Gateway response has no message");
  }
  if (typeof first.message.content !== "string") {
    throw new Error("Gateway response message content is not a string");
  }
  return first.message.content;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
