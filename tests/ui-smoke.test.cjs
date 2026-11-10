const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '../radio-online-vanillaJS');
const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const WEBOS_UA = 'Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/87.0.4280.88 Safari/537.36 WebAppManager';
const SOCKET_STUB = 'window.io=function(){var s={on:function(){return s;},emit:function(){return s;}};return s;};\n';
const YOUTUBE_STUB = [
    'window.YT=window.YT||{};',
    'window.YT.PlayerState={UNSTARTED:-1,ENDED:0,PLAYING:1,PAUSED:2,BUFFERING:3,CUED:5};',
    'window.YT.Player=function(){return {loadVideoById:function(){},cueVideoById:function(){},playVideo:function(){},pauseVideo:function(){},stopVideo:function(){},seekTo:function(){},setVolume:function(){},mute:function(){},unMute:function(){},getPlayerState:function(){return -1;},getCurrentTime:function(){return 0;},destroy:function(){}};};',
    'if (typeof window.onYouTubeIframeAPIReady==="function") window.onYouTubeIframeAPIReady();'
].join('\n');
const NOW_PLAYING = JSON.stringify({
    kpop: 'NOW PLAYING TEST SONG TITLE THAT IS LONG ENOUGH',
    jpop: 'J-Pop',
    cpop: 'C-Pop',
    apop: 'A-Pop'
});

const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2'
};

function startServer() {
    const server = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://127.0.0.1');
        const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
        if (rel === 'vendor/socket.io/socket.io.min.js') {
            res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
            res.end(SOCKET_STUB);
            return;
        }
        const file = path.resolve(root, rel);
        if (file !== root && !file.startsWith(root + path.sep)) {
            res.writeHead(403);
            res.end();
            return;
        }
        fs.readFile(file, (err, buf) => {
            if (err) {
                res.writeHead(404);
                res.end();
                return;
            }
            res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
            res.end(buf);
        });
    });
    return new Promise((resolve, reject) => {
        server.listen(0, '127.0.0.1', () => resolve(server));
        server.on('error', reject);
    });
}

function findBrowser() {
    if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) {
        return process.env.CHROME_PATH;
    }
    const local = process.env.LOCALAPPDATA || '';
    const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const candidates = [
        path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        path.join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        path.join(local, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/usr/bin/microsoft-edge',
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
    ];
    for (const file of candidates) {
        if (file && fs.existsSync(file)) return file;
    }
    return '';
}

function stopProcess(proc) {
    return new Promise((resolve) => {
        if (!proc || proc.exitCode !== null || proc.signalCode !== null) {
            resolve();
            return;
        }
        let settled = false;
        const finish = () => {
            if (settled) return;
            settled = true;
            resolve();
        };
        proc.once('exit', finish);
        try {
            proc.kill();
        } catch (error) {
            finish();
            return;
        }
        setTimeout(() => {
            if (proc.exitCode !== null || proc.signalCode !== null) {
                finish();
                return;
            }
            if (process.platform === 'win32' && proc.pid) {
                const killer = spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
                killer.on('exit', finish);
                killer.on('error', finish);
                return;
            }
            try { proc.kill('SIGKILL'); } catch (error) { /* 略過 */ }
            finish();
        }, 1000);
    });
}

function waitForDevtools(chrome) {
    return new Promise((resolve, reject) => {
        let buf = '';
        let settled = false;
        const finish = (err, value) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            if (err) reject(err);
            else resolve(value);
        };
        const timer = setTimeout(() => finish(new Error('瀏覽器沒有開啟除錯連接\n' + buf)), 10000);
        const onData = (chunk) => {
            buf += chunk.toString();
            const match = buf.match(/ws:\/\/(?:127\.0\.0\.1|localhost):\d+\/devtools\/browser\/[^\s]+/);
            if (match) finish(null, match[0]);
        };
        chrome.on('error', (err) => finish(new Error('無法啟動瀏覽器：' + err.message)));
        if (chrome.stdout) chrome.stdout.on('data', onData);
        if (chrome.stderr) chrome.stderr.on('data', onData);
        chrome.on('exit', (code) => finish(new Error('瀏覽器提前結束，代碼 ' + code + '\n' + buf)));
    });
}

class Cdp {
    constructor(url) {
        this.url = url;
        this.id = 0;
        this.pending = new Map();
        this.listeners = [];
    }
    open() {
        this.ws = new WebSocket(this.url);
        return new Promise((resolve, reject) => {
            this.ws.addEventListener('open', () => resolve());
            this.ws.addEventListener('error', () => reject(new Error('無法連接 Chrome 除錯埠')));
            this.ws.addEventListener('message', (event) => {
                const msg = JSON.parse(event.data);
                if (msg.id && this.pending.has(msg.id)) {
                    const item = this.pending.get(msg.id);
                    this.pending.delete(msg.id);
                    if (msg.error) item.reject(new Error(JSON.stringify(msg.error)));
                    else item.resolve(msg.result || {});
                } else if (msg.method) {
                    for (const listener of this.listeners) listener(msg);
                }
            });
        });
    }
    send(method, params) {
        const id = ++this.id;
        return new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject });
            this.ws.send(JSON.stringify({ id, method, params: params || {} }));
        });
    }
    on(listener) { this.listeners.push(listener); }
    close() { try { this.ws.close(); } catch (error) { /* 略過 */ } }
}

function fulfill(cdp, requestId, body, contentType) {
    return cdp.send('Fetch.fulfillRequest', {
        requestId,
        responseCode: 200,
        responseHeaders: [
            { name: 'Content-Type', value: contentType },
            { name: 'Access-Control-Allow-Origin', value: '*' }
        ],
        body: Buffer.from(body).toString('base64')
    });
}

test('桌面與 webOS 使用者代理都能開啟頁面，且電視隱藏電腦功能', { timeout: 45000 }, async (t) => {
    const browserPath = findBrowser();
    if (!browserPath) {
        t.skip('找不到 Chrome 或 Edge，略過瀏覽器煙霧測試。可設定環境變數 CHROME_PATH。');
        return;
    }
    const server = await startServer();
    const port = server.address().port;
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'radio-smoke-'));
    const chrome = spawn(browserPath, [
        '--headless=new',
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--disable-background-networking',
        '--remote-allow-origins=*',
        '--remote-debugging-port=0',
        '--user-data-dir=' + profile
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    chrome.on('error', () => {});
    t.after(async () => {
        await stopProcess(chrome);
        await new Promise(resolve => setTimeout(resolve, 200));
        server.close();
        fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    });

    const browserWs = await waitForDevtools(chrome);
    const browser = new Cdp(browserWs);
    await browser.open();
    const created = await browser.send('Target.createTarget', { url: 'about:blank' });
    const pageWs = browserWs.replace(/\/devtools\/browser\/.*$/, '/devtools/page/' + created.targetId);
    const page = new Cdp(pageWs);
    await page.open();
    const errors = [];
    page.on((msg) => {
        if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
            const text = (msg.params.args || []).map(arg => arg.value || arg.description || '').join(' ');
            errors.push(text);
        }
        if (msg.method === 'Runtime.exceptionThrown') {
            errors.push(msg.params.exceptionDetails && msg.params.exceptionDetails.text);
        }
        if (msg.method === 'Log.entryAdded' && msg.params.entry && msg.params.entry.level === 'error') {
            errors.push(msg.params.entry.text);
        }
        if (msg.method === 'Fetch.requestPaused') {
            const url = msg.params.request.url;
            const id = msg.params.requestId;
            const done = url.indexOf('iframe_api') !== -1
                ? fulfill(page, id, YOUTUBE_STUB, 'text/javascript')
                : url.indexOf('nowplaying') !== -1
                    ? fulfill(page, id, NOW_PLAYING, 'application/json')
                    : page.send('Fetch.continueRequest', { requestId: id });
            // 換頁時攔截編號可能已失效，不能讓這個拒絕中斷測試。
            done.catch(function () {});
        }
    });
    await page.send('Runtime.enable');
    await page.send('Log.enable');
    await page.send('Page.enable');
    await page.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });

    async function openScenario(pathname, userAgent, width, height) {
        errors.length = 0;
        await page.send('Emulation.setUserAgentOverride', { userAgent });
        await page.send('Emulation.setDeviceMetricsOverride', {
            width, height, deviceScaleFactor: 1, mobile: width < 500
        });
        const loaded = new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('頁面載入逾時：' + pathname)), 8000);
            const listener = (msg) => {
                if (msg.method === 'Page.loadEventFired') {
                    clearTimeout(timer);
                    resolve();
                }
            };
            page.on(listener);
        });
        await page.send('Page.navigate', { url: 'http://127.0.0.1:' + port + pathname });
        await loaded;
        const started = Date.now();
        let state = null;
        while (Date.now() - started < 8000) {
            const result = await page.send('Runtime.evaluate', {
                expression: `JSON.stringify({
                    isTv: document.documentElement.classList.contains('is-tv'),
                    title: document.title,
                    version: document.getElementById('vanillaVersion').textContent,
                    nowPlayingCount: document.querySelectorAll('.now-playing-container').length,
                    nowText: (document.querySelector('[data-now-playing="custom_6"] .now-playing-text') || {}).textContent || '',
                    marquee: !!document.querySelector('[data-now-playing="custom_6"] .now-playing-text.marquee'),
                    playPause: !!document.getElementById('playPauseButton'),
                    mute: !!document.getElementById('muteButton'),
                    shuffle: !!document.getElementById('shuffleButton'),
                    moveUp: !!document.querySelector('.move-up-btn') || true,
                    theme: getComputedStyle(document.getElementById('themeSwitcher')).display,
                    themeToggle: getComputedStyle(document.getElementById('themeToggle')).display,
                    playlists: getComputedStyle(document.getElementById('openPlaylistsButton')).display,
                    chat: getComputedStyle(document.getElementById('chatToggle')).display,
                    menu: getComputedStyle(document.getElementById('mobileMenuButton')).display,
                    themeCount: document.querySelectorAll('#themeMenu [data-theme-id]').length,
                    resources: performance.getEntriesByType('resource').map(function (item) { return item.name; })
                })`,
                returnByValue: true
            });
            state = JSON.parse(result.result.value);
            if (state.nowText && state.nowText.indexOf('載入中') === -1) break;
            await new Promise(resolve => setTimeout(resolve, 150));
        }
        const noisy = errors.filter(text => text && !/favicon/i.test(text));
        assert.deepEqual(noisy, [], pathname + ' 主控台錯誤');
        return state;
    }

    const desktop = await openScenario('/', DESKTOP_UA, 1280, 720);
    assert.equal(desktop.isTv, false);
    assert.equal(desktop.title, '芯禾電台');
    assert.equal(desktop.version, 'v3.1.5');
    assert.equal(desktop.nowPlayingCount, 4);
    assert.equal(desktop.nowText, 'NOW PLAYING TEST SONG TITLE THAT IS LONG ENOUGH');
    assert.equal(desktop.marquee, true);
    assert.equal(desktop.playPause, true);
    assert.equal(desktop.mute, true);
    assert.equal(desktop.shuffle, true);
    assert.notEqual(desktop.theme, 'none');
    assert.equal(desktop.themeToggle, 'none');
    assert.equal(desktop.playlists, 'none');
    assert.equal(desktop.chat, 'none');
    assert.equal(desktop.menu, 'none');
    assert.equal(desktop.resources.some(name => name.indexOf('pc-chat.js') !== -1), false);
    assert.equal(desktop.resources.some(name => name.indexOf('pc-playlists.js') !== -1), true);
    assert.equal(desktop.resources.some(name => name.indexOf('pc-theme.js') !== -1), true);
    assert.equal(desktop.resources.some(name => name.indexOf('pc-layout.js') !== -1), true);
    assert.equal(desktop.themeCount, 8);

    const phone = await openScenario('/', DESKTOP_UA, 390, 800);
    assert.equal(phone.isTv, false);
    assert.notEqual(phone.menu, 'none');
    assert.equal(phone.chat, 'none');
    const drawer = await page.send('Runtime.evaluate', {
        expression: `(function () {
            document.getElementById('mobileMenuButton').click();
            var opened = document.body.classList.contains('sidebar-open');
            document.getElementById('mobileSidebarBackdrop').click();
            return JSON.stringify({ opened: opened, closed: !document.body.classList.contains('sidebar-open') });
        })()`,
        returnByValue: true
    });
    assert.deepEqual(JSON.parse(drawer.result.value), { opened: true, closed: true });

    const tv = await openScenario('/', WEBOS_UA, 1280, 720);
    assert.equal(tv.isTv, true);
    assert.equal(tv.title, '芯禾電台 電視版');
    assert.equal(tv.nowPlayingCount, 4);
    assert.equal(tv.marquee, true);
    assert.equal(tv.playPause, true);
    assert.equal(tv.theme, 'none');
    assert.notEqual(tv.themeToggle, 'none');
    assert.equal(tv.playlists, 'none');
    assert.equal(tv.chat, 'none');
    assert.equal(tv.menu, 'none');
    assert.equal(tv.resources.some(name => name.indexOf('pc-') !== -1), false);
    assert.equal(tv.themeCount, 0);

    const tvPhone = await openScenario('/', WEBOS_UA, 390, 800);
    assert.equal(tvPhone.isTv, true);
    assert.equal(tvPhone.menu, 'none');
    assert.equal(tvPhone.chat, 'none');

    const forcedTv = await openScenario('/?tv=1', DESKTOP_UA, 1280, 720);
    assert.equal(forcedTv.isTv, true);
    assert.equal(forcedTv.chat, 'none');
    assert.equal(forcedTv.resources.some(name => name.indexOf('pc-') !== -1), false);

    const forcedPc = await openScenario('/?tv=0', WEBOS_UA, 1280, 720);
    assert.equal(forcedPc.isTv, false);
    assert.equal(forcedPc.chat, 'none');
    assert.equal(forcedPc.playlists, 'none');
    assert.equal(forcedPc.resources.some(name => name.indexOf('pc-chat.js') !== -1), false);
    assert.equal(forcedPc.resources.some(name => name.indexOf('pc-playlists.js') !== -1), true);

    browser.close();
    page.close();
});
