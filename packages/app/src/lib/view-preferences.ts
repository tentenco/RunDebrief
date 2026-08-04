import {
  isProjectSortOrder,
  type ProjectSortOrder,
} from "./project-status";

export const SIDEBAR_VISIBILITY_KEY = "debrief-sidebar-visible";
export const DETAIL_WIDTH_KEY = "debrief-detail-width";
export const THEME_PREFERENCE_KEY = "debrief-theme";
export const PROJECT_SORT_KEY = "debrief-project-sort";

export type ThemePreference = "light" | "dark";

export const DETAIL_WIDTH_MIN = 320;
export const DETAIL_WIDTH_DEFAULT = 408;
export const DETAIL_WIDTH_MAX = 720;
export const DETAIL_WIDTH_STEP = 24;
export const COMPACT_LAYOUT_MAX_WIDTH = 1180;

const SIDEBAR_WIDTH = 224;
const DETAIL_RESIZER_WIDTH = 8;
const MAIN_CONTENT_MIN_WIDTH = 320;

export function readSidebarVisibility(storage: Storage): boolean {
  try {
    return storage.getItem(SIDEBAR_VISIBILITY_KEY) !== "false";
  } catch {
    return true;
  }
}

export function writeSidebarVisibility(
  storage: Storage,
  visible: boolean,
): void {
  try {
    storage.setItem(SIDEBAR_VISIBILITY_KEY, String(visible));
  } catch {
    // View preferences are best-effort and never block the app shell.
  }
}

export function readThemePreference(
  storage: Storage,
  prefersDark: boolean,
): ThemePreference {
  try {
    const stored = storage.getItem(THEME_PREFERENCE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // Fall through to the system preference.
  }
  return prefersDark ? "dark" : "light";
}

export function hasStoredThemePreference(storage: Storage): boolean {
  try {
    const stored = storage.getItem(THEME_PREFERENCE_KEY);
    return stored === "light" || stored === "dark";
  } catch {
    return false;
  }
}

export function writeThemePreference(
  storage: Storage,
  theme: ThemePreference,
): void {
  try {
    storage.setItem(THEME_PREFERENCE_KEY, theme);
  } catch {
    // View preferences are best-effort and never block the app shell.
  }
}

export function readProjectSortPreference(
  storage: Storage,
): ProjectSortOrder {
  try {
    const stored = storage.getItem(PROJECT_SORT_KEY);
    if (stored && isProjectSortOrder(stored)) return stored;
  } catch {
    // Fall through to the workflow-first default.
  }
  return "priority";
}

export function writeProjectSortPreference(
  storage: Storage,
  order: ProjectSortOrder,
): void {
  try {
    storage.setItem(PROJECT_SORT_KEY, order);
  } catch {
    // View preferences are best-effort and never block the app shell.
  }
}

export function detailWidthMaximum(
  viewportWidth: number,
  sidebarVisible: boolean,
): number {
  const available =
    viewportWidth -
    (sidebarVisible ? SIDEBAR_WIDTH : 0) -
    DETAIL_RESIZER_WIDTH -
    MAIN_CONTENT_MIN_WIDTH;
  return Math.max(DETAIL_WIDTH_MIN, Math.min(DETAIL_WIDTH_MAX, available));
}

export function clampDetailWidth(
  value: number,
  viewportWidth: number,
  sidebarVisible: boolean,
): number {
  const finiteValue = Number.isFinite(value) ? value : DETAIL_WIDTH_DEFAULT;
  return Math.round(
    Math.max(
      DETAIL_WIDTH_MIN,
      Math.min(
        detailWidthMaximum(viewportWidth, sidebarVisible),
        finiteValue,
      ),
    ),
  );
}

export function readDetailWidth(
  storage: Storage,
  viewportWidth: number,
  sidebarVisible: boolean,
): number {
  try {
    const value = storage.getItem(DETAIL_WIDTH_KEY);
    const stored = value === null ? DETAIL_WIDTH_DEFAULT : Number(value);
    return clampDetailWidth(stored, viewportWidth, sidebarVisible);
  } catch {
    return clampDetailWidth(
      DETAIL_WIDTH_DEFAULT,
      viewportWidth,
      sidebarVisible,
    );
  }
}

export function writeDetailWidth(storage: Storage, width: number): void {
  try {
    storage.setItem(DETAIL_WIDTH_KEY, String(width));
  } catch {
    // View preferences are best-effort and never block the app shell.
  }
}
