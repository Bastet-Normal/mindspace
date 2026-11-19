const { test } = require("node:test");
const { expect } = require("expect");
const { setTimeout: delay } = require("node:timers/promises");
const { openSafari } = require("./safari-page.cjs");
const { version: APP_VERSION } = require("../package.json");
const release = {tag_name: "v1.2.0",
          html_url: "https://github.com/Bastet-Normal/mindspace/releases/tag/v1.2.0",
          body: "<b>兼容性测试更新</b>",
          assets: [
            {
              name: "MindSpace-1.2.0-Windows-Portable-x64.exe",
              size: 1048576,
              browser_download_url: "https://github.com/Bastet-Normal/mindspace/releases/download/v1.2.0/MindSpace-1.2.0-Windows-Portable-x64.exe"
            }
          ]
};

async function verify(read, expected, contains = false) {
  const deadline = Date.now() + 12000;
  while (true) {
    try {
      const actual = await read();
      if (contains) expect(actual).toContain(expected);
      else if (expected instanceof RegExp) expect(actual).toMatch(expected);
      else expect(actual).toEqual(expected);
      return;
    } catch (err) { if (Date.now() >= deadline) throw err; await delay(100); }
  }
}
function navigationSelector(page, view) {
  const width = page.viewportSize()?.width || 1440;
  const container = width < 768 ? "#bottom-nav" : "#desktop-sidebar";
  return `${container} [data-view="${view}"]`;
}

for (const [width,height] of [[1440,900],[1366,768],[412,915],[360,740],[390,844]]) {
  test(`Safari compatibility at ${width} × ${height}`, async t => {
    const page = await openSafari(width, height, release);
    t.after(() => page.close());
    await verify(() => page.locator("#app-container").visible(), true);
    await verify(() => page.locator("#greeting-text").visible(), true);
    await verify(() => page.locator("#quote-content").visible(), true);
    if ((page.viewportSize()?.width || 1440) < 768) {
      await verify(() => page.locator("#mobile-auth-btn .icon-fallback").text(), "账户");
      await verify(() => page.locator("#mobile-auth-btn .icon-fallback").visible(), true);
      await verify(() => page.locator("#theme-toggle .icon-fallback").text(), "主题");
      await verify(() => page.locator("#theme-toggle .icon-fallback").visible(), true);
    }
    await verify(() => page.locator('link[rel="manifest"]').attribute("href"), `manifest.webmanifest?v=${APP_VERSION}`);
    await verify(() => page.locator('link[rel="shortcut icon"]').attribute("href"), `favicon.ico?v=${APP_VERSION}`);
    await verify(() => page.locator('link[rel="icon"][sizes="512x512"]').attribute("href"), `assets/icon-512.png?v=${APP_VERSION}`);

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

    const cloudConfigState = await page.evaluate(() => ({
      defaultUrl: window.SUPABASE_CONFIG?.url,
      defaultAnonKey: window.SUPABASE_CONFIG?.anonKey,
      isConfigured: window.SupabaseService?.isConfigured()
    }));
    expect(cloudConfigState).toEqual({
      defaultUrl: "",
      defaultAnonKey: "",
      isConfigured: false
    });
    await page.locator(navigationSelector(page, "settings")).click();
    await verify(() => page.locator("#view-settings").attribute("class"), /active/);
    await verify(() => page.byText("当前数据保存在本地浏览器中。您可以配置云服务，开启多设备同步。").visible(), true);

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
    await verify(() => page.locator("#auth-modal").visible(), true);
    await verify(() => page.locator("#auth-modal").attribute("data-force-auth"), "true");
    await verify(() => page.locator("#auth-modal .modal-close-btn").attribute("class"), /hidden/);
    await verify(() => page.locator("#login-form").property("noValidate"), true);
    await page.locator("#login-email").fill("saved-account@example.com");
    const filledEmailBackground = await page.locator("#login-email").evaluate((input) => getComputedStyle(input).backgroundColor);
    expect(filledEmailBackground).not.toBe("rgb(255, 255, 255)");
    await page.locator("#login-email").fill("");
    await page.locator("#login-form .auth-submit-btn").click();
    await verify(() => page.locator("#login-email-error").text(), "请输入邮箱地址。");
    await verify(() => page.locator("#login-email").attribute("aria-invalid"), "true");

    await page.evaluate(() => {
      document.querySelector("#auth-modal").dataset.forceAuth = "false";
      document.querySelector("#auth-modal").classList.add("hidden");
      document.body.classList.remove("auth-gate-active");
      app.authGateActive = false;
    });
    await verify(() => page.locator("#auth-modal").attribute("class"), /hidden/);

    await page.locator(navigationSelector(page, "weather")).click();
    await verify(() => page.locator("#view-weather").attribute("class"), /active/);
    await page.locator("#mood-note").fill(`兼容性测试记录 - ${width + "px"}`);
    await page.locator("#save-log-btn").click();
    await verify(() => page.locator("#modal-container").visible(), true);
    await verify(() => page.locator("#modal-title").text(), "已记入心空", true);
    await page.byText("查看随笔", "button").click();
    await verify(() => page.locator("#modal-container").attribute("class"), /hidden/);
    await verify(() => page.locator("#view-journal").attribute("class"), /active/);
    await verify(() => page.byText("兼容性测试记录").visible(), true);

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
    const longJournalCard = page.xpath("//*[contains(concat(' ',normalize-space(@class),' '),' journal-card ') and contains(.,'长随笔压测')]");
    await verify(() => longJournalCard.visible(), true);
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
    await verify(() => page.locator("#view-insights").attribute("class"), /active/);
    await verify(() => page.locator("#weather-calendar-grid").visible(), true);
    await verify(() => page.locator("#climate-gauge-value").text(), "100");
    await verify(() => page.locator("#climate-gauge-status").text(), "澄澈");
    await verify(() => page.byText("(点击圆点或悬浮查看随笔)").count(), 0);

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
    await verify(() => weatherDay.visible(), true);
    await verify(() => page.locator("#weather-calendar-grid .calendar-day-note-dot").count(), 0);

    await page.locator(navigationSelector(page, "breathing")).click();
    await verify(() => page.locator("#view-breathing").attribute("class"), /active/);
    await verify(() => page.locator("#start-breath-btn").visible(), true);
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
    await verify(() => page.locator("#view-focus").attribute("class"), /active/);
    await verify(() => page.byText("25:00").visible(), true);
    await page.locator("#btn-timer-toggle").click();
    await verify(() => page.locator("#timer-toggle-text").text(), "暂停");
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
    await verify(() => page.locator("#timer-toggle-text").text(), "继续专注");

    await page.locator(navigationSelector(page, "settings")).click();
    await verify(() => page.locator("#view-settings").attribute("class"), /active/);
    await verify(() => page.byText("导出并下载我的心声随笔").visible(), true);
    await verify(() => page.locator("#current-app-version").text(), `v${APP_VERSION}`);
    await page.locator("#btn-check-update").click();
    await verify(() => page.locator("#modal-title").text(), "发现新版本 🎉");
    await verify(() => page.locator("#modal-body").text(), "<b>兼容性测试更新</b>", true);
    await verify(() => page.locator("#modal-body a").text(), /MindSpace-1\.2\.0-Windows-Portable-x64\.exe/);
    await page.byText("稍后更新", "button").click();
    await verify(() => page.locator("#modal-container").attribute("class"), /hidden/);

    const serviceWorkerSupported = await page.evaluate(() => "serviceWorker" in navigator);
    expect(serviceWorkerSupported).toBe(true);

    expect(await page.errors()).toEqual([]);
  });
}
