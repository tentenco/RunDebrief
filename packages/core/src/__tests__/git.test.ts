import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { GitAdapter } from "../adapters/git.js";
import { silentLogger } from "./helpers.js";

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      fs.rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("GitAdapter", () => {
  it("returns branch, dirty state, and last commit metadata", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "debrief-git-"));
    temporaryDirectories.push(directory);
    await execFileAsync("git", ["init", "-b", "fixture-branch"], {
      cwd: directory,
    });
    await execFileAsync("git", ["config", "user.name", "Fixture User"], {
      cwd: directory,
    });
    await execFileAsync("git", ["config", "user.email", "fixture@example.invalid"], {
      cwd: directory,
    });
    await fs.writeFile(path.join(directory, "example.txt"), "initial\n");
    await execFileAsync("git", ["add", "example.txt"], { cwd: directory });
    await execFileAsync("git", ["commit", "-m", "test: fixture commit"], {
      cwd: directory,
    });
    await fs.appendFile(path.join(directory, "example.txt"), "dirty\n");

    const result = await new GitAdapter(silentLogger()).inspect(directory);
    expect(result).toMatchObject({
      branch: "fixture-branch",
      dirty: true,
      lastCommitSubject: "test: fixture commit",
    });
    expect(result?.lastCommitAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("skips non-git directories", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "debrief-git-"));
    temporaryDirectories.push(directory);
    await expect(
      new GitAdapter(silentLogger()).inspect(directory),
    ).resolves.toBeNull();
  });
});
