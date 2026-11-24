const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

const app = fs.readFileSync('radio-online-vanillaJS/app.js', 'utf8');
const ast = ts.createSourceFile('app.js', app, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const names = [
    'radioDebug', 'readYoutubeVideoId', 'clearYoutubeSkipTimer', 'youtubeIndexFailed', 'setYoutubeSkipNotice',
    'scheduleYoutubeErrorSkip', 'commitYoutubeErrorSkip', 'onPlayerError',
    'clearYoutubeSkipNotice', 'scrubSkipStatusLeak'
];
const code = ast.statements.filter(function (node) {
    return ts.isFunctionDeclaration(node) && names.indexOf(node.name.text) !== -1;
}).map(function (node) { return node.getText(ast); }).join('\n');

function boot(playlist, index) {
    const calls = [];
    const timers = [];
    const notice = { textContent: '', style: {}, className: 'youtube-skip-notice' };
    const status = { textContent: '', style: {}, className: 'youtube-init-status' };
    const context = vm.createContext({
        console: { log() {}, error() {} },
        playlist: playlist,
        currentVideoIndex: index,
        youtubeSkipTimer: null,
        youtubeSkipIndex: -1,
        youtubeSkipVideoId: null,
        youtubeFailedPass: [],
        youtubeSkipNoticeText: '',
        youtubeSkipNoticeTimer: null,
        youtubeSkipNoticeToken: 0,
        youtubePlayer: null,
        playYoutubeIndex: function (next, options) {
            calls.push({ index: next, fromIndex: options && options.fromIndex, fromEnd: !!(options && options.fromEnd) });
        },
        setTimeout: function (fn, ms) { timers.push({ fn: fn, ms: ms }); return timers.length; },
        clearTimeout: function () {},
        document: {
            getElementById: function (id) {
                if (id === 'youtubeSkipNotice') return notice;
                if (id === 'youtubeInitStatus') return status;
                return null;
            }
        }
    });
    vm.runInContext(code, context);
    return { context: context, calls: calls, timers: timers, notice: notice, status: status };
}

const two = [
    { id: 'aaaaaaaaaaa', itemId: 'a' },
    { id: 'bbbbbbbbbbb', itemId: 'b' }
];

test('錯誤約 1 秒後跳到下一首，並送出原本的索引', () => {
    const env = boot(two, 0);
    env.context.onPlayerError({ data: 150 });
    env.context.onPlayerError({ data: 101 });
    assert.equal(env.timers[env.timers.length - 1].ms, 1000);
    assert.equal(env.calls.length, 0);
    env.timers[env.timers.length - 1].fn();
    assert.equal(env.calls.length, 1);
    assert.equal(env.calls[0].index, 1);
    assert.equal(env.calls[0].fromIndex, 0);
    assert.equal(env.calls[0].fromEnd, true);
    assert.equal(env.notice.textContent, '這首無法播放，已自動跳過');
    assert.equal(env.status.textContent, '');
});

test('1 秒內已經換歌就取消自動跳過', () => {
    const env = boot(two, 0);
    env.context.onPlayerError({ data: 100 });
    env.context.currentVideoIndex = 1;
    env.timers[0].fn();
    assert.equal(env.calls.length, 0);
    assert.equal(env.notice.textContent, '');
});

test('整份清單都無法播放時，走完一輪就停止', () => {
    const env = boot(two.slice(), 0);
    function fireSkip() {
        var i;
        for (i = env.timers.length - 1; i >= 0; i--) {
            if (env.timers[i].ms === 1000 && !env.timers[i].fired) {
                env.timers[i].fired = true;
                env.timers[i].fn();
                return;
            }
        }
    }
    env.context.onPlayerError({ data: 150 });
    fireSkip();
    assert.equal(env.calls.length, 1);
    env.context.currentVideoIndex = 1;
    env.context.onPlayerError({ data: 150 });
    fireSkip();
    assert.equal(env.calls.length, 1);
    assert.equal(env.notice.textContent, '這首無法播放，已停止自動跳過');
});

test('只有一首且無法播放時不會反覆重播', () => {
    const env = boot([{ id: 'aaaaaaaaaaa', itemId: 'a' }], 0);
    env.context.onPlayerError({ data: 2 });
    env.timers[0].fn();
    assert.equal(env.calls.length, 0);
    assert.equal(env.notice.textContent, '這首無法播放，已停止自動跳過');
    const hide = env.timers[env.timers.length - 1];
    assert.equal(hide.ms, 3000);
    hide.fn();
    assert.equal(env.notice.textContent, '');
});

test('跳過提示約 3 秒後消失，重複顯示會重算時間', () => {
    const env = boot(two, 0);
    env.context.setYoutubeSkipNotice('這首無法播放，已自動跳過');
    const first = env.timers[env.timers.length - 1];
    assert.equal(first.ms, 3000);
    env.context.setYoutubeSkipNotice('這首無法播放，已停止自動跳過');
    const second = env.timers[env.timers.length - 1];
    assert.equal(second.ms, 3000);
    first.fn();
    assert.equal(env.notice.textContent, '這首無法播放，已停止自動跳過');
    second.fn();
    assert.equal(env.notice.textContent, '');
    assert.equal(env.notice.style.display, 'none');
});

test('換歌會清掉跳過提示', () => {
    const source = fs.readFileSync('radio-online-vanillaJS/app.js', 'utf8');
    assert.match(source, /function playYoutubeIndex[\s\S]{0,400}clearYoutubeSkipNotice\(\)/);
    const env = boot(two, 0);
    env.status.textContent = '這首無法播放，已自動跳過';
    env.context.setYoutubeSkipNotice('這首無法播放，已自動跳過');
    assert.equal(env.status.textContent, '');
    env.context.clearYoutubeSkipNotice();
    assert.equal(env.notice.textContent, '');
    env.timers[env.timers.length - 1].fn();
    assert.equal(env.notice.textContent, '');
});
