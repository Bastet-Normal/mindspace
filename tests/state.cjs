const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { runInNewContext } = require('node:vm');
const { join } = require('node:path');
const { randomUUID } = require('node:crypto');

const storageSource = readFileSync(join(__dirname, '../js/storage.js'), 'utf8');
const date = new Date(2026, 10, 24, 12);
const log = { id: '7e19ff25-2fe5-499c-85e6-b56866a31fa5', timestamp: date.getTime(), weather: 'rainy', tags: ['工作'], note: '一条记录' };
const day = '2026-11-24';

function storageHarness(seed = {}) {
    const values = new Map(Object.entries(seed).map(([key, value]) => [key, JSON.stringify(value)]));
    const localStorage = {
        getItem: key => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value),
        removeItem: key => values.delete(key)
    };
    const window = {};
    const syncTimers = [];
    const storage = runInNewContext(`${storageSource}\nMindSpaceStorage;`, {
        localStorage, window, URL, crypto: { randomUUID }, setTimeout: action => syncTimers.push(action)
    });
    return { storage, window, values, syncTimers };
}

test('old logs and same-day practice migrate and repeated legacy backup imports are idempotent', () => {
    const history = { [day]: { focusSeconds: 300, breathingSeconds: 60 } };
    const backup = JSON.stringify({ version: '1.0.0', logs: [log], stats: { date: day, ...history[day] }, history });
    const { storage, values } = storageHarness({
        mindspace_mood_logs: [log], mindspace_stats_history: history,
        mindspace_daily_stats: { date: day, focusSeconds: 301, breathingSeconds: 60 }
    });

    assert.equal(storage.getHistoryStats()[day].focusSeconds, 301);
    assert.equal(values.has(storage.KEYS.LOGS), false);
    assert.equal(storage.importFromJSON(backup), 0);
    assert.equal(storage.importFromJSON(backup), 0);
    assert.equal(storage.getLogs().length, 1);
    assert.equal(storage.getHistoryStats()[day].focusSeconds, 301);
});

test('two moods round-trip through saved records and backups while a third is rejected', () => {
    const { storage } = storageHarness({ mindspace_mood_logs: [log] });
    const pair = storage.saveLog(['sunny', 'rainy'], [], '两种感受', log.timestamp);
    assert.equal(pair.weather, 'sunny,rainy');
    assert.equal(storage.getLogs().find(entry => entry.id === log.id).weather, 'rainy');
    assert.throws(() => storage.updateLog(pair.id, ['rainy', 'sunny', 'foggy']), /格式/);
    assert.throws(() => storage.updateLog(pair.id, ['rainy', 'rainy']), /格式/);
    assert.equal(storage.getLogs().find(entry => entry.id === pair.id).weather, 'sunny,rainy');

    let exported;
    storage.download = content => { exported = content; };
    storage.exportToJSON();
    const { storage: restored } = storageHarness();
    assert.equal(restored.importFromJSON(exported), 2);
    assert.equal(restored.getLogs().find(entry => entry.id === pair.id).weather, 'sunny,rainy');
    storage.exportToMarkdown();
    assert.match(exported, /晴朗、小雨\n\n两种感受/);
    assert.equal(storage.sameLog(pair, { ...pair, weather: 'sunny,foggy' }), false);
});

test('daily mood weights split each entry equally among its selected moods', () => {
    const { storage } = storageHarness();
    const values = logs => Object.fromEntries(storage.moodWeights(logs));
    assert.deepEqual(values([{ weather: 'sunny,rainy' }, { weather: 'sunny' }]), { sunny: 1.5, rainy: 0.5 });
    assert.deepEqual(values([{ weather: ['rainy', 'sunny'] }]), { sunny: 0.5, rainy: 0.5 });
    assert.deepEqual(values([]), {});
});

test('journal font preferences persist and restore when the device has no choice', () => {
    const { storage } = storageHarness({ mindspace_user_settings: { userName: '读者' } });
    assert.equal(storage.getSettings().journalFont, null);
    for (const journalFont of ['kai', 'xihei', 'ipaex', 'fangsong']) {
        storage.saveSettings({ ...storage.getSettings(), journalFont });
        assert.equal(storage.getSettings().journalFont, journalFont);
    }
    assert.equal(storage.getSettings().userName, '读者');

    let backup;
    storage.download = content => { backup = content; };
    storage.exportToJSON();
    const { storage: restored, values } = storageHarness();
    restored.importFromJSON(backup);
    assert.equal(restored.getSettings().journalFont, 'fangsong');
    const previous = JSON.parse(values.get(restored.KEY));
    previous.settings.journalFont = 'smiley';
    values.set(restored.KEY, JSON.stringify(previous));
    assert.equal(restored.getSettings().journalFont, null);
    restored.importFromJSON(backup);
    assert.equal(restored.getSettings().journalFont, 'fangsong');
    restored.saveSettings({ ...restored.getSettings(), journalFont: 'system' });
    restored.importFromJSON(backup);
    assert.equal(restored.getSettings().journalFont, 'system');
    assert.equal(storage.normalizeSettings({ journalFont: 'unknown' }).journalFont, null);
});

test('inline fonts stay aligned after trimming, backup, and a formatting-only conflict', () => {
    const { storage } = storageHarness();
    const runs = [{ start: 0, font: 'system' }, { start: 1, font: 'kai' }, { start: 4, font: 'song' }];
    const saved = storage.saveLog('sunny', [], '  春风😀  ', log.timestamp, runs);
    assert.equal(saved.note, '春风😀');
    assert.deepEqual(JSON.parse(JSON.stringify(saved.fontRuns)), [{ start: 0, font: 'kai' }, { start: 2, font: 'song' }]);
    let backup;
    storage.download = content => { backup = content; };
    storage.exportToJSON();
    const { storage: copy } = storageHarness();
    copy.importFromJSON(backup);
    assert.ok(storage.sameLog(saved, copy.getLogs()[0]));
    const changed = storage.updateLog(saved.id, saved.weather, [], saved.note, {
        expected: saved, fontRuns: [{ start: 0, font: 'system' }]
    });
    assert.equal(storage.sameLog(changed, saved), false);
    const conflict = storage.updateLog(saved.id, saved.weather, [], saved.note, { expected: saved, fontRuns: saved.fontRuns });
    assert.notEqual(conflict.id, saved.id);
    assert.ok(storage.sameLog(conflict, saved));
    assert.ok(storage.sameLog(saved, storage.normalizeLog({ ...saved, fontRuns: undefined, font_runs: saved.fontRuns })));
});

test('practice from separate devices accumulates once per source and preserves intervals across midnight', () => {
    const { storage } = storageHarness();
    const endedAt = new Date(2026, 10, 25, 0, 0, 5).getTime();
    storage.addFocusTime(12, endedAt);
    assert.equal(storage.getHistoryStats()[day].focusSeconds, 7);
    assert.equal(storage.getHistoryStats()['2026-11-25'].focusSeconds, 5);
    const remoteDevice = randomUUID();
    const backup = JSON.stringify({ version: 2, logs: [log], practice: { [remoteDevice]: { [day]: { focusSeconds: 110 } } } });
    assert.equal(storage.importFromJSON(backup), 1);
    assert.equal(storage.importFromJSON(backup), 0);
    assert.equal(storage.getHistoryStats()[day].focusSeconds, 117);
});

test('invalid archives leave the committed library untouched', () => {
    const { storage, values } = storageHarness();
    storage.saveLog('sunny', ['安静'], '已有');
    const original = values.get(storage.KEY);
    assert.throws(() => storage.previewImport(JSON.stringify({ version: 2, logs: [log, { ...log, weather: 'other' }] })), /格式/);
    assert.equal(values.get(storage.KEY), original);
    const edit = storage.getLogs()[0];
    storage.updateLog(edit.id, 'foggy', ['工作'], '修改');
    assert.equal(storage.getLogs()[0].timestamp, edit.timestamp);
    assert.equal(storage.getLogs()[0].note, '修改');
});

test('offline deletion remains queued and does not reappear on the next sync', async () => {
    const { storage, window } = storageHarness();
    const cloud = new Map([[log.id, log]]);
    let offline = false;
    window.SupabaseService = { connect: async () => ({
        scope: 'test:user',
        fetchLogs: async () => [...cloud.values()],
        deleteLog: async id => {
            if (offline) throw new Error('offline');
            cloud.delete(id);
        }
    }) };
    await storage.enableSync(false);
    offline = true;
    storage.deleteLog(log.id);
    await assert.rejects(storage.inFlight, /offline/);
    assert.equal(storage.getLogs().length, 0);
    assert.equal(storage.pendingCount(), 1);
    offline = false;
    await storage.syncLocalToCloud();
    assert.equal(storage.getLogs().length, 0);
    assert.equal(cloud.size, 0);
    assert.equal(storage.pendingCount(), 0);
});

test('edits made during an upload survive completion and are not sent to a different account', async () => {
    const { storage, window } = storageHarness();
    const cloud = new Map();
    const sent = [];
    let scope = 'test:alice';
    let finishUpload;
    let waitForUpload;
    window.SupabaseService = { connect: async () => ({
        scope,
        fetchLogs: async () => scope === 'test:alice' ? [...cloud.values()] : [],
        createLog: async entry => {
            sent.push({ scope, note: entry.note });
            if (waitForUpload) {
                waitForUpload();
                await new Promise(resolve => { finishUpload = resolve; });
                waitForUpload = null;
            }
            cloud.set(entry.id, entry);
        },
        updateLog: async entry => {
            sent.push({ scope, note: entry.note });
            cloud.set(entry.id, entry);
        }
    }) };
    await storage.enableSync(false);
    const uploading = new Promise(resolve => { waitForUpload = resolve; });
    const saved = storage.saveLog('rainy', [], '第一次');
    await uploading;
    storage.updateLog(saved.id, ['cloudy', 'sunny'], ['工作'], '后来补充');
    finishUpload();
    await storage.inFlight;
    await Promise.resolve();
    await storage.syncLocalToCloud();
    assert.equal(storage.getLogs()[0].note, '后来补充');
    assert.equal(cloud.get(saved.id).note, '后来补充');
    assert.equal(cloud.get(saved.id).weather, 'cloudy,sunny');

    const local = storage.pauseSync('test:alice');
    assert.equal(local, undefined);
    storage.saveLog('sunny', [], '未授权上传');
    scope = 'test:bob';
    storage.setSyncSession(scope);
    await storage.enableSync(false);
    assert.equal(sent.length, 2);
    assert.equal(sent.every(item => item.scope === 'test:alice'), true);
    assert.equal(storage.getLogs().length, 2);
});

test('migration leaves unreadable legacy journal bytes available for recovery', () => {
    const { storage, values } = storageHarness();
    const damaged = '{"entries":';
    values.set(storage.KEYS.LOGS, damaged);
    assert.equal(storage.getLogs().length, 0);
    assert.equal(values.get(storage.KEYS.LOGS), damaged);
});

test('preview rejects conflicting duplicates and malformed practice, and counts only restorable entries', () => {
    const { storage, values } = storageHarness();
    const archive = entries => JSON.stringify({ version: 2, logs: entries });
    assert.throws(() => storage.previewImport(archive([log, { ...log, note: '另一个版本' }])), /相同编号/);
    assert.throws(() => storage.previewImport(archive([{ ...log, timestamp: null }])), /格式/);
    const source = randomUUID();
    for (const practice of [
        { [source]: { '2026-11-31': { focusSeconds: 30 } } },
        { [source]: { [day]: { focusSeconds: '30' } } }
    ]) {
        assert.throws(() => storage.previewImport(JSON.stringify({ version: 2, logs: [log], practice })), /练习记录格式/);
    }
    assert.equal(values.has(storage.KEY), false);
    assert.equal(storage.previewImport(archive([log, log])).newLogs, 1);
    const state = storage.read();
    storage.queue(state, log.id, 'test:user', 'delete');
    storage.write(state);
    assert.equal(storage.previewImport(archive([log])).newLogs, 0);
    assert.equal(storage.importFromJSON(archive([log])), 0);
    assert.equal(storage.previewImport(archive([log])).conflicts, 0);
    const other = { ...log, id: randomUUID() };
    assert.equal(storage.importFromJSON(archive([other])), 1);
    assert.equal(storage.previewImport(archive([other])).conflicts, 0);
    const edited = { ...other, note: '备份中的不同版本' };
    const preview = storage.previewImport(archive([edited, edited]));
    assert.equal(preview.conflicts, 1);
    assert.equal(storage.importBackup(preview), 0);
    assert.equal(storage.getLogs().find(entry => entry.id === other.id).note, other.note);
});

test('a restore stays private unless confirmed for the current account and consent', async () => {
    const { storage, window } = storageHarness();
    const cloud = new Map();
    const origin = 'https://example.test';
    const scope = origin + '|alice';
    window.SupabaseService = { connect: async () => ({
        scope,
        fetchLogs: async () => [...cloud.values()],
        createLog: async entry => {
            cloud.set(entry.id, entry);
            return true;
        }
    }) };

    await storage.enableSync(false);
    const backup = JSON.stringify({ version: 2, logs: [log], practice: {} });
    const privateLog = { ...log, id: randomUUID() };
    assert.equal(storage.importFromJSON(JSON.stringify({ version: 2, logs: [privateLog], practice: {} })), 1);
    assert.equal(storage.read().owners[privateLog.id], undefined);
    const preview = storage.previewImport(backup);
    assert.throws(() => storage.importBackup(preview, { scope, consent: 'expired' }), /已变更/);
    assert.equal(storage.importBackup(preview, { scope, consent: storage.activeConsent }), 1);
    await storage.inFlight;
    assert.equal(cloud.get(log.id).note, log.note);
    assert.equal(storage.pendingCount(), 0);
    assert.equal(storage.read().owners[log.id], scope);
    assert.equal(cloud.has(privateLog.id), false);

    storage.forgetSync(origin);
    const state = storage.read();
    assert.equal(state.logs.length, 2);
    assert.equal(state.owners[log.id], scope);
    assert.equal(Object.keys(state.pending).length, 0);
    assert.equal(Object.keys(state.consents).length, 0);
    assert.equal(storage.activeScope, null);
});

test('saving a stale editor preserves newer text and restores a deleted entry as a private copy', () => {
    const { storage } = storageHarness();
    const original = storage.saveLog('rainy', [], '旧随笔', date.getTime());
    storage.updateLog(original.id, 'sunny', [], '另一页的修改');
    const edited = storage.updateLog(original.id, 'breezy', [], '未提交的草稿', { expected: original });
    assert.notEqual(edited.id, original.id);
    assert.equal(edited.timestamp, original.timestamp);
    assert.equal(storage.getLogs().find(entry => entry.id === original.id).note, '另一页的修改');
    storage.deleteLog(original.id);
    const recovered = storage.updateLog(original.id, 'foggy', [], '删除前的草稿', { expected: original });
    assert.notEqual(recovered.id, original.id);
    assert.equal(storage.read().owners[recovered.id], undefined);
    assert.equal(storage.getLogs().length, 2);
});

test('sync consent cannot be reused after changing the account shown in the confirmation', async () => {
    const { storage, window } = storageHarness();
    const unsent = storage.saveLog('foggy', [], '本机私有');
    let finishConnect;
    window.SupabaseService = { connect: () => new Promise(resolve => { finishConnect = resolve; }) };
    storage.setSyncSession('test:iris');
    const enabling = storage.enableSync(true, 'test:iris');
    storage.setSyncSession('test:harper');
    finishConnect({ scope: 'test:harper' });
    await assert.rejects(enabling, /重新确认/);
    assert.equal(storage.activeScope, null);
    assert.equal(Object.keys(storage.read().consents).length, 0);
    assert.equal(storage.read().owners[unsent.id], undefined);
});

test('settling an old pull cannot reattach data after enabling a fresh same-account consent', async () => {
    const { storage, window } = storageHarness();
    const scope = 'test:user';
    let releaseOldPull;
    let startedPull;
    const firstPull = new Promise(resolve => { startedPull = resolve; });
    let pulls = 0;
    window.SupabaseService = { connect: async () => ({
        scope,
        async fetchLogs() {
            if (pulls++ > 0) return [];
            startedPull();
            return new Promise(resolve => { releaseOldPull = resolve; });
        }
    }) };
    storage.setSyncSession(scope);
    const oldEnable = assert.rejects(storage.enableSync(false, scope), /设置已变更/);
    await firstPull;
    storage.pauseSync(scope);
    const newEnable = storage.enableSync(false, scope);
    releaseOldPull([log]);
    await Promise.all([oldEnable, newEnable]);
    assert.equal(pulls, 2);
    assert.equal(storage.activeScope, scope);
    assert.equal(storage.getLogs().length, 0);
});

test('another tab pausing sync does not link new diaries or acknowledge a stale pull', async () => {
    const { storage, window } = storageHarness();
    const scope = 'test:user';
    let releasePull;
    let signalPull;
    const startedPull = new Promise(resolve => { signalPull = resolve; });
    window.SupabaseService = { connect: async () => ({
        scope,
        async fetchLogs() {
            signalPull();
            return new Promise(resolve => { releasePull = resolve; });
        }
    }) };
    const enable = assert.rejects(storage.enableSync(false), /设置已变更/);
    await startedPull;
    const state = storage.read();
    delete state.consents[scope];
    storage.write(state);
    const diary = storage.saveLog('sunny', [], '仍在本机');
    releasePull([log]);
    await enable;
    assert.equal(storage.read().owners[diary.id], undefined);
    assert.equal(storage.getLogs().length, 1);
});

test('a successful mutation is acknowledged even when the subsequent pull fails', async () => {
    const { storage, window } = storageHarness();
    const cloud = new Map();
    let failPull = false;
    let writes = 0;
    window.SupabaseService = { connect: async () => ({
        scope: 'test:user',
        async fetchLogs() {
            if (failPull) throw new Error('连接中断');
            return [...cloud.values()];
        },
        async createLog(entry) {
            writes++;
            cloud.set(entry.id, entry);
            return true;
        }
    }) };
    await storage.enableSync(false);
    failPull = true;
    const diary = storage.saveLog('cloudy', [], '先前内容');
    await assert.rejects(storage.inFlight, /连接中断/);
    assert.equal(storage.pendingCount(), 0);
    cloud.set(diary.id, { ...diary, note: '另一设备的新内容' });
    failPull = false;
    await storage.syncLocalToCloud();
    assert.equal(writes, 1);
    assert.equal(storage.getLogs()[0].note, '另一设备的新内容');
});

test('offline edits to rows removed from the cloud remain available as private copies', async () => {
    const { storage, window } = storageHarness();
    let entries = [log];
    const scope = 'test:user';
    window.SupabaseService = { connect: async () => ({
        scope, fetchLogs: async () => entries, updateLog: async () => false
    }) };
    await storage.enableSync(false);
    entries = [];
    storage.updateLog(log.id, 'sunny', [], '不能丢失的编辑');
    await storage.inFlight;
    assert.equal(storage.pendingCount(), 0);
    assert.equal(storage.getLogs().length, 1);
    const [copy] = storage.getLogs();
    assert.notEqual(copy.id, log.id);
    assert.equal(copy.note, '不能丢失的编辑');
    assert.equal(storage.read().owners[copy.id], undefined);
});

test('ID conflicts keep both local and cloud edits without overwriting the cloud', async () => {
    const { storage, window } = storageHarness({ mindspace_mood_logs: [log] });
    const cloud = { ...log, note: '云端更新' };
    window.SupabaseService = { connect: async () => ({
        scope: 'test:user',
        fetchLogs: async () => [cloud],
        createLog: async () => false,
        fetchLog: async () => cloud
    }) };
    await storage.enableSync(true);
    assert.equal(storage.pendingCount(), 0);
    assert.equal(storage.getLogs().length, 2);
    assert.equal(storage.getLogs().find(entry => entry.id === log.id).note, '云端更新');
    assert.equal(storage.getLogs().find(entry => entry.id !== log.id).note, log.note);
});

test('a malformed cloud snapshot leaves the saved library intact', async () => {
    const { storage, window } = storageHarness();
    let entries = [log];
    window.SupabaseService = { connect: async () => ({ scope: 'test:user', fetchLogs: async () => entries }) };
    await storage.enableSync(false);
    entries = [{ ...log, timestamp: 'not-a-date' }];
    await assert.rejects(storage.syncLocalToCloud(), /云端日记格式/);
    assert.equal(storage.getLogs()[0].note, log.note);
});

test('retryable transport failures back off and a paused account cannot restart itself', async () => {
    const { storage, window, syncTimers } = storageHarness();
    let available = false;
    let reads = 0;
    const scope = 'test:user';
    window.SupabaseService = { connect: async () => ({
        scope,
        async fetchLogs() {
            reads++;
            if (!available) throw Object.assign(new Error('暂不可用'), { retryable: true });
            return [log];
        }
    }) };
    await assert.rejects(storage.enableSync(false), /暂不可用/);
    assert.equal(syncTimers.length, 1);
    available = true;
    syncTimers.shift()();
    await storage.inFlight;
    assert.equal(storage.getLogs().length, 1);
    available = false;
    await assert.rejects(storage.syncLocalToCloud(), /暂不可用/);
    assert.equal(syncTimers.length, 1);
    storage.pauseSync(scope);
    syncTimers.shift()();
    assert.equal(reads, 3);
});
