import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const evidenceDirectory = path.resolve(
  import.meta.dirname,
  "../../../artifacts/qa/harness-compact-handoff",
);

const localizedStatus = {
  "zh-Hant": {
    attention: "Needs attention",
    running: "Running",
  },
  en: {
    attention: "Needs attention",
    running: "Running",
  },
} as const;

for (const locale of ["zh-Hant", "en"] as const) {
  for (const theme of ["light", "dark"] as const) {
    test(`UX-002 compact handoff 944x640 ${locale} ${theme}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 944, height: 640 });
      await page.goto(`/?locale=${locale}&theme=${theme}`);

      const attention = await assertCompactHierarchy(
        page.getByTestId("project-card-2"),
        localizedStatus[locale].attention,
      );
      const running = await assertCompactHierarchy(
        page.getByTestId("project-card-1"),
        localizedStatus[locale].running,
      );
      const overflow = await assertNoHorizontalOverflow(page);
      const axe = await assertFocusedAccessibility(page);

      console.info(
        `UX002 944x640 ${locale} ${theme}: ${JSON.stringify({ attention, running, overflow, axe })}`,
      );

      if (theme === "light") {
        await mkdir(evidenceDirectory, { recursive: true });
        await page.screenshot({
          path: path.join(
            evidenceDirectory,
            `after-944x640-${locale}-light.png`,
          ),
          animations: "disabled",
        });
      }
    });
  }
}

test("UX-002 detail-open hierarchy keeps Inspector usage secondary", async ({
  page,
}) => {
  await page.setViewportSize({ width: 980, height: 800 });
  await page.goto("/?fixture=d013&locale=en&theme=light");

  const selectedRow = page.getByTestId("project-card-1302");
  await selectedRow.getByRole("button", { name: /codex-live/ }).click();

  const detail = page.getByRole("dialog", {
    name: "codex-live session details",
  });
  const inspectorUsage = detail.locator(".inspector-usage");
  await inspectorUsage.scrollIntoViewIfNeeded();
  await expect(inspectorUsage).toBeVisible();
  await expect(inspectorUsage).toContainText("Total");
  await expect(inspectorUsage).toContainText("128K");

  const selected = await assertCompactHierarchy(selectedRow, "Running");
  const anotherRow = await assertCompactHierarchy(
    page.getByTestId("project-card-1301"),
    "Idle",
  );
  const overflow = await assertNoHorizontalOverflow(page, detail);
  const axe = await assertFocusedAccessibility(page, ".handoff-project-list");

  console.info(
    `UX002 980x800 en light detail-open: ${JSON.stringify({ selected, anotherRow, overflow, axe })}`,
  );

  await mkdir(evidenceDirectory, { recursive: true });
  await page.screenshot({
    path: path.join(
      evidenceDirectory,
      "after-980x800-detail-open-en-light.png",
    ),
    animations: "disabled",
  });
});

async function assertCompactHierarchy(row: Locator, expectedStatus: string) {
  await expect(row).toBeVisible();
  const status = row.locator(".handoff-row-status .status-badge");
  const handoff = row.locator(".handoff-row-next");
  const handoffLabel = handoff.locator("small");
  const handoffContent = handoff.locator(":scope > span");

  await expect(status).toBeVisible();
  await expect(status).toHaveText(expectedStatus);
  await expect(handoff).toBeVisible();
  await expect(handoffLabel).toBeVisible();
  await expect(handoffContent).toBeVisible();
  await expect(handoffContent).not.toHaveText("");
  await expect(row.locator(".agent-usage-row")).toBeHidden();
  await expect(row.locator(".handoff-row-activity")).toBeHidden();

  const evidence = await row.evaluate((element) => {
    const statusBadge = element.querySelector<HTMLElement>(".status-badge");
    const next = element.querySelector<HTMLElement>(".handoff-row-next");
    const nextLabel = next?.querySelector<HTMLElement>("small");
    const nextContent = next?.querySelector<HTMLElement>(":scope > span");
    const usage = element.querySelector<HTMLElement>(".agent-usage-row");
    const activity = element.querySelector<HTMLElement>(
      ".handoff-row-activity",
    );
    const action = element.querySelector<HTMLElement>(".handoff-row-action");
    if (
      !statusBadge ||
      !next ||
      !nextLabel ||
      !nextContent ||
      !usage ||
      !activity ||
      !action
    ) {
      throw new Error("Compact handoff evidence is structurally incomplete");
    }

    const statusStyle = getComputedStyle(statusBadge);
    const nextStyle = getComputedStyle(next);
    const contentStyle = getComputedStyle(nextContent);
    const nextRect = next.getBoundingClientRect();
    const actionRect = action.getBoundingClientRect();
    return {
      statusText: statusBadge.textContent?.trim() ?? "",
      statusFontSize: Number.parseFloat(statusStyle.fontSize),
      statusDisplay: statusStyle.display,
      statusVisibility: statusStyle.visibility,
      statusOpacity: Number.parseFloat(statusStyle.opacity),
      statusClipped: statusBadge.scrollWidth > statusBadge.clientWidth,
      handoffDisplay: nextStyle.display,
      handoffVisibility: nextStyle.visibility,
      handoffLabel: nextLabel.textContent?.trim() ?? "",
      handoffContent: nextContent.textContent?.trim() ?? "",
      handoffFontSize: Number.parseFloat(contentStyle.fontSize),
      handoffLineHeight: Number.parseFloat(contentStyle.lineHeight),
      handoffLineClamp: contentStyle.getPropertyValue("-webkit-line-clamp"),
      handoffHeight: nextContent.getBoundingClientRect().height,
      handoffTruncated: nextContent.scrollHeight > nextContent.clientHeight,
      usageDisplay: getComputedStyle(usage).display,
      activityDisplay: getComputedStyle(activity).display,
      actionOverlap: nextRect.right > actionRect.left,
    };
  });

  expect(evidence.statusText).toBe(expectedStatus);
  expect(evidence.statusFontSize).toBeGreaterThanOrEqual(12);
  expect(evidence.statusDisplay).not.toBe("none");
  expect(evidence.statusVisibility).not.toBe("hidden");
  expect(evidence.statusOpacity).toBeGreaterThan(0);
  expect(evidence.statusClipped).toBe(false);
  expect(evidence.handoffDisplay).not.toBe("none");
  expect(evidence.handoffVisibility).not.toBe("hidden");
  expect(evidence.handoffLabel.length).toBeGreaterThan(0);
  expect(evidence.handoffContent.length).toBeGreaterThan(0);
  expect(evidence.handoffFontSize).toBeGreaterThanOrEqual(12);
  expect(evidence.handoffHeight).toBeGreaterThanOrEqual(
    evidence.handoffLineHeight,
  );
  expect(evidence.handoffLineClamp).toBe("1");
  expect(evidence.usageDisplay).toBe("none");
  expect(evidence.activityDisplay).toBe("none");
  expect(evidence.actionOverlap).toBe(false);
  return evidence;
}

async function assertNoHorizontalOverflow(page: Page, detail?: Locator) {
  const measurements = await page.evaluate(() => {
    const targets: Array<{ label: string; element: HTMLElement }> = [];
    const add = (label: string, element: Element | null) => {
      if (element instanceof HTMLElement) targets.push({ label, element });
    };

    add("page", document.documentElement);
    add("workspace", document.querySelector(".handoff-workspace"));
    add("project-list", document.querySelector(".handoff-project-list"));
    document.querySelectorAll(".handoff-project-row").forEach((row, index) => {
      add(`row-${index + 1}`, row);
      add(`row-main-${index + 1}`, row.querySelector(".handoff-row-main"));
    });
    add("inspector", document.querySelector(".handoff-inspector"));

    return targets.map(({ label, element }) => ({
      label,
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      delta: element.scrollWidth - element.clientWidth,
    }));
  });
  const overflow = measurements.filter((measurement) => measurement.delta > 0);
  expect(overflow, JSON.stringify(overflow, null, 2)).toEqual([]);

  if (detail) {
    expect(
      await detail.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
  }

  return {
    checked: measurements.length,
    maxDelta: Math.max(...measurements.map(({ delta }) => delta)),
  };
}

async function assertFocusedAccessibility(page: Page, include?: string) {
  const builder = new AxeBuilder({ page });
  if (include) builder.include(include);
  const results = await builder.analyze();
  const severe = results.violations.filter(
    (violation) =>
      violation.impact === "critical" || violation.impact === "serious",
  );
  expect(
    severe,
    severe
      .map(
        (violation) =>
          `${violation.id}: ${violation.nodes
            .map((node) => JSON.stringify(node.target))
            .join(", ")}`,
      )
      .join("\n"),
  ).toEqual([]);

  const changedRowIncomplete = results.incomplete.filter((result) =>
    result.nodes.some((node) =>
      /handoff-project-row|handoff-row-(?:status|next)|status-(?:attention|running|idle|stale)/.test(
        JSON.stringify(node.target),
      ),
    ),
  );
  expect(
    changedRowIncomplete,
    changedRowIncomplete
      .map(
        (result) =>
          `${result.id}: ${result.nodes
            .map((node) => JSON.stringify(node.target))
            .join(", ")}`,
      )
      .join("\n"),
  ).toEqual([]);

  return {
    criticalSerious: severe.length,
    incompleteTotal: results.incomplete.length,
    changedRowIncomplete: changedRowIncomplete.length,
  };
}
