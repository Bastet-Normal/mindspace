(() => {
    const packaged = location.protocol === 'mindspace:' || Boolean(window.Capacitor?.isNativePlatform?.());
    const worker = !packaged && window.isSecureContext && 'caches' in window ? navigator.serviceWorker : null;
    const scope = new URL('./', document.baseURI);
    const cacheName = `mindspace-audio:${scope.pathname}`;

    document.addEventListener('DOMContentLoaded', () => {
        const card = document.getElementById('install-card');
        if (packaged || !/^https?:$/.test(location.protocol) || !window.isSecureContext ||
            matchMedia('(display-mode: standalone)').matches || navigator.standalone === true) return;

        const ua = navigator.userAgent || '';
        const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        const macSafari = /Macintosh/.test(ua) && /Version\/(\d+).*Safari\//.exec(ua);
        let title = '安装 MindSpace';
        let instructions = '';
        if (ios) {
            title = '添加到主屏幕';
            instructions = '用 Safari 打开 MindSpace，轻点分享按钮，选择「添加到主屏幕」。';
        } else if (macSafari && Number(macSafari[1]) >= 17) {
            title = '添加到程序坞';
            instructions = '在支持网页应用的 Mac 上，打开 Safari 的「文件」菜单，选择「添加到程序坞」。';
        } else if (/Android/.test(ua)) {
            title = '添加到主屏幕';
            instructions = '打开浏览器菜单，选择「安装应用」或「添加到主屏幕」。菜单名称随浏览器而异。';
        }
        document.getElementById('install-title').textContent = title;
        card.hidden = !instructions;
        const label = document.getElementById('install-label');
        let installPrompt = null;
        window.addEventListener('beforeinstallprompt', event => {
            event.preventDefault();
            installPrompt = event;
            card.hidden = false;
            label.textContent = '安装 MindSpace';
        });
        const button = document.getElementById('btn-install');
        button.addEventListener('click', async () => {
            if (installPrompt) {
                const prompt = installPrompt;
                installPrompt = null;
                label.textContent = '安装说明';
                card.hidden = !instructions;
                try { await prompt.prompt(); }
                catch { app.showToast('安装未能启动，请查看浏览器菜单。'); }
                return;
            }
            app.showModal(title, `<p>${instructions}</p>`, [
                { text: '完成', class: 'primary-btn', onClick: () => app.hideModal() }
            ]);
        });
        window.addEventListener('appinstalled', () => { card.hidden = true; });
    });

    let registration = null;
    let registrationRequest = null;
    const watchedWorkers = new WeakSet();
    let audioPaths = [];
    let audioOperation = null;
    let statusRevision = 0;

    function renderUpdateStatus() {
        const status = document.getElementById('app-update-status');
        if (!status) return;
        const ready = Boolean(registration?.active && registration.waiting);
        status.hidden = !ready;
        status.textContent = ready ? '网页更新已就绪。关闭所有打开的 MindSpace 页面，再重新打开即可生效。' : '';
    }

    function watchWorker(candidate) {
        if (!candidate || watchedWorkers.has(candidate)) return;
        watchedWorkers.add(candidate);
        candidate.addEventListener('statechange', () => {
            renderUpdateStatus();
            if (candidate.state === 'activated' || candidate.state === 'redundant') {
                void refreshAudioStatus();
            }
        });
    }

    async function getRegistration() {
        if (!worker) return null;
        if (registration?.active || registration?.installing || registration?.waiting) return registration;
        if (!registrationRequest) {
            registrationRequest = (async () => {
                const current = await worker.getRegistration(scope.href);
                if (current?.scope === scope.href && (current.active || current.installing || current.waiting)) {
                    registration = current;
                    if (navigator.onLine !== false) void registration.update().catch(() => {});
                } else {
                    registration = await worker.register(new URL('./sw.js', scope), { updateViaCache: 'none' });
                }
                registration.addEventListener('updatefound', () => watchWorker(registration.installing));
                watchWorker(registration.installing);
                watchWorker(registration.waiting);
                watchWorker(registration.active);
                renderUpdateStatus();
                return registration;
            })().catch(() => null).finally(() => { registrationRequest = null; });
        }
        return registrationRequest;
    }

    function showSoundStatus(message, { count = 0, ready = false, busy = false, available = true, retry = false } = {}) {
        const label = document.getElementById('audio-cache-status');
        const button = document.getElementById('btn-cache-audio');
        const clear = document.getElementById('btn-clear-audio-cache');
        label.textContent = message;
        button.classList.toggle('hidden', !available);
        button.disabled = ready || busy;
        button.textContent = ready ? '已保存到本机' : busy ? '正在处理…' : retry ? '重试离线设置' : '保存离线音轨';
        if (clear) {
            clear.classList.toggle('hidden', !available || count === 0);
            clear.disabled = busy;
        }
    }

    function fullAudio(response) {
        return response?.status === 200 && !response.headers.has('Content-Range') &&
            /^(audio\/|application\/octet-stream\b)/i.test(response.headers.get('Content-Type') || '');
    }

    async function savedPathCount(cache, paths) {
        const entries = await Promise.all(paths.map(path => cache.match(path)));
        return entries.filter(fullAudio).length;
    }

    async function refreshAudioStatus(failure = '') {
        if (audioOperation || !audioPaths.length) return;
        const revision = ++statusRevision;
        if (packaged) {
            showSoundStatus('音轨随应用提供，可离线播放。', { available: false });
            return;
        }
        if (!worker) {
            showSoundStatus('此浏览环境暂不支持保存离线音轨。', { available: false });
            return;
        }
        if (registration?.active?.state !== 'activated') {
            if (registration?.installing || registration?.waiting || registrationRequest) {
                showSoundStatus('正在准备离线功能…', { available: false });
            } else {
                showSoundStatus('离线功能尚未就绪。联网后可以重试。', { retry: true });
            }
            return;
        }

        try {
            const cache = await caches.open(cacheName);
            const count = await savedPathCount(cache, audioPaths);
            if (revision !== statusRevision) return;
            const ready = count === audioPaths.length;
            const summary = ready ? '六条音轨均可离线播放。' : `已保存 ${count}/${audioPaths.length} 条 · 全部约 14 MB`;
            showSoundStatus(failure ? `${summary}。 ${failure}` : summary, { count, ready });
        } catch {
            if (revision === statusRevision) showSoundStatus('无法访问本机音轨缓存。', { retry: true });
        }
    }

    function setPaths(paths) {
        audioPaths = [...new Set(paths.map(path => new URL(path, scope))
            .filter(url => url.origin === scope.origin && url.pathname.startsWith(`${scope.pathname}assets/sounds/`) &&
                url.pathname.endsWith('.mp3') && !url.search && !url.hash)
            .map(url => url.href))];
    }

    async function downloadSounds(paths) {
        const cache = await caches.open(cacheName);
        let count = await savedPathCount(cache, paths);
        for (const path of paths) {
            if (fullAudio(await cache.match(path))) continue;
            showSoundStatus(`正在保存 ${count}/${paths.length} 条音轨…`, { count, busy: true });
            const response = await fetch(path, { cache: 'reload' });
            if (!fullAudio(response)) throw new Error('下载没有返回完整音轨。');
            await cache.put(path, response);
            count++;
        }
    }

    function runAudioOperation(action) {
        if (audioOperation || !audioPaths.length || !worker) return audioOperation;
        ++statusRevision;
        showSoundStatus('正在准备…', { busy: true });
        const paths = [...audioPaths];
        let failure = '';
        audioOperation = (async () => {
            const current = await getRegistration();
            if (current?.active?.state !== 'activated') return;
            const operation = () => action === 'remove' ? caches.delete(cacheName) : downloadSounds(paths);
            // Downloads and removals share a per-scope lock where supported.
            if (navigator.locks?.request) await navigator.locks.request(cacheName, operation);
            else await operation();
        })().catch(() => {
            failure = action === 'remove' ? '移除未完成。请重试。' : '保存未完成。请检查网络或设备空间后重试。';
        }).finally(async () => {
            audioOperation = null;
            await refreshAudioStatus(failure);
        });
        return audioOperation;
    }

    document.addEventListener('DOMContentLoaded', () => {
        const clear = document.getElementById('btn-clear-audio-cache');
        clear?.addEventListener('click', () => app.showModal('移除离线音轨？', '<p>这会释放音轨占用的本机空间。你仍可在线收听，也可以随时重新保存。</p>', [
            { text: '取消', onClick: () => app.hideModal() },
            { text: '移除音轨', class: 'primary-btn', onClick: () => {
                app.hideModal();
                void runAudioOperation('remove');
            } }
        ]));
    });

    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
            renderUpdateStatus();
            void refreshAudioStatus();
        }
    });
    window.addEventListener('online', async () => {
        const current = await getRegistration();
        if (current?.active && !current.waiting) void current.update().catch(() => {});
        await refreshAudioStatus();
    });
    worker?.addEventListener('controllerchange', () => void refreshAudioStatus());

    window.MindSpaceOffline = {
        async refreshSoundStatus(paths) {
            setPaths(paths);
            const loading = getRegistration();
            await refreshAudioStatus();
            await loading;
            await refreshAudioStatus();
        },
        prepareSounds(paths) {
            setPaths(paths);
            return runAudioOperation('download');
        }
    };
})();
