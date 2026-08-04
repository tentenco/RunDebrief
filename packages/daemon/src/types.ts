import type { openDatabase } from "@debrief/core";
import type { Logger } from "pino";

export type DebriefDatabase = ReturnType<typeof openDatabase>;
export type DaemonLogger = Pick<
  Logger,
  "debug" | "error" | "info" | "warn"
>;

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

export interface CommandResult {
  stdout: string;
  stderr: string;
}

export interface CommandOptions {
  cwd?: string;
  timeout?: number;
  maxBuffer?: number;
}

export interface CommandRunner {
  run(
    executable: string,
    args: readonly string[],
    options?: CommandOptions,
  ): Promise<CommandResult>;
}

export interface LiveProject {
  projectId: number;
  projectPath: string;
  pid: number | null;
  tool: "claude-code" | "codex";
  tmuxTarget: string | null;
}

export interface LiveStatusProvider {
  poll(): Promise<LiveProject[]>;
  isProjectLive(projectId: number): boolean;
}
