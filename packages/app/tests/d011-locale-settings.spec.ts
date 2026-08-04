import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import path from "node:path";

const screenshotsDirectory = path.resolve(
  import.meta.dirname,
  "../../../artifacts/qa/screenshots",
);

test("locale switches immediately, preserves live view state, and survives reload", async ({
  page,
}) => {
  await page.goto("/?theme=light");
  await expect(
    page.getByRole("heading", { name: "Handoff Overview" }),
  ).toBeVisible();

  const search = page.getByRole("searchbox", {
    name: "Search projects, branches, and summaries",
  });
  await search.fill("debrief");
  await page.getByRole("button", { name: /^debrief,/ }).click();
  await expect(
    page.getByRole("dialog", { name: "debrief session details" }),
  ).toBeVisible();
  await page.keyboard.press("Meta+,");

  const englishSettings = page.getByRole("heading", {
    name: "Settings",
    level: 1,
  });
  await expect(englishSettings).toBeVisible();
  const englishRadio = page.getByRole("radio", { name: "English" });
  await expect(englishRadio).toBeChecked();
  await expect(englishRadio).toBeFocused();
  await expect(
    page.getByRole("dialog", { name: "debrief session details" }),
  ).toHaveCount(0);
  await page.getByRole("radio", { name: "繁體中文" }).click();

  const chineseSettings = page.getByRole("heading", {
    name: "設定",
    level: 1,
  });
  await expect(chineseSettings).toBeVisible();
  await expect(
    page.getByRole("searchbox", { name: "搜尋專案、分支與摘要" }),
  ).toHaveValue("debrief");
  await expect
    .poll(() =>
      page.evaluate(() => ({
        lang: document.documentElement.lang,
        stored: window.localStorage.getItem("debrief-locale"),
      })),
    )
    .toEqual({ lang: "zh-Hant", stored: "zh-Hant" });

  await page.getByRole("button", { name: /^接手總覽/ }).click();
  await expect(
    page.getByRole("dialog", { name: "debrief session 詳情" }),
  ).toBeVisible();
  await expect(
    page.getByRole("searchbox", { name: "搜尋專案、分支與摘要" }),
  ).toHaveValue("debrief");
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("dialog", { name: "debrief session 詳情" }),
  ).toHaveCount(0);

  await page.reload();
  await expect(
    page.getByRole("heading", { name: "接手總覽", level: 1 }),
  ).toBeVisible();
  await page.keyboard.press("Meta+,");
  await expect(
    page.getByRole("heading", { name: "設定", level: 1 }),
  ).toBeVisible();
  await expect(page.getByRole("radio", { name: "繁體中文" })).toBeChecked();

  await page.getByRole("radio", { name: "English" }).click();
  await expect(
    page.getByRole("heading", { name: "Settings", level: 1 }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Handoff Overview", level: 1 }),
  ).toBeVisible();
  await page.keyboard.press("Meta+,");
  await expect(
    page.getByRole("heading", { name: "Settings", level: 1 }),
  ).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.lang))
    .toBe("en");

  await page.getByRole("button", { name: /^Handoff Overview/ }).click();
  await page.keyboard.press("Meta+k");
  const palette = page.getByRole("dialog", { name: "Quick Switcher" });
  await palette
    .getByRole("combobox", { name: "Search pages or projects" })
    .fill("Settings");
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Settings", level: 1 }),
  ).toBeVisible();
  await expect(page.getByRole("radio", { name: "English" })).toBeFocused();
});

test("English singular counts render in the workspace and source evidence", async ({
  page,
}) => {
  await page.goto("/?locale=en&theme=light");
  await expect(
    page.getByText(
      "Review 1 project with blockers or pending decisions first.",
    ),
  ).toBeVisible();

  const search = page.getByRole("searchbox", {
    name: "Search projects, branches, and summaries",
  });
  await search.fill("debrief");
  await expect(page.getByText("1 project", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: /Data Sources/ }).click();
  await expect(
    page.getByText("1 project has current live_status evidence"),
  ).toBeVisible();
});

test("healthy rules fallback is status detail, not an alert banner", async ({
  page,
}) => {
  await page.goto("/?locale=en&runtime=fallback&theme=light");
  await expect(
    page.getByRole("heading", { name: "Handoff Overview" }),
  ).toBeVisible();
  await expect(page.locator(".runtime-setup")).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: "Open macOS Privacy & Security",
    }),
  ).toHaveCount(0);

  const dataSources = page.getByRole("button", { name: /Data Sources/ });
  await expect(dataSources).toHaveAttribute(
    "title",
    "Index available · daemon healthy",
  );
  await expect(dataSources).toHaveAttribute(
    "aria-label",
    "Data Sources: Index available · daemon healthy",
  );
  await dataSources.click();
  await expect(
    page.getByText("Incomplete; rules-based summaries remain available"),
  ).toBeVisible();
  await expect(
    page.getByText("~/.debrief/config.json not detected"),
  ).toBeVisible();
});

test("English Settings remains accessible without horizontal overflow at 980x640", async ({
  page,
}) => {
  await page.setViewportSize({ width: 980, height: 640 });
  await page.goto("/?locale=en&theme=dark");
  await page.keyboard.press("Meta+,");
  await expect(
    page.getByRole("heading", { name: "Settings", level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Open macOS Privacy & Security",
    }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await assertAccessible(page);
});

test("Settings locale and theme matrix is screenshot-ready", async ({
  page,
}) => {
  for (const locale of ["zh-Hant", "en"] as const) {
    for (const theme of ["light", "dark"] as const) {
      await page.goto(`/?locale=${locale}&theme=${theme}`);
      await page.keyboard.press("Meta+,");
      await expect(
        page.getByRole("heading", {
          name: locale === "en" ? "Settings" : "設定",
          level: 1,
        }),
      ).toBeVisible();
      await assertAccessible(page);
      await page.screenshot({
        path: path.join(
          screenshotsDirectory,
          `G4-settings-${locale === "en" ? "en" : "zh"}-${theme}.png`,
        ),
        animations: "disabled",
      });
    }
  }
});

async function assertAccessible(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
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
