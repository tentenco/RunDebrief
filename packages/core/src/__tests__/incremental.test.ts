import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CodexAdapter } from "../adapters/codex.js";
import {
  readIncrementalJsonl,
  resolveJsonlTailStart,
} from "../adapters/incremental.js";
import { silentLogger } from "./helpers.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      fs.rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("incremental JSONL parsing", () => {
  it("aligns a bounded tail to the next complete JSONL record", async () => {
    const root = await makeTemporaryDirectory();
    const sourcePath = path.join(root, "tail.jsonl");
    const lastRecord = `${JSON.stringify({ id: 2, kept: true })}\n`;
    await fs.writeFile(
      sourcePath,
      `${JSON.stringify({ id: 1, padding: "x".repeat(200) })}\n${lastRecord}`,
    );

    const tail = await resolveJsonlTailStart(sourcePath, 64);
    const records: unknown[] = [];
    const parsed = await readIncrementalJsonl(
      sourcePath,
      tail.startOffset,
      silentLogger(),
      {
        onRecord(record) {
          records.push(record);
        },
      },
    );

    const parsedBytes = "ok" in parsed ? 0 : parsed.bytesParsed;
    expect(
      tail.alignmentBytesRead + parsedBytes,
    ).toBeLessThanOrEqual(64);
    expect(records).toEqual([{ id: 2, kept: true }]);
  });

  it("aborts before resolving a JSONL tail", async () => {
    const root = await makeTemporaryDirectory();
    const sourcePath = path.join(root, "tail-abort.jsonl");
    await fs.writeFile(sourcePath, "{}\n");
    const controller = new AbortController();
    controller.abort(new Error("tail interrupted"));

    await expect(
      resolveJsonlTailStart(sourcePath, 64, controller.signal),
    ).rejects.toThrow("tail interrupted");
  });

  it("leaves a partial final record at its byte offset and parses it after append", async () => {
    const root = await makeTemporaryDirectory();
    const sourcePath = path.join(root, "partial.jsonl");
    const firstLine = JSON.stringify({ id: 1, text: "第一筆" });
    const partialLine = '{"id":2,"text":"第二筆';
    const committedPrefix = `${firstLine}\n`;
    await fs.writeFile(sourcePath, `${committedPrefix}${partialLine}`);

    const firstRecords: unknown[] = [];
    const first = await readIncrementalJsonl(
      sourcePath,
      0,
      silentLogger(),
      {
        onRecord(record) {
          firstRecords.push(record);
        },
      },
    );

    expect(first).toEqual({
      bytesParsed: Buffer.byteLength(committedPrefix),
      nextOffset: Buffer.byteLength(committedPrefix),
    });
    expect(firstRecords).toEqual([{ id: 1, text: "第一筆" }]);

    await fs.appendFile(sourcePath, '"}\n');
    const secondRecords: unknown[] = [];
    const second = await readIncrementalJsonl(
      sourcePath,
      first.nextOffset,
      silentLogger(),
      {
        onRecord(record) {
          secondRecords.push(record);
        },
      },
    );
    const finalSize = (await fs.stat(sourcePath)).size;

    expect(secondRecords).toEqual([{ id: 2, text: "第二筆" }]);
    expect(second).toEqual({
      bytesParsed: finalSize - Buffer.byteLength(committedPrefix),
      nextOffset: finalSize,
    });

    const third = await readIncrementalJsonl(
      sourcePath,
      second.nextOffset,
      silentLogger(),
      { onRecord() {} },
    );
    expect(third).toEqual({ bytesParsed: 0, nextOffset: finalSize });
  });

  it("streams a large JSONL source while retaining only the last message window", async () => {
    const root = await makeTemporaryDirectory();
    const sourcePath = path.join(root, "large.jsonl");
    const handle = await fs.open(sourcePath, "w");
    const messageCount = 6_000;
    const padding = "x".repeat(4_096);

    try {
      for (let batchStart = 0; batchStart < messageCount; batchStart += 100) {
        const lines: string[] = [];
        for (
          let index = batchStart;
          index < Math.min(batchStart + 100, messageCount);
          index += 1
        ) {
          lines.push(
            JSON.stringify({
              timestamp: `2026-01-01T00:${String(index % 60).padStart(2, "0")}:00.000Z`,
              type: "response_item",
              payload: {
                type: "message",
                role: "assistant",
                content: [{ type: "output_text", text: `${index}:${padding}` }],
              },
            }),
          );
        }
        await handle.write(`${lines.join("\n")}\n`);
      }
    } finally {
      await handle.close();
    }

    const adapter = new CodexAdapter(root, silentLogger());
    const parsed = await adapter.parseIncrement(
      {
        sourcePath,
        projectPath: root,
        tool: "codex",
      },
      0,
    );
    const sourceSize = (await fs.stat(sourcePath)).size;

    expect(sourceSize).toBeGreaterThan(20 * 1024 * 1024);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.bytesParsed).toBe(sourceSize);
    expect(parsed.nextOffset).toBe(sourceSize);
    expect(parsed.extraction.messages).toHaveLength(20);
    expect(parsed.extraction.messages[0]?.text).toMatch(/^5980:/);
    expect(parsed.extraction.messages.at(-1)?.text).toMatch(/^5999:/);
  });

  it("boundedly skips an oversized terminated record and continues with later records", async () => {
    const root = await makeTemporaryDirectory();
    const sourcePath = path.join(root, "oversized.jsonl");
    const handle = await fs.open(sourcePath, "w");
    const megabyte = Buffer.alloc(1024 * 1024, 0x78);

    try {
      await handle.write('{"payload":"');
      for (let index = 0; index < 17; index += 1) {
        await handle.write(megabyte);
      }
      await handle.write('"}\n{"id":2,"status":"kept"}\n');
    } finally {
      await handle.close();
    }

    const warningEvents: Array<Record<string, unknown>> = [];
    const baseLogger = silentLogger();
    const records: unknown[] = [];
    const result = await readIncrementalJsonl(
      sourcePath,
      0,
      {
        debug: baseLogger.debug.bind(baseLogger),
        error: baseLogger.error.bind(baseLogger),
        info: baseLogger.info.bind(baseLogger),
        warn(object: Record<string, unknown>) {
          warningEvents.push(object);
        },
      },
      {
        onRecord(record) {
          records.push(record);
        },
      },
    );
    const sourceSize = (await fs.stat(sourcePath)).size;

    expect(result).toEqual({
      bytesParsed: sourceSize,
      nextOffset: sourceSize,
    });
    expect(records).toEqual([{ id: 2, status: "kept" }]);
    expect(warningEvents).toContainEqual(
      expect.objectContaining({
        event: "jsonl_record_too_large",
        line: 1,
      }),
    );
  });

  it("cooperatively aborts between streamed records without returning an offset", async () => {
    const root = await makeTemporaryDirectory();
    const sourcePath = path.join(root, "abort.jsonl");
    await fs.writeFile(
      sourcePath,
      Array.from({ length: 100 }, (_, index) =>
        JSON.stringify({ index }),
      ).join("\n"),
    );
    const controller = new AbortController();
    let seen = 0;

    await expect(
      readIncrementalJsonl(sourcePath, 0, silentLogger(), {
        signal: controller.signal,
        onRecord() {
          seen += 1;
          if (seen === 5) {
            controller.abort(new Error("test scan interrupted"));
          }
        },
      }),
    ).rejects.toThrow("test scan interrupted");
    expect(seen).toBe(5);
  });
});

async function makeTemporaryDirectory(): Promise<string> {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "debrief-incremental-"),
  );
  temporaryDirectories.push(directory);
  return directory;
}
