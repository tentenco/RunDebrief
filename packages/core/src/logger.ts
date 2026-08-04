import fs from "node:fs";
import path from "node:path";
import pino, { type Logger } from "pino";

export function createCoreLogger(logDir: string): Logger {
  fs.mkdirSync(logDir, { recursive: true, mode: 0o700 });
  const destination = pino.destination({
    dest: path.join(logDir, "core.log"),
    mkdir: false,
    sync: true,
  });

  return pino(
    {
      base: { service: "debrief-core" },
      level: process.env.DEBRIEF_LOG_LEVEL ?? "info",
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    destination,
  );
}
