const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { runInNewContext } = require('node:vm');
const { randomUUID } = require('node:crypto');
const { join } = require('node:path');

const storageSource = readFileSync(join(__dirname, '../js/storage.js'), 'utf8');
const focusSource = readFileSync(join(__dirname, '../js/focus.js'), 'utf8');
const breathingSource = readFileSync(join(__dirname, '../js/breathing.js'), 'utf8');

function practiceHarness(values = new Map(), clock = { now: new Date(2026, 10, 25, 10).getTime() }) {
    class Clock extends Date {
        constructor(...args) { super(...(args.length ? args : [clock.now])); }
        static now() { return clock.now; }
    }
    const localStorage = {
        getItem: key => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value),
        removeItem: key => values.delete(key)
    };
    const events = [];
    const window = {};
    const document = {
        hidden: false,
        addEventListener() {},
        querySelectorAll: () => [],
        dispatchEvent(event) { events.push(event); }
    };
    const app = { showModal: () => events.push('modal'), showToast: () => events.push('toast'), overlays: [], router: { currentView: 'focus' } };
    const context = {
        localStorage, Date: Clock, crypto: { randomUUID }, document, window, app,
        Event, CustomEvent, setInterval: () => 0, clearInterval() {}
    };
    const controller = runInNewContext(`${storageSource}\n${focusSource}\n${breathingSource}\n({ storage: MindSpaceStorage, focus: MindSpaceFocusTimer, breath: MindSpaceBreathing, mixer: MindSpaceSoundMixer });`, context);
    controller.focus.dom = {
        pane: { dataset: {} },
        digits: {}, label: {}, toggleIcon: { setAttribute() {} }, toggleText: {},
        progress: { setAttribute(name, value) { this[name] = value; } },
        dialLength: 2 * Math.PI * 102
    };
    controller.breath.dom = {
        stage: { dataset: {}, style: { setProperty() {}, removeProperty() {} } },
        instruction: {}, countdown: {}, timer: {}
    };
    return { ...controller, values, clock, document, window, localStorage, events };
}

test('focus counts elapsed time once across reload and preserves the remaining time across pause', () => {
    const first = practiceHarness();
    first.focus.start();
    const runId = first.focus.lastRun.id;
    first.clock.now += 120_000;
    first.focus.tick();
    assert.equal(first.focus.timeLeft, 23 * 60);
    assert.equal(first.focus.dom.progress['stroke-dashoffset'], (first.focus.dom.dialLength * .08).toFixed(3));
    assert.equal(first.storage.getTodayStats().focusSeconds, 120);

    const reloaded = practiceHarness(first.values, first.clock);
    reloaded.focus.refreshClock();
    assert.equal(reloaded.focus.lastRun.id, runId);
    assert.equal(reloaded.focus.timeLeft, 23 * 60);
    assert.equal(reloaded.storage.getTodayStats().focusSeconds, 120);

    first.clock.now += 3_000;
    reloaded.focus.pause();
    assert.equal(reloaded.focus.timeLeft, 1377);
    assert.equal(reloaded.focus.phase, 'paused');
    assert.equal(reloaded.focus.dom.label.textContent, '专注已暂停');
    assert.equal(reloaded.storage.getTodayStats().focusSeconds, 123);

    const paused = practiceHarness(first.values, first.clock);
    paused.focus.refreshClock();
    paused.focus.start();
    assert.notEqual(paused.focus.lastRun.id, runId);
    assert.equal(paused.focus.lastRun.duration, 1377);
});

test('a mirrored tab never counts time after the active clock was paused or cleared elsewhere', () => {
    const first = practiceHarness();
    first.focus.start();
    const second = practiceHarness(first.values, first.clock);
    second.focus.refreshClock();

    first.clock.now += 10_000;
    first.focus.pause();
    first.clock.now += 25_000;
    second.focus.tick();
    assert.equal(second.focus.phase, 'paused');
    assert.equal(second.storage.getTodayStats().focusSeconds, 10);

    first.focus.start();
    second.focus.refreshClock();
    first.focus.clearStoredState();
    first.clock.now += 50_000;
    second.focus.tick();
    assert.equal(second.focus.phase, 'ready');
    assert.equal(second.storage.getTodayStats().focusSeconds, 10);
});

test('recovering an expired focus is quiet and the 5-minute break returns to the chosen work duration', () => {
    const first = practiceHarness();
    first.focus.setDuration(45);
    first.focus.start();
    first.clock.now += 50 * 60_000;
    const reopened = practiceHarness(first.values, first.clock);
    reopened.focus.refreshClock();
    assert.equal(reopened.focus.phase, 'done');
    assert.equal(reopened.focus.timeLeft, 0);
    assert.equal(reopened.storage.getTodayStats().focusSeconds, 45 * 60);
    assert.equal(reopened.events.includes('modal'), false);
    assert.equal(reopened.events.includes('toast'), false);

    reopened.focus.start();
    assert.equal(reopened.focus.currentMode, 'break');
    assert.equal(reopened.focus.timeLeft, 5 * 60);
    reopened.clock.now += 5 * 60_000;
    reopened.focus.tick(false, true, false);
    assert.equal(reopened.storage.getTodayStats().focusSeconds, 45 * 60);
    reopened.focus.start();
    assert.equal(reopened.focus.currentMode, 'work');
    assert.equal(reopened.focus.timeLeft, 45 * 60);
});

test('a hidden breathing guide pauses its rhythm and never counts time spent away', () => {
    const { breath, storage, clock, document, events } = practiceHarness();
    breath.start(60);
    clock.now += 3_000;
    document.hidden = true;
    breath.suspend();
    assert.equal(storage.getTodayStats().breathingSeconds, 3);

    clock.now += 2 * 60_000;
    breath.tick();
    assert.equal(storage.getTodayStats().breathingSeconds, 3);
    document.hidden = false;
    breath.resume();
    assert.equal(breath.elapsedSeconds, 3);
    assert.equal(breath.currentPhase, 'inhale');
    assert.equal(breath.dom.stage.dataset.phase, 'inhale');

    clock.now += 3_000;
    breath.tick();
    assert.equal(breath.currentPhase, 'exhale');
    assert.equal(breath.dom.stage.dataset.phase, 'exhale');
    assert.equal(breath.dom.countdown.textContent, '4');
    clock.now += 55_000;
    breath.tick();
    assert.equal(storage.getTodayStats().breathingSeconds, 60);
    assert.equal(events.some(event => event.type === 'mindspace:breathing-complete'), true);
});

test('saved sound levels restore without creating audio or playing a track', () => {
    const { mixer, document, localStorage } = practiceHarness();
    const slider = { value: 50, addEventListener() {} };
    const button = { addEventListener() {} };
    const card = {
        dataset: { sound: 'rain' },
        querySelector: selector => ({ '.sound-card-main': button, '.sound-volume-slider': slider, '.sound-status': {}, '.sound-volume-value': {} })[selector]
    };
    document.querySelectorAll = () => [card];
    document.getElementById = () => ({});
    localStorage.setItem(mixer.MIX_KEY, JSON.stringify({ rain: 24 }));

    mixer.init();
    assert.equal(slider.value, 24);
    const channel = mixer.channels.get('rain');
    assert.equal(channel.audio, null);
    assert.equal(channel.active, false);
    slider.value = 67;
    mixer.saveVolumes();
    assert.deepEqual(JSON.parse(localStorage.getItem(mixer.MIX_KEY)), { rain: 67 });
});
