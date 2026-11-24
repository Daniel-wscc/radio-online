const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const vm = require('node:vm');
const { Server } = require('socket.io');
const { io: ioClient } = require('socket.io-client');
const Database = require('better-sqlite3');
const { createRadioStore, attachRadioSync, applyCommand } = require('../apps/radio-online-server/radio-sync.cjs');

function tempDb() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'radio-sync-'));
    const db = new Database(path.join(dir, 'radio.db'));
    return { dir, db };
}

function listen(store) {
    const server = http.createServer();
    const io = new Server(server, { transports: ['websocket'] });
    attachRadioSync(io, store);
    return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => resolve({ server, io, port: server.address().port }));
    });
}

function connect(port) {
    const socket = ioClient('http://127.0.0.1:' + port, { transports: ['websocket'], forceNew: true });
    const states = [];
    socket.on('radioStateUpdate', (state) => states.push(state));
    return new Promise((resolve, reject) => {
        socket.on('connect', () => resolve({ socket, states }));
        socket.on('connect_error', reject);
    });
}

async function until(check, label) {
    const start = Date.now();
    while (Date.now() - start < 3000) {
        if (check()) return;
        await new Promise((resolve) => setTimeout(resolve, 15));
    }
    throw new Error('逾時：' + label);
}

test('兩個客戶端同時切台與調音量，最後狀態與版號一致', async () => {
    const { db } = tempDb();
    const store = createRadioStore(db);
    const live = await listen(store);
    const a = await connect(live.port);
    const b = await connect(live.port);
    await until(() => a.states.length && b.states.length, '初始狀態');
    a.socket.emit('setStation', { station: { id: 'custom_1', name: '甲台', url: 'https://example.test/a' } });
    b.socket.emit('setStation', { station: { id: 'custom_2', name: '乙台', url: 'https://example.test/b' } });
    a.socket.emit('setVolume', { volume: 0.39 });
    b.socket.emit('setVolume', { volume: 0.89 });
    await until(() => {
        const left = a.states[a.states.length - 1];
        const right = b.states[b.states.length - 1];
        return left && right && left.revision === right.revision && left.revision >= 4;
    }, '版號收斂');
    const left = a.states[a.states.length - 1];
    const right = b.states[b.states.length - 1];
    assert.equal(left.revision, right.revision);
    assert.equal(left.currentStation.id, right.currentStation.id);
    assert.equal(left.volume, right.volume);
    assert.ok(left.volume === 0.39 || left.volume === 0.89);
    a.socket.close();
    b.socket.close();
    live.io.close();
    live.server.close();
    db.close();
});

test('同時移動佇列後兩邊順序與版號相同，索引 0 會被保存', async () => {
    const { db, dir } = tempDb();
    const store = createRadioStore(db);
    const live = await listen(store);
    const a = await connect(live.port);
    const b = await connect(live.port);
    a.socket.emit('queueAddMany', { items: [
        { videoId: 'aaaaaaaaaaa', title: '一' },
        { videoId: 'bbbbbbbbbbb', title: '二' },
        { videoId: 'ccccccccccc', title: '三' }
    ]});
    await until(() => a.states.some((state) => state.youtubeState.playlist.length === 3), '佇列');
    const queued = a.states.filter((state) => state.youtubeState.playlist.length === 3).pop();
    const first = queued.youtubeState.playlist[0];
    const third = queued.youtubeState.playlist[2];
    a.socket.emit('playIndex', { index: 0, itemId: first.itemId });
    a.socket.emit('queueMove', { itemId: first.itemId, toIndex: 2 });
    b.socket.emit('queueMove', { itemId: third.itemId, toIndex: 0 });
    await until(() => {
        const left = a.states[a.states.length - 1];
        const right = b.states[b.states.length - 1];
        return left && right && left.revision === right.revision &&
            left.youtubeState.playlist.map((item) => item.itemId).join() ===
            right.youtubeState.playlist.map((item) => item.itemId).join();
    }, '順序收斂');
    const finalState = a.states[a.states.length - 1];
    assert.equal(finalState.youtubeState.currentIndex >= 0, true);
    db.close();
    const reopened = createRadioStore(new Database(path.join(dir, 'radio.db')));
    const restored = reopened.getState();
    assert.equal(restored.youtubeState.playlist.length, 3);
    assert.notEqual(restored.youtubeState.currentIndex, -1);
    const playing = restored.youtubeState.playlist[restored.youtubeState.currentIndex];
    assert.equal(playing.id, restored.youtubeState.currentVideoId);
    a.socket.close();
    b.socket.close();
    live.io.close();
    live.server.close();
});

test('音量指令不會清掉電台，重開資料庫仍保留音量、電台與佇列', () => {
    const { db, dir } = tempDb();
    const store = createRadioStore(db);
    const station = { id: 'custom_6', name: 'BigB', url: 'https://example.test/kpop' };
    assert.equal(store.apply('setStation', { station }).ok, true);
    assert.equal(store.apply('setVolume', { volume: 0.42 }).ok, true);
    assert.equal(store.apply('queueAdd', { videoId: 'abcdefghijk', title: '歌' }).ok, true);
    assert.equal(store.apply('playIndex', { index: 0 }).ok, true);
    const before = store.getState();
    assert.equal(before.youtubeState.currentIndex, 0);
    assert.equal(before.volume, 0.42);
    assert.equal(before.currentStation.id, 'custom_6');
    db.close();
    const again = createRadioStore(new Database(path.join(dir, 'radio.db')));
    const after = again.getState();
    assert.equal(after.volume, 0.42);
    assert.equal(after.currentStation.name, 'BigB');
    assert.equal(after.youtubeState.playlist.length, 1);
    assert.equal(after.youtubeState.playlist[0].id, 'abcdefghijk');
    assert.equal(after.youtubeState.currentIndex, 0);
    again.apply('setVolume', { volume: 0.2 });
    const partial = again.getState();
    assert.equal(partial.currentStation.id, 'custom_6');
    assert.equal(partial.youtubeState.playlist.length, 1);
    assert.equal(partial.youtubeState.currentIndex, 0);
});

test('大型佇列下連續調小音量仍很快，兩邊都停在 0，而且不會重寫播放清單', async () => {
    const { db } = tempDb();
    const store = createRadioStore(db);
    const items = [];
    for (let i = 0; i < 300; i++) {
        items.push({ videoId: 'v' + String(10000000 + i), title: '曲' + i });
    }
    assert.equal(store.apply('queueAddMany', { items }).ok, true);
    const playlistWrites = store.playlistWrites();
    const live = await listen(store);
    const a = await connect(live.port);
    const b = await connect(live.port);
    await until(() => a.states.length && b.states.length, '初始狀態');
    try {
        const durations = [];
        let intent = 0.8;
        for (let step = 0; step < 20; step++) {
            intent = Math.round((0.8 - (step + 1) * 0.04) * 1000) / 1000;
            const started = process.hrtime.bigint();
            const applied = store.apply('setVolume', { volume: intent, clientId: 'A', opId: step + 1 });
            durations.push(Number(process.hrtime.bigint() - started) / 1e6);
            assert.equal(applied.ok, true);
            a.socket.emit('setVolume', { volume: intent, clientId: 'A', opId: step + 1 });
        }
        assert.ok(Math.max.apply(null, durations) < 25, '單次音量處理過慢：' + Math.max.apply(null, durations));
        assert.equal(store.playlistWrites(), playlistWrites);
        assert.equal(store.getState().volume, 0);
        assert.equal(store.getState().volumeOrigin.clientId, 'A');
        assert.equal(store.getState().volumeOrigin.opId, 20);
        await until(() => {
            const left = a.states[a.states.length - 1];
            const right = b.states[b.states.length - 1];
            return left && right && left.volume === 0 && right.volume === 0 && left.revision === right.revision;
        }, '音量歸零');
        store.flush();
        const again = createRadioStore(new Database(db.name));
        assert.equal(again.getState().volume, 0);
        assert.equal(again.getState().youtubeState.playlist.length, 300);
    } finally {
        a.socket.close();
        b.socket.close();
        live.io.close();
        live.server.close();
        store.flush();
        db.close();
    }
});

test('音量會先限制在 0 到 1，再四捨五入到小數兩位', () => {
    const { db } = tempDb();
    const store = createRadioStore(db);
    const messy = store.apply('setVolume', { volume: 0.22999999999999998 });
    assert.equal(messy.ok, true);
    assert.equal(messy.state.volume, 0.23);
    assert.equal(store.apply('setVolume', { volume: 1.2 }).state.volume, 1);
    assert.equal(store.apply('setVolume', { volume: -0.04 }).state.volume, 0);
    db.close();
});

test('空佇列仍可進入 YouTube，無效匯入行會被跳過且順序不變', () => {
    const { db } = tempDb();
    const store = createRadioStore(db);
    const mode = store.apply('setMode', { mode: 'youtube' });
    assert.equal(mode.ok, true);
    assert.equal(mode.state.youtubeState.isYoutubeMode, true);
    assert.equal(mode.state.youtubeState.playlist.length, 0);
    const added = store.apply('queueAddMany', { items: [
        { videoId: 'aaaaaaaaaaa', title: '先' },
        { title: '沒有網址' },
        { videoId: 'bbbbbbbbbbb', title: '後' }
    ]});
    assert.deepEqual(added.state.youtubeState.playlist.map((item) => item.id), ['aaaaaaaaaaa', 'bbbbbbbbbbb']);
    const base = { revision: 3, volume: 1, isPlaying: false, currentStation: null, youtubeState: { isYoutubeMode: false, playlist: [], currentIndex: 0, currentVideoId: 'x' } };
    const indexed = applyCommand(base, 'playIndex', { index: 0 }, { seq: 1 });
    assert.equal(indexed.ok, false);
    db.close();
});

test('自動跳過帶 fromIndex 時，只有第一台還停在原曲的請求會生效', () => {
    const { db } = tempDb();
    const store = createRadioStore(db);
    assert.equal(store.apply('queueAddMany', { items: [
        { videoId: 'aaaaaaaaaaa', title: '壞' },
        { videoId: 'bbbbbbbbbbb', title: '下一首' },
        { videoId: 'ccccccccccc', title: '再下一首' }
    ] }).ok, true);
    assert.equal(store.getState().youtubeState.currentIndex, 0);
    const first = store.apply('playIndex', { index: 1, fromIndex: 0 });
    assert.equal(first.ok, true);
    assert.equal(store.getState().youtubeState.currentIndex, 1);
    const again = store.apply('playIndex', { index: 1, fromIndex: 0 });
    assert.equal(again.ok, false);
    const stale = store.apply('playIndex', { index: 2, fromIndex: 0 });
    assert.equal(stale.ok, false);
    assert.equal(store.getState().youtubeState.currentIndex, 1);
    assert.equal(store.getState().youtubeState.currentVideoId, 'bbbbbbbbbbb');
    const chosen = store.apply('playIndex', { index: 2 });
    assert.equal(chosen.ok, true);
    assert.equal(store.getState().youtubeState.currentIndex, 2);
    db.close();
});

test('快速連按下一首，延遲打亂回聲後兩台最後都停在第 5 首', async () => {
    const { db } = tempDb();
    const store = createRadioStore(db);
    const items = [];
    for (let i = 0; i < 6; i++) items.push({ videoId: 'song' + i + 'xxxxx', title: '歌' + (i + 1) });
    assert.equal(store.apply('queueAddMany', { items }).ok, true);
    assert.equal(store.apply('setMode', { mode: 'youtube' }).ok, true);
    const live = await listen(store);
    const a = await connect(live.port);
    const b = await connect(live.port);
    await until(() => a.states.length && b.states.length, '初始狀態');
    const originalEmit = live.io.emit.bind(live.io);
    live.io.emit = function (event, payload) {
        const index = payload && payload.youtubeState ? payload.youtubeState.currentIndex : 0;
        const delay = event === 'radioStateUpdate' ? (6 - index) * 25 : 0;
        setTimeout(function () { originalEmit(event, payload); }, delay);
    };
    const source = fs.readFileSync(require('path').join(__dirname, '../radio-online-vanillaJS/sync-client.js'), 'utf8');
    const context = vm.createContext({});
    vm.runInContext(source, context);
    const api = context.RadioSyncClient;
    const session = api.createSession();
    for (let i = 1; i <= 5; i++) {
        const op = api.issueOp(session, 'play');
        a.socket.emit('playIndex', { index: i, clientId: op.clientId, opId: op.opId });
    }
    function newest(states) {
        return states.reduce(function (best, state) {
            return !best || state.revision > best.revision ? state : best;
        }, null);
    }
    await until(() => {
        const left = newest(a.states);
        const right = newest(b.states);
        return left && right && left.youtubeState.currentIndex === 5 && right.youtubeState.currentIndex === 5;
    }, '兩台停在第 5 首');
    let applied = -1;
    let pending = 5;
    let pendingOp = session.playOpId;
    let shown = 5;
    const ui = [5];
    a.states.forEach(function (state) {
        if (api.isStaleRevision(applied, state.revision)) {
            ui.push(shown);
            return;
        }
        applied = api.nextAppliedRevision(applied, state.revision);
        const decision = api.decidePlayIndexSync({
            pendingIndex: pending,
            pendingOpId: pendingOp,
            clientId: session.clientId,
            incomingIndex: state.youtubeState.currentIndex,
            origin: state.playOrigin || null
        });
        if (decision.apply) {
            shown = state.youtubeState.currentIndex;
            if (decision.clearPending) {
                pending = null;
                pendingOp = 0;
            }
        }
        ui.push(shown);
    });
    for (let i = 1; i < ui.length; i++) {
        assert.equal(ui[i] >= ui[i - 1], true, '畫面索引倒退：' + ui.join(','));
    }
    assert.equal(ui[ui.length - 1], 5);
    assert.equal(newest(b.states).youtubeState.currentIndex, 5);
    a.socket.close();
    b.socket.close();
    live.io.close();
    live.server.close();
    db.close();
});
