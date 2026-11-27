const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const { resolve, extname } = require("node:path");
const { runInNewContext } = require("node:vm");

const { version } = require("../package.json");
const root = resolve(__dirname, "..");
const source = readFile(resolve(root, "sw.js"), "utf8");
const scopePath = "/mindspace/";
const origin = "https://example.test";
const index = `${origin}${scopePath}index.html`;
const shellName = `mindspace-shell-v${version}:${scopePath}`;
const audioName = `mindspace-audio:${scopePath}`;
const track = `${origin}${scopePath}assets/sounds/forest.mp3`;

async function worker({ scope = scopePath, network } = {}) {
    const caches = new Map();
    const handlers = new Map();
    let claimed = 0;
    let skipped = 0;
    const addresses = [];
    const fetch = request => {
        const url = new URL(request.url || request);
        addresses.push(url.href);
        return network ? network(url) : new Response("network", { status: 503 });
    };
    const requestKey = request => request.url || String(request);
    const cacheAPI = {
        keys: async () => [...caches.keys()],
        delete: async key => caches.delete(key),
        async open(name) {
            if (!caches.has(name)) caches.set(name, new Map());
            const cache = caches.get(name);
            return {
                keys: async () => [...cache.keys()].map(url => new Request(url)),
                delete: async request => cache.delete(requestKey(request)),
                match: async request => cache.get(requestKey(request))?.clone(),
                put: async (request, response) => { cache.set(requestKey(request), response.clone()); },
                async addAll(requests) {
                    const responses = await Promise.all(requests.map(fetch));
                    if (responses.some(response => !response.ok)) throw new Error("asset fetch failed");
                    for (const [offset, request] of requests.entries()) cache.set(requestKey(request), responses[offset]);
                }
            };
        }
    };
    runInNewContext(await source, {
        self: {
            registration: { scope: origin + scope },
            addEventListener: (event, handler) => handlers.set(event, handler),
            clients: { claim: async () => { claimed++; } },
            skipWaiting: async () => { skipped++; }
        },
        Request, Response, Headers, URL, caches: cacheAPI, fetch
    });
    return {
        caches,
        addresses,
        get claimed() { return claimed; },
        get skipped() { return skipped; },
        async lifecycle(type) {
            let result;
            handlers.get(type)({ waitUntil: promise => { result = promise; } });
            return result;
        },
        fetch(url, { method = "GET", headers, navigate = false } = {}) {
            let result;
            handlers.get("fetch")({
                request: { url, method, headers: new Headers(headers), mode: navigate ? "navigate" : "cors" },
                respondWith: promise => { result = promise; }
            });
            return result;
        }
    };
}

async function shellFixture(url) {
    const file = url.pathname.slice(scopePath.length);
    const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" }[extname(file)];
    return new Response(await readFile(resolve(root, file)), { headers: mime ? { "Content-Type": mime } : {} });
}

test("service worker installs a consistent release while its predecessor remains available", async () => {
    const runtime = await worker({ network: shellFixture });
    const predecessor = `mindspace-shell-v1.0.0:${scopePath}`;
    runtime.caches.set(predecessor, new Map([[index, new Response("predecessor")]]));
    await runtime.lifecycle("install");

    assert.equal(runtime.skipped, 0);
    assert.equal(runtime.claimed, 0);
    assert.equal(await runtime.caches.get(predecessor).get(index).text(), "predecessor");
    assert.match(await runtime.caches.get(shellName).get(index).text(), new RegExp(`js/version\\.js\\?v=${version}`));
    assert.equal(runtime.addresses.filter(url => /\/index\.html$/.test(url)).length, 1);
});

test("optional journal fonts download on demand and stay available offline", async () => {
    const font = `${origin}${scopePath}assets/fonts/zhuque-fangsong-v0.212.woff2`;
    let response = new Response("<html>暂未发布</html>", { headers: { "Content-Type": "text/html" } });
    const runtime = await worker({
        network: url => url.href === font ? response.clone() : shellFixture(url)
    });
    await runtime.lifecycle("install");
    assert.equal(runtime.addresses.includes(font), false);

    assert.match(await (await runtime.fetch(font)).text(), /暂未发布/);
    response = new Response("journal font", { headers: { "Content-Type": "font/woff2" } });
    assert.equal(await (await runtime.fetch(font)).text(), "journal font");
    const retiredFont = `${origin}${scopePath}assets/fonts/smiley-sans-v2.0.1.woff2`;
    const cachedFonts = runtime.caches.get(`mindspace-fonts:${scopePath}`);
    cachedFonts.set(retiredFont, new Response("retired font"));
    await runtime.lifecycle("activate");
    assert.equal(cachedFonts.has(retiredFont), false);
    response = new Response("offline", { status: 503 });
    assert.equal(await (await runtime.fetch(font)).text(), "journal font");
    assert.equal(runtime.addresses.filter(url => url === font).length, 2);
});

test("service worker rejects the previous release HTML and HTML masquerading as an asset", async () => {
    for (const badFile of ["index.html", "js/app.js"]) {
        const runtime = await worker({
            network: async url => url.pathname.endsWith(`/${badFile}`)
                ? new Response("<html>旧版或发布中的占位页</html>", { headers: { "Content-Type": "text/html" } })
                : shellFixture(url)
        });
        await assert.rejects(runtime.lifecycle("install"), /MindSpace shell/);
        assert.equal(runtime.skipped, 0);
        assert.equal(runtime.claimed, 0);
    }
});

test("activation cleans only retired shells of its own scope", async () => {
    const runtime = await worker({ scope: "/" });
    const current = `mindspace-shell-v${version}:/`;
    const sibling = "mindspace-shell-v1.0.0:/mindspace/";
    const kept = [current, sibling, "mindspace-shell-v0.0.1", "other-app-shell:/", "mindspace-audio:/"];
    for (const name of [...kept, "mindspace-shell-v1.0.0:/"]) runtime.caches.set(name, new Map());
    await runtime.lifecycle("activate");
    assert.deepEqual([...runtime.caches.keys()], kept);
    assert.equal(runtime.claimed, 1);
});

test("root and index navigations serve the installed shell despite deployment changes", async () => {
    const runtime = await worker();
    runtime.caches.set(shellName, new Map([[index, new Response("installed shell")]]));
    for (const navigation of [`${origin}${scopePath}?src=share`, `${index}?reload=true`]) {
        assert.equal(await (await runtime.fetch(navigation, { navigate: true })).text(), "installed shell");
    }
    assert.equal(runtime.fetch(`${origin}${scopePath}unrelated.html`, { navigate: true }), undefined);
    assert.equal(runtime.fetch(`${origin}/neighbor/index.html`, { navigate: true }), undefined);
    assert.deepEqual(runtime.addresses, []);
});

test("cached MP3 supports Safari probes, open ranges and suffix ranges", async () => {
    const runtime = await worker();
    runtime.caches.set(audioName, new Map([[track, new Response("0123456789", {
        headers: { "Content-Type": "audio/mpeg", "ETag": '"track"', "Last-Modified": "Tue, 24 Nov 2026 12:00:00 GMT" }
    })]]));
    for (const [range, text, contentRange] of [
        ["bytes=0-1", "01", "bytes 0-1/10"],
        ["bytes=5-", "56789", "bytes 5-9/10"],
        ["bytes=-3", "789", "bytes 7-9/10"],
        ["bytes=8-999", "89", "bytes 8-9/10"]
    ]) {
        const response = await runtime.fetch(track, { headers: { Range: range } });
        assert.equal(response.status, 206);
        assert.equal(response.headers.get("content-range"), contentRange);
        assert.equal(response.headers.get("content-length"), String(text.length));
        assert.equal(response.headers.get("etag"), '"track"');
        assert.equal(await response.text(), text);
    }
    for (const range of ["bytes=10-", "bytes=-0", "bytes=4-2"]) {
        const response = await runtime.fetch(track, { headers: { Range: range } });
        assert.equal(response.status, 416);
        assert.equal(response.headers.get("content-range"), "bytes */10");
    }
    assert.equal((await runtime.fetch(track, { headers: { Range: "bytes=0-1,5-6" } })).status, 200);
    assert.equal((await runtime.fetch(track, { headers: { Range: "bytes=0-1", "If-Range": '"different"' } })).status, 200);
    assert.equal((await runtime.fetch(track, { headers: { Range: "bytes=0-1", "If-Range": 'W/"track"' } })).status, 200);
    assert.equal((await runtime.fetch(track, { headers: { Range: "bytes=0-1", "If-Range": '"track"' } })).status, 206);
    assert.deepEqual(runtime.addresses, []);
});

test("worker ignores invalid cached media and leaves audio persistence to explicit downloads", async () => {
    const runtime = await worker({
        network: () => new Response("new audio", { headers: { "Content-Type": "audio/mpeg" } })
    });
    const invalid = new Response("<html>missing sound</html>", { headers: { "Content-Type": "text/html" } });
    runtime.caches.set(audioName, new Map([[track, invalid]]));
    assert.equal(await (await runtime.fetch(track, { headers: { Range: "bytes=0-1" } })).text(), "new audio");
    assert.equal(runtime.caches.get(audioName).get(track), invalid);
    assert.deepEqual(runtime.addresses, [track]);
});

function eventTarget(properties = {}) {
    const listeners = new Map();
    return {
        ...properties,
        addEventListener(type, handler) {
            if (!listeners.has(type)) listeners.set(type, []);
            listeners.get(type).push(handler);
        },
        dispatch(type) { return Promise.all((listeners.get(type) || []).map(handler => handler())); }
    };
}

async function pwa({ packaged = false, network = () => new Response("mp3", { headers: { "Content-Type": "audio/mpeg" } }) } = {}) {
    const elements = new Map();
    const cache = new Map();
    const calls = [];
    let modal;
    const page = eventTarget({
        baseURI: index,
        getElementById(id) {
            if (!elements.has(id)) {
                const classes = new Set(["hidden"]);
                elements.set(id, eventTarget({
                    hidden: true,
                    classList: {
                        contains: name => classes.has(name),
                        toggle(name, flag) {
                            if (flag) classes.add(name);
                            else classes.delete(name);
                        }
                    }
                }));
            }
            return elements.get(id);
        }
    });
    const browser = eventTarget({ isSecureContext: true, caches: {} });
    if (packaged) browser.Capacitor = { isNativePlatform: () => true };
    const registration = eventTarget({
        scope: origin + scopePath,
        active: eventTarget({ state: "activated" }),
        update: async () => {}
    });
    const navigator = {
        serviceWorker: eventTarget({ getRegistration: async () => registration }),
        locks: {
            async request(name, operation) {
                assert.equal(name, audioName);
                return operation();
            }
        }
    };
    const caches = {
        open: async () => ({
            match: async path => cache.get(path)?.clone(),
            put: async (path, response) => { cache.set(path, response); }
        }),
        delete: async () => cache.clear()
    };
    const source = await readFile(resolve(root, "js/pwa.js"), "utf8");
    runInNewContext(source, {
        app: { showModal: (_title, _body, actions) => { modal = actions; }, hideModal() {} },
        window: browser, document: page, location: { protocol: "https:" }, navigator, caches, URL,
        matchMedia: () => ({ matches: false }),
        fetch: path => {
            calls.push(path);
            return network(path);
        }
    });
    await page.dispatch("DOMContentLoaded");
    return {
        page, registration, cache, calls, api: browser.MindSpaceOffline,
        get modal() { return modal; }
    };
}

const tracks = ["rain", "forest", "ocean", "wind", "fire", "brook"]
    .map(name => `./assets/sounds/${name}.mp3`);

test("a partial download reports actual saved tracks and retries only missing or invalid tracks", async () => {
    let interrupted = true;
    const runtime = await pwa({
        network: path => interrupted && path.endsWith("/ocean.mp3")
            ? new Response("<html>missing</html>", { headers: { "Content-Type": "text/html" } })
            : new Response("mp3", { headers: { "Content-Type": "audio/mpeg" } })
    });
    const first = new URL(tracks[0], index).href;
    runtime.cache.set(first, new Response("<html>invalid old entry</html>", { headers: { "Content-Type": "text/html" } }));
    await runtime.api.refreshSoundStatus(tracks);
    assert.match(runtime.page.getElementById("audio-cache-status").textContent, /已保存 0\/6/);

    const inProgress = runtime.api.prepareSounds(tracks);
    assert.strictEqual(runtime.api.prepareSounds(tracks), inProgress);
    await inProgress;
    assert.match(runtime.page.getElementById("audio-cache-status").textContent, /已保存 2\/6.*保存未完成/);
    assert.equal(runtime.calls.length, 3);
    assert.equal(runtime.cache.size, 2);

    interrupted = false;
    await runtime.api.prepareSounds(tracks);
    assert.equal(runtime.cache.size, 6);
    assert.equal(runtime.calls.length, 7);
    assert.equal(runtime.page.getElementById("audio-cache-status").textContent, "六条音轨均可离线播放。");
    assert.equal(runtime.page.getElementById("btn-cache-audio").disabled, true);

    await runtime.page.getElementById("btn-clear-audio-cache").dispatch("click");
    runtime.modal.find(action => action.text === "移除音轨").onClick();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(runtime.cache.size, 0);
    assert.match(runtime.page.getElementById("audio-cache-status").textContent, /已保存 0\/6/);
});

test("web settings announces a waiting release while packaged builds bypass the worker", async () => {
    const runtime = await pwa();
    await runtime.api.refreshSoundStatus(tracks);
    const status = runtime.page.getElementById("app-update-status");
    assert.equal(status.hidden, true);
    const update = eventTarget({ state: "installing" });
    runtime.registration.installing = update;
    await runtime.registration.dispatch("updatefound");
    runtime.registration.installing = null;
    runtime.registration.waiting = update;
    update.state = "installed";
    await update.dispatch("statechange");
    assert.equal(status.hidden, false);
    assert.match(status.textContent, /网页更新已就绪/);

    const native = await pwa({ packaged: true });
    await native.api.refreshSoundStatus(tracks);
    assert.equal(native.page.getElementById("install-card").hidden, true);
    assert.equal(native.page.getElementById("audio-cache-status").textContent, "音轨随应用提供，可离线播放。");
    assert.equal(native.page.getElementById("btn-cache-audio").classList.contains("hidden"), true);
});
