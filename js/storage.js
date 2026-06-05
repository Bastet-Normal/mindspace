/**
 * MindSpace - Local Storage Controller
 * Manages off-line user data with absolute privacy.
 */
const MindSpaceStorage = {
    KEYS: {
        LOGS: 'mindspace_mood_logs',
        SETTINGS: 'mindspace_user_settings',
        STATS: 'mindspace_daily_stats',
        HISTORY: 'mindspace_stats_history'
    },

    // Default settings
    DEFAULT_SETTINGS: {
        userName: '旅人',
        theme: 'light',
        customTags: ['疲惫', '焦虑', '平静', '喜悦', '心累', '感恩', '成长', '人际']
    },

    /**
     * Get user settings
     */
    getSettings() {
        const stored = localStorage.getItem(this.KEYS.SETTINGS);
        if (!stored) {
            this.saveSettings(this.DEFAULT_SETTINGS);
            return this.DEFAULT_SETTINGS;
        }
        try {
            return { ...this.DEFAULT_SETTINGS, ...JSON.parse(stored) };
        } catch (e) {
            return this.DEFAULT_SETTINGS;
        }
    },

    /**
     * Save user settings
     */
    saveSettings(settings) {
        localStorage.setItem(this.KEYS.SETTINGS, JSON.stringify(settings));
    },

    /**
     * Get all mood logs, sorted descending by timestamp
     */
    getLogs() {
        const stored = localStorage.getItem(this.KEYS.LOGS);
        if (!stored) return [];
        try {
            const logs = JSON.parse(stored);
            return logs.sort((a, b) => b.timestamp - a.timestamp);
        } catch (e) {
            return [];
        }
    },

    /**
     * Generate RFC4122 v4 compliant UUID
     */
    generateUUID() {
        if (typeof crypto !== 'undefined' && crypto.randomUUID) {
            try {
                return crypto.randomUUID();
            } catch (e) {
                // Fallback below
            }
        }
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    },

    /**
     * Save a single mood log
     */
    async saveLog(weather, tags = [], note = '') {
        const logs = this.getLogs();
        const newLog = {
            id: this.generateUUID(),
            timestamp: Date.now(),
            weather: weather,
            tags: tags,
            note: note.trim()
        };
        logs.push(newLog);
        localStorage.setItem(this.KEYS.LOGS, JSON.stringify(logs));

        // Sync to Supabase if configured and logged in
        if (window.SupabaseService && window.SupabaseService.isConfigured()) {
            try {
                await window.SupabaseService.uploadLog(newLog);
            } catch (e) {
                console.error("Failed to sync log to Supabase:", e);
            }
        }

        return newLog;
    },

    /**
     * Delete a mood log by ID
     */
    async deleteLog(id) {
        let logs = this.getLogs();
        logs = logs.filter(log => log.id !== id);
        localStorage.setItem(this.KEYS.LOGS, JSON.stringify(logs));

        // Sync to Supabase if configured and logged in
        if (window.SupabaseService && window.SupabaseService.isConfigured()) {
            try {
                await window.SupabaseService.deleteLog(id);
            } catch (e) {
                console.error("Failed to delete log from Supabase:", e);
            }
        }
    },

    /**
     * Synchronize local logs to cloud (converting non-UUIDs) and pull cloud logs to merge
     */
    async syncLocalToCloud() {
        if (!window.SupabaseService || !window.SupabaseService.isConfigured()) {
            throw new Error("Supabase is not configured.");
        }

        let logs = this.getLogs();
        let updated = false;

        // Convert non-UUID logs to UUID
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        logs = logs.map(log => {
            if (!log.id || !uuidRegex.test(log.id)) {
                log.id = this.generateUUID();
                updated = true;
            }
            return log;
        });

        if (updated) {
            localStorage.setItem(this.KEYS.LOGS, JSON.stringify(logs));
        }

        // 1. Upload local logs to Cloud
        if (logs.length > 0) {
            await window.SupabaseService.bulkUploadLogs(logs);
        }

        // 2. Fetch all logs from Cloud
        const cloudLogs = await window.SupabaseService.fetchLogs();

        // 3. Merge Cloud logs with local logs
        const mergedMap = new Map();
        logs.forEach(log => mergedMap.set(log.id, log));

        cloudLogs.forEach(cLog => {
            const formattedLog = {
                id: cLog.id,
                timestamp: Number(cLog.timestamp),
                weather: cLog.weather,
                tags: cLog.tags || [],
                note: cLog.note || ''
            };
            mergedMap.set(formattedLog.id, formattedLog);
        });

        const mergedLogs = Array.from(mergedMap.values()).sort((a, b) => b.timestamp - a.timestamp);
        localStorage.setItem(this.KEYS.LOGS, JSON.stringify(mergedLogs));
        return mergedLogs;
    },

    /**
     * Clear all user data completely
     */
    clearAllData() {
        localStorage.removeItem(this.KEYS.LOGS);
        localStorage.removeItem(this.KEYS.SETTINGS);
        localStorage.removeItem(this.KEYS.STATS);
        localStorage.removeItem(this.KEYS.HISTORY);
        // Also clear Supabase configuration and session data
        localStorage.removeItem('supabase_url');
        localStorage.removeItem('supabase_anon_key');
        // Clear any Supabase auth session keys (they use a prefix pattern)
        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && (key.startsWith('sb-') || key.includes('supabase'))) {
                keysToRemove.push(key);
            }
        }
        keysToRemove.forEach(key => localStorage.removeItem(key));
    },

    /**
     * Format a timestamp to local date string (e.g. 2026-05-22 14:00)
     */
    formatDate(timestamp) {
        const date = new Date(timestamp);
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        const hr = String(date.getHours()).padStart(2, '0');
        const min = String(date.getMinutes()).padStart(2, '0');
        return `${y}-${m}-${d} ${hr}:${min}`;
    },

    /**
     * Weather translations & emoji markers for text outputs
     */
    WEATHER_MAP: {
        sunny: { name: '晴朗', emoji: '☀️' },
        breezy: { name: '微风', emoji: '🍃' },
        cloudy: { name: '阴天', emoji: '☁️' },
        foggy: { name: '大雾', emoji: '🌫️' },
        rainy: { name: '小雨', emoji: '🌧️' },
        stormy: { name: '雷雨', emoji: '⛈️' }
    },

    /**
     * Get mindfulness statistics for today
     */
    getTodayStats() {
        const d = new Date();
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const dateVal = String(d.getDate()).padStart(2, '0');
        const formattedDate = `${y}-${m}-${dateVal}`;

        const stored = localStorage.getItem(this.KEYS.STATS);
        const defaultStats = { date: formattedDate, breathingSeconds: 0, focusSeconds: 0 };
        
        if (!stored) {
            localStorage.setItem(this.KEYS.STATS, JSON.stringify(defaultStats));
            return defaultStats;
        }
        try {
            const stats = JSON.parse(stored);
            if (stats.date !== formattedDate) {
                localStorage.setItem(this.KEYS.STATS, JSON.stringify(defaultStats));
                return defaultStats;
            }
            return stats;
        } catch (e) {
            localStorage.setItem(this.KEYS.STATS, JSON.stringify(defaultStats));
            return defaultStats;
        }
    },

    /**
     * Save statistics for today
     */
    saveTodayStats(stats) {
        localStorage.setItem(this.KEYS.STATS, JSON.stringify(stats));
    },

    /**
     * Get mindfulness statistics history
     */
    getHistoryStats() {
        const stored = localStorage.getItem(this.KEYS.HISTORY);
        if (!stored) return {};
        try {
            return JSON.parse(stored);
        } catch (e) {
            return {};
        }
    },

    /**
     * Update history stats for a specific day and metric
     */
    updateHistoryStats(dateStr, key, deltaSeconds) {
        const history = this.getHistoryStats();
        if (!history[dateStr]) {
            history[dateStr] = { breathingSeconds: 0, focusSeconds: 0 };
        }
        history[dateStr][key] = (history[dateStr][key] || 0) + deltaSeconds;
        localStorage.setItem(this.KEYS.HISTORY, JSON.stringify(history));
    },

    /**
     * Get cumulative statistics (totals & active streak)
     */
    getCumulativeStats() {
        const history = this.getHistoryStats();
        let totalFocusSeconds = 0;
        let totalBreathingSeconds = 0;

        Object.values(history).forEach(day => {
            totalFocusSeconds += (day.focusSeconds || 0);
            totalBreathingSeconds += (day.breathingSeconds || 0);
        });

        // Compute streak: count consecutive days with activity, starting from today going backwards.
        // If today has no activity yet, start checking from yesterday (the day is still in progress).
        let streak = 0;
        let checkDate = new Date();

        // Format today's date
        const todayStr = `${checkDate.getFullYear()}-${String(checkDate.getMonth() + 1).padStart(2, '0')}-${String(checkDate.getDate()).padStart(2, '0')}`;
        const todayData = history[todayStr];
        const todayHasActivity = todayData && ((todayData.focusSeconds || 0) > 0 || (todayData.breathingSeconds || 0) > 0);

        if (!todayHasActivity) {
            // Today has no activity yet, start from yesterday
            checkDate.setDate(checkDate.getDate() - 1);
        }

        while (true) {
            const y = checkDate.getFullYear();
            const m = String(checkDate.getMonth() + 1).padStart(2, '0');
            const d = String(checkDate.getDate()).padStart(2, '0');
            const dateStr = `${y}-${m}-${d}`;

            const dayData = history[dateStr];
            if (dayData && ((dayData.focusSeconds || 0) > 0 || (dayData.breathingSeconds || 0) > 0)) {
                streak++;
                checkDate.setDate(checkDate.getDate() - 1);
            } else {
                break;
            }
        }

        return {
            totalFocusMinutes: Math.round(totalFocusSeconds / 60),
            totalBreathingMinutes: Math.round(totalBreathingSeconds / 60),
            streak: streak
        };
    },

    /**
     * Increment breathing duration for today
     */
    addBreathingTime(seconds) {
        const stats = this.getTodayStats();
        stats.breathingSeconds += seconds;
        this.saveTodayStats(stats);
        this.updateHistoryStats(stats.date, 'breathingSeconds', seconds);
        return stats;
    },

    /**
     * Increment focus duration for today
     */
    addFocusTime(seconds) {
        const stats = this.getTodayStats();
        stats.focusSeconds += seconds;
        this.saveTodayStats(stats);
        this.updateHistoryStats(stats.date, 'focusSeconds', seconds);
        return stats;
    },

    /**
     * Export all logs to a beautifully structured Markdown string for download
     */
    exportToMarkdown() {
        const logs = this.getLogs();
        const settings = this.getSettings();
        
        let mdContent = `# MindSpace 心空 - 心灵气象随笔导出\n`;
        mdContent += `导出时间: ${this.formatDate(Date.now())}\n`;
        mdContent += `持有人: ${settings.userName}\n\n`;
        mdContent += `> 这是您保存在本地浏览器的内心天气日志。感谢您关注自己的心理健康，接纳起伏的每一天。\n\n`;
        mdContent += `* * *\n\n`;

        if (logs.length === 0) {
            mdContent += `（目前尚无记录）\n`;
        } else {
            logs.forEach(log => {
                const weatherInfo = this.WEATHER_MAP[log.weather] || { name: log.weather, emoji: '✨' };
                mdContent += `### 📅 ${this.formatDate(log.timestamp)}\n`;
                mdContent += `- **内心天气**: ${weatherInfo.emoji} ${weatherInfo.name}\n`;
                if (log.tags && log.tags.length > 0) {
                    mdContent += `- **关联标签**: ${log.tags.join(', ')}\n`;
                }
                mdContent += `\n**内心随笔**:\n`;
                if (log.note) {
                    mdContent += `${log.note}\n`;
                } else {
                    mdContent += `*（未记录文字，仅记录了天气与状态）*\n`;
                }
                mdContent += `\n* * *\n\n`;
            });
        }

        // Create blob and trigger download
        const blob = new Blob([mdContent], { type: 'text/markdown;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', `MindSpace_Export_${new Date().toISOString().slice(0, 10)}.md`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }
};