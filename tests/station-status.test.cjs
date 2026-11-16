const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('radio-online-vanillaJS/station-status.js', 'utf8');
const context = vm.createContext({});
vm.runInContext(source, context);
const status = context.StationStatus.create();

test('載入、逾時失敗、成功播放會清掉標記', () => {
    let view = status.apply({ phase: 'loading', stationId: 'a' });
    assert.equal(view.loadingId, 'a');
    assert.equal(view.failed.a, undefined);
    view = status.apply({ phase: 'retrying', stationId: 'a' });
    assert.equal(view.loadingId, 'a');
    assert.equal(view.failed.a, true);
    view = status.apply({ phase: 'playing', stationId: 'a' });
    assert.equal(view.loadingId, '');
    assert.equal(view.failed.a, undefined);
});

test('舊頻道的失敗不會清掉，也不會蓋掉新頻道的載入', () => {
    const book = context.StationStatus.create();
    book.apply({ phase: 'retrying', stationId: 'a' });
    const view = book.apply({ phase: 'loading', stationId: 'b' });
    assert.equal(view.loadingId, 'b');
    assert.equal(view.failed.a, true);
    assert.equal(view.failed.b, undefined);
    const blocked = book.apply({ phase: 'blocked', stationId: 'b' });
    assert.equal(blocked.loadingId, '');
    assert.equal(blocked.failed.b, undefined);
    assert.equal(blocked.failed.a, true);
});
