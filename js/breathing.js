/**
 * MindSpace - Breathing Guide Controller
 * Controls the breathing cycles (4-7-8 and 5-5) with precise timers and visual states.
 * Features: Canvas Particle System, Tri-color transitions, Web Audio prompt sound.
 */
const MindSpaceBreathing = {
    rhythms: {
        '478': {
            name: '4-7-8 深度安神',
            desc: '<div class="desc-rhythm"><span class="rhythm-badge">4-7-8</span> 吸气 4秒 → 憋气 7秒 → 呼气 8秒</div><p class="desc-text">源自古印度瑜伽的呼吸技术，被公认为"天然的镇静剂"。通过延长呼气时间，激活副交感神经，有助于迅速降低焦虑、平复心率并帮助入眠。</p>',
            steps: [
                { state: 'inhale', text: '吸气... 🫁', duration: 4000 },
                { state: 'hold', text: '屏住呼吸... 🕊️', duration: 7000 },
                { state: 'exhale', text: '呼气... 🍃', duration: 8000 }
            ]
        },
        '55': {
            name: '5-5 平衡呼吸',
            desc: '<div class="desc-rhythm"><span class="rhythm-badge">5-5</span> 吸气 5秒 → 呼气 5秒</div><p class="desc-text">经典的"共振呼吸"。通过使吸气与呼气时间等长，帮助调节自主神经系统，将心率变异性（HRV）调整至和谐状态，快速让身心达到平衡、稳定的高效状态。</p>',
            steps: [
                { state: 'inhale', text: '吸气... 🫁', duration: 5000 },
                { state: 'exhale', text: '呼气... 🍃', duration: 5000 }
            ]
        }
    },

    // State color palette for particles (light theme defaults, CSS handles orb colors)
    stateColors: {
        inhale: { r: 184, g: 216, b: 232 },  // Sky blue
        hold:   { r: 212, g: 197, b: 226 },   // Lavender purple
        exhale: { r: 232, g: 213, b: 184 }    // Warm amber
    },

    currentRhythm: '478',
    isActive: false,
    currentStepIndex: 0,
    currentState: 'inhale',
    cycleTimeout: null,
    totalSeconds: 0,
    totalInterval: null,

    // Performance optimization: batch localStorage writes
    _accumulatedSeconds: 0,
    _storageFlushInterval: null,

    // Particle system
    _canvas: null,
    _ctx: null,
    _particles: [],
    _animFrameId: null,
    _lastSpawnTime: 0,

    // Web Audio API prompt sound
    soundPromptEnabled: false,
    _audioCtx: null,

    // DOM Elements to bind
    dom: {
        orb: null,
        instruction: null,
        timer: null,
        desc: null,
        canvas: null
    },

    /**
     * Initialize elements
     */
    init(orbEl, instructionEl, timerEl, descEl) {
        this.dom.orb = orbEl;
        this.dom.instruction = instructionEl;
        this.dom.timer = timerEl;
        this.dom.desc = descEl || document.getElementById('breath-mode-desc');

        // Setup canvas
        this._canvas = document.getElementById('breath-particle-canvas');
        if (this._canvas) {
            this.dom.canvas = this._canvas;
            this._ctx = this._canvas.getContext('2d');
        }

        // Detect dark theme for particle colors
        this._updateParticleColors();
    },

    /**
     * Update particle colors based on current theme
     */
    _updateParticleColors() {
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        if (isDark) {
            this.stateColors = {
                inhale: { r: 100, g: 160, b: 190 },
                hold:   { r: 140, g: 120, b: 170 },
                exhale: { r: 180, g: 155, b: 110 }
            };
        } else {
            this.stateColors = {
                inhale: { r: 184, g: 216, b: 232 },
                hold:   { r: 212, g: 197, b: 226 },
                exhale: { r: 232, g: 213, b: 184 }
            };
        }
    },

    /**
     * Change breathing rhythm
     */
    setRhythm(rhythmId) {
        if (this.rhythms[rhythmId]) {
            this.currentRhythm = rhythmId;
            if (this.dom.desc) {
                this.dom.desc.innerHTML = this.rhythms[rhythmId].desc;
            }
            if (this.isActive) {
                // Restart cycle with new rhythm
                this.stop();
                this.start();
            }
        }
    },

    /**
     * Start breathing session
     */
    start() {
        if (this.isActive) return;
        this.isActive = true;
        this.currentStepIndex = 0;
        this.totalSeconds = 0;
        this._accumulatedSeconds = 0;

        // Update theme-aware particle colors
        this._updateParticleColors();

        // Update timer UI immediately
        this.updateTimerDisplay();

        // Start session stopwatch
        this.totalInterval = setInterval(() => {
            this.totalSeconds++;
            this._accumulatedSeconds++;
            this.updateTimerDisplay();
        }, 1000);

        // Batch localStorage writes every 5 seconds
        this._storageFlushInterval = setInterval(() => {
            this._flushStorage();
        }, 5000);

        // Setup canvas dimensions and start particle animation
        this._setupCanvas();
        this._startParticleLoop();

        // Run cycle
        this.runNextStep();
    },

    /**
     * Stop breathing session
     */
    stop() {
        this.isActive = false;
        
        // Clear timers
        if (this.cycleTimeout) clearTimeout(this.cycleTimeout);
        if (this.totalInterval) clearInterval(this.totalInterval);
        if (this._storageFlushInterval) clearInterval(this._storageFlushInterval);

        // Flush remaining accumulated seconds to storage
        this._flushStorage();
        
        // Reset orb classes & texts
        if (this.dom.orb) {
            this.dom.orb.style.transition = '';
            this.dom.orb.className = 'breath-orb';
        }
        if (this.dom.instruction) {
            this.dom.instruction.innerText = '';
        }

        // Clean up canvas
        this._stopParticleLoop();
        
        this.cycleTimeout = null;
        this.totalInterval = null;
        this._storageFlushInterval = null;
    },

    /**
     * Flush accumulated seconds to MindSpaceStorage
     */
    _flushStorage() {
        if (this._accumulatedSeconds > 0 && typeof MindSpaceStorage !== 'undefined') {
            MindSpaceStorage.addBreathingTime(this._accumulatedSeconds);
            this._accumulatedSeconds = 0;
        }
    },

    /**
     * Run steps in loop
     */
    runNextStep() {
        if (!this.isActive) return;

        const rhythm = this.rhythms[this.currentRhythm];
        const step = rhythm.steps[this.currentStepIndex];

        // Update current state for particle system
        this.currentState = step.state;

        // Play phase transition prompt sound
        this._playPromptSound();

        // Apply visual state to orb (animates scale, color, and shadow in perfect sync over the full step duration)
        if (this.dom.orb) {
            this.dom.orb.style.transition = `transform ${step.duration}ms cubic-bezier(0.37, 0, 0.63, 1), background-color ${step.duration}ms ease-in-out, box-shadow ${step.duration}ms ease-in-out`;
            this.dom.orb.className = `breath-orb ${step.state}`;
        }

        // Apply text instruction
        if (this.dom.instruction) {
            this.dom.instruction.innerText = step.text;
        }

        // Schedule next step
        this.cycleTimeout = setTimeout(() => {
            this.currentStepIndex = (this.currentStepIndex + 1) % rhythm.steps.length;
            this.runNextStep();
        }, step.duration);
    },

    /**
     * Helper to update stopwatch text
     */
    updateTimerDisplay() {
        if (!this.dom.timer) return;
        const mins = String(Math.floor(this.totalSeconds / 60)).padStart(2, '0');
        const secs = String(this.totalSeconds % 60).padStart(2, '0');
        this.dom.timer.innerText = `本次已专注: ${mins}:${secs}`;
    },

    // =========================================================================
    //  CANVAS PARTICLE SYSTEM
    // =========================================================================

    /**
     * Setup canvas dimensions to match container
     */
    _setupCanvas() {
        if (!this._canvas) return;
        const container = this._canvas.parentElement;
        if (!container) return;
        const rect = container.getBoundingClientRect();
        this._canvas.width = rect.width * (window.devicePixelRatio || 1);
        this._canvas.height = rect.height * (window.devicePixelRatio || 1);
        this._ctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);
        // Store logical dimensions for particle calculations
        this._canvasW = rect.width;
        this._canvasH = rect.height;
    },

    /**
     * Start the particle animation loop
     */
    _startParticleLoop() {
        if (!this._ctx) return;
        this._particles = [];
        this._lastSpawnTime = 0;

        const loop = (timestamp) => {
            if (!this.isActive) return;
            this._updateAndDrawParticles(timestamp);
            this._animFrameId = requestAnimationFrame(loop);
        };
        this._animFrameId = requestAnimationFrame(loop);
    },

    /**
     * Stop the particle animation loop and clear the canvas
     */
    _stopParticleLoop() {
        if (this._animFrameId) {
            cancelAnimationFrame(this._animFrameId);
            this._animFrameId = null;
        }
        this._particles = [];
        if (this._ctx && this._canvas) {
            this._ctx.setTransform(1, 0, 0, 1, 0, 0);
            this._ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);
        }
    },

    /**
     * Core particle update and draw function
     */
    _updateAndDrawParticles(timestamp) {
        if (!this._ctx) return;
        const ctx = this._ctx;
        const w = this._canvasW;
        const h = this._canvasH;
        const cx = w / 2;
        const cy = h / 2;

        // Clear canvas
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);
        const dpr = window.devicePixelRatio || 1;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        // Spawn particles based on current state
        const spawnInterval = this.currentState === 'hold' ? 300 : 180;
        if (timestamp - this._lastSpawnTime > spawnInterval) {
            this._spawnParticles(cx, cy, w, h);
            this._lastSpawnTime = timestamp;
        }

        const color = this.stateColors[this.currentState] || this.stateColors.inhale;

        // Update and draw each particle
        for (let i = this._particles.length - 1; i >= 0; i--) {
            const p = this._particles[i];
            p.life -= 0.008;

            if (p.life <= 0) {
                this._particles.splice(i, 1);
                continue;
            }

            // Movement based on breathing state
            if (this.currentState === 'inhale') {
                // Converge inward toward center
                const dx = cx - p.x;
                const dy = cy - p.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist > 5) {
                    p.x += (dx / dist) * p.speed;
                    p.y += (dy / dist) * p.speed;
                }
                // Fade as approaching center
                if (dist < 40) p.life -= 0.02;
            } else if (this.currentState === 'hold') {
                // Orbit slowly around center
                const dx = p.x - cx;
                const dy = p.y - cy;
                const angle = Math.atan2(dy, dx);
                const dist = Math.sqrt(dx * dx + dy * dy);
                const targetDist = 55 + p.orbitOffset;
                const newAngle = angle + p.orbitSpeed;
                const blendDist = dist + (targetDist - dist) * 0.02;
                p.x = cx + Math.cos(newAngle) * blendDist;
                p.y = cy + Math.sin(newAngle) * blendDist;
            } else if (this.currentState === 'exhale') {
                // Radiate outward from center
                const dx = p.x - cx;
                const dy = p.y - cy;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < 1) {
                    const angle = Math.random() * Math.PI * 2;
                    p.x = cx + Math.cos(angle);
                    p.y = cy + Math.sin(angle);
                } else {
                    p.x += (dx / dist) * p.speed;
                    p.y += (dy / dist) * p.speed;
                }
                // Fade as moving outward
                const edgeDist = Math.min(p.x, p.y, w - p.x, h - p.y);
                if (edgeDist < 30) p.life -= 0.03;
            }

            // Draw particle
            const alpha = Math.min(p.life, 1) * 0.7;
            const size = p.radius * (0.5 + p.life * 0.5);

            // Glow
            ctx.beginPath();
            const gradient = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, size * 3);
            gradient.addColorStop(0, `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha * 0.5})`);
            gradient.addColorStop(1, `rgba(${color.r}, ${color.g}, ${color.b}, 0)`);
            ctx.fillStyle = gradient;
            ctx.arc(p.x, p.y, size * 3, 0, Math.PI * 2);
            ctx.fill();

            // Core
            ctx.beginPath();
            ctx.fillStyle = `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})`;
            ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
            ctx.fill();
        }

        // Limit max particles for performance
        if (this._particles.length > 60) {
            this._particles.splice(0, this._particles.length - 60);
        }
    },

    /**
     * Spawn new particles based on the current breathing state
     */
    _spawnParticles(cx, cy, w, h) {
        const count = this.currentState === 'hold' ? 1 : 2;

        for (let i = 0; i < count; i++) {
            const p = {
                life: 1.0,
                radius: 2 + Math.random() * 3,
                speed: 0.6 + Math.random() * 0.8,
                orbitSpeed: (0.005 + Math.random() * 0.008) * (Math.random() > 0.5 ? 1 : -1),
                orbitOffset: -15 + Math.random() * 30
            };

            if (this.currentState === 'inhale') {
                // Spawn at edges, converge inward
                const edge = Math.floor(Math.random() * 4);
                switch (edge) {
                    case 0: p.x = Math.random() * w; p.y = -5; break;       // top
                    case 1: p.x = Math.random() * w; p.y = h + 5; break;    // bottom
                    case 2: p.x = -5; p.y = Math.random() * h; break;       // left
                    case 3: p.x = w + 5; p.y = Math.random() * h; break;    // right
                }
            } else if (this.currentState === 'hold') {
                // Spawn in orbital ring area
                const angle = Math.random() * Math.PI * 2;
                const dist = 45 + Math.random() * 25;
                p.x = cx + Math.cos(angle) * dist;
                p.y = cy + Math.sin(angle) * dist;
            } else if (this.currentState === 'exhale') {
                // Spawn near center, radiate outward
                const angle = Math.random() * Math.PI * 2;
                const dist = 5 + Math.random() * 15;
                p.x = cx + Math.cos(angle) * dist;
                p.y = cy + Math.sin(angle) * dist;
            }

            this._particles.push(p);
        }
    },

    // =========================================================================
    //  WEB AUDIO API PROMPT SOUND
    // =========================================================================

    /**
     * Toggle sound prompt on/off
     */
    toggleSoundPrompt(enabled) {
        this.soundPromptEnabled = enabled;
        // Initialize AudioContext on first enable (requires user gesture context)
        if (enabled && !this._audioCtx) {
            try {
                this._audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            } catch (e) {
                // Web Audio API not supported
                this.soundPromptEnabled = false;
            }
        }
    },

    /**
     * Play a subtle 'ding' at phase transition (soft sine wave, ~523Hz C5 note, 200ms)
     */
    _playPromptSound() {
        if (!this.soundPromptEnabled || !this._audioCtx) return;

        try {
            // Resume context if suspended (browser autoplay policy)
            if (this._audioCtx.state === 'suspended') {
                this._audioCtx.resume();
            }

            const ctx = this._audioCtx;
            const now = ctx.currentTime;

            // Create oscillator - soft sine wave at C5 (523.25 Hz)
            const osc = ctx.createOscillator();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(523.25, now);

            // Create gain envelope for smooth fade-in/fade-out
            const gain = ctx.createGain();
            gain.gain.setValueAtTime(0, now);
            gain.gain.linearRampToValueAtTime(0.08, now + 0.02);  // Quick attack
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2); // Gentle decay

            osc.connect(gain);
            gain.connect(ctx.destination);

            osc.start(now);
            osc.stop(now + 0.22);

            // Cleanup
            osc.onended = () => {
                osc.disconnect();
                gain.disconnect();
            };
        } catch (e) {
            // Silently fail if audio can't play
        }
    }
};
