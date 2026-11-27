const MindSpaceFocusTimer = {
    STORAGE_KEY: 'mindspace_focus_clock_v1',
    workDuration: 25 * 60,
    duration: 25 * 60,
    timeLeft: 25 * 60,
    currentMode: 'work',
    phase: 'ready',
    timerId: null,
    soundAlertEnabled: true,
    alarmAudioContext: null,
    lastRun: null,
    storageSnapshot: null,
    dom: {},

    get isRunning() {
        return this.phase === 'running';
    },

    init() {
        this.dom = {
            pane: document.querySelector('.focus-pane-left'),
            digits: document.getElementById('timer-digits'),
            label: document.getElementById('timer-label'),
            toggle: document.getElementById('btn-timer-toggle'),
            toggleIcon: document.getElementById('timer-toggle-icon'),
            toggleText: document.getElementById('timer-toggle-text'),
            reset: document.getElementById('btn-timer-reset'),
            progress: document.getElementById('focus-dial-remaining'),
            sound: document.getElementById('timer-sound-alert')
        };
        if (!this.dom.digits) return;
        this.dom.dialLength = 2 * Math.PI * Number(this.dom.progress.getAttribute('r'));
        this.dom.progress.setAttribute('stroke-dasharray', this.dom.dialLength + ' ' + this.dom.dialLength);

        this.dom.toggle.addEventListener('click', () => this.toggle());
        this.dom.reset.addEventListener('click', () => this.reset());
        document.querySelectorAll('.timer-presets .preset-btn').forEach(button => {
            button.addEventListener('click', () => {
                if (button.id === 'preset-custom') this.openCustomDurationModal();
                else this.setDuration(Number(button.dataset.duration));
            });
        });
        this.dom.sound?.addEventListener('change', event => {
            this.refreshClock();
            this.soundAlertEnabled = event.target.checked;
            if (this.soundAlertEnabled) this.prepareAlarm();
            this.persistClock();
        });

        window.addEventListener('storage', event => {
            if (event.key === this.STORAGE_KEY || event.key === null) this.refreshClock();
        });
        const reconcile = () => {
            this.refreshClock();
            this.tick(false, true, false);
        };
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) this.tick(true, true, false);
            else reconcile();
        });
        window.addEventListener('pageshow', reconcile);
        window.addEventListener('pagehide', () => this.tick(true, true, false));
        this.refreshClock();
        this.renderState();
    },

    refreshClock() {
        let raw;
        try { raw = localStorage.getItem(this.STORAGE_KEY); }
        catch { return; }
        if (raw === this.storageSnapshot) return;
        this.storageSnapshot = raw;
        this.stopInterval();
        const saved = this.decodeClock(raw);
        this.workDuration = saved?.workDuration ?? 25 * 60;
        this.duration = saved?.duration ?? this.workDuration;
        this.timeLeft = saved?.timeLeft ?? this.duration;
        this.currentMode = saved?.mode ?? 'work';
        this.phase = saved?.phase ?? 'ready';
        this.soundAlertEnabled = saved?.soundAlertEnabled ?? true;
        this.lastRun = saved?.run ? { ...saved.run, elapsed: 0, saved: 0, warned: false } : null;
        this.renderState();
        if (this.isRunning) {
            if (typeof MindSpaceBreathing !== 'undefined' && MindSpaceBreathing.isActive) app.stopBreathing();
            this.tick(false, true, false);
            if (this.isRunning) this.startInterval();
        }
    },

    decodeClock(raw) {
        if (!raw) return null;
        try {
            const value = JSON.parse(raw);
            const durationValid = duration => Number.isInteger(duration) && duration >= 60 && duration <= 180 * 60;
            if (!value || value.version !== 1 ||
                !['work', 'break'].includes(value.mode) ||
                !['ready', 'running', 'paused', 'done'].includes(value.phase) ||
                !durationValid(value.duration) || !durationValid(value.workDuration) || typeof value.soundAlertEnabled !== 'boolean' ||
                !Number.isInteger(value.timeLeft) || value.timeLeft < 0 || value.timeLeft > value.duration) return null;
            if (value.phase === 'running') {
                const run = value.run;
                if (!run || !MindSpaceStorage.UUID.test(run.id) ||
                    !Number.isSafeInteger(run.startedAt) || run.startedAt < 0 ||
                    !Number.isInteger(run.duration) || run.duration < 1 || run.duration > value.duration) return null;
            }
            return value;
        } catch {
            return null;
        }
    },

    persistClock() {
        const run = this.lastRun;
        const snapshot = {
            version: 1,
            mode: this.currentMode,
            phase: this.phase,
            duration: this.duration,
            timeLeft: this.timeLeft,
            workDuration: this.workDuration,
            soundAlertEnabled: this.soundAlertEnabled,
            run: this.isRunning && run ? { id: run.id, startedAt: run.startedAt, duration: run.duration } : null
        };
        try {
            const raw = JSON.stringify(snapshot);
            localStorage.setItem(this.STORAGE_KEY, raw);
            this.storageSnapshot = raw;
        } catch {
            // The in-memory clock can keep running if browser storage is unavailable.
        }
    },

    clearStoredState() {
        this.stopInterval();
        this.lastRun = null;
        this.phase = 'ready';
        localStorage.removeItem(this.STORAGE_KEY);
        this.storageSnapshot = null;
    },

    setDuration(minutes) {
        if (!Number.isInteger(minutes) || minutes < 1 || minutes > 180) return;
        this.refreshClock();
        this.flushAndStop();
        this.workDuration = minutes * 60;
        this.setMode('work');
        this.persistClock();
        this.renderState();
    },

    openCustomDurationModal() {
        app.showModal('自定义专注时长', `
            <div class="form-group">
                <label for="custom-focus-minutes">专注分钟数（1–180）</label>
                <div class="focus-minute-field">
                    <input type="number" inputmode="numeric" id="custom-focus-minutes" min="1" max="180" value="${Math.round(this.workDuration / 60)}" aria-describedby="custom-focus-error" required>
                    <div class="focus-minute-controls">
                        <button type="button" id="focus-minute-minus" aria-label="减少一分钟">−</button>
                        <button type="button" id="focus-minute-plus" aria-label="增加一分钟">+</button>
                    </div>
                </div>
                <p class="field-error" id="custom-focus-error" role="alert"></p>
            </div>`, [
            { text: '取消', onClick: () => app.hideModal() },
            { text: '确定', class: 'primary-btn', onClick: () => {
                if (!input.validity.valid) {
                    input.setAttribute('aria-invalid', 'true');
                    error.textContent = '请输入 1–180 之间的整数。';
                    input.focus();
                    return;
                }
                this.setDuration(input.valueAsNumber);
                app.hideModal();
            }}
        ]);

        const input = document.getElementById('custom-focus-minutes');
        const error = document.getElementById('custom-focus-error');
        const minus = document.getElementById('focus-minute-minus');
        const plus = document.getElementById('focus-minute-plus');
        const updateControls = () => {
            minus.disabled = input.valueAsNumber <= Number(input.min);
            plus.disabled = input.valueAsNumber >= Number(input.max);
            if (input.validity.valid) {
                input.removeAttribute('aria-invalid');
                error.textContent = '';
            }
        };
        const adjustMinutes = step => {
            if (!input.value) input.value = input.min;
            else input.stepUp(step);
            updateControls();
        };
        minus.onclick = () => adjustMinutes(-1);
        plus.onclick = () => adjustMinutes(1);
        input.addEventListener('input', updateControls);
        updateControls();
    },

    toggle() {
        this.refreshClock();
        if (this.isRunning) this.pause();
        else this.start();
    },

    start() {
        this.refreshClock();
        if (this.isRunning) return;
        if (this.phase === 'done') this.setMode(this.currentMode === 'work' ? 'break' : 'work');
        if (typeof MindSpaceBreathing !== 'undefined' && MindSpaceBreathing.isActive) app.stopBreathing();

        this.prepareAlarm();
        this.phase = 'running';
        this.lastRun = { id: MindSpaceStorage.generateUUID(), startedAt: Date.now(), duration: this.timeLeft, elapsed: 0, saved: 0, warned: false };
        this.persistClock();
        this.renderState();
        this.startInterval();
    },

    startInterval() {
        if (this.timerId === null) this.timerId = setInterval(() => this.tick(), 250);
    },

    stopInterval() {
        if (this.timerId !== null) clearInterval(this.timerId);
        this.timerId = null;
    },

    clockWasReplaced() {
        try { return localStorage.getItem(this.STORAGE_KEY) !== this.storageSnapshot; }
        catch { return false; }
    },

    tick(flush = false, finish = true, notify = true) {
        if (!this.isRunning) return;
        const run = this.lastRun;
        const elapsed = Math.floor((Date.now() - run.startedAt) / 1000);
        run.elapsed = Math.min(run.duration, Math.max(elapsed, run.elapsed));
        const pending = run.elapsed - run.saved;
        const checkpoint = this.currentMode === 'work' && pending > 0 && (flush || run.elapsed === run.duration || pending >= 5);
        if ((checkpoint || run.elapsed === run.duration) && this.clockWasReplaced()) {
            this.refreshClock();
            return;
        }
        if (checkpoint) {
            try {
                run.saved = MindSpaceStorage.checkpointFocus(run.id, run.elapsed, run.startedAt);
                run.elapsed = Math.max(run.elapsed, Math.min(run.duration, run.saved));
            } catch (error) {
                if (!run.warned && !document.hidden) app.showToast(error.message);
                run.warned = true;
            }
        }
        const remaining = run.duration - run.elapsed;
        if (remaining !== this.timeLeft) {
            this.timeLeft = remaining;
            this.updateDisplay();
        }
        if (!remaining && finish) this.complete(notify);
    },

    flushAndStop() {
        if (this.isRunning) this.tick(true, false);
        this.stopInterval();
        this.lastRun = null;
    },

    pause() {
        this.refreshClock();
        if (!this.isRunning) return;
        this.flushAndStop();
        this.phase = this.timeLeft ? 'paused' : 'done';
        this.persistClock();
        this.renderState();
    },

    reset() {
        this.refreshClock();
        this.flushAndStop();
        this.setMode(this.currentMode);
        this.persistClock();
        this.renderState();
    },

    setMode(mode) {
        this.currentMode = mode;
        this.duration = mode === 'work' ? this.workDuration : 5 * 60;
        this.timeLeft = this.duration;
        this.phase = 'ready';
    },

    summary() {
        const minutes = String(Math.floor(this.timeLeft / 60)).padStart(2, '0');
        const seconds = String(this.timeLeft % 60).padStart(2, '0');
        return { running: this.isRunning, phase: this.phase, mode: this.currentMode, remaining: this.timeLeft, duration: this.duration, label: `${minutes}:${seconds}` };
    },

    renderState() {
        const action = this.isRunning ? '暂停' : {
            ready: this.currentMode === 'work' ? '开始专注' : '开始休息',
            paused: this.currentMode === 'work' ? '继续专注' : '继续休息',
            done: this.currentMode === 'work' ? '开始休息' : '开始专注'
        }[this.phase];
        this.dom.pane.dataset.mode = this.currentMode;
        this.dom.pane.dataset.phase = this.phase;
        const mode = this.currentMode === 'work' ? '专注' : '休息';
        this.dom.label.textContent = { ready: '准备' + mode, running: mode + '中', paused: mode + '已暂停', done: mode + '完成' }[this.phase];
        this.dom.toggleIcon.setAttribute('name', this.isRunning ? 'pause-outline' : 'play-outline');
        this.dom.toggleText.textContent = action;
        if (this.dom.sound) this.dom.sound.checked = this.soundAlertEnabled;
        const builtIn = [15, 25, 45, 60].includes(this.workDuration / 60);
        document.querySelectorAll('.timer-presets .preset-btn').forEach(button => {
            const selected = this.currentMode === 'work' &&
                (builtIn ? Number(button.dataset.duration) * 60 === this.workDuration : button.id === 'preset-custom');
            button.classList.toggle('active', selected);
            button.setAttribute('aria-pressed', String(selected));
        });
        this.updateDisplay();
    },

    updateDisplay() {
        const state = this.summary();
        this.dom.digits.textContent = state.label;
        this.dom.progress.setAttribute('stroke-dashoffset', (this.dom.dialLength * (1 - state.remaining / state.duration)).toFixed(3));
        document.dispatchEvent(new CustomEvent('mindspace:focus-state', { detail: state }));
    },

    complete(notify) {
        if (this.clockWasReplaced()) {
            this.refreshClock();
            return;
        }
        this.stopInterval();
        this.lastRun = null;
        this.phase = 'done';
        this.persistClock();
        this.renderState();
        if (!notify || document.hidden) return;

        if (this.soundAlertEnabled) this.playAlarm();
        const work = this.currentMode === 'work';
        const title = work ? '专注完成' : '休息结束';
        const next = work ? '开始 5 分钟休息' : `开始 ${this.workDuration / 60} 分钟专注`;
        if (app.overlays.length || app.router.currentView !== 'focus') {
            app.showToast(title, { text: '查看', onClick: () => app.router.navigate('focus') });
            return;
        }
        app.showModal(title, work ? '<p>可以休息片刻，再开始下一轮。</p>' : '<p>准备好后，可以开始下一轮专注。</p>', [
            { text: '稍后', onClick: () => app.hideModal() },
            { text: next, class: 'primary-btn', onClick: () => {
                app.hideModal();
                this.start();
            }}
        ]);
    },

    /**
     * Prepare the local Web Audio alarm while the start action still has a user gesture.
     */
    prepareAlarm() {
        if (!this.soundAlertEnabled) return null;

        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) return null;

        if (!this.alarmAudioContext || this.alarmAudioContext.state === 'closed') {
            try { this.alarmAudioContext = new AudioContextClass(); }
            catch { return null; }
        }

        if (this.alarmAudioContext.state === 'suspended') {
            this.alarmAudioContext.resume().catch(error => {
                console.warn('Alarm audio context could not be resumed:', error);
            });
        }

        return this.alarmAudioContext;
    },

    /**
     * Play a short generated chime without fetching an external audio file.
     */
    playAlarm() {
        const context = this.prepareAlarm();
        if (!context) return;

        const playChime = () => {
            const startAt = context.currentTime + 0.03;
            const notes = [
                { delay: 0, frequency: 659.25 },
                { delay: 0.22, frequency: 783.99 },
                { delay: 0.44, frequency: 987.77 }
            ];

            notes.forEach(({ delay, frequency }) => {
                const oscillator = context.createOscillator();
                const gain = context.createGain();
                const noteStart = startAt + delay;
                const noteEnd = noteStart + 0.32;

                oscillator.type = 'sine';
                oscillator.frequency.setValueAtTime(frequency, noteStart);
                gain.gain.setValueAtTime(0.0001, noteStart);
                gain.gain.exponentialRampToValueAtTime(0.18, noteStart + 0.035);
                gain.gain.exponentialRampToValueAtTime(0.0001, noteEnd);

                oscillator.connect(gain);
                gain.connect(context.destination);
                oscillator.start(noteStart);
                oscillator.stop(noteEnd);
            });
        };

        if (context.state === 'suspended') {
            context.resume()
                .then(playChime)
                .catch(error => console.warn('Alarm playback blocked:', error));
            return;
        }

        playChime();
    }
};

const MindSpaceSoundMixer = {
    soundUrls: {
        rain: './assets/sounds/light-rain.mp3',
        waves: './assets/sounds/waves.mp3',
        wind: './assets/sounds/wind.mp3',
        campfire: './assets/sounds/campfire.mp3',
        birds: './assets/sounds/birds.mp3',
        cafe: './assets/sounds/cafe.mp3'
    },

    MIX_KEY: 'mindspace_audio_mix_v1',
    channels: new Map(),
    context: null,
    compressor: null,

    init() {
        let volumeByTrack = {};
        try { volumeByTrack = JSON.parse(localStorage.getItem(this.MIX_KEY)) ?? {}; }
        catch { /* Default channel levels still work. */ }
        for (const card of document.querySelectorAll('.sound-card[data-sound]')) {
            const id = card.dataset.sound;
            const button = card.querySelector('.sound-card-main');
            const slider = card.querySelector('.sound-volume-slider');
            const status = card.querySelector('.sound-status');
            const volumeValue = card.querySelector('.sound-volume-value');
            const volume = volumeByTrack[id];
            if (Number.isInteger(volume) && volume >= 0 && volume <= 100) slider.value = volume;
            volumeValue.textContent = slider.value + '%';
            const channel = { id, card, button, slider, status, audio: null, gain: null, timer: null, active: false, revision: 0 };
            this.channels.set(id, channel);
            button.addEventListener('click', () => this.toggle(channel));
            slider.addEventListener('input', () => {
                volumeValue.textContent = slider.value + '%';
                if (channel.active) this.adjust(channel, this.targetVolume(channel), 0.08);
            });
            slider.addEventListener('change', () => this.saveVolumes());
        }
        document.getElementById('btn-mixer-mute-all').onclick = () => this.muteAll();
        const prepare = document.getElementById('btn-cache-audio');
        if (prepare) prepare.onclick = () => window.MindSpaceOffline?.prepareSounds(Object.values(this.soundUrls));
        window.MindSpaceOffline?.refreshSoundStatus(Object.values(this.soundUrls));
    },

    saveVolumes() {
        const volumeByTrack = Object.fromEntries([...this.channels].map(([id, channel]) => [id, Number(channel.slider.value)]));
        try { localStorage.setItem(this.MIX_KEY, JSON.stringify(volumeByTrack)); }
        catch { /* Playback and volume remain available. */ }
    },

    clearStoredState() {
        localStorage.removeItem(this.MIX_KEY);
    },

    targetVolume(channel) {
        // Leave headroom when a few channels are combined.
        return Number(channel.slider.value) / 100 * 0.55;
    },

    prepare(channel) {
        if (channel.audio) return;
        const audio = new Audio(this.soundUrls[channel.id]);
        audio.loop = true;
        audio.preload = 'none';
        channel.audio = audio;
        audio.addEventListener('error', () => {
            if (channel.active) this.deactivate(channel, true, '暂时无法播放');
        });
        audio.addEventListener('waiting', () => {
            if (channel.active) channel.status.textContent = '正在缓冲';
        });
        audio.addEventListener('playing', () => {
            if (channel.active) channel.status.textContent = '正在播放';
        });
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) {
            audio.volume = 0;
            return;
        }

        try {
            if (!this.context) {
                this.context = new AudioContext();
                this.compressor = this.context.createDynamicsCompressor();
                this.compressor.threshold.value = -9;
                this.compressor.ratio.value = 8;
                this.compressor.connect(this.context.destination);
            }
            const source = this.context.createMediaElementSource(audio);
            channel.gain = this.context.createGain();
            channel.gain.gain.value = 0;
            source.connect(channel.gain);
            channel.gain.connect(this.compressor);
        } catch {
            audio.volume = 0;
        }
    },

    toggle(channel) {
        if (channel.active) {
            this.deactivate(channel);
            return;
        }
        this.prepare(channel);
        clearTimeout(channel.timer);
        const revision = ++channel.revision;
        this.setState(channel, true, '正在加载');
        this.context?.resume().catch(() => {});
        this.adjust(channel, this.targetVolume(channel), 0.24);
        channel.audio.play().then(() => {
            if (channel.active && channel.revision === revision) channel.status.textContent = '正在播放';
        }).catch(() => {
            if (channel.revision === revision) this.deactivate(channel, true, '暂时无法播放');
        });
    },

    adjust(channel, target, seconds) {
        if (!channel.audio) return;
        if (channel.gain) {
            const gain = channel.gain.gain;
            const now = this.context.currentTime;
            gain.cancelScheduledValues(now);
            gain.setTargetAtTime(target, now, Math.max(0.01, seconds / 4));
        } else {
            channel.audio.volume = target;
        }
    },

    setState(channel, active, message) {
        channel.active = active;
        channel.card.classList.toggle('active', active);
        channel.button.setAttribute('aria-pressed', String(active));
        channel.button.querySelector('.sound-toggle-indicator ion-icon').setAttribute('name', active ? 'pause-outline' : 'play-outline');
        channel.status.textContent = message;
        document.getElementById('btn-mixer-mute-all').disabled = ![...this.channels.values()].some(item => item.active);
    },

    deactivate(channel, immediately = false, message = '') {
        const revision = ++channel.revision;
        this.setState(channel, false, message);
        clearTimeout(channel.timer);
        this.adjust(channel, 0, immediately ? 0 : 0.2);
        if (immediately) channel.audio?.pause();
        else channel.timer = setTimeout(() => {
            if (channel.revision === revision) channel.audio?.pause();
        }, 230);
    },

    muteAll() {
        for (const channel of this.channels.values()) if (channel.active) this.deactivate(channel);
    },

    stopAllImmediate() {
        for (const channel of this.channels.values()) this.deactivate(channel, true);
    }
};

document.addEventListener('DOMContentLoaded', () => {
    MindSpaceFocusTimer.init();
    MindSpaceSoundMixer.init();
});
