import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { CommandRunner } from "./types.js";

const execFileAsync = promisify(execFile);

export const systemCommandRunner: CommandRunner = {
  async run(executable, args, options = {}) {
    const result = await execFileAsync(executable, [...args], {
      cwd: options.cwd,
      encoding: "utf8",
      timeout: options.timeout,
      maxBuffer: options.maxBuffer,
    });
    return {
      stdout: result.stdout,
      stderr: result.stderr,
    };
  },
};
