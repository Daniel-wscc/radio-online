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
        url: 'https://m3u8-proxy.wscc1031.synology.me/fetch/?url=http://202.39.43.67:1935/live/RA000036/chunklist.m3u8',
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
var socket = io('https://radio.wscc1031.synology.me');
var isDarkMode = false;
// 本地重排/同步期間，短暫忽略遠端索引更新
var suppressIndexUpdatesUntil = 0;

// 串流重試相關變數
var streamRetryTimer = null;
var streamRetryCount = 0;
var streamRetryBaseDelay = 2000;  // 基礎延遲 2 秒
var streamRetryMaxDelay = 15000;  // 最大延遲 15 秒
var streamStalledTimer = null;
var streamStalledTimeout = 12000; // 串流停滯超過12秒視為斷線
var streamPlayStartTime = 0;      // 最近一次成功播放的起始時間
var isRetryingStream = false;     // 避免同時多個重試
var isSwitchingSource = false;    // 切換/重設音源時抑制事件
var lastPlayingTime = 0;          // 上次觸發 playing 事件的時間

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
function syncYoutubeVolume() {
    try {
        var currentVolume = getSavedVolume();
        if (youtubePlayer && typeof youtubePlayer.setVolume === 'function') {
            youtubePlayer.setVolume(currentVolume * 100);
            if (currentVolume === 0) {
                youtubePlayer.mute();
            } else {
                youtubePlayer.unMute();
            }
        }
    } catch (error) {
        console.error('同步音量失敗:', error);
    }
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
var savedVolume = volumeSlider ? parseFloat(volumeSlider.value) / 10 : 1;
var volumeSyncLockUntil = 0;

function getPlaylistVideoId(items, index) {
    return items && index >= 0 && items[index] ? items[index].id : null;
}

function normalizeVolume(value) {
    value = parseFloat(value);
    if (isNaN(value)) return savedVolume;
    return Math.max(0, Math.min(1, value));
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
}

function preserveVolumeForSourceSwitch() {
    var volume = rememberVolume();
    // 忽略切換過程中晚到的舊同步狀態，避免把新播放器重設為 100%。
    volumeSyncLockUntil = Date.now() + 2000;
    return volume;
}

// 初始化
function init() {
    loadStations();
    setupEventListeners();
    setupYoutubeEventListeners();
    setupSocketListeners();
    setupTheme();
    loadYouTubeAPI();

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
function createStationElement(station) {
    return '<div class="list-group-item station-item" data-station-id="' + station.id + '">' +
        '<div class="station-name">' + station.name + '</div>' +
        '<div class="station-tags">' +
        createTagsHtml(station.tags) +
        '</div>' +
        '</div>';
}

// 創建標籤 HTML
function createTagsHtml(tags) {
    if (!tags) return '';
    return tags.map(function (tag) {
        return '<span class="badge bg-' + getTagColor(tag) + ' me-1">' + tag + '</span>';
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

        // 使用防抖機制發送音量更新到伺服器
        if (volumeDebounceTimer) {
            clearTimeout(volumeDebounceTimer);
        }
        volumeDebounceTimer = setTimeout(function () {
            updateRadioState();
        }, volumeDebounceDelay);
    });

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

    // 監聽全螢幕狀態變更
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.addEventListener('mozfullscreenchange', handleFullscreenChange);
    document.addEventListener('MSFullscreenChange', handleFullscreenChange);
}

// 獲取標籤顏色
function getTagColor(tag) {
    var colors = {
        'local': 'primary',
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

// 清除串流重試相關的計時器
function clearStreamRetry() {
    if (streamRetryTimer) {
        clearTimeout(streamRetryTimer);
        streamRetryTimer = null;
    }
    if (streamStalledTimer) {
        clearTimeout(streamStalledTimer);
        streamStalledTimer = null;
    }
    streamRetryCount = 0;
    isRetryingStream = false;
    streamPlayStartTime = 0;
    lastPlayingTime = 0;
}

// 計算指數退避延遲（2s → 4s → 8s → 15s 上限）
function getRetryDelay() {
    var delay = streamRetryBaseDelay * Math.pow(2, Math.min(streamRetryCount, 4));
    return Math.min(delay, streamRetryMaxDelay);
}

// 排程一次重試（集中入口，避免多重排程）
function scheduleStreamRetry() {
    if (isYoutubeMode || !currentStation) return;
    if (isRetryingStream) return;
    if (streamRetryTimer) return;
    var delay = getRetryDelay();
    console.log('預計 ' + (delay / 1000) + ' 秒後重試 (次數: ' + (streamRetryCount + 1) + ')');
    streamRetryTimer = setTimeout(retryCurrentStream, delay);
}

// 重新連線當前電台串流（無次數限制，持續重試直到成功或切台）
function retryCurrentStream() {
    streamRetryTimer = null;
    if (!currentStation || isYoutubeMode) return;
    if (isRetryingStream) return;

    isRetryingStream = true;
    streamRetryCount++;
    streamPlayStartTime = 0; // 重置播放起始時間
    console.log('串流重試 (第 ' + streamRetryCount + ' 次):', currentStation.name);

    try {
        if (currentStation.url.endsWith('m3u8')) {
            if (window.hls) {
                window.hls.startLoad();
            }
            isRetryingStream = false;
        } else {
            ensureAudioElement();
            // 切換音源期間抑制 error/waiting/stalled 造成的連鎖重試
            isSwitchingSource = true;
            audioPlayer.pause();
            audioPlayer.removeAttribute('src');
            audioPlayer.load();

            setTimeout(function () {
                if (!currentStation) {
                    isSwitchingSource = false;
                    isRetryingStream = false;
                    return;
                }
                audioPlayer.src = currentStation.url;
                applyAudioVolume(getSavedVolume());

                var playPromise = audioPlayer.play();
                if (playPromise && typeof playPromise.catch === 'function') {
                    playPromise.catch(function (error) {
                        // AbortError 是瀏覽器切換 src 時的正常行為，忽略
                        if (error && error.name === 'AbortError') {
                            console.log('忽略 AbortError（切換 src 造成）');
                            return;
                        }
                        console.error('重試播放失敗:', error);
                        isRetryingStream = false;
                        scheduleStreamRetry();
                    });
                }
                // 解除抑制（給瀏覽器一點時間處理 src 變更）
                setTimeout(function () {
                    isSwitchingSource = false;
                    isRetryingStream = false;
                }, 1000);
            }, 300);
        }
    } catch (error) {
        console.error('重試時發生錯誤:', error);
        isRetryingStream = false;
        isSwitchingSource = false;
        scheduleStreamRetry();
    }
}

// 綁定串流監聽事件到 audio 元素
function bindStreamRecoveryEvents(audio) {
    audio.removeEventListener('stalled', onStreamStalled);
    audio.removeEventListener('error', onStreamError);
    audio.removeEventListener('playing', onStreamPlaying);

    audio.addEventListener('stalled', onStreamStalled);
    audio.addEventListener('error', onStreamError);
    audio.addEventListener('playing', onStreamPlaying);
}

function onStreamStalled() {
    if (isYoutubeMode || isSwitchingSource) return;
    if (streamStalledTimer) return; // 已在計時中
    console.log('串流停滯 (stalled)，' + (streamStalledTimeout / 1000) + ' 秒後若未恢復將重試');
    streamStalledTimer = setTimeout(function () {
        streamStalledTimer = null;
        // 再次確認播放器狀態：若已在播放則跳過
        if (audioPlayer && !audioPlayer.paused && audioPlayer.readyState >= 2) {
            console.log('串流已恢復，取消重試');
            return;
        }
        console.log('串流持續停滯，嘗試重新連線');
        scheduleStreamRetry();
    }, streamStalledTimeout);
}

function onStreamError(e) {
    if (isYoutubeMode || isSwitchingSource) return;
    // 確認是真的錯誤而不是 src 被清空
    if (!audioPlayer || !audioPlayer.src) return;
    var err = audioPlayer.error;
    console.error('串流發生錯誤:', err ? ('code=' + err.code + ' msg=' + err.message) : e);
    if (streamStalledTimer) {
        clearTimeout(streamStalledTimer);
        streamStalledTimer = null;
    }
    scheduleStreamRetry();
}

function onStreamPlaying() {
    lastPlayingTime = Date.now();
    if (streamStalledTimer) {
        clearTimeout(streamStalledTimer);
        streamStalledTimer = null;
    }
    // 播放啟動時間（成功連線）
    if (streamPlayStartTime === 0) {
        streamPlayStartTime = Date.now();
    }
    // 僅當播放穩定超過 10 秒才重置重試計數，避免極短暫的播放誤判成功
    if (streamRetryCount > 0) {
        setTimeout(function () {
            if (!audioPlayer || audioPlayer.paused) return;
            var playedDuration = Date.now() - streamPlayStartTime;
            if (playedDuration >= 10000 && !audioPlayer.paused) {
                console.log('串流穩定播放 ' + Math.round(playedDuration / 1000) + ' 秒，重置重試計數');
                streamRetryCount = 0;
                streamPlayStartTime = 0;
            }
        }, 10500);
    }
}

// 停止所有音頻源
function stopAllAudioSources() {
    console.log('停止所有音頻源');

    // 清除串流重試
    clearStreamRetry();

    // 停止 HLS 播放器
    if (window.hls) {
        try {
            window.hls.destroy();
            window.hls = null;
            console.log('HLS 播放器已銷毀');
        } catch (e) {
            console.log('銷毀 HLS 播放器時發生錯誤:', e);
        }
    }

    // 停止 video.js 播放器
    if (window.videoPlayer) {
        try {
            window.videoPlayer.pause();
            window.videoPlayer.dispose();
            window.videoPlayer = null;
            console.log('Video.js 播放器已銷毀');
        } catch (e) {
            console.log('停止舊播放器時發生錯誤:', e);
        }
    }

    // 停止普通音頻播放器
    if (audioPlayer) {
        try {
            audioPlayer.pause();
            audioPlayer.src = '';
            audioPlayer.load(); // 強制重新載入
            console.log('音頻播放器已停止');
        } catch (e) {
            console.log('停止音頻播放器時發生錯誤:', e);
        }
    }
}

// 確保音頻元素存在且正確
function ensureAudioElement() {
    var existingPlayer = document.getElementById('audioPlayer');
    if (!existingPlayer) {
        console.log('創建新的音頻元素');
        const audioElement = document.createElement('audio');
        audioElement.id = 'audioPlayer';
        audioElement.controls = false;
        audioElement.crossOrigin = 'anonymous';

        const controlCard = document.getElementById('controlCard');
        const cardBody = controlCard.querySelector('.card-body');
        if (cardBody) {
            cardBody.insertBefore(audioElement, cardBody.firstChild);
        }

        // 更新全域變數
        audioPlayer = audioElement;
        applyAudioVolume(getSavedVolume());
    } else {
        // 確保現有元素是正確的
        audioPlayer = existingPlayer;
        applyAudioVolume(getSavedVolume());
        console.log('使用現有的音頻元素');
    }
}

// 播放電台
function playStation(station) {
    console.log('開始播放電台:', station.name, 'URL:', station.url);
    var selectedVolume = preserveVolumeForSourceSwitch();

    if (isYoutubeMode) {
        isYoutubeMode = false;
        youtubeSection.style.display = 'none';
        // 停止 YouTube 播放
        if (youtubePlayer && youtubePlayer.stopVideo) {
            youtubePlayer.stopVideo();
        }
        // 顯示音量控制卡片
        controlCard.style.display = 'block';
    }

    // 在切換電台前先停止所有播放源
    stopAllAudioSources();

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

    // 播放音頻
    clearStreamRetry();
    try {
        if (station.url.endsWith('m3u8')) {
            playHLSStream(station.url);
        } else {
            // 確保使用正確的音頻元素
            ensureAudioElement();
            // 綁定串流恢復事件
            bindStreamRecoveryEvents(audioPlayer);

            audioPlayer.src = station.url;
            // 在設定來源前後都套用，避免 TV 瀏覽器把新媒體元素回復為預設 100%。
            applyAudioVolume(selectedVolume);

            audioPlayer.play().catch(function (error) {
                if (error && error.name === 'AbortError') return;
                console.error('播放失敗：', error);
                scheduleStreamRetry();
            });
        }
        updateRadioState();
    } catch (error) {
        console.error('播放失敗：', error);
    }
}

// 播放 HLS 流
function playHLSStream(url) {
    console.log('開始播放 HLS 串流:', url);

    try {
        // 確保使用正確的音頻元素
        ensureAudioElement();

        // 設置初始音量
        applyAudioVolume(getSavedVolume());

        // 檢查瀏覽器是否支援 HLS
        if (Hls.isSupported()) {
            // 如果存在舊的 hls 實例，先銷毀它
            if (window.hls) {
                window.hls.destroy();
                window.hls = null;
            }

            window.hls = new Hls();

            // 綁定 HLS 事件
            window.hls.on(Hls.Events.MEDIA_ATTACHED, function () {
                console.log('HLS 媒體已附加，開始載入源:', url);
                applyAudioVolume(getSavedVolume());
                window.hls.loadSource(url);
            });

            window.hls.on(Hls.Events.MANIFEST_PARSED, function () {
                console.log('HLS 清單已解析，開始播放');
                applyAudioVolume(getSavedVolume());
                audioPlayer.play().catch(function (error) {
                    console.error('HLS 播放失敗:', error);
                });
            });

            window.hls.on(Hls.Events.ERROR, function (event, data) {
                console.error('HLS error:', data);
                if (data.fatal) {
                    switch (data.type) {
                        case Hls.ErrorTypes.NETWORK_ERROR:
                            console.log('致命網路錯誤，嘗試恢復...');
                            window.hls.startLoad();
                            break;
                        case Hls.ErrorTypes.MEDIA_ERROR:
                            console.log('致命媒體錯誤，嘗試恢復...');
                            window.hls.recoverMediaError();
                            break;
                        default:
                            console.log('無法恢復的錯誤');
                            window.hls.destroy();
                            break;
                    }
                }
            });

            // 附加媒體
            window.hls.attachMedia(audioPlayer);
        }
        // 對於原生支援 HLS 的瀏覽器（如 Safari）
        else if (audioPlayer.canPlayType('application/vnd.apple.mpegurl')) {
            console.log('使用原生 HLS 支援');
            audioPlayer.src = url;
            audioPlayer.addEventListener('loadedmetadata', function () {
                console.log('原生 HLS 載入完成，開始播放');
                applyAudioVolume(getSavedVolume());
                audioPlayer.play().catch(function (error) {
                    console.error('原生 HLS 播放失敗:', error);
                });
            });
        } else {
            console.error('瀏覽器不支援 HLS');
        }

    } catch (error) {
        console.error('HLS 串流初始化失敗:', error);
    }
}

// 更新廣播狀態
function updateRadioState() {
    // 獲取當前音量值
    var currentVolume = getSavedVolume();

    var state = {
        currentStation: currentStation,
        isPlaying: !audioPlayer.paused,
        volume: currentVolume,
        youtubeState: {
            isYoutubeMode: isYoutubeMode,
            playlist: playlist,
            currentIndex: currentVideoIndex,
            currentVideoId: getPlaylistVideoId(playlist, currentVideoIndex)
        }
    };

    // 避免無限循環：只有當播放清單有變化時才發送 addPlaylist
    if (!playlistsEqual(playlist, lastSentPlaylist)) {
        lastSentPlaylist = playlist.slice();
        socket.emit('updateRadioState', state);

        if (isYoutubeMode && playlist.length > 0 && !isLoadingPlaylist) {
            socket.emit('addPlaylist', playlist);
        }
    } else {
        socket.emit('updateRadioState', state);
    }
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
        document.getElementById('onlineUsers').textContent = '線上人數: ' + count;
    });
}

// 新增處理狀態更新的函數
function handleStateUpdate(state) {
    // 檢查是否需要切換模式 - 更智能的判斷
    // 只有當明確指定 YouTube 模式時才切換，避免因為缺少 youtubeState 而誤判
    var incomingYoutubeMode = state.youtubeState && state.youtubeState.isYoutubeMode === true;
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

        if (shouldKeepLocalVolume) {
            console.log('切換來源期間保留本機音量:', getSavedVolume());
        } else {
            rememberVolume(incomingVolume);
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
        // 強制切換到 YouTube 模式
        isYoutubeMode = true;
        controlCard.style.display = 'none';
        youtubeSection.style.display = 'block';
        currentStationName.textContent = 'YouTube 播放器';
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
            if (youtubePlayer && youtubePlayer.stopVideo) {
                youtubePlayer.stopVideo();
            }
        } else {
            // 本地保護期：忽略遠端索引/影片ID更新，避免重排引發跳動
            if (Date.now() < suppressIndexUpdatesUntil) {
                console.log('本地重排保護期內，忽略遠端索引/影片ID更新');
                return;
            }
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

            // 特殊處理：如果播放清單有內容但沒有設置當前影片，自動選擇第一首
            if (playlist.length > 0 && (currentVideoIndex === -1 || !newVideoId)) {
                console.log('播放清單有內容但沒有設置當前影片，自動選擇第一首');
                currentVideoIndex = 0;
                newVideoId = playlist[0].id;
                // 更新遠端狀態
                updateRadioState();
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
                youtubePlayer.loadVideoById({
                    videoId: newVideoId,
                    startSeconds: undefined,
                    suggestedQuality: 'default'
                });
                // 載入後自動播放
                setTimeout(function () {
                    if (youtubePlayer && youtubePlayer.playVideo) {
                        youtubePlayer.playVideo();
                    }
                    setTimeout(syncYoutubeVolume, 1500);
                }, 1000);
            } else if (youtubePlayer && newVideoId && youtubePlayer.getPlayerState &&
                youtubePlayer.getPlayerState() === YT.PlayerState.CUED) {
                // 如果影片已經載入但沒有播放，直接播放
                setTimeout(function () {
                    if (youtubePlayer && youtubePlayer.playVideo) {
                        youtubePlayer.playVideo();
                    }
                    setTimeout(syncYoutubeVolume, 1000);
                }, 500);
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
        if (youtubePlayer && youtubePlayer.stopVideo) {
            youtubePlayer.stopVideo();
        }
        controlCard.style.display = 'block';

        // 檢查是否真的需要切換電台或從 YouTube 模式切換回電台
        // 只有在電台真的不同或需要模式切換時才中斷播放
        var needStationSwitch = !currentStation || currentStation.id !== state.currentStation.id;

        if (needStationSwitch || needModeSwitch) {
            console.log('需要切換電台或模式:', {
                needStationSwitch: needStationSwitch,
                needModeSwitch: needModeSwitch,
                currentStationId: currentStation ? currentStation.id : null,
                newStationId: state.currentStation.id
            });

            // 停止當前播放的音源
            stopAllAudioSources();

            currentStation = state.currentStation;
            currentStationName.textContent = state.currentStation.name;

            // 更新音源並播放
            clearStreamRetry();
            if (state.currentStation.url.endsWith('m3u8')) {
                playHLSStream(state.currentStation.url);
            } else {
                // 確保使用正確的音頻元素
                ensureAudioElement();
                bindStreamRecoveryEvents(audioPlayer);
                audioPlayer.src = state.currentStation.url;

                // 設定音量
                applyAudioVolume(getSavedVolume());

                if (state.isPlaying) {
                    audioPlayer.play().catch(function (error) {
                        if (error && error.name === 'AbortError') return;
                        console.log('遠端切換電台播放失敗:', error);
                        scheduleStreamRetry();
                    });
                }
            }
        } else {
            // 如果不需要切換電台，只更新電台資訊但不中斷播放
            console.log('只更新電台資訊，不中斷播放');
            currentStation = state.currentStation;
            currentStationName.textContent = state.currentStation.name;
        }

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

// 新增處理初始狀態的函數
function handleInitialState(state) {
    console.log('處理初始狀態:', state);

    // 設置音量
    if (state.volume !== undefined && !isNaN(state.volume)) {
        rememberVolume(state.volume);
    }

    // 處理初始電台
    if (state.currentStation) {
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

        // 設置音源並自動播放
        clearStreamRetry();
        if (state.currentStation.url.endsWith('m3u8')) {
            playHLSStream(state.currentStation.url);
        } else {
            // 確保使用正確的音頻元素
            ensureAudioElement();
            bindStreamRecoveryEvents(audioPlayer);
            audioPlayer.src = state.currentStation.url;

            // 設置音量
            applyAudioVolume(getSavedVolume());

            audioPlayer.play().catch(function (error) {
                if (error && error.name === 'AbortError') return;
                console.log('初始播放失敗:', error);
                scheduleStreamRetry();
            });
        }
    }

    // 處理 YouTube 模式
    if (state.youtubeState && state.youtubeState.isYoutubeMode) {
        isYoutubeMode = true;
        controlCard.style.display = 'none';
        youtubeSection.style.display = 'block';
        ensureYoutubePlayerReady();
    }
}

// 設置主題
function setupTheme() {
    isDarkMode = localStorage.getItem('theme') === 'dark';
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

    // 如果有待播放的視頻，立即播放
    if (currentVideoIndex !== -1 && playlist[currentVideoIndex]) {
        setTimeout(function () {
            try {
                event.target.loadVideoById(playlist[currentVideoIndex].id);
                setTimeout(function () {
                    event.target.playVideo();
                    syncYoutubeVolume();
                }, 500);
            } catch (error) {
                console.error('播放影片時發生錯誤:', error);
            }
        }, 100);
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
    youtubeBtn.className = 'list-group-item station-item';
    youtubeBtn.innerHTML = '<div class="station-name">YouTube 播放器</div>' +
        '<div class="station-tags">' +
        '<span class="badge bg-danger me-1">YouTube</span>' +
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

    // 隱藏音量控制卡片
    controlCard.style.display = 'none';
    youtubeSection.style.display = 'block';
    currentStationName.textContent = 'YouTube 播放器';

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

    // 避免無限循環：只在播放清單為空時從伺服器載入
    if (playlist.length === 0 && !isLoadingPlaylist) {
        isLoadingPlaylist = true;
        socket.emit('loadPlaylist');
        setTimeout(function () {
            isLoadingPlaylist = false;
        }, 1000);
    }
}

// 載入 YouTube 播放清單
function loadYoutubePlaylist() {
    var urls = youtubeUrlInput.value.split('\n').filter(function (url) {
        return url.trim() !== '';
    });

    var processedUrls = 0;
    urls.forEach(function (url) {
        var videoId = extractVideoId(url);
        if (videoId) {
            getVideoDetails(videoId, function (title) {
                playlist.push({
                    id: videoId,
                    title: title || videoId
                });
                processedUrls++;

                if (processedUrls === urls.length) {
                    updatePlaylistUI();
                    // 如果是第一個視頻，自動播放
                    if (playlist.length === 1) {
                        playYoutubeIndex(0);
                    }
                    updatePlaylistOnly();
                }
            });
        }
    });

    youtubeUrlInput.value = '';
}

// 更新播放清單 UI
function updatePlaylistUI() {
    playlistContainer.innerHTML = '';
    playlist.forEach(function (video, index) {
        var item = document.createElement('div');
        item.className = 'playlist-item' + (index === currentVideoIndex ? ' active' : '');
        item.innerHTML =
            '<div class="d-flex justify-content-between align-items-center w-100">' +
            '<span>' + (video.title || video.id) + '</span>' +
            '<div class="btn-group">' +
            '<button class="btn btn-sm btn-primary play-btn" data-index="' + index + '">' +
            '<i class="bi bi-play-fill"></i>' +
            '</button>' +
            '<button class="btn btn-sm btn-danger remove-btn" data-index="' + index + '">' +
            '<i class="bi bi-trash"></i>' +
            '</button>' +
            '</div>' +
            '</div>';

        // 添加事件監聽器
        item.querySelector('.play-btn').addEventListener('click', function () {
            playYoutubeIndex(index);
        });
        item.querySelector('.remove-btn').addEventListener('click', function () {
            removeFromPlaylist(index);
        });

        playlistContainer.appendChild(item);
    });

    // 更新按鈕狀態
    updateNavigationButtons();
}

// 播放指定索引的視頻
function playYoutubeIndex(index) {
    if (index >= 0 && index < playlist.length) {
        // 切換前記錄播放位置（若是同一支影片，切換後恢復）
        var snapshot = capturePlaybackSnapshot();
        currentVideoIndex = index;
        if (youtubePlayer && youtubePlayer.loadVideoById) {
            youtubePlayer.loadVideoById(playlist[index].id);
            setTimeout(function () {
                if (youtubePlayer && youtubePlayer.playVideo) {
                    youtubePlayer.playVideo();
                }
                setTimeout(function () {
                    syncYoutubeVolume();
                    setTimeout(function () { restorePlaybackSnapshot(snapshot); }, 200);
                }, 1000);
            }, 500);
        }
        updatePlaylistUI();
        updateRadioState();
    }
}

// 從播放清單中移除
function removeFromPlaylist(index) {
    var snapshot = capturePlaybackSnapshot();
    playlist.splice(index, 1);
    if (currentVideoIndex === index) {
        if (playlist.length > 0) {
            playYoutubeIndex(Math.min(index, playlist.length - 1));
        } else {
            currentVideoIndex = -1;
            if (youtubePlayer) {
                youtubePlayer.stopVideo();
            }
        }
    } else if (currentVideoIndex > index) {
        currentVideoIndex--;
    }
    updatePlaylistUI();
    updatePlaylistOnly();
    setTimeout(function () { restorePlaybackSnapshot(snapshot); }, 100);
}

// 清除播放清單
function clearYoutubePlaylist() {
    playlist = [];
    currentVideoIndex = -1;
    if (youtubePlayer) {
        youtubePlayer.stopVideo();
    }
    updatePlaylistUI();
    updateRadioState();
    updateNavigationButtons();

    // 清除伺服器上的播放清單
    socket.emit('clearPlaylist');
}

// 修改 onPlayerStateChange 函數
function onPlayerStateChange(event) {
    // 當視頻結束時
    if (event.data === YT.PlayerState.ENDED) {
        // 記錄當前的全螢幕狀態
        wasFullscreen = !!(document.fullscreenElement ||
            document.webkitFullscreenElement ||
            document.mozFullScreenElement ||
            document.msFullscreenElement);

        if (currentVideoIndex < playlist.length - 1) {
            playYoutubeIndex(currentVideoIndex + 1);
        } else {
            // 播放列表結束時，從頭開始播放
            playYoutubeIndex(0);
        }
    }
    // 當新視頻開始播放時
    else if (event.data === YT.PlayerState.PLAYING) {
        setTimeout(syncYoutubeVolume, 1500);

        // 如果之前是全螢幕，嘗試恢復全螢幕狀態
        if (wasFullscreen) {
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
        updateRadioState();
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

