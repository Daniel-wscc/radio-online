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
var socket = io('https://test.wscc1031.synology.me');
var isDarkMode = false;

// 添加全域變數追蹤全螢幕狀態
var wasFullscreen = false;

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
    
    // 監聽連接事件
    socket.on('connect', function() {
        console.log('已連接到伺服器，請求當前狀態');
        socket.emit('requestCurrentState');
    });
}

// 載入電台列表
function loadStations() {
    var stationsHtml = '';
    customStations.forEach(function(station) {
        stationsHtml += createStationElement(station);
    });
    stationList.innerHTML = stationsHtml;
}

// 創建電台元素
function createStationElement(station) {
    return  '<div class="list-group-item station-item" data-station-id="' + station.id + '">' +
            '<div class="station-name">' + station.name + '</div>' +
            '<div class="station-tags">' +
            createTagsHtml(station.tags) +
            '</div>' +
            '</div>';
}

// 創建標籤 HTML
function createTagsHtml(tags) {
    if (!tags) return '';
    return tags.map(function(tag) {
        return '<span class="badge bg-' + getTagColor(tag) + ' me-1">' + tag + '</span>';
    }).join('');
}

// 設置事件監聽器
// 音量防抖變數
var volumeDebounceTimer = null;
var volumeDebounceDelay = 300; // 300ms 防抖延遲

function setupEventListeners() {
    // 音量控制
    volumeSlider.addEventListener('input', function(e) {
        var volume = e.target.value / 10; // 改為 0-10 範圍，除以 10 得到 0-1

        // YouTube模式下使用YouTube API控制音量
        if (isYoutubeMode && youtubePlayer && typeof youtubePlayer.setVolume === 'function') {
            try {
                youtubePlayer.setVolume(volume * 100);
                if (volume === 0) {
                    youtubePlayer.mute();
                } else {
                    youtubePlayer.unMute();
                }
                console.log('設置YouTube音量:', volume * 100, '靜音:', volume === 0);
            } catch (error) {
                console.error('設置YouTube音量失敗:', error);
            }
        }
        // Video.js播放器
        else if (window.videoPlayer) {
            window.videoPlayer.volume(volume);
            // 確保當音量為 0 時完全靜音
            window.videoPlayer.muted(volume === 0);
        }
        // 普通音頻播放器
        else {
            audioPlayer.volume = volume;
            // 確保當音量為 0 時完全靜音
            audioPlayer.muted = volume === 0;
        }

        // 更新滑桿顏色（將 0-10 的值轉換為 0-100 的百分比）
        e.target.style.setProperty('--value', (e.target.value * 10) + '%');
        
        // 使用防抖機制發送音量更新到伺服器
        if (volumeDebounceTimer) {
            clearTimeout(volumeDebounceTimer);
        }
        volumeDebounceTimer = setTimeout(function() {
            updateRadioState();
        }, volumeDebounceDelay);
    });

    // 初始化滑桿顏色（將 0-10 的值轉換為 0-100 的百分比）
    volumeSlider.style.setProperty('--value', (volumeSlider.value * 10) + '%');

    // 電台選擇
    stationList.addEventListener('click', function(e) {
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
    prevButton.addEventListener('click', function() {
        if (currentVideoIndex > 0) {
            playYoutubeIndex(currentVideoIndex - 1);
        }
    });

    // 下一首按鈕
    nextButton.addEventListener('click', function() {
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
    return customStations.find(function(station) {
        return station.id === id;
    });
}

// 播放電台
function playStation(station) {
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
    if (window.videoPlayer) {
        try {
            window.videoPlayer.pause();
            window.videoPlayer.dispose();
            window.videoPlayer = null;
        } catch (e) {
            console.log('停止舊播放器時發生錯誤:', e);
        }
    }
    if (audioPlayer) {
        audioPlayer.pause();
        audioPlayer.src = '';
    }

    currentStation = station;
    currentStationName.textContent = station.name;
    
    // 更新活動狀態
    var allStations = document.querySelectorAll('.station-item');
    allStations.forEach(function(item) {
        item.classList.remove('active');
        if (item.dataset.stationId === station.id) {
            item.classList.add('active');
        }
    });

    // 播放音頻
    try {
        if (station.url.endsWith('m3u8')) {
            playHLSStream(station.url);
        } else {
            // 如果存在 video.js 實例,先銷毀
            if (window.videoPlayer) {
                window.videoPlayer.dispose();
                // 重新創建 audio 元素，設置 controls 為 false
                const audioElement = document.createElement('audio');
                audioElement.id = 'audioPlayer';
                audioElement.controls = false; // 關閉控制項顯示
                document.getElementById('controlCard').querySelector('.card-body').appendChild(audioElement);
                audioPlayer = audioElement;
            }
            audioPlayer.src = station.url;
            // 設置音量
            const currentVolume = volumeSlider.value / 10;
            audioPlayer.volume = currentVolume;
            audioPlayer.muted = currentVolume === 0;
            audioPlayer.play();
        }
        updateRadioState();
    } catch (error) {
        console.error('播放失敗：', error);
    }
}

// 播放 HLS 流
function playHLSStream(url) {
    try {
        // 如果存在舊的 hls 實例，先銷毀它
        if (window.hls) {
            window.hls.destroy();
            window.hls = null;
        }

        // 檢查並獲取控制卡片元素
        const controlCard = document.getElementById('controlCard');
        if (!controlCard) {
            throw new Error('找不到控制卡片元素');
        }

        // 創建新的 audio 元素
        const audioElement = document.createElement('audio');
        audioElement.id = 'audioPlayer';
        audioElement.style.width = '300px';
        audioElement.style.height = '30px';
        audioElement.crossOrigin = 'anonymous';
        audioElement.controls = false;
        
        // 找到原始的 audioPlayer 元素並替換
        const oldPlayer = document.getElementById('audioPlayer');
        if (oldPlayer && oldPlayer.parentNode) {
            oldPlayer.parentNode.replaceChild(audioElement, oldPlayer);
        } else {
            // 如果找不到舊的播放器，直接將新元素添加到控制卡片中
            const cardBody = controlCard.querySelector('.card-body');
            if (cardBody) {
                cardBody.insertBefore(audioElement, cardBody.firstChild);
            } else {
                throw new Error('找不到控制卡片內容區域');
            }
        }

        // 設置初始音量
        const currentVolume = volumeSlider.value / 10;
        audioElement.volume = currentVolume;
        audioElement.muted = currentVolume === 0;

        // 檢查瀏覽器是否支援 HLS
        if (Hls.isSupported()) {
            window.hls = new Hls();

            // 綁定 HLS 事件
            window.hls.on(Hls.Events.MEDIA_ATTACHED, function () {
                console.log('HLS 媒體已附加');
                window.hls.loadSource(url);
            });

            window.hls.on(Hls.Events.MANIFEST_PARSED, function () {
                console.log('HLS 清單已解析');
                audioElement.play();
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
            window.hls.attachMedia(audioElement);
        }
        // 對於原生支援 HLS 的瀏覽器（如 Safari）
        else if (audioElement.canPlayType('application/vnd.apple.mpegurl')) {
            audioElement.src = url;
            audioElement.addEventListener('loadedmetadata', function() {
                audioElement.play();
            });
        }
        
    } catch (error) {
        console.error('HLS 串流初始化失敗:', error);
    }
}

// 更新廣播狀態
function updateRadioState() {
    // 獲取當前音量值
    var currentVolume = volumeSlider.value / 10; // 從滑桿值計算音量
    
    var state = {
        currentStation: currentStation,
        isPlaying: !audioPlayer.paused,
        volume: currentVolume,
        youtubeState: {
            isYoutubeMode: isYoutubeMode,
            playlist: playlist,
            currentIndex: currentVideoIndex,
            currentVideoId: currentVideoIndex >= 0 ? playlist[currentVideoIndex]?.id : null
        }
    };
    
    // 避免無限循環：只有當播放清單有變化時才發送
    var currentPlaylistJson = JSON.stringify(playlist);
    if (currentPlaylistJson !== lastPlaylistJson) {
        lastPlaylistJson = currentPlaylistJson;
        socket.emit('updateRadioState', state);
        
        // 只有當播放清單不為空時才發送 addPlaylist
        if (isYoutubeMode && playlist.length > 0 && !isLoadingPlaylist) {
            socket.emit('addPlaylist', playlist);
        }
    } else {
        // 如果播放清單沒有變化，只發送狀態更新，不發送 addPlaylist
        socket.emit('updateRadioState', state);
    }
}

// 設置 Socket 監聽器
function setupSocketListeners() {
    socket.on('currentState', function(state) {
        if (state) {
            console.log('收到初始狀態:', state);
            // 強制設置初始播放
            if (state.currentStation && state.isPlaying) {
                handleInitialState(state);
            } else {
                handleStateUpdate(state);
            }
        }
    });

    socket.on('radioStateUpdate', function(state) {
        console.log('收到狀態更新:', state);
        handleStateUpdate(state);
    });

    socket.on('onlineUsers', function(count) {
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
        // 更新滑桿值和樣式（新的範圍是 0-10）
        volumeSlider.value = state.volume * 10;
        volumeSlider.style.setProperty('--value', (volumeSlider.value * 10) + '%');

        // 更新播放器音量，但不中斷播放
        if (isYoutubeMode && youtubePlayer && typeof youtubePlayer.setVolume === 'function') {
            try {
                youtubePlayer.setVolume(state.volume * 100);
                if (state.volume === 0) {
                    youtubePlayer.mute();
                } else {
                    youtubePlayer.unMute();
                }
                console.log('同步YouTube音量:', state.volume * 100, '靜音:', state.volume === 0);
            } catch (error) {
                console.error('同步YouTube音量失敗:', error);
            }
        } else if (window.videoPlayer) {
            window.videoPlayer.volume(state.volume);
            window.videoPlayer.muted(state.volume === 0);
        } else {
            const audioElement = document.getElementById('audioPlayer');
            if (audioElement) {
                audioElement.volume = state.volume;
                audioElement.muted = state.volume === 0;
            }
        }
    }

    if (incomingYoutubeMode) {
        // 強制切換到 YouTube 模式
        isYoutubeMode = true;
        
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
            var oldVideoId = currentVideoIndex >= 0 ? playlist[currentVideoIndex]?.id : null;
            var newVideoId = state.youtubeState.playlist[state.youtubeState.currentIndex]?.id;

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

            if (youtubePlayer && youtubePlayer.loadVideoById && newVideoId && shouldLoadVideo) {
                console.log('遠端載入新影片:', newVideoId, '原因:', {
                    needModeSwitch: needModeSwitch,
                    videoChanged: oldVideoId !== newVideoId,
                    playerState: youtubePlayer.getPlayerState ? youtubePlayer.getPlayerState() : 'unknown'
                });
                youtubePlayer.loadVideoById({
                    videoId: newVideoId,
                    startSeconds: undefined,
                    suggestedQuality: 'default'
                });
                // 載入後自動播放
                setTimeout(function() {
                    if (youtubePlayer && youtubePlayer.playVideo) {
                        youtubePlayer.playVideo();
                    }
                }, 1000);
            } else if (youtubePlayer && newVideoId && youtubePlayer.getPlayerState &&
                      youtubePlayer.getPlayerState() === YT.PlayerState.CUED) {
                // 如果影片已經載入但沒有播放，直接播放
                console.log('影片已載入，直接播放:', newVideoId);
                setTimeout(function() {
                    if (youtubePlayer && youtubePlayer.playVideo) {
                        youtubePlayer.playVideo();
                    }
                }, 500);
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
            if (window.videoPlayer) {
                try {
                    window.videoPlayer.pause();
                    window.videoPlayer.dispose();
                    window.videoPlayer = null;
                } catch (e) {
                    console.log('停止舊播放器時發生錯誤:', e);
                }
            }
            if (audioPlayer) {
                audioPlayer.pause();
                audioPlayer.src = '';
            }

            currentStation = state.currentStation;
            currentStationName.textContent = state.currentStation.name;

            // 更新音源並播放
            if (state.currentStation.url.endsWith('m3u8')) {
                playHLSStream(state.currentStation.url);
            } else {
                // 確保創建新的 audio 元素
                const audioElement = document.createElement('audio');
                audioElement.id = 'audioPlayer';
                audioElement.controls = true;
                const oldPlayer = document.getElementById('audioPlayer');
                if (oldPlayer) {
                    oldPlayer.parentNode.replaceChild(audioElement, oldPlayer);
                }
                audioPlayer = audioElement;

                audioPlayer.src = state.currentStation.url;
                // 設定音量
                const currentVolume = volumeSlider.value / 10;
                audioPlayer.volume = currentVolume;
                audioPlayer.muted = currentVolume === 0;
                if (state.isPlaying) {
                    audioPlayer.play().catch(function(error) {
                        console.log('遠端切換電台播放失敗:', error);
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
        allStations.forEach(function(item) {
            item.classList.remove('active');
            if (item.dataset.stationId === state.currentStation.id) {
                item.classList.add('active');
            }
        });
    }
}

// 新增處理初始狀態的函數
function handleInitialState(state) {
    // 設置音量
    if (state.volume !== undefined && !isNaN(state.volume)) {
        audioPlayer.volume = state.volume;
        volumeSlider.value = state.volume * 10;
        volumeSlider.style.setProperty('--value', (volumeSlider.value * 10) + '%');
    }

    // 處理初始電台
    if (state.currentStation) {
        currentStation = state.currentStation;
        currentStationName.textContent = state.currentStation.name;
        
        // 更新電台列表選中狀態
        var allStations = document.querySelectorAll('.station-item');
        allStations.forEach(function(item) {
            item.classList.remove('active');
            if (item.dataset.stationId === state.currentStation.id) {
                item.classList.add('active');
            }
        });

        // 設置音源並自動播放
        if (state.currentStation.url.endsWith('m3u8')) {
            playHLSStream(state.currentStation.url);
        } else {
            audioPlayer.src = state.currentStation.url;
            audioPlayer.play().catch(function(error) {
                console.log('初始播放失敗:', error);
            });
        }
    }

    // 處理 YouTube 模式
    if (state.youtubeState && state.youtubeState.isYoutubeMode) {
        isYoutubeMode = true;
        controlCard.style.display = 'none';
        youtubeSection.style.display = 'block';
        // ... 其他 YouTube 相關邏輯 ...
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

// 確保 YouTube API 正確載入
function loadYouTubeAPI() {
    // 只有在 YouTube API 尚未載入時才載入
    if (!window.YT) {
        var tag = document.createElement('script');
        tag.src = "https://www.youtube.com/iframe_api";
        var firstScriptTag = document.getElementsByTagName('script')[0];
        firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
    }
}

// YouTube API 準備就緒時的回調
function onYouTubeIframeAPIReady() {
    console.log('YouTube API Ready');
    // 若 youtubePlayer 已存在，先銷毀
    if (youtubePlayer && typeof youtubePlayer.destroy === 'function') {
        youtubePlayer.destroy();
        youtubePlayer = null;
    }
    // 確保 DOM 存在再初始化
    var playerDiv = document.getElementById('youtubePlayer');
    if (!playerDiv) {
        playerDiv = document.createElement('div');
        playerDiv.id = 'youtubePlayer';
        playerDiv.style.width = '100%';
        playerDiv.style.height = '360px';
        var youtubeSection = document.getElementById('youtubeSection');
        if (youtubeSection) youtubeSection.appendChild(playerDiv);
    }
    youtubePlayer = new YT.Player('youtubePlayer', {
        playerVars: {
            'playsinline': 1,
            'origin': window.location.origin,
            'enablejsapi': 1,
            'rel': 0
        },
        events: {
            'onReady': onPlayerReady,
            'onStateChange': onPlayerStateChange
        }
    });
}

// 播放器準備就緒的回調
function onPlayerReady(event) {
    console.log('Player Ready');

    // 設置初始音量
    try {
        var currentVolume = volumeSlider.value / 10;
        event.target.setVolume(currentVolume * 100);
        if (currentVolume === 0) {
            event.target.mute();
        }
        console.log('設置YouTube播放器音量:', currentVolume * 100, '靜音:', currentVolume === 0);
    } catch (error) {
        console.error('設置初始音量失敗:', error);
    }

    // 如果有待播放的視頻，立即播放
    if (currentVideoIndex !== -1 && playlist[currentVideoIndex]) {
        console.log('開始播放影片:', playlist[currentVideoIndex].id);
        // 使用 setTimeout 確保播放器完全初始化後再播放
        setTimeout(function() {
            try {
                event.target.loadVideoById(playlist[currentVideoIndex].id);
                // 載入後自動播放
                setTimeout(function() {
                    event.target.playVideo();
                    // 再次確保音量設置正確
                    try {
                        var currentVolume = volumeSlider.value / 10;
                        if (event.target && typeof event.target.setVolume === 'function') {
                            event.target.setVolume(currentVolume * 100);
                            if (currentVolume === 0) {
                                event.target.mute();
                            } else {
                                event.target.unMute();
                            }
                            console.log('播放器初始化後再次設置音量:', currentVolume * 100, '靜音:', currentVolume === 0);
                        }
                    } catch (error) {
                        console.error('播放器初始化後設置音量失敗:', error);
                    }
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

    youtubeBtn.addEventListener('click', function() {
        switchToYoutube();
    });

    // 添加到播放清單按鈕
    addToPlaylistBtn.addEventListener('click', function() {
        loadYoutubePlaylist();
    });

    // 清除播放清單按鈕
    clearPlaylistBtn.addEventListener('click', function() {
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

    // 若 youtubePlayer 已存在，先銷毀
    if (youtubePlayer && typeof youtubePlayer.destroy === 'function') {
        youtubePlayer.destroy();
        youtubePlayer = null;
    }
    
    // 確保 youtubePlayer DOM 存在
    if (!document.getElementById('youtubePlayer')) {
        var playerDiv = document.createElement('div');
        playerDiv.id = 'youtubePlayer';
        playerDiv.style.width = '100%';
        playerDiv.style.height = '360px';
        youtubeSection.appendChild(playerDiv);
    }

    // 確保 YT API 載入且播放器已初始化
    function ensureYoutubePlayerReady() {
        if (window.YT && YT.Player && (!youtubePlayer || typeof youtubePlayer.loadVideoById !== 'function')) {
            youtubePlayer = new YT.Player('youtubePlayer', {
                playerVars: {
                    'playsinline': 1,
                    'origin': window.location.origin,
                    'enablejsapi': 1,
                    'rel': 0
                },
                events: {
                    'onReady': onPlayerReady,
                    'onStateChange': onPlayerStateChange
                }
            });
        } else if (!window.YT || !YT.Player) {
            // 若 API 尚未載入，稍後重試
            setTimeout(ensureYoutubePlayerReady, 300);
        }
    }
    ensureYoutubePlayerReady();

    // 隱藏音量控制卡片
    controlCard.style.display = 'none';
    youtubeSection.style.display = 'block';
    currentStationName.textContent = 'YouTube 播放器';
    
    // 更新活動狀態
    var allStations = document.querySelectorAll('.station-item');
    allStations.forEach(function(item) {
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
        setTimeout(function() {
            isLoadingPlaylist = false;
        }, 1000);
    }
}

// 載入 YouTube 播放清單
function loadYoutubePlaylist() {
    var urls = youtubeUrlInput.value.split('\n').filter(function(url) {
        return url.trim() !== '';
    });

    var processedUrls = 0;
    urls.forEach(function(url) {
        var videoId = extractVideoId(url);
        if (videoId) {
            getVideoDetails(videoId, function(title) {
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
                    updateRadioState();
                }
            });
        }
    });

    youtubeUrlInput.value = '';
}

// 更新播放清單 UI
function updatePlaylistUI() {
    playlistContainer.innerHTML = '';
    playlist.forEach(function(video, index) {
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
        item.querySelector('.play-btn').addEventListener('click', function() {
            playYoutubeIndex(index);
        });
        item.querySelector('.remove-btn').addEventListener('click', function() {
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
        currentVideoIndex = index;
        if (youtubePlayer && youtubePlayer.loadVideoById) {
            console.log('播放影片索引:', index, '影片ID:', playlist[index].id);
            youtubePlayer.loadVideoById(playlist[index].id);
            // 載入後自動播放
            setTimeout(function() {
                if (youtubePlayer && youtubePlayer.playVideo) {
                    youtubePlayer.playVideo();
                }
                // 確保音量設置正確
                try {
                    var currentVolume = volumeSlider.value / 10;
                    if (youtubePlayer && typeof youtubePlayer.setVolume === 'function') {
                        youtubePlayer.setVolume(currentVolume * 100);
                        if (currentVolume === 0) {
                            youtubePlayer.mute();
                        } else {
                            youtubePlayer.unMute();
                        }
                        console.log('手動切換影片時設置音量:', currentVolume * 100, '靜音:', currentVolume === 0);
                    }
                } catch (error) {
                    console.error('設置手動切換影片音量失敗:', error);
                }
            }, 500);
        }
        updatePlaylistUI();
        updateRadioState();
    }
}

// 從播放清單中移除
function removeFromPlaylist(index) {
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
    updateRadioState();
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
        // 確保音量設置正確
        try {
            var currentVolume = volumeSlider.value / 10;
            if (youtubePlayer && typeof youtubePlayer.setVolume === 'function') {
                youtubePlayer.setVolume(currentVolume * 100);
                if (currentVolume === 0) {
                    youtubePlayer.mute();
                } else {
                    youtubePlayer.unMute();
                }
                console.log('新影片播放時設置音量:', currentVolume * 100, '靜音:', currentVolume === 0);
            }
        } catch (error) {
            console.error('設置新影片音量失敗:', error);
        }
        
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
        .then(function(response) { return response.json(); })
        .then(function(data) {
            callback(data.title);
        })
        .catch(function() {
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

// 在文檔加載完成後初始化
document.addEventListener('DOMContentLoaded', init);

// 添加一個變數來追蹤是否正在載入播放清單
var isLoadingPlaylist = false;
var lastPlaylistJson = '';

// 監聽從伺服器載入的播放清單
socket.on('playlistLoaded', function(data) {
    if (Array.isArray(data) && !isLoadingPlaylist) {
        isLoadingPlaylist = true;
        
        // 將從伺服器載入的播放清單轉換為正確的格式
        var newPlaylist = data.map(function(item) {
            return {
                id: item.videoId,
                title: item.title || item.videoId
            };
        });
        
        // 只有當播放清單有變化時才更新
        var newPlaylistJson = JSON.stringify(newPlaylist);
        if (newPlaylistJson !== lastPlaylistJson) {
            playlist = newPlaylist;
            lastPlaylistJson = newPlaylistJson;
            
            // 如果目前沒有播放任何影片且播放清單不為空，開始播放第一首
            if (currentVideoIndex === -1 && playlist.length > 0) {
                playYoutubeIndex(0);
            } else {
                updatePlaylistUI();
                updateNavigationButtons();
            }
        }
        
        setTimeout(function() {
            isLoadingPlaylist = false;
        }, 1000);
    }
});

// 監聽播放清單清除事件
socket.on('playlistCleared', function(data) {
    if (data.success) {
        console.log('伺服器已清除播放清單');
        // 本地也清除播放清單
        playlist = [];
        currentVideoIndex = -1;
        lastPlaylistJson = JSON.stringify(playlist);
        
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
