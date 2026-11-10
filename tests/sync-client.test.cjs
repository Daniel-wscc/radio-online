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
    assert.deepEqual(ids, ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc']);
    assert.deepEqual(indexes, [0, 2, 4]);
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
