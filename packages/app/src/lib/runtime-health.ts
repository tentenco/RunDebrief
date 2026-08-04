import type { RuntimeStatus } from "../types";

export function runtimeNeedsAttention(
  status: RuntimeStatus | null,
  error: string | null,
): boolean {
  if (error) return true;
  return Boolean(
    status && (!status.daemon.running || !status.databaseExists),
  );
}
