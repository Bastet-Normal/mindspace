const MindSpaceStorage = {
    KEY: 'mindspace_library_v2',
    KEYS: {
        LOGS: 'mindspace_mood_logs',
        SETTINGS: 'mindspace_user_settings',
        STATS: 'mindspace_daily_stats',
        HISTORY: 'mindspace_stats_history'
    },

    DEFAULT_SETTINGS: {
        userName: '旅人',
        theme: null,
        journalFont: null,
        customTags: ['疲惫', '焦虑', '平静', '喜悦', '心累', '感恩', '成长', '人际']
    },

    WEATHER_MAP: {
        sunny: { name: '晴朗', emoji: '☀️' },
        breezy: { name: '微风', emoji: '🍃' },
        cloudy: { name: '阴天', emoji: '☁️' },
        foggy: { name: '大雾', emoji: '🌫️' },
        rainy: { name: '小雨', emoji: '🌧️' },
        stormy: { name: '雷雨', emoji: '⛈️' }
    },

    UUID: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    DATE: /^\d{4}-\d{2}-\d{2}$/,
    JOURNAL_FONTS: ['system', 'song', 'kai', 'fangsong', 'xihei', 'ipaex'],
    activeScope: null,
    activeConsent: null,
    sessionScope: undefined,
    syncGeneration: 0,
    inFlight: null,
    inFlightGeneration: null,
    retryTimer: null,
    retryFailures: 0,

    generateUUID() {
        if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
        const bytes = new Uint8Array(16);
        if (globalThis.crypto?.getRandomValues) crypto.getRandomValues(bytes);
        else bytes.forEach((_, index) => { bytes[index] = Math.floor(Math.random() * 256); });
        bytes[6] = (bytes[6] & 15) | 64;
        bytes[8] = (bytes[8] & 63) | 128;
        const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
        return this.formatUUID(hex);
    },

    formatUUID(hex) {
        return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    },

    logId(id) {
        if (this.UUID.test(id)) return id.toLowerCase();
        // Keep old local identifiers stable across upgrades and repeat imports.
        const hex = [0, 1, 2, 3].map(salt => {
            let hash = 2166136261;
            for (const character of `${salt}:${id}`) {
                hash = Math.imul(hash ^ character.codePointAt(0), 16777619);
            }
            return (hash >>> 0).toString(16).padStart(8, '0');
        }).join('');
        return this.formatUUID(`${hex.slice(0, 12)}5${hex.slice(13, 16)}a${hex.slice(17)}`);
    },

    readLegacy(key, fallback) {
        try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
        catch { return fallback; }
    },

    moods(value) {
        const choices = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
        if (choices.length > 2 || new Set(choices).size !== choices.length ||
            [...choices].some(key => typeof key !== 'string' || !Object.hasOwn(this.WEATHER_MAP, key))) return [];
        return choices;
    },

    moodName(value) {
        return this.moods(value).map(key => this.WEATHER_MAP[key].name).join('、');
    },

    moodWeights(logs) {
        const weights = Object.fromEntries(Object.keys(this.WEATHER_MAP).map(key => [key, 0]));
        for (const log of logs) {
            const moods = this.moods(log.weather);
            for (const mood of moods) weights[mood] += 1 / moods.length;
        }
        return Object.entries(weights).filter(([, weight]) => weight > 0).sort(([, a], [, b]) => b - a);
    },

    normalizeLog(log) {
        if (!log || typeof log.id !== 'string' || !log.id || log.id.length > 200) return null;
        const moods = this.moods(log.weather);
        if (!moods.length) return null;
        const value = log.timestamp;
        const timestamp = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
        if (!Number.isSafeInteger(timestamp) || timestamp < 0 || timestamp > 8640000000000000) return null;
        const note = typeof log.note === 'string' ? log.note : '';
        const fontRuns = this.normalizeFontRuns(log.fontRuns ?? log.font_runs, note.length);
        return {
            id: this.logId(log.id),
            timestamp,
            weather: moods.join(','),
            tags: this.normalizeTags(log.tags),
            note,
            ...(fontRuns.length ? { fontRuns } : {})
        };
    },

    normalizeFontRuns(runs, length) {
        if (!Array.isArray(runs)) return [];
        const result = [];
        for (const run of runs) {
            if (!Number.isInteger(run?.start) || run.start < 0 || run.start >= length ||
                !this.JOURNAL_FONTS.includes(run.font)) continue;
            const previous = result.at(-1);
            if (!previous && run.start !== 0) continue;
            if (previous && (run.start <= previous.start || run.font === previous.font)) continue;
            result.push({ start: run.start, font: run.font });
        }
        return result;
    },

    trimmedNote(text, runs) {
        const note = text.trim();
        const offset = text.length - text.trimStart().length;
        const fontRuns = [];
        for (const run of this.normalizeFontRuns(runs, text.length)) {
            if (run.start >= offset + note.length) break;
            if (run.start <= offset) fontRuns.length = 0;
            fontRuns.push({ start: Math.max(0, run.start - offset), font: run.font });
        }
        return { note, fontRuns };
    },

    normalizeTags(tags) {
        return Array.isArray(tags)
            ? [...new Set(tags.filter(tag => typeof tag === 'string' && tag.trim()).map(tag => tag.trim()))]
            : [];
    },

    normalizeSettings(settings) {
        const value = settings && typeof settings === 'object' ? settings : {};
        return {
            userName: typeof value.userName === 'string' && value.userName.trim() ? value.userName.trim() : this.DEFAULT_SETTINGS.userName,
            theme: ['light', 'dark'].includes(value.theme) ? value.theme : null,
            journalFont: this.JOURNAL_FONTS.includes(value.journalFont) ? value.journalFont : this.DEFAULT_SETTINGS.journalFont,
            customTags: this.normalizeTags(value.customTags ?? this.DEFAULT_SETTINGS.customTags)
        };
    },

    isRecord(value) {
        return !!value && typeof value === 'object' && !Array.isArray(value);
    },

    normalizeHistory(history) {
        if (!this.isRecord(history)) return {};
        return Object.fromEntries(Object.entries(history)
            .filter(([date, value]) => this.DATE.test(date) && value && typeof value === 'object')
            .map(([date, value]) => [date, {
                breathingSeconds: this.validSeconds(value.breathingSeconds),
                focusSeconds: this.validSeconds(value.focusSeconds)
            }]));
    },

    validSeconds(value) {
        return Number.isSafeInteger(value) && value > 0 ? Math.min(value, 86400) : 0;
    },

    mergeDay(a = {}, b = {}) {
        return {
            breathingSeconds: Math.max(a.breathingSeconds || 0, b.breathingSeconds || 0),
            focusSeconds: Math.max(a.focusSeconds || 0, b.focusSeconds || 0)
        };
    },

    fromLegacy(rawLogs) {
        const settings = this.normalizeSettings(this.readLegacy(this.KEYS.SETTINGS, {}));
        const history = this.normalizeHistory(this.readLegacy(this.KEYS.HISTORY, {}));
        const today = this.readLegacy(this.KEYS.STATS, {});
        if (this.DATE.test(today.date)) {
            const day = this.normalizeHistory({ [today.date]: today })[today.date];
            history[today.date] = this.mergeDay(history[today.date], day);
        }
        const source = this.generateUUID();
        return {
            version: 2, source, settings, history: { [source]: history },
            logs: Array.isArray(rawLogs) ? rawLogs.map(log => this.normalizeLog(log)).filter(Boolean) : [],
            owners: {}, pending: {}, consents: {}
        };
    },

    read() {
        const data = localStorage.getItem(this.KEY);
        if (data == null) {
            const rawLogs = this.readLegacy(this.KEYS.LOGS, null);
            const state = this.fromLegacy(rawLogs);
            this.write(state);

            for (const [kind, key] of Object.entries(this.KEYS)) {
                const parsed = kind === 'LOGS' ? rawLogs : this.readLegacy(key, null);
                const migrated = kind === 'LOGS'
                    ? Array.isArray(parsed) && parsed.length === state.logs.length
                    : this.isRecord(parsed);
                if (migrated) {
                    try { localStorage.removeItem(key); }
                    catch { /* The migrated library has been committed successfully. */ }
                }
            }
            return state;
        }
        try {
            const state = JSON.parse(data);
            if (state.version !== 2 || !this.UUID.test(state.source) || !Array.isArray(state.logs) ||
                ![state.owners, state.pending, state.history, state.consents, state.settings].every(value => this.isRecord(value))) {
                throw new Error();
            }
            return state;
        } catch {
            throw new Error('本机记录无法读取，原始数据仍保留。');
        }
    },

    write(state) {
        try { localStorage.setItem(this.KEY, JSON.stringify(state)); }
        catch { throw new Error('无法写入本机存储。请先备份，再检查剩余空间。'); }
    },

    getSettings() {
        try { return this.normalizeSettings(this.read().settings); }
        catch { return this.normalizeSettings({}); }
    },

    saveSettings(settings) {
        const state = this.read();
        state.settings = this.normalizeSettings(settings);
        this.write(state);
    },

    getLogs() {
        try {
            return this.read().logs.map(log => this.normalizeLog(log)).filter(Boolean).sort((a, b) => b.timestamp - a.timestamp);
        } catch { return []; }
    },

    saveLog(weather, tags = [], note = '', timestamp = Date.now(), fontRuns) {
        return this.putLog({ id: this.generateUUID(), timestamp, weather, tags, ...this.trimmedNote(note, fontRuns) }, 'create');
    },

    updateLog(id, weather, tags = [], note = '', { expected, timestamp, fontRuns } = {}) {
        const original = this.getLogs().find(log => log.id === id);
        const body = this.trimmedNote(note, fontRuns ?? (original?.note === note ? original.fontRuns : undefined));
        if (expected && (!original || !this.sameLog(expected, original))) {
            return this.putLog({ id: this.generateUUID(), timestamp: timestamp ?? expected.timestamp, weather, tags, ...body }, 'create', null);
        }
        if (!original) throw new Error('这条记录已经不存在。');
        return this.putLog({ ...original, timestamp: timestamp ?? original.timestamp, weather, tags, ...body }, 'update');
    },

    putLog(input, action, owner) {
        const log = this.normalizeLog(input);
        if (!log) throw new Error('记录格式有误。');
        const state = this.read();
        const index = state.logs.findIndex(item => item.id === log.id);
        const previous = state.logs[index];
        if (index < 0) state.logs.push(log);
        else state.logs[index] = log;
        const createScope = action === 'create' && this.activeScope &&
            state.consents[this.activeScope] === this.activeConsent ? this.activeScope : null;
        const scope = state.owners[log.id] || (owner === undefined ? createScope : owner);
        if (scope) {
            state.owners[log.id] = scope;
            const pending = state.pending[log.id];
            const next = ['create', 'adopt'].includes(pending?.action) ? 'create' : action;
            this.queue(state, log.id, scope, next, pending ? pending.base : previous);
        }
        this.write(state);
        this.requestSync();
        return log;
    },

    deleteLog(id) {
        const state = this.read();
        const log = state.logs.find(item => item.id === id);
        if (!log) return null;
        const scope = state.owners[id] || null;
        state.logs = state.logs.filter(item => item.id !== id);
        if (scope) this.queue(state, id, scope, 'delete', state.pending[id]?.base || log);
        delete state.owners[id];
        this.write(state);
        this.requestSync();
        return { log, scope };
    },

    restoreLog(deleted) {
        return this.putLog(deleted.log, 'create', deleted.scope);
    },

    queue(state, id, scope, action, base) {
        state.pending[id] = { id, scope, action, revision: this.generateUUID() };
        if (base && (action === 'update' || action === 'delete')) state.pending[id].base = base;
    },

    async enableSync(includeLocal, expectedScope = this.sessionScope) {
        const generation = this.syncGeneration;
        const connection = await window.SupabaseService.connect();
        if (generation !== this.syncGeneration || (expectedScope !== undefined && connection.scope !== expectedScope)) {
            throw new Error('云账户已切换，请重新确认同步设置。');
        }

        const state = this.read();
        const consent = this.generateUUID();
        state.consents[connection.scope] = consent;
        if (includeLocal) {
            for (const log of state.logs) {
                if (state.owners[log.id] || state.pending[log.id]) continue;
                state.owners[log.id] = connection.scope;
                this.queue(state, log.id, connection.scope, 'adopt');
            }
        }
        this.write(state);
        this.sessionScope = connection.scope;
        this.changeActiveScope(connection.scope, consent);
        return this.syncLocalToCloud();
    },

    setSyncSession(scope) {
        const changed = scope !== this.sessionScope;
        this.sessionScope = scope;
        let consent;
        try { consent = scope ? this.read().consents[scope] : null; }
        catch (error) {
            this.changeActiveScope(null);
            throw error;
        }
        const next = consent === true || (typeof consent === 'string' && this.UUID.test(consent)) ? scope : null;
        if (changed || next !== this.activeScope || (next && consent !== this.activeConsent)) {
            this.changeActiveScope(next, next ? consent : null);
            this.requestSync();
        }
        return this.activeScope;
    },

    changeActiveScope(scope, consent = null) {
        this.activeScope = scope;
        this.activeConsent = consent;
        this.syncGeneration++;
        this.stopRetry();
        this.retryFailures = 0;
    },

    pauseSync(scope) {
        if (scope) {
            const state = this.read();
            delete state.consents[scope];
            this.write(state);
        }
        this.changeActiveScope(null);
    },

    forgetSync(projectUrl) {
        const state = this.read();
        const prefix = new URL(projectUrl).origin + '|';
        for (const scope of Object.keys(state.consents)) {
            if (scope.startsWith(prefix)) delete state.consents[scope];
        }
        // Retain account ownership and offline changes for an explicit reconnection.
        this.write(state);
        this.sessionScope = null;
        this.changeActiveScope(null);
    },

    pendingCount() {
        return this.activeScope
            ? Object.values(this.read().pending).filter(item => item.scope === this.activeScope).length
            : 0;
    },

    requestSync() {
        if (this.activeScope) this.syncLocalToCloud().catch(() => {});
    },

    reportSync(status, type = 'mindspace:sync') {
        if (typeof document !== 'undefined') {
            document.dispatchEvent(new CustomEvent(type, { detail: status }));
        }
    },

    isCurrentSync(scope, generation) {
        return scope === this.activeScope && generation === this.syncGeneration;
    },

    assertCurrentSync(scope, generation) {
        if (!this.isCurrentSync(scope, generation) || this.read().consents[scope] !== this.activeConsent) {
            throw new Error('同步设置已变更，请重试。');
        }
    },

    stopRetry() {
        if (this.retryTimer !== null) globalThis.clearTimeout?.(this.retryTimer);
        this.retryTimer = null;
    },

    scheduleRetry(error, scope, generation) {
        if (!(error?.retryable || error instanceof TypeError) || this.retryTimer !== null) return;
        const delay = Math.min(120000, 5000 * (2 ** Math.min(this.retryFailures++, 5)));
        this.retryTimer = setTimeout(() => {
            this.retryTimer = null;
            if (this.isCurrentSync(scope, generation) && globalThis.navigator?.onLine !== false) this.requestSync();
        }, delay);
    },

    async syncLocalToCloud() {
        const scope = this.activeScope;
        const generation = this.syncGeneration;
        if (!scope) throw new Error('请先登录并启用同步。');

        if (this.inFlight) {
            if (this.inFlightGeneration === generation) return this.inFlight;
            await this.inFlight.catch(() => {});
            this.assertCurrentSync(scope, generation);
            return this.syncLocalToCloud();
        }

        this.stopRetry();
        const locks = globalThis.navigator?.locks;
        const work = () => this.performSync(scope, generation);
        const job = locks ? locks.request(`${this.KEY}:sync`, work) : work();
        this.inFlightGeneration = generation;
        this.inFlight = job;
        try {
            const logs = await job;
            this.assertCurrentSync(scope, generation);
            this.retryFailures = 0;
            const pending = this.pendingCount();
            this.reportSync(pending ? 'pending' : 'synced');
            if (pending) setTimeout(() => {
                if (this.isCurrentSync(scope, generation)) this.requestSync();
            }, 0);
            return logs;
        } catch (error) {
            if (this.isCurrentSync(scope, generation)) {
                this.reportSync('pending');
                this.scheduleRetry(error, scope, generation);
            }
            throw error;
        } finally {
            if (this.inFlight === job) {
                this.inFlight = null;
                this.inFlightGeneration = null;
            }
        }
    },

    async performSync(scope, generation) {
        this.assertCurrentSync(scope, generation);
        const connection = await window.SupabaseService.connect();
        this.assertCurrentSync(scope, generation);
        if (connection.scope !== scope) throw new Error('云账户已切换。');
        this.reportSync('syncing');

        const acknowledged = [];
        const operations = Object.values(this.read().pending).filter(operation => operation.scope === scope);
        try {
            for (const operation of operations) {
                this.assertCurrentSync(scope, generation);
                const latest = this.read();
                if (latest.pending[operation.id]?.revision !== operation.revision) continue;

                let preserveLocal = false;
                const log = latest.logs.find(item => item.id === operation.id);
                if (operation.action === 'delete') {
                    preserveLocal = await connection.deleteLog(operation.id, operation.base) === false;
                } else if (log && operation.action === 'update') {
                    preserveLocal = await connection.updateLog(log, operation.base) === false;
                } else if (log) {
                    const inserted = await connection.createLog(log);
                    if (inserted === false) {
                        this.assertCurrentSync(scope, generation);
                        const cloud = this.normalizeLog(await connection.fetchLog(log.id));
                        preserveLocal = !cloud || !this.sameLog(log, cloud);
                    }
                } else {
                    throw new Error('找不到待上传的日记。');
                }
                acknowledged.push({ operation, preserveLocal, sent: log });
            }
        } finally {
            if (acknowledged.length && this.isCurrentSync(scope, generation)) {
                this.acknowledge(scope, this.activeConsent, acknowledged);
            }
        }

        this.assertCurrentSync(scope, generation);
        const remote = await connection.fetchLogs();
        this.assertCurrentSync(scope, generation);
        const cloudLogs = new Map();
        for (const entry of remote) {
            const log = this.normalizeLog(entry);
            if (!log || cloudLogs.has(log.id)) throw new Error('云端日记格式有误，本机日记已保留。');
            cloudLogs.set(log.id, log);
        }

        // A pull may complete after another local edit. Merge against the latest library.
        const state = this.read();
        const merged = new Map();
        for (const log of state.logs) {
            const owner = state.owners[log.id];
            if (owner !== scope || state.pending[log.id]) merged.set(log.id, log);
            else if (!cloudLogs.has(log.id)) delete state.owners[log.id];
        }
        for (const [id, log] of cloudLogs) {
            if (state.pending[id] || (state.owners[id] && state.owners[id] !== scope)) continue;
            if (merged.has(id) && !state.owners[id]) continue;
            merged.set(id, log);
            state.owners[id] = scope;
        }
        state.logs = [...merged.values()];
        this.write(state);
        return this.getLogs();
    },

    sameLog(a, b) {
        return a.timestamp === b.timestamp && a.weather === b.weather && a.note === b.note &&
            JSON.stringify(a.fontRuns ?? []) === JSON.stringify(b.fontRuns ?? []) &&
            a.tags.length === b.tags.length && a.tags.every((tag, index) => tag === b.tags[index]);
    },

    acknowledge(scope, consent, results) {
        const state = this.read();
        if (state.consents[scope] !== consent) return;
        let conflicts = 0;
        let deleteConflicts = 0;
        for (const { operation, preserveLocal, sent } of results) {
            const { id, action } = operation;
            const pending = state.pending[id];
            if (!pending || scope !== pending.scope) continue;
            const sameRevision = pending.revision === operation.revision;
            if (preserveLocal && pending.action !== 'delete' &&
                (action !== 'update' || pending.action === 'update')) {
                const index = state.logs.findIndex(log => log.id === id);
                if (index >= 0) {
                    state.logs[index] = { ...state.logs[index], id: this.generateUUID() };
                    delete state.owners[id];
                    delete state.pending[id];
                    conflicts++;
                }
            } else if (sameRevision) {
                delete state.pending[id];
                if (preserveLocal && action === 'delete') deleteConflicts++;
            } else if (!preserveLocal && sent && action !== 'delete') {
                if (pending.action === 'create') pending.action = 'update';
                if (pending.action === 'update' || pending.action === 'delete') pending.base = sent;
            }
        }
        this.write(state);
        if (conflicts) this.reportSync(conflicts, 'mindspace:sync-conflicts');
        if (deleteConflicts) this.reportSync(deleteConflicts, 'mindspace:delete-conflicts');
    },

    clearAllData() {
        this.sessionScope = null;
        this.changeActiveScope(null);
        for (const key of Object.values(this.KEYS)) localStorage.removeItem(key);
        localStorage.removeItem(this.KEY);
        this.clearDraft();
    },

    clearDraft() {
        if (typeof sessionStorage === 'undefined') return;
        try {
            sessionStorage.removeItem('mindspace_weather_draft');
            for (const key of Object.keys(sessionStorage)) {
                if (key.startsWith('mindspace_weather_edit:')) sessionStorage.removeItem(key);
            }
        }
        catch { /* Session storage may be disabled. */ }
    },

    dateKey(date = new Date()) {
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    },

    formatDate(timestamp) {
        const date = new Date(timestamp);
        return `${this.dateKey(date)} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    },

    aggregateHistory(sources) {
        const result = {};
        for (const source of Object.values(sources)) {
            for (const [date, value] of Object.entries(source)) {
                result[date] ||= { breathingSeconds: 0, focusSeconds: 0 };
                result[date].breathingSeconds += value.breathingSeconds;
                result[date].focusSeconds += value.focusSeconds;
            }
        }
        return result;
    },

    getHistoryStats() {
        try { return this.aggregateHistory(this.read().history); }
        catch { return {}; }
    },

    getTodayStats() {
        const date = this.dateKey();
        return { date, ...(this.getHistoryStats()[date] || { breathingSeconds: 0, focusSeconds: 0 }) };
    },

    getCumulativeStats() {
        const history = this.getHistoryStats();
        const totals = Object.values(history).reduce((sum, day) => ({
            breathing: sum.breathing + day.breathingSeconds,
            focus: sum.focus + day.focusSeconds
        }), { breathing: 0, focus: 0 });

        const active = date => {
            const day = history[this.dateKey(date)];
            return day && day.breathingSeconds + day.focusSeconds > 0;
        };
        const date = new Date();
        if (!active(date)) date.setDate(date.getDate() - 1);
        let streak = 0;
        while (active(date)) {
            streak++;
            date.setDate(date.getDate() - 1);
        }
        return { totalBreathingMinutes: Math.round(totals.breathing / 60), totalFocusMinutes: Math.round(totals.focus / 60), streak };
    },

    accumulatePracticeTime(state, key, seconds, endedAt) {
        const history = state.history[state.source] ||= {};
        let cursor = endedAt - seconds * 1000;
        while (seconds > 0) {
            const day = new Date(cursor);
            const keyOfDay = this.dateKey(day);
            day.setHours(24, 0, 0, 0);
            const boundary = day.getTime();
            const chunk = Number.isFinite(boundary) ? Math.min(seconds, Math.ceil((boundary - cursor) / 1000)) : seconds;
            history[keyOfDay] ||= { breathingSeconds: 0, focusSeconds: 0 };
            history[keyOfDay][key] += chunk;
            cursor += chunk * 1000;
            seconds -= chunk;
        }
    },

    addPracticeTime(key, seconds, endedAt = Date.now()) {
        if (!Number.isSafeInteger(seconds) || seconds <= 0 ||
            !Number.isFinite(new Date(endedAt).getTime()) ||
            !Number.isFinite(new Date(endedAt - seconds * 1000).getTime())) return;
        const state = this.read();
        this.accumulatePracticeTime(state, key, seconds, endedAt);
        this.write(state);
    },

    checkpointFocus(runId, elapsedSeconds, startedAt) {
        const endedAt = startedAt + elapsedSeconds * 1000;
        if (typeof runId !== 'string' || !this.UUID.test(runId) ||
            !Number.isSafeInteger(elapsedSeconds) || elapsedSeconds < 0 ||
            !Number.isSafeInteger(startedAt) || !Number.isFinite(new Date(startedAt).getTime()) ||
            !Number.isFinite(new Date(endedAt).getTime())) {
            throw new Error('无法记录这次专注的进度。');
        }

        const state = this.read();
        const receipts = state.focusReceipts ||= {};
        const receipt = receipts[runId];
        if (receipt && receipt.startedAt !== startedAt) throw new Error('专注记录与本次计时不匹配。');
        const previous = receipt?.elapsedSeconds || 0;
        if (elapsedSeconds <= previous) return previous;

        this.accumulatePracticeTime(state, 'focusSeconds', elapsedSeconds - previous, endedAt);
        // Keep recent checkpoints on this device so a resumed timer can safely retry.
        if (receipt) delete receipts[runId];
        receipts[runId] = { startedAt, elapsedSeconds };
        const ids = Object.keys(receipts);
        for (const oldId of ids.slice(0, Math.max(0, ids.length - 64))) delete receipts[oldId];
        this.write(state);
        return elapsedSeconds;
    },

    addBreathingTime(seconds, endedAt) {
        this.addPracticeTime('breathingSeconds', seconds, endedAt);
    },

    addFocusTime(seconds, endedAt) {
        this.addPracticeTime('focusSeconds', seconds, endedAt);
    },

    download(content, type, filename) {
        const url = URL.createObjectURL(new Blob([content], { type }));
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
    },

    exportToMarkdown() {
        const state = this.read();
        const entries = [...state.logs].sort((a, b) => b.timestamp - a.timestamp).map(log => {
            const labels = log.tags.length ? `\n标签 · ${log.tags.join('、')}` : '';
            return `## ${this.formatDate(log.timestamp)} · ${this.moodName(log.weather)}${labels}\n\n${log.note || '仅记录了心情。'}`;
        });
        this.download(`# MindSpace 心情日记\n\n${entries.join('\n\n---\n\n')}`, 'text/markdown;charset=utf-8', `MindSpace-${this.dateKey()}.md`);
    },

    exportToJSON() {
        const state = this.read();
        const backup = {
            version: 2,
            exportedAt: Date.now(),
            logs: state.logs,
            settings: state.settings,
            practice: state.history
        };
        this.download(JSON.stringify(backup, null, 2), 'application/json;charset=utf-8', `MindSpace-${this.dateKey()}.json`);
    },

    previewImport(jsonString) {
        let value;
        try { value = JSON.parse(jsonString); }
        catch { throw new Error('无法读取 JSON 备份。'); }
        if (!value || !Array.isArray(value.logs) || ![2, '1.0.0'].includes(value.version)) {
            throw new Error('请选择 MindSpace 导出的备份文件。');
        }
        const logs = value.logs.map(log => this.normalizeLog(log));
        if (logs.some(log => !log)) throw new Error('备份里有格式不正确的日记，尚未导入。');
        const practice = value.version === 2 ? this.readBackupPractice(value.practice) : {};
        const legacy = value.version === '1.0.0' ? this.normalizeHistory(value.history) : null;
        if (legacy && this.DATE.test(value.stats?.date)) {
            const { date } = value.stats;
            legacy[date] = this.mergeDay(legacy[date], this.normalizeHistory({ [date]: value.stats })[date]);
        }
        const byId = new Map();
        for (const log of logs) {
            const duplicate = byId.get(log.id);
            if (duplicate && !this.sameLog(duplicate, log)) {
                throw new Error('备份内有相同编号但不同内容的日记，尚未导入。');
            }
            byId.set(log.id, log);
        }
        const records = [...byId.values()];
        const { additions, conflicts } = this.classifyBackupLogs(records, this.read());
        return {
            logs: records, settings: this.normalizeSettings(value.settings || { customTags: [] }),
            practice, legacy, newLogs: additions.length, conflicts
        };
    },

    readBackupPractice(practice) {
        if (practice === undefined) return {};
        const invalid = () => new Error('备份里的练习记录格式有误，尚未导入。');
        if (!this.isRecord(practice)) throw invalid();

        const sources = new Map();
        for (const [key, records] of Object.entries(practice)) {
            const id = key.toLowerCase();
            if (!this.UUID.test(id) || sources.has(id) || !this.isRecord(records)) throw invalid();
            const history = {};
            for (const [date, record] of Object.entries(records)) {
                if (!this.DATE.test(date) || !this.isRecord(record)) throw invalid();
                const utcDate = new Date(`${date}T00:00:00.000Z`);
                if (!Number.isFinite(utcDate.getTime()) || utcDate.toISOString().slice(0, 10) !== date) throw invalid();
                const { breathingSeconds = 0, focusSeconds = 0 } = record;
                if (![breathingSeconds, focusSeconds].every(seconds => Number.isSafeInteger(seconds) && seconds >= 0)) {
                    throw invalid();
                }
                history[date] = { breathingSeconds, focusSeconds };
            }
            sources.set(id, history);
        }
        return Object.fromEntries(sources);
    },

    classifyBackupLogs(records, state) {
        const local = new Map(state.logs.map(log => [log.id, log]));
        const additions = [];
        let conflicts = 0;
        for (const log of records) {
            const current = local.get(log.id);
            if (current) {
                if (!this.sameLog(current, log)) conflicts++;
            } else if (!Object.hasOwn(state.pending, log.id)) {
                additions.push(log);
            }
        }
        return { additions, conflicts };
    },

    importBackup(backup, destination = null) {
        const state = this.read();
        const { additions } = this.classifyBackupLogs(backup.logs, state);
        if (destination && (!destination.scope || destination.scope !== this.activeScope ||
            destination.consent !== this.activeConsent || state.consents[destination.scope] !== destination.consent)) {
            throw new Error('云账户或同步设置已变更。请重新打开备份并确认。');
        }
        state.logs.push(...additions);
        if (destination) {
            for (const log of additions) {
                state.owners[log.id] = this.activeScope;
                this.queue(state, log.id, this.activeScope, 'adopt');
            }
        }
        state.settings.customTags = [...new Set([...state.settings.customTags, ...backup.settings.customTags])];
        if (state.settings.userName === this.DEFAULT_SETTINGS.userName) state.settings.userName = backup.settings.userName;
        if (!state.settings.theme) state.settings.theme = backup.settings.theme;
        if (!this.normalizeSettings(state.settings).journalFont) state.settings.journalFont = backup.settings.journalFont;
        for (const [source, history] of Object.entries(backup.practice)) {
            const current = state.history[source] ||= {};
            for (const [date, value] of Object.entries(history)) current[date] = this.mergeDay(current[date], value);
        }
        if (backup.legacy) {
            const legacySource = '00000000-0000-5000-a000-000000000000';
            const totals = this.aggregateHistory(state.history);
            const destination = state.history[legacySource] ||= {};
            for (const [date, value] of Object.entries(backup.legacy)) {
                const previous = destination[date] || { breathingSeconds: 0, focusSeconds: 0 };
                destination[date] = {
                    breathingSeconds: previous.breathingSeconds + Math.max(0, value.breathingSeconds - (totals[date]?.breathingSeconds || 0)),
                    focusSeconds: previous.focusSeconds + Math.max(0, value.focusSeconds - (totals[date]?.focusSeconds || 0))
                };
            }
        }
        this.write(state);
        if (destination && additions.length) this.requestSync();
        return additions.length;
    },

    importFromJSON(jsonString) {
        return this.importBackup(this.previewImport(jsonString));
    }
};
