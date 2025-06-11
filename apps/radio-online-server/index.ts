import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { instrument } from '@socket.io/admin-ui';
import Database from 'better-sqlite3';
import fs from 'fs';

console.log('=== 正在啟動 radio-online-server ===');

// 確保資料目錄存在
const dataDir = '/app/data';
if (!fs.existsSync(dataDir)) {
  console.log(`建立資料目錄: ${dataDir}`);
  fs.mkdirSync(dataDir, { recursive: true });
}

const app = express();

// 加入 Express CORS 中間件
app.use(cors({
  origin: [
    "http://localhost:4200", 
    "http://192.168.0.10:4200", 
    "http://192.168.11.125:4200",
    "https://demo.wscc1031.synology.me",
    "https://radio.wscc1031.synology.me",
    "https://admin.socket.io"  // 添加 Admin UI 的域名
  ],
  credentials: true,
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: [
      "http://localhost:4200", 
      "http://192.168.0.10:4200",
      "http://192.168.11.125:4200", 
      "https://demo.wscc1031.synology.me",
      "https://radio.wscc1031.synology.me",
      "https://admin.socket.io"  // 添加 Admin UI 的域名
    ],
    methods: ["GET", "POST", "OPTIONS"],
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization"]
  },
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
  io.emit('onlineUsers', onlineUsers);
  
  console.log('使用者連接');

  // 從資料庫載入 YouTube 狀態和播放清單並發送當前狀態給新連接的使用者
  try {
    const getYoutubeState = db.prepare('SELECT currentIndex, currentVideoId, isYoutubeMode FROM youtube_state WHERE id = 1');
    const youtubeStateFromDB = getYoutubeState.get() as YoutubeStateFromDB | undefined;

    // 載入播放清單
    const select = db.prepare('SELECT videoId, title FROM playlist ORDER BY addedAt ASC');
    const playlist = select.all();

    // 轉換播放清單格式
    const formattedPlaylist = playlist.map((item: any) => ({
      id: item.videoId,
      title: item.title || item.videoId
    }));

    if (youtubeStateFromDB) {
      // 更新記憶體中的狀態
      currentRadioState.youtubeState.playlist = formattedPlaylist;
      currentRadioState.youtubeState.currentIndex = youtubeStateFromDB.currentIndex;
      currentRadioState.youtubeState.currentVideoId = youtubeStateFromDB.currentVideoId;
      currentRadioState.youtubeState.isYoutubeMode = youtubeStateFromDB.isYoutubeMode === 1;

      console.log('從資料庫載入 YouTube 狀態:', {
        currentIndex: youtubeStateFromDB.currentIndex,
        currentVideoId: youtubeStateFromDB.currentVideoId,
        isYoutubeMode: youtubeStateFromDB.isYoutubeMode === 1,
        playlistLength: formattedPlaylist.length
      });
    }
  } catch (error) {
    console.error('從資料庫載入 YouTube 狀態時發生錯誤:', error);
  }

  socket.emit('radioStateUpdate', currentRadioState);

  // 處理狀態更新
  socket.on('updateRadioState', (state) => {
    currentRadioState = state;

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
        console.log('已更新 YouTube 狀態到資料庫:', {
          currentIndex: state.youtubeState.currentIndex,
          currentVideoId: state.youtubeState.currentVideoId,
          isYoutubeMode: state.youtubeState.isYoutubeMode
        });
      } catch (error) {
        console.error('更新 YouTube 狀態到資料庫時發生錯誤:', error);
      }
    }

    // 廣播給所有其他使用者
    socket.broadcast.emit('radioStateUpdate', state);
  });

  // 處理聊天訊息
  socket.on('chatMessage', (message: ChatMessage) => {
    io.emit('newChatMessage', message);
  });

  // 新增：接收 client 傳來的播放清單並寫入 sqlite
  socket.on('addPlaylist', (playlist) => {
    console.log('收到 addPlaylist:', JSON.stringify(playlist).substring(0, 100) + '...', Array.isArray(playlist));
    
    // 如果 playlist 其實是 [ [ {...}, {...} ] ]，要解開
    if (Array.isArray(playlist) && Array.isArray(playlist[0])) {
      playlist = playlist[0];
    }
    
    // 檢查播放清單是否為空
    if (!Array.isArray(playlist) || playlist.length === 0) {
      console.log('收到空的播放清單，忽略');
      socket.emit('playlistAdded', { success: false, error: '播放清單為空' });
      return;
    }
    
    // 檢查播放清單是否有效
    let isValid = true;
    for (const item of playlist) {
      if (!item.id) {
        isValid = false;
        break;
      }
    }
    
    if (!isValid) {
      console.log('收到無效的播放清單，忽略');
      socket.emit('playlistAdded', { success: false, error: '播放清單格式無效' });
      return;
    }
    
    try {
      // 先清除現有的播放清單
      const clear = db.prepare('DELETE FROM playlist');
      clear.run();
      
      // 插入新的播放清單
      const insert = db.prepare('INSERT INTO playlist (videoId, title, addedAt) VALUES (?, ?, ?)');
      const now = Date.now();
      for (const item of playlist) {
        insert.run(item.id, item.title || '', now);
      }
      socket.emit('playlistAdded', { success: true });
      console.log('已寫入 playlist:', playlist.length + ' 個項目');
    } catch (error) {
      console.error('寫入播放清單時發生錯誤:', error);
      socket.emit('playlistAdded', { success: false, error: '資料庫錯誤' });
    }
  });

  // 新增：接收 client 載入 playlist 的請求
  socket.on('loadPlaylist', () => {
    console.log('收到 loadPlaylist 請求');
    try {
      const select = db.prepare('SELECT videoId, title FROM playlist ORDER BY addedAt ASC');
      const playlist = select.all();

      // 同時載入 YouTube 狀態
      const getYoutubeState = db.prepare('SELECT currentIndex, currentVideoId, isYoutubeMode FROM youtube_state WHERE id = 1');
      const youtubeStateFromDB = getYoutubeState.get() as YoutubeStateFromDB | undefined;

      // 發送播放清單和 YouTube 狀態
      socket.emit('playlistLoaded', playlist);

      if (youtubeStateFromDB) {
        // 轉換播放清單格式以符合前端期望的格式
        const formattedPlaylist = playlist.map((item: any) => ({
          id: item.videoId,
          title: item.title || item.videoId
        }));

        // 更新並廣播完整的狀態
        currentRadioState.youtubeState.playlist = formattedPlaylist;
        currentRadioState.youtubeState.currentIndex = youtubeStateFromDB.currentIndex;
        currentRadioState.youtubeState.currentVideoId = youtubeStateFromDB.currentVideoId;
        currentRadioState.youtubeState.isYoutubeMode = youtubeStateFromDB.isYoutubeMode === 1;

        socket.emit('radioStateUpdate', currentRadioState);
        console.log('已載入 playlist 和 YouTube 狀態:', {
          playlistLength: playlist.length,
          currentIndex: youtubeStateFromDB.currentIndex,
          currentVideoId: youtubeStateFromDB.currentVideoId
        });
      } else {
        console.log('已從資料庫載入 playlist 並發送:', playlist.length + ' 個項目');
      }
    } catch (error) {
      console.error('從資料庫載入 playlist 時發生錯誤:', error);
      socket.emit('playlistLoaded', { error: '無法載入播放清單' });
    }
  });

  // 新增：接收 client 清除播放清單的請求
  socket.on('clearPlaylist', () => {
    console.log('收到 clearPlaylist 請求');
    try {
      const clear = db.prepare('DELETE FROM playlist');
      clear.run();
      socket.emit('playlistCleared', { success: true });
      console.log('已清除資料庫中的播放清單');
    } catch (error) {
      console.error('清除資料庫播放清單時發生錯誤:', error);
      socket.emit('playlistCleared', { success: false, error: '無法清除播放清單' });
    }
  });

  // 新增：播放清單管理相關事件

  // 獲取所有播放清單
  socket.on('getPlaylists', () => {
    console.log('收到 getPlaylists 請求');
    try {
      const select = db.prepare('SELECT * FROM playlists ORDER BY updatedAt DESC');
      const playlists = select.all();
      socket.emit('playlistsLoaded', playlists);
      console.log('已載入播放清單列表:', playlists.length + ' 個播放清單');
    } catch (error) {
      console.error('載入播放清單列表時發生錯誤:', error);
      socket.emit('playlistsLoaded', { error: '無法載入播放清單列表' });
    }
  });

  // 創建新播放清單
  socket.on('createPlaylist', (data) => {
    console.log('收到 createPlaylist 請求:', data);
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
      console.log('已創建播放清單:', name);
    } catch (error) {
      console.error('創建播放清單時發生錯誤:', error);
      socket.emit('playlistCreated', { success: false, error: '無法創建播放清單' });
    }
  });

  // 刪除播放清單
  socket.on('deletePlaylist', (playlistId) => {
    console.log('收到 deletePlaylist 請求:', playlistId);
    try {
      const deletePlaylist = db.prepare('DELETE FROM playlists WHERE id = ?');
      const result = deletePlaylist.run(playlistId);

      if (result.changes > 0) {
        socket.emit('playlistDeleted', { success: true, playlistId });
        console.log('已刪除播放清單:', playlistId);
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
    console.log('收到 getPlaylistDetail 請求:', playlistId);
    try {
      // 獲取播放清單基本資訊
      const getPlaylist = db.prepare('SELECT * FROM playlists WHERE id = ?');
      const playlist = getPlaylist.get(playlistId) as PlaylistFromDB | undefined;

      if (!playlist) {
        socket.emit('playlistDetailLoaded', { error: '播放清單不存在' });
        return;
      }

      // 獲取播放清單中的所有曲目
      const getItems = db.prepare('SELECT * FROM playlist_items WHERE playlistId = ? ORDER BY sortOrder ASC, addedAt ASC');
      const items = getItems.all(playlistId) as PlaylistItemFromDB[];

      socket.emit('playlistDetailLoaded', {
        playlist,
        items
      });
      console.log('已載入播放清單詳情:', playlist.name, '包含', items.length, '首歌曲');
    } catch (error) {
      console.error('載入播放清單詳情時發生錯誤:', error);
      socket.emit('playlistDetailLoaded', { error: '無法載入播放清單詳情' });
    }
  });

  // 新增歌曲到播放清單
  socket.on('addSongToPlaylist', (data) => {
    console.log('收到 addSongToPlaylist 請求:', data);
    try {
      const { playlistId, videoId, title } = data;

      // 檢查歌曲是否已存在於播放清單中
      const checkExist = db.prepare('SELECT id FROM playlist_items WHERE playlistId = ? AND videoId = ?');
      const existing = checkExist.get(playlistId, videoId);

      if (existing) {
        socket.emit('songAddedToPlaylist', { success: false, error: '歌曲已存在於播放清單中' });
        return;
      }

      const now = Date.now();
      const insert = db.prepare('INSERT INTO playlist_items (playlistId, videoId, title, addedAt) VALUES (?, ?, ?, ?)');
      const result = insert.run(playlistId, videoId, title || '', now);

      // 更新播放清單的修改時間
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
      console.log('已新增歌曲到播放清單:', videoId, '到播放清單', playlistId);
    } catch (error) {
      console.error('新增歌曲到播放清單時發生錯誤:', error);
      socket.emit('songAddedToPlaylist', { success: false, error: '無法新增歌曲到播放清單' });
    }
  });

  // 從播放清單中移除歌曲
  socket.on('removeSongFromPlaylist', (data) => {
    console.log('收到 removeSongFromPlaylist 請求:', data);
    try {
      const { playlistId, itemId } = data;

      const deleteItem = db.prepare('DELETE FROM playlist_items WHERE id = ? AND playlistId = ?');
      const result = deleteItem.run(itemId, playlistId);

      if (result.changes > 0) {
        // 更新播放清單的修改時間
        const updatePlaylist = db.prepare('UPDATE playlists SET updatedAt = ? WHERE id = ?');
        updatePlaylist.run(Date.now(), playlistId);

        socket.emit('songRemovedFromPlaylist', { success: true, itemId });
        console.log('已從播放清單中移除歌曲:', itemId);
      } else {
        socket.emit('songRemovedFromPlaylist', { success: false, error: '歌曲不存在' });
      }
    } catch (error) {
      console.error('從播放清單中移除歌曲時發生錯誤:', error);
      socket.emit('songRemovedFromPlaylist', { success: false, error: '無法移除歌曲' });
    }
  });

  socket.on('disconnect', () => {
    // 更新線上人數
    onlineUsers--;
    io.emit('onlineUsers', onlineUsers);
    console.log('使用者斷開連接');
  });
});

httpServer.listen(1034, () => {
  console.log('伺服器運行在 port 1034');
}); 
