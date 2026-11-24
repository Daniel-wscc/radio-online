const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

const app = fs.readFileSync('radio-online-vanillaJS/app.js', 'utf8');
const ast = ts.createSourceFile('app.js', app, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const names = [
    'syncYoutubeVolume', 'armYoutubeVolumeChecks', 'loadYoutubeVideoNow', 'onPlayerStateChange',
    'markYoutubePlaybackWanted', 'markYoutubePlaybackPaused', 'youtubePauseIsIntentional',
    'youtubeShouldResume', 'resumeYoutubeFromBackground', 'noteUnexpectedYoutubePause',
    'onYoutubeVisibilityChange', 'youtubeReachedEnd', 'readYoutubeVideoId', 'radioDebug'
];
const code = ast.statements.filter(function (node) {
    return ts.isFunctionDeclaration(node) && names.indexOf(node.name.text) !== -1;
}).map(function (node) { return node.getText(ast); }).join('\n');

function FakePlayer() {
    this.volume = 100;
    this.muted = false;
    this.log = [];
}
FakePlayer.prototype.mute = function () { this.muted = true; this.log.push('mute'); };
FakePlayer.prototype.unMute = function () { this.muted = false; this.log.push('unmute'); };
FakePlayer.prototype.setVolume = function (value) { this.volume = value; this.log.push('set:' + value); };
FakePlayer.prototype.getVolume = function () { return this.volume; };
FakePlayer.prototype.isMuted = function () { return this.muted; };
FakePlayer.prototype.loadVideoById = function (id) {
    this.volume = 100;
    this.muted = false;
    this.log.push('load:' + (typeof id === 'string' ? id : id.videoId));
};
FakePlayer.prototype.playVideo = function () { this.log.push('play'); };

function run(saved, player) {
    const timers = [];
    const context = vm.createContext({
        console: { error() {}, log() {} },
        getSavedVolume: function () { return saved; },
        youtubePlayer: player,
        youtubeVolumeTimers: [],
        youtubeResumeTimer: null,
        youtubeWantedPlaying: false,
        youtubePauseIntent: null,
        youtubeResumeCount: 0,
        isYoutubeMode: true,
        setTimeout: function (fn, ms) { timers.push(ms); return timers.length; },
        clearTimeout: function () {},
        updatePlayPauseButton: function () {},
        YT: { PlayerState: { UNSTARTED: -1, ENDED: 0, PLAYING: 1, BUFFERING: 3, CUED: 5 } },
        wasFullscreen: false,
        playlist: [{ id: 'nextvideo01' }],
        currentVideoIndex: 0,
        playYoutubeIndex: function () {},
        document: {}
    });
    vm.runInContext(code, context);
    return { context: context, timers: timers, player: player };
}

test('換歌時先靜音，載入重設成 100 後會立刻設回儲存音量再出聲', () => {
    const player = new FakePlayer();
    const env = run(0.4, player);
    env.context.loadYoutubeVideoNow(player, 'abcdefghijk');
    const loadAt = player.log.indexOf('load:abcdefghijk');
    assert.ok(loadAt > 0);
    assert.equal(player.log[loadAt - 1], 'set:40');
    assert.equal(player.log[0], 'mute');
    assert.ok(player.log.indexOf('play') > loadAt);
    assert.equal(player.log[loadAt + 1], 'set:40');
    assert.equal(player.volume, 40);
    assert.equal(player.muted, false);
    assert.deepEqual(env.timers, [0, 250, 750, 1500]);
});

test('儲存音量為 0 時換歌保持靜音', () => {
    const player = new FakePlayer();
    const env = run(0, player);
    env.context.loadYoutubeVideoNow(player, 'abcdefghijk');
    assert.equal(player.volume, 0);
    assert.equal(player.muted, true);
    assert.equal(player.log.indexOf('unmute'), -1);
});

test('開始播放時立刻對齊音量，不必等 1500 毫秒', () => {
    const player = new FakePlayer();
    player.volume = 100;
    player.muted = false;
    const env = run(0.4, player);
    env.context.onPlayerStateChange({ data: 1 });
    assert.equal(player.volume, 40);
    assert.equal(player.muted, false);
    assert.equal(env.timers[0], 0);
});
