// @vitest-environment jsdom

import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import {
  DETAIL_WIDTH_DEFAULT,
  DETAIL_WIDTH_KEY,
  DETAIL_WIDTH_MAX,
  DETAIL_WIDTH_MIN,
} from "../lib/view-preferences";
import { DetailInspector } from "./DetailInspector";

describe("DetailInspector", () => {
  beforeEach(() => {
    window.localStorage.clear();
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: 1_280,
    });
  });

  it("supports bounded keyboard resize and double-click reset", async () => {
    render(
      <DetailInspector sidebarVisible>
        <p>Inspector content</p>
      </DetailInspector>,
    );
    const separator = screen.getByRole("separator", {
      name: "調整詳情面板寬度",
    });

    expect(separator).toHaveAttribute(
      "aria-valuenow",
      String(DETAIL_WIDTH_DEFAULT),
    );
    fireEvent.keyDown(separator, { key: "ArrowLeft" });
    expect(separator).toHaveAttribute("aria-valuenow", "432");
    fireEvent.keyDown(separator, { key: "End" });
    expect(separator).toHaveAttribute(
      "aria-valuenow",
      String(DETAIL_WIDTH_MAX),
    );
    fireEvent.keyDown(separator, { key: "ArrowRight" });
    expect(separator).toHaveAttribute("aria-valuenow", "696");
    fireEvent.keyDown(separator, { key: "Home" });
    expect(separator).toHaveAttribute(
      "aria-valuenow",
      String(DETAIL_WIDTH_MIN),
    );
    fireEvent.doubleClick(separator);
    expect(separator).toHaveAttribute(
      "aria-valuenow",
      String(DETAIL_WIDTH_DEFAULT),
    );
    await waitFor(() =>
      expect(window.localStorage.getItem(DETAIL_WIDTH_KEY)).toBe(
        String(DETAIL_WIDTH_DEFAULT),
      ),
    );
  });

  it("supports pointer drag without selection and persists the width", async () => {
    const { unmount } = render(
      <DetailInspector sidebarVisible>
        <p>Inspector content</p>
      </DetailInspector>,
    );
    const separator = screen.getByRole("separator", {
      name: "調整詳情面板寬度",
    });

    fireEvent(separator, pointerEvent("pointerdown", 700));
    expect(document.body).toHaveClass("is-resizing-detail");
    fireEvent(window, pointerEvent("pointermove", 600));
    expect(separator).toHaveAttribute("aria-valuenow", "508");
    fireEvent(window, pointerEvent("pointerup", 600));
    await waitFor(() =>
      expect(document.body).not.toHaveClass("is-resizing-detail"),
    );
    expect(window.localStorage.getItem(DETAIL_WIDTH_KEY)).toBe("508");

    unmount();
    render(
      <DetailInspector sidebarVisible>
        <p>Restored content</p>
      </DetailInspector>,
    );
    expect(
      screen.getByRole("separator", {
        name: "調整詳情面板寬度",
      }),
    ).toHaveAttribute("aria-valuenow", "508");
  });

  it("clamps an oversized stored width to the current viewport", async () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: 900,
    });
    window.localStorage.setItem(DETAIL_WIDTH_KEY, "9999");

    render(
      <DetailInspector sidebarVisible>
        <p>Inspector content</p>
      </DetailInspector>,
    );

    expect(
      screen.getByRole("separator", {
        name: "調整詳情面板寬度",
      }),
    ).toHaveAttribute("aria-valuenow", "348");
    await waitFor(() =>
      expect(window.localStorage.getItem(DETAIL_WIDTH_KEY)).toBe("348"),
    );
  });
});

function pointerEvent(type: string, clientX: number): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    button: { value: 0 },
    clientX: { value: clientX },
  });
  return event;
}
