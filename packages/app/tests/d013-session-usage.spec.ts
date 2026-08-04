import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import path from "node:path";

const screenshotsDirectory = path.resolve(
  import.meta.dirname,
  "../../../artifacts/qa/screenshots",
);

test("D-013 preserves known, partial, live, missing, zero, and large usage", async ({
  page,
}) => {
  await openFixture(page, "en", "light");

  await expectUsage(page, 1_301, {
    provider: "Claude",
    model: "claude-opus-5-20260731",
    compact: "15.3K",
    title: /15,320 tokens.*Whole session/,
  });
  await expectUsage(page, 1_302, {
    provider: "OpenAI",
    model: "gpt-5.6-sol",
    compact: "128K",
    title: /128,000 tokens.*So far/,
  });
  await expectUsage(page, 1_303, {
    provider: "Claude",
    model: "claude-sonnet-4-5",
    compact: "4.2K",
    title: /4,200 tokens.*Since indexing/,
  });
  await expectUsage(page, 1_304, {
    provider: "OpenAI",
    model: "—",
    compact: "—",
    title: /latest model Unavailable.*total Unavailable/,
  });
  await expectUsage(page, 1_305, {
    provider: "Claude",
    model: "claude-haiku-4-5",
    compact: "0",
    title: /total 0 tokens/,
  });
  await expectUsage(page, 1_306, {
    provider: "OpenAI",
    model:
      "gpt-5.6-sol-2026-07-31-high-reasoning-preview-ultra-long-provider-native-identifier",
    compact: "15.8M",
    title: /15,789,321 tokens/,
  });

  await page
    .getByTestId("project-card-1302")
    .getByRole("button", { name: /codex-live/ })
    .click();
  const detail = page.getByRole("dialog", {
    name: "codex-live session details",
  });
  const usageStrip = detail.locator(".inspector-usage");
  await expect(usageStrip).toContainText("Latest model");
  await expect(usageStrip).toContainText("So far");
  await expect(usageStrip.getByText("Total")).toBeVisible();
  await expect(usageStrip.getByText("Input")).toBeVisible();
  await expect(usageStrip.getByText("Output")).toBeVisible();
  await expect(usageStrip.getByText("Cache")).toBeVisible();
  await expect(usageStrip.getByText("Reasoning")).toBeVisible();
  await expect(
    usageStrip.locator(".usage-metric").filter({ hasText: "Total" }),
  ).toHaveAttribute("title", "Total: 128,000 tokens");
  await expect(
    detail.locator(".agent-usage-recent").first(),
  ).toContainText("OpenAI");
  await expect(
    detail.locator(".agent-usage-recent").first(),
  ).toContainText("gpt-5.6-sol");

  const selectedUsage = page
    .getByTestId("project-card-1302")
    .locator(".agent-usage-row");
  await expect(selectedUsage).toBeHidden();
  await expect(
    page.getByTestId("project-card-1302").locator(".handoff-row-next"),
  ).toBeVisible();
  await assertNoHorizontalOverflow(page, detail);
  await assertAccessible(page);
});

for (const locale of ["zh-Hant", "en"] as const) {
  for (const theme of ["light", "dark"] as const) {
    test(`D-013 row matrix 1280x800 ${locale} ${theme}`, async ({ page }) => {
      await openFixture(page, locale, theme);
      await expect(page.getByTestId("project-card-1306")).toBeVisible();
      await assertNoHorizontalOverflow(page);
      await assertAccessible(page);
      await page.screenshot({
        path: path.join(
          screenshotsDirectory,
          `D-013-rows-1280x800-${locale}-${theme}.png`,
        ),
        animations: "disabled",
      });
    });

    test(`D-013 narrow detail-open 980x800 ${locale} ${theme}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 980, height: 800 });
      await openFixture(page, locale, theme);
      await page
        .getByTestId("project-card-1302")
        .getByRole("button", { name: /codex-live/ })
        .click();
      const dialogName =
        locale === "en"
          ? "codex-live session details"
          : "codex-live session 詳情";
      const detail = page.getByRole("dialog", { name: dialogName });
      await detail.locator(".inspector-usage").scrollIntoViewIfNeeded();
      const sidebarName = locale === "en" ? "Project navigation" : "專案導覽";
      await expect(
        page.getByRole("complementary", { name: sidebarName }),
      ).toBeHidden();
      const workspace = page.locator(".handoff-workspace");
      const workspaceBox = await workspace.boundingBox();
      expect(workspaceBox?.width).toBeGreaterThanOrEqual(520);
      const headingName =
        locale === "en" ? "Handoff Overview" : "接手總覽";
      const headingBox = await page
        .getByRole("heading", { name: headingName, level: 1 })
        .boundingBox();
      expect(headingBox?.height).toBeLessThan(40);
      await expect(page.locator(".handoff-summary-strip")).toBeHidden();
      await expect(
        page
          .getByTestId("project-card-1302")
          .locator(".agent-usage-row"),
      ).toBeHidden();
      await expect(
        page
          .getByTestId("project-card-1302")
          .locator(".handoff-row-next"),
      ).toBeVisible();
      await assertNoHorizontalOverflow(page, detail);
      await assertAccessible(page);
      await page.screenshot({
        path: path.join(
          screenshotsDirectory,
          `D-013-detail-narrow-980x800-${locale}-${theme}.png`,
        ),
        animations: "disabled",
      });
      const recentUsage = detail.locator(".agent-usage-recent").first();
      await recentUsage.scrollIntoViewIfNeeded();
      await expect(recentUsage).toBeVisible();
      await page.screenshot({
        path: path.join(
          screenshotsDirectory,
          `D-013-recent-narrow-980x800-${locale}-${theme}.png`,
        ),
        animations: "disabled",
      });
    });
  }
}

async function openFixture(
  page: Page,
  locale: "zh-Hant" | "en",
  theme: "light" | "dark",
) {
  await page.goto(`/?fixture=d013&locale=${locale}&theme=${theme}`);
  await expect(page.getByTestId("project-card-1302")).toBeVisible();
}

async function expectUsage(
  page: Page,
  projectId: number,
  expected: {
    provider: string;
    model: string;
    compact: string;
    title: RegExp;
  },
) {
  const usage = page
    .getByTestId(`project-card-${projectId}`)
    .locator(".agent-usage-row");
  await expect(usage).toContainText(expected.provider);
  await expect(usage).toContainText(expected.model);
  await expect(usage).toContainText(expected.compact);
  await expect(usage).toHaveAttribute("title", expected.title);
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
