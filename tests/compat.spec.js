const { test, expect } = require("@playwright/test");

function navigationSelector(page, view) {
  const width = page.viewportSize()?.width || 1440;
  const container = width < 768 ? "#bottom-nav" : "#desktop-sidebar";
  return `${container} [data-view="${view}"]`;
}

test.describe("MindSpace web compatibility", () => {
  test("loads, navigates, records a mood, and exposes install metadata", async ({ page }, testInfo) => {
    const errors = [];

    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error" && !message.text().includes("Failed to load resource")) {
        errors.push(message.text());
      }
    });
    page.on("response", (response) => {
      if (response.status() >= 400) {
        const url = response.url();
        const ignored = url.endsWith("/favicon.ico");
        if (!ignored) {
          errors.push(`${response.status()} ${url}`);
        }
      }
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });

    await expect(page.locator("#app-container")).toBeVisible();
    await expect(page.locator("#greeting-text")).toBeVisible();
    await expect(page.locator("#quote-content")).toBeVisible();
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "manifest.webmanifest");

    await page.locator(navigationSelector(page, "weather")).click();
    await expect(page.locator("#view-weather")).toHaveClass(/active/);
    await page.locator("#mood-note").fill(`兼容性测试记录 - ${testInfo.project.name}`);
    await page.locator("#save-log-btn").click();
    await expect(page.locator("#modal-container")).toBeVisible();
    await expect(page.locator("#modal-title")).toContainText("已记入心空");
    await page.locator("#modal-close").click({ force: true });
    await expect(page.locator("#modal-container")).toHaveClass(/hidden/);

    await page.locator(navigationSelector(page, "journal")).click();
    await expect(page.locator("#view-journal")).toHaveClass(/active/);
    await expect(page.locator("#journal-list")).toContainText("兼容性测试记录");

    await page.locator(navigationSelector(page, "breathing")).click();
    await expect(page.locator("#view-breathing")).toHaveClass(/active/);
    await expect(page.locator("#start-breath-btn")).toBeVisible();

    await page.locator(navigationSelector(page, "focus")).click();
    await expect(page.locator("#view-focus")).toHaveClass(/active/);
    await expect(page.getByText("25:00")).toBeVisible();

    await page.locator(navigationSelector(page, "settings")).click();
    await expect(page.locator("#view-settings")).toHaveClass(/active/);
    await expect(page.getByText("导出并下载我的心声随笔")).toBeVisible();

    const serviceWorkerSupported = await page.evaluate(() => "serviceWorker" in navigator);
    expect(serviceWorkerSupported).toBe(true);

    expect(errors).toEqual([]);
  });
});
