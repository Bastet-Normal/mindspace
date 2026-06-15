/**
 * MindSpace - Main Application Logic & SPA Router
 * Coordinates UI states, theme toggles, modal alerts, and interactive event handlers.
 * Supports dual-navigation sync (Mobile bottom nav & Desktop sidebar).
 */

const APP_VERSION = String(window.MINDSPACE_VERSION || "0.0.0");
const RELEASES_URL = "https://github.com/wangjiehu/mindspace/releases";

// Global App Instance
const app = {
    // Auth Cache State
    currentUser: null,
    authChecked: false,
    authGateActive: false,

    // Router State
    router: {
        currentView: 'dashboard',
        
        /**
         * Navigate to a view
         */
        navigate(viewId) {
            // Stop breathing session if navigating away
            if (this.currentView === 'breathing' && viewId !== 'breathing') {
                MindSpaceBreathing.stop();
                const startBtn = document.getElementById('start-breath-btn');
                const stopBtn = document.getElementById('stop-breath-btn');
                startBtn.classList.remove('hidden');
                stopBtn.classList.add('hidden');
            }

            this.currentView = viewId;
            
            // Toggle active view class in HTML
            document.querySelectorAll('.app-view').forEach(view => {
                view.classList.remove('active');
            });
            const targetView = document.getElementById(`view-${viewId}`);
            if (targetView) targetView.classList.add('active');

            // Update bottom nav & sidebar active states in sync
            document.querySelectorAll('.nav-item, .sidebar-item').forEach(item => {
                if (item.dataset.view === viewId) {
                    item.classList.add('active');
                } else {
                    item.classList.remove('active');
                }
            });

            // View-specific initializations
            if (viewId === 'dashboard') {
                app.renderDashboard();
            } else if (viewId === 'weather') {
                app.resetWeatherForm();
            } else if (viewId === 'journal') {
                app.renderJournalList();
            } else if (viewId === 'insights') {
                app.renderInsights();
            } else if (viewId === 'settings') {
                // No specific render needed, just show
            }
            
            // Scroll content view back to top
            document.getElementById('app-content').scrollTop = 0;
        }
    },

    // Selected tags in current weather log form
    selectedTags: new Set(),

    /**
     * Initialization Function
     */
    async init() {
        const versionElement = document.getElementById('current-app-version');
        if (versionElement) versionElement.innerText = `v${APP_VERSION}`;

        // Initialize Theme
        this.initTheme();

        // Bind SPA Navigation Click events (bottom nav & desktop sidebar)
        document.querySelectorAll('.nav-item, .sidebar-item').forEach(item => {
            item.addEventListener('click', () => {
                const viewId = item.dataset.view;
                if (viewId) {
                    this.router.navigate(viewId);
                }
            });
        });

        // Initialize Breathing Guide
        MindSpaceBreathing.init(
            document.getElementById('breath-orb'),
            document.getElementById('breath-instruction'),
            document.getElementById('breath-total-time'),
            document.getElementById('breath-mode-desc'),
            document.getElementById('breath-particle-canvas')
        );

        // Initialize Supabase Service
        if (window.SupabaseService) {
            window.SupabaseService.init();
            await this.updateAuthUI().catch((error) => {
                console.warn('云账户状态检查失败，已继续使用本地模式。', error);
            });
        }

        // Bind Events
        this.bindEvents();

        // Render Initial Dashboard
        this.renderDashboard();

        // Require account login before use when cloud auth is configured.
        this.enforceStartupAuth();
    },

    /**
     * Theme management (supporting dual switches)
     */
    initTheme() {
        const settings = MindSpaceStorage.getSettings();
        const themeBtn = document.getElementById('theme-toggle');
        const sidebarThemeBtn = document.getElementById('sidebar-theme-toggle');
        const themeIcon = document.getElementById('theme-icon');
        const sidebarThemeIcon = document.querySelector('.sidebar-theme-icon');
        
        // System preference default
        let activeTheme = settings.theme;
        if (!activeTheme) {
            const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
            activeTheme = prefersDark ? 'dark' : 'light';
        }

        const applyTheme = (theme) => {
            if (theme === 'dark') {
                document.body.setAttribute('data-theme', 'dark');
                if (themeIcon) themeIcon.setAttribute('name', 'sunny-outline');
                if (sidebarThemeIcon) sidebarThemeIcon.setAttribute('name', 'sunny-outline');
            } else {
                document.body.removeAttribute('data-theme');
                if (themeIcon) themeIcon.setAttribute('name', 'moon-outline');
                if (sidebarThemeIcon) sidebarThemeIcon.setAttribute('name', 'moon-outline');
            }
        };

        // Apply theme initially
        applyTheme(activeTheme);

        // Toggle helper
        const toggleTheme = () => {
            const currentTheme = document.body.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
            const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
            
            applyTheme(newTheme);

            const updatedSettings = MindSpaceStorage.getSettings();
            updatedSettings.theme = newTheme;
            MindSpaceStorage.saveSettings(updatedSettings);
        };

        // Bind click events on both buttons
        if (themeBtn) themeBtn.addEventListener('click', toggleTheme);
        if (sidebarThemeBtn) sidebarThemeBtn.addEventListener('click', toggleTheme);
    },

    /**
     * Dynamic Greetings & Random comforting quotes on dashboard
     */
    renderDashboard() {
        const hour = new Date().getHours();
        const greetingText = document.getElementById('greeting-text');
        const greetingSub = document.getElementById('greeting-sub');

        // Dynamic Chinese Greeting
        if (hour >= 5 && hour < 12) {
            greetingText.innerText = "早上好，旅人";
            greetingSub.innerText = "朝阳升起，今天也是崭新的一天。慢慢呼吸，开启轻松的一天吧。";
        } else if (hour >= 12 && hour < 14) {
            greetingText.innerText = "中午好，旅人";
            greetingSub.innerText = "午间微歇。喝杯水，放松双肩，让思想也打个盹。";
        } else if (hour >= 14 && hour < 18) {
            greetingText.innerText = "下午好，旅人";
            greetingSub.innerText = "日光倾斜。若有些许疲倦，不妨允许自己放慢一会儿脚步。";
        } else {
            greetingText.innerText = "夜深了, 旅人";
            greetingSub.innerText = "把今天所有的酸甜苦辣都卸下吧。被窝很暖，心空也很安全，晚安。";
        }

        // Quote fetching
        const quote = MindSpaceQuotes.getRandomQuote();
        document.getElementById('quote-content').innerText = `"${quote.text}"`;
        document.getElementById('quote-author').innerText = `— ${quote.author}`;

        // 1. Render Mindfulness Rings
        this.renderMindfulnessRings();

        // 2. Render Today's Mood Widget
        this.renderTodayMoodWidget();

        // 3. Render Weekly Climate Outlook
        this.renderWeeklyClimateOutlook();

        // 4. Render Latest Journal Preview
        this.renderLatestJournalPreview();
    },

    /**
     * Render SVG Mindfulness Rings on Dashboard
     */
    renderMindfulnessRings() {
        const stats = MindSpaceStorage.getTodayStats();
        
        // Goals: Breathing 10 mins (600s), Focus 50 mins (3000s)
        const breathingGoal = 10 * 60;
        const focusGoal = 50 * 60;

        const breathingPercent = Math.min(100, (stats.breathingSeconds / breathingGoal) * 100);
        const focusPercent = Math.min(100, (stats.focusSeconds / focusGoal) * 100);

        // Update progress circles
        const focusCircumference = 345.57; // 2 * PI * 55
        const breathingCircumference = 251.32; // 2 * PI * 40

        const focusCircle = document.querySelector('.focus-ring-progress');
        const breathingCircle = document.querySelector('.breathing-ring-progress');

        if (focusCircle) {
            const offset = focusCircumference * (1 - focusPercent / 100);
            focusCircle.style.strokeDashoffset = offset.toFixed(2);
        }
        if (breathingCircle) {
            const offset = breathingCircumference * (1 - breathingPercent / 100);
            breathingCircle.style.strokeDashoffset = offset.toFixed(2);
        }

        // Update legend texts
        const focusText = document.getElementById('focus-ring-text');
        const breathingText = document.getElementById('breathing-ring-text');

        if (focusText) {
            const currentMins = (stats.focusSeconds / 60).toFixed(1);
            focusText.innerText = `⏱️ 专注: ${currentMins} / 50分钟`;
        }
        if (breathingText) {
            const currentMins = (stats.breathingSeconds / 60).toFixed(1);
            breathingText.innerText = `🧘 呼吸: ${currentMins} / 10分钟`;
        }
    },

    /**
     * Render Today's Mood status Widget
     */
    renderTodayMoodWidget() {
        const logs = MindSpaceStorage.getLogs();
        const widgetContainer = document.getElementById('widget-today-weather');
        if (!widgetContainer) return;

        const todayDateStr = new Date().toDateString();
        const todayLog = logs.find(log => new Date(log.timestamp).toDateString() === todayDateStr);

        if (todayLog) {
            const weatherConfig = MindSpaceStorage.WEATHER_MAP[todayLog.weather] || { name: '未知', emoji: '✨' };
            const noteText = todayLog.note ? todayLog.note : '未记录絮语';
            
            // Build dynamic mini icon structure
            let visualHTML = '';
            if (todayLog.weather === 'sunny') {
                visualHTML = `<div class="weather-visual sunny-anim"><ion-icon name="sunny" class="sun-core"></ion-icon><div class="sun-halo"></div></div>`;
            } else if (todayLog.weather === 'breezy') {
                visualHTML = `<div class="weather-visual breezy-anim"><ion-icon name="leaf" class="leaf-icon"></ion-icon><div class="wind-trail wind-trail-1"></div><div class="wind-trail wind-trail-2"></div></div>`;
            } else if (todayLog.weather === 'cloudy') {
                visualHTML = `<div class="weather-visual cloudy-anim"><ion-icon name="cloudy" class="cloud-front"></ion-icon><ion-icon name="cloud" class="cloud-back"></ion-icon></div>`;
            } else if (todayLog.weather === 'foggy') {
                visualHTML = `<div class="weather-visual foggy-anim"><ion-icon name="cloud" class="fog-cloud"></ion-icon><div class="fog-mist fog-mist-1"></div><div class="fog-mist fog-mist-2"></div></div>`;
            } else if (todayLog.weather === 'rainy') {
                visualHTML = `<div class="weather-visual rainy-anim"><ion-icon name="rainy" class="rain-cloud"></ion-icon><div class="raindrop raindrop-1"></div><div class="raindrop raindrop-2"></div><div class="raindrop raindrop-3"></div></div>`;
            } else if (todayLog.weather === 'stormy') {
                visualHTML = `<div class="weather-visual stormy-anim"><ion-icon name="thunderstorm" class="storm-cloud"></ion-icon><div class="lightning-bolt"><ion-icon name="flash"></ion-icon></div><div class="raindrop raindrop-1"></div><div class="raindrop raindrop-2"></div></div>`;
            } else {
                visualHTML = `<span style="font-size: 1.8rem;">${weatherConfig.emoji}</span>`;
            }

            widgetContainer.innerHTML = `
                <h4><ion-icon name="cloudy-outline"></ion-icon>今日内心天气</h4>
                <div class="logged-mood-container">
                    <div class="logged-mood-display">
                        <div class="logged-mood-icon-wrapper" data-weather="${todayLog.weather}">
                            ${visualHTML}
                        </div>
                        <div class="logged-mood-info">
                            <div class="logged-mood-name">${weatherConfig.name}</div>
                            <div class="logged-mood-note-preview">${escapeHTML(noteText)}</div>
                        </div>
                    </div>
                    <button class="secondary-btn small-btn" onclick="app.router.navigate('weather')" style="width: auto; font-size: 0.75rem; padding: 4px 12px;">重新记录</button>
                </div>
            `;
        } else {
            widgetContainer.innerHTML = `
                <h4><ion-icon name="cloudy-outline"></ion-icon>今日内心天气</h4>
                <div class="widget-placeholder">
                    <div class="placeholder-content">
                        <ion-icon name="cloudy-night-outline" class="placeholder-icon"></ion-icon>
                        <p>今天还没有记录内心天气哦</p>
                    </div>
                    <button class="primary-btn small-btn" style="flex-shrink: 0;" onclick="app.router.navigate('weather')">去记录</button>
                </div>
            `;
        }
    },

    /**
     * Render Weekly Mood trends chart
     */
    renderWeeklyClimateOutlook() {
        const trendsContainer = document.getElementById('trends-chart-container');
        if (!trendsContainer) return;

        const logs = MindSpaceStorage.getLogs();
        if (logs.length === 0) {
            trendsContainer.innerHTML = `<div class="chart-empty">本周心空尚未留下气象痕迹，待你落笔描摹。</div>`;
            return;
        }

        const dayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
        const weeklyStats = [];
        
        for (let i = 6; i >= 0; i--) {
            const targetDate = new Date();
            targetDate.setDate(targetDate.getDate() - i);
            const targetDateStr = targetDate.toDateString();
            
            const logsOnDay = logs.filter(log => new Date(log.timestamp).toDateString() === targetDateStr);
            const mood = logsOnDay.length > 0 ? logsOnDay[0].weather : null;
            weeklyStats.push({
                dayLabel: targetDate.toDateString() === new Date().toDateString() ? '今天' : dayNames[targetDate.getDay()],
                mood: mood
            });
        }

        const moodWeights = {
            sunny: 5,
            breezy: 4,
            cloudy: 3,
            foggy: 2.5,
            rainy: 2,
            stormy: 1
        };

        let chartHTML = '';
        weeklyStats.forEach(day => {
            const emoji = day.mood ? (MindSpaceStorage.WEATHER_MAP[day.mood]?.emoji || '✨') : '';
            const weight = day.mood ? moodWeights[day.mood] : 0;
            const barHeightPercent = day.mood ? (weight / 5) * 100 : 0;
            
            chartHTML += `
                <div class="chart-bar-wrapper">
                    <span class="chart-bar-emoji">${emoji || '·'}</span>
                    <div class="chart-bar-track">
                        <div class="chart-bar-fill" style="height: ${barHeightPercent}%; ${day.mood ? `background: var(--weather-${day.mood}-text, var(--accent-color));` : ''}"></div>
                    </div>
                    <span class="chart-bar-label">${day.dayLabel}</span>
                </div>
            `;
        });

        trendsContainer.innerHTML = chartHTML;
    },

    /**
     * Render Latest Journal Note preview on Dashboard
     */
    renderLatestJournalPreview() {
        const previewContainer = document.getElementById('journal-preview-content');
        if (!previewContainer) return;

        const logs = MindSpaceStorage.getLogs();
        const latestWithNote = logs.find(log => log.note && log.note.trim().length > 0);

        if (latestWithNote) {
            const formattedDate = MindSpaceStorage.formatDate(latestWithNote.timestamp).split(' ')[0];
            const weatherInfo = MindSpaceStorage.WEATHER_MAP[latestWithNote.weather] || { name: latestWithNote.weather, emoji: '✨' };
            const previewText = latestWithNote.note;
            
            previewContainer.innerHTML = `
                <div class="journal-preview-header">
                    <span class="journal-preview-date">${formattedDate}</span>
                    <span class="journal-preview-tag">${weatherInfo.emoji} ${weatherInfo.name}</span>
                </div>
                <p class="journal-preview-text">${escapeHTML(previewText)}</p>
                <div style="text-align: right; margin-top: 8px;">
                    <a href="javascript:void(0)" onclick="app.router.navigate('journal')" style="font-size: 0.75rem; color: var(--accent-color); text-decoration: none; font-weight: 500;">查看全部随笔 &rarr;</a>
                </div>
            `;
        } else {
            previewContainer.innerHTML = `
                <div style="display: flex; align-items: center; justify-content: space-between; height: 100%;">
                    <p class="empty-preview" style="margin: 0; text-align: left;">写下今日第一声内心絮语，留存温润心迹。</p>
                    <button class="primary-btn small-btn" onclick="app.router.navigate('weather')" style="width: auto; flex-shrink: 0; display: inline-flex; align-items: center; gap: 6px; box-shadow: 0 4px 12px var(--accent-glow);">
                        <ion-icon name="create-outline"></ion-icon>
                        <span>写随笔</span>
                    </button>
                </div>
            `;
        }
    },

    /**
     * Reset Weather & Mood logs input fields
     */
    resetWeatherForm() {
        this.selectedTags.clear();
        
        // Reset radio
        const firstRadio = document.querySelector('input[name="selected-weather"]');
        if (firstRadio) {
            firstRadio.checked = true;
            const viewWeather = document.getElementById('view-weather');
            if (viewWeather) {
                viewWeather.setAttribute('data-active-weather', firstRadio.value);
            }
        }

        // Reset note textarea
        document.getElementById('mood-note').value = '';

        // Render tags list
        this.renderTagsSelector();
    },

    /**
     * Render tag pills in mood logger
     */
    renderTagsSelector() {
        const settings = MindSpaceStorage.getSettings();
        const tagsContainer = document.getElementById('mood-tags-list');
        tagsContainer.innerHTML = '';

        settings.customTags.forEach(tag => {
            const pill = document.createElement('button');
            pill.className = 'mood-tag';
            if (this.selectedTags.has(tag)) {
                pill.classList.add('selected');
            }
            pill.innerText = tag;
            pill.addEventListener('click', () => {
                if (this.selectedTags.has(tag)) {
                    this.selectedTags.delete(tag);
                    pill.classList.remove('selected');
                } else {
                    this.selectedTags.add(tag);
                    pill.classList.add('selected');
                }
            });
            tagsContainer.appendChild(pill);
        });
    },

    /**
     * Render the Journal view list
     */
    renderJournalList() {
        const logs = MindSpaceStorage.getLogs();
        const searchVal = document.getElementById('journal-search').value.toLowerCase().trim();
        const journalList = document.getElementById('journal-list');
        const journalEmpty = document.getElementById('journal-empty');

        journalList.innerHTML = '';

        // Filter logs
        const filteredLogs = logs.filter(log => {
            if (!searchVal) return true;

            const weatherInfo = MindSpaceStorage.WEATHER_MAP[log.weather] || { name: '', emoji: '' };
            const weatherMatch = weatherInfo.name.toLowerCase().includes(searchVal);
            const tagMatch = log.tags.some(tag => tag.toLowerCase().includes(searchVal));
            const noteMatch = log.note.toLowerCase().includes(searchVal);

            return weatherMatch || tagMatch || noteMatch;
        });

        if (filteredLogs.length === 0) {
            journalEmpty.classList.remove('hidden');
            journalList.classList.add('hidden');
            return;
        }

        journalEmpty.classList.add('hidden');
        journalList.classList.remove('hidden');

        // Create cards
        filteredLogs.forEach(log => {
            const card = document.createElement('div');
            card.className = `journal-card card ${log.weather}`;
            
            const weatherInfo = MindSpaceStorage.WEATHER_MAP[log.weather] || { name: log.weather, emoji: '✨' };
            const timeStr = MindSpaceStorage.formatDate(log.timestamp);

            // Tags HTML
            let tagsHtml = '';
            if (log.tags && log.tags.length > 0) {
                tagsHtml = `<div class="journal-tags">` + 
                    log.tags.map(t => `<span class="tag">${escapeHTML(t)}</span>`).join('') + 
                    `</div>`;
            }

            // Note preview HTML
            const notePreview = log.note ? `<p class="journal-note-preview">${escapeHTML(log.note)}</p>` : `<p class="journal-note-preview" style="font-style: italic; opacity: 0.6;">(记录了天气状态)</p>`;

            card.innerHTML = `
                <div class="journal-card-body">
                    <div class="journal-card-header">
                        <div class="journal-weather-info">
                            <span class="journal-weather-dot"></span>
                            <span class="journal-weather-name">${weatherInfo.emoji} ${weatherInfo.name}</span>
                        </div>
                        <span class="journal-time">${timeStr}</span>
                    </div>
                    ${tagsHtml}
                    ${notePreview}
                </div>
                <button class="journal-delete-btn" title="删除记录" onclick="event.stopPropagation(); app.confirmDeleteLog('${log.id}')">
                    <ion-icon name="trash-outline"></ion-icon>
                </button>
            `;

            // Click card to open modal detail
            card.addEventListener('click', () => {
                app.openJournalDetail(log);
            });

            journalList.appendChild(card);
        });
    },

    /**
     * Open details modal for a single journal entry
     */
    openJournalDetail(log) {
        const weatherInfo = MindSpaceStorage.WEATHER_MAP[log.weather] || { name: log.weather, emoji: '✨' };
        const timeStr = MindSpaceStorage.formatDate(log.timestamp);
        
        let tagsHtml = '';
        if (log.tags && log.tags.length > 0) {
            tagsHtml = `<div class="journal-tags" style="margin-bottom: 12px;">` + 
                log.tags.map(t => `<span class="tag">${escapeHTML(t)}</span>`).join('') + 
                `</div>`;
        }

        const noteHtml = log.note ? 
            `<div class="modal-diary-text">${escapeHTML(log.note)}</div>` : 
            `<p style="font-style: italic; color: var(--text-muted);">本条随笔未记录文字。</p>`;

        const bodyHtml = `
            <div style="margin-bottom: 10px; font-size: 0.85rem; color: var(--text-muted); display:flex; justify-content:space-between;">
                <span>内心天气: <strong>${weatherInfo.emoji} ${weatherInfo.name}</strong></span>
                <span>时间: ${timeStr}</span>
            </div>
            ${tagsHtml}
            ${noteHtml}
        `;

        this.showModal('随笔详情', bodyHtml, [
            { text: '关闭', class: 'secondary-btn', onClick: () => this.hideModal() }
        ]);
    },

    /**
     * Delete log helper with confirmation
     */
    confirmDeleteLog(id) {
        this.showModal('删除确认', '确定要删除这条心声记录吗？删除后将无法恢复，不过它仍然是您经历过的一部分。', [
            { text: '取消', class: 'secondary-btn', onClick: () => this.hideModal() },
            { text: '确定删除', class: 'danger-btn', onClick: async () => {
                await MindSpaceStorage.deleteLog(id);
                this.hideModal();
                this.renderJournalList();
            }}
        ]);
    },

    /**
     * Render insights distribution charts
     */
    calculateClimateIndex(logs, now = Date.now()) {
        const dayMs = 24 * 60 * 60 * 1000;
        const weekMs = 7 * dayMs;
        const freshnessMs = 3 * dayMs;
        const weatherScores = {
            sunny: 100,
            breezy: 85,
            cloudy: 60,
            foggy: 50,
            rainy: 35,
            stormy: 15
        };

        const recentLogs = logs
            .map(log => ({
                ...log,
                timestamp: Number(log.timestamp)
            }))
            .filter(log => {
                if (!Number.isFinite(log.timestamp) || weatherScores[log.weather] === undefined) return false;
                const ageMs = Math.max(0, now - log.timestamp);
                return ageMs <= weekMs;
            });

        const hasFreshLog = recentLogs.some(log => Math.max(0, now - log.timestamp) <= freshnessMs);
        if (!hasFreshLog) {
            return {
                score: null,
                reason: recentLogs.length > 0 ? 'stale' : 'empty',
                usedCount: recentLogs.length
            };
        }

        let weightedSum = 0;
        let totalWeight = 0;
        recentLogs.forEach(log => {
            const ageMs = Math.max(0, now - log.timestamp);
            const freshnessRatio = 1 - Math.min(ageMs, weekMs) / weekMs;
            const weight = 1 + freshnessRatio * 6;
            weightedSum += weatherScores[log.weather] * weight;
            totalWeight += weight;
        });

        return {
            score: totalWeight > 0 ? Math.round(weightedSum / totalWeight) : null,
            reason: totalWeight > 0 ? 'ok' : 'empty',
            usedCount: recentLogs.length
        };
    },

    renderInsights() {
        const logs = MindSpaceStorage.getLogs();
        const totalCount = logs.length;
        
        document.getElementById('stat-total-days').innerText = totalCount;

        // Calculate frequencies
        const counts = { sunny: 0, breezy: 0, cloudy: 0, foggy: 0, rainy: 0, stormy: 0 };
        logs.forEach(log => {
            if (counts[log.weather] !== undefined) {
                counts[log.weather]++;
            }
        });

        // Determine most frequent weather
        let maxCount = 0;
        let topWeather = '-';
        Object.entries(counts).forEach(([weatherKey, count]) => {
            if (count > maxCount) {
                maxCount = count;
                const weatherInfo = MindSpaceStorage.WEATHER_MAP[weatherKey];
                topWeather = weatherInfo ? `${weatherInfo.emoji} ${weatherInfo.name}` : weatherKey;
            }
        });
        document.getElementById('stat-top-weather').innerText = totalCount > 0 ? topWeather : '-';

        // Update weather icon if we have a top weather
        const statWeatherIcon = document.getElementById('stat-weather-icon');
        if (statWeatherIcon) {
            const weatherIconMap = {
                sunny: 'sunny-outline',
                breezy: 'leaf-outline',
                cloudy: 'cloudy-outline',
                foggy: 'cloud-outline',
                rainy: 'rainy-outline',
                stormy: 'thunderstorm-outline'
            };
            let topWeatherKey = null;
            Object.entries(counts).forEach(([weatherKey, count]) => {
                if (count === maxCount && count > 0) {
                    topWeatherKey = weatherKey;
                }
            });
            if (topWeatherKey && weatherIconMap[topWeatherKey]) {
                statWeatherIcon.setAttribute('name', weatherIconMap[topWeatherKey]);
            } else {
                statWeatherIcon.setAttribute('name', 'cloudy-outline');
            }
        }

        const climateIndex = this.calculateClimateIndex(logs);
        const score = climateIndex.score;

        const gaugeProgress = document.getElementById('climate-gauge-progress');
        const gaugeValue = document.getElementById('climate-gauge-value');
        const gaugeStatus = document.getElementById('climate-gauge-status');
        const gaugeTip = document.getElementById('climate-gauge-tip');

        if (score !== null) {
            gaugeValue.innerText = score;
            
            // Circumference of radius 42 is 263.89
            const circumference = 263.89;
            const offset = circumference * (1 - score / 100);
            
            if (gaugeProgress) {
                setTimeout(() => {
                    gaugeProgress.style.strokeDashoffset = offset;
                }, 50);
            }

            if (score >= 80) {
                gaugeStatus.innerText = '澄澈';
                gaugeTip.innerHTML = '近期内心晴朗安稳，能量饱满。不妨将这份富足分享给生活中的小细节。';
            } else if (score >= 50) {
                gaugeStatus.innerText = '微澜';
                gaugeTip.innerHTML = '心境偶有泛起涟漪，总体尚平稳。保持深呼吸，允许情绪如水流过。';
            } else {
                gaugeStatus.innerText = '阴雨';
                gaugeTip.innerHTML = '内心经历着阴雨的冲刷。当前心理负担偏重，请多休息或开启正念呼吸，并在必要时寻求心理中心帮助。';
            }
        } else {
            gaugeValue.innerText = '--';
            if (gaugeProgress) {
                gaugeProgress.style.strokeDashoffset = 263.89;
            }
            if (climateIndex.reason === 'stale') {
                gaugeStatus.innerText = '待更新';
                gaugeTip.innerHTML = '最近三天还没有新的内心天气记录，晴空指数暂不显示。补上一条近期记录后，将按最近七天并偏重近况重新计算。';
            } else {
                gaugeStatus.innerText = '觉察中';
                gaugeTip.innerHTML = '记录最近七天的内心天气，获取更贴近当下的心灵晴空指数。';
            }
        }

        // Render Cumulative Statistics
        const cumulativeStats = MindSpaceStorage.getCumulativeStats();
        const totalMindfulMinutes = cumulativeStats.totalFocusMinutes + cumulativeStats.totalBreathingMinutes;
        
        const focusEl = document.getElementById('stat-cumulative-focus');
        if (focusEl) {
            focusEl.innerText = `${totalMindfulMinutes}分`;
        }
        
        const streakEl = document.getElementById('stat-mindful-streak');
        if (streakEl) {
            streakEl.innerText = `${cumulativeStats.streak}天`;
        }

        // 1. Render Weather Calendar Grid (Past 30 Days)
        const logsByDate = {};
        logs.forEach(log => {
            const dateStr = new Date(log.timestamp).toDateString();
            if (!logsByDate[dateStr] || new Date(log.timestamp) > new Date(logsByDate[dateStr].timestamp)) {
                logsByDate[dateStr] = log;
            }
        });

        const gridContainer = document.getElementById('weather-calendar-grid');
        if (gridContainer) {
            gridContainer.innerHTML = '';
            for (let i = 29; i >= 0; i--) {
                const targetDate = new Date();
                targetDate.setDate(targetDate.getDate() - i);
                const dateStr = targetDate.toDateString();
                const displayDay = targetDate.getDate();

                const log = logsByDate[dateStr];
                const dayEl = document.createElement('div');
                dayEl.className = 'calendar-day';
                dayEl.innerText = displayDay;

                const monthStr = targetDate.getMonth() + 1;
                const readableDate = `${monthStr}月${displayDay}日`;

                if (log) {
                    const weatherInfo = MindSpaceStorage.WEATHER_MAP[log.weather] || { name: '未知', emoji: '✨' };
                    dayEl.classList.add('has-weather', log.weather);

                    let titleText = `${readableDate}：${weatherInfo.emoji} ${weatherInfo.name}`;

                    if (log.note && log.note.trim()) {
                        dayEl.classList.add('has-note');
                        titleText += ' (已记录随笔，点击阅读)';

                        dayEl.addEventListener('click', () => {
                            app.openJournalDetail(log);
                        });
                    } else {
                        dayEl.addEventListener('click', () => {
                            app.showModal('心情气象', `${readableDate}，您的内心天气是 **${weatherInfo.emoji} ${weatherInfo.name}**。当天没有记录文字随笔。`, [
                                { text: '好的', class: 'secondary-btn', onClick: () => app.hideModal() }
                            ]);
                        });
                    }
                    dayEl.setAttribute('title', titleText);
                } else {
                    dayEl.setAttribute('title', `${readableDate}：无记录`);
                    dayEl.addEventListener('click', () => {
                        app.showModal('心灵气象历', `${readableDate} 还没有记录心灵气象。`, [
                            { text: '去记录心灵气象', class: 'primary-btn', onClick: () => {
                                app.hideModal();
                                app.router.navigate('weather');
                            }},
                            { text: '关闭', class: 'secondary-btn', onClick: () => app.hideModal() }
                        ]);
                    });
                }
                gridContainer.appendChild(dayEl);
            }
        }

        // 2. Render Comfort Advice
        const comfortContainer = document.getElementById('weather-calendar-comfort');
        if (comfortContainer) {
            let comfortMsg = '';
            if (totalCount === 0) {
                comfortMsg = '“心灵的气象如同四季更替，接纳它的起起落落。写下你的第一笔随笔，开启你的心灵气象台吧。”';
            } else {
                const sortedWeathers = Object.entries(counts).sort((a, b) => b[1] - a[1]);
                const primaryWeather = sortedWeathers[0][0];

                if (primaryWeather === 'sunny') {
                    comfortMsg = '🍃 <strong>气象暖评</strong>：最近你的心空中阳光明媚。多在户外走走，保存好这段温暖，愿它在你阴雨天时为你提供温暖的光芒。';
                } else if (primaryWeather === 'breezy') {
                    comfortMsg = '🍃 <strong>气象暖评</strong>：微风拂面，最近你的心境大多处于平静舒适的状态。继续保持正念呼吸，感受每一个轻松的当下。';
                } else if (primaryWeather === 'cloudy') {
                    comfortMsg = '🍃 <strong>气象暖评</strong>：最近内心云朵偏多。多云只是阳光暂歇的日常，允许自己有一些低落与沉静，抱一抱正在歇息的自己。';
                } else if (primaryWeather === 'foggy') {
                    comfortMsg = '🍃 <strong>气象暖评</strong>：最近内心被大雾笼罩，或许方向有些模糊。慢下来，看不清前路时就专注当下的呼吸，雾气总有散去的时候。';
                } else if (primaryWeather === 'rainy') {
                    comfortMsg = '🍃 <strong>气象暖评</strong>：最近内心在下着温柔的小雨。雨水能洗涤尘土，也是滋润生命的养分，给自己泡杯热茶，听听雨声，好好休息。';
                } else if (primaryWeather === 'stormy') {
                    comfortMsg = '🍃 <strong>气象暖评</strong>：最近内心雷雨交加，你正经历着情绪的起伏。请记住，雷雨终会过去，不要独自面对，安全避风港 (SOS) 随时为您守候。';
                } else {
                    comfortMsg = '🍃 <strong>气象暖评</strong>：内心的天气如同四季更替，每一天都是最自然的显现。接纳风雨，静待天晴。';
                }
            }
            comfortContainer.innerHTML = comfortMsg;
        }

        // 3. Render Weather Distribution Chart with Micro-Animations
        const container = document.getElementById('weather-chart-container');
        container.innerHTML = '';

        const weathers = ['sunny', 'breezy', 'cloudy', 'foggy', 'rainy', 'stormy'];

        weathers.forEach(w => {
            const count = counts[w];
            const percent = totalCount > 0 ? Math.round((count / totalCount) * 100) : 0;
            const info = MindSpaceStorage.WEATHER_MAP[w];

            const row = document.createElement('div');
            row.className = 'chart-row';
            row.innerHTML = `
                <span class="chart-label">${info.emoji} ${info.name}</span>
                <div class="chart-track">
                    <div class="chart-fill ${w}" style="width: 0%"></div>
                </div>
                <span class="chart-percent">${percent}%</span>
            `;
            container.appendChild(row);

            // Animate width transition
            setTimeout(() => {
                const fillEl = row.querySelector('.chart-fill');
                if (fillEl) fillEl.style.width = `${percent}%`;
            }, 50);
        });

        // 4. Render Lifestyle Tag Analysis with Micro-Animations
        const tagCounts = {};
        logs.forEach(log => {
            if (log.tags && Array.isArray(log.tags)) {
                log.tags.forEach(tag => {
                    tagCounts[tag] = (tagCounts[tag] || 0) + 1;
                });
            }
        });

        const sortedTags = Object.entries(tagCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5);

        const tagsContainer = document.getElementById('tags-analysis-container');
        if (tagsContainer) {
            tagsContainer.innerHTML = '';
            if (sortedTags.length === 0) {
                tagsContainer.innerHTML = `<div class="empty-analysis-text">暂无要素关联分析，记录内心天气并选择相关因子后将自动展现。</div>`;
            } else {
                const maxTagCount = sortedTags[0][1];
                sortedTags.forEach(([tag, count]) => {
                    const percent = Math.round((count / maxTagCount) * 100);
                    const tagRow = document.createElement('div');
                    tagRow.className = 'tag-analysis-row';
                    tagRow.innerHTML = `
                        <span class="tag-analysis-name" title="${escapeHTML(tag)}">${escapeHTML(tag)}</span>
                        <div class="tag-analysis-track">
                            <div class="tag-analysis-fill" style="width: 0%"></div>
                        </div>
                        <span class="tag-analysis-count">${count}次</span>
                    `;
                    tagsContainer.appendChild(tagRow);

                    // Animate width transition
                    setTimeout(() => {
                        const fillEl = tagRow.querySelector('.tag-analysis-fill');
                        if (fillEl) fillEl.style.width = `${percent}%`;
                    }, 50);
                });
            }
        }
    },

    /**
     * Event bindings
     */
    bindEvents() {
        // Change weather background transition dynamically
        document.querySelectorAll('input[name="selected-weather"]').forEach(radio => {
            radio.addEventListener('change', (e) => {
                const viewWeather = document.getElementById('view-weather');
                if (viewWeather) {
                    viewWeather.setAttribute('data-active-weather', e.target.value);
                }
            });
        });

        // Log Weather Save Action
        document.getElementById('save-log-btn').addEventListener('click', async () => {
            const selectedRadio = document.querySelector('input[name="selected-weather"]:checked');
            if (!selectedRadio) return;

            const weatherVal = selectedRadio.value;
            const noteVal = document.getElementById('mood-note').value;
            const tagsArr = Array.from(this.selectedTags);

            // Save
            await MindSpaceStorage.saveLog(weatherVal, tagsArr, noteVal);

            // Pop success confirmation
            this.showModal('已记入心空', '您的心灵气象已保存在本地，接纳心空的起伏与风雨。', [
                { text: '查看随笔', class: 'secondary-btn', onClick: () => {
                    this.hideModal();
                    this.router.navigate('journal');
                }},
                { text: '好的', class: 'secondary-btn', onClick: () => {
                    this.hideModal();
                    this.router.navigate('dashboard');
                }}
            ]);
        });

        // Custom Tag Addition
        const addCustomTag = () => {
            const tagInput = document.getElementById('custom-tag-input');
            const tagVal = tagInput.value.trim();
            if (!tagVal) return;

            const settings = MindSpaceStorage.getSettings();
            
            // Add if not duplicates
            if (!settings.customTags.includes(tagVal)) {
                settings.customTags.push(tagVal);
                MindSpaceStorage.saveSettings(settings);
                this.selectedTags.add(tagVal); // Select it by default
                this.renderTagsSelector();
            }
            
            tagInput.value = '';
        };

        document.getElementById('add-custom-tag-btn').addEventListener('click', addCustomTag);
        document.getElementById('custom-tag-input').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                addCustomTag();
            }
        });

        // Breathing controls
        const startBtn = document.getElementById('start-breath-btn');
        const stopBtn = document.getElementById('stop-breath-btn');

        startBtn.addEventListener('click', () => {
            // Mutual Exclusion: Pause Focus Timer if running
            if (typeof MindSpaceFocusTimer !== 'undefined' && MindSpaceFocusTimer.isRunning) {
                MindSpaceFocusTimer.pause();
            }
            MindSpaceBreathing.start();
            startBtn.classList.add('hidden');
            stopBtn.classList.remove('hidden');
        });

        stopBtn.addEventListener('click', () => {
            MindSpaceBreathing.stop();
            startBtn.classList.remove('hidden');
            stopBtn.classList.add('hidden');
        });

        // Rhythm mode switching tabs
        document.querySelectorAll('.mode-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.mode-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                const rhythmId = tab.dataset.rhythm;
                MindSpaceBreathing.setRhythm(rhythmId);
            });
        });

        // Breathing sound prompt toggle
        const breathSoundToggle = document.getElementById('breath-sound-prompt');
        if (breathSoundToggle) {
            breathSoundToggle.addEventListener('change', (e) => {
                MindSpaceBreathing.toggleSoundPrompt(e.target.checked);
            });
        }

        // Search in journal typing
        document.getElementById('journal-search').addEventListener('input', () => {
            this.renderJournalList();
        });

        // Data Management actions
        document.getElementById('btn-export-md').addEventListener('click', () => {
            MindSpaceStorage.exportToMarkdown();
        });

        document.getElementById('btn-export-json').addEventListener('click', () => {
            MindSpaceStorage.exportToJSON();
        });

        const jsonFileInput = document.getElementById('import-json-file-input');
        if (jsonFileInput) {
            document.getElementById('btn-import-json').addEventListener('click', () => {
                jsonFileInput.click();
            });

            jsonFileInput.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (!file) return;

                const reader = new FileReader();
                reader.onload = async (event) => {
                    const jsonString = event.target.result;
                    try {
                        await MindSpaceStorage.importFromJSON(jsonString);
                        this.showModal('导入成功 ✨', '您的备份数据已成功导入并智能合并至本地存储。', [
                            { text: '确定', class: 'secondary-btn', onClick: () => {
                                this.hideModal();
                                // Refresh current UI state
                                this.renderDashboard();
                                this.router.navigate(this.router.currentView);
                            }}
                        ]);
                    } catch (err) {
                        this.showModal('导入失败 ❌', escapeHTML(err.message || '备份数据解析失败，格式不正确。'), [
                            { text: '好的', class: 'secondary-btn', onClick: () => this.hideModal() }
                        ]);
                    } finally {
                        jsonFileInput.value = '';
                    }
                };
                reader.readAsText(file);
            });
        }

        document.getElementById('btn-clear-all').addEventListener('click', () => {
            this.showModal('危险操作！擦除本地数据', '确定要清除所有的本地气象与随笔记录吗？这将完全抹掉设备上的所有数据，且不可逆。', [
                { text: '确认彻底清除', class: 'danger-btn', onClick: () => {
                    MindSpaceStorage.clearAllData();
                    this.hideModal();
                    // Reload page to re-init storage
                    window.location.reload();
                }}
            ]);
        });

        // Check for Update Button
        const btnCheckUpdate = document.getElementById('btn-check-update');
        if (btnCheckUpdate) {
            btnCheckUpdate.addEventListener('click', async () => {
                const icon = document.getElementById('icon-check-update');
                
                if (icon) icon.style.animation = 'auth-spin 1s linear infinite';
                
                try {
                    const response = await fetch('https://api.github.com/repos/wangjiehu/mindspace/releases/latest', {
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

        // Modal Close action
        document.getElementById('modal-close').addEventListener('click', () => {
            this.hideModal();
        });

        // Close modal on background click
        document.getElementById('modal-container').addEventListener('click', (e) => {
            if (e.target.id === 'modal-container') {
                this.hideModal();
            }
        });

        // --- Supabase Config Modals & Auth Bindings ---
        
        // Open Auth modal (Login/Register)
        document.querySelectorAll('.auth-status-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.openAuthModal();
            });
        });

        // Open Cloud Config modal
        const configTriggerIds = ['sidebar-cloud-config-btn', 'mobile-cloud-config-btn', 'btn-cloud-config'];
        configTriggerIds.forEach(id => {
            const btn = document.getElementById(id);
            if (btn) {
                btn.addEventListener('click', () => {
                    this.openConfigModal();
                });
            }
        });

        // Modal Close Buttons inside Cloud Config & Auth Modals
        document.querySelectorAll('#cloud-config-modal .modal-close-btn, #auth-modal .modal-close-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const modal = e.target.closest('.modal-overlay');
                if (modal) {
                    if (modal.id === 'auth-modal' && modal.dataset.forceAuth === 'true') {
                        return;
                    }
                    modal.classList.add('hidden');
                    this.forceRepaint();
                }
            });
        });

        // Close modals on overlay background click
        document.querySelectorAll('#cloud-config-modal, #auth-modal').forEach(modal => {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    if (modal.id === 'auth-modal') {
                        if (modal.dataset.forceAuth === 'true') {
                            return;
                        }
                    }
                    modal.classList.add('hidden');
                    this.forceRepaint();
                }
            });
        });

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

    /**
     * Update UI headers & settings sync cards based on auth status
     */
    async updateAuthUI() {
        const isConfigured = window.SupabaseService && window.SupabaseService.isConfigured();
        let user = null;
        if (isConfigured) {
            const session = await window.SupabaseService.getSession();
            user = session?.user || null;
        }
        
        // Cache state locally to prevent modal flashing
        this.currentUser = user;
        this.authChecked = true;

        const sidebarIcon = document.getElementById('sidebar-auth-icon');
        const sidebarText = document.getElementById('sidebar-auth-text');
        const mobileIcon = document.getElementById('mobile-auth-icon');
        const sidebarBtn = document.getElementById('sidebar-auth-btn');
        const mobileBtn = document.getElementById('mobile-auth-btn');
        const btnSyncNow = document.getElementById('btn-sync-now');
        const syncCardDesc = document.getElementById('sync-card-desc');
        const settingsAuthBtn = document.getElementById('settings-auth-btn');

        if (user) {
            this.releaseAuthGate();
            const shortEmail = user.email.split('@')[0];
            if (sidebarText) sidebarText.innerText = `已登录(${shortEmail})`;
            if (sidebarIcon) sidebarIcon.setAttribute('name', 'cloud-done-outline');
            if (mobileIcon) mobileIcon.setAttribute('name', 'cloud-done-outline');
            
            if (sidebarBtn) {
                sidebarBtn.classList.remove('offline');
                sidebarBtn.classList.add('online');
            }
            if (mobileBtn) {
                mobileBtn.classList.remove('offline');
                mobileBtn.classList.add('online');
            }

            if (settingsAuthBtn) {
                settingsAuthBtn.innerHTML = '<ion-icon name="person-outline"></ion-icon> 管理云账号 / 退出登录';
                settingsAuthBtn.className = 'secondary-btn auth-status-btn';
            }

            if (btnSyncNow) btnSyncNow.classList.remove('hidden');
            if (syncCardDesc) syncCardDesc.innerText = `已启用云同步账户: ${user.email}。您的数据将安全同步到您的个人云端。`;
        } else {
            if (sidebarText) sidebarText.innerText = '未登录';
            if (sidebarIcon) sidebarIcon.setAttribute('name', 'cloud-offline-outline');
            if (mobileIcon) mobileIcon.setAttribute('name', 'cloud-offline-outline');

            if (sidebarBtn) {
                sidebarBtn.classList.remove('online');
                sidebarBtn.classList.add('offline');
            }
            if (mobileBtn) {
                mobileBtn.classList.remove('online');
                mobileBtn.classList.add('offline');
            }

            if (settingsAuthBtn) {
                settingsAuthBtn.innerHTML = '<ion-icon name="cloud-upload-outline"></ion-icon> 注册 / 登录云账号';
                settingsAuthBtn.className = 'primary-btn auth-status-btn';
            }

            if (btnSyncNow) btnSyncNow.classList.add('hidden');
            if (syncCardDesc) syncCardDesc.innerText = `当前数据保存在本地浏览器中。您可以配置云服务，开启多设备同步。`;
        }
    },

    enforceStartupAuth() {
        const isConfigured = window.SupabaseService && window.SupabaseService.isConfigured();
        if (!isConfigured || this.currentUser) {
            this.releaseAuthGate();
            return;
        }

        this.authGateActive = true;
        document.body.classList.add('auth-gate-active');
        this.openAuthModal({ force: true });
    },

    releaseAuthGate() {
        this.authGateActive = false;
        document.body.classList.remove('auth-gate-active');
        const modal = document.getElementById('auth-modal');
        if (modal) {
            modal.dataset.forceAuth = 'false';
        }
    },

    openAuthModal(options = {}) {
        const isConfigured = window.SupabaseService && window.SupabaseService.isConfigured();
        if (!isConfigured) {
            this.showModal('数据库连接配置缺失', '本应用目前处于本地存储/离线模式。若要启用账号登录及云端同步服务，请先配置您的 Supabase 连接凭证。如果您是项目所有者，也可在 `js/config.js` 中直接写入凭证。', [
                { text: '前往配置', class: 'primary-btn', onClick: () => {
                    this.hideModal();
                    this.openConfigModal();
                }},
                { text: '取消', class: 'secondary-btn', onClick: () => this.hideModal() }
            ]);
            return;
        }

        const modal = document.getElementById('auth-modal');
        if (modal) {
            const forceAuth = Boolean(options.force);
            modal.dataset.forceAuth = forceAuth ? 'true' : 'false';
            const loginForm = document.getElementById('login-form');
            const registerForm = document.getElementById('register-form');
            const loggedInState = document.getElementById('logged-in-state');
            const userEmail = document.getElementById('user-display-email');
            const tabs = document.querySelector('.auth-tabs');
            const closeBtns = modal.querySelectorAll('.modal-close-btn');
            const authLoading = document.getElementById('auth-loading');

            // Collapse change password form by default
            const changePwdForm = document.getElementById('change-pwd-form');
            const toggleBtn = document.getElementById('btn-toggle-change-pwd');
            if (changePwdForm) changePwdForm.classList.add('hidden');
            if (toggleBtn) toggleBtn.classList.remove('hidden');

            // Synchronously show state based on cached credentials to prevent flashing
            if (this.authChecked) {
                if (authLoading) authLoading.classList.add('hidden');
                if (loginForm) this.clearFormErrors(loginForm);
                if (registerForm) this.clearFormErrors(registerForm);
                if (this.currentUser) {
                    closeBtns.forEach(btn => btn.classList.remove('hidden'));
                    if (loginForm) loginForm.classList.add('hidden');
                    if (registerForm) registerForm.classList.add('hidden');
                    if (tabs) tabs.classList.add('hidden');
                    if (loggedInState) loggedInState.classList.remove('hidden');
                    if (userEmail) userEmail.innerText = this.currentUser.email;
                } else {
                    closeBtns.forEach(btn => btn.classList.toggle('hidden', forceAuth));
                    if (loginForm) loginForm.classList.remove('hidden');
                    if (registerForm) registerForm.classList.add('hidden');
                    if (tabs) tabs.classList.remove('hidden');
                    if (loggedInState) loggedInState.classList.add('hidden');
                    this.switchAuthTab('login');
                }
            } else {
                // If auth is not checked yet, show a clean loading state
                if (authLoading) authLoading.classList.remove('hidden');
                if (loginForm) loginForm.classList.add('hidden');
                if (registerForm) registerForm.classList.add('hidden');
                if (tabs) tabs.classList.add('hidden');
                if (loggedInState) loggedInState.classList.add('hidden');
                closeBtns.forEach(btn => btn.classList.toggle('hidden', forceAuth));
            }

            modal.classList.remove('hidden');

            // Query background getUser to ensure state is fresh and correct
            window.SupabaseService.getUser().then(user => {
                this.currentUser = user;
                this.authChecked = true;

                if (authLoading) authLoading.classList.add('hidden');
                if (user) {
                    this.releaseAuthGate();
                    if (loginForm) loginForm.classList.add('hidden');
                    if (registerForm) registerForm.classList.add('hidden');
                    if (tabs) tabs.classList.add('hidden');
                    if (loggedInState) loggedInState.classList.remove('hidden');
                    if (userEmail) userEmail.innerText = user.email;
                    closeBtns.forEach(btn => btn.classList.remove('hidden'));
                } else {
                    closeBtns.forEach(btn => btn.classList.toggle('hidden', forceAuth));
                    if (loggedInState) loggedInState.classList.add('hidden');
                    if (tabs) tabs.classList.remove('hidden');
                    // Avoid switching tab if user has toggled to register
                    const isRegVisible = registerForm && !registerForm.classList.contains('hidden');
                    if (!forceAuth && isRegVisible) {
                        this.switchAuthTab('register');
                    } else {
                        this.switchAuthTab('login');
                    }
                }
            });
        }
    },

    /**
     * Legacy hook kept for older integrations.
     */
    async checkForceAuth() {
        this.enforceStartupAuth();
        return this.currentUser;
    },

    /**
     * Open Supabase connection config modal
     */
    openConfigModal() {
        const modal = document.getElementById('cloud-config-modal');
        if (modal) {
            modal.classList.remove('hidden');
            const config = window.SupabaseService.getConfig();
            const configUrl = document.getElementById('config-url');
            const configKey = document.getElementById('config-anon-key');
            if (configUrl) configUrl.value = config.url || '';
            if (configKey) configKey.value = config.anonKey || '';
        }
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
    saveConfig() {
        const url = document.getElementById('config-url').value.trim();
        const anonKey = document.getElementById('config-anon-key').value.trim();
        
        if (!url || !anonKey) {
            app.showModal('配置不完整', '请完整填写 Supabase API URL 与 Anon Key 后再保存。', [
                { text: '好的', class: 'secondary-btn', onClick: () => app.hideModal() }
            ]);
            return;
        }

        const success = window.SupabaseService.saveConfig(url, anonKey);
        if (success) {
            document.getElementById('cloud-config-modal').classList.add('hidden');
            this.updateAuthUI();
            this.showModal('配置成功', 'Supabase 客户端连接成功！您现在可以登录或注册账户以同步数据。', [
                { text: '好的', class: 'secondary-btn', onClick: () => this.hideModal() }
            ]);
        } else {
            app.showModal('连接失败', '客户端初始化失败，请检查 Supabase API URL 或 Anon Key 格式是否正确。', [
                { text: '确定', class: 'secondary-btn', onClick: () => app.hideModal() }
            ]);
        }
    },

    /**
     * Handle user Login
     */
    async handleLogin(e) {
        e.preventDefault();
        if (!this.validateAuthForm(e.currentTarget, 'login')) return;

        const email = document.getElementById('login-email').value.trim();
        const password = document.getElementById('login-password').value;

        try {
            await window.SupabaseService.signIn(email, password);
            document.getElementById('auth-modal').classList.add('hidden');
            this.releaseAuthGate();
            this.forceRepaint();
            await this.updateAuthUI();

            // Prompt user to sync local logs to cloud
            const localLogs = MindSpaceStorage.getLogs();
            if (localLogs.length > 0) {
                this.showModal('登录成功', '您已成功登录！检测到本地存有天气与心情记录，是否将它们合并导入到您的云端账户？', [
                    { text: '暂不合并', class: 'secondary-btn', onClick: () => {
                        this.hideModal();
                        window.location.reload();
                    }},
                    { text: '立即合并同步', class: 'primary-btn', onClick: async () => {
                        this.showModal('同步中', '正在将您的本地记录同步至云端...', []);
                        try {
                            await MindSpaceStorage.syncLocalToCloud();
                            this.hideModal();
                            this.showModal('同步完成', '所有本地天气日志已完美合并至云端账号！', [
                                { text: '进入首页', class: 'primary-btn', onClick: () => {
                                    this.hideModal();
                                    window.location.reload();
                                }}
                            ]);
                        } catch (err) {
                            console.error(err);
                            this.showModal('同步失败', '同步过程中出现错误，请重试：' + escapeHTML(err.message), [
                                { text: '确定', class: 'secondary-btn', onClick: () => this.hideModal() }
                            ]);
                        }
                    }}
                ]);
            } else {
                // Fetch cloud logs down to local anyway
                await MindSpaceStorage.syncLocalToCloud();
                window.location.reload();
            }
        } catch (err) {
            let msg = err.message || '';
            if (msg.includes('Email not confirmed') || msg.toLowerCase().includes('confirm') || msg.toLowerCase().includes('verify') || msg.toLowerCase().includes('code') || msg.toLowerCase().includes('otp')) {
                msg = '邮箱尚未激活或密码错误，请检查您的账户信息。';
            }
            app.showModal('登录失败', escapeHTML(msg), [
                { text: '确定', class: 'secondary-btn', onClick: () => app.hideModal() }
            ]);
        }
    },

    /**
     * Handle user Registration
     */
    async handleRegister(e) {
        e.preventDefault();
        if (!this.validateAuthForm(e.currentTarget, 'register')) return;

        const email = document.getElementById('reg-email').value.trim();
        const password = document.getElementById('reg-password').value;

        try {
            const data = await window.SupabaseService.signUp(email, password);
            const user = data?.user || await window.SupabaseService.getUser();

            if (user) {
                // Successfully registered and auto-logged in (since email confirmation is disabled)
                document.getElementById('auth-modal').classList.add('hidden');
                this.releaseAuthGate();
                this.forceRepaint();
                await this.updateAuthUI();

                // Prompt user to sync local logs to cloud
                const localLogs = MindSpaceStorage.getLogs();
                if (localLogs.length > 0) {
                    this.showModal('注册并登录成功', '您的账号注册成功并已自动登录！检测到本地存有天气与心情记录，是否将它们合并导入到您的云端账户？', [
                        { text: '暂不合并', class: 'secondary-btn', onClick: () => {
                            this.hideModal();
                            window.location.reload();
                        }},
                        { text: '立即合并同步', class: 'primary-btn', onClick: async () => {
                            this.showModal('同步中', '正在将您的本地记录同步至云端...', []);
                            try {
                                await MindSpaceStorage.syncLocalToCloud();
                                this.hideModal();
                                this.showModal('同步完成', '所有本地天气日志已完美合并至云端账号！', [
                                    { text: '进入首页', class: 'primary-btn', onClick: () => {
                                        this.hideModal();
                                        window.location.reload();
                                    }}
                                ]);
                            } catch (err) {
                                console.error(err);
                                this.showModal('同步失败', '同步过程中出现错误，请重试：' + escapeHTML(err.message), [
                                    { text: '确定', class: 'secondary-btn', onClick: () => this.hideModal() }
                                ]);
                            }
                        }}
                    ]);
                } else {
                    await MindSpaceStorage.syncLocalToCloud();
                    window.location.reload();
                }
            } else {
                // If email confirmation is somehow still active
                document.getElementById('auth-modal').classList.add('hidden');
                this.forceRepaint();
                this.showModal('注册成功', '您的账号已成功注册，立即登录开启您的心空旅程吧。', [
                    { text: '去登录', class: 'primary-btn', onClick: () => {
                        this.hideModal();
                        this.openAuthModal();
                    }}
                ]);
            }
        } catch (err) {
            let msg = err.message || '';
            if (msg.toLowerCase().includes('confirm') || msg.toLowerCase().includes('verify') || msg.toLowerCase().includes('code') || msg.toLowerCase().includes('otp')) {
                msg = '账号创建失败，请检查输入信息或稍后重试。';
            }
            app.showModal('注册失败', escapeHTML(msg), [
                { text: '确定', class: 'secondary-btn', onClick: () => app.hideModal() }
            ]);
        }
    },

    /**
     * Handle Sign Out
     */
    async handleSignOut() {
        try {
            await window.SupabaseService.signOut();
            document.getElementById('auth-modal').classList.add('hidden');
            this.forceRepaint();
            
            this.showModal('已退出登录', '账户已成功退出。本地保存的随笔记录依然保留。', [
                { text: '确定', class: 'secondary-btn', onClick: () => {
                    this.hideModal();
                    window.location.reload();
                }}
            ]);
        } catch (err) {
            app.showModal('退出失败', '退出登录过程中发生了错误：' + escapeHTML(err.message), [
                { text: '确定', class: 'secondary-btn', onClick: () => app.hideModal() }
            ]);
        }
    },

    /**
     * Handle Manual Sync Trigger
     */
    async handleManualSync() {
        this.showModal('云端同步', '正在合并本地与云端的心情天气数据...', []);
        try {
            await MindSpaceStorage.syncLocalToCloud();
            this.hideModal();
            this.showModal('同步完成', '您的所有天气日志已完美在本地与云端合并！', [
                { text: '确定', class: 'primary-btn', onClick: () => {
                    this.hideModal();
                    window.location.reload();
                }}
            ]);
        } catch (err) {
            console.error(err);
            this.showModal('同步失败', '同步过程中出现错误，请检查网络或配置：' + escapeHTML(err.message), [
                { text: '确定', class: 'secondary-btn', onClick: () => this.hideModal() }
            ]);
        }
    },

    /**
     * Modular Custom Dialog System
     */
    showModal(title, bodyHtml, actions = []) {
        document.getElementById('modal-title').innerText = title;
        document.getElementById('modal-body').innerHTML = bodyHtml;
        
        const actionsContainer = document.getElementById('modal-actions');
        actionsContainer.innerHTML = '';

        actions.forEach(action => {
            const btn = document.createElement('button');
            btn.className = action.class || 'secondary-btn';
            btn.innerText = action.text;
            btn.addEventListener('click', action.onClick);
            actionsContainer.appendChild(btn);
        });

        document.getElementById('modal-container').classList.remove('hidden');
    },

    hideModal() {
        document.getElementById('modal-container').classList.add('hidden');
        this.forceRepaint();
    },

    forceRepaint() {
        const container = document.getElementById('app-container');
        if (container) {
            container.style.transform = 'translate3d(0, 0, 0.1px)';
            container.offsetHeight; // trigger reflow
            container.style.transform = 'translate3d(0, 0, 0)';
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
