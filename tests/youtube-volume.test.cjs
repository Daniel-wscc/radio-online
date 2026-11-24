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
    'onYoutubeVisibilityChange', 'youtubeReachedEnd', 'readYoutubeVideoId', 'radioDebug',
    'youtubeVolumeIsHeld', 'youtubeTargetVolume', 'youtubeVideoMatchesTarget', 'logYoutubeVolume',
    'applyYoutubeVolumeMuted', 'youtubeVolumeMatches', 'releaseYoutubeVolumeHold',
    'tickYoutubeVolumeHold', 'beginYoutubeVolumeHold', 'noteYoutubeVolumeState',
    'advanceYoutubeFromEnd', 'cancelYoutubeResume', 'clearBackgroundKeeper'
];
const code = ast.statements.filter(function (node) {
    return ts.isFunctionDeclaration(node) && names.indexOf(node.name.text) !== -1;
}).map(function (node) { return node.getText(ast); }).join('\n');

function FakePlayer() {
    this.volume = 100;
    this.muted = false;
    this.state = -1;
    this.videoId = null;
    this.log = [];
}
FakePlayer.prototype.mute = function () { this.muted = true; this.log.push('mute'); };
FakePlayer.prototype.unMute = function () { this.muted = false; this.log.push('unmute'); };
FakePlayer.prototype.setVolume = function (value) { this.volume = value; this.log.push('set:' + value); };
FakePlayer.prototype.getVolume = function () { return this.volume; };
FakePlayer.prototype.isMuted = function () { return this.muted; };
FakePlayer.prototype.getPlayerState = function () { return this.state; };
FakePlayer.prototype.getVideoData = function () { return this.videoId ? { video_id: this.videoId } : {}; };
FakePlayer.prototype.loadVideoById = function (id) {
    this.volume = 100;
    this.muted = false;
    this.log.push('load:' + (typeof id === 'string' ? id : id.videoId));
};
FakePlayer.prototype.playVideo = function () { this.log.push('play'); };

function run(saved, player) {
    const timers = [];
    const timerFns = [];
    const context = vm.createContext({
        console: { error() {}, log() {} },
        getSavedVolume: function () { return saved; },
        youtubePlayer: player,
        youtubeVolumeTimers: [],
        youtubeResumeTimer: null,
        youtubeResumeEpoch: 0,
        youtubeBackgroundTimer: null,
        youtubeBlockEnded: false,
        YOUTUBE_RESUME_MAX: 4,
        youtubeWantedPlaying: false,
        youtubePauseIntent: null,
        youtubeResumeCount: 0,
        isYoutubeMode: true,
        Date: Date,
        setTimeout: function (fn, ms) { timers.push(ms); timerFns.push(fn); return timers.length; },
        clearTimeout: function () {},
        clearInterval: function () {},
        updatePlayPauseButton: function () {},
        YT: { PlayerState: { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 } },
        wasFullscreen: false,
        playlist: [{ id: 'aaaaaaaaaaa' }, { id: 'bbbbbbbbbbb' }],
        currentVideoIndex: 0,
        playYoutubeIndex: function (index) {
            context.currentVideoIndex = index;
            context.loadYoutubeVideoNow(player, context.playlist[index].id);
        },
        document: {}
    });
    vm.runInContext(code, context);
    return { context: context, timers: timers, timerFns: timerFns, player: player };
}

test('換歌先排隊且保持靜音，音量確認後才播放，開始播放後連續確認才開聲', () => {
    const player = new FakePlayer();
    player.cueVideoById = function (id) {
        this.volume = 100;
        this.muted = false;
        this.log.push('cue:' + id);
    };
    const env = run(0.4, player);
    env.context.loadYoutubeVideoNow(player, 'abcdefghijk');
    assert.equal(player.log[0], 'mute');
    assert.ok(player.log.indexOf('cue:abcdefghijk') > 0);
    assert.equal(player.log.indexOf('play'), -1);
    assert.equal(player.log.indexOf('unmute'), -1);
    assert.equal(player.muted, true);
    env.context.tickYoutubeVolumeHold();
    assert.ok(player.log.indexOf('play') > player.log.indexOf('cue:abcdefghijk'));
    assert.equal(player.muted, true);
    env.context.onPlayerStateChange({ data: 1 });
    env.context.tickYoutubeVolumeHold();
    assert.equal(player.muted, true);
    env.context.tickYoutubeVolumeHold();
    assert.equal(player.volume, 40);
    assert.equal(player.muted, false);
});

test('同一首在靜音確認期間不會被再載入一次', () => {
    const player = new FakePlayer();
    var cues = 0;
    player.cueVideoById = function (id) {
        cues += 1;
        this.volume = 100;
        this.muted = false;
        this.log.push('cue:' + id);
    };
    const env = run(0.4, player);
    env.context.loadYoutubeVideoNow(player, 'abcdefghijk');
    env.context.loadYoutubeVideoNow(player, 'abcdefghijk');
    assert.equal(cues, 1);
    assert.equal(player.muted, true);
    assert.equal(player.log.indexOf('unmute'), -1);
});

test('YouTube 仍回報 100 時不開聲，音量跟上後連續確認才開聲', () => {
    const player = new FakePlayer();
    player.blockVolume = true;
    player.setVolume = function (value) {
        this.log.push('set:' + value);
        if (this.blockVolume) return;
        this.volume = value;
    };
    const env = run(0.4, player);
    env.context.loadYoutubeVideoNow(player, 'abcdefghijk');
    player.volume = 100;
    player.muted = false;
    env.context.onPlayerStateChange({ data: 1 });
    env.context.tickYoutubeVolumeHold();
    assert.equal(player.muted, true);
    assert.equal(player.log.indexOf('unmute'), -1);
    player.blockVolume = false;
    env.context.tickYoutubeVolumeHold();
    assert.equal(player.muted, true);
    env.context.tickYoutubeVolumeHold();
    assert.equal(player.volume, 40);
    assert.equal(player.muted, false);
    assert.match(fs.readFileSync('radio-online-vanillaJS/app.js', 'utf8'), /'mute':\s*1/);
});

test('儲存音量為 0 時換歌保持靜音，開始播放前後都不開聲', () => {
    const player = new FakePlayer();
    player.cueVideoById = function (id) {
        this.volume = 100;
        this.muted = false;
        this.videoId = id;
        this.state = 5;
        this.log.push('cue:' + id);
    };
    const env = run(0, player);
    env.context.loadYoutubeVideoNow(player, 'bbbbbbbbbbb');
    assert.equal(player.volume, 0);
    assert.equal(player.muted, true);
    env.context.onPlayerStateChange({ data: 5 });
    env.context.tickYoutubeVolumeHold();
    player.state = 1;
    env.context.onPlayerStateChange({ data: 1 });
    env.context.tickYoutubeVolumeHold();
    env.context.tickYoutubeVolumeHold();
    assert.equal(player.volume, 0);
    assert.equal(player.muted, true);
    assert.equal(player.log.indexOf('unmute'), -1);
});

test('自動換歌在目標音量 0、20、50 時，舊片殘留 PLAYING 不會提前開聲，新片播放且音量對齊才放行', () => {
    [0, 20, 50].forEach(function (targetPct) {
        const player = new FakePlayer();
        player.videoId = 'aaaaaaaaaaa';
        player.volume = targetPct;
        player.muted = targetPct === 0;
        player.state = 1;
        player.cueVideoById = function (id) {
            this.log.push('cue:' + id);
        };
        const env = run(targetPct / 100, player);

        // 片尾自動換下一首（A -> B）
        env.context.advanceYoutubeFromEnd();
        assert.equal(env.context.currentVideoIndex, 1);
        assert.ok(player.log.indexOf('cue:bbbbbbbbbbb') > 0);
        assert.equal(player.muted, true);

        // 舊片 A 還沒切走、又冒出殘留 PLAYING：不能呼叫 playVideo，也不能提前 unMute
        env.context.onPlayerStateChange({ data: 1 });
        env.context.tickYoutubeVolumeHold();
        env.context.tickYoutubeVolumeHold();
        assert.equal(player.log.indexOf('play'), -1);
        assert.equal(player.log.indexOf('unmute'), -1);
        assert.equal(player.muted, true);

        // 新片 B 完成排隊（iframe 重設為 100 未靜音）
        player.videoId = 'bbbbbbbbbbb';
        player.volume = 100;
        player.muted = false;
        player.state = 5;
        env.context.onPlayerStateChange({ data: 5 });
        assert.equal(player.muted, true);
        assert.equal(player.volume, targetPct);

        // 確認音量後靜音開播
        env.context.tickYoutubeVolumeHold();
        assert.ok(player.log.indexOf('play') > player.log.indexOf('cue:bbbbbbbbbbb'));
        assert.equal(player.muted, true);
        assert.equal(player.log.indexOf('unmute'), -1);

        // 新片 B 進入 BUFFERING / PLAYING，第一下先保持靜音確認，第二下才放行
        player.state = 3;
        env.context.onPlayerStateChange({ data: 3 });
        assert.equal(player.muted, true);
        player.state = 1;
        env.context.onPlayerStateChange({ data: 1 });
        env.context.tickYoutubeVolumeHold();
        assert.equal(player.muted, true);
        env.context.tickYoutubeVolumeHold();

        assert.equal(player.volume, targetPct);
        if (targetPct === 0) {
            assert.equal(player.muted, true);
            assert.equal(player.log.indexOf('unmute'), -1);
        } else {
            assert.equal(player.muted, false);
            assert.ok(player.log.indexOf('unmute') > player.log.indexOf('play'));
        }
    });
});

test('開始播放時立刻對齊音量，且後續強制檢查不會因快取略過 setVolume', () => {
    const player = new FakePlayer();
    player.volume = 40;
    player.muted = false;
    const env = run(0.4, player);
    env.context.onPlayerStateChange({ data: 1 });
    assert.equal(player.volume, 40);
    assert.equal(player.muted, false);
    assert.equal(env.timers[0], 0);
    const setsBefore = player.log.filter(function (entry) { return entry === 'set:40'; }).length;
    assert.ok(setsBefore >= 1);
    env.timerFns[0]();
    const setsAfter = player.log.filter(function (entry) { return entry === 'set:40'; }).length;
    assert.ok(setsAfter > setsBefore);
});
