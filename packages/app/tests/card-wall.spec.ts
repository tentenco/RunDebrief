import { expect, test } from "@playwright/test";

test("project workspace renders, sorts, edits, opens detail, and runs all actions", async ({
  page,
}) => {
  const navigationStarted = Date.now();
  await page.goto("/?locale=zh-Hant");
  await expect(page.getByRole("heading", { name: "接手總覽" })).toBeVisible();
  await expect(page.locator(".handoff-project-row")).toHaveCount(5);
  const firstPaintMs = await page.evaluate(() => {
    const paint = performance
      .getEntriesByType("paint")
      .find((entry) => entry.name === "first-contentful-paint");
    return paint?.startTime ?? performance.now();
  });
  expect(firstPaintMs).toBeLessThan(1_000);
  expect(Date.now() - navigationStarted).toBeLessThan(1_000);

  const visibleCards = page.locator(".handoff-project-row");
  await expect(visibleCards.nth(0)).toContainText("api-console");
  await expect(visibleCards.nth(1)).toContainText("debrief");

  const debrief = page.getByTestId("project-card-1");
  await debrief.getByRole("group").locator(":scope > summary").click();
  await debrief
    .getByRole("button", { name: "在 Terminal 開啟" })
    .click();
  await expect(page.getByRole("status")).toContainText("Terminal");
  await debrief.getByRole("group").locator(":scope > summary").click();
  await debrief
    .getByRole("button", { name: "在 Visual Studio Code 開啟" })
    .click();
  await expect(page.getByRole("status")).toHaveText(
    "正在 Visual Studio Code 開啟 debrief",
  );
  await debrief.getByRole("group").locator(":scope > summary").click();
  await debrief
    .getByRole("button", { name: "在 Warp 開啟專案目錄" })
    .click();
  await expect(page.getByRole("status")).toHaveText(
    "正在 Warp 開啟 debrief 專案目錄",
  );
  await debrief.getByRole("group").locator(":scope > summary").click();
  await debrief.getByRole("button", { name: "複製 recap" }).click();
  await expect(page.getByRole("status")).toContainText("recap 已複製");
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toContain("# Recap — debrief");

  await debrief.getByRole("group").locator(":scope > summary").click();
  await debrief.getByRole("button", { name: "標記已處理" }).click();
  await debrief.getByRole("group").locator(":scope > summary").click();
  await expect(
    debrief.getByRole("button", { name: "已處理" }),
  ).toBeDisabled();

  await debrief.getByRole("button", { name: "編輯名稱與 client" }).click();
  await debrief.getByRole("textbox", { name: "名稱", exact: true }).fill(
    "Debrief Desktop",
  );
  await debrief.getByRole("textbox", { name: "Client" }).fill("Example Co");
  await debrief.getByRole("button", { name: "儲存" }).click();
  await expect(page.getByTestId("project-card-1")).toContainText(
    "Debrief Desktop",
  );

  await page
    .getByTestId("project-card-1")
    .getByRole("button", { name: /Debrief Desktop, Running/ })
    .click();
  const detail = page.getByRole("dialog", {
    name: "Debrief Desktop session 詳情",
  });
  await expect(detail).toBeVisible();
  await expect(detail).toContainText("phase-3/app-shell");
  const turnLog = detail.locator("details.turn-log").first();
  await expect(turnLog).not.toHaveAttribute("open");
  await turnLog.locator(":scope > summary").click();
  await expect(turnLog).toHaveAttribute("open");
  await expect(detail).toContainText(
    "請確認目前進度，保留既有資料，並完成下一個可驗證的步驟。",
  );
  const responseDisclosure = turnLog.locator("details.turn-response").first();
  const responseText = responseDisclosure.getByText(
    "已讀取目前狀態並完成安全範圍內的更新；下一步是執行對應 gate。",
    { exact: true },
  );
  await expect(responseDisclosure).not.toHaveAttribute("open");
  await expect(responseText).toBeHidden();
  await responseDisclosure.locator(":scope > summary").click();
  await expect(responseDisclosure).toHaveAttribute("open");
  await expect(responseText).toBeVisible();
  await detail.getByRole("button", { name: "關閉詳情" }).click();

  await page.getByRole("button", { name: /Hidden/ }).click();
  await page
    .getByTestId("project-card-6")
    .getByRole("button", { name: /summary-worker, Idle/ })
    .click();
  await expect(
    page.getByRole("dialog", { name: "summary-worker session 詳情" }),
  ).toContainText("規則式摘要 · Gateway 未設定或暫時不可用");
});

test("pending summaries stay static and runtime setup is actionable", async ({
  page,
}) => {
  await page.goto("/?locale=zh-Hant");
  const awaitingCard = page.getByTestId("project-card-5");
  await expect(awaitingCard).toContainText(
    "等待背景服務完成摘要",
  );
  await expect(awaitingCard.locator(".summary-skeleton")).toHaveCount(0);

  await page.goto("/?locale=zh-Hant&runtime=setup");
  const runtimeSetup = page.getByRole("region", {
    name: "背景服務尚未安裝",
  });
  await expect(runtimeSetup).toBeVisible();
  await expect(runtimeSetup).toContainText("摘要設定：未完整設定");
  await expect(
    runtimeSetup.getByRole("button", {
      name: "開啟 macOS「隱私權與安全性」",
    }),
  ).toHaveCount(0);

  await runtimeSetup
    .getByRole("button", { name: "安裝並啟動背景服務" })
    .click();
  await expect(runtimeSetup).toBeHidden();
});
