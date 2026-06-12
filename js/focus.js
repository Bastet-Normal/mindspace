/**
 * MindSpace - Focus Cabin & Soundscapes Mixer Controller
 * Implements a Pomodoro Focus Timer with circular SVG progress, preset/custom durations,
 * and a multi-track Ambient Sound Mixer with smooth volume fades.
 */

const MindSpaceFocusTimer = {
    // Timer State
    duration: 25 * 60, // Total duration in seconds (default 25 min)
    timeLeft: 25 * 60, // Time left in seconds
    timerId: null,
    isRunning: false,
    currentMode: 'work', // 'work' or 'break'
    soundAlertEnabled: true,
    alarmAudio: null,
    _pendingFocusSeconds: 0,

    // SVG Config
    CIRCUMFERENCE: 596.9, // 2 * Math.PI * 95

    // DOM Elements
    dom: {
        pane: null,
        digits: null,
        label: null,
        toggleBtn: null,
        toggleIcon: null,
        toggleText: null,
        resetBtn: null,
        circleProgress: null,
        soundAlertCheckbox: null
    },

    /**
     * Initialize the focus timer UI and event handlers
     */
    init() {
        this.dom.pane = document.querySelector('.focus-pane-left');
        this.dom.digits = document.getElementById('timer-digits');
        this.dom.label = document.getElementById('timer-label');
        this.dom.toggleBtn = document.getElementById('btn-timer-toggle');
        this.dom.toggleIcon = document.getElementById('timer-toggle-icon');
        this.dom.toggleText = document.getElementById('timer-toggle-text');
        this.dom.resetBtn = document.getElementById('btn-timer-reset');
        this.dom.circleProgress = document.querySelector('.timer-circle-progress');
        this.dom.soundAlertCheckbox = document.getElementById('timer-sound-alert');

        if (!this.dom.digits) return; // Guard clause if elements are not present

        // Set initial state
        this.resetState();

        // Bind button controls
        this.dom.toggleBtn.addEventListener('click', () => this.toggle());
        this.dom.resetBtn.addEventListener('click', () => this.reset());

        // Bind preset options
        document.querySelectorAll('.timer-presets .preset-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                if (btn.id === 'preset-custom') {
                    this.openCustomDurationModal();
                } else {
                    const minutes = parseInt(btn.dataset.duration, 10);
                    if (minutes) {
                        // Deactivate all preset buttons
                        document.querySelectorAll('.timer-presets .preset-btn').forEach(b => b.classList.remove('active'));
                        btn.classList.add('active');
                        this.setDuration(minutes);
                    }
                }
            });
        });

        // Bind options toggles
        if (this.dom.soundAlertCheckbox) {
            this.dom.soundAlertCheckbox.addEventListener('change', (e) => {
                this.soundAlertEnabled = e.target.checked;
            });
        }

        // Lazy load Alarm sound
        this.alarmAudio = new Audio('https://raw.githubusercontent.com/remvze/moodist/main/public/sounds/alarm.mp3');
        this.alarmAudio.volume = 0.5;
    },

    /**
     * Reset local values to initial state
     */
    resetState() {
        this.pause();
        this.currentMode = 'work';
        this.dom.label.innerText = '专注于当下';
        
        // Find active preset
        const activePreset = document.querySelector('.timer-presets .preset-btn.active');
        if (activePreset && activePreset.id !== 'preset-custom') {
            const minutes = parseInt(activePreset.dataset.duration, 10);
            this.duration = minutes * 60;
        } else {
            this.duration = 25 * 60;
        }
        
        this.timeLeft = this.duration;
        this.updateDisplay();
    },

    /**
     * Set a new duration
     */
    setDuration(minutes) {
        this.pause();
        this.duration = minutes * 60;
        this.timeLeft = this.duration;
        this.updateDisplay();
    },

    /**
     * Set custom duration from user input
     */
    setCustomDuration(minutes) {
        // Highlight custom preset button
        document.querySelectorAll('.timer-presets .preset-btn').forEach(b => b.classList.remove('active'));
        document.getElementById('preset-custom').classList.add('active');
        this.setDuration(minutes);
    },

    /**
     * Open custom duration modal
     */
    openCustomDurationModal() {
        if (typeof app === 'undefined') return;
        
        app.showModal('自定义专注时间', `
            <div class="form-group" style="margin-top: 10px;">
                <label for="custom-focus-minutes" style="font-size: 0.85rem; color: var(--text-muted);">请输入专注分钟数 (1-180 分钟)</label>
                <input type="number" id="custom-focus-minutes" min="1" max="180" value="25" style="margin-top: 6px;">
            </div>
        `, [
            { text: '取消', class: 'secondary-btn', onClick: () => app.hideModal() },
            { text: '确定', class: 'primary-btn', onClick: () => {
                const inputEl = document.getElementById('custom-focus-minutes');
                const minutes = parseInt(inputEl.value, 10);
                if (minutes && minutes >= 1 && minutes <= 180) {
                    this.setCustomDuration(minutes);
                    app.hideModal();
                } else {
                    app.showModal('输入无效', '请输入 1 到 180 之间的有效专注分钟数。', [
                        { text: '好的', class: 'secondary-btn', onClick: () => app.hideModal() }
                    ]);
                }
            }}
        ]);
    },

    /**
     * Toggle between running and paused
     */
    toggle() {
        if (this.isRunning) {
            this.pause();
        } else {
            this.start();
        }
    },

    /**
     * Start the countdown
     */
    start() {
        if (this.isRunning) return;

        // Mutual Exclusion: Terminate breathing exercise if running
        if (typeof MindSpaceBreathing !== 'undefined' && MindSpaceBreathing.isActive) {
            MindSpaceBreathing.stop();
            const breathStartBtn = document.getElementById('start-breath-btn');
            const breathStopBtn = document.getElementById('stop-breath-btn');
            if (breathStartBtn) breathStartBtn.classList.remove('hidden');
            if (breathStopBtn) breathStopBtn.classList.add('hidden');
        }

        this.isRunning = true;
        this.dom.pane.classList.add('timer-running');

        // Toggle buttons UI
        this.dom.toggleIcon.setAttribute('name', 'pause-outline');
        this.dom.toggleText.innerText = '暂停';

        // Ticking logic
        this.timerId = setInterval(() => {
            this.timeLeft--;
            this.updateDisplay();

            if (this.currentMode === 'work') {
                this._pendingFocusSeconds++;
                if (this._pendingFocusSeconds >= 5) {
                    if (typeof MindSpaceStorage !== 'undefined') {
                        MindSpaceStorage.addFocusTime(this._pendingFocusSeconds);
                    }
                    this._pendingFocusSeconds = 0;
                }
            }

            if (this.timeLeft <= 0) {
                this.complete();
            }
        }, 1000);
    },

    /**
     * Pause the countdown
     */
    pause() {
        if (!this.isRunning) return;

        // Flush pending focus seconds
        if (this._pendingFocusSeconds > 0 && this.currentMode === 'work') {
            if (typeof MindSpaceStorage !== 'undefined') {
                MindSpaceStorage.addFocusTime(this._pendingFocusSeconds);
            }
            this._pendingFocusSeconds = 0;
        }

        this.isRunning = false;
        clearInterval(this.timerId);
        this.timerId = null;

        this.dom.pane.classList.remove('timer-running');

        // Toggle buttons UI
        this.dom.toggleIcon.setAttribute('name', 'play-outline');
        this.dom.toggleText.innerText = this.currentMode === 'work' ? '继续专注' : '继续休息';
    },

    /**
     * Reset countdown
     */
    reset() {
        this.pause();
        this.timeLeft = this.duration;
        this.updateDisplay();
        
        this.dom.toggleText.innerText = this.currentMode === 'work' ? '开始专注' : '开始休息';
    },

    /**
     * Update digital display and circular SVG stroke-dashoffset
     */
    updateDisplay() {
        // Digital display digits
        const mins = String(Math.floor(this.timeLeft / 60)).padStart(2, '0');
        const secs = String(this.timeLeft % 60).padStart(2, '0');
        this.dom.digits.innerText = `${mins}:${secs}`;

        // SVG progress stroke offset
        if (this.dom.circleProgress) {
            const ratio = this.timeLeft / this.duration;
            const offset = this.CIRCUMFERENCE * (1 - ratio);
            this.dom.circleProgress.style.strokeDashoffset = offset.toFixed(2);
        }
    },

    /**
     * Triggered when timer hits 0
     */
    complete() {
        // Flush pending focus seconds before completing
        if (this._pendingFocusSeconds > 0 && this.currentMode === 'work') {
            if (typeof MindSpaceStorage !== 'undefined') {
                MindSpaceStorage.addFocusTime(this._pendingFocusSeconds);
            }
            this._pendingFocusSeconds = 0;
        }

        this.pause();

        // Play alarm sound if enabled
        if (this.soundAlertEnabled && this.alarmAudio) {
            this.alarmAudio.currentTime = 0;
            this.alarmAudio.play().catch(e => console.warn('Audio playback blocked:', e));
        }

        // Show finishing modal
        if (this.currentMode === 'work') {
            app.showModal('专注完成 ✨', `
                <div style="text-align: center; padding: 10px 0;">
                    <p style="font-size: 1.1rem; font-weight: 500; margin-bottom: 8px;">太棒了，你已成功完成了本次专注！</p>
                    <p style="color: var(--text-muted); font-size: 0.85rem;">给大脑放个短假吧，感受轻松的一吸一呼。</p>
                </div>
            `, [
                { text: '稍后开始', class: 'secondary-btn', onClick: () => {
                    this.switchToMode('break');
                    app.hideModal();
                }},
                { text: '进入 5分钟 休息', class: 'primary-btn', onClick: () => {
                    this.switchToMode('break', 5);
                    app.hideModal();
                    this.start(); // Auto-start break
                }}
            ]);
        } else {
            app.showModal('休息结束 🌿', `
                <div style="text-align: center; padding: 10px 0;">
                    <p style="font-size: 1.1rem; font-weight: 500; margin-bottom: 8px;">休息时间结束，精力已恢复。</p>
                    <p style="color: var(--text-muted); font-size: 0.85rem;">准备好开启新一轮的专注疗愈了吗？</p>
                </div>
            `, [
                { text: '稍后开启', class: 'secondary-btn', onClick: () => {
                    this.switchToMode('work');
                    app.hideModal();
                }},
                { text: '开启 25分钟 专注', class: 'primary-btn', onClick: () => {
                    this.switchToMode('work', 25);
                    app.hideModal();
                    this.start(); // Auto-start work
                }}
            ]);
        }
    },

    /**
     * Switch timer mode ('work' | 'break')
     */
    switchToMode(mode, durationMinutes = null) {
        this.currentMode = mode;
        
        if (mode === 'work') {
            this.dom.label.innerText = '专注于当下';
            const minutes = durationMinutes || 25;
            this.duration = minutes * 60;
        } else {
            this.dom.label.innerText = '小憩片刻';
            const minutes = durationMinutes || 5;
            this.duration = minutes * 60;
        }

        this.timeLeft = this.duration;
        this.updateDisplay();
        this.dom.toggleText.innerText = mode === 'work' ? '开始专注' : '开始休息';
    }
};

const MindSpaceSoundMixer = {
    // Tracks presets
    soundUrls: {
        rain: './assets/sounds/light-rain.mp3',
        waves: './assets/sounds/waves.mp3',
        wind: './assets/sounds/wind.mp3',
        campfire: './assets/sounds/campfire.mp3',
        birds: './assets/sounds/birds.mp3',
        cafe: './assets/sounds/cafe.mp3'
    },

    // Mixer state
    channels: {},

    /**
     * Initialize sound mixer events
     */
    init() {
        // Build empty channel states
        Object.keys(this.soundUrls).forEach(id => {
            this.channels[id] = {
                audio: null,
                isActive: false,
                targetVolume: 0.5, // Default volume (0.0 to 1.0)
                fadeInterval: null
            };
        });

        // Bind Sound Cards Click
        document.querySelectorAll('.soundscape-grid .sound-card').forEach(card => {
            const soundId = card.dataset.sound;
            
            // Toggle active state on clicking the main block
            const mainArea = card.querySelector('.sound-card-main');
            mainArea.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleChannel(soundId, card);
            });

            // Prevent card toggle when sliding range input
            const slider = card.querySelector('.sound-volume-slider');
            slider.addEventListener('click', (e) => {
                e.stopPropagation();
            });

            // Handle slider input
            slider.addEventListener('input', (e) => {
                const val = parseInt(e.target.value, 10) / 100;
                this.setVolume(soundId, val);
            });
        });

        // Global pause button
        const muteAllBtn = document.getElementById('btn-mixer-mute-all');
        if (muteAllBtn) {
            muteAllBtn.addEventListener('click', () => this.muteAll());
        }
    },

    /**
     * Toggle a sound channel active/inactive
     */
    toggleChannel(soundId, cardEl) {
        const channel = this.channels[soundId];
        if (!channel) return;

        // Initialize audio lazily upon first interaction (to comply with browser autoplay blocks)
        if (!channel.audio) {
            channel.audio = new Audio(this.soundUrls[soundId]);
            channel.audio.loop = true;
            channel.audio.volume = 0; // Start at 0 for fade in
        }

        const slider = cardEl.querySelector('.sound-volume-slider');
        const statusEl = cardEl.querySelector('.sound-status');

        if (channel.isActive) {
            // Deactivate channel with a smooth fade-out
            channel.isActive = false;
            cardEl.classList.remove('active');
            slider.disabled = true;
            statusEl.innerText = '已静音';
            this.fadeOut(channel);
        } else {
            // Activate channel with a smooth fade-in
            channel.isActive = true;
            cardEl.classList.add('active');
            slider.disabled = false;
            statusEl.innerText = '播放中';
            this.fadeIn(channel);
        }
    },

    /**
     * Live volume slider updates
     */
    setVolume(soundId, value) {
        const channel = this.channels[soundId];
        if (!channel) return;

        channel.targetVolume = value;
        
        // If playing and not currently fading, adjust audio volume immediately
        if (channel.isActive && !channel.fadeInterval && channel.audio) {
            channel.audio.volume = value;
        }
    },

    /**
     * Smoothly fades in a channel to target volume
     */
    fadeIn(channel) {
        if (!channel.audio) return;
        
        clearInterval(channel.fadeInterval);
        channel.fadeInterval = null;

        // Start audio playing if paused
        if (channel.audio.paused) {
            channel.audio.play().catch(err => {
                console.warn('Playback block or loading error:', err);
            });
        }

        let currentVol = channel.audio.volume;
        const target = channel.targetVolume;

        channel.fadeInterval = setInterval(() => {
            currentVol += 0.05;
            if (currentVol >= target) {
                currentVol = target;
                clearInterval(channel.fadeInterval);
                channel.fadeInterval = null;
            }
            channel.audio.volume = currentVol;
        }, 50);
    },

    /**
     * Smoothly fades out a channel to 0 and pauses
     */
    fadeOut(channel) {
        if (!channel.audio || channel.audio.paused) return;

        clearInterval(channel.fadeInterval);
        channel.fadeInterval = null;

        let currentVol = channel.audio.volume;

        channel.fadeInterval = setInterval(() => {
            currentVol -= 0.05;
            if (currentVol <= 0) {
                currentVol = 0;
                clearInterval(channel.fadeInterval);
                channel.fadeInterval = null;
                channel.audio.pause();
            }
            channel.audio.volume = currentVol;
        }, 50);
    },

    /**
     * Global mute/pause all active channels (with a smooth fade out)
     */
    muteAll() {
        Object.keys(this.channels).forEach(soundId => {
            const channel = this.channels[soundId];
            if (channel && channel.isActive) {
                // Find matching card UI to toggle visual classes
                const cardEl = document.querySelector(`.soundscape-grid .sound-card[data-sound="${soundId}"]`);
                if (cardEl) {
                    const slider = cardEl.querySelector('.sound-volume-slider');
                    const statusEl = cardEl.querySelector('.sound-status');
                    
                    channel.isActive = false;
                    cardEl.classList.remove('active');
                    if (slider) slider.disabled = true;
                    if (statusEl) statusEl.innerText = '已静音';
                }
                this.fadeOut(channel);
            }
        });
    },

    /**
     * Stop and reset all audio objects (immediate pause)
     */
    stopAllImmediate() {
        Object.keys(this.channels).forEach(soundId => {
            const channel = this.channels[soundId];
            if (channel && channel.audio) {
                clearInterval(channel.fadeInterval);
                channel.fadeInterval = null;
                channel.audio.pause();
                channel.audio.volume = 0;
                channel.isActive = false;

                const cardEl = document.querySelector(`.soundscape-grid .sound-card[data-sound="${soundId}"]`);
                if (cardEl) {
                    const slider = cardEl.querySelector('.sound-volume-slider');
                    const statusEl = cardEl.querySelector('.sound-status');
                    cardEl.classList.remove('active');
                    if (slider) slider.disabled = true;
                    if (statusEl) statusEl.innerText = '已静音';
                }
            }
        });
    }
};

// Bind to window load
document.addEventListener('DOMContentLoaded', () => {
    // If the focus view elements exist, initialize
    if (document.getElementById('view-focus')) {
        MindSpaceFocusTimer.init();
        MindSpaceSoundMixer.init();
    }
});
