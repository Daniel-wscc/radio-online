const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

const app = fs.readFileSync('radio-online-vanillaJS/app.js', 'utf8');
const ast = ts.createSourceFile('app.js', app, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const names = [
    'syncYoutubeVolume', 'armYoutubeVolumeChecks', 'markYoutubePlaybackWanted',
    'markYoutubePlaybackPaused', 'youtubePauseIsIntentional', 'youtubeShouldResume',
    'youtubeReachedEnd', 'readYoutubeVideoId', 'cancelYoutubeResume',
    'resumeYoutubeFromBackground', 'noteUnexpectedYoutubePause', 'onPlayerStateChange',
    'advanceYoutubeFromEnd', 'clearBackgroundKeeper', 'ensureBackgroundKeeper',
    'checkYoutubeEnd', 'radioDebug'
];
const code = ast.statements.filter(function (node) {
    return ts.isFunctionDeclaration(node) && names.indexOf(node.name.text) !== -1;
}).map(function (node) { return node.getText(ast); }).join('\n');

function boot(options) {
    const calls = [];
    const timers = [];
    const player = {
        volume: 40,
        muted: false,
        current: options.current,
        duration: options.duration,
        videoId: options.videoId,
        log: [],
        getCurrentTime: function () { return this.current; },
        getDuration: function () { return this.duration; },
        getVideoData: function () { return { video_id: this.videoId }; },
        setVolume: function (value) { this.volume = value; this.log.push('set:' + value); },
        getVolume: function () { return this.volume; },
        isMuted: function () { return this.muted; },
        mute: function () { this.muted = true; },
        unMute: function () { this.muted = false; },
        playVideo: function () { this.log.push('play'); }
    };
    const context = vm.createContext({
        console: { error() {}, log() {} },
        getSavedVolume: function () { return 0.4; },
        youtubePlayer: player,
        youtubeVolumeTimers: [],
        youtubeWantedPlaying: true,
        youtubePauseIntent: null,
        youtubeResumeCount: options.resumeCount || 0,
        youtubeResumeTimer: null,
        youtubeResumeEpoch: 0,
        youtubeBlockEnded: false,
        youtubeBackgroundTimer: null,
        YOUTUBE_RESUME_MAX: 4,
        YOUTUBE_RESUME_MS: 1000,
        isYoutubeMode: true,
        playlist: [
            { id: 'aaaaaaaaaaa', itemId: 'a' },
            { id: 'bbbbbbbbbbb', itemId: 'b' },
            { id: 'ccccccccccc', itemId: 'c' }
        ],
        currentVideoIndex: options.index || 0,
        playYoutubeIndex: function (index, playOptions) {
            calls.push({ index: index, fromEnd: !!(playOptions && playOptions.fromEnd) });
        },
        updatePlayPauseButton: function () {},
        setTimeout: function (fn, ms) { timers.push({ fn: fn, ms: ms }); return timers.length; },
        clearTimeout: function () {},
        YT: { PlayerState: { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3 } },
        wasFullscreen: false,
        document: { hidden: true }
    });
    vm.runInContext(code, context);
    return { context: context, calls: calls, timers: timers, player: player };
}

test('播放中接近片尾時，即使沒有 ENDED 也只推進一首', () => {
    const env = boot({ current: 199.4, duration: 200, videoId: 'aaaaaaaaaaa', index: 0 });
    env.context.checkYoutubeEnd();
    env.context.checkYoutubeEnd();
    assert.equal(env.calls.length, 1);
    assert.equal(env.calls[0].index, 1);
    assert.equal(env.calls[0].fromEnd, true);
    assert.equal(env.player.log.indexOf('play'), -1);
});

test('片尾 PAUSED 接著 ENDED 只推進一首，不會被恢復重播', () => {
    const env = boot({ current: 199.5, duration: 200, videoId: 'aaaaaaaaaaa', index: 0 });
    env.context.onPlayerStateChange({ data: 2 });
    env.context.onPlayerStateChange({ data: 0 });
    env.context.onPlayerStateChange({ data: 0 });
    assert.equal(env.player.log.indexOf('play'), -1);
    assert.equal(env.calls.length, 1);
    assert.equal(env.calls[0].index, 1);
    assert.equal(env.calls[0].fromEnd, true);
});

test('最後一首結束後回到第一首，而且只一次', () => {
    const env = boot({ current: 200, duration: 200, videoId: 'ccccccccccc', index: 2 });
    env.context.onPlayerStateChange({ data: 2 });
    env.context.onPlayerStateChange({ data: 0 });
    assert.equal(env.calls.length, 1);
    assert.equal(env.calls[0].index, 0);
});

test('同步已經切到下一首時，舊片的 ENDED 不再推進', () => {
    const env = boot({ current: 200, duration: 200, videoId: 'aaaaaaaaaaa', index: 1 });
    env.context.onPlayerStateChange({ data: 0 });
    assert.equal(env.calls.length, 0);
});

test('播放中段的背景暫停仍會恢復', () => {
    const env = boot({ current: 10, duration: 200, videoId: 'aaaaaaaaaaa', index: 0 });
    env.context.onPlayerStateChange({ data: 2 });
    assert.equal(env.player.log.indexOf('play') >= 0, true);
    assert.equal(env.calls.length, 0);
});

test('ENDED 會取消尚未執行的恢復重試', () => {
    const env = boot({ current: 10, duration: 200, videoId: 'aaaaaaaaaaa', index: 0, resumeCount: 1 });
    env.context.onPlayerStateChange({ data: 2 });
    assert.equal(env.timers.length, 1);
    env.player.current = 200;
    env.context.onPlayerStateChange({ data: 0 });
    env.timers[0].fn();
    assert.equal(env.calls.length, 1);
    assert.equal(env.calls[0].index, 1);
    assert.equal(env.player.log.indexOf('play'), -1);
});
