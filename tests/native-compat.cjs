const { test } = require("node:test");
const { expect } = require("expect");
const { setTimeout: delay } = require("node:timers/promises");
const { openSafari } = require("./safari-page.cjs");
const { version } = require("../package.json");

const release = {
    tag_name: "v9.0.0",
    html_url: "https://github.com/Bastet-Normal/mindspace/releases/tag/v9.0.0",
    body: "<b>兼容性测试更新</b>",
    assets: [{
        name: "MindSpace-9.0.0-Windows-Portable-x64.exe",
        size: 1048576,
        browser_download_url: "https://github.com/Bastet-Normal/mindspace/releases/download/v9.0.0/MindSpace-9.0.0-Windows-Portable-x64.exe"
    }]
};

async function waitFor(read, expected) {
    const deadline = Date.now() + 12000;
    while (true) {
        try {
            const value = await read();
            if (expected instanceof RegExp) expect(value).toMatch(expected);
            else expect(value).toEqual(expected);
            return;
        } catch (error) {
            if (Date.now() >= deadline) throw error;
            await delay(100);
        }
    }
}

for (const [width, height] of [[1440, 900], [1024, 768], [768, 900], [390, 844], [320, 720]]) {
    test(`MindSpace native Safari at ${width} × ${height}`, async t => {
        const page = await openSafari(width, height, release);
        t.after(() => page.close());
        const nav = width < 1024 ? "#bottom-nav" : "#desktop-sidebar";
        const show = route => waitFor(() => page.locator(`#view-${route}`).visible(), true);
        const navigate = route => page.locator(`${nav} [data-view="${route}"]`).click();

        await show("dashboard");
        expect(await page.viewportSize()).toEqual({ width, height });
        expect(await page.locator("#greeting-text").text()).toMatch(/旅人$/);
        expect(await page.locator(".quick-weather").count()).toBe(6);
        expect(await page.locator(".practice-icon ion-icon svg").count()).toBe(2);
        expect(await page.locator('link[rel="manifest"]').attribute("href")).toBe(`manifest.webmanifest?v=${version}`);

        const baseline = await page.evaluate(() => ({
            defaultUrl: window.SUPABASE_CONFIG.url,
            defaultKey: window.SUPABASE_CONFIG.anonKey,
            cloudConfigured: window.SupabaseService.isConfigured(),
            canCache: "serviceWorker" in navigator,
            wide: document.documentElement.scrollWidth > innerWidth
        }));
        expect(baseline).toEqual({ defaultUrl: "", defaultKey: "", cloudConfigured: false, canCache: true, wide: false });

        await page.locator("#widget-today-weather [data-go=weather]").click();
        await show("weather");
        expect(await page.locator("#entry-setup").visible()).toBe(true);
        expect(await page.locator("#mood-note").visible()).toBe(false);
        const offset = await page.evaluate(() => {
            const card = document.querySelector(".weather-split-layout").getBoundingClientRect();
            const main = document.querySelector("#app-content").getBoundingClientRect();
            const navigation = document.querySelector("#bottom-nav").getBoundingClientRect();
            const bottom = navigation.height ? navigation.top : innerHeight;
            return [
                Math.abs(card.left + card.width / 2 - (main.left + main.width / 2)),
                Math.abs(card.top + card.height / 2 - (main.top + bottom) / 2)
            ];
        });
        expect(Math.max(...offset)).toBeLessThan(2);
        expect(await page.locator("#view-weather .lake-window").count()).toBe(0);
        expect(await page.locator('[data-entry-mode="now"]').attribute("aria-pressed")).toBe("true");
        expect(await page.locator("#entry-past-time").visible()).toBe(false);
        const timeLayout = await page.evaluate(() => {
            const now = document.querySelector('[data-entry-mode="now"]');
            const past = document.querySelector('[data-entry-mode="past"]');
            const anchors = [".weather-split-layout", ".entry-mood-picker", "#entry-confirm"];
            const positions = () => anchors.map(selector => document.querySelector(selector).getBoundingClientRect().top + scrollY);
            const before = positions();
            past.click();
            const after = positions();
            const heights = ["#entry-date", "#entry-time"].map(selector => document.querySelector(selector).getBoundingClientRect().height);
            const selected = getComputedStyle(past);
            const shadow = selected.boxShadow !== "none" && selected.borderBottomWidth === "0px";
            now.click();
            return {
                shifted: after.some((top, index) => Math.abs(top - before[index]) > 1),
                compact: heights.every(height => height > 30 && height < 40),
                shadow
            };
        });
        expect(timeLayout).toEqual({ shifted: false, compact: true, shadow: true });
        expect(await page.locator('input[name="selected-weather"]:checked').count()).toBe(0);
        const weatherMotion = await page.evaluate(() => ({
            reduced: matchMedia("(prefers-reduced-motion: reduce)").matches,
            names: [".sun-core", ".leaf-icon", ".cloud-front", ".fog-cloud", ".rainy-anim .wx-drop", ".wx-lightning"]
                .map(selector => getComputedStyle(document.querySelector(`#view-weather ${selector}`)).animationName)
        }));
        expect(weatherMotion.names.every(name => weatherMotion.reduced ? name === "none" : name.startsWith("mindspace-"))).toBe(true);
        await page.locator("#entry-confirm").click();
        await waitFor(() => page.locator("#entry-setup-status").text(), "先选一种或两种心情。");
        await page.locator('[data-weather="rainy"] .weather-box').click();
        await page.locator('[data-weather="breezy"] .weather-box').click();
        await page.locator('[data-weather="foggy"] .weather-box').click();
        expect(await page.locator('input[name="selected-weather"]:checked').count()).toBe(2);
        await page.locator("#entry-confirm").click();
        expect(await page.locator("#entry-setup").visible()).toBe(false);
        expect(await page.locator(".entry-first-line-meta").text()).not.toMatch(/此刻心情|那时心情/);
        expect(await page.locator(".entry-summary-mood").count()).toBe(2);
        const entryTime = await page.locator("#entry-summary-time").attribute("datetime");
        const paperGaps = await page.evaluate(() => {
            const paper = document.querySelector(".weather-split-layout").getBoundingClientRect();
            const content = document.querySelector("#app-content").getBoundingClientRect();
            const nav = document.querySelector("#bottom-nav").getBoundingClientRect();
            return [paper.left - content.left, content.right - paper.right, paper.top - content.top,
                (nav.height ? nav.top : innerHeight) - paper.bottom];
        });
        expect(Math.min(...paperGaps)).toBeGreaterThan(7);
        expect(Math.abs(paperGaps[0] - paperGaps[1])).toBeLessThan(2);
        const editorFocus = await page.evaluate(() => {
            const note = document.getElementById("mood-note");
            const sheet = note.closest(".weather-split-layout");
            const firstLine = document.querySelector(".entry-first-line");
            document.getElementById("entry-change").focus({ preventScroll: true });
            const headerBorder = getComputedStyle(firstLine).borderBottomColor;
            note.focus();
            const writingFocus = document.activeElement === note && getComputedStyle(note).borderTopWidth === "0px"
                && getComputedStyle(note).resize === "none" && getComputedStyle(sheet).borderTopWidth === "1px"
                && getComputedStyle(firstLine).borderBottomColor !== headerBorder;
            const tagDetails = document.getElementById("tag-details");
            const anchor = tagDetails.querySelector("summary");
            const save = document.getElementById("save-log-btn");
            const baseline = [anchor, note, save].map(element => element.getBoundingClientRect().top);
            tagDetails.open = true;
            const stationary = [anchor, note, save].every((element, index) =>
                Math.abs(element.getBoundingClientRect().top - baseline[index]) < 1);
            const panel = tagDetails.querySelector(".entry-tag-panel").getBoundingClientRect();
            return [writingFocus, stationary && panel.bottom < baseline[0]];
        });
        expect(editorFocus).toEqual([true, true]);
        const tag = page.locator("#custom-tag-input");
        const idleBorder = await tag.evaluate(element => getComputedStyle(element).borderTopColor);
        await tag.click();
        await waitFor(() => tag.evaluate(element => ({
            focused: document.activeElement === element,
            offset: getComputedStyle(element).outlineOffset
        })), { focused: true, offset: "-1px" });
        expect(await tag.evaluate(element => getComputedStyle(element).borderTopColor)).not.toBe(idleBorder);
        await page.locator("#tag-details summary").click();
        await page.locator("#mood-note").fill("兼容性测试记录");
        await page.evaluate(() => app.journalEditor.view.setSelection(3, 2));
        await page.locator("#font-details summary").click();
        await page.locator('[data-font-choice="song"]').click();
        expect(await page.locator("#font-summary").text()).toBe("宋体");
        expect(await page.locator("#mood-note .ql-font-song").text()).toBe("测试");
        await page.locator("#entry-change").click();
        expect(await page.locator("#entry-setup").visible()).toBe(true);
        await page.locator("#entry-confirm").click();
        expect(await page.locator("#mood-note").text()).toBe("兼容性测试记录");
        expect(await page.locator("#entry-summary-time").attribute("datetime")).toBe(entryTime);
        await navigate("journal");
        await navigate("weather");
        expect(await page.locator("#mood-note").text()).toBe("兼容性测试记录");
        await page.locator("#save-log-btn").click();
        await show("dashboard");
        expect(await page.locator(".welcome-card .lake-window").attribute("data-sky")).toBe("");
        expect(await page.locator("#widget-today-weather h2").text()).toBe("今日天气");
        expect(await page.locator(".today-weather-bar [data-weather=rainy]").attribute("style")).toBe("flex-grow:0.5");
        expect(await page.locator(".week-day.is-today .week-date").text()).toBe(await page.evaluate(() => String(new Date().getDate())));
        await waitFor(() => page.locator("#toast-message").text(), "已记下此刻");
        await page.locator("#toast-action").click();
        await show("breathing");
        await waitFor(() => page.locator("#breath-instruction").text(), "慢慢吸气");
        await page.evaluate(() => {
            MindSpaceBreathing.startedAt -= 61_000;
            MindSpaceBreathing.tick();
        });
        await waitFor(() => page.locator("#toast-message").text(), "已完成一分钟呼吸");

        await navigate("journal");
        await show("journal");
        await waitFor(() => page.locator(".journal-note-preview").text(), "兼容性测试记录");
        expect(await page.locator(".journal-note-preview .ql-font-song").text()).toBe("测试");
        await page.locator(".journal-open").click();
        await waitFor(() => page.locator("#modal-title").text(), "小雨、微风 · 心情记录");
        expect(await page.locator(".modal-diary-text .ql-font-song").text()).toBe("测试");
        await page.byText("编辑", "button").click();
        await show("weather");
        await page.locator("#mood-note").fill("已修改的随笔");
        await page.locator("#save-log-btn").click();
        await show("journal");
        await waitFor(() => page.locator(".journal-note-preview").text(), "已修改的随笔");
        await page.locator(".journal-open").click();
        await page.byText("删除记录", "button").click();
        await page.byText("删除", "button").click();
        await waitFor(() => page.locator("#toast-message").text(), "已删除记录");
        await page.locator("#toast-action").click();
        await waitFor(() => page.locator(".journal-note-preview").text(), "已修改的随笔");

        if (width < 1024) await page.locator('#view-journal [data-go="insights"]').click();
        else await navigate("insights");
        await show("insights");
        expect(await page.locator("#weather-calendar-grid .calendar-day").count()).toBe(30);
        expect(await page.locator(".calendar-day.is-today .day-weather-bar [data-weather=rainy]").attribute("style")).toBe("flex-grow:0.5");
        expect(await page.locator("#stat-total-days").text()).toBe("1 天");
        await page.evaluate(() => {
            MindSpaceStorage.saveLog("rainy", ["测试分组"], "第二条日记");
            app.renderInsights();
        });
        expect(await page.locator(".calendar-day-count").property("textContent")).toBe("2");
        expect(await page.locator(".calendar-day.is-today .day-weather-bar [data-weather=rainy]").attribute("style")).toBe("flex-grow:1.5");
        expect(await page.locator(".calendar-day.is-today .day-weather-bar [data-weather=breezy]").attribute("style")).toBe("flex-grow:0.5");
        expect(await page.locator("#weather-chart-container .rainy .chart-percent").text()).toBe("1.5 分");
        expect(await page.locator("#weather-chart-container .breezy .chart-percent").text()).toBe("0.5 分");
        await page.locator("#weather-calendar-grid .has-weather").click();
        await show("journal");
        expect(await page.locator("#journal-day-filter").visible()).toBe(true);
        expect(await page.locator(".journal-card").count()).toBe(2);
        await page.locator("#journal-search").fill("小雨 已修改");
        await waitFor(() => page.locator(".journal-card").count(), 1);
        expect(await page.locator(".journal-note-preview").text()).toBe("已修改的随笔");
        const dayWeather = (await page.locator("#journal-day-weather").text()).replace(/\s+/g, ' ');
        expect(dayWeather).toMatch(/小雨 1\.5 分/);
        expect(dayWeather).toMatch(/微风 0\.5 分/);
        await page.locator("#journal-clear-filters").click();
        await waitFor(() => page.locator("#journal-day-filter").visible(), false);
        expect(await page.locator(".journal-card").count()).toBe(2);

        await navigate("dashboard");
        expect(await page.locator(".welcome-card .lake-window").attribute("data-sky")).toBe("rainy");
        expect(await page.locator(".today-weather-bar [data-weather=rainy]").attribute("style")).toBe("flex-grow:1.5");
        expect(await page.locator(".today-weather-bar [data-weather=breezy]").attribute("style")).toBe("flex-grow:0.5");
        expect(await page.locator(".week-day.is-today .day-weather-bar [data-weather=rainy]").attribute("style")).toBe("flex-grow:1.5");
        expect(await page.locator(".week-day.is-today .day-weather-bar [data-weather=breezy]").attribute("style")).toBe("flex-grow:0.5");
        await page.locator(".today-view-entries").click();
        await show("journal");
        expect(await page.locator("#journal-day-filter").visible()).toBe(true);
        expect(await page.locator(".journal-card").count()).toBe(2);
        await navigate("dashboard");
        await page.locator(".practice-focus").click();
        await show("focus");
        await page.locator("#btn-timer-toggle").click();
        await waitFor(() => page.locator("#timer-toggle-text").text(), "暂停");
        await page.evaluate(() => {
            MindSpaceFocusTimer.lastRun.startedAt -= 120_000;
            MindSpaceFocusTimer.tick();
        });
        expect(await page.locator("#timer-digits").text()).toBe("23:00");
        await page.locator("#btn-timer-toggle").click();
        expect(await page.locator("#timer-toggle-text").text()).toBe("继续专注");

        await navigate("weather");
        await page.locator('[data-entry-mode="past"]').click();
        const backfillDay = await page.evaluate(() => MindSpaceStorage.dateKey(app.recentDates(2)[0]));
        await page.locator("#entry-date").fill(backfillDay.replaceAll("-", ""));
        expect(await page.locator("#entry-date").property("value")).toBe(backfillDay.replaceAll("-", "/"));
        await page.locator('[data-weather="sunny"] .weather-box').click();
        await page.locator("#entry-time").fill("11");
        expect(await page.locator("#entry-time").property("value")).toBe("11:");
        await page.locator("#entry-confirm").click();
        expect(await page.locator("#entry-time").attribute("aria-invalid")).toBe("true");
        await page.locator("#entry-time").fill("1130");
        expect(await page.locator("#entry-time").property("value")).toBe("11:30");
        await page.locator("#entry-confirm").click();
        expect(await page.locator("#entry-summary-time").text()).toBe(`${backfillDay} 11:30`);
        expect(await page.locator(".entry-first-line-meta").text()).not.toMatch(/此刻心情|那时心情/);
        await page.locator("#save-log-btn").click();
        await show("journal");
        expect(await page.locator(".journal-time").text()).toBe("11:30");

        await navigate("settings");
        await show("settings");
        await page.locator("#btn-cloud-config").click();
        expect(await page.locator("#cloud-config-modal").visible()).toBe(true);
        await page.locator("#cloud-config-modal .modal-close-btn").click();
        await page.locator("#btn-check-update").click();
        await waitFor(() => page.locator("#modal-title").text(), /发现新版本/);
        expect(await page.locator(".modal-content a").text()).toContain("MindSpace-9.0.0-Windows-Portable-x64.exe");
        expect(await page.locator("#modal-body b").count()).toBe(0);
        expect(await page.errors()).toEqual([]);
    });
}
