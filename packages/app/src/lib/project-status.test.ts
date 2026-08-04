import { describe, expect, it } from "vitest";
import { TEST_NOW, projectFixture, usageFixture } from "../test/fixtures";
import type { Project, UsageCoverage } from "../types";
import { projectStatus, sortProjects } from "./project-status";

const now = TEST_NOW;
const STALE_AFTER_MS = 72 * 60 * 60 * 1_000;

describe("project status and sort", () => {
  it("prioritizes unacknowledged blockers over live state", () => {
    const blocked = projectFixture({
      liveStatus: {
        pid: 42,
        tool: "codex",
        tmuxTarget: null,
        detectedAt: now.toISOString(),
      },
      latestSession: {
        ...projectFixture().latestSession!,
        summary: {
          ...projectFixture().latestSession!.summary!,
          blocked: true,
        },
      },
    });

    expect(projectStatus(blocked, now)).toBe("attention");
  });

  it.each([
    ["just before 72 hours", STALE_AFTER_MS - 1, "idle"],
    ["at exactly 72 hours", STALE_AFTER_MS, "idle"],
    ["just after 72 hours", STALE_AFTER_MS + 1, "stale"],
  ] as const)("classifies activity %s", (_label, ageMs, expected) => {
    expect(
      projectStatus(
        projectFixture({
          lastActivityAt: new Date(now.getTime() - ageMs).toISOString(),
        }),
        now,
      ),
    ).toBe(expected);
  });

  it("sorts attention, running, pinned, then recent activity", () => {
    const attention = projectFixture({
      id: 1,
      latestSession: {
        ...projectFixture().latestSession!,
        summary: {
          ...projectFixture().latestSession!.summary!,
          blocked: true,
        },
      },
    });
    const running = projectFixture({
      id: 2,
      liveStatus: {
        pid: 100,
        tool: "codex",
        tmuxTarget: null,
        detectedAt: now.toISOString(),
      },
    });
    const pinned = projectFixture({ id: 3, pinned: true });
    const idle = projectFixture({ id: 4 });

    expect(
      sortProjects(
        [idle, pinned, running, attention],
        "priority",
        now,
      ).map(({ id }) => id),
    ).toEqual([1, 2, 3, 4]);
  });

  it("sorts valid activity in either direction and always leaves missing values last", () => {
    const newest = projectFixture({
      id: 1,
      name: "newest",
      lastActivityAt: "2026-07-29T11:00:00.000Z",
    });
    const oldest = projectFixture({
      id: 2,
      name: "oldest",
      lastActivityAt: "2026-07-20T11:00:00.000Z",
    });
    const invalid = projectFixture({
      id: 3,
      name: "invalid",
      lastActivityAt: "not-a-date",
    });
    const missing = projectFixture({
      id: 4,
      name: "missing",
      lastActivityAt: null,
    });
    const projects = [invalid, newest, missing, oldest];

    expect(
      sortProjects(projects, "activity-desc", now).map(({ id }) => id),
    ).toEqual([1, 2, 3, 4]);
    expect(
      sortProjects(projects, "activity-asc", now).map(({ id }) => id),
    ).toEqual([2, 1, 3, 4]);
  });

  it("sorts known complete, partial, and zero token totals while leaving unknown usage last", () => {
    const highest = projectWithUsage(1, "highest", 9_000);
    const partial = projectWithUsage(2, "partial", 1_200, "partial");
    const zero = projectWithUsage(3, "zero", 0);
    const missing = projectWithUsage(4, "missing", null);
    const noSession = projectFixture({
      id: 5,
      name: "no-session",
      latestSession: null,
    });
    const projects = [missing, partial, noSession, highest, zero];

    expect(
      sortProjects(projects, "usage-desc", now).map(({ id }) => id),
    ).toEqual([1, 2, 3, 4, 5]);
    expect(
      sortProjects(projects, "usage-asc", now).map(({ id }) => id),
    ).toEqual([3, 2, 1, 4, 5]);
  });

  it("uses priority, activity, name, and id as deterministic tie breakers", () => {
    const attention = projectWithUsage(9, "zeta", 1_000, "complete", {
      lastActivityAt: "2026-07-29T08:00:00.000Z",
      latestSession: {
        ...projectWithUsage(9, "zeta", 1_000).latestSession!,
        summary: {
          ...projectWithUsage(9, "zeta", 1_000).latestSession!.summary!,
          blocked: true,
        },
        usage: usageFixture({ totalTokens: 1_000 }),
      },
    });
    const recentAlpha = projectWithUsage(4, "alpha", 1_000, "complete", {
      lastActivityAt: "2026-07-29T10:00:00.000Z",
    });
    const recentBeta = projectWithUsage(3, "beta", 1_000, "complete", {
      lastActivityAt: "2026-07-29T10:00:00.000Z",
    });
    const older = projectWithUsage(2, "alpha", 1_000, "complete", {
      lastActivityAt: "2026-07-29T09:00:00.000Z",
    });
    const sameNameAndActivity = projectWithUsage(
      5,
      "alpha",
      1_000,
      "complete",
      {
        lastActivityAt: "2026-07-29T10:00:00.000Z",
      },
    );

    expect(
      sortProjects(
        [older, recentBeta, sameNameAndActivity, attention, recentAlpha],
        "usage-desc",
        now,
      ).map(({ id }) => id),
    ).toEqual([9, 4, 5, 3, 2]);
  });

  it("does not mutate the caller's project array", () => {
    const first = projectFixture({ id: 1, name: "first" });
    const second = projectFixture({ id: 2, name: "second" });
    const projects = [second, first];

    sortProjects(projects, "activity-desc", now);

    expect(projects).toEqual([second, first]);
  });
});

function projectWithUsage(
  id: number,
  name: string,
  totalTokens: number | null,
  coverage: UsageCoverage = "complete",
  overrides: Partial<Project> = {},
): Project {
  const base = projectFixture({ id, name });
  return projectFixture({
    ...base,
    id,
    name,
    latestSession: {
      ...base.latestSession!,
      id: id * 10,
      projectId: id,
      usage: usageFixture({ totalTokens, coverage }),
    },
    ...overrides,
  });
}
