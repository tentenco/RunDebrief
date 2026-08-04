import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import path from "node:path";

const screenshotsDirectory = path.resolve(
  import.meta.dirname,
  "../../../artifacts/qa/screenshots",
);

test("keyboard map, focus restoration, and VoiceOver labels are complete", async ({
  page,
}) => {
  await page.goto("/?locale=zh-Hant&theme=light");
  await expect(page.getByRole("heading", { name: "接手總覽" })).toBeVisible();

  const sidebar = page.getByRole("complementary", { name: "專案導覽" });
  await expect(sidebar).toBeVisible();
  await expect(
    page.getByRole("searchbox", { name: "搜尋專案、分支與摘要" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "開啟快速前往" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /重新讀取/ }),
  ).toBeVisible();
  await page.keyboard.press("Meta+Shift+s");
  await expect(sidebar).toBeHidden();
  await expect(
    page.getByRole("button", { name: "顯示側邊欄" }),
  ).toBeVisible();
  await page.keyboard.press("Meta+Shift+s");
  await expect(sidebar).toBeVisible();

  await page.keyboard.press("Meta+f");
  await expect(
    page.getByRole("searchbox", { name: "搜尋專案、分支與摘要" }),
  ).toBeFocused();

  const cards = page.locator(".handoff-row-main");
  await cards.first().focus();
  await page.keyboard.press("ArrowDown");
  await expect(cards.nth(1)).toBeFocused();
  await page.keyboard.press(" ");
  const detail = page.getByRole("dialog");
  await expect(detail).toBeVisible();
  await expect(
    detail.getByRole("button", { name: "關閉詳情" }),
  ).toBeFocused();
  const separator = page.getByRole("separator", {
    name: "調整詳情面板寬度",
  });
  const defaultWidth = Number(await separator.getAttribute("aria-valuenow"));
  await separator.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(separator).toHaveAttribute(
    "aria-valuenow",
    String(defaultWidth + 24),
  );
  await separator.dblclick();
  await expect(separator).toHaveAttribute(
    "aria-valuenow",
    String(defaultWidth),
  );

  await page.keyboard.press("Meta+Enter");
  await expect(page.locator(".notice-toast")).toContainText("recap 已複製");
  await page.keyboard.press("Escape");
  await expect(detail).toBeHidden();
  await expect(cards.nth(1)).toBeFocused();

  await page.keyboard.press("Meta+5");
  await expect(
    page.getByRole("button", { name: /已置頂/ }),
  ).toHaveAttribute("aria-current", "page");
  await page.keyboard.press("Meta+r");

  expect(
    await page.locator('[aria-label^="專案狀態："]').count(),
  ).toBeGreaterThan(0);
  await expect(page.locator(".status-badge").first()).toContainText(
    /Needs Attention|Running|Idle|Stale/,
  );
});

test("motion tokens and reduced-motion kill switch are observable", async ({
  page,
}) => {
  await page.goto("/?locale=zh-Hant&theme=light");
  const dot = page.locator(".status-running .status-dot");
  await expect(dot).toBeVisible();
  expect(await dot.evaluate((element) => getComputedStyle(element).animationDuration))
    .toBe("2s");

  await page.emulateMedia({ reducedMotion: "reduce" });
  const reducedDuration = await dot.evaluate((element) =>
    Number.parseFloat(getComputedStyle(element).animationDuration),
  );
  expect(reducedDuration).toBeLessThanOrEqual(0.001);
});

test("command palette and source evidence are keyboard and axe accessible", async ({
  page,
}) => {
  for (const theme of ["light", "dark"] as const) {
    await page.goto(`/?locale=zh-Hant&theme=${theme}`);
    await page.keyboard.press("Meta+k");
    const palette = page.getByRole("dialog", { name: "快速前往" });
    await expect(palette).toBeVisible();
    const commandSearch = palette.getByRole("combobox", {
      name: "搜尋頁面或專案",
    });
    await expect(commandSearch).toBeFocused();
    const lastOption = palette.getByRole("option").last();
    await page.keyboard.press("Shift+Tab");
    await expect(lastOption).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(commandSearch).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(palette).toBeHidden();
    await expect(
      page.getByRole("button", { name: "開啟快速前往" }),
    ).toBeFocused();

    await page.keyboard.press("Meta+k");
    await expect(palette).toBeVisible();
    await expect(commandSearch).toBeFocused();
    await assertAccessible(page);
    await page.screenshot({
      path: path.join(
        screenshotsDirectory,
        `G4-command-${theme}.png`,
      ),
      animations: "disabled",
    });

    await commandSearch.fill("資料來源");
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("heading", { name: "資料來源" }),
    ).toBeVisible();
    await expect(
      page.getByText("Dashboard 無獨立 health signal · 選用"),
    ).toBeVisible();
    await expect(
      page.getByText(/不可用時使用 canonical raw JSONL/),
    ).toBeVisible();
    await assertAccessible(page);
    await page.screenshot({
      path: path.join(
        screenshotsDirectory,
        `G4-sources-${theme}.png`,
      ),
      animations: "disabled",
    });
  }
});

test("original turn log disclosure remains keyboard and axe accessible", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/?locale=zh-Hant&theme=light");
  await page
    .getByTestId("project-card-1")
    .getByRole("button", { name: /debrief, Running/ })
    .click();
  const detail = page.getByRole("dialog", {
    name: "debrief session 詳情",
  });
  const turnLog = detail.locator("details.turn-log").first();
  const turnLogSummary = turnLog.locator(":scope > summary");
  await expect(turnLog).not.toHaveAttribute("open");
  await expect(detail.getByText("User prompt").first()).toBeHidden();
  await turnLogSummary.focus();
  await expect(turnLogSummary).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(turnLog).toHaveAttribute("open");
  await page.keyboard.press("Enter");
  await expect(turnLog).not.toHaveAttribute("open");
  await page.keyboard.press("Enter");
  await expect(turnLog).toHaveAttribute("open");
  await expect(detail.getByText("User prompt").first()).toBeVisible();
  const responseDisclosure = turnLog.locator("details.turn-response").first();
  const disclosure = responseDisclosure.locator(":scope > summary");
  const responseText = responseDisclosure.getByText(
    "已讀取目前狀態並完成安全範圍內的更新；下一步是執行對應 gate。",
    { exact: true },
  );
  await expect(responseDisclosure).not.toHaveAttribute("open");
  await expect(responseText).toBeHidden();
  await disclosure.focus();
  await expect(disclosure).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(responseDisclosure).toHaveAttribute("open");
  await expect(responseText).toBeVisible();
  await assertAccessible(page);
  await page.keyboard.press("Escape");
  await expect(detail).toBeHidden();
});

for (const theme of ["light", "dark"] as const) {
  test(`Markdown turn content is structured and highlighted in ${theme} mode`, async ({
    page,
  }) => {
    await page.goto(`/?locale=zh-Hant&theme=${theme}`);
    await page
      .getByTestId("project-card-1")
      .getByRole("button", { name: /debrief, Running/ })
      .click();
    const detail = page.getByRole("dialog", {
      name: "debrief session 詳情",
    });
    const turnLog = detail.locator("details.turn-log").first();
    await turnLog.locator(":scope > summary").click();

    await expect(
      detail.getByRole("heading", { name: "Release checklist" }),
    ).toBeVisible();
    await expect(detail.getByRole("table")).toBeVisible();
    await expect(detail.locator(".hljs-keyword")).toHaveText("const");
    await assertAccessible(page, ".detail-panel");
  });
}

for (const route of [
  "/?locale=zh-Hant&theme=light",
  "/?locale=zh-Hant&theme=dark",
  "/?locale=zh-Hant&state=onboarding&runtime=setup&theme=light",
  "/?locale=zh-Hant&state=scanning&theme=dark",
  "/?locale=zh-Hant&state=empty&theme=light",
  "/?locale=zh-Hant&state=error&theme=dark",
]) {
  test(`axe has zero critical and zero contrast violations on ${route}`, async ({
    page,
  }) => {
    await page.goto(route);
    await expect(page.locator("body")).not.toBeEmpty();
    await assertAccessible(page);
  });
}

test("light and dark visual-state matrix is screenshot-ready", async ({
  page,
}) => {
  for (const theme of ["light", "dark"] as const) {
    await page.goto(`/?locale=zh-Hant&theme=${theme}`);
    await expect(page.getByRole("heading", { name: "接手總覽" })).toBeVisible();
    await page.screenshot({
      path: path.join(screenshotsDirectory, `G4-main-${theme}.png`),
      animations: "disabled",
    });

    await page.locator(".handoff-row-main").first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.screenshot({
      path: path.join(screenshotsDirectory, `G4-detail-${theme}.png`),
      animations: "disabled",
    });

    await page.goto(`/?locale=zh-Hant&state=empty&theme=${theme}`);
    await expect(page.getByText(/第一個 session/)).toBeVisible();
    await page.screenshot({
      path: path.join(screenshotsDirectory, `G4-empty-${theme}.png`),
      animations: "disabled",
    });
  }
});

async function assertAccessible(page: Page, include?: string) {
  const builder = new AxeBuilder({ page });
  if (include) {
    builder.include(include);
  }
  const results = await builder.analyze();
  const critical = results.violations.filter(
    (violation) => violation.impact === "critical",
  );
  const contrast = results.violations.filter(
    (violation) => violation.id === "color-contrast",
  );
  expect(critical, describeViolations(critical)).toEqual([]);
  expect(contrast, describeViolations(contrast)).toEqual([]);
}

function describeViolations(
  violations: Awaited<ReturnType<AxeBuilder["analyze"]>>["violations"],
): string {
  return violations
    .map(
      (violation) =>
        `${violation.id}: ${violation.nodes
          .map((node) => node.target.join(" "))
          .join(", ")}`,
    )
    .join("\n");
}
