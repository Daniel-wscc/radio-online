const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const typescript = require('typescript');

// Run the same behavioral checks against each independently owned implementation.
const angularPlayer = process.env.PLAYER_IMPL === 'angular';
const source = angularPlayer
    ? typescript.transpileModule(fs.readFileSync('src/app/radio/stream-player.ts', 'utf8'), {
        compilerOptions: { target: typescript.ScriptTarget.ES2022, module: typescript.ModuleKind.CommonJS }
    }).outputText + '\nglobalThis.RadioStreamPlayer = exports.StreamPlayer;'
    : fs.readFileSync('radio-online-vanillaJS/stream-player.js', 'utf8');
const A = { id: 'a', name: 'A', url: 'https://example.test/a' };
const B = { id: 'b', name: 'B', url: 'https://antares.dribbcast.com/proxy/kpop?mp=/s' };
const C = { id: 'c', name: 'C', url: 'https://example.test/c' };

function setup(Hls) {
    let now = 1000;
    const states = [];
    const nodes = [];
    let intervalCleared = false;
    class Audio extends EventTarget {
        readyState = 0;
        currentTime = 0;
        paused = true;
        style = {};
        end = 0;
        playCalls = 0;
        get buffered() {
            return { length: this.end ? 1 : 0, start: () => 0, end: () => this.end };
        }
        setAttribute() {}
        removeAttribute() { this.src = ''; }
        load() {}
        play() { this.playCalls++; this.paused = false; return Promise.resolve(); }
        pause() { this.paused = true; this.dispatchEvent(new Event('pause')); }
    }
    const host = {
        appendChild(audio) { nodes.push(audio); audio.parentNode = host; },
        removeChild(audio) { nodes.splice(nodes.indexOf(audio), 1); audio.parentNode = null; }
    };
    const context = vm.createContext({
        exports: {},
        document: { createElement: () => new Audio() },
        Date: { now: () => now }, Promise,
        setInterval: () => 1, clearInterval: () => { intervalCleared = true; }
    });
    vm.runInContext(source, context);
    const player = new context.RadioStreamPlayer({ host, Hls, onState: s => states.push(s) });
    return {
        player, states, nodes, advance(ms) { now += ms; player.tick(); },
        get cleared() { return intervalCleared; }
    };
}

async function ready(env) {
    const audio = env.player.pending.audio;
    audio.readyState = 3; // Deliberately never emits canplaythrough / readyState 4.
    audio.end = 5;
    env.player.tick();
    await Promise.resolve();
    audio.currentTime += 1.1;
    env.player.tick();
    return audio;
}

test('A stays audible until B is buffered AND confirmed advancing; handoff uses latest volume', async () => {
    const e = setup(); e.player.select(A); const a = await ready(e);
    e.player.select(B); const b = e.player.pending.audio;
    assert.equal(a.paused, false);
    assert.equal(a.muted, false);
    b.readyState = 3; b.end = 0.5; e.player.tick();
    assert.equal(b.playCalls, 0);
    e.player.setVolume(0.3);
    assert.equal(a.volume, 0.3);
    assert.equal(b.muted, true);
    b.end = 5; e.player.tick(); await Promise.resolve();
    assert.equal(a.paused, false, 'play promise alone must not stop A');
    b.currentTime = 1.1; e.player.tick();
    assert.equal(a.paused, true);
    assert.equal(b.muted, false);
    assert.equal(b.volume, 0.3);
    assert.equal(e.nodes.length, 1);
    assert.equal(e.states.at(-1).activeName, 'B');
});

test('B fails or never loads: A continues while B retries with a fresh connection', async () => {
    const e = setup(); e.player.select(A); const a = await ready(e);
    e.player.select(B);
    e.advance(15001);
    assert.equal(a.paused, false);
    assert.equal(e.states.at(-1).phase, 'retrying');
    e.advance(2000);
    assert.match(e.player.pending.audio.src, /_streamRetry=/);
    e.player.pending.audio.dispatchEvent(new Event('error'));
    assert.equal(a.paused, false);
    assert.equal(e.player.pending, null);
});

test('real buffering progress extends the watchdog; there is no fixed 30-second start delay', async () => {
    const e = setup(); e.player.select(B);
    const audio = e.player.pending.audio;
    audio.end = 1; e.advance(14000);
    audio.end = 2; e.advance(14000);
    assert.equal(e.states.at(-1).phase, 'loading');
    await ready(e);
    assert.equal(e.states.at(-1).phase, 'playing');
});

test('A→B→C cancels B, including late play promises and errors', async () => {
    const e = setup(); e.player.select(A); const a = await ready(e);
    e.player.select(B); const b = e.player.pending.audio;
    let resolve;
    b.play = () => new Promise(r => { resolve = r; });
    b.readyState = 3; b.end = 5; e.player.tick();
    e.player.select(C); resolve(); await Promise.resolve();
    b.dispatchEvent(new Event('error'));
    assert.equal(a.paused, false);
    assert.equal(e.player.target.name, 'C');
    const c = await ready(e);
    assert.equal(c.muted, false);
    assert.equal(a.paused, true);
    assert.equal(b.paused, true);
});

test('selecting A again cancels B and keeps the existing A connection', async () => {
    const e = setup(); e.player.select(A); const a = await ready(e);
    e.player.select(B); e.player.select(A);
    assert.equal(e.player.pending, null);
    assert.equal(e.player.active.audio, a);
    assert.equal(e.nodes.length, 1);
});

test('old A errors cannot replace selected B', async () => {
    const e = setup(); e.player.select(A); const a = await ready(e);
    e.player.select(B); const pending = e.player.pending;
    a.dispatchEvent(new Event('error'));
    assert.equal(e.player.pending, pending);
    assert.equal(e.player.retryAt, 0);
});

test('YouTube/stop destroys A and B and prevents stale playback or retries', async () => {
    const e = setup(); e.player.select(A); const a = await ready(e);
    e.player.select(B); const b = e.player.pending.audio;
    e.player.stop(); e.advance(60000);
    assert.equal(a.paused, true);
    assert.equal(b.paused, true);
    assert.equal(e.nodes.length, 0);
    assert.equal(e.states.at(-1).phase, 'idle');
    e.player.destroy(); assert.equal(e.cleared, true);
});

test('autoplay rejection reports a local action instead of silently dropping A', async () => {
    const e = setup(); e.player.select(A); const a = await ready(e);
    e.player.select(B); const b = e.player.pending.audio;
    b.play = () => Promise.reject(Object.assign(new Error(), { name: 'NotAllowedError' }));
    b.readyState = 3; b.end = 5; e.player.tick(); await Promise.resolve();
    assert.equal(e.states.at(-1).phase, 'blocked');
    assert.equal(a.paused, false);
    e.advance(60000); assert.equal(e.player.pending, null);
});

test('HLS has a separate instance for B and disposes A only at handoff', async () => {
    const instances = [];
    class Hls {
        static isSupported() { return true; }
        static Events = { ERROR: 'error' };
        constructor() { instances.push(this); }
        on() {}
        loadSource(url) { this.url = url; }
        attachMedia(audio) { this.audio = audio; }
        destroy() { this.destroyed = true; }
    }
    const e = setup(Hls);
    e.player.select({ ...A, url: 'https://example.test/a.m3u8' }); await ready(e);
    e.player.select({ ...B, url: 'https://example.test/b.m3u8' });
    assert.equal(instances[0].destroyed, undefined);
    await ready(e);
    assert.equal(instances[0].destroyed, true);
    assert.equal(instances[1].destroyed, undefined);
    e.player.destroy(); assert.equal(instances[1].destroyed, true);
});

test('muted volume remains muted after handoff', async () => {
    const e = setup(); e.player.setVolume(0); e.player.select(B);
    const b = await ready(e);
    assert.equal(b.volume, 0); assert.equal(b.muted, true);
});

test('a short preload ceiling can warm up; a startup stall resets the confirmation period', async () => {
    const e = setup(); e.player.select(A); const a = await ready(e);
    e.player.select(B); const b = e.player.pending.audio;
    b.readyState = 4; b.end = 2.32; e.player.tick(); await Promise.resolve();
    assert.equal(b.playCalls, 1);
    b.currentTime = 0.8; b.dispatchEvent(new Event('waiting'));
    b.currentTime = 1.1; b.end = 4; e.player.tick();
    assert.equal(a.paused, false);
    b.currentTime = 1.9; e.player.tick();
    assert.equal(a.paused, true);
});

test('TV remote snapshots select B without pausing A; volume-only snapshots do not restart B', () => {
    const ts = require('typescript');
    const app = fs.readFileSync('radio-online-vanillaJS/app.js', 'utf8');
    const ast = ts.createSourceFile('app.js', app, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const names = ['handleStateUpdate', 'handleInitialState', 'updateRadioState'];
    const code = ast.statements.filter(n => ts.isFunctionDeclaration(n) && names.includes(n.name.text))
        .map(n => n.getText(ast)).join('\n');
    const selected = [];
    const sent = [];
    let pauses = 0;
    const context = vm.createContext({
        console: { log() {} }, isYoutubeMode: false, currentStation: A,
        document: { querySelectorAll: () => [] },
        youtubeSection: { style: {} }, controlCard: { style: {} }, currentStationName: {},
        youtubePlayer: null, window: {}, volumeSyncLockUntil: 0,
        audioPlayer: { pause() { pauses++; } },
        startRadioTransition: s => selected.push(s), stopRadioPlayback: () => { pauses++; },
        normalizeVolume: v => v, rememberVolume() {}, applyAudioVolume() {}, getSavedVolume: () => 0.5,
        radioPlaybackPhase: 'loading', playlist: [], currentVideoIndex: -1, lastSentPlaylist: [],
        getPlaylistVideoId: () => null, playlistsEqual: () => true,
        socket: { emit: (name, data) => sent.push(data) }
    });
    vm.runInContext(code, context);
    context.handleStateUpdate({ currentStation: B, isPlaying: true });
    assert.equal(selected.length, 1);
    assert.equal(pauses, 0);
    context.handleStateUpdate({ currentStation: { ...B }, volume: 0.4, isPlaying: true });
    assert.equal(selected.length, 1, 'missing youtubeState must not be interpreted as a mode switch');
    context.updateRadioState();
    assert.equal(sent[0].currentStation.id, B.id);
    assert.equal(sent[0].isPlaying, true, 'broadcast intent, not candidate.paused');
    context.handleInitialState({ currentStation: C, isPlaying: true });
    assert.equal(selected.at(-1).id, C.id);
    assert.equal(pauses, 0);
});

test('Angular broadcasts the selected B immediately while its local A is still playing', () => {
    const ts = require('typescript');
    const app = fs.readFileSync('src/app/radio/radio.component.ts', 'utf8');
    const ast = ts.createSourceFile('radio.ts', app, ts.ScriptTarget.Latest, true);
    const cls = ast.statements.find(ts.isClassDeclaration);
    const methods = cls.members.filter(n => ['playStation', 'selectStation'].includes(n.name?.getText(ast)))
        .map(n => n.getText(ast)).join('\n');
    const compiled = ts.transpile('class Radio {' + methods + '}', { target: ts.ScriptTarget.ES2022 });
    const context = vm.createContext({ localStorage: { getItem: () => 'test' } });
    const Radio = vm.runInContext(compiled + '; Radio', context);
    const component = new Radio();
    const sent = [];
    const selected = [];
    component.stations = [A, B]; component.volume = 0.4;
    component.playbackState = { phase: 'playing', activeName: A.name };
    component.preserveVolumeForSourceSwitch = () => 0.4;
    component.streamPlayer = { setVolume() {}, select: station => selected.push(station) };
    component.chatService = { sendSystemMessage() {} };
    component.radioSync = { currentState: {}, updateState: state => sent.push(state) };
    component.selectStation(B);
    assert.equal(selected[0].url, B.url);
    assert.equal(component.playbackState.activeName, A.name);
    assert.equal(sent[0].currentStation.id, B.id);
    assert.equal(sent[0].isPlaying, true);
});

test('repeated initial snapshots keep an in-flight B connection', () => {
    const e = setup(); e.player.select(B); const b = e.player.pending;
    e.player.select({ ...B });
    assert.equal(e.player.pending, b);
    assert.equal(e.nodes.length, 1);
});
