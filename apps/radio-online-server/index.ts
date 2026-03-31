import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { instrument } from '@socket.io/admin-ui';
import Database from 'better-sqlite3';
import fs from 'fs';

console.log('=== 正在啟動 radio-online-server 1.0.3 ===');

// 確保資料目錄存在
const dataDir = '/app/data';
if (!fs.existsSync(dataDir)) {
  console.log(`建立資料目錄: ${dataDir}`);
  fs.mkdirSync(dataDir, { recursive: true });
}

const app = express();

// 共用 CORS 設定
const ALLOWED_ORIGINS = [
  "http://localhost:4200",
  "http://192.168.0.10:4200",
  "http://192.168.11.125:4200",
  "https://demo.wscc1031.synology.me",
  "https://radio.wscc1031.synology.me",
  "https://admin.socket.io"
];

const CORS_OPTIONS = {
  origin: ALLOWED_ORIGINS,
  credentials: true,
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
};

app.use(cors(CORS_OPTIONS));

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: CORS_OPTIONS,
  allowEIO3: true,
  transports: ['websocket', 'polling']
});

// 設定 Socket.IO Admin UI
instrument(io, {
  auth: {
    type: "basic",
    username: "admin",
    password: "$2a$12$IuWKSFABnC2T/vFQWYhZwe5J8CeVD9fmGj8kH01jzBNviKGm5Y6.S"
  },
  mode: process.env['NODE_ENV'] === 'production' ? 'production' : 'development',
});

let currentRadioState = {
  isPlaying: false,
  volume: 1,
  youtubeState: {
    playlist: [] as any[],
    currentIndex: -1,
    currentVideoId: null as string | null,
    isYoutubeMode: false
  }
};

// 添加線上人數計數
let onlineUsers = 0;

// 添加防護機制，避免重複清除
let lastClearTime = 0;
const CLEAR_COOLDOWN = 1000; // 1秒冷卻時間

// 添加清除操作保護機制
let isPlaylistClearing = false;
let clearProtectionTimer: ReturnType<typeof setTimeout> | null = null;
const CLEAR_PROTECTION_TIME = 3000; // 3秒保護時間

interface ChatMessage {
  userName: string;
  message: string;
  timestamp: number;
}

interface YoutubeStateFromDB {
  currentIndex: number;
  currentVideoId: string | null;
  isYoutubeMode: number;
}

interface PlaylistFromDB {
  id: number;
  name: string;
  description: string;
  createdAt: number;
  updatedAt: number;
}

interface PlaylistItemFromDB {
  id: number;
  playlistId: number;
  videoId: string;
  title: string;
  addedAt: number;
  sortOrder: number;
}

// 初始化 SQLite 資料庫
const db = new Database('/app/data/radio.db');
db.exec(`CREATE TABLE IF NOT EXISTS playlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  videoId TEXT NOT NULL,
  title TEXT,
  addedAt INTEGER
)`);

// 新增：創建多個播放清單表格
db.exec(`CREATE TABLE IF NOT EXISTS playlists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  createdAt INTEGER,
  updatedAt INTEGER
)`);

db.exec(`CREATE TABLE IF NOT EXISTS playlist_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  playlistId INTEGER NOT NULL,
  videoId TEXT NOT NULL,
  title TEXT,
  addedAt INTEGER,
  sortOrder INTEGER DEFAULT 0,
  FOREIGN KEY (playlistId) REFERENCES playlists (id) ON DELETE CASCADE
)`);

// 為 playlistId 欄位添加索引，加速 WHERE playlistId = ? 查詢
db.exec(`CREATE INDEX IF NOT EXISTS idx_playlist_items_playlistId ON playlist_items(playlistId)`);

// 新增：創建 YouTube 狀態表
db.exec(`CREATE TABLE IF NOT EXISTS youtube_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  currentIndex INTEGER DEFAULT -1,
  currentVideoId TEXT DEFAULT NULL,
  isYoutubeMode INTEGER DEFAULT 0,
  updatedAt INTEGER
)`);

// 初始化 YouTube 狀態（如果不存在）
const initYoutubeState = db.prepare(`
  INSERT OR IGNORE INTO youtube_state (id, currentIndex, currentVideoId, isYoutubeMode, updatedAt)
  VALUES (1, -1, NULL, 0, ?)
`);
initYoutubeState.run(Date.now());

io.on('connection', (socket) => {
  // 更新線上人數
  onlineUsers++;
  console.log('使用者連接，當前線上人數:', onlineUsers);
  io.emit('onlineUsers', onlineUsers);

  // 從資料庫載入 YouTube 狀態和播放清單並發送當前狀態給新連接的使用者
  try {
    const getYoutubeState = db.prepare('SELECT currentIndex, currentVideoId, isYoutubeMode FROM youtube_state WHERE id = 1');
    const youtubeStateFromDB = getYoutubeState.get() as YoutubeStateFromDB | undefined;

    const select = db.prepare('SELECT videoId, title FROM playlist ORDER BY addedAt ASC');
    const playlist = select.all();

    const formattedPlaylist = playlist.map((item: any) => ({
      id: item.videoId,
      title: item.title || item.videoId
    }));

    if (youtubeStateFromDB) {
      currentRadioState.youtubeState.playlist = formattedPlaylist;
      currentRadioState.youtubeState.currentIndex = youtubeStateFromDB.currentIndex;
      currentRadioState.youtubeState.currentVideoId = youtubeStateFromDB.currentVideoId;
      currentRadioState.youtubeState.isYoutubeMode = youtubeStateFromDB.isYoutubeMode === 1;
    }
  } catch (error) {
    console.error('從資料庫載入 YouTube 狀態時發生錯誤:', error);
  }

  socket.emit('radioStateUpdate', currentRadioState);

  // 處理請求當前狀態
  socket.on('requestCurrentState', () => {
    socket.emit('radioStateUpdate', currentRadioState);
    socket.emit('onlineUsers', onlineUsers);
  });

  // 處理請求線上人數
  socket.on('requestOnlineUsers', () => {
    socket.emit('onlineUsers', onlineUsers);
  });

  // 處理狀態更新
  socket.on('updateRadioState', (state) => {
    // 檢查是否在清除操作保護期內
    if (isPlaylistClearing) {
      // 只更新非播放清單相關的狀態
      currentRadioState = {
        ...currentRadioState,
        ...state,
        youtubeState: state.youtubeState ? {
          ...currentRadioState.youtubeState,
          ...state.youtubeState,
          playlist: currentRadioState.youtubeState.playlist
        } : currentRadioState.youtubeState
      };
    } else {
      currentRadioState = {
        ...currentRadioState,
        ...state,
        youtubeState: state.youtubeState ? {
          ...currentRadioState.youtubeState,
          ...state.youtubeState,
          playlist: state.youtubeState.hasOwnProperty('playlist')
            ? state.youtubeState.playlist
            : currentRadioState.youtubeState.playlist
        } : currentRadioState.youtubeState
      };
    }

    // 如果有 YouTube 狀態，保存到資料庫
    if (state.youtubeState) {
      try {
        const updateYoutubeState = db.prepare(`
          UPDATE youtube_state
          SET currentIndex = ?, currentVideoId = ?, isYoutubeMode = ?, updatedAt = ?
          WHERE id = 1
        `);
        updateYoutubeState.run(
          state.youtubeState.currentIndex || -1,
          state.youtubeState.currentVideoId || null,
          state.youtubeState.isYoutubeMode ? 1 : 0,
          Date.now()
        );
      } catch (error) {
        console.error('更新 YouTube 狀態到資料庫時發生錯誤:', error);
      }
    }

    // 廣播給所有其他使用者
    socket.broadcast.emit('radioStateUpdate', currentRadioState);
  });

  // 處理聊天訊息
  socket.on('chatMessage', (message: ChatMessage) => {
    io.emit('newChatMessage', message);
  });

  // 新增：接收 client 傳來的播放清單並寫入 sqlite
  socket.on('addPlaylist', (playlist) => {
    // 如果 playlist 其實是 [ [ {...}, {...} ] ]，要解開
    if (Array.isArray(playlist) && Array.isArray(playlist[0])) {
      playlist = playlist[0];
    }

    // 檢查播放清單是否為空
    if (!Array.isArray(playlist) || playlist.length === 0) {
      socket.emit('playlistAdded', { success: false, error: '播放清單為空' });
      return;
    }

    // 檢查播放清單是否有效
    const isValid = playlist.every((item: any) => item.id);

    if (!isValid) {
      socket.emit('playlistAdded', { success: false, error: '播放清單格式無效' });
      return;
    }

    // 發送開始處理的訊息
    socket.emit('playlistProcessing', {
      status: 'started',
      total: playlist.length,
      message: `開始處理 ${playlist.length} 首歌曲...`
    });

    try {
      // 使用事務來確保數據一致性
      const transaction = db.transaction(() => {
        const clear = db.prepare('DELETE FROM playlist');
        clear.run();

        const insert = db.prepare('INSERT INTO playlist (videoId, title, addedAt) VALUES (?, ?, ?)');
        const now = Date.now();

        const batchSize = 100;
        for (let i = 0; i < playlist.length; i += batchSize) {
          const batch = playlist.slice(i, i + batchSize);

          for (const item of batch) {
            insert.run(item.id, item.title || '', now);
          }

          // 發送進度更新
          const progress = Math.min(i + batchSize, playlist.length);
          socket.emit('playlistProcessing', {
            status: 'progress',
            processed: progress,
            total: playlist.length,
            message: `已處理 ${progress}/${playlist.length} 首歌曲`
          });
        }
      });

      transaction();

      // 更新記憶體中的播放清單狀態
      const formattedPlaylist = playlist.map((item: any) => ({
        id: item.id,
        title: item.title || item.id
      }));

      // 保存當前的播放狀態
      const currentIndex = currentRadioState.youtubeState.currentIndex;
      const currentVideoId = currentRadioState.youtubeState.currentVideoId;

      currentRadioState.youtubeState.playlist = formattedPlaylist;

      // 如果當前播放的影片不在新的播放清單中，才重置索引
      if (currentIndex >= 0 && currentVideoId) {
        const currentVideoStillExists = formattedPlaylist.some((item: any) => item.id === currentVideoId);
        if (!currentVideoStillExists) {
          currentRadioState.youtubeState.currentIndex = -1;
          currentRadioState.youtubeState.currentVideoId = null;
        }
      }

      // 廣播更新後的狀態給所有其他客戶端
      socket.broadcast.emit('radioStateUpdate', currentRadioState);

      socket.emit('playlistAdded', {
        success: true,
        message: `成功加入 ${playlist.length} 首歌曲到播放佇列`
      });

      console.log('已寫入 playlist:', playlist.length + ' 個項目');
    } catch (error) {
      console.error('寫入播放清單時發生錯誤:', error);
      socket.emit('playlistAdded', {
        success: false,
        error: '資料庫錯誤: ' + (error instanceof Error ? error.message : String(error))
      });
    }
  });

  // 新增：接收 client 載入 playlist 的請求
  socket.on('loadPlaylist', () => {
    try {
      const select = db.prepare('SELECT videoId, title FROM playlist ORDER BY addedAt ASC');
      const playlist = select.all();

      const getYoutubeState = db.prepare('SELECT currentIndex, currentVideoId, isYoutubeMode FROM youtube_state WHERE id = 1');
      const youtubeStateFromDB = getYoutubeState.get() as YoutubeStateFromDB | undefined;

      socket.emit('playlistLoaded', playlist);

      if (youtubeStateFromDB) {
        const formattedPlaylist = playlist.map((item: any) => ({
          id: item.videoId,
          title: item.title || item.videoId
        }));

        currentRadioState.youtubeState.playlist = formattedPlaylist;
        currentRadioState.youtubeState.currentIndex = youtubeStateFromDB.currentIndex;
        currentRadioState.youtubeState.currentVideoId = youtubeStateFromDB.currentVideoId;
        currentRadioState.youtubeState.isYoutubeMode = youtubeStateFromDB.isYoutubeMode === 1;

        socket.emit('radioStateUpdate', currentRadioState);
      }
    } catch (error) {
      console.error('從資料庫載入 playlist 時發生錯誤:', error);
      socket.emit('playlistLoaded', { error: '無法載入播放清單' });
    }
  });

  // 新增：接收 client 清除播放清單的請求
  socket.on('clearPlaylist', () => {
    const now = Date.now();

    // 檢查冷卻時間，避免重複清除
    if (now - lastClearTime < CLEAR_COOLDOWN) {
      socket.emit('playlistCleared', { success: false, error: '請稍後再試' });
      return;
    }

    lastClearTime = now;

    // 設置清除操作保護期（先清除舊的 timer）
    if (clearProtectionTimer) {
      clearTimeout(clearProtectionTimer);
    }
    isPlaylistClearing = true;
    clearProtectionTimer = setTimeout(() => {
      isPlaylistClearing = false;
      clearProtectionTimer = null;
    }, CLEAR_PROTECTION_TIME);

    try {
      const clear = db.prepare('DELETE FROM playlist');
      clear.run();

      currentRadioState.youtubeState.playlist = [];
      currentRadioState.youtubeState.currentIndex = -1;
      currentRadioState.youtubeState.currentVideoId = null;

      const updateYoutubeState = db.prepare(`
        UPDATE youtube_state
        SET currentIndex = -1, currentVideoId = NULL, updatedAt = ?
        WHERE id = 1
      `);
      updateYoutubeState.run(Date.now());

      // 廣播更新後的狀態給所有客戶端
      io.emit('radioStateUpdate', {
        ...currentRadioState,
        youtubeState: {
          ...currentRadioState.youtubeState,
          playlist: []
        }
      });

      socket.emit('playlistCleared', { success: true });
    } catch (error) {
      console.error('清除資料庫播放清單時發生錯誤:', error);
      socket.emit('playlistCleared', { success: false, error: '無法清除播放清單' });
    }
  });

  // 播放清單管理相關事件

  // 獲取所有播放清單
  socket.on('getPlaylists', () => {
    try {
      const select = db.prepare('SELECT * FROM playlists ORDER BY updatedAt DESC');
      const playlists = select.all();
      socket.emit('playlistsLoaded', playlists);
    } catch (error) {
      console.error('載入播放清單列表時發生錯誤:', error);
      socket.emit('playlistsLoaded', { error: '無法載入播放清單列表' });
    }
  });

  // 創建新播放清單
  socket.on('createPlaylist', (data) => {
    try {
      const { name, description } = data;
      if (!name || name.trim() === '') {
        socket.emit('playlistCreated', { success: false, error: '播放清單名稱不能為空' });
        return;
      }

      const now = Date.now();
      const insert = db.prepare('INSERT INTO playlists (name, description, createdAt, updatedAt) VALUES (?, ?, ?, ?)');
      const result = insert.run(name.trim(), description || '', now, now);

      socket.emit('playlistCreated', {
        success: true,
        playlist: {
          id: result.lastInsertRowid,
          name: name.trim(),
          description: description || '',
          createdAt: now,
          updatedAt: now
        }
      });
    } catch (error) {
      console.error('創建播放清單時發生錯誤:', error);
      socket.emit('playlistCreated', { success: false, error: '無法創建播放清單' });
    }
  });

  // 刪除播放清單
  socket.on('deletePlaylist', (playlistId) => {
    try {
      const deletePlaylist = db.prepare('DELETE FROM playlists WHERE id = ?');
      const result = deletePlaylist.run(playlistId);

      if (result.changes > 0) {
        socket.emit('playlistDeleted', { success: true, playlistId });
      } else {
        socket.emit('playlistDeleted', { success: false, error: '播放清單不存在' });
      }
    } catch (error) {
      console.error('刪除播放清單時發生錯誤:', error);
      socket.emit('playlistDeleted', { success: false, error: '無法刪除播放清單' });
    }
  });

  // 獲取播放清單詳情（包含所有曲目）
  socket.on('getPlaylistDetail', (playlistId) => {
    try {
      const getPlaylist = db.prepare('SELECT * FROM playlists WHERE id = ?');
      const playlist = getPlaylist.get(playlistId) as PlaylistFromDB | undefined;

      if (!playlist) {
        socket.emit('playlistDetailLoaded', { error: '播放清單不存在' });
        return;
      }

      const getItems = db.prepare('SELECT * FROM playlist_items WHERE playlistId = ? ORDER BY sortOrder ASC, addedAt ASC');
      const items = getItems.all(playlistId) as PlaylistItemFromDB[];

      socket.emit('playlistDetailLoaded', {
        playlist,
        items
      });
    } catch (error) {
      console.error('載入播放清單詳情時發生錯誤:', error);
      socket.emit('playlistDetailLoaded', { error: '無法載入播放清單詳情' });
    }
  });

  // 新增歌曲到播放清單
  socket.on('addSongToPlaylist', (data) => {
    try {
      const { playlistId, videoId, title } = data;

      const checkExist = db.prepare('SELECT id FROM playlist_items WHERE playlistId = ? AND videoId = ?');
      const existing = checkExist.get(playlistId, videoId);

      if (existing) {
        socket.emit('songAddedToPlaylist', { success: false, error: '歌曲已存在於播放清單中' });
        return;
      }

      const now = Date.now();
      const insert = db.prepare('INSERT INTO playlist_items (playlistId, videoId, title, addedAt) VALUES (?, ?, ?, ?)');
      const result = insert.run(playlistId, videoId, title || '', now);

      const updatePlaylist = db.prepare('UPDATE playlists SET updatedAt = ? WHERE id = ?');
      updatePlaylist.run(now, playlistId);

      socket.emit('songAddedToPlaylist', {
        success: true,
        item: {
          id: result.lastInsertRowid,
          playlistId,
          videoId,
          title: title || '',
          addedAt: now
        }
      });
    } catch (error) {
      console.error('新增歌曲到播放清單時發生錯誤:', error);
      socket.emit('songAddedToPlaylist', { success: false, error: '無法新增歌曲到播放清單' });
    }
  });

  // 從播放清單中移除歌曲
  socket.on('removeSongFromPlaylist', (data) => {
    try {
      const { playlistId, itemId } = data;

      const deleteItem = db.prepare('DELETE FROM playlist_items WHERE id = ? AND playlistId = ?');
      const result = deleteItem.run(itemId, playlistId);

      if (result.changes > 0) {
        const updatePlaylist = db.prepare('UPDATE playlists SET updatedAt = ? WHERE id = ?');
        updatePlaylist.run(Date.now(), playlistId);

        socket.emit('songRemovedFromPlaylist', { success: true, itemId });
      } else {
        socket.emit('songRemovedFromPlaylist', { success: false, error: '歌曲不存在' });
      }
    } catch (error) {
      console.error('從播放清單中移除歌曲時發生錯誤:', error);
      socket.emit('songRemovedFromPlaylist', { success: false, error: '無法移除歌曲' });
    }
  });

  socket.on('disconnect', () => {
    onlineUsers--;
    console.log('使用者斷開連接，當前線上人數:', onlineUsers);
    io.emit('onlineUsers', onlineUsers);
  });
});

httpServer.listen(1034, () => {
  console.log('伺服器運行在 port 1034');
});
