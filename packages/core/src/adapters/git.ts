import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { CoreLogger, GitSnapshot } from "../types.js";

const execFileAsync = promisify(execFile);

export class GitAdapter {
  constructor(private readonly logger: CoreLogger) {}

  async inspect(projectPath: string): Promise<GitSnapshot | null> {
    try {
      const inside = await this.git(projectPath, [
        "rev-parse",
        "--is-inside-work-tree",
      ]);
      if (inside.trim() !== "true") return null;

      const [branchResult, statusResult, commitResult] =
        await Promise.allSettled([
          this.git(projectPath, ["branch", "--show-current"]),
          this.git(projectPath, ["status", "--porcelain"]),
          this.git(projectPath, ["log", "-1", "--format=%s%x00%cI"]),
        ]);

      const branch =
        branchResult.status === "fulfilled"
          ? branchResult.value.trim() || null
          : null;
      const dirty =
        statusResult.status === "fulfilled" &&
        statusResult.value.trim().length > 0;
      let lastCommitSubject: string | null = null;
      let lastCommitAt: string | null = null;

      if (commitResult.status === "fulfilled") {
        const [subject, committedAt] = commitResult.value.trim().split("\0");
        lastCommitSubject = subject || null;
        lastCommitAt = committedAt || null;
      }

      return { branch, dirty, lastCommitSubject, lastCommitAt };
    } catch (error) {
      this.logger.debug(
        {
          event: "non_git_project",
          projectPath,
          reason: error instanceof Error ? error.message : String(error),
        },
        "Skipping Git metadata for non-repository",
      );
      return null;
    }
  }

  private async git(cwd: string, args: string[]): Promise<string> {
    const result = await execFileAsync("git", args, {
      cwd,
      encoding: "utf8",
      timeout: 10_000,
      maxBuffer: 2 * 1024 * 1024,
    });
    return result.stdout;
  }
}
