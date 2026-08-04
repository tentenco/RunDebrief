import type { DashboardRepository } from "../types";
import i18n from "../i18n";
import { DemoRepository } from "./demo-repository";
import { SqliteRepository } from "./sqlite-repository";

export function createRepository(): DashboardRepository {
  if (import.meta.env.VITE_DEBRIEF_DEMO === "1") {
    const parameters = new URLSearchParams(window.location.search);
    const state = parameters.get("state");
    const mode = state === "empty" || state === "error" ? state : "default";
    const requestedRuntime = parameters.get("runtime");
    const runtimeMode =
      requestedRuntime === "setup" || requestedRuntime === "fallback"
        ? requestedRuntime
        : "healthy";
    const requestedFixture = parameters.get("fixture");
    const fixture =
      requestedFixture === "d012" ||
      requestedFixture === "d013" ||
      requestedFixture === "d014" ||
      requestedFixture === "d016"
        ? requestedFixture
        : "default";
    const applicationsMode =
      parameters.get("applications") === "absent" ? "absent" : "present";
    return new DemoRepository(
      mode,
      runtimeMode,
      fixture,
      applicationsMode,
    );
  }
  if (window.__TAURI_INTERNALS__) {
    return new SqliteRepository();
  }
  throw new Error(i18n.t("errors.appRequired"));
}
