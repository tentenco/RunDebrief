// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import {
  PROJECT_SORT_KEY,
  readProjectSortPreference,
  writeProjectSortPreference,
} from "./view-preferences";

describe("project sort preference", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("defaults to priority and accepts only supported sort modes", () => {
    expect(readProjectSortPreference(window.localStorage)).toBe("priority");

    window.localStorage.setItem(PROJECT_SORT_KEY, "usage-asc");
    expect(readProjectSortPreference(window.localStorage)).toBe("usage-asc");

    window.localStorage.setItem(PROJECT_SORT_KEY, "provider");
    expect(readProjectSortPreference(window.localStorage)).toBe("priority");
  });

  it("persists locally without turning storage failures into app failures", () => {
    writeProjectSortPreference(window.localStorage, "activity-desc");
    expect(window.localStorage.getItem(PROJECT_SORT_KEY)).toBe(
      "activity-desc",
    );

    const unavailableStorage = {
      getItem: () => {
        throw new Error("unavailable");
      },
      setItem: () => {
        throw new Error("unavailable");
      },
    } as unknown as Storage;

    expect(readProjectSortPreference(unavailableStorage)).toBe("priority");
    expect(() =>
      writeProjectSortPreference(unavailableStorage, "usage-desc"),
    ).not.toThrow();
  });
});
