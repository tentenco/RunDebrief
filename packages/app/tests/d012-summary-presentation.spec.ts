import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import path from "node:path";

const screenshotsDirectory = path.resolve(
  import.meta.dirname,
  "../../../artifacts/qa/screenshots",
);

test("D-012 sanitizes legacy progress while preserving safe original evidence", async ({
  page,
}) => {
  await page.setViewportSize({ width: 980, height: 640 });
  await openFixture(page, "light");

  const detail = page.getByRole("dialog", {
    name: "d012-summary-fixture session details",
  });
  const currentSummary = detail.locator(".inspector-summary");
  await expect(
    currentSummary.getByRole("heading", {
      name: "Verified D-012 outcome",
    }),
  ).toBeVisible();
  await expect(currentSummary).not.toContainText("developer:");
  await expect(currentSummary).not.toContainText("<environment_context>");
  await expect(currentSummary).not.toContainText("<oai-mem-citation>");

  const summaryToggle = currentSummary.locator("button.summary-toggle");
  await expect(summaryToggle).toHaveText("Show more");
  await expect(summaryToggle).toHaveAttribute("aria-expanded", "false");
  await expect(
    currentSummary.getByRole("button", { name: "Copy code" }),
  ).toHaveCount(0);
  await summaryToggle.focus();
  await page.keyboard.press("Enter");
  await expect(summaryToggle).toHaveAttribute("aria-expanded", "true");
  const summaryCopy = currentSummary.locator(
    ".markdown-code-toolbar button",
  );
  await expect(summaryCopy).toHaveText("Copy code");
  await expect(currentSummary.getByText("ts", { exact: true })).toBeVisible();
  await summaryCopy.focus();
  await page.keyboard.press("Enter");
  await expect(summaryCopy).toHaveText("Copied");
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe(
      [
        "const presentation = {",
        '  source: "rules-fallback",',
        "  sanitized: true,",
        "};",
      ].join("\n"),
    );

  await detail
    .getByRole("button", { name: "Copy Handoff Recap" })
    .click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toContain("## Verified D-012 outcome");
  const recap = await page.evaluate(() => navigator.clipboard.readText());
  expect(recap).toContain(
    [
      "```ts",
      "const presentation = {",
      '  source: "rules-fallback",',
      "  sanitized: true,",
      "};",
      "```",
    ].join("\n"),
  );
  expect(recap).not.toContain("developer:");
  expect(recap).not.toContain("<environment_context>");
  expect(recap).not.toContain("<oai-mem-citation>");
  expect(recap).not.toContain("user: Continue the D-012 work.");

  await summaryToggle.click();
  await expect(summaryToggle).toBeFocused();
  await expect(summaryToggle).toHaveAttribute("aria-expanded", "false");
  await expect(
    currentSummary.getByRole("button", { name: /Copy code|Copied/ }),
  ).toHaveCount(0);

  const turnLog = detail.locator("details.turn-log").first();
  await expect(turnLog).toBeVisible();
  await turnLog.locator(":scope > summary").click();
  await expect(turnLog.locator("script")).toHaveCount(0);
  await expect(turnLog.locator("img")).toHaveCount(0);
  await expect(turnLog.locator("a")).toHaveCount(0);
  await expect(
    turnLog.getByText("Image blocked: remote fixture"),
  ).toBeVisible();
  await expect(
    turnLog.getByRole("note", { name: "External link disabled" }),
  ).toBeVisible();

  const response = turnLog.locator("details.turn-response");
  await response.locator(":scope > summary").click();
  await expect(
    response.getByRole("heading", { name: "Agent response" }),
  ).toBeVisible();
  await expect(response.getByText("json", { exact: true })).toBeVisible();
  await expect(response.getByText("bash", { exact: true })).toBeVisible();
  await expect(
    response.getByRole("button", { name: "Copy code" }),
  ).toHaveCount(2);

  await assertNoHorizontalOverflow(page, detail);
  await assertAccessible(page);

  const separator = page.getByRole("separator", {
    name: "Resize details panel",
  });
  await expect(separator).toHaveAttribute("aria-valuenow", "408");
  await separator.focus();
  await page.keyboard.press("Home");
  await expect(separator).toHaveAttribute("aria-valuenow", "320");
  await assertNoHorizontalOverflow(page, detail);
});

for (const viewport of [
  { width: 1280, height: 800, label: "1280x800" },
  { width: 980, height: 640, label: "980x640" },
] as const) {
  for (const theme of ["light", "dark"] as const) {
    test(`D-012 detail, turn, and code evidence ${viewport.label} ${theme}`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await openFixture(page, theme);
      const detail = page.getByRole("dialog", {
        name: "d012-summary-fixture session details",
      });
      const currentSummary = detail.locator(".inspector-summary");
      await currentSummary
        .getByRole("button", { name: "Show more" })
        .click();
      const turnLog = detail.locator("details.turn-log").first();
      await expect(turnLog).toBeVisible();
      await turnLog.locator(":scope > summary").click();
      const response = turnLog.locator("details.turn-response");
      await response.locator(":scope > summary").click();
      await response.scrollIntoViewIfNeeded();
      await expect(
        response.getByRole("button", { name: "Copy code" }),
      ).toHaveCount(2);
      await assertNoHorizontalOverflow(page, detail);
      await assertAccessible(page);
      await page.screenshot({
        path: path.join(
          screenshotsDirectory,
          `D-012-detail-turn-code-${viewport.label}-${theme}.png`,
        ),
        animations: "disabled",
      });
    });
  }
}

async function openFixture(page: Page, theme: "light" | "dark") {
  await page.goto(
    `/?fixture=d012&locale=en&theme=${theme}`,
  );
  await page
    .getByTestId("project-card-1201")
    .getByRole("button", { name: /d012-summary-fixture/ })
    .click();
}

async function assertNoHorizontalOverflow(
  page: Page,
  detail: Locator,
) {
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  expect(
    await detail.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
}

async function assertAccessible(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter(
    (violation) =>
      violation.impact === "critical" ||
      violation.id === "color-contrast",
  );
  expect(
    serious,
    serious
      .map(
        (violation) =>
          `${violation.id}: ${violation.nodes
            .map((node) => node.target.join(" "))
            .join(", ")}`,
      )
      .join("\n"),
  ).toEqual([]);
}
