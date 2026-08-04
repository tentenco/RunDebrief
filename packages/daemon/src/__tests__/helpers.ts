import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pino, { type Logger } from "pino";
import type { Clock } from "../types.js";

export class FakeClock implements Clock {
  constructor(private timestamp: number) {}

  now(): Date {
    return new Date(this.timestamp);
  }

  advance(milliseconds: number): void {
    this.timestamp += milliseconds;
  }
}

export function silentLogger(): Logger {
  return pino({ enabled: false });
}

export async function temporaryDirectory(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

export interface MockServer {
  url: string;
  requests(): unknown[];
  close(): Promise<void>;
}

export async function startJsonServer(
  handler: (requestNumber: number, body: unknown) => {
    status?: number;
    body: unknown;
  },
): Promise<MockServer> {
  const bodies: unknown[] = [];
  const server = http.createServer((request, response) => {
    let raw = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      raw += chunk;
    });
    request.on("end", () => {
      let decoded: unknown = raw;
      try {
        decoded = JSON.parse(raw);
      } catch {
        // Tests may intentionally send invalid JSON.
      }
      bodies.push(decoded);
      const result = handler(bodies.length, decoded);
      response.statusCode = result.status ?? 200;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(result.body));
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Mock server did not bind to a TCP port");
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    requests: () => [...bodies],
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
