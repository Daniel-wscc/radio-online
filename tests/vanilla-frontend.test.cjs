const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const vanilla = path.join(root, 'radio-online-vanillaJS');

function read(name) {
    return fs.readFileSync(path.join(vanilla, name), 'utf8');
}

function load(filename, sandbox) {
    const context = vm.createContext(sandbox);
    vm.runInContext(read(filename), context, { filename });
    return context;
}

test('頁面版本與 package.json 一致', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const match = read('index.html').match(/id="vanillaVersion">v([^<]+)</);
    assert.ok(match, '找不到版本標籤');
    assert.equal(match[1], pkg.version);
    assert.equal(pkg.version, '3.1.0');
});

test('頁面不再引用外部 CDN', () => {
    const html = read('index.html');
    assert.doesNotMatch(html, /cdn\.jsdelivr|cdn\.socket\.io|unpkg\.com|googleapis\.com/);
    assert.match(html, /vendor\/bootstrap\/css\/bootstrap\.min\.css/);
    assert.match(html, /vendor\/bootstrap\/js\/bootstrap\.bundle\.min\.js/);
    assert.match(html, /vendor\/bootstrap-icons\/bootstrap-icons\.css/);
    assert.match(html, /vendor\/socket\.io\/socket\.io\.min\.js/);
    assert.match(html, /vendor\/hls\.js\/hls\.min\.js/);
    assert.match(fs.readFileSync(path.join(vanilla, 'vendor/socket.io/socket.io.min.js'), 'utf8'), /Socket\.IO v4\.5\.4/);
    assert.match(fs.readFileSync(path.join(vanilla, 'vendor/bootstrap/css/bootstrap.min.css'), 'utf8'), /Bootstrap {2}v5\.3\.0/);
    assert.match(fs.readFileSync(path.join(vanilla, 'vendor/hls.js/hls.min.js'), 'utf8'), /1\.5\.20/);
});

test('電視判斷：使用者代理與網址覆寫', () => {
    const sandbox = load('platform.js', {});
    const detect = sandbox.detectTvMode;
    assert.equal(detect('Mozilla/5.0 (Web0S; Linux/SmartTV) Chrome/87.0.4280.88', ''), true);
    assert.equal(detect('Mozilla/5.0 (webOS; Linux) AppleWebKit', ''), true);
    assert.equal(detect('Mozilla/5.0 (Linux; NetCast) SmartTV', ''), true);
    assert.equal(detect('Mozilla/5.0 (Windows NT 10.0) Chrome/120.0.0.0', ''), false);
    assert.equal(detect('Mozilla/5.0 (Windows NT 10.0) Chrome/120.0.0.0', '?tv=1'), true);
    assert.equal(detect('Mozilla/5.0 (Web0S) Chrome/87', '?tv=0'), false);
    assert.equal(detect('Mozilla/5.0 (Windows NT 10.0)', '?station=1&tv=1&x=2'), true);
    assert.equal(detect('Mozilla/5.0 (Windows NT 10.0)', '?tv=10'), false);
});

test('Socket 位址依路徑或設定檔決定', () => {
    const prod = 'https://radio.wscc1031.synology.me';
    const testUrl = 'https://test.wscc1031.synology.me';
    const sandbox = load('config.js', { location: { pathname: '/radio-online/' } });
    assert.equal(sandbox.resolveRadioSocketUrl({}, '/radio-online/'), prod);
    assert.equal(sandbox.resolveRadioSocketUrl({}, '/radio-online-test/'), testUrl);
    assert.equal(sandbox.resolveRadioSocketUrl({}, '/radio-online-test/extra'), testUrl);
    assert.equal(sandbox.resolveRadioSocketUrl({ socketUrl: 'http://127.0.0.1:1034' }, '/radio-online-test/'), 'http://127.0.0.1:1034');
    assert.equal(sandbox.RADIO_SOCKET_URL, prod);
    assert.equal(sandbox.RADIO_NOWPLAYING_URL, prod + '/api/nowplaying');
});

test('BigB 頻道解析與現正播放快取', () => {
    const sandbox = load('now-playing.js', {
        Date,
        setInterval() { return 1; },
        clearInterval() {},
        addEventListener() {},
        fetch() { return Promise.resolve({ ok: true, json: () => Promise.resolve({}) }); },
        RADIO_NOWPLAYING_URL: 'https://example.test/api/nowplaying'
    });
    const station = { id: 'custom_6', url: 'https://antares.dribbcast.com/proxy/kpop?mp=/s' };
    assert.equal(sandbox.NowPlaying.channelOf(station), 'kpop');
    assert.equal(sandbox.NowPlaying.isBigB(station), true);
    assert.equal(sandbox.NowPlaying.isBigB({ id: 'custom_1', url: 'https://example.test/a' }), false);
    assert.equal(sandbox.NowPlaying.channelOf({ url: 'https://example.test/no-proxy' }), null);
});

test('播放佇列上移下移會跟著目前歌曲，隨機排序保留同一首', () => {
    const sandbox = load('playlist-order.js', {});
    const list = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const down = sandbox.PlaylistOrder.moveItem(list, 0, 2, 0);
    assert.deepEqual(down.list.map(item => item.id), ['b', 'c', 'a']);
    assert.equal(down.currentIndex, 2);
    const past = sandbox.PlaylistOrder.moveItem(list, 2, 0, 1);
    assert.deepEqual(past.list.map(item => item.id), ['c', 'a', 'b']);
    assert.equal(past.currentIndex, 2);
    let n = 0;
    const shuffled = sandbox.PlaylistOrder.shuffleKeepCurrent(list, 1, () => {
        n += 1;
        return n % 2 === 0 ? 0 : 0.9;
    });
    assert.equal(shuffled.list[shuffled.currentIndex].id, 'b');
    assert.deepEqual(list.map(item => item.id), ['a', 'b', 'c']);
});

test('切台前先套用音量', () => {
    const app = read('app.js');
    const ast = ts.createSourceFile('app.js', app, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const fn = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name.text === 'startRadioTransition');
    const calls = [];
    const context = vm.createContext({
        radioStreamPlayer: {
            setVolume(value) { calls.push(['volume', value]); },
            select(station) { calls.push(['select', station.id]); }
        },
        getSavedVolume: () => 0.2
    });
    vm.runInContext(fn.getText(ast) + '\nstartRadioTransition({id:"b",name:"B",url:"https://example.test/b"});', context);
    assert.deepEqual(calls, [['volume', 0.2], ['select', 'b']]);

    const initial = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name.text === 'handleInitialState').getText(ast);
    const volumeAt = initial.indexOf('rememberVolume');
    const selectAt = initial.indexOf('startRadioTransition');
    assert.ok(volumeAt !== -1 && selectAt !== -1 && volumeAt < selectAt);
});

test('部署改為上傳 vanilla 靜態檔，且只有 rm 的 ssh 帶 -n', () => {
    const project = JSON.parse(fs.readFileSync(path.join(root, 'project.json'), 'utf8'));
    const deploy = project.targets.deploy;
    for (const commands of [deploy.options.commands, deploy.configurations.development.commands, deploy.configurations.production.commands]) {
        assert.equal(commands.some(line => /nx build|ng build|dist\/radio-online/.test(line)), false);
        const rm = commands.find(line => line.includes('rm -rf'));
        const upload = commands.find(line => line.includes('tar -czf'));
        assert.match(rm, /^ssh -n /);
        assert.match(upload, /cd radio-online-vanillaJS && tar -czf - \*/);
        assert.doesNotMatch(upload, /ssh -n /);
    }
    assert.match(deploy.configurations.production.commands.join('\n'), /\/volume1\/DEMO\/radio-online(?!-test)/);
    assert.match(deploy.configurations.development.commands.join('\n'), /\/volume1\/DEMO\/radio-online-test/);
    const server = JSON.parse(fs.readFileSync(path.join(root, 'apps/radio-online-server/project.json'), 'utf8'));
    assert.match(server.targets.deploy.configurations.production.commands.join('\n'), /docker-compose/);
});

test('vanilla 程式維持 Chromium 87 能跑的語法，樣式不使用新 CSS', () => {
    const files = fs.readdirSync(vanilla).filter(name => name.endsWith('.js'));
    for (const name of files) {
        const text = read(name);
        const source = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
        const problems = [];
        function walk(node, insideFunction) {
            if (node.kind === ts.SyntaxKind.ClassStaticBlockDeclaration) problems.push(name + ' class static block');
            const nested = insideFunction || ts.isFunctionLike(node);
            if (!nested && node.kind === ts.SyntaxKind.AwaitExpression) problems.push(name + ' top-level await');
            if (!nested && node.kind === ts.SyntaxKind.ForOfStatement && node.awaitModifier) problems.push(name + ' for await');
            ts.forEachChild(node, child => walk(child, nested));
        }
        walk(source, false);
        assert.deepEqual(problems, []);
        assert.doesNotMatch(text, /\.at\s*\(/);
    }
    const css = read('styles.css');
    assert.doesNotMatch(css, /oklch\(|color-mix\(|@layer|:has\(|aspect-ratio/);
});

test('node --check 通過所有 vanilla JavaScript', () => {
    const files = [];
    function walk(dir) {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.name.endsWith('.js')) files.push(full);
        }
    }
    walk(vanilla);
    assert.ok(files.length >= 8);
    for (const file of files) {
        const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
        assert.equal(result.status, 0, file + '\n' + result.stderr);
    }
});
