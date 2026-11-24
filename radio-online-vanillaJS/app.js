// 全域變數
var customStations = [
    {
        name: '飛碟電台 FM92.1 UFO Radio Live Stream',
        url: 'https://stream.rcs.revma.com/em90w4aeewzuv',
        tags: ['local'],
        id: 'custom_1'
    },
    {
        name: '飛揚調頻 FM89.5 Live Stream',
        url: 'https://stream.rcs.revma.com/e0tdah74hv8uv',
        tags: ['music'],
        id: 'custom_2'
    },
    {
        name: '中廣流行網 I like radio FM103.3 Live Stream',
        url: 'https://stream.rcs.revma.com/aw9uqyxy2tzuv',
        tags: ['music'],
        id: 'custom_3'
    },
    {
        name: '亞洲電台 FM92.7 Live Stream',
        url: 'https://stream.rcs.revma.com/xpgtqc74hv8uv',
        tags: ['music'],
        id: 'custom_4'
    },
    {
        name: 'Hit FM台北之音廣播',
        url: String(window.RADIO_SOCKET_URL || 'https://radio.wscc1031.synology.me').replace(/\/$/, '') + '/stream/hitfm.m3u8',
        tags: ['music'],
        id: 'custom_5'
    },
    {
        name: 'BigBRadio Kpop Channel',
        url: 'https://antares.dribbcast.com/proxy/kpop?mp=/s',
        tags: ['music'],
        id: 'custom_6'
    },
    {
        name: 'BigBRadio Jpop Channel',
        url: 'https://antares.dribbcast.com/proxy/jpop?mp=/s',
        tags: ['music'],
        id: 'custom_7'
    },
    {
        name: 'BigBRadio Cpop Channel',
        url: 'https://antares.dribbcast.com/proxy/cpop?mp=/s',
        tags: ['music'],
        id: 'custom_8'
    },
    {
        name: 'BigBRadio Apop Channel',
        url: 'https://antares.dribbcast.com/proxy/apop?mp=/s',
        tags: ['music'],
        id: 'custom_9'
    }
];

var currentStation = null;
var isYoutubeMode = false;
var youtubePlayer = null;
var playlist = [];
var currentVideoIndex = -1;
var youtubeApiState = 'idle';
var youtubeApiAttempt = 0;
var youtubeApiLoadTimer = null;
var youtubeApiRetryTimer = null;
var youtubePlayerInitializing = false;
var youtubePlayerReady = false;
var youtubePlayerReadyTimer = null;
var youtubeApiMaxAttempts = 3;
var youtubeApiUrl = 'https://www.youtube.com/iframe_api';
var socket = io(window.RADIO_SOCKET_URL || 'https://radio.wscc1031.synology.me');
var isDarkMode = false;
var isMuted = false;
var volumeBeforeMute = 1;
var darkThemeNames = ['dark', 'synthwave', 'forest', 'coffee', 'dracula'];
// 本地重排/同步期間，短暫忽略遠端索引更新
var suppressIndexUpdatesUntil = 0;

var radioStreamPlayer = null;
var radioPlaybackPhase = 'idle';
var stationStatus = window.StationStatus ? window.StationStatus.create() : null;

function paintStationLoadMarks() {
    if (!stationStatus || !document.querySelectorAll) return;
    var view = stationStatus.view();
    var items = document.querySelectorAll('.station-item[data-station-id]');
    var i;
    for (i = 0; i < items.length; i++) {
        var id = items[i].getAttribute('data-station-id');
        var slot = items[i].querySelector('[data-station-state]');
        if (!slot) continue;
        var html = '';
        if (view.loadingId === id) html += '<span class="station-spinner" aria-hidden="true"></span>';
        if (view.failed[id]) html += '<span class="station-fail">無法播放</span>';
        if (slot.innerHTML !== html) slot.innerHTML = html;
    }
}

function startRadioTransition(station) {
    if (!radioStreamPlayer) {
        radioStreamPlayer = new window.RadioStreamPlayer({
            host: document.getElementById('playerContainer'),
            Hls: window.Hls,
            onState: function (state) {
                radioPlaybackPhase = state.phase;
                if (state.audio) audioPlayer = state.audio;
                if (stationStatus && state.targetId) {
                    stationStatus.apply({ phase: state.phase, stationId: state.targetId });
                    paintStationLoadMarks();
                }
                var status = document.getElementById('radioLoadStatus');
                var retry = document.getElementById('radioRetryButton');
                var message = '';
                if (state.phase === 'loading') message = '載入中…';
                else if (state.phase === 'retrying') message = '無法播放';
                else if (state.phase === 'blocked') message = '此裝置尚未允許播放，請按「重試播放」。';
                if (status) {
                    status.textContent = message;
                    status.hidden = !message;
                    if (state.phase === 'retrying') status.className = 'status-line is-error';
                    else status.className = 'status-line';
                }
                if (retry) retry.hidden = state.phase !== 'blocked';
            }
        });
    }
    // 先套用遠端或本機音量，再開始載入新電台，避免重新整理時新串流以 100% 起播。
    radioStreamPlayer.setVolume(getSavedVolume());
    radioStreamPlayer.select(station);
}

function stopRadioPlayback() {
    if (radioStreamPlayer) radioStreamPlayer.stop();
}

function retryRadioPlayback() {
    if (!isYoutubeMode && radioStreamPlayer) radioStreamPlayer.retry();
}

window.addEventListener('pagehide', function () {
    if (radioStreamPlayer) {
        radioStreamPlayer.destroy();
        radioStreamPlayer = null;
    }
});
window.addEventListener('pageshow', function (event) {
    if (event.persisted && !isYoutubeMode && currentStation) startRadioTransition(currentStation);
});

function capturePlaybackSnapshot() {
    try {
        var seconds = youtubePlayer && typeof youtubePlayer.getCurrentTime === 'function' ? youtubePlayer.getCurrentTime() : 0;
        var state = youtubePlayer && typeof youtubePlayer.getPlayerState === 'function' ? youtubePlayer.getPlayerState() : -1;
        return {
            videoId: currentVideoIndex >= 0 ? (playlist[currentVideoIndex] && playlist[currentVideoIndex].id) : null,
            seconds: typeof seconds === 'number' ? seconds : 0,
            wasPlaying: state === YT.PlayerState.PLAYING
        };
    } catch (e) {
        return { videoId: currentVideoIndex >= 0 ? (playlist[currentVideoIndex] && playlist[currentVideoIndex].id) : null, seconds: 0, wasPlaying: false };
    }
}

function restorePlaybackSnapshot(snapshot) {
    if (!snapshot || !snapshot.videoId) return;
    var currentId = currentVideoIndex >= 0 ? (playlist[currentVideoIndex] && playlist[currentVideoIndex].id) : null;
    if (currentId !== snapshot.videoId) return;
    if (!youtubePlayer) return;
    try {
        if (typeof youtubePlayer.seekTo === 'function') {
            youtubePlayer.seekTo(Math.max(0, snapshot.seconds), true);
        }
        if (snapshot.wasPlaying && typeof youtubePlayer.playVideo === 'function') {
            youtubePlayer.playVideo();
        }
    } catch (e) { }
}

// 添加全域變數追蹤全螢幕狀態
var wasFullscreen = false;

// 共用：確保 YouTube 播放器音量與滑桿一致
var playerExpanded = false;

function placeNode(nodeId, hostId) {
    var node = document.getElementById(nodeId);
    var host = document.getElementById(hostId);
    if (!node || !host || node.parentNode === host) return;
    host.appendChild(node);
}

function updateMiniTitle() {
    var text = '請添加影片到播放清單';
    if (playlist.length && currentVideoIndex >= 0 && playlist[currentVideoIndex]) {
        text = playlist[currentVideoIndex].title || playlist[currentVideoIndex].id;
    } else if (playlist.length) {
        text = '請選擇要播放的影片';
    }
    var mini = document.getElementById('miniPlayerTitle');
    var expanded = document.getElementById('expandedVideoTitle');
    if (mini) mini.textContent = text;
    if (expanded) expanded.textContent = text;
}

function ensureYoutubeFrameHost() {
    var frame = document.getElementById('ytFrame');
    var section = document.getElementById('youtubeSection');
    if (!frame || !section || frame.parentNode === section) return;
    section.appendChild(frame);
}

function layoutYoutubeFrame() {
    var frame = document.getElementById('ytFrame');
    if (!frame) return;
    ensureYoutubeFrameHost();
    if (!isYoutubeMode) {
        frame.style.display = 'none';
        return;
    }
    var anchor = document.getElementById('ytStage');
    if (playerExpanded && playlist.length) anchor = document.getElementById('videoTarget');
    else if (playlist.length) anchor = document.getElementById('miniThumbSlot');
    if (!anchor || typeof anchor.getBoundingClientRect !== 'function') return;
    var rect = anchor.getBoundingClientRect();
    if (!(rect.width > 0) || !(rect.height > 0)) return;
    frame.style.display = 'block';
    frame.style.position = 'fixed';
    frame.style.margin = '0';
    frame.style.left = rect.left + 'px';
    frame.style.top = rect.top + 'px';
    frame.style.width = Math.round(rect.width) + 'px';
    frame.style.height = Math.round(rect.height) + 'px';
    frame.style.zIndex = playerExpanded ? '41' : '32';
    frame.style.overflow = 'hidden';
    if (youtubePlayer && typeof youtubePlayer.setSize === 'function') {
        try {
            youtubePlayer.setSize(Math.round(rect.width), Math.round(rect.height));
        } catch (error) {
            console.log('調整 YouTube 尺寸失敗:', error);
        }
    }
    radioDebug('layout', { w: Math.round(rect.width), h: Math.round(rect.height), expanded: !!playerExpanded });
}

function syncYoutubeChrome() {
    if (!isYoutubeMode || playlist.length === 0) playerExpanded = false;
    var expanded = playerExpanded && isYoutubeMode;
    var section = document.getElementById('youtubeSection');
    var bar = document.getElementById('playerBar');
    var stage = document.getElementById('radioStage');
    if (section) {
        section.classList.toggle('has-queue', isYoutubeMode && playlist.length > 0);
        section.classList.toggle('is-expanded', expanded);
    }
    if (bar) bar.hidden = !(isYoutubeMode && playlist.length > 0) || expanded;
    if (stage) stage.style.display = isYoutubeMode ? 'none' : '';
    placeNode('playbackControls', expanded ? 'expandedControlsHost' : 'miniControlsHost');
    placeNode('playlistContainer', expanded ? 'expandedQueueHost' : 'queueHost');
    layoutYoutubeFrame();
    updateMiniTitle();
}

function setPlayerExpanded(open) {
    playerExpanded = !!open && isYoutubeMode && playlist.length > 0;
    syncYoutubeChrome();
}

function placeVolumeControl() {
    var control = document.getElementById('volumeControl');
    var host = document.getElementById(isYoutubeMode ? 'youtubeVolumeHost' : 'radioVolumeHost');
    if (control && host && control.parentNode !== host) host.appendChild(control);
    if (typeof syncYoutubeChrome === 'function') syncYoutubeChrome();
}

function escapeHtml(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function currentUserName() {
    try {
        return localStorage.getItem('userName') || '訪客';
    } catch (error) {
        return '訪客';
    }
}

function announcePlayback(text) {
    if (window.isTv || !window.PcChat || typeof window.PcChat.system !== 'function') return;
    window.PcChat.system(text);
}

function isDarkThemeName(name) {
    var i;
    for (i = 0; i < darkThemeNames.length; i++) {
        if (darkThemeNames[i] === name) return true;
    }
    return false;
}

function syncYoutubeVolume() {
    try {
        var currentVolume = getSavedVolume();
        var wanted = Math.round(currentVolume * 100);
        if (!youtubePlayer || typeof youtubePlayer.setVolume !== 'function') return;
        var actual = typeof youtubePlayer.getVolume === 'function' ? youtubePlayer.getVolume() : null;
        var muted = typeof youtubePlayer.isMuted === 'function' ? !!youtubePlayer.isMuted() : null;
        var volumeOk = actual === null || actual === wanted;
        var muteOk = currentVolume === 0 ? (muted === null || muted === true) : (muted === null || muted === false);
        if (actual !== null && volumeOk && muteOk) return;
        youtubePlayer.setVolume(wanted);
        if (currentVolume === 0) {
            if (typeof youtubePlayer.mute === 'function') youtubePlayer.mute();
        } else if (typeof youtubePlayer.unMute === 'function') {
            youtubePlayer.unMute();
        }
    } catch (error) {
        console.error('同步音量失敗:', error);
    }
}

var youtubeVolumeTimers = [];
var youtubeWantedPlaying = false;
var youtubePauseIntent = null;
var youtubeResumeCount = 0;
var youtubeResumeTimer = null;
var youtubeResumeEpoch = 0;
var youtubeBlockEnded = false;
var YOUTUBE_RESUME_MAX = 4;
var YOUTUBE_RESUME_MS = 1000;

function armYoutubeVolumeChecks() {
    var delays = [0, 250, 750, 1500];
    var i;
    for (i = 0; i < youtubeVolumeTimers.length; i++) clearTimeout(youtubeVolumeTimers[i]);
    youtubeVolumeTimers = [];
    for (i = 0; i < delays.length; i++) {
        youtubeVolumeTimers.push(setTimeout(syncYoutubeVolume, delays[i]));
    }
}

function markYoutubePlaybackWanted() {
    youtubeWantedPlaying = true;
    youtubePauseIntent = null;
    youtubeResumeCount = 0;
    if (youtubeResumeTimer) {
        clearTimeout(youtubeResumeTimer);
        youtubeResumeTimer = null;
    }
}

function markYoutubePlaybackPaused(reason) {
    youtubeWantedPlaying = false;
    youtubePauseIntent = reason || 'user';
    youtubeResumeCount = 0;
    if (youtubeResumeTimer) {
        clearTimeout(youtubeResumeTimer);
        youtubeResumeTimer = null;
    }
}

function youtubePauseIsIntentional() {
    return youtubePauseIntent === 'user' || youtubePauseIntent === 'sync';
}

function youtubeShouldResume() {
    if (youtubePauseIsIntentional()) return false;
    if (!youtubeWantedPlaying) return false;
    if (!isYoutubeMode) return false;
    if (!playlist || !playlist.length || currentVideoIndex < 0) return false;
    return true;
}

function youtubeReachedEnd() {
    if (!youtubePlayer) return false;
    try {
        var duration = typeof youtubePlayer.getDuration === 'function' ? youtubePlayer.getDuration() : 0;
        var current = typeof youtubePlayer.getCurrentTime === 'function' ? youtubePlayer.getCurrentTime() : 0;
        if (typeof duration !== 'number' || typeof current !== 'number') return false;
        if (!(duration > 1) || isNaN(duration) || isNaN(current)) return false;
        return current >= duration - 0.75;
    } catch (error) {
        return false;
    }
}

function readYoutubeVideoId() {
    if (!youtubePlayer || typeof youtubePlayer.getVideoData !== 'function') return null;
    try {
        var data = youtubePlayer.getVideoData();
        return data && data.video_id ? data.video_id : null;
    } catch (error) {
        return null;
    }
}

function cancelYoutubeResume() {
    youtubeResumeEpoch += 1;
    youtubeResumeCount = YOUTUBE_RESUME_MAX;
    if (youtubeResumeTimer) {
        clearTimeout(youtubeResumeTimer);
        youtubeResumeTimer = null;
    }
}

function resumeYoutubeFromBackground() {
    if (!youtubeShouldResume()) return;
    if (youtubeReachedEnd()) return;
    if (!youtubePlayer || typeof youtubePlayer.playVideo !== 'function') return;
    var player = youtubePlayer;
    var wanted = Math.round(getSavedVolume() * 100);
    if (typeof player.setVolume === 'function') player.setVolume(wanted);
    syncYoutubeVolume();
    player.playVideo();
    if (typeof player.setVolume === 'function') player.setVolume(wanted);
    if (wanted === 0) {
        if (typeof player.mute === 'function') player.mute();
    } else if (typeof player.unMute === 'function') {
        player.unMute();
    }
    syncYoutubeVolume();
    armYoutubeVolumeChecks();
}

function noteUnexpectedYoutubePause() {
    if (youtubeReachedEnd()) {
        cancelYoutubeResume();
        advanceYoutubeFromEnd();
        return;
    }
    if (!youtubeShouldResume()) return;
    if (youtubeResumeCount >= YOUTUBE_RESUME_MAX) return;
    youtubeResumeCount += 1;
    if (youtubeResumeCount === 1) {
        resumeYoutubeFromBackground();
        ensureBackgroundKeeper();
        return;
    }
    if (youtubeResumeTimer) return;
    var epoch = youtubeResumeEpoch;
    youtubeResumeTimer = setTimeout(function () {
        youtubeResumeTimer = null;
        if (epoch !== youtubeResumeEpoch) return;
        resumeYoutubeFromBackground();
    }, YOUTUBE_RESUME_MS);
}

function onYoutubeVisibilityChange() {
    radioDebug('visibility', { hidden: typeof document !== 'undefined' && !!document.hidden });
    if (typeof document !== 'undefined' && document.hidden) {
        ensureBackgroundKeeper();
        return;
    }
    clearBackgroundKeeper();
    if (youtubeReachedEnd()) {
        advanceYoutubeFromEnd();
        return;
    }
    if (!youtubeShouldResume()) return;
    youtubeResumeCount = 0;
    resumeYoutubeFromBackground();
}

var youtubeBackgroundTimer = null;

function clearBackgroundKeeper() {
    if (!youtubeBackgroundTimer) return;
    clearInterval(youtubeBackgroundTimer);
    youtubeBackgroundTimer = null;
}

function ensureBackgroundKeeper() {
    if (typeof setInterval !== 'function') return;
    if (typeof document === 'undefined' || !document.hidden) return;
    if (youtubePauseIsIntentional() || !youtubeWantedPlaying) return;
    if (youtubeBackgroundTimer) return;
    youtubeBackgroundTimer = setInterval(function () {
        if (typeof document === 'undefined' || !document.hidden || youtubePauseIsIntentional() || !youtubeWantedPlaying) {
            clearBackgroundKeeper();
            return;
        }
        if (youtubeReachedEnd()) {
            clearBackgroundKeeper();
            advanceYoutubeFromEnd();
            return;
        }
        youtubeResumeCount = 0;
        resumeYoutubeFromBackground();
    }, 1000);
}

function advanceYoutubeFromEnd() {
    cancelYoutubeResume();
    clearBackgroundKeeper();
    if (youtubeBlockEnded) return;
    if (!playlist || !playlist.length || currentVideoIndex < 0) return;
    var endedId = readYoutubeVideoId();
    var currentItem = playlist[currentVideoIndex];
    var currentId = currentItem ? currentItem.id : null;
    if (endedId && currentId && endedId !== currentId) {
        radioDebug('end-skip', { endedId: endedId, currentId: currentId, index: currentVideoIndex });
        return;
    }
    var nextIndex = currentVideoIndex < playlist.length - 1 ? currentVideoIndex + 1 : 0;
    youtubeBlockEnded = true;
    radioDebug('end-next', { from: currentVideoIndex, to: nextIndex, endedId: endedId });
    playYoutubeIndex(nextIndex, { fromEnd: true });
}

function checkYoutubeEnd() {
    if (youtubePauseIsIntentional() || !youtubeWantedPlaying) return;
    if (youtubeBlockEnded) {
        var current = 0;
        try {
            current = youtubePlayer && typeof youtubePlayer.getCurrentTime === 'function' ? youtubePlayer.getCurrentTime() : 0;
        } catch (error) {
            current = 0;
        }
        if (typeof current === 'number' && current > 0.2 && current < 1.5) youtubeBlockEnded = false;
        return;
    }
    if (youtubeReachedEnd()) advanceYoutubeFromEnd();
}

var radioDebugEntries = [];

function radioDebug(event, detail) {
    var enabled = false;
    try { enabled = !!window.__radioDebug; } catch (error) { enabled = false; }
    if (!enabled) return;
    var row = { t: new Date().toISOString(), event: event, detail: detail || null };
    radioDebugEntries.push(row);
    if (radioDebugEntries.length > 200) radioDebugEntries.shift();
    try { console.log('[radio]', event, detail || ''); } catch (error) {}
}

function enableRadioDebug() {
    var search = '';
    try {
        search = window.location && window.location.search ? window.location.search : '';
    } catch (error) {
        search = '';
    }
    try { window.__radioDebug = /(^|[?&])debug=1(&|$)/.test(search); } catch (error) {}
    try {
        window.radioDebugLog = function () {
            var copy = [];
            var i;
            for (i = 0; i < radioDebugEntries.length; i++) copy.push(radioDebugEntries[i]);
            return copy;
        };
    } catch (error) {}
}

function loadYoutubeVideoNow(player, videoId) {
    if (!player || typeof player.loadVideoById !== 'function' || !videoId) return;
    markYoutubePlaybackWanted();
    var wanted = Math.round(getSavedVolume() * 100);
    if (typeof player.mute === 'function') player.mute();
    if (typeof player.setVolume === 'function') player.setVolume(wanted);
    player.loadVideoById(videoId);
    if (typeof player.setVolume === 'function') player.setVolume(wanted);
    if (typeof player.playVideo === 'function') player.playVideo();
    if (typeof player.setVolume === 'function') player.setVolume(wanted);
    if (wanted === 0) {
        if (typeof player.mute === 'function') player.mute();
    } else if (typeof player.unMute === 'function') {
        player.unMute();
    }
    syncYoutubeVolume();
    armYoutubeVolumeChecks();
}

// DOM 元素
var audioPlayer = document.getElementById('audioPlayer');
var volumeSlider = document.getElementById('volumeSlider');
var currentStationName = document.getElementById('currentStationName');
var stationList = document.getElementById('stationList');
var youtubeSection = document.getElementById('youtubeSection');

// YouTube 相關變數
var youtubeUrlInput = document.getElementById('youtubeUrlInput');
var addToPlaylistBtn = document.getElementById('addToPlaylist');
var clearPlaylistBtn = document.getElementById('clearPlaylist');
var playlistContainer = document.getElementById('playlistContainer');

// 添加新的 DOM 元素引用
var controlCard = document.getElementById('controlCard');

// 新增全域變數
var prevButton = document.getElementById('prevButton');
var nextButton = document.getElementById('nextButton');
var savedVolume = normalizeVolume(volumeSlider ? parseFloat(volumeSlider.value) / 10 : 1);
var volumeSyncLockUntil = 0;
var volumeDragging = false;
var deferredServerVolume = null;
var appliedRevision = -1;
var syncSession = window.RadioSyncClient && typeof RadioSyncClient.createSession === 'function'
    ? RadioSyncClient.createSession()
    : { clientId: 'local', opId: 0, volumeOpId: 0, stationOpId: 0 };
var volumeSendTimer = null;
var volumeLastSentAt = 0;
var volumeSettleUntil = 0;
var VOLUME_THROTTLE_MS = 150;
var VOLUME_SETTLE_MS = 800;

function getPlaylistVideoId(items, index) {
    return items && index >= 0 && items[index] ? items[index].id : null;
}

function normalizeVolume(value) {
    var rounded = null;
    if (window.RadioSyncClient && typeof RadioSyncClient.roundVolume === 'function') {
        rounded = RadioSyncClient.roundVolume(value);
    } else {
        value = parseFloat(value);
        if (!isNaN(value)) {
            if (value < 0) value = 0;
            if (value > 1) value = 1;
            rounded = Math.round(value * 100) / 100;
        }
    }
    if (typeof rounded !== 'number' || isNaN(rounded)) {
        return typeof savedVolume === 'number' && !isNaN(savedVolume) ? savedVolume : 1;
    }
    return rounded;
}

function getSavedVolume() {
    return normalizeVolume(savedVolume);
}

function rememberVolume(value) {
    savedVolume = normalizeVolume(value === undefined ? (volumeSlider ? volumeSlider.value / 10 : savedVolume) : value);
    if (volumeSlider) {
        volumeSlider.value = savedVolume * 10;
        volumeSlider.style.setProperty('--value', (savedVolume * 100) + '%');
    }
    return savedVolume;
}

function applyAudioVolume(volume) {
    volume = normalizeVolume(volume);
    if (!audioPlayer) return;
    audioPlayer.volume = volume;
    audioPlayer.muted = volume === 0;
    if (radioStreamPlayer) radioStreamPlayer.setVolume(volume);
}

function preserveVolumeForSourceSwitch() {
    var volume = rememberVolume();
    // 切台當下先保住本機音量。有版號的伺服器狀態仍會在拖曳結束或保護期結束後套用，不會永遠丟掉。
    volumeSyncLockUntil = Date.now() + 2000;
    setTimeout(flushDeferredVolume, 2100);
    return volume;
}

function volumeHolding() {
    return !!volumeDragging || Date.now() < volumeSettleUntil;
}

function flushDeferredVolume() {
    if (volumeHolding() || deferredServerVolume == null) return;
    var volume = deferredServerVolume;
    deferredServerVolume = null;
    rememberVolume(volume);
    if (isYoutubeMode) syncYoutubeVolume();
    else applyAudioVolume(volume);
    if (typeof updateMuteButton === 'function') updateMuteButton();
}

function markVolumeActivity() {
    volumeSettleUntil = Date.now() + VOLUME_SETTLE_MS;
}

function emitVolumeCommand() {
    volumeLastSentAt = Date.now();
    markVolumeActivity();
    if (!socket) return;
    var payload = { volume: getSavedVolume() };
    if (window.RadioSyncClient && typeof RadioSyncClient.issueOp === 'function') {
        var op = RadioSyncClient.issueOp(syncSession, 'volume');
        payload.clientId = op.clientId;
        payload.opId = op.opId;
    }
    socket.emit('setVolume', payload);
}

function scheduleVolumeSend() {
    markVolumeActivity();
    var elapsed = Date.now() - volumeLastSentAt;
    if (elapsed >= VOLUME_THROTTLE_MS) {
        if (volumeSendTimer) {
            clearTimeout(volumeSendTimer);
            volumeSendTimer = null;
        }
        emitVolumeCommand();
        return;
    }
    if (!volumeSendTimer) {
        volumeSendTimer = setTimeout(function () {
            volumeSendTimer = null;
            emitVolumeCommand();
        }, VOLUME_THROTTLE_MS - elapsed);
    }
}

function endVolumeDrag() {
    if (!volumeDragging) return;
    volumeDragging = false;
    if (volumeSendTimer) {
        clearTimeout(volumeSendTimer);
        volumeSendTimer = null;
    }
    emitVolumeCommand();
}

// 初始化
function init() {
    if (window.isTv) {
        var heading = document.getElementById('appHeading');
        var foot = document.getElementById('appTitle');
        if (heading) heading.textContent = '芯禾電台 TV';
        if (foot) foot.textContent = '芯禾電台 TV';
    }
    loadStations();
    setupEventListeners();
    setupYoutubeEventListeners();
    setupSocketListeners();
    setupTheme();
    placeVolumeControl();
    if (window.NowPlaying && typeof NowPlaying.init === 'function') NowPlaying.init(customStations);
    loadYouTubeAPI();
    enableRadioDebug();
    if (window.__radioDebug && socket && !socket.__radioDebugWrapped && typeof socket.emit === 'function') {
        socket.__radioDebugWrapped = true;
        var originalEmit = socket.emit.bind(socket);
        socket.emit = function (name, payload) {
            radioDebug('emit', { name: name });
            return originalEmit(name, payload);
        };
        if (typeof socket.onAny === 'function') {
            socket.onAny(function (name, payload) {
                if (name !== 'radioStateUpdate' && name !== 'radioCommandError') return;
                var yt = payload && payload.youtubeState;
                radioDebug('socket-state', {
                    name: name,
                    rev: payload && payload.revision,
                    index: yt && yt.currentIndex,
                    id: yt && yt.currentVideoId,
                    error: payload && payload.error
                });
            });
        }
    }

    setInterval(checkYoutubeEnd, 500);
    window.addEventListener('resize', layoutYoutubeFrame);
    window.addEventListener('scroll', layoutYoutubeFrame, true);

    // 請求當前狀態並設置初始播放
    socket.emit('requestCurrentState');

    // 監聯連接事件
    socket.on('connect', function () {
        socket.emit('requestCurrentState');
    });
}

// 載入電台列表
function loadStations() {
    var stationsHtml = '';
    customStations.forEach(function (station) {
        stationsHtml += createStationElement(station);
    });
    stationList.innerHTML = stationsHtml;
}

// 創建電台元素
function isBigBStation(station) {
    if (window.NowPlaying && typeof NowPlaying.isBigB === 'function') return NowPlaying.isBigB(station);
    return /antares\.dribbcast\.com\/proxy\/[A-Za-z]+/.test(station && station.url || '');
}

function createStationElement(station) {
    var nowPlaying = '';
    if (isBigBStation(station)) {
        nowPlaying = '<div class="now-playing-container" data-now-playing="' + station.id + '">' +
            '<span class="now-playing-label">現正播放：</span>' +
            '<div class="now-playing-text" data-text="">載入中...</div>' +
            '</div>';
    }
    return '<div class="station station-item" data-station-id="' + station.id + '">' +
        '<div class="station-head">' +
        '<strong class="station-name">' + escapeHtml(station.name) + '</strong>' +
        '<span class="station-state" data-station-state></span>' +
        '</div>' +
        '<div class="station-tags">' +
        createTagsHtml(station.tags) +
        '</div>' +
        nowPlaying +
        '</div>';
}

// 創建標籤 HTML
function createTagsHtml(tags) {
    if (!tags) return '';
    return tags.map(function (tag) {
        return '<span class="badge badge-' + getTagColor(tag) + '">' + tag + '</span>';
    }).join('');
}

// 設置事件監聽器
// 音量防抖變數
var volumeDebounceTimer = null;
var volumeDebounceDelay = 300; // 300ms 防抖延遲

function setupEventListeners() {
    // 音量控制
    volumeSlider.addEventListener('input', function (e) {
        var volume = rememberVolume(e.target.value / 10); // 改為 0-10 範圍，除以 10 得到 0-1
        volumeSyncLockUntil = Date.now() + 1000;

        // YouTube模式下使用YouTube API控制音量
        if (isYoutubeMode && youtubePlayer && typeof youtubePlayer.setVolume === 'function') {
            syncYoutubeVolume();
        }
        // Video.js播放器
        else if (window.videoPlayer) {
            window.videoPlayer.volume(volume);
            // 確保當音量為 0 時完全靜音
            window.videoPlayer.muted(volume === 0);
        }
        // 普通音頻播放器
        else {
            applyAudioVolume(volume);
        }

        // 更新滑桿顏色（將 0-10 的值轉換為 0-100 的百分比）
        e.target.style.setProperty('--value', (e.target.value * 10) + '%');
        updateMuteButton();

        scheduleVolumeSend();
    });
    volumeSlider.addEventListener('pointerdown', function () { volumeDragging = true; });
    volumeSlider.addEventListener('pointerup', endVolumeDrag);
    volumeSlider.addEventListener('pointercancel', endVolumeDrag);

    // 初始化滑桿顏色（將 0-10 的值轉換為 0-100 的百分比）
    volumeSlider.style.setProperty('--value', (volumeSlider.value * 10) + '%');

    // 音量按鈕控制
    var volumeDownBtn = document.getElementById('volumeDownBtn');
    var volumeUpBtn = document.getElementById('volumeUpBtn');

    if (volumeDownBtn) {
        volumeDownBtn.addEventListener('click', function () {
            var currentValue = parseFloat(volumeSlider.value);
            var newValue = Math.max(0, currentValue - 1);
            volumeSlider.value = newValue;
            volumeSlider.dispatchEvent(new Event('input'));
        });
    }

    if (volumeUpBtn) {
        volumeUpBtn.addEventListener('click', function () {
            var currentValue = parseFloat(volumeSlider.value);
            var newValue = Math.min(10, currentValue + 1);
            volumeSlider.value = newValue;
            volumeSlider.dispatchEvent(new Event('input'));
        });
    }

    if (window.isTv && volumeSlider) {
        volumeSlider.addEventListener('keydown', function (event) {
            var key = event.key || '';
            var code = event.keyCode || event.which;
            var delta = 0;
            if (key === 'ArrowLeft' || code === 37) delta = -1;
            else if (key === 'ArrowRight' || code === 39) delta = 1;
            if (!delta) return;
            event.preventDefault();
            var currentValue = parseFloat(volumeSlider.value);
            var newValue = Math.max(0, Math.min(10, currentValue + delta));
            if (newValue === currentValue) return;
            volumeSlider.value = newValue;
            volumeSlider.dispatchEvent(new Event('input'));
        });
    }

    // 電台選擇
    stationList.addEventListener('click', function (e) {
        var stationItem = e.target.closest('.station-item');
        if (stationItem) {
            var stationId = stationItem.dataset.stationId;
            var station = findStationById(stationId);
            if (station) {
                playStation(station);
            }
        }
    });

    // 主題切換
    document.getElementById('themeToggle').addEventListener('click', toggleTheme);

    // 上一首按鈕
    prevButton.addEventListener('click', function () {
        if (currentVideoIndex > 0) {
            playYoutubeIndex(currentVideoIndex - 1);
        }
    });

    // 下一首按鈕
    nextButton.addEventListener('click', function () {
        if (currentVideoIndex < playlist.length - 1) {
            playYoutubeIndex(currentVideoIndex + 1);
        }
    });

    var playPauseButton = document.getElementById('playPauseButton');
    var muteButton = document.getElementById('muteButton');
    var shuffleButton = document.getElementById('shuffleButton');
    if (playPauseButton) playPauseButton.addEventListener('click', toggleYoutubePlayback);
    if (muteButton) muteButton.addEventListener('click', toggleMute);
    if (shuffleButton) shuffleButton.addEventListener('click', shufflePlaylist);
    var expandPlayerButton = document.getElementById('expandPlayerButton');
    var collapsePlayerButton = document.getElementById('collapsePlayerButton');
    if (expandPlayerButton) expandPlayerButton.addEventListener('click', function () { setPlayerExpanded(true); });
    if (collapsePlayerButton) collapsePlayerButton.addEventListener('click', function () { setPlayerExpanded(false); });

    // 監聽全螢幕狀態變更
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.addEventListener('mozfullscreenchange', handleFullscreenChange);
    document.addEventListener('MSFullscreenChange', handleFullscreenChange);
    document.addEventListener('visibilitychange', onYoutubeVisibilityChange);
}

// 獲取標籤顏色
function getTagColor(tag) {
    var colors = {
        'local': 'secondary',
        'music': 'success',
        'news': 'info',
        'talk': 'warning',
        'sport': 'danger'
    };
    return colors[tag.toLowerCase()] || 'secondary';
}

// 根據ID查找電台
function findStationById(id) {
    return customStations.find(function (station) {
        return station.id === id;
    });
}

// 播放電台
function playStation(station) {
    console.log('開始播放電台:', station.name, 'URL:', station.url);
    preserveVolumeForSourceSwitch();

    if (isYoutubeMode) {
        isYoutubeMode = false;
        youtubeSection.style.display = 'none';
        // 停止 YouTube 播放
        markYoutubePlaybackPaused('stop');
        if (youtubePlayer && youtubePlayer.stopVideo) {
            youtubePlayer.stopVideo();
        }
        // 顯示音量控制卡片
        controlCard.style.display = 'block';
    }

    currentStation = station;
    currentStationName.textContent = station.name;

    // 更新活動狀態
    var allStations = document.querySelectorAll('.station-item');
    allStations.forEach(function (item) {
        item.classList.remove('active');
        if (item.dataset.stationId === station.id) {
            item.classList.add('active');
        }
    });

    startRadioTransition(station);
    placeVolumeControl();
    updateRadioState();
    announcePlayback(currentUserName() + ' 切換到 ' + station.name);
}

// 更新廣播狀態
function updateRadioState() {
    // 只送目前這次的意圖。音量與佇列走各自的指令，避免把過期的整包狀態蓋回去。
    if (!socket || !currentStation || isYoutubeMode) return;
    var payload = { station: currentStation };
    if (window.RadioSyncClient && typeof RadioSyncClient.issueOp === 'function') {
        var op = RadioSyncClient.issueOp(syncSession, 'station');
        payload.clientId = op.clientId;
        payload.opId = op.opId;
    }
    socket.emit('setStation', payload);
}

// 新增：只同步播放清單，不觸發播放狀態更新
function updatePlaylistOnly() {
    // 只有當播放清單不為空時才發送 addPlaylist
    if (isYoutubeMode && playlist.length > 0 && !isLoadingPlaylist) {
        // 設置保護期以忽略回送的遠端索引更新
        suppressIndexUpdatesUntil = Date.now() + 800;
        socket.emit('addPlaylist', playlist);
        console.log('只同步播放清單，不更新播放狀態');
    }
}

// 設置 Socket 監聽器
function setupSocketListeners() {
    socket.on('currentState', function (state) {
        if (state) {
            console.log('收到初始狀態:', state);
            // YouTube 模式需要完整播放清單，不能走僅初始化電台的舊流程。
            if (state.youtubeState && state.youtubeState.isYoutubeMode) {
                handleStateUpdate(state);
            } else if (state.currentStation && state.isPlaying) {
                handleInitialState(state);
            } else {
                handleStateUpdate(state);
            }
        }
    });

    socket.on('radioStateUpdate', function (state) {
        console.log('收到狀態更新:', state);
        handleStateUpdate(state);
    });

    socket.on('onlineUsers', function (count) {
        var onlineBadge = document.getElementById('onlineUsers');
        onlineBadge.textContent = String(count);
        onlineBadge.setAttribute('title', '線上人數: ' + count);
    });
}

// 新增處理狀態更新的函數
function handleStateUpdate(state) {
    var syncApi = window.RadioSyncClient;
    if (syncApi && typeof state.revision === 'number' &&
        syncApi.isStaleRevision(appliedRevision, state.revision)) {
        return;
    }
    if (typeof state.revision === 'number') {
        appliedRevision = syncApi
            ? syncApi.nextAppliedRevision(appliedRevision, state.revision)
            : state.revision;
    }
    // 檢查是否需要切換模式 - 更智能的判斷
    // 只有當明確指定 YouTube 模式時才切換，避免因為缺少 youtubeState 而誤判
    var incomingYoutubeMode = !!(state.youtubeState && state.youtubeState.isYoutubeMode === true);
    var needModeSwitch = incomingYoutubeMode !== isYoutubeMode;

    console.log('模式切換檢查:', {
        currentMode: isYoutubeMode ? 'YouTube' : 'Radio',
        incomingYoutubeMode: incomingYoutubeMode,
        needModeSwitch: needModeSwitch,
        hasYoutubeState: !!state.youtubeState
    });

    // 同步音量 - 這個操作不應該中斷播放
    if (state.volume !== undefined && !isNaN(state.volume)) {
        var incomingVolume = normalizeVolume(state.volume);
        var shouldKeepLocalVolume = Date.now() < volumeSyncLockUntil &&
            Math.abs(incomingVolume - getSavedVolume()) > 0.001;

        var draggingNow = typeof volumeDragging !== 'undefined' && volumeDragging;
        var settlingNow = typeof volumeSettleUntil === 'number' && Date.now() < volumeSettleUntil;
        var session = typeof syncSession !== 'undefined' ? syncSession : null;
        var volumeDecision;
        if (syncApi && typeof syncApi.decideVolumeSync === 'function' && session) {
            volumeDecision = syncApi.decideVolumeSync({
                incomingVolume: incomingVolume,
                origin: state.volumeOrigin || null,
                clientId: session.clientId,
                latestLocalOpId: session.volumeOpId,
                interacting: draggingNow,
                withinSettle: settlingNow,
                deferredVolume: deferredServerVolume
            });
        } else if (syncApi && typeof syncApi.reconcileVolume === 'function') {
            volumeDecision = syncApi.reconcileVolume(draggingNow, deferredServerVolume, incomingVolume);
        } else {
            volumeDecision = { applyNow: !draggingNow, deferredVolume: draggingNow ? incomingVolume : null, volume: incomingVolume };
        }
        if (!volumeDecision.applyNow) {
            deferredServerVolume = volumeDecision.deferredVolume;
            if (!volumeDecision.ignore && deferredServerVolume != null) {
                setTimeout(flushDeferredVolume, VOLUME_SETTLE_MS);
            }
            console.log('音量先不覆蓋本機:', incomingVolume);
        } else if (shouldKeepLocalVolume && typeof state.revision !== 'number') {
            deferredServerVolume = incomingVolume;
            console.log('切換來源期間保留本機音量:', getSavedVolume());
        } else {
            rememberVolume(incomingVolume);
            isMuted = incomingVolume === 0;
            if (typeof updateMuteButton === 'function') updateMuteButton();
            // 更新播放器音量，但不中斷播放
            if (isYoutubeMode && youtubePlayer && typeof youtubePlayer.setVolume === 'function') {
                syncYoutubeVolume();
            } else if (window.videoPlayer) {
                window.videoPlayer.volume(incomingVolume);
                window.videoPlayer.muted(incomingVolume === 0);
            } else {
                applyAudioVolume(incomingVolume);
            }
        }
    }

    if (incomingYoutubeMode) {
        stopRadioPlayback();
        // 強制切換到 YouTube 模式
        isYoutubeMode = true;
        controlCard.style.display = 'none';
        youtubeSection.style.display = 'block';
        currentStationName.textContent = 'YouTube 播放器';
        if (typeof placeVolumeControl === 'function') placeVolumeControl();
        // 必須先顯示容器，部分電視瀏覽器才能建立 iframe。
        ensureYoutubePlayerReady();

        // 停止所有播放源
        const audioElement = document.getElementById('audioPlayer');
        if (audioElement) {
            audioElement.pause();
        }
        if (window.hls) {
            window.hls.destroy();
            window.hls = null;
        }

        // 檢查播放清單是否被清空
        if (!state.youtubeState.playlist || state.youtubeState.playlist.length === 0) {
            playlist = [];
            currentVideoIndex = -1;
            markYoutubePlaybackPaused('stop');
            if (youtubePlayer && youtubePlayer.stopVideo) {
                youtubePlayer.stopVideo();
            }
        } else {
            var oldVideoId = getPlaylistVideoId(playlist, currentVideoIndex);
            var newVideoId = getPlaylistVideoId(state.youtubeState.playlist, state.youtubeState.currentIndex);

            // 保存當前播放狀態
            var wasPlaying = youtubePlayer && youtubePlayer.getPlayerState &&
                youtubePlayer.getPlayerState() === YT.PlayerState.PLAYING;
            var oldCurrentIndex = currentVideoIndex;
            var oldPlaylist = playlist.slice(); // 保存舊的播放清單

            // 檢查是否只是播放清單重新排序（當前播放的影片 ID 沒有改變）
            var currentPlayingVideoId = oldVideoId;
            var newPlayingVideoId = newVideoId;

            // 檢查播放清單是否只是重新排序（長度相同，包含相同的影片）
            var isPlaylistReorder = false;
            if (oldPlaylist.length === state.youtubeState.playlist.length && oldPlaylist.length > 0) {
                var oldIds = oldPlaylist.map(function (v) { return v.id; }).sort();
                var newIds = state.youtubeState.playlist.map(function (v) { return v.id; }).sort();
                isPlaylistReorder = oldIds.length === newIds.length && oldIds.every(function (id, i) { return id === newIds[i]; });
            }

            // 檢查是否是真正的播放清單重新排序（而不是正常的曲目切換）
            var isRealPlaylistReorder = false;
            if (isPlaylistReorder) {
                isRealPlaylistReorder = !playlistsEqual(oldPlaylist, state.youtubeState.playlist);
            }

            // 如果檢測到真正的播放清單重新排序，檢查當前播放器狀態
            if (isRealPlaylistReorder) {
                var isCurrentlyPlaying = youtubePlayer && youtubePlayer.getPlayerState &&
                    youtubePlayer.getPlayerState() === YT.PlayerState.PLAYING;

                // 獲取當前播放器正在播放的影片 ID
                var currentPlayerVideoId = null;
                if (youtubePlayer && youtubePlayer.getVideoData) {
                    try {
                        var videoData = youtubePlayer.getVideoData();
                        currentPlayerVideoId = videoData ? videoData.video_id : null;
                    } catch (e) {
                        console.log('無法獲取當前播放器影片ID:', e);
                    }
                }

                // 如果當前正在播放，保持播放狀態，不切換影片
                if (isCurrentlyPlaying && currentPlayerVideoId) {
                    console.log('檢測到真正的播放清單重新排序且正在播放，保持當前播放狀態，播放器影片ID:', currentPlayerVideoId);

                    // 更新播放清單
                    playlist = state.youtubeState.playlist;

                    // 找到當前播放影片在新播放清單中的位置
                    var newIndexForCurrentVideo = playlist.findIndex(function (video) {
                        return video.id === currentPlayerVideoId;
                    });

                    if (newIndexForCurrentVideo !== -1) {
                        currentVideoIndex = newIndexForCurrentVideo;
                        console.log('找到當前播放影片在新播放清單中的位置:', newIndexForCurrentVideo);
                    }

                    updatePlaylistUI();
                    updateNavigationButtons();
                    return;
                }
            }

            // 更新播放清單
            playlist = state.youtubeState.playlist;
            currentVideoIndex = state.youtubeState.currentIndex;
            radioDebug('sync-youtube', {
                rev: state.revision,
                index: currentVideoIndex,
                id: newVideoId
            });

            // 特殊處理：如果播放清單有內容但沒有設置當前影片，自動選擇第一首
            if (playlist.length > 0 && (currentVideoIndex === -1 || !newVideoId)) {
                console.log('播放清單有內容但沒有設置當前影片，自動選擇第一首');
                currentVideoIndex = 0;
                newVideoId = playlist[0].id;
                if (socket && playlist[0].itemId) {
                    socket.emit('playIndex', { index: 0, itemId: playlist[0].itemId });
                }
            }

            // 在以下情況需要載入新影片：
            // 1. 需要模式切換
            // 2. 切換到不同的影片（包括上一首/下一首）
            // 3. 當前沒有播放任何影片但有播放清單
            var shouldLoadVideo = needModeSwitch || oldVideoId !== newVideoId ||
                (newVideoId && youtubePlayer && youtubePlayer.getPlayerState &&
                    youtubePlayer.getPlayerState() === YT.PlayerState.UNSTARTED);

            // 只有在影片真的改變時才載入新影片
            var videoActuallyChanged = oldVideoId !== newVideoId;

            // 額外檢查：如果當前播放器正在播放相同的影片，不要重新載入
            var currentPlayerVideoId = null;
            if (youtubePlayer && youtubePlayer.getVideoData) {
                try {
                    var videoData = youtubePlayer.getVideoData();
                    currentPlayerVideoId = videoData ? videoData.video_id : null;
                } catch (e) {
                    console.log('無法獲取當前播放器影片ID:', e);
                }
            }

            // 如果播放器已經在播放目標影片且正在播放中，不要重新載入
            var isCurrentlyPlaying = youtubePlayer && youtubePlayer.getPlayerState &&
                youtubePlayer.getPlayerState() === YT.PlayerState.PLAYING;

            if (currentPlayerVideoId && currentPlayerVideoId === newVideoId && isCurrentlyPlaying) {
                console.log('播放器已經在播放目標影片且正在播放中，跳過重新載入:', newVideoId);
                // 只更新播放清單和索引，不觸發重新載入
                updatePlaylistUI();
                updateNavigationButtons();
                return;
            }

            if (youtubePlayer && youtubePlayer.loadVideoById && newVideoId && shouldLoadVideo && videoActuallyChanged) {
                console.log('遠端載入新影片:', newVideoId, '原因:', {
                    needModeSwitch: needModeSwitch,
                    videoChanged: videoActuallyChanged,
                    oldVideoId: oldVideoId,
                    newVideoId: newVideoId,
                    playerState: youtubePlayer.getPlayerState ? youtubePlayer.getPlayerState() : 'unknown'
                });
                loadYoutubeVideoNow(youtubePlayer, newVideoId);
            } else if (youtubePlayer && newVideoId && youtubePlayer.getPlayerState &&
                youtubePlayer.getPlayerState() === YT.PlayerState.CUED) {
                markYoutubePlaybackWanted();
                syncYoutubeVolume();
                if (youtubePlayer.playVideo) youtubePlayer.playVideo();
                syncYoutubeVolume();
                armYoutubeVolumeChecks();
            } else if (!videoActuallyChanged) {
                console.log('影片未改變，跳過重新載入:', {
                    videoId: newVideoId,
                    index: currentVideoIndex
                });
            }
        }

        // 強制更新 UI 狀態
        controlCard.style.display = 'none';
        youtubeSection.style.display = 'block';
        currentStationName.textContent = 'YouTube 播放器';

        updatePlaylistUI();
        updateNavigationButtons();
    } else if (state.currentStation) {
        // 電台模式處理
        isYoutubeMode = false;
        youtubeSection.style.display = 'none';
        markYoutubePlaybackPaused('stop');
        if (youtubePlayer && youtubePlayer.stopVideo) {
            youtubePlayer.stopVideo();
        }
        controlCard.style.display = 'block';
        if (typeof placeVolumeControl === 'function') placeVolumeControl();

        // 檢查是否真的需要切換電台或從 YouTube 模式切換回電台
        // 只有在電台真的不同或需要模式切換時才中斷播放
        var staleOwnStation = window.RadioSyncClient && typeof RadioSyncClient.isOwnStaleEcho === 'function' &&
            typeof syncSession !== 'undefined' &&
            RadioSyncClient.isOwnStaleEcho(state.stationOrigin, syncSession.clientId, syncSession.stationOpId);
        var needStationSwitch = !staleOwnStation && (!currentStation || currentStation.id !== state.currentStation.id);
        if (staleOwnStation) {
            console.log('忽略自己較舊的切台回聲');
        }

        if (needStationSwitch || needModeSwitch) {
            console.log('需要切換電台或模式:', {
                needStationSwitch: needStationSwitch,
                needModeSwitch: needModeSwitch,
                currentStationId: currentStation ? currentStation.id : null,
                newStationId: state.currentStation.id
            });

            currentStation = state.currentStation;
            currentStationName.textContent = state.currentStation.name;
            if (state.isPlaying !== false) startRadioTransition(state.currentStation);
            else stopRadioPlayback();
        } else if (!staleOwnStation) {
            // 如果不需要切換電台，只更新電台資訊但不中斷播放
            console.log('只更新電台資訊，不中斷播放');
            currentStation = state.currentStation;
            currentStationName.textContent = state.currentStation.name;
        }

        if (!staleOwnStation) {
            // 更新電台列表選中狀態
            var allStations = document.querySelectorAll('.station-item');
            allStations.forEach(function (item) {
                item.classList.remove('active');
                if (item.dataset.stationId === state.currentStation.id) {
                    item.classList.add('active');
                }
            });
        }

    }
}

// 新增處理初始狀態的函數
function handleInitialState(state) {
    console.log('處理初始狀態:', state);

    // 設置音量
    if (state.volume !== undefined && !isNaN(state.volume)) {
        rememberVolume(state.volume);
    }

    // 處理初始電台
    if (state.currentStation && !(state.youtubeState && state.youtubeState.isYoutubeMode)) {
        currentStation = state.currentStation;
        currentStationName.textContent = state.currentStation.name;

        // 更新電台列表選中狀態
        var allStations = document.querySelectorAll('.station-item');
        allStations.forEach(function (item) {
            item.classList.remove('active');
            if (item.dataset.stationId === state.currentStation.id) {
                item.classList.add('active');
            }
        });

        if (state.isPlaying !== false) startRadioTransition(state.currentStation);
        else stopRadioPlayback();
    }

    // 處理 YouTube 模式
    if (state.youtubeState && state.youtubeState.isYoutubeMode) {
        stopRadioPlayback();
        audioPlayer.pause();
        isYoutubeMode = true;
        controlCard.style.display = 'none';
        youtubeSection.style.display = 'block';
        if (typeof placeVolumeControl === 'function') placeVolumeControl();
        ensureYoutubePlayerReady();
    }
    if (typeof placeVolumeControl === 'function') placeVolumeControl();
}

// 設置主題
function setupTheme() {
    var saved = 'light';
    try {
        saved = localStorage.getItem('theme') || 'light';
    } catch (error) {
        saved = 'light';
    }
    // 電視只有深色／淺色。若電腦存過其他深色主題，電視改套用既有深色樣式。
    if (window.isTv) isDarkMode = saved === 'dark' || isDarkThemeName(saved);
    else isDarkMode = saved === 'dark';
    applyTheme();
}

// 切換主題
function toggleTheme() {
    isDarkMode = !isDarkMode;
    localStorage.setItem('theme', isDarkMode ? 'dark' : 'light');
    applyTheme();
}

// 應用主題
function applyTheme() {
    if (isDarkMode) {
        document.body.classList.add('dark-mode');
        document.getElementById('themeToggle').innerHTML = '<i class="bi bi-sun"></i>';
    } else {
        document.body.classList.remove('dark-mode');
        document.getElementById('themeToggle').innerHTML = '<i class="bi bi-moon"></i>';
    }
}

function setYoutubeInitStatus(message, isError) {
    var status = document.getElementById('youtubeInitStatus');
    if (!status) return;

    status.textContent = message || '';
    status.className = isError ? 'youtube-init-status is-error' : 'youtube-init-status';
    status.style.display = message ? 'block' : 'none';
}

function getYoutubeOrigin() {
    // location.origin 在部分舊款電視瀏覽器不存在；只在 HTTP(S) 網頁傳遞有效 origin。
    if (window.location.protocol !== 'http:' && window.location.protocol !== 'https:') {
        return null;
    }
    return window.location.protocol + '//' + window.location.host;
}

function getYoutubePlayerVars() {
    var playerVars = {
        'playsinline': 1,
        'enablejsapi': 1,
        'rel': 0
    };
    var origin = getYoutubeOrigin();
    if (origin) playerVars.origin = origin;
    return playerVars;
}

function getYoutubePlayerElement() {
    var playerDiv = document.getElementById('youtubePlayer');

    // 在失敗後若只留下 iframe，先換回 IFrame API 可初始化的 div。
    if (playerDiv && playerDiv.tagName && playerDiv.tagName.toLowerCase() === 'iframe') {
        if (playerDiv.parentNode) playerDiv.parentNode.removeChild(playerDiv);
        playerDiv = null;
    }

    if (!playerDiv) {
        playerDiv = document.createElement('div');
        playerDiv.id = 'youtubePlayer';
        var playerContainer = document.querySelector('.youtube-container') || youtubeSection;
        if (playerContainer) playerContainer.appendChild(playerDiv);
    }
    return playerDiv;
}

function scheduleYoutubeApiRetry(reason) {
    if (youtubeApiLoadTimer) {
        clearTimeout(youtubeApiLoadTimer);
        youtubeApiLoadTimer = null;
    }
    if (youtubeApiRetryTimer || youtubeApiAttempt >= youtubeApiMaxAttempts) {
        if (youtubeApiAttempt >= youtubeApiMaxAttempts) {
            setYoutubeInitStatus('無法載入 YouTube 播放器，請確認電視可連線至 YouTube 後再試。', true);
        }
        return;
    }

    youtubeApiState = 'failed';
    console.warn('YouTube IFrame API 載入失敗，準備重試：', reason);
    setYoutubeInitStatus('正在重新連線 YouTube 播放器…', false);
    youtubeApiRetryTimer = setTimeout(function () {
        youtubeApiRetryTimer = null;
        loadYouTubeAPI();
    }, youtubeApiAttempt * 1000);
}

// 只由 app.js 載入 IFrame API，確保回調已經存在，避免電視瀏覽器的載入競態。
function loadYouTubeAPI() {
    if (window.YT && typeof window.YT.Player === 'function') {
        youtubeApiState = 'ready';
        ensureYoutubePlayerReady();
        return;
    }
    if (youtubeApiState === 'loading') return;
    if (youtubeApiAttempt >= youtubeApiMaxAttempts) {
        setYoutubeInitStatus('無法載入 YouTube 播放器，請確認電視可連線至 YouTube 後再試。', true);
        return;
    }

    youtubeApiState = 'loading';
    youtubeApiAttempt++;
    var previousTag = document.getElementById('youtube-iframe-api');
    if (previousTag && previousTag.parentNode) previousTag.parentNode.removeChild(previousTag);

    var tag = document.createElement('script');
    tag.id = 'youtube-iframe-api';
    tag.src = youtubeApiUrl;
    tag.async = true;
    tag.onerror = function () {
        scheduleYoutubeApiRetry('網路或 TLS 連線錯誤');
    };
    (document.head || document.body).appendChild(tag);

    youtubeApiLoadTimer = setTimeout(function () {
        if (!(window.YT && typeof window.YT.Player === 'function')) {
            scheduleYoutubeApiRetry('等待 API 逾時');
        }
    }, 12000);
}

// YouTube API 準備就緒時的回調
function onYouTubeIframeAPIReady() {
    console.log('YouTube API Ready');
    youtubeApiState = 'ready';
    if (youtubeApiLoadTimer) {
        clearTimeout(youtubeApiLoadTimer);
        youtubeApiLoadTimer = null;
    }
    ensureYoutubePlayerReady();
}

function ensureYoutubePlayerReady() {
    if (!isYoutubeMode || youtubePlayerReady || youtubePlayerInitializing) return;
    if (!(window.YT && typeof window.YT.Player === 'function')) {
        loadYouTubeAPI();
        return;
    }

    var playerDiv = getYoutubePlayerElement();
    ensureYoutubeFrameHost();
    layoutYoutubeFrame();
    if (!playerDiv) {
        setYoutubeInitStatus('找不到 YouTube 播放器容器。', true);
        return;
    }

    if (youtubePlayerReadyTimer) {
        clearTimeout(youtubePlayerReadyTimer);
        youtubePlayerReadyTimer = null;
    }
    youtubePlayerInitializing = true;
    youtubePlayerReady = false;
    setYoutubeInitStatus('正在初始化 YouTube 播放器…', false);
    try {
        youtubePlayer = new window.YT.Player(playerDiv.id, {
            width: '100%',
            height: '100%',
            playerVars: getYoutubePlayerVars(),
            events: {
                'onReady': onPlayerReady,
                'onStateChange': onPlayerStateChange,
                'onError': onPlayerError
            }
        });
        if (!youtubePlayerReady) {
            youtubePlayerReadyTimer = setTimeout(function () {
                youtubePlayerReadyTimer = null;
                if (youtubePlayerReady) return;
                console.error('YouTube 播放器初始化逾時');
                youtubePlayerInitializing = false;
                if (youtubePlayer && typeof youtubePlayer.destroy === 'function') {
                    try {
                        youtubePlayer.destroy();
                    } catch (e) { }
                }
                youtubePlayer = null;
                setYoutubeInitStatus('YouTube 播放器初始化逾時，正在重試…', true);
                ensureYoutubePlayerReady();
            }, 15000);
        }
    } catch (error) {
        youtubePlayer = null;
        youtubePlayerInitializing = false;
        console.error('YouTube 播放器初始化失敗:', error);
        setYoutubeInitStatus('YouTube 播放器初始化失敗，正在重試…', true);
        setTimeout(ensureYoutubePlayerReady, 1000);
    }
}

// 播放器準備就緒的回調
function onPlayerReady(event) {
    console.log('Player Ready');
    youtubePlayerInitializing = false;
    youtubePlayerReady = true;
    if (youtubePlayerReadyTimer) {
        clearTimeout(youtubePlayerReadyTimer);
        youtubePlayerReadyTimer = null;
    }
    setYoutubeInitStatus('', false);

    // 暴露音量檢查方法到 window
    window.checkVolume = function() {
        var currentVolume = getSavedVolume();
        console.log('目前元件記錄音量 (volumeSlider):', currentVolume);

        if (youtubePlayer) {
            // YouTube Player API 的 getVolume 返回 0-100
            var playerVolume = youtubePlayer.getVolume ? youtubePlayer.getVolume() : 'Unknown';
            var playerMuted = youtubePlayer.isMuted ? youtubePlayer.isMuted() : 'Unknown';
            console.log('實際播放器音量 (0-100):', playerVolume);
            console.log('實際播放器靜音狀態:', playerMuted);
        } else {
            console.log('播放器實例未找到');
        }
    };

    // 設置初始音量
    syncYoutubeVolume();

    // 如果有待播放的視頻，先把音量設好再立刻播放
    if (currentVideoIndex !== -1 && playlist[currentVideoIndex]) {
        try {
            loadYoutubeVideoNow(event.target, playlist[currentVideoIndex].id);
        } catch (error) {
            console.error('播放影片時發生錯誤:', error);
        }
    } else if (playlist.length > 0) {
        console.log('自動播放第一首影片');
        playYoutubeIndex(0);
    }
}

function onPlayerError(event) {
    // 2、5、100、101、150 是 IFrame API 的影片錯誤碼；播放器本身仍可使用。
    console.error('YouTube 播放錯誤:', event && event.data);
    setYoutubeInitStatus('YouTube 無法播放這部影片（錯誤碼：' + (event && event.data) + '）。', true);
}

// 添加 YouTube 相關事件監聽器
function setupYoutubeEventListeners() {
    // YouTube 模式切換按鈕
    var youtubeBtn = document.createElement('div');
    youtubeBtn.className = 'station station-item';
    youtubeBtn.innerHTML = '<strong class="station-name">YouTube 播放器</strong>' +
        '<div class="station-tags">' +
        '<span class="badge badge-info">YouTube</span>' +
        '</div>';
    stationList.insertBefore(youtubeBtn, stationList.firstChild);

    youtubeBtn.addEventListener('click', function () {
        switchToYoutube();
    });

    // 添加到播放清單按鈕
    addToPlaylistBtn.addEventListener('click', function () {
        loadYoutubePlaylist();
    });

    // 清除播放清單按鈕
    clearPlaylistBtn.addEventListener('click', function () {
        clearYoutubePlaylist();
    });
}

// 切換到 YouTube 模式
function switchToYoutube() {
    stopRadioPlayback();
    isYoutubeMode = true;

    // 停止所有播放源
    if (window.videoPlayer) {
        try {
            window.videoPlayer.pause();
            window.videoPlayer.dispose();
            window.videoPlayer = null;
        } catch (e) {
            console.log('停止 HLS 播放器時發生錯誤:', e);
        }
    }
    if (audioPlayer) {
        audioPlayer.pause();
        audioPlayer.src = '';
    }

    // 隱藏電台卡片，音量列改掛到 YouTube 區，遙控器仍可調音量。
    controlCard.style.display = 'none';
    youtubeSection.style.display = 'block';
    currentStationName.textContent = 'YouTube 播放器';
    placeVolumeControl();
    announcePlayback(currentUserName() + ' 切換到 YouTube 模式');

    // 必須在容器顯示後才建立播放器；某些電視瀏覽器無法初始化 display:none 內的 iframe。
    ensureYoutubePlayerReady();

    // 更新活動狀態
    var allStations = document.querySelectorAll('.station-item');
    allStations.forEach(function (item) {
        item.classList.remove('active');
    });
    allStations[0].classList.add('active');

    if (playlist.length > 0 && currentVideoIndex === -1) {
        playYoutubeIndex(0);
    }

    updatePlaylistUI();
    updateNavigationButtons();
    if (socket) socket.emit('setMode', { mode: 'youtube' });
}

// 載入 YouTube 播放清單
function setImportStatus(message, isError) {
    var status = document.getElementById('importStatus');
    if (!status) return;
    status.textContent = message || '';
    if (isError) status.className = 'import-status is-error';
    else status.className = 'import-status';
}

function expandServerPlaylist(playlistId, onProgress, done) {
    if (!socket) {
        done({ ok: false, error: '尚未連上伺服器。' });
        return;
    }
    var requestId = 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    var settled = false;
    function finish(payload) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.off('youtubePlaylistExpanded', onResult);
        socket.off('youtubePlaylistProgress', onProgressEvent);
        done(payload || { ok: false, error: '讀取播放清單時發生錯誤。' });
    }
    function onResult(payload) {
        if (!payload || payload.requestId !== requestId) return;
        finish(payload);
    }
    function onProgressEvent(payload) {
        if (!payload || payload.requestId !== requestId) return;
        onProgress(payload.loaded || 0);
    }
    var timer = setTimeout(function () {
        finish({ ok: false, error: '讀取播放清單逾時。' });
    }, 60000);
    socket.on('youtubePlaylistExpanded', onResult);
    socket.on('youtubePlaylistProgress', onProgressEvent);
    socket.emit('expandYoutubePlaylist', { playlistId: playlistId, requestId: requestId });
}

function loadYoutubePlaylist() {
    var parsed = window.RadioSyncClient
        ? RadioSyncClient.collectYoutubeImport(youtubeUrlInput.value, extractVideoId)
        : [];
    youtubeUrlInput.value = '';
    if (!parsed.length) {
        setImportStatus('沒有可匯入的網址。', true);
        return;
    }
    var slots = new Array(parsed.length);
    var notes = [];
    var pending = parsed.length;
    if (addToPlaylistBtn) addToPlaylistBtn.disabled = true;
    setImportStatus('正在匯入…', false);

    function finishOne() {
        pending--;
        if (pending > 0) return;
        var payload = [];
        var i;
        var j;
        for (i = 0; i < slots.length; i++) {
            var group = slots[i] || [];
            for (j = 0; j < group.length; j++) payload.push(group[j]);
        }
        if (addToPlaylistBtn) addToPlaylistBtn.disabled = false;
        if (!payload.length) {
            setImportStatus(notes[0] || '沒有可匯入的影片。', true);
            return;
        }
        if (socket) socket.emit('queueAddMany', { items: payload });
        var message = '已匯入 ' + payload.length + ' 首';
        if (notes.length) message += '。' + notes.join('');
        setImportStatus(message, notes.length > 0);
    }

    parsed.forEach(function (item) {
        if (item.kind === 'playlist') {
            expandServerPlaylist(item.playlistId, function (loaded) {
                setImportStatus('正在讀取播放清單…已取得 ' + loaded + ' 首', false);
            }, function (result) {
                var videos = [];
                var list = result && result.items ? result.items : [];
                var n;
                for (n = 0; n < list.length; n++) {
                    if (!list[n] || !list[n].videoId) continue;
                    videos.push({ videoId: list[n].videoId, title: list[n].title || list[n].videoId });
                }
                slots[item.sourceIndex] = videos;
                if (result && result.message) notes.push(result.message);
                if (!result || !result.ok) notes.push((result && result.error) || '無法匯入播放清單。');
                finishOne();
            });
            return;
        }
        getVideoDetails(item.videoId, function (title) {
            slots[item.sourceIndex] = [{ videoId: item.videoId, title: title || item.videoId }];
            finishOne();
        });
    });
}

// 更新播放清單 UI
function updatePlaylistUI() {
    playlistContainer.innerHTML = '';
    playlist.forEach(function (video, index) {
        var item = document.createElement('div');
        item.className = 'playlist-item' + (index === currentVideoIndex ? ' active' : '');
        var savedButton = window.isTv ? '' :
            '<button type="button" class="btn icon-btn add-saved-btn" data-index="' + index + '" title="加入我的播放清單">' +
            '<i class="bi bi-plus-lg"></i>' +
            '</button>';
        item.innerHTML =
            '<span class="playlist-title">' + escapeHtml(video.title || video.id) + '</span>' +
            '<div class="playlist-actions">' +
            '<button type="button" class="btn icon-btn move-up-btn" data-index="' + index + '" title="上移"' + (index === 0 ? ' disabled' : '') + '>' +
            '<i class="bi bi-arrow-up"></i>' +
            '</button>' +
            '<button type="button" class="btn icon-btn move-down-btn" data-index="' + index + '" title="下移"' + (index === playlist.length - 1 ? ' disabled' : '') + '>' +
            '<i class="bi bi-arrow-down"></i>' +
            '</button>' +
            '<button type="button" class="btn icon-btn play-btn" data-index="' + index + '" title="播放">' +
            '<i class="bi bi-play-fill"></i>' +
            '</button>' +
            savedButton +
            '<button type="button" class="btn icon-btn remove-btn" data-index="' + index + '" title="移除">' +
            '<i class="bi bi-trash"></i>' +
            '</button>' +
            '</div>';

        item.querySelector('.play-btn').addEventListener('click', function (event) {
            playYoutubeIndex(parseInt(event.currentTarget.getAttribute('data-index'), 10));
        });
        item.querySelector('.remove-btn').addEventListener('click', function (event) {
            removeFromPlaylist(parseInt(event.currentTarget.getAttribute('data-index'), 10));
        });
        item.querySelector('.move-up-btn').addEventListener('click', function (event) {
            var from = parseInt(event.currentTarget.getAttribute('data-index'), 10);
            movePlaylistItem(from, from - 1);
        });
        item.querySelector('.move-down-btn').addEventListener('click', function (event) {
            var from = parseInt(event.currentTarget.getAttribute('data-index'), 10);
            movePlaylistItem(from, from + 1);
        });
        var addSaved = item.querySelector('.add-saved-btn');
        if (addSaved) {
            addSaved.addEventListener('click', function (event) {
                var at = parseInt(event.currentTarget.getAttribute('data-index'), 10);
                if (window.PcPlaylists && typeof window.PcPlaylists.promptAdd === 'function') {
                    window.PcPlaylists.promptAdd(playlist[at]);
                }
            });
        }

        playlistContainer.appendChild(item);
    });

    updateNavigationButtons();
}

function movePlaylistItem(from, to) {
    var item = playlist[from];
    if (!item) return;
    if (socket && item.itemId) socket.emit('queueMove', { itemId: item.itemId, toIndex: to });
    if (!window.PlaylistOrder || typeof PlaylistOrder.moveItem !== 'function') return;
    var snapshot = capturePlaybackSnapshot();
    var result = PlaylistOrder.moveItem(playlist, from, to, currentVideoIndex);
    playlist = result.list;
    currentVideoIndex = result.currentIndex;
    updatePlaylistUI();
    setTimeout(function () { restorePlaybackSnapshot(snapshot); }, 100);
}

function shufflePlaylist() {
    if (!playlist || playlist.length <= 1) return;
    if (socket) socket.emit('shuffleQueue');
}

function toggleYoutubePlayback() {
    if (!playlist.length) return;
    if (!youtubePlayer || typeof youtubePlayer.getPlayerState !== 'function') {
        if (currentVideoIndex < 0) playYoutubeIndex(0);
        return;
    }
    var state = -1;
    try {
        state = youtubePlayer.getPlayerState();
    } catch (error) {
        state = -1;
    }
    var playing = typeof YT !== 'undefined' && YT.PlayerState && state === YT.PlayerState.PLAYING;
    if (playing && typeof youtubePlayer.pauseVideo === 'function') {
        markYoutubePlaybackPaused('user');
        youtubePlayer.pauseVideo();
    } else if (currentVideoIndex < 0) {
        playYoutubeIndex(0);
    } else if (typeof youtubePlayer.playVideo === 'function') {
        markYoutubePlaybackWanted();
        syncYoutubeVolume();
        youtubePlayer.playVideo();
        syncYoutubeVolume();
        armYoutubeVolumeChecks();
    }
}

function toggleMute() {
    if (getSavedVolume() > 0) {
        volumeBeforeMute = getSavedVolume();
        rememberVolume(0);
    } else {
        rememberVolume(volumeBeforeMute > 0 ? volumeBeforeMute : 1);
    }
    isMuted = getSavedVolume() === 0;
    volumeSyncLockUntil = Date.now() + 1000;
    if (isYoutubeMode) syncYoutubeVolume();
    else applyAudioVolume(getSavedVolume());
    updateMuteButton();
    scheduleVolumeSend();
}

function updateMuteButton() {
    var button = document.getElementById('muteButton');
    if (!button) return;
    var muted = getSavedVolume() === 0;
    isMuted = muted;
    button.innerHTML = muted ? '<i class="bi bi-volume-mute-fill"></i>' : '<i class="bi bi-volume-up-fill"></i>';
    button.setAttribute('title', muted ? '取消靜音' : '靜音');
    button.setAttribute('aria-pressed', muted ? 'true' : 'false');
}

function updatePlayPauseButton() {
    var button = document.getElementById('playPauseButton');
    if (!button) return;
    var playing = false;
    try {
        playing = !!(youtubePlayer && typeof youtubePlayer.getPlayerState === 'function' &&
            typeof YT !== 'undefined' && YT.PlayerState &&
            youtubePlayer.getPlayerState() === YT.PlayerState.PLAYING);
    } catch (error) {
        playing = false;
    }
    button.innerHTML = playing ? '<i class="bi bi-pause-fill"></i>' : '<i class="bi bi-play-fill"></i>';
    button.setAttribute('title', playing ? '暫停' : '播放');
    button.setAttribute('aria-label', playing ? '暫停' : '播放');
}

// 播放指定索引的視頻
function playYoutubeIndex(index, options) {
    if (index >= 0 && index < playlist.length) {
        var fromEnd = !!(options && options.fromEnd);
        var snapshot = fromEnd ? null : capturePlaybackSnapshot();
        currentVideoIndex = index;
        if (youtubePlayer && youtubePlayer.loadVideoById) {
            loadYoutubeVideoNow(youtubePlayer, playlist[index].id);
            if (snapshot && snapshot.videoId && playlist[index] && snapshot.videoId === playlist[index].id) {
                setTimeout(function () { restorePlaybackSnapshot(snapshot); }, 200);
            }
        }
        updatePlaylistUI();
        if (socket) socket.emit('playIndex', { index: index, itemId: playlist[index].itemId || null });
        radioDebug('play-index', { index: index, id: playlist[index].id, fromEnd: fromEnd });
    }
}

// 從播放清單中移除
function removeFromPlaylist(index) {
    var snapshot = capturePlaybackSnapshot();
    var item = playlist[index];
    if (socket && item && item.itemId) socket.emit('queueRemove', { itemId: item.itemId });
    playlist.splice(index, 1);
    if (currentVideoIndex === index) {
        if (playlist.length > 0) {
            playYoutubeIndex(Math.min(index, playlist.length - 1));
        } else {
            currentVideoIndex = -1;
            markYoutubePlaybackPaused('stop');
            if (youtubePlayer && youtubePlayer.stopVideo) youtubePlayer.stopVideo();
            updatePlaylistUI();
        }
    } else {
        if (currentVideoIndex > index) currentVideoIndex--;
        updatePlaylistUI();
    }
    setTimeout(function () { restorePlaybackSnapshot(snapshot); }, 100);
}

// 清除播放清單
function clearYoutubePlaylist() {
    playlist = [];
    currentVideoIndex = -1;
    markYoutubePlaybackPaused('stop');
    if (youtubePlayer && youtubePlayer.stopVideo) {
        youtubePlayer.stopVideo();
    }
    updatePlaylistUI();
    updateNavigationButtons();
    if (socket) socket.emit('queueClear');
}

// 修改 onPlayerStateChange 函數
function onPlayerStateChange(event) {
    updatePlayPauseButton();
    var playerState = event && event.data;
    var states = (typeof YT !== 'undefined' && YT.PlayerState) ? YT.PlayerState : null;
    var playingNow = (states && playerState === states.PLAYING) || playerState === 1;
    var pausedNow = (states && playerState === states.PAUSED) || playerState === 2;
    var endedNow = states ? playerState === states.ENDED : playerState === 0;
    if (playingNow) {
        youtubeBlockEnded = false;
        markYoutubePlaybackWanted();
    }
    radioDebug('player-state', {
        state: playerState,
        time: youtubePlayer && youtubePlayer.getCurrentTime ? youtubePlayer.getCurrentTime() : null,
        id: readYoutubeVideoId()
    });
    if (states && (playerState === states.UNSTARTED || playerState === states.BUFFERING || playerState === states.PLAYING)) {
        syncYoutubeVolume();
        armYoutubeVolumeChecks();
    } else if (playerState === -1 || playerState === 3 || playerState === 1) {
        syncYoutubeVolume();
        armYoutubeVolumeChecks();
    }
    if (pausedNow) {
        if (!youtubePauseIsIntentional() && youtubeReachedEnd()) {
            advanceYoutubeFromEnd();
            return;
        }
        if (!youtubePauseIsIntentional()) noteUnexpectedYoutubePause();
        return;
    }
    if (endedNow) {
        wasFullscreen = !!(document.fullscreenElement ||
            document.webkitFullscreenElement ||
            document.mozFullScreenElement ||
            document.msFullscreenElement);
        advanceYoutubeFromEnd();
        return;
    }
    if (states && playerState === states.PLAYING && wasFullscreen) {
        try {
            var elem = document.documentElement;
            if (elem.requestFullscreen) {
                elem.requestFullscreen();
            } else if (elem.webkitRequestFullscreen) {
                elem.webkitRequestFullscreen();
            } else if (elem.msRequestFullscreen) {
                elem.msRequestFullscreen();
            } else if (elem.mozRequestFullScreen) {
                elem.mozRequestFullScreen();
            }
        } catch (error) {
            console.log('恢復全螢幕失敗:', error);
        }
    }
}

// 提取 YouTube 視頻 ID
function extractVideoId(url) {
    var regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
    var match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
}

// 獲取視頻詳細信息
function getVideoDetails(videoId, callback) {
    fetch('https://noembed.com/embed?url=https://www.youtube.com/watch?v=' + videoId)
        .then(function (response) { return response.json(); })
        .then(function (data) {
            callback(data.title);
        })
        .catch(function () {
            callback(null);
        });
}

// 新增函數：更新導航按鈕狀態
function updateNavigationButtons() {
    if (playlist.length === 0) {
        prevButton.disabled = true;
        nextButton.disabled = true;
    } else {
        prevButton.disabled = currentVideoIndex <= 0;
        nextButton.disabled = currentVideoIndex >= playlist.length - 1;
    }
    var shuffleButton = document.getElementById('shuffleButton');
    if (shuffleButton) shuffleButton.disabled = playlist.length <= 1;
    if (typeof updatePlayPauseButton === 'function') updatePlayPauseButton();
    if (typeof syncYoutubeChrome === 'function') syncYoutubeChrome();
}

// 處理全螢幕狀態變更
function handleFullscreenChange() {
    wasFullscreen = !!(document.fullscreenElement ||
        document.webkitFullscreenElement ||
        document.mozFullScreenElement ||
        document.msFullscreenElement);
}

// 比較兩個播放清單是否相同（避免 JSON.stringify 效能問題）
function playlistsEqual(a, b) {
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) {
        if (a[i].id !== b[i].id) return false;
    }
    return true;
}

// 在文檔加載完成後初始化
document.addEventListener('DOMContentLoaded', init);

// 添加一個變數來追蹤是否正在載入播放清單
var isLoadingPlaylist = false;
var lastSentPlaylist = [];

// 監聽從伺服器載入的播放清單
socket.on('playlistLoaded', function (data) {
    if (Array.isArray(data) && !isLoadingPlaylist) {
        isLoadingPlaylist = true;

        // 將從伺服器載入的播放清單轉換為正確的格式
        var newPlaylist = data.map(function (item) {
            return {
                id: item.videoId,
                title: item.title || item.videoId
            };
        });

        // 只有當播放清單有變化時才更新
        if (!playlistsEqual(playlist, newPlaylist)) {
            playlist = newPlaylist;
            lastSentPlaylist = playlist.slice();

            // 如果目前沒有播放任何影片且播放清單不為空，開始播放第一首
            if (currentVideoIndex === -1 && playlist.length > 0) {
                playYoutubeIndex(0);
            } else {
                updatePlaylistUI();
                updateNavigationButtons();
            }
        }

        setTimeout(function () {
            isLoadingPlaylist = false;
        }, 1000);
    }
});

// 監聽播放清單清除事件
socket.on('playlistCleared', function (data) {
    if (data.success) {
        console.log('伺服器已清除播放清單');
        // 本地也清除播放清單
        playlist = [];
        currentVideoIndex = -1;
        lastSentPlaylist = [];

        // 停止 YouTube 播放
        markYoutubePlaybackPaused('stop');
        if (youtubePlayer && youtubePlayer.stopVideo) {
            youtubePlayer.stopVideo();
        }

        // 更新 UI
        updatePlaylistUI();
        updateNavigationButtons();
    } else {
        console.error('清除播放清單失敗:', data.error);
    }
});

