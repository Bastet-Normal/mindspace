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
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "manifest.webmanifest?v=20260606-release");
    await expect(page.locator('link[rel="shortcut icon"]')).toHaveAttribute("href", "favicon.ico?v=20260606-release");
    await expect(page.locator('link[rel="icon"][sizes="512x512"]')).toHaveAttribute("href", "assets/icon-512.png?v=20260606-release");

    const manifest = await page.evaluate(async () => {
      const manifestHref = document.querySelector('link[rel="manifest"]').getAttribute("href");
      const response = await fetch(manifestHref);
      return response.json();
    });
    expect(manifest.icons.map((icon) => icon.src)).toEqual(expect.arrayContaining([
      "assets/icon-192.png?v=20260606-release",
      "assets/icon-512.png?v=20260606-release",
      "assets/icon-1024.png?v=20260606-release",
      "assets/icon.svg?v=20260606-release"
    ]));

    await expect(page.locator("#auth-modal")).toBeVisible();
    await expect(page.locator("#auth-modal")).toHaveAttribute("data-force-auth", "true");
    await expect(page.locator("#auth-modal .modal-close-btn")).toHaveClass(/hidden/);
    await expect(page.locator("#login-form")).toHaveJSProperty("noValidate", true);
    await page.locator("#login-form .auth-submit-btn").click();
    await expect(page.locator("#login-email-error")).toHaveText("请输入邮箱地址。");
    await expect(page.locator("#login-email")).toHaveAttribute("aria-invalid", "true");

    await page.evaluate(() => {
      document.querySelector("#auth-modal").dataset.forceAuth = "false";
      document.querySelector("#auth-modal").classList.add("hidden");
      document.body.classList.remove("auth-gate-active");
      app.authGateActive = false;
    });
    await expect(page.locator("#auth-modal")).toHaveClass(/hidden/);

    await page.locator(navigationSelector(page, "weather")).click();
    await expect(page.locator("#view-weather")).toHaveClass(/active/);
    await page.locator("#mood-note").fill(`兼容性测试记录 - ${testInfo.project.name}`);
    await page.locator("#save-log-btn").click();
    await expect(page.locator("#modal-container")).toBeVisible();
    await expect(page.locator("#modal-title")).toContainText("已记入心空");
    await page.getByRole("button", { name: "查看随笔" }).click();
    await expect(page.locator("#modal-container")).toHaveClass(/hidden/);
    await expect(page.locator("#view-journal")).toHaveClass(/active/);
    await expect(page.getByText("兼容性测试记录")).toBeVisible();

    await page.locator(navigationSelector(page, "insights")).click();
    await expect(page.locator("#view-insights")).toHaveClass(/active/);
    await expect(page.locator("#weather-calendar-grid")).toBeVisible();

    const weatherDay = page.locator("#weather-calendar-grid .calendar-day.has-note").last();
    await expect(weatherDay).toBeVisible();
    const dotGeometry = await weatherDay.evaluate((day) => {
      const dot = day.querySelector(".calendar-day-note-dot");
      const dayRect = day.getBoundingClientRect();
      const dotRect = dot?.getBoundingClientRect();

      return {
        hasDot: Boolean(dot),
        width: dotRect?.width || 0,
        height: dotRect?.height || 0,
        leftInside: dotRect ? dotRect.left >= dayRect.left + 1 : false,
        rightInside: dotRect ? dotRect.right <= dayRect.right - 1 : false,
        bottomInside: dotRect ? dotRect.bottom <= dayRect.bottom - 1 : false,
        isLowerHalf: dotRect ? dotRect.top > dayRect.top + dayRect.height / 2 : false,
        centerOffset: dotRect ? Math.abs((dotRect.left + dotRect.right - dayRect.left - dayRect.right) / 2) : 999
      };
    });

    expect(dotGeometry.hasDot).toBe(true);
    expect(dotGeometry.width).toBeLessThanOrEqual(5);
    expect(dotGeometry.height).toBeLessThanOrEqual(5);
    expect(dotGeometry.leftInside).toBe(true);
    expect(dotGeometry.rightInside).toBe(true);
    expect(dotGeometry.bottomInside).toBe(true);
    expect(dotGeometry.isLowerHalf).toBe(true);
    expect(dotGeometry.centerOffset).toBeLessThanOrEqual(1);

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
