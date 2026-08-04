import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import path from "node:path";

const screenshotsDirectory = path.resolve(
  import.meta.dirname,
  "../../../artifacts/qa/screenshots",
);

for (const applications of ["present", "absent"] as const) {
  test(`D-014 Escape closes the 944px ${applications} capability menu and restores focus`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 944, height: 800 });
    await page.goto(
      `/?fixture=d013&applications=${applications}&locale=zh-Hant&theme=light`,
    );
    const row = page.getByTestId("project-card-1306");
    const menu = row.locator(".handoff-row-menu");
    const summary = menu.locator(":scope > summary");
    const popover = menu.locator(".handoff-row-menu-popover");

    await summary.click();
    await expect(menu).toHaveAttribute("open", "");
    await expect(popover).toBeVisible();
    await assertPopoverContentContained(row, popover);
    await summary.focus();
    await page.keyboard.press("Escape");

    await expect(menu).not.toHaveAttribute("open", "");
    await expect(popover).not.toBeVisible();
    await expect(summary).toBeFocused();
    await assertNoHorizontalOverflow(page);
  });
}

test("D-014 keeps the 944px long-usage row, menu, and editor in one stable grid", async ({
  page,
}) => {
  await page.setViewportSize({ width: 944, height: 800 });
  await page.goto("/?fixture=d013&locale=zh-Hant&theme=light");
  const row = page.getByTestId("project-card-1306");
  await expect(row).toBeVisible();
  await assertNoHorizontalOverflow(page);
  await assertRowGeometry(row);
  await page.screenshot({
    path: path.join(
      screenshotsDirectory,
      "D-014-row-default-944x800-zh-Hant-light.png",
    ),
    animations: "disabled",
  });

  const menu = row.locator(".handoff-row-menu");
  await menu.locator(":scope > summary").click();
  await expect(menu).toHaveAttribute("open", "");
  const popover = menu.locator(".handoff-row-menu-popover");
  await expect(popover).toBeVisible();
  await expect(menu).toHaveAttribute("data-placement", "top");
  await expect(
    popover.getByRole("button", {
      name: "在 Visual Studio Code 開啟",
    }),
  ).toBeEnabled();
  await expect(
    popover.getByRole("button", { name: "在 Warp 開啟專案目錄" }),
  ).toBeEnabled();
  await expect(
    popover.getByRole("button", { name: /Editor/ }),
  ).toHaveCount(0);
  await assertPopoverInsideViewport(page, popover);
  await assertPopoverContentContained(row, popover);
  await assertPopoverOwnsOverlappingActionPoints(popover);
  await assertNoHorizontalOverflow(page);
  await assertAccessible(page);
  await page.screenshot({
    path: path.join(
      screenshotsDirectory,
      "D-014-row-menu-944x800-zh-Hant-light.png",
    ),
    animations: "disabled",
  });

  await popover
    .getByRole("button", { name: "編輯名稱與 client" })
    .click();
  await expect(menu).not.toHaveAttribute("open", "");
  const editor = row.locator(".handoff-row-editor");
  await expect(editor).toBeVisible();
  const actionBox = await row.locator(".handoff-row-action").boundingBox();
  const editorBox = await editor.boundingBox();
  expect(actionBox).not.toBeNull();
  expect(editorBox).not.toBeNull();
  expect(actionBox!.y + actionBox!.height).toBeLessThanOrEqual(
    editorBox!.y + 1,
  );
  await assertRowGeometry(row);
  await assertNoHorizontalOverflow(page);
  await page.screenshot({
    path: path.join(
      screenshotsDirectory,
      "D-014-row-edit-944x800-zh-Hant-light.png",
    ),
    animations: "disabled",
  });
});

test("D-014 explains absent named applications at 980px in dark English", async ({
  page,
}) => {
  await page.setViewportSize({ width: 980, height: 800 });
  await page.goto(
    "/?fixture=d013&applications=absent&locale=en&theme=dark",
  );
  const row = page.getByTestId("project-card-1306");
  const menu = row.locator(".handoff-row-menu");
  await menu.locator(":scope > summary").click();
  const popover = menu.locator(".handoff-row-menu-popover");
  await expect(menu).toHaveAttribute("data-placement", "top");
  await expect(
    popover.getByRole("button", {
      name: "Visual Studio Code is not installed",
    }),
  ).toBeDisabled();
  await expect(
    popover.getByRole("button", { name: "Warp is not installed" }),
  ).toBeDisabled();
  await assertRowGeometry(row);
  await assertPopoverInsideViewport(page, popover);
  await assertPopoverContentContained(row, popover);
  await assertPopoverOwnsOverlappingActionPoints(popover);
  await assertNoHorizontalOverflow(page);
  await assertAccessible(page);
  await page.screenshot({
    path: path.join(
      screenshotsDirectory,
      "D-014-row-menu-absent-980x800-en-dark.png",
    ),
    animations: "disabled",
  });
});

for (const candidate of [
  { width: 944, locale: "zh-Hant", theme: "dark" },
  { width: 944, locale: "en", theme: "light" },
  { width: 980, locale: "zh-Hant", theme: "light" },
  { width: 980, locale: "en", theme: "dark" },
] as const) {
  test(`D-014 scoped conversation copy ${candidate.width}px ${candidate.locale} ${candidate.theme}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: candidate.width, height: 800 });
    await page.goto(
      `/?fixture=d014&locale=${candidate.locale}&theme=${candidate.theme}`,
    );
    const row = page.getByTestId("project-card-1");
    await row.locator(".handoff-row-main").click();
    const detail = page.getByRole("dialog");
    const loadLabel =
      candidate.locale === "en"
        ? "View Original Conversation"
        : "查看原始對話";
    const load = detail.getByRole("button", { name: loadLabel });
    if ((await load.count()) > 0) {
      await load.first().click();
    }
    const turnLog = detail.locator("details.turn-log").first();
    await expect(turnLog).toBeVisible();
    await turnLog.locator(":scope > summary").click();

    const wholeCopy = turnLog.locator(".turn-log-toolbar .turn-copy-button");
    await expect(wholeCopy).toHaveText(
      candidate.locale === "en"
        ? "Copy latest loaded turns"
        : "複製已載入的最新 turns",
    );
    await expect(wholeCopy).not.toHaveText(
      candidate.locale === "en"
        ? "Copy full conversation"
        : "複製完整對話",
    );

    const promptCard = turnLog.locator(".turn-log-prompt-card").first();
    const promptCopy = promptCard.locator(".turn-copy-button");
    await promptCopy.focus();
    await page.keyboard.press("Enter");
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe(
        "Keep this exact user prompt.\n\nPreserve its spacing and punctuation.",
      );
    await expect(promptCopy).toHaveAttribute("data-copy-state", "copied");
    await expect(promptCopy).toBeFocused();

    const response = turnLog.locator(".turn-response").first();
    await response.locator(":scope > summary").click();
    const responseCopy = response
      .locator(".turn-response-card .turn-copy-button")
      .first();
    await responseCopy.click();
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe(
        "This exact Agent response remains local.\n\nNo earlier turn is implied.",
      );
    await expect(responseCopy).toHaveAttribute("data-copy-state", "copied");
    await expect(promptCopy).toHaveAttribute("data-copy-state", "copied");

    await wholeCopy.click();
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toContain("Turn 23");
    const loadedLog = await page.evaluate(() =>
      navigator.clipboard.readText(),
    );
    expect(loadedLog).toContain(
      "Keep this exact user prompt.\n\nPreserve its spacing and punctuation.",
    );
    expect(loadedLog).toContain(
      "This exact Agent response remains local.\n\nNo earlier turn is implied.",
    );
    expect(loadedLog).not.toContain("Turn 22");

    await response.scrollIntoViewIfNeeded();
    await assertNoHorizontalOverflow(page, detail);
    await assertAccessible(page);
    await page.screenshot({
      path: path.join(
        screenshotsDirectory,
        `D-014-conversation-${candidate.width}x800-${candidate.locale}-${candidate.theme}.png`,
      ),
      animations: "disabled",
    });
  });
}

async function assertRowGeometry(row: Locator) {
  const rowBox = await row.boundingBox();
  const mainBox = await row.locator(".handoff-row-main").boundingBox();
  const actionBox = await row.locator(".handoff-row-action").boundingBox();
  expect(rowBox).not.toBeNull();
  expect(mainBox).not.toBeNull();
  expect(actionBox).not.toBeNull();
  expect(mainBox!.x + mainBox!.width).toBeLessThanOrEqual(actionBox!.x + 1);
  expect(actionBox!.x + actionBox!.width).toBeLessThanOrEqual(
    rowBox!.x + rowBox!.width + 1,
  );
  expect(
    await row
      .locator(".handoff-row-main")
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
}

async function assertPopoverInsideViewport(page: Page, popover: Locator) {
  const box = await popover.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height);
}

async function assertPopoverContentContained(
  row: Locator,
  popover: Locator,
) {
  const containment = await popover.evaluate((element) => {
    const popoverBox = element.getBoundingClientRect();
    const buttons = [
      ...element.querySelectorAll<HTMLButtonElement>("button"),
    ];
    return {
      scrollContained: element.scrollWidth <= element.clientWidth,
      buttonsContained: buttons.every((button) => {
        const box = button.getBoundingClientRect();
        return (
          box.left >= popoverBox.left &&
          box.right <= popoverBox.right
        );
      }),
    };
  });
  expect(containment.scrollContained).toBe(true);
  expect(containment.buttonsContained).toBe(true);
  expect(
    await row.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
}

async function assertPopoverOwnsOverlappingActionPoints(popover: Locator) {
  expect(
    await popover.evaluate((element) => {
      const popoverBox = element.getBoundingClientRect();
      const ownerRow = element.closest(".handoff-project-row");
      const overlappingAction = [
        ...document.querySelectorAll<HTMLElement>(".handoff-row-action"),
      ].find((action) => {
        if (action.closest(".handoff-project-row") === ownerRow) return false;
        const box = action.getBoundingClientRect();
        const centerX = box.left + box.width / 2;
        const centerY = box.top + box.height / 2;
        return (
          centerX >= popoverBox.left &&
          centerX <= popoverBox.right &&
          centerY >= popoverBox.top &&
          centerY <= popoverBox.bottom
        );
      });
      if (!overlappingAction) return false;
      const box = overlappingAction.getBoundingClientRect();
      const topmost = document.elementFromPoint(
        box.left + box.width / 2,
        box.top + box.height / 2,
      );
      return topmost !== null && element.contains(topmost);
    }),
  ).toBe(true);
}

async function assertNoHorizontalOverflow(
  page: Page,
  detail?: Locator,
) {
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  if (detail) {
    expect(
      await detail.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
  }
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
