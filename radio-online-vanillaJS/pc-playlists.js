/* 電腦版「我的播放清單」。使用伺服器既有的播放清單事件，電視不載入這支檔案。 */
(function () {
    'use strict';
    if (window.isTv) return;

    var savedPlaylistsOn = !!(window.RADIO_CONFIG && window.RADIO_CONFIG.features && window.RADIO_CONFIG.features.savedPlaylists);
    var app = document.getElementById('playlistApp');
    var managerView = document.getElementById('playlistManager');
    var detailView = document.getElementById('playlistDetail');
    var openButton = document.getElementById('openPlaylistsButton');
    var modal = document.getElementById('addToPlaylistModal');
    var modalSong = document.getElementById('addModalSong');
    var modalList = document.getElementById('addModalList');
    var toastHost = document.getElementById('toastHost');

    var playlists = [];
    var detail = null;
    var detailItems = [];
    var loading = false;
    var selectedVideo = null;
    var pendingAdds = 0;
    var successfulAdds = 0;
    var failedAdds = 0;

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function formatDate(timestamp) {
        var date = new Date(timestamp);
        if (isNaN(date.getTime())) return '';
        try {
            return date.toLocaleString('zh-TW', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            });
        } catch (error) {
            return date.toISOString();
        }
    }

    function showToast(message, type) {
        if (!toastHost) return;
        var el = document.createElement('div');
        el.className = 'app-toast app-toast-' + (type || 'info');
        el.textContent = message;
        toastHost.appendChild(el);
        setTimeout(function () {
            if (el.parentNode) el.parentNode.removeChild(el);
        }, 3500);
    }

    function showManager() {
        if (detailView) detailView.hidden = true;
        if (managerView) managerView.hidden = false;
        renderManager();
    }

    function showDetail() {
        if (managerView) managerView.hidden = true;
        if (detailView) detailView.hidden = false;
        renderDetail();
    }

    function openApp() {
        if (!savedPlaylistsOn || !app) return;
        app.hidden = false;
        loading = true;
        showManager();
        if (typeof socket !== 'undefined') socket.emit('getPlaylists');
    }

    function closeApp() {
        if (app) app.hidden = true;
    }

    function renderManager() {
        if (!managerView) return;
        var cards = '';
        var i;
        for (i = 0; i < playlists.length; i++) {
            var item = playlists[i];
            cards += '<div class="col-12 col-md-6 col-xl-4">' +
                '<div class="card h-100 playlist-card" data-open-id="' + escapeHtml(item.id) + '">' +
                '<div class="card-body">' +
                '<h3 class="h5">' + escapeHtml(item.name) + '</h3>' +
                (item.description ? '<p class="text-muted">' + escapeHtml(item.description) + '</p>' : '') +
                '<div class="small text-muted">更新於 ' + escapeHtml(formatDate(item.updatedAt)) + '</div>' +
                '</div>' +
                '<div class="card-footer bg-transparent">' +
                '<button type="button" class="btn btn-sm btn-outline-danger" data-delete-id="' + escapeHtml(item.id) + '">刪除</button>' +
                '</div></div></div>';
        }
        if (!cards && !loading) {
            cards = '<div class="col-12 text-center py-5"><h3 class="h5">還沒有播放清單</h3><p class="text-muted">建立第一個播放清單來收藏歌曲</p></div>';
        }
        if (loading && !playlists.length) {
            cards = '<div class="col-12 text-center py-5">載入中...</div>';
        }
        managerView.innerHTML =
            '<div class="playlist-toolbar d-flex justify-content-between align-items-center flex-wrap gap-2">' +
            '<button type="button" class="btn btn-outline-secondary" id="closePlaylistsButton">返回電台</button>' +
            '<h2 class="h4 mb-0">我的播放清單</h2>' +
            '<span></span></div>' +
            '<form id="createPlaylistForm" class="card my-3"><div class="card-body">' +
            '<h3 class="h5">建立播放清單</h3>' +
            '<div class="mb-2"><label class="form-label" for="newPlaylistName">名稱</label>' +
            '<input id="newPlaylistName" class="form-control" maxlength="100" required></div>' +
            '<div class="mb-3"><label class="form-label" for="newPlaylistDescription">描述（選填）</label>' +
            '<textarea id="newPlaylistDescription" class="form-control" rows="2" maxlength="500"></textarea></div>' +
            '<button class="btn btn-primary" type="submit">建立</button>' +
            '</div></form>' +
            '<div class="row g-3">' + cards + '</div>';
        bindManager();
    }

    function bindManager() {
        var close = document.getElementById('closePlaylistsButton');
        if (close) close.addEventListener('click', closeApp);
        var form = document.getElementById('createPlaylistForm');
        if (form) {
            form.addEventListener('submit', function (event) {
                event.preventDefault();
                var nameInput = document.getElementById('newPlaylistName');
                var descInput = document.getElementById('newPlaylistDescription');
                var name = nameInput ? String(nameInput.value).replace(/^\s+|\s+$/g, '') : '';
                if (!name) {
                    showToast('請輸入播放清單名稱', 'error');
                    return;
                }
                socket.emit('createPlaylist', {
                    name: name,
                    description: descInput ? String(descInput.value).replace(/^\s+|\s+$/g, '') : ''
                });
            });
        }
        var openers = managerView.querySelectorAll('[data-open-id]');
        var d;
        for (d = 0; d < openers.length; d++) {
            openers[d].addEventListener('click', function (event) {
                if (event.target.closest && event.target.closest('[data-delete-id]')) return;
                openDetail(this.getAttribute('data-open-id'));
            });
        }
        var deleters = managerView.querySelectorAll('[data-delete-id]');
        for (d = 0; d < deleters.length; d++) {
            deleters[d].addEventListener('click', function (event) {
                event.stopPropagation();
                var id = Number(this.getAttribute('data-delete-id'));
                var found = null;
                var n;
                for (n = 0; n < playlists.length; n++) {
                    if (Number(playlists[n].id) === id) found = playlists[n];
                }
                var label = found ? found.name : '這個播放清單';
                if (window.confirm('確定要刪除播放清單「' + label + '」嗎？此操作無法復原。')) {
                    socket.emit('deletePlaylist', id);
                }
            });
        }
    }

    function openDetail(id) {
        loading = true;
        detail = null;
        detailItems = [];
        showDetail();
        socket.emit('getPlaylistDetail', Number(id));
    }

    function renderDetail() {
        if (!detailView) return;
        if (loading) {
            detailView.innerHTML = '<div class="p-4">載入中...</div>';
            return;
        }
        if (!detail) {
            detailView.innerHTML = '<div class="p-4">找不到播放清單</div>';
            return;
        }
        var rows = '';
        var i;
        for (i = 0; i < detailItems.length; i++) {
            var item = detailItems[i];
            rows += '<div class="playlist-detail-row">' +
                '<img alt="" src="https://img.youtube.com/vi/' + encodeURIComponent(item.videoId) + '/default.jpg">' +
                '<div class="flex-grow-1">' +
                '<div class="fw-semibold">' + escapeHtml(item.title || item.videoId) + '</div>' +
                '<div class="small text-muted">' + escapeHtml(formatDate(item.addedAt)) + '</div>' +
                '</div>' +
                '<button type="button" class="btn btn-sm btn-outline-primary" data-queue-id="' + escapeHtml(item.id) + '">加入佇列</button>' +
                '<button type="button" class="btn btn-sm btn-outline-danger" data-remove-item="' + escapeHtml(item.id) + '">移除</button>' +
                '</div>';
        }
        if (!rows) rows = '<p class="text-muted">播放清單是空的</p>';
        detailView.innerHTML =
            '<div class="playlist-toolbar d-flex justify-content-between align-items-center flex-wrap gap-2">' +
            '<button type="button" class="btn btn-outline-secondary" id="backToPlaylists">返回清單</button>' +
            '<h2 class="h4 mb-0">' + escapeHtml(detail.name) + '</h2>' +
            '<button type="button" class="btn btn-primary" id="queueAllSongs"' + (detailItems.length ? '' : ' disabled') + '>全部加入佇列</button>' +
            '</div>' +
            '<p class="text-muted">' + escapeHtml(detail.description || '') + '　' + detailItems.length + ' 首歌曲</p>' +
            '<form id="addSongsForm" class="card mb-3"><div class="card-body">' +
            '<label class="form-label" for="savedPlaylistUrls">新增 YouTube 網址（每行一個）</label>' +
            '<textarea id="savedPlaylistUrls" class="form-control mb-2" rows="4"></textarea>' +
            '<button class="btn btn-primary" type="submit">新增歌曲</button>' +
            '</div></form>' +
            '<div>' + rows + '</div>';
        bindDetail();
    }

    function bindDetail() {
        var back = document.getElementById('backToPlaylists');
        if (back) {
            back.addEventListener('click', function () {
                showManager();
                socket.emit('getPlaylists');
            });
        }
        var queueAll = document.getElementById('queueAllSongs');
        if (queueAll) {
            queueAll.addEventListener('click', function () {
                if (!detailItems.length) return;
                /* 伺服器的 addPlaylist 會整份覆寫目前播放佇列，與 Angular 相同。 */
                var queue = [];
                var i;
                for (i = 0; i < detailItems.length; i++) {
                    queue.push({ id: detailItems[i].videoId, title: detailItems[i].title || detailItems[i].videoId });
                }
                socket.emit('addPlaylist', queue);
            });
        }
        var form = document.getElementById('addSongsForm');
        if (form) {
            form.addEventListener('submit', function (event) {
                event.preventDefault();
                addSongsFromText();
            });
        }
        var queueButtons = detailView.querySelectorAll('[data-queue-id]');
        var n;
        for (n = 0; n < queueButtons.length; n++) {
            queueButtons[n].addEventListener('click', function () {
                var id = Number(this.getAttribute('data-queue-id'));
                var item = findItem(id);
                if (!item) return;
                socket.emit('addPlaylist', [{ id: item.videoId, title: item.title || item.videoId }]);
            });
        }
        var removeButtons = detailView.querySelectorAll('[data-remove-item]');
        for (n = 0; n < removeButtons.length; n++) {
            removeButtons[n].addEventListener('click', function () {
                var id = Number(this.getAttribute('data-remove-item'));
                var item = findItem(id);
                var label = item ? (item.title || item.videoId) : '這首歌曲';
                if (window.confirm('確定要從播放清單中移除「' + label + '」嗎？')) {
                    socket.emit('removeSongFromPlaylist', { playlistId: detail.id, itemId: id });
                }
            });
        }
    }

    function findItem(id) {
        var i;
        for (i = 0; i < detailItems.length; i++) {
            if (Number(detailItems[i].id) === Number(id)) return detailItems[i];
        }
        return null;
    }

    function addSongsFromText() {
        var field = document.getElementById('savedPlaylistUrls');
        var raw = field ? field.value : '';
        var lines = String(raw).split('\n');
        var ids = [];
        var i;
        for (i = 0; i < lines.length; i++) {
            var videoId = typeof extractVideoId === 'function' ? extractVideoId(lines[i]) : null;
            if (videoId) ids.push(videoId);
        }
        if (!ids.length) {
            showToast('沒有找到有效的 YouTube 網址', 'error');
            return;
        }
        pendingAdds = ids.length;
        successfulAdds = 0;
        failedAdds = 0;
        ids.forEach(function (videoId) {
            if (typeof getVideoDetails === 'function') {
                getVideoDetails(videoId, function (title) {
                    socket.emit('addSongToPlaylist', {
                        playlistId: detail.id,
                        videoId: videoId,
                        title: title || videoId
                    });
                });
            } else {
                socket.emit('addSongToPlaylist', { playlistId: detail.id, videoId: videoId, title: videoId });
            }
        });
        if (field) field.value = '';
    }

    function renderAddModal() {
        if (!modalList) return;
        if (!playlists.length) {
            modalList.innerHTML = '<p class="text-muted">還沒有播放清單</p>';
            return;
        }
        var html = '';
        var i;
        for (i = 0; i < playlists.length; i++) {
            html += '<button type="button" class="list-group-item list-group-item-action" data-target-playlist="' +
                escapeHtml(playlists[i].id) + '">' + escapeHtml(playlists[i].name) + '</button>';
        }
        modalList.innerHTML = '<div class="list-group">' + html + '</div>';
        var buttons = modalList.querySelectorAll('[data-target-playlist]');
        var n;
        for (n = 0; n < buttons.length; n++) {
            buttons[n].addEventListener('click', function () {
                if (!selectedVideo) return;
                socket.emit('addSongToPlaylist', {
                    playlistId: Number(this.getAttribute('data-target-playlist')),
                    videoId: selectedVideo.id,
                    title: selectedVideo.title || selectedVideo.id
                });
            });
        }
    }

    function openAddModal(video) {
        selectedVideo = video;
        if (modalSong) modalSong.textContent = video ? (video.title || video.id) : '';
        if (modal) modal.hidden = false;
        renderAddModal();
        if (typeof socket !== 'undefined') socket.emit('getPlaylists');
    }

    function closeAddModal() {
        selectedVideo = null;
        if (modal) modal.hidden = true;
    }

    if (typeof socket !== 'undefined' && socket && typeof socket.on === 'function') {
        socket.on('playlistsLoaded', function (data) {
            loading = false;
            if (Array.isArray(data)) playlists = data;
            else {
                playlists = [];
                if (data && data.error) showToast(data.error, 'error');
            }
            if (app && !app.hidden && managerView && !managerView.hidden) renderManager();
            if (modal && !modal.hidden) renderAddModal();
        });
        if (savedPlaylistsOn) socket.on('playlistCreated', function (result) {
            if (result && result.success && result.playlist) {
                playlists.unshift(result.playlist);
                showToast('已建立播放清單', 'success');
                if (managerView && !managerView.hidden) renderManager();
            } else {
                showToast('建立播放清單失敗：' + ((result && result.error) || ''), 'error');
            }
        });
        if (savedPlaylistsOn) socket.on('playlistDeleted', function (result) {
            if (result && result.success) {
                playlists = playlists.filter(function (item) {
                    return Number(item.id) !== Number(result.playlistId);
                });
                showToast('已刪除播放清單', 'success');
                renderManager();
            } else {
                showToast('刪除播放清單失敗：' + ((result && result.error) || ''), 'error');
            }
        });
        if (savedPlaylistsOn) socket.on('playlistDetailLoaded', function (data) {
            loading = false;
            if (!data || data.error) {
                showToast('載入播放清單失敗：' + ((data && data.error) || ''), 'error');
                showManager();
                return;
            }
            detail = data.playlist;
            detailItems = data.items || [];
            showDetail();
        });
        socket.on('songAddedToPlaylist', function (result) {
            if (pendingAdds > 0) {
                pendingAdds--;
                if (result && result.success) {
                    successfulAdds++;
                    if (result.item) detailItems.push(result.item);
                } else {
                    failedAdds++;
                }
                if (pendingAdds === 0) {
                    if (failedAdds && successfulAdds) {
                        showToast('成功新增 ' + successfulAdds + ' 首，' + failedAdds + ' 首失敗', 'info');
                    } else if (successfulAdds) {
                        showToast('成功新增 ' + successfulAdds + ' 首歌曲', 'success');
                    } else {
                        showToast('新增歌曲失敗', 'error');
                    }
                    if (detailView && !detailView.hidden) renderDetail();
                }
                return;
            }
            if (result && result.success) {
                showToast('歌曲已加入播放清單', 'success');
                closeAddModal();
            } else {
                showToast('加入播放清單失敗：' + ((result && result.error) || ''), 'error');
            }
        });
        if (savedPlaylistsOn) socket.on('songRemovedFromPlaylist', function (result) {
            if (result && result.success) {
                detailItems = detailItems.filter(function (item) {
                    return Number(item.id) !== Number(result.itemId);
                });
                renderDetail();
            } else {
                showToast('移除歌曲失敗：' + ((result && result.error) || ''), 'error');
            }
        });
        if (savedPlaylistsOn) socket.on('playlistAdded', function (result) {
            if (result && result.success) showToast(result.message || '已加入播放佇列', 'success');
            else if (result && result.error) showToast(result.error, 'error');
        });
    }

    if (openButton) openButton.addEventListener('click', openApp);
    var closeModal = document.getElementById('closeAddModal');
    var backdrop = document.getElementById('addToPlaylistBackdrop');
    var manage = document.getElementById('addModalManage');
    if (closeModal) closeModal.addEventListener('click', closeAddModal);
    if (backdrop) backdrop.addEventListener('click', closeAddModal);
    if (manage) {
        manage.addEventListener('click', function () {
            closeAddModal();
            openApp();
        });
    }

    window.PcPlaylists = {
        promptAdd: openAddModal,
        open: openApp
    };
})();
