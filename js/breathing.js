const MindSpaceBreathing = {
    rhythms: {
        '55': {
            description: '保持自然，不必刻意吸满。',
            steps: [
                { state: 'inhale', label: '吸气', text: '慢慢吸气', seconds: 5 },
                { state: 'exhale', label: '呼气', text: '慢慢呼气', seconds: 5 }
            ]
        },
        '478': {
            description: '如果屏息不舒服，可以停下，或换成平衡呼吸。',
            steps: [
                { state: 'inhale', label: '吸气', text: '慢慢吸气', seconds: 4 },
                { state: 'hold', label: '屏息', text: '轻轻屏息', seconds: 7 },
                { state: 'exhale', label: '呼气', text: '慢慢呼气', seconds: 8 }
            ]
        }
    },

    currentRhythm: '55',
    isActive: false,
    suspendedAt: null,
    currentPhase: null,
    soundEnabled: false,
    audioContext: null,
    interval: null,
    dom: {},

    init(stage, instruction, timer, description) {
        this.dom = {
            stage, instruction, timer, description,
            countdown: document.getElementById('breath-phase-seconds')
        };
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) this.suspend();
            else this.resume();
        });
        window.addEventListener('pagehide', () => this.suspend());
        window.addEventListener('pageshow', () => this.resume());
        this.setRhythm(this.currentRhythm);
    },

    setRhythm(mode) {
        if (!Object.hasOwn(this.rhythms, mode)) return;
        const rhythm = this.rhythms[mode];
        const steps = rhythm.steps.map(step =>
            `<div class="breath-step"><dt>${step.label}</dt><dd><strong>${step.seconds}</strong> 秒</dd></div>`
        ).join('');
        this.dom.description.innerHTML = `<dl class="breath-steps">${steps}</dl>
            <p class="desc-text">${rhythm.description}</p>`;
        this.currentRhythm = mode;
        if (this.isActive) {
            this.phaseStartedAt = Date.now();
            this.currentPhase = null;
            this.tick();
        }
    },

    start(duration = null) {
        if (this.isActive) return;
        this.isActive = true;
        this.suspendedAt = null;
        this.duration = duration;
        this.startedAt = Date.now();
        this.phaseStartedAt = this.startedAt;
        this.savedSeconds = 0;
        this.elapsedSeconds = 0;
        this.storageErrorShown = false;
        this.currentPhase = null;
        if (this.soundEnabled && this.audioContext) this.audioContext.resume().catch(() => {});
        this.tick();
        this.interval = setInterval(() => this.tick(), 125);
    },

    stop() {
        if (!this.isActive) return;
        this.tick(true, false);
        this.isActive = false;
        this.suspendedAt = null;
        clearInterval(this.interval);
        this.interval = null;
        this.currentPhase = null;
        this.dom.stage.style.removeProperty('--breath-scale');
        delete this.dom.stage.dataset.phase;
        this.dom.instruction.textContent = '';
        this.dom.countdown.textContent = '';
    },

    suspend() {
        if (!this.isActive || this.suspendedAt !== null) return;
        const now = Date.now();
        this.tick(true, false);
        this.suspendedAt = now;
    },

    resume() {
        if (!this.isActive || this.suspendedAt === null || document.hidden) return;
        const delay = Math.max(0, Date.now() - this.suspendedAt);
        this.startedAt += delay;
        this.phaseStartedAt += delay;
        this.suspendedAt = null;
        this.currentPhase = null;
        this.tick();
    },

    tick(flush = false, complete = true) {
        if (!this.isActive || this.suspendedAt !== null) return;
        const now = Date.now();
        const elapsed = Math.max(this.elapsedSeconds, Math.floor((now - this.startedAt) / 1000), 0);
        this.elapsedSeconds = Math.min(elapsed, this.duration ?? Infinity);
        const minutes = String(Math.floor(this.elapsedSeconds / 60)).padStart(2, '0');
        const seconds = String(this.elapsedSeconds % 60).padStart(2, '0');
        const text = this.duration
            ? `本次练习 ${minutes}:${seconds} / 01:00`
            : `本次练习 ${minutes}:${seconds}`;
        if (this.dom.timer.textContent !== text) this.dom.timer.textContent = text;

        const finished = this.duration === this.elapsedSeconds;
        const pending = this.elapsedSeconds - this.savedSeconds;
        if (pending > 0 && (flush || finished || pending >= 5)) {
            try {
                MindSpaceStorage.addBreathingTime(pending, this.startedAt + this.elapsedSeconds * 1000);
                this.savedSeconds = this.elapsedSeconds;
            } catch (error) {
                if (!this.storageErrorShown) app.showToast(error.message);
                this.storageErrorShown = true;
            }
        }

        if (finished && complete) {
            document.dispatchEvent(new Event('mindspace:breathing-complete'));
            return;
        }
        const { steps } = this.rhythms[this.currentRhythm];
        const cycleSeconds = steps.reduce((sum, step) => sum + step.seconds, 0);
        let position = (Math.max(0, now - this.phaseStartedAt) / 1000) % cycleSeconds;
        const phase = steps.find(step => {
            if (position < step.seconds) return true;
            position -= step.seconds;
            return false;
        });
        const remaining = String(Math.ceil(phase.seconds - position));
        if (this.dom.countdown.textContent !== remaining) this.dom.countdown.textContent = remaining;
        const fraction = position / phase.seconds;
        const expansion = phase.state === 'hold' ? 1 : phase.state === 'inhale' ? fraction : 1 - fraction;
        const eased = expansion * expansion * (3 - 2 * expansion);
        this.dom.stage.style.setProperty('--breath-scale', (1 + eased * .20).toFixed(3));
        if (phase.state !== this.currentPhase) {
            this.currentPhase = phase.state;
            this.dom.stage.dataset.phase = phase.state;
            this.dom.instruction.textContent = phase.text;
            if (!document.hidden) this.playTone();
        }
    },

    toggleSoundPrompt(enabled) {
        this.soundEnabled = enabled;
        if (!enabled) return;
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        try {
            this.audioContext ||= new AudioContext();
            this.audioContext.resume().catch(() => {});
        } catch { /* Visual guidance remains available. */ }
    },

    playTone() {
        const context = this.audioContext;
        if (!this.soundEnabled || context?.state !== 'running') return;
        const now = context.currentTime;
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.frequency.value = 523.25;
        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(0.065, now + 0.025);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start(now);
        oscillator.stop(now + 0.23);
        oscillator.onended = () => {
            oscillator.disconnect();
            gain.disconnect();
        };
    }
};
