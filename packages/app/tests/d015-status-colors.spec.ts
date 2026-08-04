import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import path from "node:path";

const screenshotsDirectory = path.resolve(
  import.meta.dirname,
  "../../../artifacts/qa/screenshots",
);

const themes = {
  light: {
    attention: {
      token: "rgb(179 38 30)",
      computed: "rgb(179, 38, 30)",
    },
    running: {
      token: "rgb(19 115 51)",
      computed: "rgb(19, 115, 51)",
    },
  },
  dark: {
    attention: {
      token: "rgb(242 184 181)",
      computed: "rgb(242, 184, 181)",
    },
    running: {
      token: "rgb(129 201 149)",
      computed: "rgb(129, 201, 149)",
    },
  },
} as const;

for (const locale of ["zh-Hant", "en"] as const) {
  for (const theme of ["light", "dark"] as const) {
    test(`D-015 compact summary roles ${locale} ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width: 944, height: 640 });
      await page.goto(`/?locale=${locale}&theme=${theme}`);

      const strip = page.locator(".handoff-summary-strip");
      await expect(strip).toBeVisible();
      await expect(strip.locator(".handoff-summary-stat")).toHaveCount(3);

      for (const tone of ["attention", "running"] as const) {
        const expectedColor = themes[theme][tone];
        const tokenColor = await page.evaluate(
          (token) =>
            getComputedStyle(document.documentElement)
              .getPropertyValue(token)
              .trim(),
          `--color-status-${tone}`,
        );
        expect(tokenColor).toBe(expectedColor.token);

        const summaryValue = strip.locator(
          `.handoff-summary-stat[data-tone="${tone}"] strong`,
        );
        await expect(summaryValue).toHaveCSS("color", expectedColor.computed);
        expect(
          await foregroundContrast(summaryValue, strip),
          `${tone} summary text contrast in ${theme}`,
        ).toBeGreaterThanOrEqual(4.5);

        const statusDot = page.locator(`.status-${tone} .status-dot`).first();
        await expect(statusDot).toBeVisible();
        await expect(statusDot).toHaveCSS(
          "background-color",
          expectedColor.computed,
        );
        const row = page.locator(".handoff-project-list");
        expect(
          await foregroundContrast(statusDot, row, "backgroundColor"),
          `${tone} status dot contrast in ${theme}`,
        ).toBeGreaterThanOrEqual(3);
      }

      await assertAccessible(page);
      await page.screenshot({
        path: path.join(
          screenshotsDirectory,
          `D-015-summary-strip-944x640-${locale}-${theme}.png`,
        ),
        animations: "disabled",
      });
    });
  }
}

async function foregroundContrast(
  foreground: Locator,
  background: Locator,
  foregroundProperty: "color" | "backgroundColor" = "color",
) {
  const foregroundColor = await foreground.evaluate(
    (element, property) => getComputedStyle(element)[property],
    foregroundProperty,
  );
  const backgroundColor = await background.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );
  return contrastRatio(
    parseColor(foregroundColor),
    parseColor(backgroundColor),
  );
}

function parseColor(value: string): [number, number, number] {
  const srgb = value.match(
    /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\)$/u,
  );
  if (srgb) {
    return [
      Number(srgb[1]) * 255,
      Number(srgb[2]) * 255,
      Number(srgb[3]) * 255,
    ];
  }
  const channels = value.match(/\d+(?:\.\d+)?/gu)?.map(Number);
  if (!channels || channels.length < 3) {
    throw new Error(`Expected an opaque sRGB color, received ${value}`);
  }
  return [channels[0]!, channels[1]!, channels[2]!];
}

function contrastRatio(
  foreground: [number, number, number],
  background: [number, number, number],
) {
  const light = Math.max(luminance(foreground), luminance(background));
  const dark = Math.min(luminance(foreground), luminance(background));
  return (light + 0.05) / (dark + 0.05);
}

function luminance(color: [number, number, number]) {
  return (
    linearize(color[0]) * 0.2126 +
    linearize(color[1]) * 0.7152 +
    linearize(color[2]) * 0.0722
  );
}

function linearize(channel: number) {
  const scaled = channel / 255;
  return scaled <= 0.04045
    ? scaled / 12.92
    : ((scaled + 0.055) / 1.055) ** 2.4;
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
