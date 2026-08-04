import os from "node:os";
import path from "node:path";

export interface RuntimePaths {
  debriefHome: string;
  dbPath: string;
  logDir: string;
  configPath: string;
  claudeProjectsRoot: string;
  codexSessionsRoot: string;
}

export function resolveRuntimePaths(
  env: NodeJS.ProcessEnv = process.env,
  userHome = os.homedir(),
): RuntimePaths {
  const debriefHome = env.DEBRIEF_HOME ?? path.join(userHome, ".debrief");

  return {
    debriefHome,
    dbPath: env.DEBRIEF_DB_PATH ?? path.join(debriefHome, "debrief.db"),
    logDir: env.DEBRIEF_LOG_DIR ?? path.join(debriefHome, "logs"),
    configPath:
      env.DEBRIEF_CONFIG_PATH ?? path.join(debriefHome, "config.json"),
    claudeProjectsRoot:
      env.DEBRIEF_CLAUDE_ROOT ??
      path.join(userHome, ".claude", "projects"),
    codexSessionsRoot:
      env.DEBRIEF_CODEX_ROOT ?? path.join(userHome, ".codex", "sessions"),
  };
}
