import {
  expect,
  test,
  type ElementHandle,
  type Locator,
} from "@playwright/test";

const TWO_POLL_CYCLES_MS = 10_000;

for (const viewport of [
  { width: 1_280, height: 800 },
  { width: 944, height: 640 },
] as const) {
  test(`Inspector focus survives two polls at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    test.setTimeout(40_000);
    await page.setViewportSize(viewport);
    await page.goto("/?locale=en&theme=light");
    await page
      .getByTestId("project-card-1")
      .getByRole("button", { name: /debrief,/ })
      .click();

    const detail = page.getByRole("dialog", {
      name: "debrief session details",
    });
    await expect(detail).toBeVisible();
    await expect(
      detail.getByRole("button", { name: "Close details" }),
    ).toBeFocused();

    const copy = detail.getByRole("button", {
      name: "Copy Handoff Recap",
    });
    await copy.focus();
    await expect(copy).toBeFocused();
    const copyHandle = await requiredElement(copy);
    const indexEvidence = page.locator(".handoff-content-header .eyebrow");
    let previousEvidence = await requiredText(indexEvidence);
    const startedAt = Date.now();

    previousEvidence = await waitForSnapshotAdvance(
      indexEvidence,
      previousEvidence,
      copyHandle,
    );
    previousEvidence = await waitForSnapshotAdvance(
      indexEvidence,
      previousEvidence,
      copyHandle,
    );

    const remaining = TWO_POLL_CYCLES_MS - (Date.now() - startedAt);
    if (remaining > 0) await page.waitForTimeout(remaining);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(TWO_POLL_CYCLES_MS);
    await expect(copy).toBeFocused();
    expect(await isActiveAndConnected(copyHandle)).toBe(true);

    if (viewport.width === 1_280) {
      const disclosure = detail
        .locator(".inspector-accordions details")
        .first()
        .locator(":scope > summary");
      await disclosure.focus();
      const disclosureHandle = await requiredElement(disclosure);
      await waitForSnapshotAdvance(
        indexEvidence,
        previousEvidence,
        disclosureHandle,
      );
      await expect(disclosure).toBeFocused();
    }
  });
}

async function waitForSnapshotAdvance(
  evidence: Locator,
  previous: string,
  focused: ElementHandle<HTMLElement>,
): Promise<string> {
  await expect
    .poll(() => requiredText(evidence), {
      timeout: 7_000,
      message: "the visible index timestamp should advance on the 5s poll",
    })
    .not.toBe(previous);
  expect(await isActiveAndConnected(focused)).toBe(true);
  return requiredText(evidence);
}

async function requiredText(locator: Locator): Promise<string> {
  const text = await locator.textContent();
  expect(text).not.toBeNull();
  return text!;
}

async function requiredElement(
  locator: Locator,
): Promise<ElementHandle<HTMLElement>> {
  const element = await locator.elementHandle();
  expect(element).not.toBeNull();
  return element as ElementHandle<HTMLElement>;
}

async function isActiveAndConnected(
  element: ElementHandle<HTMLElement>,
): Promise<boolean> {
  return element.evaluate(
    (control) => control.isConnected && document.activeElement === control,
  );
}
