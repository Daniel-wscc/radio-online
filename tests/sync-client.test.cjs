const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../radio-online-vanillaJS/sync-client.js'), 'utf8');
const context = vm.createContext({});
vm.runInContext(source, context);
const api = context.RadioSyncClient;

function extractVideoId(url) {
    var regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
    var match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
}

test('匯入保持輸入順序，無效行不會擋下其他網址', () => {
    const text = [
        'https://www.youtube.com/watch?v=aaaaaaaaaaa',
        '這行不是網址',
        'https://youtu.be/bbbbbbbbbbb',
        '',
        'https://www.youtube.com/watch?v=ccccccccccc'
    ].join('\n');
    const items = api.collectYoutubeImport(text, extractVideoId);
    const ids = [];
    const indexes = [];
    for (const item of items) {
        ids.push(String(item.videoId));
        indexes.push(Number(item.sourceIndex));
    }
    const kinds = [];
    for (const item of items) kinds.push(String(item.kind));
    assert.deepEqual(ids, ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc']);
    assert.deepEqual(indexes, [0, 2, 4]);
    assert.deepEqual(kinds, ['video', 'video', 'video']);
});

test('播放清單網址會整份匯入，含 list 的觀看網址也一樣，順序保持', () => {
    const text = [
        'https://www.youtube.com/watch?v=aaaaaaaaaaa',
        'https://www.youtube.com/playlist?list=PLccccccccccc',
        'https://www.youtube.com/watch?v=bbbbbbbbbbb&list=PLdddddddddd',
        'not a url'
    ].join('\n');
    const items = api.collectYoutubeImport(text, extractVideoId);
    const rows = [];
    for (const item of items) {
        rows.push({
            kind: String(item.kind),
            videoId: item.videoId ? String(item.videoId) : '',
            playlistId: item.playlistId ? String(item.playlistId) : '',
            sourceIndex: Number(item.sourceIndex)
        });
    }
    assert.deepEqual(rows, [
        { kind: 'video', videoId: 'aaaaaaaaaaa', playlistId: '', sourceIndex: 0 },
        { kind: 'playlist', videoId: '', playlistId: 'PLccccccccccc', sourceIndex: 1 },
        { kind: 'playlist', videoId: '', playlistId: 'PLdddddddddd', sourceIndex: 2 }
    ]);
});

test('連續調小音量時，自己較舊的回聲不會把音量拉高', () => {
    const clientId = 'A';
    let local = 0.8;
    let deferred = null;
    const echoes = [];
    for (let step = 0; step < 20; step++) {
        local = Math.round((0.8 - (step + 1) * 0.04) * 1000) / 1000;
        echoes.push({ volume: local, opId: step + 1 });
    }
    assert.equal(local, 0);
    let applied = local;
    for (const echo of echoes) {
        const decision = api.decideVolumeSync({
            incomingVolume: echo.volume,
            origin: { clientId: clientId, opId: echo.opId },
            clientId: clientId,
            latestLocalOpId: 20,
            interacting: false,
            withinSettle: true,
            deferredVolume: deferred
        });
        if (decision.applyNow) {
            assert.ok(decision.volume <= local, '本機音量不應被較舊回聲拉高');
            applied = decision.volume;
        } else if (!decision.ignore && decision.deferredVolume != null) {
            deferred = decision.deferredVolume;
        }
    }
    assert.equal(applied, 0);
    const foreign = api.decideVolumeSync({
        incomingVolume: 0.9,
        origin: { clientId: 'B', opId: 1 },
        clientId: clientId,
        latestLocalOpId: 20,
        interacting: true,
        withinSettle: true,
        deferredVolume: null
    });
    assert.equal(foreign.applyNow, false);
    assert.equal(foreign.deferredVolume, 0.9);
    const settled = api.decideVolumeSync({
        incomingVolume: 0.9,
        origin: { clientId: 'B', opId: 1 },
        clientId: clientId,
        latestLocalOpId: 20,
        interacting: false,
        withinSettle: false,
        deferredVolume: 0.9
    });
    assert.equal(settled.applyNow, true);
    assert.equal(settled.volume, 0.9);
    assert.equal(api.isOwnStaleEcho({ clientId: 'A', opId: 4 }, 'A', 20), true);
    assert.equal(api.isOwnStaleEcho({ clientId: 'B', opId: 1 }, 'A', 20), false);
});

test('音量四捨五入到小數兩位', () => {
    assert.equal(api.roundVolume(0.22999999999999998), 0.23);
    assert.equal(api.roundVolume(1.004), 1);
    assert.equal(api.roundVolume(-0.02), 0);
    assert.equal(api.roundVolume('nope'), null);
});

test('較舊的版號要捨棄，拖曳中的音量先暫存、放開後再套用', () => {
    assert.equal(api.isStaleRevision(5, 4), true);
    assert.equal(api.isStaleRevision(5, 5), false);
    assert.equal(api.isStaleRevision(5, 6), false);
    assert.equal(api.nextAppliedRevision(5, 6), 6);
    assert.equal(api.nextAppliedRevision(5, 4), 5);
    const held = api.reconcileVolume(true, null, 0.39);
    assert.equal(held.applyNow, false);
    assert.equal(held.deferredVolume, 0.39);
    const released = api.reconcileVolume(false, 0.39, 0.89);
    assert.equal(released.applyNow, true);
    assert.equal(released.volume, 0.89);
    assert.equal(released.deferredVolume, null);
});
