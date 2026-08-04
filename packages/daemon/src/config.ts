import fs from "node:fs/promises";

export const DEFAULT_SUMMARY_MODEL = "deepseek-chat";

export interface DaemonConfig {
  gatewayUrl: string;
  gatewayKey: string;
  summaryModel: string;
  mem0Url: string | null;
  mem0Key: string | null;
  mem0UserId: string | null;
}

interface ConfigFile {
  gatewayUrl?: unknown;
  gatewayKey?: unknown;
  summaryModel?: unknown;
}

export async function loadDaemonConfig(
  configPath: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<DaemonConfig> {
  let file: ConfigFile = {};
  try {
    const decoded: unknown = JSON.parse(await fs.readFile(configPath, "utf8"));
    if (isObject(decoded)) file = decoded;
  } catch (error) {
    if (!isMissingFile(error)) throw error;
  }

  return {
    gatewayUrl: stringValue(env.DEBRIEF_GATEWAY_URL) ?? stringValue(file.gatewayUrl) ?? "",
    gatewayKey: stringValue(env.DEBRIEF_GATEWAY_KEY) ?? stringValue(file.gatewayKey) ?? "",
    summaryModel:
      stringValue(env.DEBRIEF_MODEL) ??
      stringValue(file.summaryModel) ??
      DEFAULT_SUMMARY_MODEL,
    mem0Url: stringValue(env.DEBRIEF_MEM0_URL),
    mem0Key: stringValue(env.DEBRIEF_MEM0_KEY),
    mem0UserId: stringValue(env.DEBRIEF_MEM0_USER_ID),
  };
}

function isObject(value: unknown): value is ConfigFile {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
