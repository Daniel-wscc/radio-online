/* 電台房間的唯一狀態。客戶端只送指令，這裡套用後加上遞增版號，再廣播整份狀態。 */
'use strict';

function clampVolume(value) {
    var volume = parseFloat(value);
    if (!isFinite(volume)) return null;
    if (volume < 0) return 0;
    if (volume > 1) return 1;
    return volume;
}

function makeItemId(seq) {
    return 'q' + seq.toString(36) + Math.random().toString(36).slice(2, 8);
}

function emptyState() {
    return {
        revision: 0,
        volume: 1,
        isPlaying: false,
        currentStation: null,
        youtubeState: {
            isYoutubeMode: false,
            playlist: [],
            currentIndex: -1,
            currentVideoId: null
        }
    };
}

function cloneState(state) {
    return JSON.parse(JSON.stringify(state));
}

function videoIdOf(item) {
    if (!item) return '';
    return String(item.videoId || item.id || '');
}

function normalizeIncomingItems(items) {
    var out = [];
    var list = Array.isArray(items) ? items : [];
    var i;
    for (i = 0; i < list.length; i++) {
        var videoId = videoIdOf(list[i]);
        if (!videoId) continue;
        out.push({
            videoId: videoId,
            title: (list[i].title && String(list[i].title)) || videoId
        });
    }
    return out;
}

function syncCurrentVideo(youtube) {
    var list = youtube.playlist;
    var index = youtube.currentIndex;
    if (!list.length) {
        youtube.currentIndex = -1;
        youtube.currentVideoId = null;
        return;
    }
    if (typeof index !== 'number' || !isFinite(index) || index < 0 || index >= list.length) {
        if (youtube.currentVideoId) {
            var found = -1;
            var i;
            for (i = 0; i < list.length; i++) {
                if (list[i].id === youtube.currentVideoId) found = i;
            }
            index = found;
        } else {
            index = -1;
        }
    }
    if (index < 0) {
        youtube.currentIndex = -1;
        youtube.currentVideoId = null;
        return;
    }
    youtube.currentIndex = index;
    youtube.currentVideoId = list[index].id;
}

function applyCommand(state, name, payload, ids) {
    var next = cloneState(state);
    var youtube = next.youtubeState;
    var body = payload || {};
    var changed = false;

    if (name === 'setStation') {
        if (!body.station || !body.station.id) return { ok: false, error: '缺少電台' };
        next.currentStation = body.station;
        next.isPlaying = true;
        youtube.isYoutubeMode = false;
        changed = true;
    } else if (name === 'setVolume') {
        var volume = clampVolume(body.volume);
        if (volume === null) return { ok: false, error: '音量無效' };
        next.volume = volume;
        changed = true;
    } else if (name === 'setMode') {
        if (body.mode !== 'youtube' && body.mode !== 'radio') return { ok: false, error: '模式無效' };
        youtube.isYoutubeMode = body.mode === 'youtube';
        next.isPlaying = body.mode === 'radio' && !!next.currentStation;
        changed = true;
    } else if (name === 'queueAdd' || name === 'queueAddMany') {
        var incoming = name === 'queueAdd' ? [body] : body.items;
        var normalized = normalizeIncomingItems(incoming);
        if (!normalized.length) return { ok: false, error: '沒有有效的影片' };
        var n;
        for (n = 0; n < normalized.length; n++) {
            ids.seq += 1;
            youtube.playlist.push({
                itemId: makeItemId(ids.seq),
                id: normalized[n].videoId,
                title: normalized[n].title
            });
        }
        if (youtube.currentIndex < 0) {
            youtube.currentIndex = 0;
            youtube.currentVideoId = youtube.playlist[0].id;
        }
        changed = true;
    } else if (name === 'queueRemove') {
        var removeAt = -1;
        var r;
        for (r = 0; r < youtube.playlist.length; r++) {
            if (youtube.playlist[r].itemId === body.itemId) removeAt = r;
        }
        if (removeAt < 0) return { ok: false, error: '找不到歌曲' };
        youtube.playlist.splice(removeAt, 1);
        if (youtube.currentIndex === removeAt) {
            youtube.currentIndex = youtube.playlist.length ? Math.min(removeAt, youtube.playlist.length - 1) : -1;
        } else if (youtube.currentIndex > removeAt) {
            youtube.currentIndex -= 1;
        }
        syncCurrentVideo(youtube);
        changed = true;
    } else if (name === 'queueMove') {
        var from = -1;
        var m;
        for (m = 0; m < youtube.playlist.length; m++) {
            if (youtube.playlist[m].itemId === body.itemId) from = m;
        }
        if (from < 0) return { ok: false, error: '找不到歌曲' };
        var to = parseInt(body.toIndex, 10);
        if (!isFinite(to)) return { ok: false, error: '位置無效' };
        if (to < 0) to = 0;
        if (to >= youtube.playlist.length) to = youtube.playlist.length - 1;
        if (from !== to) {
            var moved = youtube.playlist.splice(from, 1)[0];
            youtube.playlist.splice(to, 0, moved);
            if (youtube.currentIndex === from) youtube.currentIndex = to;
            else if (youtube.currentIndex > from && youtube.currentIndex <= to) youtube.currentIndex -= 1;
            else if (youtube.currentIndex < from && youtube.currentIndex >= to) youtube.currentIndex += 1;
            syncCurrentVideo(youtube);
        }
        changed = true;
    } else if (name === 'queueClear') {
        youtube.playlist = [];
        youtube.currentIndex = -1;
        youtube.currentVideoId = null;
        changed = true;
    } else if (name === 'queueReplace') {
        var replaced = normalizeIncomingItems(body.items);
        if (!replaced.length) return { ok: false, error: '播放清單為空' };
        var fresh = [];
        var k;
        for (k = 0; k < replaced.length; k++) {
            ids.seq += 1;
            fresh.push({
                itemId: makeItemId(ids.seq),
                id: replaced[k].videoId,
                title: replaced[k].title
            });
        }
        var previousId = youtube.currentVideoId;
        youtube.playlist = fresh;
        youtube.currentIndex = 0;
        if (previousId) {
            var keep = -1;
            for (k = 0; k < fresh.length; k++) {
                if (fresh[k].id === previousId) keep = k;
            }
            if (keep >= 0) youtube.currentIndex = keep;
        }
        syncCurrentVideo(youtube);
        changed = true;
    } else if (name === 'playIndex') {
        var index = -1;
        if (body.itemId) {
            var p;
            for (p = 0; p < youtube.playlist.length; p++) {
                if (youtube.playlist[p].itemId === body.itemId) index = p;
            }
        } else {
            index = parseInt(body.index, 10);
        }
        if (!isFinite(index) || index < 0 || index >= youtube.playlist.length) {
            return { ok: false, error: '索引無效' };
        }
        youtube.currentIndex = index;
        youtube.currentVideoId = youtube.playlist[index].id;
        youtube.isYoutubeMode = true;
        next.isPlaying = false;
        changed = true;
    } else if (name === 'shuffleQueue') {
        if (youtube.playlist.length > 1) {
            var currentItem = youtube.currentIndex >= 0 ? youtube.playlist[youtube.currentIndex] : null;
            var i;
            for (i = youtube.playlist.length - 1; i > 0; i--) {
                var j = Math.floor(Math.random() * (i + 1));
                var tmp = youtube.playlist[i];
                youtube.playlist[i] = youtube.playlist[j];
                youtube.playlist[j] = tmp;
            }
            if (currentItem) {
                for (i = 0; i < youtube.playlist.length; i++) {
                    if (youtube.playlist[i].itemId === currentItem.itemId) youtube.currentIndex = i;
                }
            }
            syncCurrentVideo(youtube);
        }
        changed = true;
    } else {
        return { ok: false, error: '未知指令' };
    }

    if (!changed) return { ok: false, error: '沒有變更' };
    next.revision = state.revision + 1;
    return { ok: true, state: next };
}

function columnExists(db, table, column) {
    var cols = db.prepare('PRAGMA table_info(' + table + ')').all();
    var i;
    for (i = 0; i < cols.length; i++) {
        if (cols[i].name === column) return true;
    }
    return false;
}

function ensureSchema(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS playlist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      videoId TEXT NOT NULL,
      title TEXT,
      addedAt INTEGER
    )`);
    db.exec(`CREATE TABLE IF NOT EXISTS youtube_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      currentIndex INTEGER DEFAULT -1,
      currentVideoId TEXT DEFAULT NULL,
      isYoutubeMode INTEGER DEFAULT 0,
      updatedAt INTEGER
    )`);
    db.prepare(`INSERT OR IGNORE INTO youtube_state (id, currentIndex, currentVideoId, isYoutubeMode, updatedAt)
      VALUES (1, -1, NULL, 0, ?)`).run(Date.now());
    db.exec(`CREATE TABLE IF NOT EXISTS radio_room (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      volume REAL NOT NULL DEFAULT 1,
      stationJson TEXT,
      isPlaying INTEGER NOT NULL DEFAULT 0,
      revision INTEGER NOT NULL DEFAULT 0,
      updatedAt INTEGER
    )`);
    db.prepare(`INSERT OR IGNORE INTO radio_room (id, volume, stationJson, isPlaying, revision, updatedAt)
      VALUES (1, 1, NULL, 0, 0, ?)`).run(Date.now());
    if (!columnExists(db, 'playlist', 'itemId')) {
        db.exec('ALTER TABLE playlist ADD COLUMN itemId TEXT');
    }
    if (!columnExists(db, 'playlist', 'sortOrder')) {
        db.exec('ALTER TABLE playlist ADD COLUMN sortOrder INTEGER DEFAULT 0');
    }
}

function loadState(db, ids) {
    ensureSchema(db);
    var state = emptyState();
    var room = db.prepare('SELECT volume, stationJson, isPlaying, revision FROM radio_room WHERE id = 1').get();
    if (room) {
        var volume = clampVolume(room.volume);
        state.volume = volume === null ? 1 : volume;
        state.isPlaying = room.isPlaying === 1;
        state.revision = typeof room.revision === 'number' ? room.revision : 0;
        if (room.stationJson) {
            try { state.currentStation = JSON.parse(room.stationJson); } catch (error) { state.currentStation = null; }
        }
    }
    var yt = db.prepare('SELECT currentIndex, currentVideoId, isYoutubeMode FROM youtube_state WHERE id = 1').get();
    var rows = db.prepare('SELECT itemId, videoId, title, sortOrder, id FROM playlist ORDER BY sortOrder ASC, addedAt ASC, id ASC').all();
    var playlist = [];
    var i;
    for (i = 0; i < rows.length; i++) {
        var itemId = rows[i].itemId;
        if (!itemId) {
            ids.seq += 1;
            itemId = makeItemId(ids.seq);
        }
        playlist.push({
            itemId: itemId,
            id: rows[i].videoId,
            title: rows[i].title || rows[i].videoId
        });
    }
    state.youtubeState.playlist = playlist;
    if (yt) {
        var index = yt.currentIndex;
        if (typeof index !== 'number' || !isFinite(index)) index = -1;
        state.youtubeState.currentIndex = index;
        state.youtubeState.currentVideoId = yt.currentVideoId || null;
        state.youtubeState.isYoutubeMode = yt.isYoutubeMode === 1;
    }
    syncCurrentVideo(state.youtubeState);
    return state;
}

function persistState(db, state) {
    var now = Date.now();
    db.prepare(`UPDATE radio_room
      SET volume = ?, stationJson = ?, isPlaying = ?, revision = ?, updatedAt = ?
      WHERE id = 1`).run(
        state.volume,
        state.currentStation ? JSON.stringify(state.currentStation) : null,
        state.isPlaying ? 1 : 0,
        state.revision,
        now
    );
    var index = state.youtubeState.currentIndex;
    if (typeof index !== 'number' || !isFinite(index)) index = -1;
    db.prepare(`UPDATE youtube_state
      SET currentIndex = ?, currentVideoId = ?, isYoutubeMode = ?, updatedAt = ?
      WHERE id = 1`).run(
        index,
        state.youtubeState.currentVideoId || null,
        state.youtubeState.isYoutubeMode ? 1 : 0,
        now
    );
    var write = db.transaction(function () {
        db.prepare('DELETE FROM playlist').run();
        var insert = db.prepare('INSERT INTO playlist (videoId, title, addedAt, itemId, sortOrder) VALUES (?, ?, ?, ?, ?)');
        var i;
        for (i = 0; i < state.youtubeState.playlist.length; i++) {
            var item = state.youtubeState.playlist[i];
            insert.run(item.id, item.title || '', now, item.itemId, i);
        }
    });
    write();
}

function createRadioStore(db) {
    var ids = { seq: 0 };
    var state = loadState(db, ids);
    persistState(db, state);
    var online = 0;
    return {
        getState: function () { return cloneState(state); },
        onlineUsers: function () { return online; },
        addUser: function () { online += 1; return online; },
        removeUser: function () { online = Math.max(0, online - 1); return online; },
        apply: function (name, payload) {
            var result = applyCommand(state, name, payload, ids);
            if (!result.ok) return result;
            state = result.state;
            persistState(db, state);
            return { ok: true, state: cloneState(state) };
        }
    };
}

var COMMANDS = [
    'setStation', 'setVolume', 'setMode', 'queueAdd', 'queueAddMany', 'queueRemove',
    'queueMove', 'queueClear', 'queueReplace', 'playIndex', 'shuffleQueue'
];

function attachRadioSync(io, store) {
    io.on('connection', function (socket) {
        var count = store.addUser();
        io.emit('onlineUsers', count);
        socket.emit('radioStateUpdate', store.getState());
        socket.emit('onlineUsers', count);

        socket.on('requestCurrentState', function () {
            socket.emit('radioStateUpdate', store.getState());
            socket.emit('onlineUsers', store.onlineUsers());
        });
        socket.on('requestOnlineUsers', function () {
            socket.emit('onlineUsers', store.onlineUsers());
        });

        COMMANDS.forEach(function (name) {
            socket.on(name, function (payload) {
                var result = store.apply(name, payload || {});
                if (!result.ok) {
                    socket.emit('radioCommandError', { command: name, error: result.error });
                    if (name === 'queueReplace') {
                        socket.emit('playlistAdded', { success: false, error: result.error });
                    }
                    return;
                }
                io.emit('radioStateUpdate', result.state);
                if (name === 'queueReplace') {
                    socket.emit('playlistAdded', {
                        success: true,
                        message: '已更新播放佇列（' + result.state.youtubeState.playlist.length + ' 首）'
                    });
                }
                if (name === 'queueClear') {
                    socket.emit('playlistCleared', { success: true });
                }
            });
        });

        socket.on('disconnect', function () {
            io.emit('onlineUsers', store.removeUser());
        });
    });
}

module.exports = {
    applyCommand: applyCommand,
    createRadioStore: createRadioStore,
    attachRadioSync: attachRadioSync,
    clampVolume: clampVolume,
    normalizeIncomingItems: normalizeIncomingItems,
    COMMANDS: COMMANDS
};
