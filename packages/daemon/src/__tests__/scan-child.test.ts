import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ChildScanRunner } from "../scan-child.js";
import { silentLogger, temporaryDirectory } from "./helpers.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      fs.rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("ChildScanRunner", () => {
  it("runs the fixed CLI scan command and validates bounded metrics", async () => {
    const script = await fixtureScript(
      `if (process.argv.at(-1) !== "scan") process.exit(9);
process.stdout.write(JSON.stringify({
  discoveredFiles: 12,
  discoveredSourceBytes: 100000,
  metadataBytesRead: 2048,
  selectedFiles: 4,
  selectedSourceBytes: 16000,
  deferredFiles: 8,
  parsedFiles: 3,
  unchangedFiles: 9,
  skippedFiles: 0,
  parsedBytes: 4096,
  projectCount: 4
}) + "\\n");`,
    );
    const runner = new ChildScanRunner(
      process.execPath,
      script,
      silentLogger(),
    );

    await expect(runner.scan()).resolves.toEqual({
      discoveredFiles: 12,
      discoveredSourceBytes: 100000,
      metadataBytesRead: 2048,
      selectedFiles: 4,
      selectedSourceBytes: 16000,
      deferredFiles: 8,
      parsedFiles: 3,
      unchangedFiles: 9,
      skippedFiles: 0,
      parsedBytes: 4096,
      projectCount: 4,
    });
  });

  it("bounds failed child output", async () => {
    const script = await fixtureScript(
      `process.stderr.write("failure ".repeat(20000));
process.exitCode = 2;`,
    );
    const runner = new ChildScanRunner(
      process.execPath,
      script,
      silentLogger(),
    );

    const error = await runner.scan().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("[truncated]");
    expect((error as Error).message.length).toBeLessThan(500);
  });

  it("rejects metrics that do not prove bounded session selection", async () => {
    const script = await fixtureScript(
      `process.stdout.write(JSON.stringify({
  discoveredFiles: 12,
  parsedFiles: 12,
  unchangedFiles: 0,
  skippedFiles: 0,
  parsedBytes: 100000,
  projectCount: 4
}) + "\\n");`,
    );
    const runner = new ChildScanRunner(
      process.execPath,
      script,
      silentLogger(),
    );

    await expect(runner.scan()).rejects.toThrow(
      "Scanner child returned invalid metrics",
    );
  });

  it("interrupts and reaps only the exact child during shutdown", async () => {
    const script = await fixtureScript(
      `process.on("SIGINT", () => {});
setInterval(() => {}, 1000);`,
    );
    const runner = new ChildScanRunner(
      process.execPath,
      script,
      silentLogger(),
      [],
      undefined,
      25,
    );
    const abortController = new AbortController();
    const scan = runner.scan({ signal: abortController.signal });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const reason = new Error("test shutdown");
    abortController.abort(reason);

    await expect(scan).rejects.toBe(reason);
  });
});

async function fixtureScript(contents: string): Promise<string> {
  const root = await temporaryDirectory("debrief-scan-child-");
  temporaryDirectories.push(root);
  const script = path.join(root, "fixture.mjs");
  await fs.writeFile(script, `${contents}\n`);
  return script;
}
