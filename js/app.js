/**
 * MindSpace - Main Application Logic & SPA Router
 * Coordinates UI states, theme toggles, modal alerts, and interactive event handlers.
 * Supports dual-navigation sync (Mobile bottom nav & Desktop sidebar).
 */

const APP_VERSION = String(window.MINDSPACE_VERSION || "0.0.0");
const JOURNAL_PAGE_SIZE = 24;
const JOURNAL_GRAPHEMES = new Intl.Segmenter('zh-CN', { granularity: 'grapheme' });
const CALENDAR_PAGE_SIZE = 30;
const SHORT_DATE = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric' });
const LONG_DATE = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' });
const RELEASES_URL = "https://github.com/Bastet-Normal/mindspace/releases";
const WEATHER_ICON_MAP = {
    sunny: 'sunny-outline', breezy: 'leaf-outline', cloudy: 'cloudy-outline',
    foggy: 'cloud-outline', rainy: 'rainy-outline', stormy: 'thunderstorm-outline'
};

// Global App Instance
const app = {
    currentUser: null,
    overlays: [],

    router: {
        currentView: 'dashboard',
        titles: {
            dashboard: '今日', weather: '记录心情', breathing: '呼吸练习',
            focus: '专注与声音', journal: '心情日记', insights: '天气回顾', settings: '设置'
        },

        location() {
            const [view, detail, id] = location.hash.slice(1).split('/');
            const editId = view === 'weather' && detail === 'edit' && MindSpaceStorage.UUID.test(id) ? id : null;
            return { view: view || 'dashboard', day: view === 'journal' ? detail : '', editId };
        },

        navigate(viewId, { day = '', editId = null, updateHash = true, focus = true } = {}) {
            if (!Object.hasOwn(this.titles, viewId)) viewId = 'dashboard';
            if (this.currentView === 'breathing' && viewId !== 'breathing') app.stopBreathing();
            if (viewId === 'journal') {
                const journalDate = app.isDayKey(day) ? day : '';
                if (journalDate !== app.journalDate) {
                    app.journalDate = journalDate;
                    app.journalLimit = JOURNAL_PAGE_SIZE;
                    if (journalDate) app.resetJournalInputs();
                }
            }
            this.currentView = viewId;
            document.querySelectorAll('.app-view').forEach(view => {
                view.classList.toggle('active', view.id === `view-${viewId}`);
            });
            document.querySelectorAll('[data-view]').forEach(item => {
                const mobile = item.classList.contains('nav-item');
                const activeView = mobile && viewId === 'insights' ? 'journal' : viewId;
                const selected = item.dataset.view === activeView;
                item.classList.toggle('active', selected);
                if (selected) item.setAttribute('aria-current', 'page');
                else item.removeAttribute('aria-current');
            });
            document.getElementById('header-view-title').textContent = this.titles[viewId];
            document.title = viewId === 'dashboard' ? 'MindSpace' : `${this.titles[viewId]} · MindSpace`;
            if (viewId === 'weather') app.openEditor(editId, day);
            else app.refreshCurrentView();
            app.renderFocusIndicator();
            let hash = `#${viewId}`;
            if (viewId === 'journal' && app.journalDate) hash += '/' + app.journalDate;
            if (viewId === 'weather' && app.editingId) hash += '/edit/' + app.editingId;
            if (updateHash && location.hash !== hash) location.hash = hash;
            window.scrollTo(0, 0);
            const heading = document.querySelector(`#view-${viewId} h1`);
            heading?.setAttribute('tabindex', '-1');
            if (focus) heading?.focus({ preventScroll: true });
        }
    },

    weatherVisuals: new Map(),
    journalFontLoads: new Map(),
    selectedMoods: [],
    entryMode: 'now',
    entryStep: 'setup',
    entryMoment: null,
    selectedTags: new Set(),
    editingId: null,
    editOriginal: null,
    drafts: new Map(),
    editingDay: '',
    journalDate: '',
    journalLimit: JOURNAL_PAGE_SIZE,
    insightOffsetDays: 0,
    focusStatus: null,

    init() {
        document.getElementById('current-app-version').textContent = `v${APP_VERSION}`;
        this.initTheme();
        this.journalEditor = new JournalEditor(document.getElementById('journal-editor'), () => {
            this.updateNoteCount();
            this.storeDraft();
        }, font => this.showJournalFont(font));
        this.refreshJournalFont();
        this.setDate();
        this.prepareWeatherVisuals();
        this.bindEvents();

        MindSpaceBreathing.init(
            document.getElementById('breath-stage'),
            document.getElementById('breath-instruction'),
            document.getElementById('breath-total-time'),
            document.getElementById('breath-mode-desc')
        );

        this.setWeatherForm(this.readDraft(null)?.form);
        this.renderProfileSettings();
        this.focusStatus = MindSpaceFocusTimer.summary?.();
        const route = this.router.location();
        this.router.navigate(route.view, { ...route, updateHash: false, focus: false });
        window.addEventListener('hashchange', () => {
            const { view, day, editId } = this.router.location();
            if (view === this.router.currentView && (view !== 'journal' || (day || '') === this.journalDate) &&
                (view !== 'weather' || editId === this.editingId)) return;
            this.router.navigate(view, { day, editId, updateHash: false });
        });
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) {
                this.setDate();
                if (this.router.currentView === 'dashboard') this.renderDashboard();
                if (this.router.currentView === 'insights') this.renderInsights();
            }
        });
        window.addEventListener('storage', event => {
            if (event.key !== MindSpaceStorage.KEY && event.key !== null) return;
            if (event.newValue === null) {
                this.drafts.clear();
                MindSpaceStorage.clearDraft();
                this.editingId = null;
                this.editOriginal = null;
                this.setWeatherForm();
                while (this.overlays.length) this.closeOverlay(this.overlays.at(-1).overlay.id);
                this.router.navigate(this.router.currentView, { focus: false });
            }
            MindSpaceStorage.setSyncSession(window.SupabaseService.scopeFor(this.currentUser));
            this.renderSyncState();
            this.refreshTheme();
            this.refreshJournalFont();
            this.refreshCurrentView();
        });

        window.SupabaseService.init().then(() => this.updateAuthUI()).catch(error => {
            this.renderSyncState();
            console.warn('无法连接云同步，本机功能仍可使用。', error);
        });
    },

    setDate() {
        const date = new Date();
        const element = document.getElementById('dashboard-date');
        element.dateTime = MindSpaceStorage.dateKey(date);
        element.textContent = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(date);
    },

    renderProfileSettings() {
        const input = document.getElementById('user-name');
        if (input && document.activeElement !== input) input.value = MindSpaceStorage.getSettings().userName;
    },

    /**
     * Theme management (supporting dual switches)
     */
    initTheme() {
        const themeBtn = document.getElementById('theme-toggle');
        const themeIcon = document.getElementById('theme-icon');
        
        const system = window.matchMedia('(prefers-color-scheme: dark)');
        this.refreshTheme = () => {
            const preferred = MindSpaceStorage.getSettings().theme;
            document.getElementById('preferred-theme').value = preferred || '';
            const theme = preferred || (system.matches ? 'dark' : 'light');
            if (this.currentTheme === theme) return;
            this.currentTheme = theme;
            const root = document.documentElement;
            root.classList.add('theme-switching');
            requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('theme-switching')));
            root.dataset.theme = theme;
            themeIcon.setAttribute('name', theme === 'dark' ? 'sunny-outline' : 'moon-outline');
            document.querySelector('meta[name="theme-color"]').content = getComputedStyle(root).getPropertyValue('--page').trim();
        };

        // Apply theme initially
        this.refreshTheme();
        system.addEventListener('change', () => this.refreshTheme());
        const saveTheme = preference => {
            const updatedSettings = MindSpaceStorage.getSettings();
            updatedSettings.theme = preference;
            try { MindSpaceStorage.saveSettings(updatedSettings); }
            catch (error) { this.showToast(error.message); }
            this.refreshTheme();
        };
        themeBtn.addEventListener('click', () => saveTheme(this.currentTheme === 'dark' ? 'light' : 'dark'));
        document.getElementById('preferred-theme').addEventListener('change', event => saveTheme(event.target.value || null));
    },

    renderFocusIndicator() {
        const indicator = document.getElementById('focus-indicator');
        const { running, mode, label } = this.focusStatus || {};
        const visible = running && this.router.currentView !== 'focus';
        indicator.hidden = !visible;
        if (!visible) return;
        document.getElementById('focus-indicator-time').textContent = label;
        indicator.setAttribute('aria-label', mode === 'break' ? '查看休息计时' : '查看专注计时');
    },

    renderDashboard() {
        const hour = new Date().getHours();
        const name = MindSpaceStorage.getSettings().userName;
        const greeting = hour < 5 || hour >= 23 ? '夜深了'
            : hour < 12 ? '早上好'
            : hour < 14 ? '中午好'
            : hour < 18 ? '下午好'
            : '晚上好';
        document.getElementById('greeting-text').textContent = `${greeting}，${name}`;
        this.renderPracticeTotals();
        const logs = MindSpaceStorage.getLogs();
        const entriesByDay = this.logsByDay(logs);
        const today = MindSpaceStorage.dateKey();
        this.renderTodayWeather(today, entriesByDay.get(today) ?? []);

        const recent = document.getElementById('journal-preview-content');
        const note = logs.find(log => log.note);
        recent.closest('.journal-preview-card').hidden = !note;
        recent.innerHTML = note
            ? `<button type="button" class="preview-entry" aria-label="查看${MindSpaceStorage.formatDate(note.timestamp)}的随笔">
                    ${this.moodChips(note.weather)}
                    <span class="preview-entry-copy"><span class="journal-preview-date">${MindSpaceStorage.formatDate(note.timestamp)}　${MindSpaceStorage.moodName(note.weather)}</span>
                    <span class="journal-preview-text">${escapeHTML(note.note)}</span></span>
                    <ion-icon name="chevron-forward-outline" aria-hidden="true"></ion-icon>
                </button>`
            : '';
        if (note) recent.querySelector('button').onclick = () => this.openJournalDetail(note);

        const week = this.recentDates(7);
        const activeDays = week.filter(date => entriesByDay.has(MindSpaceStorage.dateKey(date))).length;
        const trend = document.getElementById('trends-chart-container');
        trend.replaceChildren(...week.map((date, index) => {
            const day = MindSpaceStorage.dateKey(date);
            const entries = entriesByDay.get(day) ?? [];
            const weights = MindSpaceStorage.moodWeights(entries);
            const label = index === 6 ? '今天' : `周${'日一二三四五六'[date.getDay()]}`;
            const description = weights.length ? this.weatherWeightLabel(weights) : '未记录';
            const cell = document.createElement('button');
            cell.type = 'button';
            cell.className = `week-day${index === 6 ? ' is-today' : ''}`;
            const summary = weights.length
                ? this.dayWeatherSummary(weights, this.leadingMoods(weights))
                : '<span class="week-unlogged" aria-hidden="true"></span>';
            cell.innerHTML = `<span class="week-label">${label}</span><span class="week-date">${date.getDate()}</span>${summary}`;
            if (index === 6) cell.setAttribute('aria-current', 'date');
            if (entries.length) cell.title = description;
            cell.setAttribute('aria-label', `${SHORT_DATE.format(date)}，${label}，${description}，${entries.length ? '查看日记' : '记录心情'}`);
            cell.onclick = () => this.openWeatherDay(day, Boolean(entries.length));
            return cell;
        }));
        const caption = document.querySelector('.week-caption') || Object.assign(document.createElement('p'), { className: 'week-caption' });
        caption.textContent = activeDays ? `近七天已记 ${activeDays} 天` : '点选日期，可以补记那天的心情。';
        document.querySelector('.weekly-trends-card').append(caption);
    },

    renderTodayWeather(day, entries) {
        const weather = document.getElementById('widget-today-weather');
        const scene = document.querySelector('.welcome-card .lake-window');
        const weights = MindSpaceStorage.moodWeights(entries);
        const leaders = this.leadingMoods(weights);
        scene.dataset.sky = leaders.length === 1 ? leaders[0] : '';
        if (!weights.length) {
            const draft = this.readDraft(null)?.form;
            weather.innerHTML = `
                <div class="dashboard-heading"><h2>此刻心情</h2>
                    <button type="button" class="text-btn" data-go="weather">${draft?.weather || draft?.note ? '继续记录' : '记录心情'}<ion-icon name="chevron-forward-outline"></ion-icon></button></div>
                <div class="quick-weather-list">${Object.entries(MindSpaceStorage.WEATHER_MAP).map(([key, {name}]) =>
                    `<button type="button" class="quick-weather ${key}" data-pick="${key}" aria-label="选择${name}，记录心情">
                        ${this.weatherChip(key, true)}<span>${name}</span></button>`).join('')}</div>`;
            return;
        }

        weather.innerHTML = `
            <div class="dashboard-heading"><h2>今日天气</h2>
                <button type="button" class="text-btn" data-go="weather"><ion-icon name="add-outline"></ion-icon>再记一条</button></div>
            ${this.weatherWeightBar(weights, 'today-weather-bar')}
            <div class="today-weather-summary">
                ${this.weatherWeightScores(weights)}
                <button type="button" class="text-btn today-view-entries">查看今日 ${entries.length} 篇日记<ion-icon name="chevron-forward-outline"></ion-icon></button>
            </div>`;
        weather.querySelector('.today-view-entries').onclick = () => this.openWeatherDay(day, true);
    },

    openWeatherDay(day, hasEntries) {
        if (hasEntries) return this.router.navigate('journal', { day });
        this.router.navigate('weather');
        const isBackfill = day !== MindSpaceStorage.dateKey();
        this.setEntryFields(isBackfill ? day : '', isBackfill ? '12:00' : '');
        this.setEntryMode(isBackfill ? 'past' : 'now');
        this.entryMoment = null;
        this.setEntryStep('setup');
        this.storeDraft();
    },

    renderPracticeTotals() {
        const stats = MindSpaceStorage.getTodayStats();
        for (const [key, seconds] of [['focus', stats.focusSeconds], ['breathing', stats.breathingSeconds]]) {
            const progress = document.getElementById(key + '-progress');
            progress.value = seconds;
            progress.hidden = !seconds;
            const duration = seconds < 60 && seconds > 0 ? seconds + ' 秒' : Math.floor(seconds / 60) + ' 分钟';
            const hint = key === 'focus' ? '计时或听环境声' : '跟随节奏呼吸';
            document.getElementById(key + '-ring-text').textContent = seconds ? '今日 ' + duration : hint;
        }
    },

    prepareWeatherVisuals() {
        for (const option of document.querySelectorAll('.weather-option[data-weather]')) {
            const source = option.querySelector('.weather-visual');
            if (!source) continue;
            source.setAttribute('aria-hidden', 'true');
            const visual = document.createElement('span');
            visual.className = source.className;
            for (const child of source.children) {
                if (child.localName === 'div') {
                    const decoration = document.createElement('span');
                    decoration.className = child.className;
                    visual.append(decoration);
                } else visual.append(child.cloneNode(true));
            }
            this.weatherVisuals.set(option.dataset.weather, visual.outerHTML);
        }
    },

    weatherChip(weather, animated = false) {
        const visual = this.weatherVisuals.get(weather);
        if (!visual) return '<span class="weather-chip" aria-hidden="true">·</span>';
        const className = animated ? 'weather-chip weather-chip--animated' : 'weather-chip';
        return `<span class="${className}" data-weather="${weather}" aria-hidden="true">${visual}</span>`;
    },

    moodChips(weather, animated = false) {
        const moods = MindSpaceStorage.moods(weather);
        if (moods.length < 2) return this.weatherChip(moods[0], animated);
        return `<span class="mood-pair" aria-hidden="true">${moods.map(key => this.weatherChip(key, animated)).join('')}</span>`;
    },

    leadingMoods(weights) {
        const highest = weights[0]?.[1];
        return weights.filter(([, weight]) => weight === highest).map(([key]) => key);
    },

    weatherWeightLabel(weights) {
        return weights.map(([key, weight]) => `${MindSpaceStorage.WEATHER_MAP[key].name} ${weight} 分`).join('、');
    },

    weatherWeightBar(weights, className) {
        return `<span class="weather-weight-bar ${className}" aria-hidden="true">${weights.map(([key, weight]) =>
            `<span data-weather="${key}" style="flex-grow:${weight}"></span>`).join('')}</span>`;
    },

    weatherWeightScores(weights) {
        return `<ul class="weather-weight-scores" role="list">${weights.map(([key, weight]) =>
            `<li>${this.weatherChip(key)} <span>${MindSpaceStorage.WEATHER_MAP[key].name}</span> <span class="weather-weight-score">${weight} 分</span></li>`).join('')}</ul>`;
    },

    dayWeatherSummary(weights, leaders) {
        const icons = leaders.length <= 2 ? this.moodChips(leaders) : '';
        return `<span class="day-weather-summary" aria-hidden="true"><span class="day-weather-icons">${icons}</span>
            ${this.weatherWeightBar(weights, 'day-weather-bar')}</span>`;
    },

    recentDates(length, offset = 0) {
        const now = new Date();
        return Array.from({ length }, (_, index) => {
            const date = new Date(now);
            date.setDate(date.getDate() + index - length + 1 - offset);
            return date;
        });
    },

    readWeatherForm() {
        const day = document.getElementById('entry-date').value.replaceAll('/', '-');
        const time = document.getElementById('entry-time').value;
        return {
            weather: this.selectedMoods.join(','),
            tags: [...this.selectedTags],
            ...this.journalEditor.read(),
            entryMode: this.entryMode,
            entryStep: this.entryStep,
            entryMoment: this.entryMoment,
            recordedAt: day || time ? `${day}T${time}` : ''
        };
    },

    setWeatherForm(draft = {}) {
        this.selectedMoods = MindSpaceStorage.moods(draft.weather);
        document.querySelectorAll('input[name="selected-weather"]').forEach(choice => {
            choice.checked = this.selectedMoods.includes(choice.value);
        });
        this.selectedTags = new Set(Array.isArray(draft.tags) ? draft.tags : []);
        this.journalEditor.load(draft, MindSpaceStorage.getSettings().journalFont || 'system');
        this.loadEntryFonts(draft.fontRuns);
        const [day = '', time = ''] = (typeof draft.recordedAt === 'string' ? draft.recordedAt : '').split('T');
        this.setEntryFields(day, time);
        this.setEntryMode(draft.entryMode ?? (day || time ? 'past' : 'now'));
        const moment = draft.entryMoment;
        this.entryMoment = Number.isSafeInteger(moment) && moment >= 0 && moment <= 8640000000000000 ? moment : null;
        this.setEntryStep(this.entryMoment !== null && this.selectedMoods.length && draft.entryStep !== 'setup' ? 'writing' : 'setup');
        document.getElementById('custom-tag-input').value = '';
        document.getElementById('entry-setup-status').textContent = '';
        document.getElementById('weather-status').textContent = '';
        this.renderWeatherForm();
    },

    setEntryStep(step) {
        this.entryStep = step;
        const writing = step === 'writing';
        document.getElementById('view-weather').dataset.entryStep = step;
        document.querySelector('.entry-page-title').classList.toggle('visually-hidden', writing);
        document.getElementById('entry-setup').hidden = writing;
        document.getElementById('entry-writing').hidden = !writing;
        if (!writing) return;
        const time = document.getElementById('entry-summary-time');
        time.dateTime = new Date(this.entryMoment).toISOString();
        time.textContent = MindSpaceStorage.formatDate(this.entryMoment);
        document.getElementById('entry-summary-moods').innerHTML = this.selectedMoods.map(mood =>
            `<span class="entry-summary-mood">${this.weatherChip(mood)}${MindSpaceStorage.WEATHER_MAP[mood].name}</span>`
        ).join('');
    },

    updateNoteCount() {
        const note = document.getElementById('mood-note');
        const counter = document.getElementById('mood-note-count');
        if (!note || !counter) return;
        counter.textContent = `${this.journalEditor.length.toLocaleString('zh-CN')} / 12,000`;
    },

    storeDraft() {
        this.updateTagSummary();
        const key = this.draftKey(this.editingId);
        const draft = { form: this.readWeatherForm(), original: this.editOriginal, day: this.editingDay };
        this.drafts.set(key, draft);
        try { sessionStorage.setItem(key, JSON.stringify(draft)); }
        catch { /* Navigation still retains this tab's in-memory draft. */ }
    },

    draftKey(id) {
        return id ? 'mindspace_weather_edit:' + id : 'mindspace_weather_draft';
    },

    readDraft(id) {
        const key = this.draftKey(id);
        if (this.drafts.has(key)) return this.drafts.get(key);
        try {
            const draft = JSON.parse(sessionStorage.getItem(key));
            if (draft?.form) return draft;
            if (!id && draft) return { form: draft }; // v1.2.3 new-entry drafts
        } catch { /* An unavailable draft does not block recording. */ }
        return null;
    },

    openEditor(id, day) {
        if (id === this.editingId) {
            this.renderWeatherForm();
            return;
        }
        const draft = this.readDraft(id);
        const original = id && (MindSpaceStorage.normalizeLog(draft?.original) || MindSpaceStorage.getLogs().find(log => log.id === id));
        if (id && (!original || original.id !== id)) {
            this.showToast('这条记录已移除，可以写一条新记录。');
            id = null;
        }
        this.editingId = id;
        this.editOriginal = id ? original : null;
        this.editingDay = id ? day || draft?.day || '' : '';
        const form = id ? draft?.form || { ...original, entryMoment: original.timestamp, recordedAt: this.localMinute(original.timestamp) } : this.readDraft(null)?.form;
        this.setWeatherForm(form);
        if (id) this.storeDraft();
    },

    localMinute(timestamp) {
        return MindSpaceStorage.formatDate(timestamp).replace(' ', 'T');
    },

    setEntryMode(mode) {
        this.entryMode = mode === 'past' ? 'past' : 'now';
        document.querySelectorAll('[data-entry-mode]').forEach(button => {
            button.setAttribute('aria-pressed', String(button.dataset.entryMode === this.entryMode));
        });
        const pastTime = document.getElementById('entry-past-time');
        pastTime.hidden = this.entryMode !== 'past';
        pastTime.querySelectorAll('[aria-invalid]').forEach(field => field.removeAttribute('aria-invalid'));
        document.getElementById('entry-time-status').textContent = '';
    },

    setEntryFields(day, time) {
        const dateField = document.getElementById('entry-date');
        const timeField = document.getElementById('entry-time');
        dateField.value = day;
        timeField.value = time.normalize('NFKC').trim().replace(/^(\d):?(\d{2})$/, '0$1:$2');
        this.updateEntryMask(dateField);
        this.updateEntryMask(timeField);
    },

    updateEntryMask(field) {
        const mask = field.dataset.entryMask;
        const raw = field.value.normalize('NFKC');
        const shortHour = mask === 'HH:MM' && /^\d:\d{0,2}$/.test(raw);
        const digits = (shortHour ? '0' + raw : raw).replace(/\D/g, '');
        const selectionStart = field.selectionStart;
        const offset = raw.slice(0, selectionStart).replace(/\D/g, '').length;
        const digitsBeforeCaret = offset + (shortHour && offset ? 1 : 0);
        let digitIndex = 0;
        let formatted = '';
        for (const character of mask) {
            if (/[A-Z]/.test(character)) {
                if (digitIndex === digits.length) break;
                formatted += digits[digitIndex++];
            } else {
                formatted += character;
            }
        }
        if (field.value !== formatted) {
            field.value = formatted;
            if (document.activeElement === field) {
                let caret = 0;
                let digitsSeen = 0;
                while (caret < formatted.length && (digitsSeen < digitsBeforeCaret || /\D/.test(formatted[caret]))) {
                    if (/\d/.test(formatted[caret])) digitsSeen++;
                    caret++;
                }
                field.setSelectionRange(caret, caret);
            }
        }
        const guide = field.nextElementSibling;
        guide.firstElementChild.textContent = formatted;
        guide.lastElementChild.textContent = mask.slice(formatted.length);
    },

    entryTimestamp() {
        if (this.entryMode === 'now') return this.entryMoment ?? Date.now();
        const day = document.getElementById('entry-date');
        const clock = document.getElementById('entry-time');
        const invalid = (field, message) => {
            field.setAttribute('aria-invalid', 'true');
            field.focus();
            throw new Error(message);
        };
        const date = day.value.replaceAll('/', '-');
        if (!MindSpaceStorage.DATE.test(date)) invalid(day, '请输入完整日期，例如 2006/11/27。');
        const dateOnly = new Date(`${date}T00:00:00Z`);
        if (date < '1970-01-01' || !Number.isFinite(dateOnly.getTime()) || dateOnly.toISOString().slice(0, 10) !== date) {
            invalid(day, '请输入有效日期，最早可补记 1970/01/01。');
        }
        const parts = clock.value.match(/^(\d{2}):(\d{2})$/);
        if (!parts) invalid(clock, '请输入四位数字，例如 1230。');
        if (Number(parts[1]) > 23 || Number(parts[2]) > 59) invalid(clock, '时间应在 00:00 到 23:59 之间。');
        const value = `${date}T${clock.value}`;
        const original = this.editOriginal;
        const unchanged = original && value === this.localMinute(original.timestamp);
        const timestamp = unchanged ? original.timestamp : new Date(value).getTime();
        if (!unchanged) {
            if (date > MindSpaceStorage.dateKey()) invalid(day, '补记日期不能晚于今天。');
            if (!Number.isFinite(timestamp) || timestamp < 0 || this.localMinute(timestamp) !== value) {
                invalid(clock, '这个时间在所选日期无效，请换一个时间。');
            }
            if (timestamp > Date.now()) invalid(clock, '补记时间不能晚于现在。');
        }
        day.removeAttribute('aria-invalid');
        clock.removeAttribute('aria-invalid');
        return timestamp;
    },

    loadJournalFont(button) {
        const { fontFamily, fontSource } = button.dataset;
        if (!this.journalFontLoads.has(fontFamily)) {
            const load = (async () => {
                const url = new URL(fontSource, document.baseURI);
                let source = `url("${url.href}")`;
                if (location.protocol !== 'file:') {
                    const response = await fetch(url);
                    if (!response.ok) throw new Error('Font unavailable');
                    source = await response.arrayBuffer();
                }
                document.fonts.add(await new FontFace(fontFamily, source).load());
            })();
            this.journalFontLoads.set(fontFamily, load);
            load.catch(() => this.journalFontLoads.delete(fontFamily));
        }
        return this.journalFontLoads.get(fontFamily);
    },

    loadEntryFonts(runs = []) {
        const fonts = new Set(runs.map(run => run.font));
        for (const button of document.querySelectorAll('[data-font-source]')) {
            if (fonts.has(button.dataset.fontChoice)) this.loadJournalFont(button).catch(() => {});
        }
    },

    showJournalFont(font) {
        const label = document.getElementById('font-summary');
        const option = font && document.querySelector(`[data-font-choice="${font}"]`);
        label.textContent = option ? option.dataset.fontLabel || option.textContent : '混合字体';
        label.className = font ? `ql-font-${font}` : '';
        for (const button of document.querySelectorAll('#font-details [data-font-choice]')) {
            button.setAttribute('aria-pressed', String(button === option));
        }
    },

    refreshJournalFont() {
        const font = MindSpaceStorage.getSettings().journalFont ?? 'system';
        document.documentElement.dataset.journalFont = font;
        document.querySelector('[data-font-choice="ipaex"]').setAttribute('aria-pressed', String(font === 'ipaex'));
        this.loadEntryFonts([{ font }]);
        if (!this.journalEditor.length) {
            this.journalEditor.container.dataset.journalFont = font;
            this.journalEditor.displayFont(font);
        }
    },

    renderWeatherForm() {
        document.querySelectorAll('.entry-tool[open]').forEach(tool => { tool.open = false; });
        document.querySelector('#view-weather h1').textContent = this.editingId ? '编辑记录' : '记录心情';
        document.getElementById('cancel-edit-btn').classList.toggle('hidden', !this.editingId);
        this.renderTagsSelector();
        this.updateNoteCount();
        this.updateTagSummary();
    },

    updateTagSummary() {
        document.getElementById('tag-summary').textContent = this.selectedTags.size ? `已选 ${this.selectedTags.size} 个` : '';
    },

    renderTagsSelector() {
        const list = document.getElementById('mood-tags-list');
        const tags = new Set([...MindSpaceStorage.getSettings().customTags, ...this.selectedTags]);
        list.replaceChildren(...[...tags].map(tag => {
            const button = document.createElement('button');
            const selected = this.selectedTags.has(tag);
            button.type = 'button';
            button.className = 'tag-pill';
            button.setAttribute('aria-pressed', String(selected));
            button.classList.toggle('selected', selected);
            button.textContent = tag;
            button.onclick = () => {
                const wasSelected = this.selectedTags.has(tag);
                if (wasSelected) this.selectedTags.delete(tag);
                else this.selectedTags.add(tag);
                button.setAttribute('aria-pressed', String(!wasSelected));
                button.classList.toggle('selected', !wasSelected);
                this.storeDraft();
            };
            return button;
        }));
    },

    startEditing(log) {
        const day = this.router.currentView === 'journal' ? this.journalDate : '';
        this.hideModal();
        this.router.navigate('weather', { editId: log.id, day });
    },

    finishEditing() {
        const key = this.draftKey(this.editingId);
        this.drafts.delete(key);
        try { sessionStorage.removeItem(key); } catch { /* Memory state is already reset. */ }
        this.editingId = null;
        this.editOriginal = null;
        this.editingDay = '';
        this.setWeatherForm(this.readDraft(null)?.form);
    },

    isDayKey(day) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
        const date = new Date(`${day}T12:00:00`);
        return Number.isFinite(date.getTime()) && MindSpaceStorage.dateKey(date) === day;
    },

    resetJournalInputs() {
        document.getElementById('journal-search').value = '';
        document.getElementById('journal-weather').value = '';
        document.getElementById('journal-period').value = '';
    },

    renderJournalList({ focusAdded = false } = {}) {
        const normalize = value => value.normalize('NFKC').toLowerCase();
        const search = normalize(document.getElementById('journal-search').value.trim());
        const terms = search ? search.split(/\s+/) : [];
        const weather = document.getElementById('journal-weather').value;
        const periodControl = document.getElementById('journal-period');
        const period = Number(periodControl.value);
        const firstDay = period ? MindSpaceStorage.dateKey(this.recentDates(period)[0]) : '';
        const today = MindSpaceStorage.dateKey();
        const date = this.journalDate;
        const filtered = Boolean(search || weather || period || date);
        periodControl.disabled = Boolean(date);
        const dayFilter = document.getElementById('journal-day-filter');
        dayFilter.hidden = !date;
        const dayLabel = date ? LONG_DATE.format(new Date(`${date}T12:00:00`)) : '';
        document.getElementById('journal-day-label').textContent = dayLabel;
        document.getElementById('journal-clear-day').setAttribute('aria-label', `清除日期筛选，${dayLabel}`);
        document.getElementById('journal-clear-filters').hidden = !filtered;

        const logs = MindSpaceStorage.getLogs();
        const dayEntries = date ? logs.filter(log => MindSpaceStorage.dateKey(new Date(log.timestamp)) === date) : [];
        const dayWeather = document.getElementById('journal-day-weather');
        dayWeather.hidden = !dayEntries.length;
        dayWeather.innerHTML = dayEntries.length
            ? `<span class="journal-day-weather-label">当日天气</span>${this.weatherWeightScores(MindSpaceStorage.moodWeights(dayEntries))}`
            : '';
        const firstEntry = !logs.length && !filtered;
        document.querySelector('#view-journal .journal-filter-row').hidden = firstEntry;
        document.querySelector('#view-journal .journal-result-bar').hidden = !filtered;
        document.querySelector('#view-journal .page-actions [data-go="weather"]').hidden = firstEntry;
        const matches = (date ? dayEntries : logs).filter(log => {
            if (weather && !MindSpaceStorage.moods(log.weather).includes(weather)) return false;
            if (!date && firstDay) {
                const day = MindSpaceStorage.dateKey(new Date(log.timestamp));
                if (day < firstDay || day > today) return false;
            }
            if (!terms.length) return true;
            const fields = [MindSpaceStorage.moodName(log.weather), log.note, ...log.tags].map(normalize);
            return terms.every(term => fields.some(field => field.includes(term)));
        });

        const list = document.getElementById('journal-list');
        const empty = document.getElementById('journal-empty');
        const status = document.getElementById('journal-status');
        const more = document.getElementById('journal-load-more');
        const active = document.activeElement;
        const focusedCard = active?.closest('#journal-list .journal-card');
        const previousCount = list.querySelectorAll('.journal-card').length;
        const displayed = matches.slice(0, this.journalLimit);
        const description = matches.length > displayed.length
            ? `共 ${matches.length} 条，已显示 ${displayed.length} 条` : `${matches.length} 条记录`;
        status.hidden = firstEntry;
        if (status.textContent !== description) status.textContent = description;
        list.hidden = !displayed.length;
        empty.hidden = Boolean(displayed.length);
        empty.querySelector('p').textContent = filtered ? '没有匹配的记录。' : '你的日期、天气和随笔会收在这里。';
        empty.querySelector('button').hidden = filtered;
        more.hidden = displayed.length >= matches.length;
        if (!more.hidden) more.textContent = `显示更多记录（剩余 ${matches.length - displayed.length} 条）`;

        const groups = this.logsByDay(displayed);
        const fragment = document.createDocumentFragment();
        const cards = new Map();
        for (const [day, entries] of groups) {
            const group = document.createElement('section');
            group.className = 'journal-day';
            const heading = document.createElement('h2');
            heading.className = 'journal-day-heading';
            heading.id = `journal-heading-${day}`;
            heading.innerHTML = `${day === today ? '<span class="journal-today-marker">今天</span>' : ''}
                <time datetime="${day}">${LONG_DATE.format(new Date(`${day}T12:00:00`))}</time>`;
            group.setAttribute('aria-labelledby', heading.id);
            group.append(heading);
            for (const log of entries) {
                const card = this.createJournalCard(log, terms);
                cards.set(log.id, card);
                group.append(card);
            }
            fragment.append(group);
        }
        list.replaceChildren(fragment);
        if (focusAdded) {
            const entry = displayed[previousCount];
            cards.get(entry?.id)?.querySelector('.journal-open')?.focus();
        } else if (focusedCard) {
            const target = cards.get(focusedCard.dataset.id);
            (target?.querySelector('.journal-open') || (firstEntry ? empty.querySelector('button') : status)).focus({ preventScroll: true });
        }
    },

    logsByDay(logs) {
        const groups = new Map();
        for (const log of logs) {
            const day = MindSpaceStorage.dateKey(new Date(log.timestamp));
            if (!groups.has(day)) groups.set(day, []);
            groups.get(day).push(log);
        }
        return groups;
    },

    createJournalCard(log, terms) {
        const card = document.createElement('article');
        const time = MindSpaceStorage.formatDate(log.timestamp);
        const name = MindSpaceStorage.moodName(log.weather);
        const start = this.journalExcerptStart(log.note, terms);
        const tags = log.tags.slice(0, 3).map(tag => `<span class="tag">${escapeHTML(tag)}</span>`);
        if (log.tags.length > 3) tags.push(`<span class="tag-more">+${log.tags.length - 3}</span>`);
        card.className = 'journal-card card';
        card.dataset.id = log.id;
        card.dataset.weather = MindSpaceStorage.moods(log.weather)[0];
        card.innerHTML = `
                <button type="button" class="journal-open" aria-label="${escapeHTML([log.note.slice(start, start + 48), name, time, ...log.tags.slice(0, 3)].filter(Boolean).join('，'))}">
                    ${log.note ? '<span class="journal-note-preview"></span>' : ''}
                    <span class="journal-card-header">
                        <time datetime="${new Date(log.timestamp).toISOString()}" class="journal-time">${time.slice(-5)}</time>
                        <span class="journal-weather-info">${this.moodChips(log.weather)}
                            <span class="journal-weather-name">${name}</span></span>
                    </span>
                    ${tags.length ? `<span class="journal-tags">${tags.join('')}</span>` : ''}
                </button>`;
        if (log.note) {
            // Only two lines are visible. Avoid building spans for the rest of a long entry.
            const limit = start + 512;
            const end = limit < log.note.length ? JOURNAL_GRAPHEMES.segment(log.note).containing(limit).index : log.note.length;
            this.renderJournalText(card.querySelector('.journal-note-preview'), log, start, end);
        }
        card.querySelector('.journal-open').onclick = () => this.openJournalDetail(log);
        return card;
    },

    journalExcerptStart(note, terms) {
        if (!note || !terms.length) return 0;
        const lower = note.normalize('NFKC').toLowerCase();
        const offsets = terms.map(term => lower.indexOf(term)).filter(index => index >= 0);
        const match = offsets.length ? Math.min(...offsets) : 0;
        if (match < 20 && !lower.slice(0, match).includes('\n')) return 0;
        const start = Math.max(lower.lastIndexOf('\n', match - 1) + 1, match - 8, 0);
        const segments = JOURNAL_GRAPHEMES.segment(note);
        if (lower === note) return segments.containing(start).index;
        // Compatibility characters can expand during search. Font offsets refer to the original note.
        let normalizedEnd = 0;
        for (const { segment, index } of segments) {
            normalizedEnd += segment.normalize('NFKC').toLowerCase().length;
            if (normalizedEnd > start) return index;
        }
        return 0;
    },

    renderJournalText(target, log, start = 0, end = log.note.length) {
        const runs = log.fontRuns || [];
        if (start) target.append('…');
        if (!runs.length) target.append(log.note.slice(start, end));
        const visibleRuns = [];
        for (const [i, run] of runs.entries()) {
            if (run.start >= end) break;
            const stop = Math.min(runs[i + 1]?.start ?? end, end);
            if (stop <= start) continue;
            const span = document.createElement('span');
            span.className = `ql-font-${run.font}`;
            span.textContent = log.note.slice(Math.max(start, run.start), stop);
            target.append(span);
            visibleRuns.push(run);
        }
        if (end < log.note.length) target.append('…');
        if (visibleRuns.length) this.loadEntryFonts(visibleRuns);
    },

    openJournalDetail(log) {
        this.showModal(`${MindSpaceStorage.moodName(log.weather)} · 心情记录`, `
            <article tabindex="0" aria-label="日记全文">
                <p class="card-subtitle">${MindSpaceStorage.formatDate(log.timestamp)}</p>
                <p class="modal-diary-text"></p>
                ${log.tags.length ? `<div class="journal-tags">${log.tags.map(tag => `<span class="tag">${escapeHTML(tag)}</span>`).join('')}</div>` : ''}
            </article>
        `, [
            { text: '删除记录', class: 'text-btn diary-delete', onClick: () => this.confirmDeleteLog(log) },
            { text: '编辑', class: 'primary-btn', onClick: () => this.startEditing(log) }
        ]);
        const body = document.querySelector('#modal-body .modal-diary-text');
        if (log.note) this.renderJournalText(body, log);
        else body.textContent = '这条记录没有写文字。';
    },

    confirmDeleteLog(log) {
        this.showModal('删除这条记录？', '日记会从本机删除。已启用云同步时，删除将在联网后同步。', [
            { text: '取消', onClick: () => this.openJournalDetail(log) },
            { text: '删除', class: 'danger-btn', onClick: () => {
                try {
                    const deleted = MindSpaceStorage.deleteLog(log.id);
                    this.hideModal();
                    this.refreshCurrentView();
                    if (deleted) this.showToast('已删除记录', { text: '撤销', onClick: () => {
                        MindSpaceStorage.restoreLog(deleted);
                        this.refreshCurrentView();
                        this.showToast('已恢复记录');
                    }});
                } catch (error) {
                    this.showToast(error.message);
                }
            }}
        ]);
    },

    renderInsights() {
        const logs = MindSpaceStorage.getLogs();
        const byDay = this.logsByDay(logs);
        const leaders = this.leadingMoods(MindSpaceStorage.moodWeights(logs));
        const top = leaders.length === 1 ? leaders[0] : null;
        const { totalBreathingMinutes, totalFocusMinutes, streak } = MindSpaceStorage.getCumulativeStats();
        document.getElementById('stat-total-days').textContent = `${byDay.size} 天`;
        const mostCommon = document.getElementById('stat-top-weather');
        mostCommon.textContent = top ? MindSpaceStorage.WEATHER_MAP[top].name : leaders.length ? `${leaders.length} 种并列` : '—';
        mostCommon.title = leaders.map(key => MindSpaceStorage.WEATHER_MAP[key].name).join('、');
        document.getElementById('stat-weather-icon').setAttribute('name', top ? WEATHER_ICON_MAP[top] : 'cloudy-outline');
        document.getElementById('stat-cumulative-focus').textContent = `${totalFocusMinutes + totalBreathingMinutes} 分钟`;
        document.getElementById('stat-mindful-streak').textContent = `${streak} 天`;

        const days = this.recentDates(CALENDAR_PAGE_SIZE, this.insightOffsetDays);
        const dayKeys = days.map(date => MindSpaceStorage.dateKey(date));
        const firstDay = dayKeys[0];
        const today = MindSpaceStorage.dateKey();
        const firstLogDay = Array.from(byDay.keys()).at(-1);
        const previous = document.getElementById('calendar-previous');
        const next = document.getElementById('calendar-next');
        previous.disabled = !firstLogDay || firstLogDay >= firstDay;
        next.disabled = !this.insightOffsetDays;
        const shortRange = days[0].getFullYear() === days.at(-1).getFullYear() && days[0].getFullYear() === new Date().getFullYear();
        const format = shortRange ? SHORT_DATE : LONG_DATE;
        document.getElementById('calendar-range').textContent = `${format.format(days[0])} 至 ${format.format(days.at(-1))}`;

        const displayedLogs = dayKeys.flatMap(day => byDay.get(day) || []);
        const datesWithLogs = dayKeys.filter(day => byDay.has(day)).length;
        document.getElementById('weather-calendar-comfort').textContent =
            `${datesWithLogs} 天有记录，共 ${displayedLogs.length} 条日记。点选日期可查看或补记。`;

        const calendar = document.getElementById('weather-calendar-grid');
        calendar.replaceChildren(...days.map((date, index) => {
            const day = dayKeys[index];
            const entries = byDay.get(day) || [];
            const weights = MindSpaceStorage.moodWeights(entries);
            const cell = document.createElement('button');
            cell.type = 'button';
            cell.className = `calendar-day${day === today ? ' is-today' : ''}`;
            cell.textContent = date.getDate();
            if (index === 0) cell.style.gridColumnStart = (date.getDay() + 6) % 7 + 1;
            if (date.getDate() === 1 || index === 0) {
                const month = document.createElement('small');
                month.className = 'calendar-month';
                month.textContent = `${date.getMonth() + 1}月`;
                cell.prepend(month);
            }
            const title = LONG_DATE.format(date);
            if (day === today) cell.setAttribute('aria-current', 'date');
            if (weights.length) {
                const dayLeaders = this.leadingMoods(weights);
                cell.classList.add('has-weather');
                if (dayLeaders.length === 1) cell.classList.add(dayLeaders[0]);
                cell.insertAdjacentHTML('beforeend', this.dayWeatherSummary(weights, dayLeaders));
                if (entries.some(entry => entry.note)) cell.classList.add('has-note');
                const description = this.weatherWeightLabel(weights);
                cell.title = description;
                cell.setAttribute('aria-label', `${title}，${entries.length} 条记录，${description}，查看日记`);
                if (entries.length > 1) {
                    const count = document.createElement('span');
                    count.className = 'calendar-day-count';
                    count.textContent = entries.length > 99 ? '99+' : entries.length;
                    count.setAttribute('aria-hidden', 'true');
                    cell.append(count);
                }
            } else {
                cell.setAttribute('aria-label', `${title}，补记当天心情`);
            }
            cell.onclick = () => this.openWeatherDay(day, Boolean(entries.length));
            return cell;
        }));
        this.renderInsightCharts(displayedLogs);
    },

    renderInsightCharts(logs) {
        const weights = new Map(MindSpaceStorage.moodWeights(logs));
        const tagCounts = new Map();
        for (const { tags } of logs) {
            for (const tag of tags) tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
        }
        const chart = document.getElementById('weather-chart-container');
        chart.innerHTML = logs.length ? Object.entries(MindSpaceStorage.WEATHER_MAP).map(([key, { name }]) => {
            const weight = weights.get(key) ?? 0;
            const percent = 100 * weight / logs.length;
            return `<div class="chart-row ${key}"><span class="chart-label">${name}</span>
                <div class="chart-track" aria-hidden="true"><div class="chart-fill" style="width:${percent}%"></div></div>
                <span class="chart-percent">${weight} 分</span></div>`;
        }).join('') : '<p class="empty-analysis-text">这段时间没有心情记录。</p>';
        const tags = [...tagCounts].sort(([, a], [, b]) => b - a).slice(0, 5);
        document.getElementById('tags-analysis-container').innerHTML = tags.length ? tags.map(([tag, count]) => `
            <div class="tag-analysis-row"><span class="tag-analysis-name">${escapeHTML(tag)}</span>
            <div class="tag-analysis-track" aria-hidden="true"><div class="tag-analysis-fill" style="width:${100 * count / tags[0][1]}%"></div></div>
            <span class="tag-analysis-count">${count} 次</span></div>`
        ).join('') : '<p class="empty-analysis-text">这段时间没有添加标签。</p>';
    },

    refreshCurrentView() {
        const render = {
            dashboard: () => this.renderDashboard(),
            journal: () => this.renderJournalList(),
            insights: () => this.renderInsights(),
            settings: () => this.renderProfileSettings()
        }[this.router.currentView];
        render?.();
    },

    selectBreathingMode(mode) {
        document.querySelectorAll('.mode-tab').forEach(tab => {
            const selected = tab.dataset.rhythm === mode;
            tab.classList.toggle('active', selected);
            tab.setAttribute('aria-pressed', String(selected));
        });
        MindSpaceBreathing.setRhythm(mode);
    },

    startBreathing(duration = null) {
        MindSpaceFocusTimer.pause();
        MindSpaceBreathing.start(duration);
        const start = document.getElementById('start-breath-btn');
        const stop = document.getElementById('stop-breath-btn');
        const moveFocus = start.matches(':focus-visible');
        start.classList.add('hidden');
        stop.classList.remove('hidden');
        if (moveFocus) stop.focus({ preventScroll: true });
        document.getElementById('breath-stage').scrollIntoView({ block: 'nearest' });
    },

    stopBreathing() {
        MindSpaceBreathing.stop();
        const start = document.getElementById('start-breath-btn');
        const stop = document.getElementById('stop-breath-btn');
        const moveFocus = stop.matches(':focus-visible');
        start.classList.remove('hidden');
        stop.classList.add('hidden');
        if (moveFocus) start.focus({ preventScroll: true });
    },

    quickBreathing() {
        this.hideModal();
        if (MindSpaceBreathing.isActive) this.stopBreathing();
        this.router.navigate('breathing');
        this.selectBreathingMode('55');
        this.startBreathing(60);
    },

    showToast(message, action = null) {
        const toast = document.getElementById('toast');
        document.getElementById('toast-message').textContent = message;
        const button = document.getElementById('toast-action');
        button.classList.toggle('hidden', !action);
        button.textContent = action?.text || '';
        button.onclick = action?.onClick || null;
        toast.classList.remove('hidden');
        clearTimeout(this.toastTimer);
        this.toastTimer = setTimeout(() => toast.classList.add('hidden'), action ? 14000 : 4500);
    },

    bindEvents() {
        const picker = document.getElementById('widget-today-weather');
        const scene = document.querySelector('.welcome-card .lake-window');
        const previewSky = () => {
            if (!picker.querySelector('[data-pick]')) return;
            const pointerChoice = matchMedia('(hover: hover) and (pointer: fine)').matches ? picker.querySelector('[data-pick]:hover') : null;
            const keyboardChoice = picker.querySelector('[data-pick]:focus-visible');
            scene.dataset.sky = keyboardChoice?.dataset.pick || pointerChoice?.dataset.pick || '';
        };
        for (const event of ['pointerover', 'pointerout', 'focusin', 'focusout']) {
            picker.addEventListener(event, () => requestAnimationFrame(previewSky));
        }
        document.getElementById('skip-to-content').addEventListener('click', event => {
            event.preventDefault();
            document.querySelector('.app-view.active h1')?.focus();
        });
        document.addEventListener('mindspace:focus-state', event => {
            this.focusStatus = event.detail;
            this.renderFocusIndicator();
        });
        document.addEventListener('mindspace:sync-conflicts', event => {
            this.showToast(`已在本机保留 ${event.detail} 条有差异的日记`);
        });
        document.addEventListener('mindspace:delete-conflicts', () => {
            this.showToast('另一台设备修改了要删除的日记，已保留云端版本。');
        });
        document.addEventListener('click', event => {
            const navigation = event.target.closest('[data-view], [data-go], [data-quick-breath], [data-pick]');
            if (!navigation) return;
            if (navigation.hasAttribute('data-quick-breath')) this.quickBreathing();
            else if (navigation.dataset.pick) {
                this.router.navigate('weather');
                this.setEntryStep('setup');
                this.storeDraft();
                const choice = document.querySelector(`input[name="selected-weather"][value="${navigation.dataset.pick}"]`);
                if (!choice.checked) choice.click();
            }
            else this.router.navigate(navigation.dataset.view || navigation.dataset.go);
        });

        const status = document.getElementById('weather-status');
        const setupStatus = document.getElementById('entry-setup-status');
        const timeStatus = document.getElementById('entry-time-status');
        const moodChoices = document.querySelectorAll('input[name="selected-weather"]');
        moodChoices.forEach(choice => {
            choice.addEventListener('change', () => {
                if (choice.checked && this.selectedMoods.length === 2) {
                    choice.checked = false;
                    setupStatus.textContent = '已选两种，取消一项后再选。';
                    return;
                }
                this.selectedMoods = choice.checked
                    ? [...this.selectedMoods, choice.value]
                    : this.selectedMoods.filter(key => key !== choice.value);
                setupStatus.textContent = '';
                this.storeDraft();
            });
        });
        document.querySelectorAll('[data-entry-mode]').forEach(button => {
            button.addEventListener('click', () => {
                const mode = button.dataset.entryMode;
                if (mode !== this.entryMode) this.entryMoment = null;
                this.setEntryMode(mode);
                setupStatus.textContent = '';
                this.storeDraft();
            });
        });
        const note = document.getElementById('mood-note');
        const pastTime = document.getElementById('entry-past-time');
        const updateEntryField = event => {
            if (event.isComposing) return;
            const field = event.target;
            this.updateEntryMask(field);
            field.removeAttribute('aria-invalid');
            timeStatus.textContent = '';
            this.storeDraft();
        };
        pastTime.addEventListener('input', updateEntryField);
        pastTime.addEventListener('compositionend', updateEntryField);
        pastTime.addEventListener('beforeinput', event => {
            const field = event.target;
            const cursor = field.selectionStart;
            const backward = event.inputType === 'deleteContentBackward';
            if (!event.cancelable || cursor !== field.selectionEnd || (!backward && event.inputType !== 'deleteContentForward')) return;
            const divider = field.value[backward ? cursor - 1 : cursor];
            if (divider !== '/' && divider !== ':') return;
            event.preventDefault();
            field.setRangeText('', backward ? cursor - 2 : cursor, backward ? cursor : cursor + 2, 'start');
            field.dispatchEvent(new Event('input', { bubbles: true }));
        });
        document.getElementById('entry-confirm').addEventListener('click', () => {
            if (!this.selectedMoods.length) {
                setupStatus.textContent = '先选一种或两种心情。';
                moodChoices[0].focus();
                return;
            }
            try {
                this.entryMoment = this.entryTimestamp();
                timeStatus.textContent = '';
                this.setEntryStep('writing');
                this.storeDraft();
                status.textContent = '';
                window.scrollTo(0, 0);
                note.focus({ preventScroll: true });
            } catch (error) {
                (this.entryMode === 'past' ? timeStatus : setupStatus).textContent = error.message;
            }
        });
        document.getElementById('entry-change').addEventListener('click', () => {
            this.setEntryStep('setup');
            setupStatus.textContent = '';
            this.storeDraft();
            document.querySelector('.entry-page-title').focus();
        });
        document.getElementById('profile-form').addEventListener('submit', event => {
            event.preventDefault();
            const input = document.getElementById('user-name');
            const status = document.getElementById('profile-status');
            try {
                const settings = MindSpaceStorage.getSettings();
                settings.userName = input.value.trim() || MindSpaceStorage.DEFAULT_SETTINGS.userName;
                MindSpaceStorage.saveSettings(settings);
                input.value = settings.userName;
                status.textContent = '已保存。';
                if (this.router.currentView === 'dashboard') this.renderDashboard();
                this.showToast('称呼已更新');
            } catch (error) {
                status.textContent = error.message;
            }
        });
        document.getElementById('cancel-edit-btn').addEventListener('click', () => {
            const day = this.editingDay;
            this.finishEditing();
            this.router.navigate('journal', { day });
        });

        document.getElementById('save-log-btn').addEventListener('click', () => {
            const { weather, tags, note, fontRuns } = this.readWeatherForm();
            if (this.entryStep !== 'writing' || this.entryMoment === null || !weather) return;

            try {
                const timestamp = this.entryMoment;
                const day = MindSpaceStorage.dateKey(new Date(timestamp));
                if (this.editingId) {
                    const saved = MindSpaceStorage.updateLog(this.editingId, weather, tags, note, { expected: this.editOriginal, timestamp, fontRuns });
                    const asCopy = saved.id !== this.editingId;
                    const returnDay = (this.editingDay || timestamp !== this.editOriginal.timestamp) ? day : '';
                    this.finishEditing();
                    this.router.navigate('journal', { day: returnDay });
                    this.showToast(asCopy ? '原记录已变更，本次编辑已另存为本机日记' : '已保存修改');
                } else {
                    MindSpaceStorage.saveLog(weather, tags, note, timestamp, fontRuns);
                    this.finishEditing();
                    if (day !== MindSpaceStorage.dateKey()) {
                        this.router.navigate('journal', { day });
                        this.showToast('已补记当天的心情');
                        return;
                    }
                    this.router.navigate('dashboard');
                    this.showToast('已记下此刻', { text: '呼吸一分钟', onClick: () => {
                        document.getElementById('toast').classList.add('hidden');
                        this.quickBreathing();
                    }});
                }
                status.textContent = '';
            } catch (error) {
                status.textContent = error.message;
            }
        });

        const entryTools = document.querySelectorAll('.entry-tool');
        document.addEventListener('click', event => {
            for (const tool of entryTools) {
                if (tool.open && !tool.contains(event.target)) tool.open = false;
            }
        });
        entryTools.forEach(tool => {
            tool.addEventListener('keydown', event => {
                if (!tool.open || event.key !== 'Escape') return;
                event.stopPropagation();
                tool.open = false;
                tool.querySelector('summary').focus({ preventScroll: true });
            });
        });
        let fontRequest = 0;
        const fontLoadError = '字体加载失败，请重试。';
        document.querySelectorAll('[data-font-choice]').forEach(button => {
            button.addEventListener('click', async () => {
                const request = ++fontRequest;
                const { fontChoice, fontSource } = button.dataset;
                const picker = button.closest('#font-details');
                if (picker?.open) {
                    picker.open = false;
                    this.journalEditor.applyFont(fontChoice);
                }
                if (document.getElementById('toast-message').textContent === fontLoadError) {
                    document.getElementById('toast').classList.add('hidden');
                }
                if (fontSource) {
                    button.setAttribute('aria-busy', 'true');
                    try {
                        await this.loadJournalFont(button);
                    } catch {
                        if (request === fontRequest) this.showToast(fontLoadError);
                        return;
                    } finally {
                        button.removeAttribute('aria-busy');
                    }
                }
                if (request !== fontRequest) return;
                const settings = MindSpaceStorage.getSettings();
                try {
                    MindSpaceStorage.saveSettings({ ...settings, journalFont: fontChoice });
                    this.refreshJournalFont();
                } catch (error) {
                    this.showToast(error.message);
                }
            });
        });
        const tagInput = document.getElementById('custom-tag-input');
        const addCustomTag = () => {
            const tag = tagInput.value.trim();
            if (!tag) return;
            const settings = MindSpaceStorage.getSettings();
            if (!settings.customTags.includes(tag)) settings.customTags.push(tag);
            try {
                MindSpaceStorage.saveSettings(settings);
                this.selectedTags.add(tag);
                tagInput.value = '';
                this.renderTagsSelector();
                this.storeDraft();
            } catch (error) {
                status.textContent = error.message;
            }
        };
        document.getElementById('add-custom-tag-btn').addEventListener('click', addCustomTag);
        tagInput.addEventListener('keydown', event => {
            if (event.key === 'Enter') {
                event.preventDefault();
                addCustomTag();
            }
        });

        document.getElementById('start-breath-btn').addEventListener('click', () => this.startBreathing());
        document.getElementById('stop-breath-btn').addEventListener('click', () => this.stopBreathing());
        document.querySelectorAll('.mode-tab').forEach(tab => {
            tab.addEventListener('click', () => this.selectBreathingMode(tab.dataset.rhythm));
        });
        document.getElementById('breath-sound-prompt').addEventListener('change', event => {
            MindSpaceBreathing.toggleSoundPrompt(event.target.checked);
        });
        document.addEventListener('mindspace:breathing-complete', () => {
            this.stopBreathing();
            this.showToast('已完成一分钟呼吸');
        });

        const journalSearch = document.getElementById('journal-search');
        const updateJournal = () => {
            this.journalLimit = JOURNAL_PAGE_SIZE;
            this.renderJournalList();
        };
        let composing = false;
        journalSearch.addEventListener('compositionstart', () => { composing = true; });
        journalSearch.addEventListener('compositionend', () => {
            composing = false;
            updateJournal();
        });
        journalSearch.addEventListener('input', event => {
            if (!composing && !event.isComposing) updateJournal();
        });
        document.getElementById('journal-weather').addEventListener('change', updateJournal);
        document.getElementById('journal-period').addEventListener('change', updateJournal);
        document.getElementById('journal-clear-day').addEventListener('click', () => this.router.navigate('journal'));
        document.getElementById('journal-clear-filters').addEventListener('click', () => {
            this.journalLimit = JOURNAL_PAGE_SIZE;
            this.resetJournalInputs();
            this.router.navigate('journal', { focus: false });
            journalSearch.focus({ preventScroll: true });
        });
        document.getElementById('journal-load-more').addEventListener('click', () => {
            this.journalLimit += JOURNAL_PAGE_SIZE;
            this.renderJournalList({ focusAdded: true });
        });
        const previous = document.getElementById('calendar-previous');
        const next = document.getElementById('calendar-next');
        for (const [button, fallback, change] of [[previous, next, CALENDAR_PAGE_SIZE], [next, previous, -CALENDAR_PAGE_SIZE]]) {
            button.addEventListener('click', () => {
                this.insightOffsetDays = Math.max(0, this.insightOffsetDays + change);
                this.renderInsights();
                if (button.disabled) fallback.focus({ preventScroll: true });
            });
        }

        const backupActions = {
            'btn-export-md': () => MindSpaceStorage.exportToMarkdown(),
            'btn-export-json': () => MindSpaceStorage.exportToJSON()
        };
        for (const [id, action] of Object.entries(backupActions)) {
            document.getElementById(id).addEventListener('click', () => {
                try { action(); }
                catch (error) { this.showToast(error.message); }
            });
        }

        const importInput = document.getElementById('import-json-file-input');
        document.getElementById('btn-import-json').onclick = () => importInput.click();
        importInput.addEventListener('change', async () => {
            const file = importInput.files[0];
            if (!file) return;
            try {
                const backup = MindSpaceStorage.previewImport(await file.text());
                const scope = MindSpaceStorage.activeScope;
                const consent = MindSpaceStorage.activeConsent;
                const uploadChoice = scope && backup.newLogs ? `<label class="option-toggle sync-consent">
                    <input type="checkbox" id="sync-restored"><span class="toggle-slider"></span>
                    <span>同时上传新增日记到 ${escapeHTML(this.currentUser?.email || '当前云账户')}</span></label>` : '';
                const differences = backup.conflicts
                    ? `<p>其中 ${backup.conflicts} 条日记与本机版本内容不同。恢复时会保留本机版本。</p>` : '';
                this.showModal('恢复备份', `<p>备份中共有 ${backup.logs.length} 条日记。恢复后将新增 ${backup.newLogs} 条，并合并练习统计。</p>${differences}${uploadChoice}`, [
                    { text: '取消', onClick: () => this.hideModal() },
                    { text: '确认恢复', class: 'primary-btn', onClick: () => {
                        try {
                            const upload = document.getElementById('sync-restored')?.checked;
                            const added = MindSpaceStorage.importBackup(backup, upload ? { scope, consent } : null);
                            this.renderProfileSettings();
                            this.refreshTheme();
                            this.refreshJournalFont();
                            this.hideModal();
                            this.showToast(`备份已恢复，新增 ${added} 条日记`);
                        } catch (error) {
                            this.showModal('无法恢复备份', escapeHTML(error.message), [{ text: '关闭', onClick: () => this.hideModal() }]);
                        }
                    }}
                ]);
            } catch (error) {
                this.showModal('无法恢复备份', escapeHTML(error.message), [{ text: '关闭', onClick: () => this.hideModal() }]);
            } finally {
                importInput.value = '';
            }
        });

        document.getElementById('btn-clear-all').onclick = () => {
            this.showModal('清除本机数据？', '<p>这会移除本机日记、练习记录、草稿、设置和云连接。云端记录会保留。</p><p>请先保存想保留的草稿，再导出备份。</p>', [
                { text: '取消', onClick: () => this.hideModal() },
                { text: '清除本机数据', class: 'danger-btn', onClick: () => {
                    try {
                        MindSpaceBreathing.stop();
                        MindSpaceFocusTimer.pause();
                        MindSpaceFocusTimer.clearStoredState?.();
                        MindSpaceSoundMixer.stopAllImmediate();
                        MindSpaceSoundMixer.clearStoredState?.();
                        MindSpaceStorage.clearAllData();
                        window.SupabaseService.clearConfig({ clearSession: true, allProjects: true });
                        location.reload();
                    } catch (error) {
                        this.showToast(error.message);
                    }
                }}
            ]);
        };

        // Check for Update Button
        const btnCheckUpdate = document.getElementById('btn-check-update');
        if (btnCheckUpdate) {
            btnCheckUpdate.addEventListener('click', async () => {
                const icon = document.getElementById('icon-check-update');
                
                if (icon) icon.style.animation = 'auth-spin 1s linear infinite';
                
                try {
                    const response = await fetch('https://api.github.com/repos/Bastet-Normal/mindspace/releases/latest', {
                        headers: { 'Accept': 'application/vnd.github.v3+json' }
                    });
                    
                    if (!response.ok) throw new Error('网络请求错误');
                    const data = await response.json();
                    
                    const latestVersion = String(data.tag_name || '').trim();
                    const currentVersion = `v${APP_VERSION}`;
                    if (!latestVersion) throw new Error('最新版本信息缺失');
                    
                    if (icon) icon.style.animation = '';
                    
                    if (compareVersions(latestVersion, currentVersion) > 0) {
                        let downloadHtml = '';
                        if (data.assets && data.assets.length > 0) {
                            downloadHtml = '<p style="margin-top: 10px; font-weight: 500; font-size: 0.85rem;">下载资源:</p><ul style="list-style: none; padding-left: 0; margin-top: 5px; font-size: 0.85rem; display: flex; flex-direction: column; gap: 6px;">';
                            data.assets.forEach(asset => {
                                const assetUrl = safeGitHubUrl(asset.browser_download_url);
                                if (!assetUrl) return;
                                const assetName = escapeHTML(asset.name || '下载附件');
                                const assetSize = Number(asset.size);
                                const sizeLabel = Number.isFinite(assetSize) ? ` (${(assetSize / (1024 * 1024)).toFixed(2)} MB)` : '';
                                downloadHtml += `<li><a href="${escapeHTML(assetUrl)}" target="_blank" rel="noopener noreferrer" style="color: var(--accent-color); text-decoration: underline; display: inline-flex; align-items: center; gap: 4px;"><ion-icon name="download-outline"></ion-icon> ${assetName}${sizeLabel}</a></li>`;
                            });
                            downloadHtml += '</ul>';
                        }

                        const releaseUrl = safeGitHubUrl(data.html_url) || RELEASES_URL;
                        const releaseNotes = escapeHTML(data.body || '无详细更新说明。');
                        
                        this.showModal('发现新版本 🎉', `
                            <p style="font-size: 0.9rem; line-height: 1.5;">最新版本 <strong>${escapeHTML(latestVersion)}</strong> 已发布！</p>
                            <p style="font-size: 0.8rem; color: var(--text-muted); margin-top: 6px; white-space: pre-line; line-height: 1.4;">更新日志:<br>${releaseNotes}</p>
                            ${downloadHtml}
                        `, [
                            { text: '稍后更新', class: 'secondary-btn', onClick: () => this.hideModal() },
                            { text: '前往发布页', class: 'primary-btn', onClick: () => {
                                this.hideModal();
                                openExternalUrl(releaseUrl);
                            }}
                        ]);
                    } else {
                        this.showModal('已是最新版本 ✨', '您的 MindSpace 已经是最新版本，无需更新。', [
                            { text: '好的', class: 'secondary-btn', onClick: () => this.hideModal() }
                        ]);
                    }
                } catch (err) {
                    console.error('检查更新失败', err);
                    if (icon) icon.style.animation = '';
                    this.showModal('检查更新提示', `
                        <p style="font-size: 0.9rem; line-height: 1.5;">在线检查失败（可能由于未发布正式 Release 或网络受限）。</p>
                        <p style="font-size: 0.8rem; color: var(--text-muted); margin-top: 6px;">您可以直接前往 GitHub 仓库发布页手动检查并下载最新的安装包。</p>
                    `, [
                        { text: '前往 GitHub 页面', class: 'primary-btn', onClick: () => {
                            this.hideModal();
                            openExternalUrl(RELEASES_URL);
                        }}
                    ]);
                }
            });
        }

        for (const id of ['modal-container', 'cloud-config-modal', 'auth-modal']) {
            const overlay = document.getElementById(id);
            overlay.querySelector('.modal-header button').onclick = () => this.closeOverlay(id);
            overlay.addEventListener('click', event => {
                if (event.target === overlay && this.overlays.at(-1)?.overlay === overlay) this.closeOverlay(id);
            });
        }
        document.addEventListener('keydown', event => this.handleOverlayKey(event));

        document.getElementById('sidebar-auth-btn').onclick = () => this.router.navigate('settings');
        document.getElementById('mobile-auth-btn').onclick = () => this.router.navigate('settings');
        document.getElementById('settings-auth-btn').onclick = () => this.openAuthModal();
        document.getElementById('btn-cloud-config').onclick = () => this.openConfigModal();
        document.getElementById('btn-forget-cloud').onclick = () => {
            this.showModal('移除云连接？', '<p>本机和云端日记都会保留。本机待同步的修改只会在重新登录原账户并开启同步后发送。</p>', [
                { text: '取消', onClick: () => this.hideModal() },
                { text: '移除连接', class: 'danger-btn', onClick: async () => {
                    try {
                        MindSpaceStorage.forgetSync(window.SupabaseService.getConfig().url);
                        window.SupabaseService.clearConfig({ clearSession: true });
                        await this.updateAuthUI();
                        this.hideModal();
                        this.showToast('云连接已移除');
                    } catch (error) {
                        this.showToast(error.message);
                    }
                }}
            ]);
        };
        document.getElementById('btn-sync-toggle').onclick = () => this.toggleSync();
        window.addEventListener('online', () => MindSpaceStorage.requestSync());
        document.addEventListener('mindspace:auth', event => this.applyAuthUser(event.detail));
        document.addEventListener('mindspace:sync', event => this.renderSyncState(event.detail));

        // --- Change Password Form Event Bindings ---
        const toggleChangePwdBtn = document.getElementById('btn-toggle-change-pwd');
        const cancelChangePwdBtn = document.getElementById('btn-cancel-change-pwd');
        const changePwdForm = document.getElementById('change-pwd-form');

        if (toggleChangePwdBtn) {
            toggleChangePwdBtn.addEventListener('click', () => {
                if (changePwdForm) changePwdForm.classList.remove('hidden');
                toggleChangePwdBtn.classList.add('hidden');
            });
        }

        if (cancelChangePwdBtn) {
            cancelChangePwdBtn.addEventListener('click', () => {
                if (changePwdForm) changePwdForm.classList.add('hidden');
                if (toggleChangePwdBtn) toggleChangePwdBtn.classList.remove('hidden');
                if (changePwdForm) this.clearFormErrors(changePwdForm);
                // Reset inputs
                document.getElementById('change-old-password').value = '';
                document.getElementById('change-new-password').value = '';
            });
        }

        if (changePwdForm) {
            changePwdForm.setAttribute('novalidate', 'novalidate');
            this.bindSoftValidation(changePwdForm);
            changePwdForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const oldPassword = document.getElementById('change-old-password').value;
                const newPassword = document.getElementById('change-new-password').value;

                this.clearFormErrors(changePwdForm);
                if (!oldPassword) {
                    this.setFieldError(document.getElementById('change-old-password'), '请输入当前密码。');
                    return;
                }
                if (newPassword.length < 6) {
                    this.setFieldError(document.getElementById('change-new-password'), '新密码至少需要 6 位。');
                    return;
                }

                try {
                    await window.SupabaseService.updatePassword(newPassword, oldPassword);
                    // Reset and collapse
                    document.getElementById('change-old-password').value = '';
                    document.getElementById('change-new-password').value = '';
                    this.clearFormErrors(changePwdForm);
                    if (changePwdForm) changePwdForm.classList.add('hidden');
                    if (toggleChangePwdBtn) toggleChangePwdBtn.classList.remove('hidden');

                    this.showModal('修改密码成功', '您的账户密码已成功更新。请妥善保管好您的新密码！', [
                        { text: '好的', class: 'secondary-btn', onClick: () => this.hideModal() }
                    ]);
                } catch (err) {
                    app.showModal('修改密码失败', '密码修改过程中发生了错误：' + escapeHTML(err.message), [
                        { text: '确定', class: 'secondary-btn', onClick: () => app.hideModal() }
                    ]);
                }
            });
        }

        // Config Save Button
        const saveConfigBtn = document.getElementById('btn-save-config');
        if (saveConfigBtn) {
            saveConfigBtn.addEventListener('click', () => {
                this.saveConfig();
            });
        }

        // Auth Tabs Toggle
        const loginTab = document.getElementById('tab-login');
        const registerTab = document.getElementById('tab-register');
        if (loginTab) {
            loginTab.addEventListener('click', () => this.switchAuthTab('login'));
        }
        if (registerTab) {
            registerTab.addEventListener('click', () => this.switchAuthTab('register'));
        }

        // Form Submissions
        const loginForm = document.getElementById('login-form');
        const registerForm = document.getElementById('register-form');
        if (loginForm) {
            loginForm.setAttribute('novalidate', 'novalidate');
            this.bindSoftValidation(loginForm);
            loginForm.addEventListener('submit', (e) => this.handleLogin(e));
        }
        if (registerForm) {
            registerForm.setAttribute('novalidate', 'novalidate');
            this.bindSoftValidation(registerForm);
            registerForm.addEventListener('submit', (e) => this.handleRegister(e));
        }

        // Sign Out Button
        const signOutBtn = document.getElementById('btn-sign-out');
        if (signOutBtn) {
            signOutBtn.addEventListener('click', () => this.handleSignOut());
        }

        // Sync Now Button
        const syncNowBtn = document.getElementById('btn-sync-now');
        if (syncNowBtn) {
            syncNowBtn.addEventListener('click', () => this.handleManualSync());
        }
    },

    async updateAuthUI() {
        const session = await window.SupabaseService.getSession();
        this.applyAuthUser(session?.user || null);
    },

    applyAuthUser(user) {
        this.currentUser = user;
        const scope = window.SupabaseService.scopeFor(user);
        try { MindSpaceStorage.setSyncSession(scope); }
        catch (error) { this.showToast(error.message); }
        this.renderSyncState();
    },

    renderSyncState(status) {
        const user = this.currentUser;
        const enabled = Boolean(MindSpaceStorage.activeScope);
        const configured = window.SupabaseService.isConfigured();
        const sidebar = document.getElementById('sidebar-auth-text');
        sidebar.textContent = enabled ? '云同步已开启' : '本地模式';
        for (const id of ['sidebar-auth-icon', 'mobile-auth-icon']) {
            document.getElementById(id).setAttribute('name', enabled ? 'cloud-done-outline' : 'shield-checkmark-outline');
        }
        const authButton = document.getElementById('settings-auth-btn');
        authButton.classList.toggle('hidden', !configured);
        authButton.querySelector('span').textContent = user ? '管理云账户' : '登录云账户';
        const toggle = document.getElementById('btn-sync-toggle');
        toggle.classList.toggle('hidden', !user);
        toggle.textContent = enabled ? '暂停自动同步' : '启用云同步';
        document.getElementById('btn-forget-cloud').classList.toggle('hidden', !window.SupabaseService.getConfig().url);
        const manual = document.getElementById('btn-sync-now');
        manual.classList.toggle('hidden', !enabled);
        manual.disabled = enabled && status === 'syncing';
        const description = document.getElementById('sync-card-desc');
        if (enabled) {
            const pending = MindSpaceStorage.pendingCount();
            description.textContent = status === 'syncing' ? '正在同步日记…'
                : pending ? `${pending} 项日记变更待同步。练习统计保留在本机。`
                : status === 'pending' ? '暂时无法同步，应用仍可在本机使用。'
                : '日记会同步到你的云账户。练习统计保留在本机。';
        } else {
            description.textContent = user ? '已登录。可选择是否将日记同步到这个云账户。' : '你可以连接自己的 Supabase 项目，在设备间同步日记。';
        }
        if (status === 'synced') this.refreshCurrentView();
    },

    openAuthModal() {
        if (!window.SupabaseService.isConfigured()) {
            this.openConfigModal();
            return;
        }
        const signedIn = Boolean(this.currentUser);
        document.getElementById('auth-modal-title').textContent = signedIn ? '云账户' : '登录云账户';
        document.getElementById('logged-in-state').classList.toggle('hidden', !signedIn);
        document.querySelector('.auth-tabs').classList.toggle('hidden', signedIn);
        if (signedIn) {
            document.getElementById('login-form').classList.add('hidden');
            document.getElementById('register-form').classList.add('hidden');
            document.getElementById('user-display-email').textContent = this.currentUser.email;
        } else this.switchAuthTab('login');
        this.showOverlay('auth-modal');
    },

    openConfigModal() {
        const { url, anonKey } = window.SupabaseService.getConfig();
        document.getElementById('config-url').value = url;
        document.getElementById('config-anon-key').value = anonKey;
        document.getElementById('config-error').textContent = '';
        this.showOverlay('cloud-config-modal');
    },

    /**
     * Switch tabs in Auth Modal
     */
    switchAuthTab(tab) {
        const loginForm = document.getElementById('login-form');
        const registerForm = document.getElementById('register-form');
        const tabLogin = document.getElementById('tab-login');
        const tabRegister = document.getElementById('tab-register');
        if (loginForm) this.clearFormErrors(loginForm);
        if (registerForm) this.clearFormErrors(registerForm);

        if (tab === 'login') {
            if (loginForm) loginForm.classList.remove('hidden');
            if (registerForm) registerForm.classList.add('hidden');
            if (tabLogin) tabLogin.classList.add('active');
            if (tabRegister) tabRegister.classList.remove('active');
        } else {
            if (loginForm) loginForm.classList.add('hidden');
            if (registerForm) registerForm.classList.remove('hidden');
            if (tabLogin) tabLogin.classList.remove('active');
            if (tabRegister) tabRegister.classList.add('active');
        }
    },

    bindSoftValidation(form) {
        form.querySelectorAll('input, textarea').forEach(field => {
            field.addEventListener('input', () => this.clearFieldError(field));
            field.addEventListener('blur', () => {
                if (field.value.trim()) {
                    this.clearFieldError(field);
                }
            });
        });
    },

    getFieldErrorElement(field) {
        if (!field) return null;
        const describedBy = field.getAttribute('aria-describedby');
        if (describedBy) {
            return document.getElementById(describedBy.split(/\s+/)[0]);
        }
        return document.getElementById(`${field.id}-error`);
    },

    setFieldError(field, message) {
        if (!field) return;
        const group = field.closest('.form-group');
        const error = this.getFieldErrorElement(field);
        if (group) group.classList.add('has-error');
        field.setAttribute('aria-invalid', 'true');
        if (error) {
            error.textContent = message;
            error.classList.add('active');
        }
        field.focus({ preventScroll: true });
        field.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    },

    clearFieldError(field) {
        if (!field) return;
        const group = field.closest('.form-group');
        const error = this.getFieldErrorElement(field);
        if (group) group.classList.remove('has-error');
        field.removeAttribute('aria-invalid');
        if (error) {
            error.textContent = '';
            error.classList.remove('active');
        }
    },

    clearFormErrors(form) {
        if (!form) return;
        form.querySelectorAll('input, textarea').forEach(field => this.clearFieldError(field));
    },

    isValidEmail(email) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    },

    validateAuthForm(form, mode) {
        if (!form) return false;
        this.clearFormErrors(form);

        const emailInput = form.querySelector('input[type="email"]');
        const passwordInput = form.querySelector('input[type="password"]');
        const email = emailInput ? emailInput.value.trim() : '';
        const password = passwordInput ? passwordInput.value : '';

        if (!email) {
            this.setFieldError(emailInput, '请输入邮箱地址。');
            return false;
        }
        if (!this.isValidEmail(email)) {
            this.setFieldError(emailInput, '请输入有效的邮箱地址。');
            return false;
        }
        if (!password) {
            this.setFieldError(passwordInput, mode === 'register' ? '请设置登录密码。' : '请输入账户密码。');
            return false;
        }
        if (password.length < 6) {
            this.setFieldError(passwordInput, '密码至少需要 6 位。');
            return false;
        }
        return true;
    },

    /**
     * Save configuration fields
     */
    async saveConfig() {
        const url = document.getElementById('config-url').value.trim();
        const key = document.getElementById('config-anon-key').value.trim();
        const button = document.getElementById('btn-save-config');
        const status = document.getElementById('config-error');
        button.disabled = true;
        status.textContent = '';
        try {
            if (!url || !key) throw new Error('请输入项目地址和公钥。');
            if (!await window.SupabaseService.saveConfig(url, key)) return;
            MindSpaceStorage.setSyncSession(null);
            this.closeOverlay('cloud-config-modal');
            await this.updateAuthUI();
            this.openAuthModal();
        } catch (error) {
            status.textContent = error.message;
        } finally {
            button.disabled = false;
        }
    },

    handleLogin(event) {
        return this.submitAuth(event, 'login');
    },

    handleRegister(event) {
        return this.submitAuth(event, 'register');
    },

    async submitAuth(event, mode) {
        event.preventDefault();
        const form = event.currentTarget;
        if (!this.validateAuthForm(form, mode)) return;
        const register = mode === 'register';
        const prefix = register ? 'reg' : 'login';
        const email = document.getElementById(`${prefix}-email`).value.trim();
        const password = document.getElementById(`${prefix}-password`);
        const button = form.querySelector('[type="submit"]');
        if (button.disabled) return;
        button.disabled = true;
        try {
            const service = window.SupabaseService;
            const data = register ? await service.signUp(email, password.value) : await service.signIn(email, password.value);
            password.value = '';
            this.closeOverlay('auth-modal');
            await this.updateAuthUI();
            this.showToast(register && !data.session ? '请打开邮箱确认账户，然后登录。' : '已登录云账户');
        } catch (error) {
            this.setFieldError(password, error.code === 'email_not_confirmed' ? '请先打开邮箱确认账户。' : error.message);
        } finally {
            button.disabled = false;
        }
    },

    async handleSignOut() {
        try {
            await window.SupabaseService.signOut();
            this.closeOverlay('auth-modal');
            await this.updateAuthUI();
            this.showToast('已退出云账户，本机数据已保留');
        } catch (error) {
            this.showToast(error.message);
        }
    },

    toggleSync() {
        const scope = window.SupabaseService.scopeFor(this.currentUser);
        if (MindSpaceStorage.activeScope) {
            MindSpaceStorage.pauseSync(scope);
            this.renderSyncState();
            this.showToast('已暂停自动同步');
            return;
        }
        const account = escapeHTML(this.currentUser?.email || '');
        const destination = account ? `云账户 <strong>${account}</strong>` : '当前云账户';
        this.showModal('开启云同步', `<p>开启后，新日记会上传至${destination}。也可以一并上传尚未同步的本机日记。</p>
            <label class="option-toggle sync-consent"><input type="checkbox" id="sync-include-local"><span class="toggle-slider"></span><span>上传现有本机日记</span></label>`, [
            { text: '取消', onClick: () => this.hideModal() },
            { text: '启用同步', class: 'primary-btn', onClick: async () => {
                const includeLocal = document.getElementById('sync-include-local').checked;
                this.hideModal();
                try {
                    await MindSpaceStorage.enableSync(includeLocal, scope);
                    this.renderSyncState('synced');
                    this.showToast('云同步已开启');
                } catch (error) {
                    this.renderSyncState('pending');
                    this.showToast(error.message);
                }
            }}
        ]);
    },

    async handleManualSync() {
        try {
            await MindSpaceStorage.syncLocalToCloud();
            this.showToast('日记已同步');
        } catch (error) {
            this.renderSyncState('pending');
            this.showToast(error.message);
        }
    },

    showModal(title, bodyHtml, actions = []) {
        document.getElementById('modal-title').textContent = title;
        document.getElementById('modal-body').innerHTML = bodyHtml;
        document.getElementById('modal-actions').replaceChildren(...actions.map(action => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = action.class || 'secondary-btn';
            button.textContent = action.text;
            button.addEventListener('click', action.onClick);
            return button;
        }));
        this.showOverlay('modal-container');
    },

    hideModal() {
        this.closeOverlay('modal-container');
    },

    showOverlay(id) {
        const overlay = document.getElementById(id);
        if (this.overlays.at(-1)?.overlay !== overlay) {
            this.overlays.push({ overlay, previousFocus: document.activeElement });
        }
        overlay.classList.remove('hidden');
        this.updateOverlays();
        const heading = overlay.querySelector('.modal-header h3');
        heading.tabIndex = -1;
        heading.focus({ preventScroll: true });
    },

    closeOverlay(id) {
        const index = this.overlays.findIndex(item => item.overlay.id === id);
        if (index < 0) return;
        const wasTop = index === this.overlays.length - 1;
        const [{ overlay, previousFocus }] = this.overlays.splice(index, 1);
        overlay.classList.add('hidden');
        overlay.inert = false;
        overlay.style.removeProperty('z-index');
        this.updateOverlays();
        if (wasTop && previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    },

    updateOverlays() {
        document.getElementById('app-container').inert = Boolean(this.overlays.length);
        this.overlays.forEach(({ overlay }, index) => {
            overlay.inert = index !== this.overlays.length - 1;
            overlay.style.zIndex = 10 + index;
        });
    },

    handleOverlayKey(event) {
        const top = this.overlays.at(-1)?.overlay;
        if (!top) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            this.closeOverlay(top.id);
            return;
        }
        if (event.key !== 'Tab') return;
        const focusable = [...top.querySelectorAll('a[href], button, input, textarea, select')]
            .filter(element => !element.disabled && element.getClientRects().length);
        const first = focusable[0];
        const last = focusable.at(-1);
        if (event.shiftKey && (document.activeElement === first || !focusable.includes(document.activeElement))) {
            event.preventDefault();
            last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
        }
    }
};

/**
 * Escapes HTML helper to prevent XSS in local logs
 */
function escapeHTML(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function compareVersions(left, right) {
    const parse = (version) => String(version)
        .trim()
        .replace(/^v/i, '')
        .split(/[.+-]/)
        .slice(0, 3)
        .map((part) => Number.parseInt(part, 10) || 0);
    const leftParts = parse(left);
    const rightParts = parse(right);

    for (let index = 0; index < 3; index += 1) {
        if (leftParts[index] !== rightParts[index]) {
            return leftParts[index] > rightParts[index] ? 1 : -1;
        }
    }
    return 0;
}

function safeGitHubUrl(value) {
    try {
        const url = new URL(String(value));
        if (url.protocol === 'https:' && (url.hostname === 'github.com' || url.hostname === 'objects.githubusercontent.com')) {
            return url.toString();
        }
    } catch {
        return null;
    }
    return null;
}

function openExternalUrl(value) {
    const url = safeGitHubUrl(value) || RELEASES_URL;
    window.open(url, '_blank', 'noopener,noreferrer');
}

// Launch app when DOM is fully ready
document.addEventListener('DOMContentLoaded', () => {
    app.init();
});
