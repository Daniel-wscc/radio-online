import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { instrument } from '@socket.io/admin-ui';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { createRadioStore, attachRadioSync } from './radio-sync.cjs';

console.log('=== 正在啟動 radio-online-server 1.0.3 ===');

// 確保資料目錄存在。測試可透過 RADIO_DB_PATH 指向暫存檔。
const dbFile = process.env.RADIO_DB_PATH || '/app/data/radio.db';
const dataDir = path.dirname(dbFile);
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

const NOW_PLAYING_CACHE_TTL = 15_000;
type NowPlayingCacheEntry = {
  data?: string;
  expiresAt: number;
  refreshPromise?: Promise<string>;
};
const nowPlayingCache = new Map<string, NowPlayingCacheEntry>();

async function fetchNowPlaying(channel: string): Promise<string> {
  const targetUrl = `https://bigbradio.net/stream/NowPlaying-${channel.charAt(0).toUpperCase() + channel.slice(1)}.txt`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(targetUrl, {
      headers: {
        'Accept': 'text/plain',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) radio-proxy'
      },
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch: ${response.status}`);
    }

    return (await response.text()).trim() || '無播放資訊';
  } finally {
    clearTimeout(timeout);
  }
}

async function getNowPlaying(channel: string): Promise<string> {
  const now = Date.now();
  const cached = nowPlayingCache.get(channel);
  if (cached?.data && cached.expiresAt > now) {
    return cached.data;
  }
  if (cached?.refreshPromise) {
    return cached.refreshPromise;
  }

  const entry: NowPlayingCacheEntry = cached || { expiresAt: 0 };
  const refreshPromise = fetchNowPlaying(channel)
    .then(data => {
      entry.data = data;
      entry.expiresAt = Date.now() + NOW_PLAYING_CACHE_TTL;
      return data;
    });
  entry.refreshPromise = refreshPromise;
  refreshPromise.then(
    () => {
      if (entry.refreshPromise === refreshPromise) entry.refreshPromise = undefined;
    },
    () => {
      if (entry.refreshPromise === refreshPromise) entry.refreshPromise = undefined;
    }
  );
  nowPlayingCache.set(channel, entry);

  try {
    return await entry.refreshPromise;
  } catch (error) {
    // 外部來源短暫失敗時先回傳舊資料，避免每個用戶端都重複觸發上游請求。
    if (entry.data) {
      entry.expiresAt = Date.now() + NOW_PLAYING_CACHE_TTL;
      return entry.data;
    }
    throw error;
  }
}

function isValidNowPlayingChannel(channel: string): boolean {
  return /^[A-Za-z]+$/.test(channel);
}

// 批次端點：前端一次取得多個頻道，減少行動裝置展開清單時的 HTTP 請求數。
app.get('/api/nowplaying', async (req, res) => {
  const channels = typeof req.query['channels'] === 'string'
    ? [...new Set(req.query['channels'].split(',').filter(isValidNowPlayingChannel))].slice(0, 10)
    : [];

  if (!channels.length) {
    return res.status(400).json({ error: 'channels query parameter is required' });
  }

  const results = await Promise.all(channels.map(async channel => {
    try {
      return [channel, await getNowPlaying(channel)] as const;
    } catch (error) {
      console.error('Error fetching NowPlaying:', error);
      return [channel, '載入失敗'] as const;
    }
  }));
  res.set('Cache-Control', 'no-store');
  const response: Record<string, string> = {};
  for (const [channel, data] of results) {
    response[channel] = data;
  }
  res.json(response);
});

// Proxy endpoint for BigBRadio NowPlaying
app.get('/api/nowplaying/:channel', async (req, res) => {
  const channel = req.params.channel;

  // 防禦性檢查
  if (!channel || !isValidNowPlayingChannel(channel)) {
    return res.status(400).send('Invalid channel');
  }

  try {
    res.set('Content-Type', 'text/plain; charset=utf-8');
    res.set('Cache-Control', 'no-store');
    res.send(await getNowPlaying(channel));
  } catch (error) {
    console.error('Error fetching NowPlaying:', error);
    res.status(500).send('Internal Server Error');
  }
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

interface ChatMessage {
  userName: string;
  message: string;
  timestamp: number;
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
const db = new Database(dbFile);
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

const radioStore = createRadioStore(db);
attachRadioSync(io, radioStore);

io.on('connection', (socket) => {
  socket.on('chatMessage', (message: ChatMessage) => {
    io.emit('newChatMessage', message);
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

});

const port = Number(process.env.PORT || 1034);
httpServer.listen(port, () => {
  console.log('伺服器運行在 port ' + port);
});
