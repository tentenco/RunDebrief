import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import path from "node:path";

const screenshotsDirectory = path.resolve(
  import.meta.dirname,
  "../../../artifacts/qa/screenshots",
);

test("D-016 sorts by keyboard, filters, persists, and keeps Recent fixed", async ({
  page,
}) => {
  await page.setViewportSize({ width: 944, height: 640 });
  await page.goto("/?fixture=d013&locale=zh-Hant&theme=light");
  const sort = page.getByRole("combobox", { name: "排序" });
  await expect(sort).toHaveValue("priority");
  await expectProjectOrder(page, [1302, 1301, 1303, 1304, 1305, 1306]);

  await sort.focus();
  await expect(sort).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.locator(".handoff-row-main").first()).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(sort).toBeFocused();
  await sort.selectOption("usage-asc");
  await expectProjectOrder(page, [1305, 1303, 1301, 1302, 1306, 1304]);

  await sort.selectOption("usage-desc");
  await expectProjectOrder(page, [1306, 1302, 1301, 1303, 1305, 1304]);
  await sort.selectOption("activity-asc");
  await expectProjectOrder(page, [1306, 1305, 1304, 1303, 1301, 1302]);
  await sort.selectOption("activity-desc");
  await expectProjectOrder(page, [1302, 1301, 1303, 1304, 1305, 1306]);
  await sort.selectOption("priority");
  await expectProjectOrder(page, [1302, 1301, 1303, 1304, 1305, 1306]);

  await sort.selectOption("usage-desc");
  const search = page.getByRole("searchbox", {
    name: "搜尋專案、分支與摘要",
  });
  await search.fill("partial-index");
  await expectProjectOrder(page, [1303]);
  await search.fill("");
  await expectProjectOrder(page, [1306, 1302, 1301, 1303, 1305, 1304]);

  await page.reload();
  const restoredSort = page.getByRole("combobox", { name: "排序" });
  await expect(restoredSort).toHaveValue("usage-desc");
  await expectProjectOrder(page, [1306, 1302, 1301, 1303, 1305, 1304]);

  await page.getByRole("button", { name: /^最近/ }).click();
  await expect(restoredSort).toBeDisabled();
  await expect(restoredSort).toHaveValue("activity-desc");
  await expect(
    page.getByText("依最後活動排序的 6 個未隱藏專案。"),
  ).toBeVisible();
  await expectProjectOrder(page, [1302, 1301, 1303, 1304, 1305, 1306]);
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("debrief-project-sort")),
    )
    .toBe("usage-desc");

  await page.getByRole("button", { name: /^接手總覽/ }).click();
  await expect(restoredSort).toBeEnabled();
  await expect(restoredSort).toHaveValue("usage-desc");
  await expectProjectOrder(page, [1306, 1302, 1301, 1303, 1305, 1304]);
  await assertNoHorizontalOverflow(page);
  await assertAccessible(page);
});

test("D-016 sticky header owns hit-testing while an open row menu scrolls beneath it", async ({
  page,
}) => {
  await page.setViewportSize({ width: 944, height: 640 });
  await page.goto("/?fixture=d016&locale=zh-Hant&theme=light");
  const sort = page.getByRole("combobox", { name: "排序" });
  await sort.selectOption("usage-asc");

  const row = page.getByTestId("project-card-1305");
  const action = row.locator(".handoff-row-action");
  const menu = row.locator(".handoff-row-menu");
  const summary = menu.locator(":scope > summary");
  const popover = menu.locator(".handoff-row-menu-popover");
  await summary.click();
  await expect(menu).toHaveAttribute("open", "");
  await expect(menu).toHaveAttribute("data-placement", "bottom");
  await expect(popover).toBeVisible();

  const workspace = page.locator(".handoff-workspace");
  const header = page.locator(".handoff-content-header");
  const actionBefore = await requiredBox(action);
  const headerBox = await requiredBox(header);
  const targetY = headerBox.y + headerBox.height - 12;
  const scrollDelta =
    actionBefore.y + actionBefore.height / 2 - targetY;
  await workspace.evaluate(
    (element, delta) => {
      element.scrollTop += delta;
    },
    scrollDelta,
  );

  await expect
    .poll(async () => {
      const box = await requiredBox(action);
      return Math.round(box.y + box.height / 2);
    })
    .toBe(Math.round(targetY));
  await expect(menu).toHaveAttribute("open", "");
  await expect(menu).toHaveAttribute("data-placement", "bottom");
  await expect(popover).toBeVisible();

  const actionAfter = await requiredBox(action);
  const hitTest = await page.evaluate(
    ({ x, y }) => {
      const topmost = document.elementFromPoint(x, y);
      return {
        headerOwnsPoint:
          topmost?.closest(".handoff-content-header") !== null,
        rowOwnsPoint: topmost?.closest(".handoff-project-row") !== null,
      };
    },
    {
      x: actionAfter.x + actionAfter.width / 2,
      y: actionAfter.y + actionAfter.height / 2,
    },
  );
  expect(hitTest).toEqual({
    headerOwnsPoint: true,
    rowOwnsPoint: false,
  });
  await assertPopoverOwnsEveryOverlappingActionPoint(popover);

  await assertNoHorizontalOverflow(page);
  await assertAccessible(page);
  await page.screenshot({
    path: path.join(
      screenshotsDirectory,
      "D-016-open-menu-scroll-header-hit-test-944x640-zh-Hant-light.png",
    ),
    animations: "disabled",
  });
});

for (const locale of ["zh-Hant", "en"] as const) {
  for (const theme of ["light", "dark"] as const) {
    test(`D-016 sort control 944x640 ${locale} ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width: 944, height: 640 });
      await page.goto(`/?fixture=d013&locale=${locale}&theme=${theme}`);
      const label = locale === "en" ? "Sort" : "排序";
      const sort = page.getByRole("combobox", { name: label });
      await expect(sort).toBeVisible();
      await expect(sort.locator("option")).toHaveCount(5);
      await sort.selectOption("usage-desc");
      await expectProjectOrder(page, [1306, 1302, 1301, 1303, 1305, 1304]);
      await assertNoHorizontalOverflow(page);
      await assertAccessible(page);
      await page.screenshot({
        path: path.join(
          screenshotsDirectory,
          `D-016-sort-944x640-${locale}-${theme}.png`,
        ),
        animations: "disabled",
      });
    });
  }
}

async function expectProjectOrder(page: Page, expected: number[]) {
  await expect
    .poll(() =>
      page
        .locator(".handoff-project-row")
        .evaluateAll((rows) =>
          rows.map((row) =>
            Number(row.getAttribute("data-testid")?.replace("project-card-", "")),
          ),
        ),
    )
    .toEqual(expected);
}

async function requiredBox(locator: Locator) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  return box!;
}

async function assertPopoverOwnsEveryOverlappingActionPoint(
  popover: Locator,
) {
  const ownership = await popover.evaluate((element) => {
    const popoverBox = element.getBoundingClientRect();
    const ownerRow = element.closest(".handoff-project-row");
    const overlaps = [
      ...document.querySelectorAll<HTMLElement>(".handoff-row-action"),
    ]
      .filter((action) => action.closest(".handoff-project-row") !== ownerRow)
      .map((action) => {
        const box = action.getBoundingClientRect();
        return {
          x: box.left + box.width / 2,
          y: box.top + box.height / 2,
        };
      })
      .filter(
        ({ x, y }) =>
          x >= popoverBox.left &&
          x <= popoverBox.right &&
          y >= popoverBox.top &&
          y <= popoverBox.bottom,
      );
    return {
      overlapCount: overlaps.length,
      allOwned: overlaps.every(({ x, y }) => {
        const topmost = document.elementFromPoint(x, y);
        return topmost !== null && element.contains(topmost);
      }),
    };
  });
  expect(ownership.overlapCount).toBeGreaterThanOrEqual(2);
  expect(ownership.allOwned).toBe(true);
}

async function assertNoHorizontalOverflow(page: Page) {
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
}

async function assertAccessible(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  const blockers = results.violations.filter(
    (violation) =>
      violation.impact === "critical" ||
      violation.id === "color-contrast",
  );
  expect(
    blockers,
    blockers
      .map(
        (violation) =>
          `${violation.id}: ${violation.nodes
            .map((node) => node.target.join(" "))
            .join(", ")}`,
      )
      .join("\n"),
  ).toEqual([]);
}
