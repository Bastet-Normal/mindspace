(() => {
    let client = null;
    let project = null;
    let sdkLoading = null;
    let configurationRevision = 0;
    let configurationAttempt = 0;
    let authSubscription = null;
    const CONFIG_KEY = 'mindspace-cloud-config-v2';
    // The optional font_runs column may be absent on older projects.
    const LOG_FIELDS = '*';
    const FONT_TRAILER = '\n\n\u001eMindSpace/fonts/1\n';

    function loadSDK() {
        if (window.supabase?.createClient) return Promise.resolve(window.supabase);
        if (!sdkLoading) {
            sdkLoading = new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = './assets/vendor/supabase/supabase.js';
                script.onload = () => {
                    if (window.supabase?.createClient) resolve(window.supabase);
                    else reject(new Error('无法初始化云同步模块。'));
                };
                script.onerror = () => reject(new Error('无法载入云同步模块。'));
                document.head.append(script);
            }).catch(error => {
                sdkLoading = null;
                throw error;
            });
        }
        return sdkLoading;
    }

    function validateConnection(url, key) {
        let parsed;
        try { parsed = new URL(url); }
        catch { throw new Error('请输入完整的 Supabase 项目地址。'); }
        if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
            throw new Error('请输入以 HTTPS 开头的 Supabase 项目地址。');
        }

        let role;
        try {
            const payload = key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
            role = JSON.parse(atob(payload)).role;
        } catch { /* Publishable keys use a different format. */ }
        if (role !== 'anon' && !/^sb_publishable_[\w-]+$/.test(key)) {
            throw new Error('请选择项目的 Publishable Key 或旧版 anon 公钥。');
        }
        return parsed.origin;
    }

    function requireClient() {
        if (!client) throw new Error('请先配置云同步。');
        return client;
    }

    function getResult(response) {
        if (response.error) {
            const status = response.status ?? response.error.status;
            const error = new Error(response.error.message || '无法访问云端。', { cause: response.error });
            error.code = response.error.code;
            error.retryable = status === 0 || status === 408 || status === 429 || status >= 500;
            throw error;
        }
        return response.data;
    }

    function getRows(response) {
        const rows = getResult(response);
        if (!Array.isArray(rows)) throw new Error('云端返回了无法确认的日记结果。');
        return rows;
    }

    function getStoredConfig() {
        try {
            const saved = JSON.parse(localStorage.getItem(CONFIG_KEY));
            if (typeof saved?.url === 'string' && typeof saved?.anonKey === 'string') return saved;
        } catch { /* Existing installations may still use the separate legacy keys. */ }
        try {
            const url = localStorage.getItem('supabase_url');
            const anonKey = localStorage.getItem('supabase_anon_key');
            return url && anonKey ? { url, anonKey } : null;
        } catch { return null; }
    }

    // Older installations have a plain text column only. Keep the text first
    // and append a length-checked trailer so fonts round-trip without a migration.
    function readCloudNote(row) {
        if (!row || row.font_runs != null || typeof row.note !== 'string') return row;
        const split = row.note.lastIndexOf(FONT_TRAILER);
        if (split < 0) return row;
        try {
            const trailer = JSON.parse(row.note.slice(split + FONT_TRAILER.length));
            if (trailer?.length === split && Array.isArray(trailer.runs)) {
                return { ...row, note: row.note.slice(0, split), font_runs: trailer.runs };
            }
        } catch { /* A literal marker in an older plain text note is still text. */ }
        return row;
    }

    const service = {
        async init() {
            const { url, anonKey } = this.getConfig();
            if (!url || !anonKey) return false;
            return this.configure(url, anonKey);
        },

        async configure(url, anonKey, persist = false) {
            const origin = validateConnection(url, anonKey);
            const attempt = ++configurationAttempt;
            const sdk = await loadSDK();
            if (attempt !== configurationAttempt) return false;
            const storageKey = `mindspace-auth:${origin}`;
            const legacyKey = `sb-${new URL(origin).hostname.split('.')[0]}-auth-token`;
            let previousOrigin;
            try { previousOrigin = new URL(this.getConfig().url).origin; }
            catch { /* Without a previous project, the legacy token is unscoped. */ }
            const legacySession = previousOrigin === origin ? localStorage.getItem(legacyKey) : null;
            if (legacySession && !localStorage.getItem(storageKey)) {
                localStorage.setItem(storageKey, legacySession);
                localStorage.removeItem(legacyKey);
            }
            const candidate = sdk.createClient(origin, anonKey, { auth: { storageKey } });
            if (persist) {
                try { localStorage.setItem(CONFIG_KEY, JSON.stringify({ url, anonKey })); }
                catch (error) {
                    candidate.auth.stopAutoRefresh();
                    throw error;
                }
                localStorage.removeItem('supabase_url');
                localStorage.removeItem('supabase_anon_key');
            }

            const revision = ++configurationRevision;
            authSubscription?.unsubscribe();
            if (client) client.auth.stopAutoRefresh();
            client = candidate;
            project = origin;
            const { data } = client.auth.onAuthStateChange((event, session) => {
                if (event === 'TOKEN_REFRESHED') return;
                setTimeout(() => {
                    if (revision === configurationRevision) {
                        document.dispatchEvent(new CustomEvent('mindspace:auth', { detail: session?.user || null }));
                    }
                }, 0);
            });
            authSubscription = data.subscription;
            return true;
        },

        isConfigured() {
            return Boolean(client);
        },

        async saveConfig(url, anonKey) {
            return this.configure(url, anonKey, true);
        },

        clearConfig({ clearSession = false, allProjects = false } = {}) {
            configurationRevision++;
            configurationAttempt++;
            authSubscription?.unsubscribe();
            if (client) client.auth.stopAutoRefresh();
            if (clearSession) {
                const configuredUrl = this.getConfig().url;
                let sessionKey = '';
                try { sessionKey = 'mindspace-auth:' + new URL(configuredUrl).origin; }
                catch { /* A partially configured project may have no session. */ }
                for (const key of Object.keys(localStorage)) {
                    if ((allProjects && key.startsWith('mindspace-auth:')) || key === sessionKey ||
                        (sessionKey && [sessionKey + '-code-verifier', sessionKey + '-user'].includes(key))) localStorage.removeItem(key);
                }
            }
            if (window.SUPABASE_CONFIG?.url?.trim()) {
                localStorage.setItem(CONFIG_KEY, JSON.stringify({ url: '', anonKey: '' }));
            } else localStorage.removeItem(CONFIG_KEY);
            localStorage.removeItem('supabase_url');
            localStorage.removeItem('supabase_anon_key');
            authSubscription = null;
            client = null;
            project = null;
        },

        getConfig() {
            const config = getStoredConfig() || window.SUPABASE_CONFIG;
            const url = config?.url?.trim() || '';
            const anonKey = config?.anonKey?.trim() || '';
            return url && anonKey ? { url, anonKey } : { url: '', anonKey: '' };
        },

        scopeFor(user) {
            return project && user?.id ? `${project}|${user.id}` : null;
        },

        async signUp(email, password) {
            return getResult(await requireClient().auth.signUp({ email, password }));
        },

        async signIn(email, password) {
            return getResult(await requireClient().auth.signInWithPassword({ email, password }));
        },

        async signOut() {
            if (client) getResult(await client.auth.signOut({ scope: 'local' }));
        },

        async updatePassword(newPassword, oldPassword) {
            const connection = requireClient();
            const { user } = getResult(await connection.auth.getUser());
            if (!user?.email) throw new Error('请重新登录云账户。');
            getResult(await connection.auth.signInWithPassword({ email: user.email, password: oldPassword }));
            return getResult(await connection.auth.updateUser({ password: newPassword }));
        },

        async getSession() {
            if (!client) return null;
            const { data, error } = await client.auth.getSession();
            return error ? null : data.session;
        },

        async connect() {
            const connection = requireClient();
            const origin = project;
            const revision = configurationRevision;
            const isCurrent = () => {
                if (client !== connection || revision !== configurationRevision) {
                    throw new Error('云端配置已变更，请重试。');
                }
            };
            const { user } = getResult(await connection.auth.getUser());
            if (!user?.id) throw new Error('请登录云账户后再同步。');
            isCurrent();

            const table = () => {
                isCurrent();
                return connection.from('mood_logs');
            };
            const fetchLog = async id => readCloudNote(getResult(await table().select(LOG_FIELDS)
                .eq('id', id).eq('user_id', user.id).maybeSingle()));
            let hasFontColumn = true;
            const writeNote = async (log, write, clearFonts = false) => {
                const { timestamp, weather, tags, note } = log;
                const fields = { timestamp, weather, tags, note };
                const runs = log.fontRuns || [];
                if (!runs.length && !clearFonts && !note.includes(FONT_TRAILER)) return getRows(await write(fields));
                if (hasFontColumn) {
                    const result = await write({ ...fields, font_runs: runs });
                    if (!['PGRST204', '42703'].includes(result.error?.code) || !result.error.message.includes('font_runs')) {
                        return getRows(result);
                    }
                    hasFontColumn = false;
                }
                if (runs.length || note.includes(FONT_TRAILER)) {
                    fields.note += FONT_TRAILER + JSON.stringify({ length: note.length, runs });
                }
                return getRows(await write(fields));
            };
            // PostgreSQL changes xmin on every row update, including edits by older clients.
            // Only the revision goes in the request URL. Diary text stays in the request body.
            const readVersion = async id => {
                const row = getResult(await table().select(LOG_FIELDS + ',xmin')
                    .eq('id', id).eq('user_id', user.id).maybeSingle());
                if (!row) return null;
                const log = MindSpaceStorage.normalizeLog(readCloudNote(row));
                if (!log || !/^\d+$/.test(row.xmin)) throw new Error('无法确认云端日记版本，本机变更已保留。');
                return { log, revision: row.xmin };
            };

            return {
                scope: `${origin}|${user.id}`,
                fetchLog,

                async fetchLogs() {
                    const pageSize = 200;
                    let lastId = null;
                    const result = [];
                    while (true) {
                        let query = table().select(LOG_FIELDS)
                            .eq('user_id', user.id).order('id', { ascending: true }).limit(pageSize);
                        if (lastId) query = query.gt('id', lastId);
                        const page = getRows(await query);
                        if (!page.length) return result;
                        if (!page.at(-1)?.id || page.at(-1).id <= (lastId || '')) {
                            throw new Error('云端日记分页未能继续，本机日记已保留。');
                        }
                        result.push(...page.map(readCloudNote));
                        // Continue even if the project's API returns fewer rows than requested.
                        lastId = page.at(-1).id;
                    }
                },

                async createLog(log) {
                    const inserted = await writeNote(log, fields => table().upsert({ id: log.id, user_id: user.id, ...fields }, {
                        onConflict: 'id', ignoreDuplicates: true
                    }).select('id'));
                    return inserted.some(row => row.id === log.id);
                },

                async updateLog(log, base) {
                    const remote = await readVersion(log.id);
                    if (!remote) return false;
                    if (MindSpaceStorage.sameLog(log, remote.log)) return true;
                    if (!base || !MindSpaceStorage.sameLog(base, remote.log)) return false;
                    const updated = await writeNote(log, fields => table().update(fields)
                        .eq('id', log.id).eq('user_id', user.id).eq('xmin', remote.revision).select('id'), Boolean(remote.log.fontRuns));
                    return updated.some(row => row.id === log.id);
                },

                async deleteLog(id, base) {
                    const remote = await readVersion(id);
                    if (!remote) return true;
                    if (!base || !MindSpaceStorage.sameLog(base, remote.log)) return false;
                    const removed = getRows(await table().delete().eq('id', id).eq('user_id', user.id)
                        .eq('xmin', remote.revision).select('id'));
                    return removed.some(row => row.id === id) || !await fetchLog(id);
                }
            };
        }
    };
    window.SupabaseService = service;
})();
