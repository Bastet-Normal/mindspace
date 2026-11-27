const CACHE_NAME = "mindspace-shell-v1.2.72";
const VERSION = CACHE_NAME.slice("mindspace-shell-v".length);
const SCOPE = new URL(self.registration.scope);
const SHELL_CACHE = `${CACHE_NAME}:${SCOPE.pathname}`;
const AUDIO_CACHE = `mindspace-audio:${SCOPE.pathname}`;
const FONT_CACHE = `mindspace-fonts:${SCOPE.pathname}`;
const OPTIONAL_FONT_PATHS = [
    "./assets/fonts/zhuque-fangsong-v0.212.woff2",
    "./assets/fonts/ipaexg00401/ipaexg.ttf"
];
const OPTIONAL_FONTS = new Set(OPTIONAL_FONT_PATHS.map(path => new URL(path, SCOPE).href));
const APP_SHELL = [
    "./index.html", "./manifest.webmanifest?v=1.2.72",
    "./assets/favicon.png?v=1.2.72", "./assets/icon-192.png?v=1.2.72",
    "./assets/icon-512.png?v=1.2.72", "./assets/icon-1024.png?v=1.2.72",
    "./css/style.css?v=1.2.72", "./css/weather.css?v=1.2.72",
    "./css/practices.css?v=1.2.72", "./css/review-settings.css?v=1.2.72",
    "./js/icons.js?v=1.2.72", "./js/version.js?v=1.2.72", "./js/config.js?v=1.2.72",
    "./js/supabase-service.js?v=1.2.72", "./js/storage.js?v=1.2.72",
    "./assets/vendor/quill/quill-2.0.3.core.js", "./js/journal-editor.js?v=1.2.72",
    "./js/breathing.js?v=1.2.72", "./js/focus.js?v=1.2.72", "./js/app.js?v=1.2.72",
    "./js/pwa.js?v=1.2.72", "./assets/lakeshore.webp", "./assets/fonts/lxgw-wenkai-lite-v1.530.woff2",
    "./assets/fonts/lxgw-neo-xihei-v1.309.woff2",
    "./assets/vendor/supabase/supabase.js", "./assets/vendor/supabase/591.supabase.js"
];
const INDEX = new URL("./index.html", SCOPE);
const NAVIGATIONS = new Set([SCOPE.pathname, INDEX.pathname]);

self.addEventListener("install", event => {
    event.waitUntil((async () => {
        const cache = await caches.open(SHELL_CACHE);
        await cache.addAll(APP_SHELL.map(path => new Request(new URL(path, SCOPE), { cache: "reload" })));
        await validateShell(cache);
        // Wait for old pages to close before activating. Their scripts and
        // versioned assets must remain available until they stop running.
    })());
});

async function validateShell(cache) {
    for (const path of APP_SHELL) {
        const response = await cache.match(new URL(path, SCOPE));
        if (!response || (path !== "./index.html" && /text\/html/i.test(response.headers.get("Content-Type") || ""))) {
            throw new Error(`Incomplete MindSpace shell: ${path}`);
        }
    }
    const index = await (await cache.match(INDEX)).text();
    const version = await (await cache.match(new URL(`./js/version.js?v=${VERSION}`, SCOPE))).text();
    if (!index.includes(`js/version.js?v=${VERSION}`) || !version.includes(`MINDSPACE_VERSION = "${VERSION}"`)) {
        throw new Error("MindSpace shell does not match the service worker release.");
    }
}

self.addEventListener("activate", event => {
    event.waitUntil((async () => {
        for (const key of await caches.keys()) {
            const match = /^mindspace-shell-v\d+\.\d+\.\d+:(.*)$/.exec(key);
            if (key !== SHELL_CACHE && match?.[1] === SCOPE.pathname) await caches.delete(key);
            if (key === FONT_CACHE) {
                const fonts = await caches.open(key);
                for (const request of await fonts.keys()) {
                    if (!OPTIONAL_FONTS.has(request.url)) await fonts.delete(request);
                }
            }
        }
        await self.clients.claim();
    })());
});

function isInScope(url) {
    return url.origin === SCOPE.origin && url.pathname.startsWith(SCOPE.pathname);
}

function isFullAudio(response) {
    return response?.status === 200 && !response.headers.has("Content-Range") &&
        /^(audio\/|application\/octet-stream\b)/i.test(response.headers.get("Content-Type") || "");
}

function allowsRange(request, response) {
    const condition = request.headers.get("If-Range");
    if (!condition) return true;
    if (condition.startsWith('"')) return condition === response.headers.get("ETag");
    return Number.isFinite(Date.parse(condition)) && condition === response.headers.get("Last-Modified");
}

function unsatisfiable(length) {
    return new Response(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${length}`, "Accept-Ranges": "bytes" }
    });
}

async function readCache(name, request) {
    try {
        return await (await caches.open(name)).match(request);
    } catch {
        return undefined;
    }
}

async function audioResponse(request) {
    const cached = await readCache(AUDIO_CACHE, request.url);
    if (!isFullAudio(cached)) return fetch(request);

    const range = request.headers.get("Range");
    const match = /^bytes=(\d*)-(\d*)$/i.exec(range || "");
    // A server may ignore a malformed or unsupported multi-range request.
    if (!match || (!match[1] && !match[2]) || !allowsRange(request, cached)) return cached;

    // Slice the Blob without copying the entire MP3 into a JS ArrayBuffer
    // for Safari's small range probes.
    const audio = await cached.blob();
    const size = audio.size;
    const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
    const end = match[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
    if (start >= size || start > end) return unsatisfiable(size);
    const type = cached.headers.get("Content-Type");
    const headers = new Headers({
        "Content-Type": type,
        "Content-Length": String(end - start + 1),
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Accept-Ranges": "bytes"
    });
    for (const validator of ["ETag", "Last-Modified"]) {
        if (cached.headers.has(validator)) headers.set(validator, cached.headers.get(validator));
    }
    return new Response(audio.slice(start, end + 1, type), { status: 206, headers });
}

async function fontResponse(request) {
    const cached = await readCache(FONT_CACHE, request);
    if (cached) return cached;

    const response = await fetch(request);
    const mime = response.headers.get("Content-Type") || "";
    if (response.status === 200 && /^(font\/|application\/(?:octet-stream|(?:x-)?font-))/i.test(mime)) {
        try {
            await (await caches.open(FONT_CACHE)).put(request, response.clone());
        } catch { /* The browser can still use the downloaded font. */ }
    }
    return response;
}

self.addEventListener("fetch", event => {
    const { request } = event;
    const url = new URL(request.url);
    if (request.method !== "GET" || !isInScope(url)) return;

    if (url.pathname.startsWith(`${SCOPE.pathname}assets/sounds/`) && url.pathname.endsWith(".mp3")) {
        event.respondWith(audioResponse(request));
        return;
    }

    if (request.mode === "navigate") {
        if (NAVIGATIONS.has(url.pathname)) {
            event.respondWith((async () => await readCache(SHELL_CACHE, INDEX) || fetch(request))());
        }
        return;
    }

    if (OPTIONAL_FONTS.has(url.href)) {
        event.respondWith(fontResponse(request));
        return;
    }

    event.respondWith((async () => await readCache(SHELL_CACHE, request) || fetch(request))());
});
