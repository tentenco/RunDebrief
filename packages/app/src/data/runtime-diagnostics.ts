import { invoke } from "@tauri-apps/api/core";

export function reportRuntimeError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  if (!window.__TAURI_INTERNALS__) return;
  void invoke("report_frontend_error", { message }).catch(() => undefined);
}

export function reportRuntimeMilestone(name: string): void {
  if (!window.__TAURI_INTERNALS__) return;
  void invoke("report_frontend_event", { name }).catch(() => undefined);
}
