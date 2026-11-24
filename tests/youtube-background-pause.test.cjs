const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

const app = fs.readFileSync('radio-online-vanillaJS/app.js', 'utf8');
const ast = ts.createSourceFile('app.js', app, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const names = [
    'syncYoutubeVolume', 'armYoutubeVolumeChecks', 'loadYoutubeVideoNow',
    'markYoutubePlaybackWanted', 'markYoutubePlaybackPaused', 'youtubePauseIsIntentional',
    'youtubeShouldResume', 'resumeYoutubeFromBackground', 'noteUnexpectedYoutubePause',
    'youtubeIsNearEnd', 'cancelYoutubeResume', 'readYoutubeVideoId',
    'onYoutubeVisibilityChange', 'onPlayerStateChange', 'toggleYoutubePlayback'
];
const code = ast.statements.filter(function (node) {
    return ts.isFunctionDeclaration(node) && names.indexOf(node.name.text) !== -1;
}).map(function (node) { return node.getText(ast); }).join('\n');

function FakePlayer() {
    this.volume = 40;
    this.muted = false;
    this.state = 1;
    this.log = [];
}
FakePlayer.prototype.mute = function () { this.muted = true; this.log.push('mute'); };
FakePlayer.prototype.unMute = function () { this.muted = false; this.log.push('unmute'); };
FakePlayer.prototype.setVolume = function (value) { this.volume = value; this.log.push('set:' + value); };
FakePlayer.prototype.getVolume = function () { return this.volume; };
FakePlayer.prototype.isMuted = function () { return this.muted; };
FakePlayer.prototype.getPlayerState = function () { return this.state; };
FakePlayer.prototype.pauseVideo = function () { this.state = 2; this.log.push('pause'); };
FakePlayer.prototype.playVideo = function () { this.log.push('play'); };

function boot(options) {
    const emits = [];
    const timers = [];
    const player = new FakePlayer();
    const document = { hidden: !!options.hidden };
    const context = vm.createContext({
        console: { error() {}, log() {} },
        getSavedVolume: function () { return 0.4; },
        youtubePlayer: player,
        youtubeVolumeTimers: [],
        youtubeWantedPlaying: options.wanted !== false,
        youtubePauseIntent: options.intent || null,
        youtubeResumeCount: 0,
        youtubeResumeTimer: null,
        youtubeResumeEpoch: 0,
        youtubeBlockEnded: false,
        YOUTUBE_RESUME_MAX: 4,
        YOUTUBE_RESUME_MS: 1000,
        isYoutubeMode: true,
        playlist: [{ id: 'abcdefghijk', itemId: 'item-1' }],
        currentVideoIndex: 0,
        playYoutubeIndex: function () { emits.push('playIndex'); },
        updatePlayPauseButton: function () {},
        setTimeout: function (fn, ms) { timers.push({ fn: fn, ms: ms }); return timers.length; },
        clearTimeout: function () {},
        YT: { PlayerState: { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 } },
        wasFullscreen: false,
        document: document,
        socket: { emit: function (name) { emits.push(name); } }
    });
    vm.runInContext(code, context);
    return { context: context, emits: emits, timers: timers, player: player, document: document };
}

test('背景分頁造成的暫停不會送出，而且會立刻恢復並套用音量', () => {
    const env = boot({ hidden: true, wanted: true });
    env.context.onPlayerStateChange({ data: 2 });
    assert.deepEqual(env.emits, []);
    assert.equal(env.player.log.filter(function (item) { return item === 'play'; }).length, 1);
    const playAt = env.player.log.indexOf('play');
    assert.ok(playAt > 0);
    assert.equal(env.player.log[playAt - 1].indexOf('set:'), 0);
    assert.equal(env.player.volume, 40);
});

test('使用者按暫停會停住，不會被自動恢復，也不會多送暫停指令', () => {
    const env = boot({ hidden: true, wanted: true });
    env.player.state = 1;
    env.context.toggleYoutubePlayback();
    env.context.onPlayerStateChange({ data: 2 });
    env.document.hidden = false;
    env.context.onYoutubeVisibilityChange();
    assert.deepEqual(env.emits, []);
    assert.equal(env.player.log.indexOf('pause'), 0);
    assert.equal(env.player.log.indexOf('play'), -1);
    assert.equal(env.context.youtubePauseIntent, 'user');
});

test('同步來的暫停不會被背景恢復邏輯播回去', () => {
    const env = boot({ hidden: true, wanted: true, intent: 'sync' });
    env.context.onPlayerStateChange({ data: 2 });
    assert.deepEqual(env.emits, []);
    assert.equal(env.player.log.indexOf('play'), -1);
});

test('切回分頁時，若本來該播放就恢復', () => {
    const env = boot({ hidden: false, wanted: true });
    env.context.onYoutubeVisibilityChange();
    assert.equal(env.player.log.indexOf('play') >= 0, true);
    assert.deepEqual(env.emits, []);
});
