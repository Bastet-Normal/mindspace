/**
 * MindSpace - Breathing Guide Controller
 * Controls the breathing cycles (4-7-8 and 5-5) with precise timers and visual states.
 */
const MindSpaceBreathing = {
    rhythms: {
        '478': {
            name: '4-7-8 深度安神',
            desc: '<div class="desc-rhythm"><span class="rhythm-badge">4-7-8</span> 吸气 4秒 → 憋气 7秒 → 呼气 8秒</div><p class="desc-text">源自古印度瑜伽的呼吸技术，被公认为“天然的镇静剂”。通过延长呼气时间，激活副交感神经，有助于迅速降低焦虑、平复心率并帮助入眠。</p>',
            steps: [
                { state: 'inhale', text: '吸气... 🫁', duration: 4000 },
                { state: 'hold', text: '屏住呼吸... 🕊️', duration: 7000 },
                { state: 'exhale', text: '呼气... 🍃', duration: 8000 }
            ]
        },
        '55': {
            name: '5-5 平衡呼吸',
            desc: '<div class="desc-rhythm"><span class="rhythm-badge">5-5</span> 吸气 5秒 → 呼气 5秒</div><p class="desc-text">经典的“共振呼吸”。通过使吸气与呼气时间等长，帮助调节自主神经系统，将心率变异性（HRV）调整至和谐状态，快速让身心达到平衡、稳定的高效状态。</p>',
            steps: [
                { state: 'inhale', text: '吸气... 🫁', duration: 5000 },
                { state: 'exhale', text: '呼气... 🍃', duration: 5000 }
            ]
        }
    },

    currentRhythm: '478',
    isActive: false,
    currentStepIndex: 0,
    cycleTimeout: null,
    totalSeconds: 0,
    totalInterval: null,

    // DOM Elements to bind
    dom: {
        orb: null,
        instruction: null,
        timer: null,
        desc: null
    },

    /**
     * Initialize elements
     */
    init(orbEl, instructionEl, timerEl, descEl) {
        this.dom.orb = orbEl;
        this.dom.instruction = instructionEl;
        this.dom.timer = timerEl;
        this.dom.desc = descEl || document.getElementById('breath-mode-desc');
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
        
        // Update timer UI immediately
        this.updateTimerDisplay();

        // Start session stopwatch
        this.totalInterval = setInterval(() => {
            this.totalSeconds++;
            this.updateTimerDisplay();
            if (typeof MindSpaceStorage !== 'undefined') {
                MindSpaceStorage.addBreathingTime(1);
            }
        }, 1000);

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
        
        // Reset orb classes & texts
        if (this.dom.orb) {
            this.dom.orb.style.transition = '';
            this.dom.orb.className = 'breath-orb';
        }
        if (this.dom.instruction) {
            this.dom.instruction.innerText = '';
        }
        
        this.cycleTimeout = null;
        this.totalInterval = null;
    },

    /**
     * Run steps in loop
     */
    runNextStep() {
        if (!this.isActive) return;

        const rhythm = this.rhythms[this.currentRhythm];
        const step = rhythm.steps[this.currentStepIndex];

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
    }
};
