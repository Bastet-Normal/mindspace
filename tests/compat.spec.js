const { test, expect } = require("@playwright/test");
const { version: APP_VERSION } = require("../package.json");

function navigationSelector(page, view) {
  const width = page.viewportSize()?.width || 1440;
  const container = width < 768 ? "#bottom-nav" : "#desktop-sidebar";
  return `${container} [data-view="${view}"]`;
}

test.describe("MindSpace web compatibility", () => {
  test("loads, navigates, records a mood, and exposes install metadata", async ({ page }, testInfo) => {
    const errors = [];

    await page.route("https://api.github.com/repos/wangjiehu/mindspace/releases/latest", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          tag_name: "v1.2.0",
          html_url: "https://github.com/wangjiehu/mindspace/releases/tag/v1.2.0",
          body: "<b>兼容性测试更新</b>",
          assets: [
            {
              name: "MindSpace-1.2.0-Windows-Portable-x64.exe",
              size: 1048576,
              browser_download_url: "https://github.com/wangjiehu/mindspace/releases/download/v1.2.0/MindSpace-1.2.0-Windows-Portable-x64.exe"
            }
          ]
        })
      });
    });

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
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", `manifest.webmanifest?v=${APP_VERSION}`);
    await expect(page.locator('link[rel="shortcut icon"]')).toHaveAttribute("href", `favicon.ico?v=${APP_VERSION}`);
    await expect(page.locator('link[rel="icon"][sizes="512x512"]')).toHaveAttribute("href", `assets/icon-512.png?v=${APP_VERSION}`);

    const manifest = await page.evaluate(async () => {
      const manifestHref = document.querySelector('link[rel="manifest"]').getAttribute("href");
      const response = await fetch(manifestHref);
      return response.json();
    });
    expect(manifest.icons.map((icon) => icon.src)).toEqual(expect.arrayContaining([
      `assets/icon-192.png?v=${APP_VERSION}`,
      `assets/icon-512.png?v=${APP_VERSION}`,
      `assets/icon-1024.png?v=${APP_VERSION}`
    ]));
    expect(manifest.icons).toHaveLength(3);

    const styleHealth = await page.evaluate(async () => {
      const cssHref = document.querySelector('link[href^="css/style.css"]').getAttribute("href");
      const cssText = await fetch(cssHref).then((response) => response.text());
      return {
        bodyFont: getComputedStyle(document.body).fontFamily,
        hasWebkitAutofillGuard: cssText.includes(":-webkit-autofill") && cssText.includes("rgba(120, 120, 128, 0.16)"),
        hasMozAutofillGuard: cssText.includes(":-moz-autofill"),
        hasJournalBodyLayout: cssText.includes(".journal-card-body"),
        hasJournalClamp: cssText.includes("-webkit-line-clamp")
      };
    });
    expect(styleHealth.bodyFont).toContain("Noto Sans SC");
    expect(styleHealth.hasWebkitAutofillGuard).toBe(true);
    expect(styleHealth.hasMozAutofillGuard).toBe(true);
    expect(styleHealth.hasJournalBodyLayout).toBe(true);
    expect(styleHealth.hasJournalClamp).toBe(true);

    await page.evaluate(() => {
      const modal = document.querySelector("#auth-modal");
      if (modal?.classList.contains("hidden") && window.SupabaseService) {
        const originalIsConfigured = window.SupabaseService.isConfigured;
        window.SupabaseService.isConfigured = () => true;
        app.openAuthModal({ force: true });
        window.SupabaseService.isConfigured = originalIsConfigured;
      }
    });
    await expect(page.locator("#auth-modal")).toBeVisible();
    await expect(page.locator("#auth-modal")).toHaveAttribute("data-force-auth", "true");
    await expect(page.locator("#auth-modal .modal-close-btn")).toHaveClass(/hidden/);
    await expect(page.locator("#login-form")).toHaveJSProperty("noValidate", true);
    await page.locator("#login-email").fill("saved-account@example.com");
    const filledEmailBackground = await page.locator("#login-email").evaluate((input) => getComputedStyle(input).backgroundColor);
    expect(filledEmailBackground).not.toBe("rgb(255, 255, 255)");
    await page.locator("#login-email").fill("");
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

    await page.evaluate(async () => {
      const longNote = `长随笔压测 ${"这是一段用于验证手机和桌面布局的长内容，应该被限制在文字区域内，不能压住删除按钮。".repeat(12)}`;
      const logs = MindSpaceStorage.getLogs();
      logs.push({
        id: `compat-long-note-${Date.now()}`,
        timestamp: Date.now() + 1000,
        weather: "sunny",
        tags: ["长随笔"],
        note: longNote
      });
      localStorage.setItem(MindSpaceStorage.KEYS.LOGS, JSON.stringify(logs));
      await app.renderJournalList();
    });
    const longJournalCard = page.locator(".journal-card").filter({ hasText: "长随笔压测" }).first();
    await expect(longJournalCard).toBeVisible();
    const journalLayout = await longJournalCard.evaluate((card) => {
      const note = card.querySelector(".journal-note-preview");
      const button = card.querySelector(".journal-delete-btn");
      const noteRect = note.getBoundingClientRect();
      const buttonRect = button.getBoundingClientRect();
      const overlaps = !(noteRect.right <= buttonRect.left || noteRect.left >= buttonRect.right || noteRect.bottom <= buttonRect.top || noteRect.top >= buttonRect.bottom);
      const noteStyle = getComputedStyle(note);

      return {
        overlaps,
        noteRight: noteRect.right,
        buttonLeft: buttonRect.left,
        overflowWrap: noteStyle.overflowWrap,
        buttonWidth: buttonRect.width
      };
    });
    expect(journalLayout.overlaps).toBe(false);
    expect(journalLayout.noteRight).toBeLessThanOrEqual(journalLayout.buttonLeft);
    expect(journalLayout.overflowWrap).toBe("anywhere");
    expect(journalLayout.buttonWidth).toBeGreaterThanOrEqual(32);

    await page.locator(navigationSelector(page, "insights")).click();
    await expect(page.locator("#view-insights")).toHaveClass(/active/);
    await expect(page.locator("#weather-calendar-grid")).toBeVisible();
    await expect(page.locator("#climate-gauge-value")).toHaveText("100");
    await expect(page.locator("#climate-gauge-status")).toHaveText("澄澈");
    await expect(page.getByText("(点击圆点或悬浮查看随笔)")).toHaveCount(0);

    const weightedClimateIndex = await page.evaluate(() => {
      const day = 24 * 60 * 60 * 1000;
      const now = Date.now();
      return {
        recentWeighted: app.calculateClimateIndex([
          { timestamp: now - day, weather: "stormy" },
          { timestamp: now - 6 * day, weather: "sunny" }
        ], now),
        stale: app.calculateClimateIndex([
          { timestamp: now - 4 * day, weather: "sunny" },
          { timestamp: now - 6 * day, weather: "sunny" }
        ], now),
        outsideWeek: app.calculateClimateIndex([
          { timestamp: now - 8 * day, weather: "sunny" }
        ], now)
      };
    });
    expect(weightedClimateIndex.recentWeighted).toMatchObject({
      score: 35,
      reason: "ok",
      usedCount: 2
    });
    expect(weightedClimateIndex.stale).toMatchObject({
      score: null,
      reason: "stale",
      usedCount: 2
    });
    expect(weightedClimateIndex.outsideWeek).toMatchObject({
      score: null,
      reason: "empty",
      usedCount: 0
    });

    const weatherDay = page.locator("#weather-calendar-grid .calendar-day.has-note").last();
    await expect(weatherDay).toBeVisible();
    await expect(page.locator("#weather-calendar-grid .calendar-day-note-dot")).toHaveCount(0);

    await page.locator(navigationSelector(page, "breathing")).click();
    await expect(page.locator("#view-breathing")).toHaveClass(/active/);
    await expect(page.locator("#start-breath-btn")).toBeVisible();
    const breathingSpacing = await page.evaluate(() => {
      const layout = document.querySelector(".breathing-split-layout");
      const controls = document.querySelector(".breathing-panel-controls");
      const visual = document.querySelector(".breathing-panel-visual");
      const layoutStyle = layout ? getComputedStyle(layout) : null;
      const controlsRect = controls?.getBoundingClientRect();
      const visualRect = visual?.getBoundingClientRect();

      return {
        viewportWidth: window.innerWidth,
        display: layoutStyle?.display || "",
        cssGap: parseFloat(layoutStyle?.rowGap || layoutStyle?.gap || "0"),
        verticalGap: controlsRect && visualRect ? visualRect.top - controlsRect.bottom : 0
      };
    });
    if (breathingSpacing.viewportWidth < 768) {
      expect(breathingSpacing.display).toBe("flex");
      expect(Math.max(breathingSpacing.cssGap, breathingSpacing.verticalGap)).toBeGreaterThanOrEqual(20);
    }

    await page.locator(navigationSelector(page, "focus")).click();
    await expect(page.locator("#view-focus")).toHaveClass(/active/);
    await expect(page.getByText("25:00")).toBeVisible();
    await page.locator("#btn-timer-toggle").click();
    await expect(page.locator("#timer-toggle-text")).toHaveText("暂停");
    const alarmImplementation = await page.evaluate(() => ({
      hasGeneratedAlarm: typeof MindSpaceFocusTimer.playAlarm === "function",
      hasRemoteAudioElement: Boolean(MindSpaceFocusTimer.alarmAudio),
      hasLocalAudioContext: Boolean(MindSpaceFocusTimer.alarmAudioContext),
      supportsAudioContext: Boolean(window.AudioContext || window.webkitAudioContext)
    }));
    expect(alarmImplementation.hasGeneratedAlarm).toBe(true);
    expect(alarmImplementation.hasRemoteAudioElement).toBe(false);
    expect(alarmImplementation.hasLocalAudioContext).toBe(alarmImplementation.supportsAudioContext);
    await page.locator("#btn-timer-toggle").click();
    await expect(page.locator("#timer-toggle-text")).toHaveText("继续专注");

    await page.locator(navigationSelector(page, "settings")).click();
    await expect(page.locator("#view-settings")).toHaveClass(/active/);
    await expect(page.getByText("导出并下载我的心声随笔")).toBeVisible();
    await expect(page.locator("#current-app-version")).toHaveText(`v${APP_VERSION}`);
    await page.locator("#btn-check-update").click();
    await expect(page.locator("#modal-title")).toHaveText("发现新版本 🎉");
    await expect(page.locator("#modal-body")).toContainText("<b>兼容性测试更新</b>");
    await expect(page.locator("#modal-body a")).toHaveText(/MindSpace-1\.2\.0-Windows-Portable-x64\.exe/);
    await page.getByRole("button", { name: "稍后更新" }).click();
    await expect(page.locator("#modal-container")).toHaveClass(/hidden/);

    const serviceWorkerSupported = await page.evaluate(() => "serviceWorker" in navigator);
    expect(serviceWorkerSupported).toBe(true);

    expect(errors).toEqual([]);
  });
});
