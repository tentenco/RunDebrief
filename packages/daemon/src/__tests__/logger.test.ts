import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDaemonLogger } from "../logger.js";
import { FakeClock, temporaryDirectory } from "./helpers.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      fs.rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("daemon logger", () => {
  it("writes JSON lines and removes dated logs older than seven days", async () => {
    const root = await temporaryDirectory("debrief-logs-");
    temporaryDirectories.push(root);
    await fs.writeFile(path.join(root, "daemon-2026-07-20.log"), "old\n");
    await fs.writeFile(path.join(root, "daemon-2026-07-28.log"), "recent\n");
    const logger = createDaemonLogger(
      root,
      new FakeClock(Date.parse("2026-07-29T12:00:00.000Z")),
    );

    logger.info({ event: "fixture_event" }, "fixture");
    await new Promise((resolve) => setImmediate(resolve));

    await expect(
      fs.access(path.join(root, "daemon-2026-07-20.log")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      fs.access(path.join(root, "daemon-2026-07-28.log")),
    ).resolves.toBeUndefined();
    const current = await fs.readFile(
      path.join(root, "daemon-2026-07-29.log"),
      "utf8",
    );
    expect(JSON.parse(current)).toMatchObject({
      service: "debrief-daemon",
      event: "fixture_event",
    });
  });
});
