import pino, { type Logger } from "pino";

export function silentLogger(): Logger {
  return pino({ enabled: false });
}
