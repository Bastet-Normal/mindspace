// MindSpace - Supabase 服务封装层
(function() {
    let client = null;

    const SupabaseService = {
        // 初始化 Supabase 客户端
        init() {
            let url = window.SUPABASE_CONFIG?.url || localStorage.getItem('supabase_url');
            let anonKey = window.SUPABASE_CONFIG?.anonKey || localStorage.getItem('supabase_anon_key');

            // 去除可能的多余空格
            url = url?.trim();
            anonKey = anonKey?.trim();

            if (url && anonKey && window.supabase) {
                try {
                    client = window.supabase.createClient(url, anonKey);
                    console.log("Supabase 客户端初始化成功。");
                    return true;
                } catch (e) {
                    console.error("Supabase 客户端初始化失败:", e);
                }
            }
            client = null;
            return false;
        },

        // 检查是否已配置凭证且初始化成功
        isConfigured() {
            return client !== null;
        },

        // 保存并重载凭证
        saveConfig(url, anonKey) {
            localStorage.setItem('supabase_url', url || '');
            localStorage.setItem('supabase_anon_key', anonKey || '');
            return this.init();
        },

        // 清除凭证
        clearConfig() {
            localStorage.removeItem('supabase_url');
            localStorage.removeItem('supabase_anon_key');
            client = null;
        },

        // 获取当前本地缓存的配置
        getConfig() {
            return {
                url: window.SUPABASE_CONFIG?.url || localStorage.getItem('supabase_url') || '',
                anonKey: window.SUPABASE_CONFIG?.anonKey || localStorage.getItem('supabase_anon_key') || ''
            };
        },

        // --- 用户身份验证 (Auth) 接口 ---

        // 邮箱密码注册
        async signUp(email, password) {
            if (!client) throw new Error("Supabase 未配置，请先设置连接凭证。");
            const { data, error } = await client.auth.signUp({ email, password });
            if (error) throw error;
            return data;
        },

        // 邮箱密码登录
        async signIn(email, password) {
            if (!client) throw new Error("Supabase 未配置，请先设置连接凭证。");
            const { data, error } = await client.auth.signInWithPassword({ email, password });
            if (error) throw error;
            return data;
        },

        // 登出
        async signOut() {
            if (!client) return;
            const { error } = await client.auth.signOut();
            if (error) throw error;
        },

        // 修改密码 (传入新密码与当前原密码)
        async updatePassword(newPassword, oldPassword) {
            if (!client) throw new Error("Supabase 未配置，请先设置连接凭证。");
            const { data, error } = await client.auth.updateUser({
                password: newPassword,
                currentPassword: oldPassword
            });
            if (error) throw error;
            return data;
        },

        // 获取当前用户
        async getUser() {
            if (!client) return null;
            const { data: { user }, error } = await client.auth.getUser();
            if (error) return null;
            return user;
        },

        // 获取当前会话 session
        async getSession() {
            if (!client) return null;
            const { data: { session }, error } = await client.auth.getSession();
            if (error) return null;
            return session;
        },

        // --- 云端数据库 (Database) 接口 ---

        // 拉取当前用户的所有天气日志
        async fetchLogs() {
            if (!client) return [];
            const user = await this.getUser();
            if (!user) return [];

            const { data, error } = await client
                .from('mood_logs')
                .select('*')
                .eq('user_id', user.id)
                .order('timestamp', { ascending: false });

            if (error) throw error;
            return data || [];
        },

        // 上传/更新单条天气日志 (Upsert 保证幂等性)
        async uploadLog(log) {
            if (!client) return null;
            const user = await this.getUser();
            if (!user) {
                console.warn('uploadLog: 用户未登录或会话已过期，跳过云端同步。');
                return null;
            }

            const { data, error } = await client
                .from('mood_logs')
                .upsert({
                    id: log.id,
                    user_id: user.id,
                    timestamp: log.timestamp,
                    weather: log.weather,
                    tags: log.tags || [],
                    note: log.note || ""
                });

            if (error) throw error;
            return data;
        },

        // 删除单条云端天气日志
        async deleteLog(logId) {
            if (!client) return;
            const user = await this.getUser();
            if (!user) {
                console.warn('deleteLog: 用户未登录或会话已过期，仅删除本地记录。');
                return;
            }

            const { error } = await client
                .from('mood_logs')
                .delete()
                .eq('id', logId)
                .eq('user_id', user.id);

            if (error) throw error;
        },

        // 批量合并上传 (用于合并本地离线日志至云端)
        async bulkUploadLogs(logs) {
            if (!client || logs.length === 0) return;
            const user = await this.getUser();
            if (!user) return;

            const records = logs.map(log => ({
                id: log.id,
                user_id: user.id,
                timestamp: log.timestamp,
                weather: log.weather,
                tags: log.tags || [],
                note: log.note || ""
            }));

            const { error } = await client
                .from('mood_logs')
                .upsert(records);

            if (error) throw error;
        }
    };

    window.SupabaseService = SupabaseService;
})();