// 全域變數
var customStations = [
    {
        name: '飛碟電台 FM92.1 UFO Radio Live Stream',
        url: 'https://stream.rcs.revma.com/em90w4aeewzuv',
        tags: ['local'],
        codec: 'MP3',
        id: 'custom_1'
      },
      {
        name: '飛揚調頻 FM89.5 Live Stream',
        url: 'https://stream.rcs.revma.com/e0tdah74hv8uv',
        tags: ['music'],
        codec: 'MP3',
        id: 'custom_2'
      },
      {
        name: '中廣流行網 I like radio FM103.3 Live Stream',
        url: 'https://stream.rcs.revma.com/aw9uqyxy2tzuv',
        tags: ['music'],
        codec: 'MP3',
        id: 'custom_3'
      },
      {
        name: '亞洲電台 FM92.7 Live Stream',
        url: 'https://stream.rcs.revma.com/xpgtqc74hv8uv',
        tags: ['music'],
        codec: 'MP3',
        id: 'custom_4'
      },
      {
        name: 'Hit FM台北之音廣播',
        url: 'https://renewed-georgeanne-nekonode-1aa70c0c.koyeb.app/fetch/?url=http://202.39.43.67:1935/live/RA000036/chunklist.m3u8',
        tags: ['music'],
        codec: 'MP3',
        id: 'custom_5'
      }
];

var currentStation = null;
var isYoutubeMode = false;
var youtubePlayer = null;
var playlist = [];
var currentVideoIndex = -1;
var socket = io('https://radio.wscc1031.synology.me');
var isDarkMode = false;

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
    
    // 請求當前狀態
    socket.emit('requestCurrentState');
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
    return tags.map(function(tag) {
        return '<span class="badge bg-' + getTagColor(tag) + ' me-1">' + tag + '</span>';
    }).join('');
}

// 設置事件監聽器
function setupEventListeners() {
    // 音量控制
    volumeSlider.addEventListener('input', function(e) {
        var volume = e.target.value;
        audioPlayer.volume = volume / 100;
        // 更新滑桿顏色
        e.target.style.setProperty('--value', volume + '%');
    });

    // 初始化滑桿顏色
    volumeSlider.style.setProperty('--value', volumeSlider.value + '%');

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
        // 顯示音量控制卡片
        controlCard.style.display = 'block';
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
            audioPlayer.src = station.url;
            audioPlayer.play();
        }
        updateRadioState();
    } catch (error) {
        console.error('播放失敗：', error);
    }
}

// 播放 HLS 流
function playHLSStream(url) {
    if (Hls.isSupported()) {
        var hls = new Hls();
        hls.loadSource(url);
        hls.attachMedia(audioPlayer);
        hls.on(Hls.Events.MANIFEST_PARSED, function() {
            audioPlayer.play();
        });
    } else if (audioPlayer.canPlayType('application/vnd.apple.mpegurl')) {
        audioPlayer.src = url;
        audioPlayer.play();
    }
}

// 更新廣播狀態
function updateRadioState() {
    var state = {
        currentStation: currentStation,
        isPlaying: !audioPlayer.paused,
        youtubeState: {
            isYoutubeMode: isYoutubeMode,
            playlist: playlist,
            currentIndex: currentVideoIndex,
            currentVideoId: currentVideoIndex >= 0 ? playlist[currentVideoIndex]?.id : null
        }
    };
    socket.emit('updateRadioState', state);
}

// 設置 Socket 監聽器
function setupSocketListeners() {
    // 添加當前狀態回應的處理
    socket.on('currentState', function(state) {
        if (state) {
            // 使用與 radioStateUpdate 相同的邏輯處理狀態
            handleStateUpdate(state);
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
    // 先檢查是否需要切換模式
    var needModeSwitch = (state.youtubeState && state.youtubeState.isYoutubeMode) !== isYoutubeMode;
    
    if (state.youtubeState && state.youtubeState.isYoutubeMode) {
        // 強制切換到 YouTube 模式
        isYoutubeMode = true;
        
        // 檢查播放清單是否被清空
        if (!state.youtubeState.playlist || state.youtubeState.playlist.length === 0) {
            playlist = [];
            currentVideoIndex = -1;
            if (youtubePlayer && youtubePlayer.stopVideo) {
                youtubePlayer.stopVideo();
            }
        } else {
            playlist = state.youtubeState.playlist || [];
            // 如果有播放清單且當前索引有效，則播放對應視頻
            if (state.youtubeState.currentIndex >= 0 && 
                state.youtubeState.currentIndex < playlist.length) {
                currentVideoIndex = state.youtubeState.currentIndex;
                if (youtubePlayer && youtubePlayer.loadVideoById) {
                    youtubePlayer.loadVideoById({
                        videoId: playlist[currentVideoIndex].id,
                        startSeconds: undefined,
                        suggestedQuality: 'default'
                    });
                } else {
                    // 如果播放器還沒準備好，等待它準備好
                    var checkPlayerInterval = setInterval(function() {
                        if (youtubePlayer && youtubePlayer.loadVideoById) {
                            youtubePlayer.loadVideoById({
                                videoId: playlist[currentVideoIndex].id,
                                startSeconds: undefined,
                                suggestedQuality: 'default'
                            });
                            clearInterval(checkPlayerInterval);
                        }
                    }, 1000);
                }
            }
        }
        
        // 強制更新 UI 狀態
        controlCard.style.display = 'none';
        youtubeSection.style.display = 'block';
        currentStationName.textContent = 'YouTube 播放器';
        
        // 停止音頻播放
        if (audioPlayer) {
            audioPlayer.pause();
            audioPlayer.src = '';
        }
        
        updatePlaylistUI();
        updateNavigationButtons();
    } else if (state.currentStation) {
        // 強制切換到電台模式
        isYoutubeMode = false;
        
        // 強制停止 YouTube 播放
        if (youtubePlayer && youtubePlayer.stopVideo) {
            youtubePlayer.stopVideo();
        }
        
        // 強制更新 UI 狀態
        controlCard.style.display = 'block';
        youtubeSection.style.display = 'none';
        
        // 無條件切換電台
        currentStation = state.currentStation;
        currentStationName.textContent = state.currentStation.name;
        
        // 更新電台播放狀態
        if (audioPlayer) {
            if (state.currentStation.url.endsWith('m3u8')) {
                playHLSStream(state.currentStation.url);
            } else {
                audioPlayer.src = state.currentStation.url;
                audioPlayer.play();
            }
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
    // 如果有待播放的視頻，立即播放
    if (currentVideoIndex !== -1 && playlist[currentVideoIndex]) {
        event.target.loadVideoById(playlist[currentVideoIndex].id);
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
    if (audioPlayer) {
        audioPlayer.pause();
        audioPlayer.src = '';
    }
    
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

    // 如果有正在播放的視頻，確保它可見
    if (currentVideoIndex !== -1 && youtubePlayer && youtubePlayer.loadVideoById) {
        youtubePlayer.loadVideoById(playlist[currentVideoIndex].id);
    }

    updatePlaylistUI();
    updateNavigationButtons();
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
            youtubePlayer.loadVideoById(playlist[index].id);
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
}

// YouTube 播放器狀態改變事件
function onPlayerStateChange(event) {
    // 當視頻結束時
    if (event.data === YT.PlayerState.ENDED) {
        if (currentVideoIndex < playlist.length - 1) {
            playYoutubeIndex(currentVideoIndex + 1);
        } else {
            // 播放列表結束
            currentVideoIndex = -1;
            updatePlaylistUI();
            updateRadioState();
        }
    }
    // 當視頻開始播放時
    else if (event.data === YT.PlayerState.PLAYING) {
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

// 在文檔加載完成後初始化
document.addEventListener('DOMContentLoaded', init);