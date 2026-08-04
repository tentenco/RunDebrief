import type { Project, ProjectStatus } from "../types";

const STALE_AFTER_MS = 72 * 60 * 60 * 1_000;

export function projectStatus(
  project: Project,
  now = new Date(),
): ProjectStatus {
  if (
    project.latestSession?.summary?.blocked &&
    !project.latestSession.summary.acknowledged
  ) {
    return "attention";
  }
  if (project.liveStatus) return "running";
  if (
    project.lastActivityAt &&
    now.getTime() - Date.parse(project.lastActivityAt) > STALE_AFTER_MS
  ) {
    return "stale";
  }
  return "idle";
}

const STATUS_RANK: Record<ProjectStatus, number> = {
  attention: 0,
  running: 1,
  idle: 3,
  stale: 3,
};

export const PROJECT_SORT_ORDERS = [
  "priority",
  "activity-desc",
  "activity-asc",
  "usage-desc",
  "usage-asc",
] as const;

export type ProjectSortOrder = (typeof PROJECT_SORT_ORDERS)[number];

export function isProjectSortOrder(value: string): value is ProjectSortOrder {
  return PROJECT_SORT_ORDERS.includes(value as ProjectSortOrder);
}

export function sortProjects(
  projects: readonly Project[],
  order: ProjectSortOrder = "priority",
  now = new Date(),
): Project[] {
  return [...projects].sort((a, b) => compareProjects(a, b, order, now));
}

function compareProjects(
  a: Project,
  b: Project,
  order: ProjectSortOrder,
  now: Date,
): number {
  if (order === "activity-desc" || order === "activity-asc") {
    const activityDelta = compareOptionalNumber(
      activityTime(a),
      activityTime(b),
      order === "activity-desc" ? "desc" : "asc",
    );
    if (activityDelta !== 0) return activityDelta;
    return comparePriority(a, b, now, false);
  }

  if (order === "usage-desc" || order === "usage-asc") {
    const usageDelta = compareOptionalNumber(
      tokenUsage(a),
      tokenUsage(b),
      order === "usage-desc" ? "desc" : "asc",
    );
    if (usageDelta !== 0) return usageDelta;
  }

  return comparePriority(a, b, now, true);
}

function comparePriority(
  a: Project,
  b: Project,
  now: Date,
  includeActivity: boolean,
): number {
  const statusDelta =
    STATUS_RANK[projectStatus(a, now)] - STATUS_RANK[projectStatus(b, now)];
  if (statusDelta !== 0) return statusDelta;
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;

  if (includeActivity) {
    const activityDelta = compareOptionalNumber(
      activityTime(a),
      activityTime(b),
      "desc",
    );
    if (activityDelta !== 0) return activityDelta;
  }

  const nameDelta = compareText(a.name, b.name);
  return nameDelta !== 0 ? nameDelta : a.id - b.id;
}

function compareOptionalNumber(
  a: number | null,
  b: number | null,
  direction: "asc" | "desc",
): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return direction === "asc" ? a - b : b - a;
}

function activityTime(project: Project): number | null {
  if (!project.lastActivityAt) return null;
  const timestamp = Date.parse(project.lastActivityAt);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function tokenUsage(project: Project): number | null {
  const totalTokens = project.latestSession?.usage?.totalTokens;
  return typeof totalTokens === "number" &&
    Number.isFinite(totalTokens) &&
    totalTokens >= 0
    ? totalTokens
    : null;
}

function compareText(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}
