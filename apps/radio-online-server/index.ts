import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { instrument } from '@socket.io/admin-ui';
import Database from 'better-sqlite3';

console.log('=== 正在啟動 radio-online-server ===');

const app = express();

// 加入 Express CORS 中間件
app.use(cors({
  // origin: "http://localhost:4200",
  origin: [
    "http://localhost:4200", 
    "http://192.168.0.10:4200", 
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
    // origin: "http://localhost:4200",
    origin: [
      "http://localhost:4200", 
      "http://192.168.0.10:4200", 
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
    playlist: [],
    currentIndex: -1,
    currentVideoId: null,
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

// 初始化 SQLite 資料庫
const db = new Database('/app/data/radio.db');
db.exec(`CREATE TABLE IF NOT EXISTS playlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  videoId TEXT NOT NULL,
  title TEXT,
  addedAt INTEGER
)`);

io.on('connection', (socket) => {
  // 更新線上人數
  onlineUsers++;
  io.emit('onlineUsers', onlineUsers);
  
  console.log('使用者連接');
  
  // 發送當前狀態給新連接的使用者
  socket.emit('radioStateUpdate', currentRadioState);

  // 處理狀態更新
  socket.on('updateRadioState', (state) => {
    currentRadioState = state;
    // 廣播給所有其他使用者
    socket.broadcast.emit('radioStateUpdate', state);
  });

  // 處理聊天訊息
  socket.on('chatMessage', (message: ChatMessage) => {
    io.emit('newChatMessage', message);
  });

  // 新增：接收 client 傳來的播放清單並寫入 sqlite
  socket.on('addPlaylist', (playlist) => {
    console.log('收到 addPlaylist:', JSON.stringify(playlist), Array.isArray(playlist), Array.isArray(playlist[0]));
    // 如果 playlist 其實是 [ [ {...}, {...} ] ]，要解開
    if (Array.isArray(playlist) && Array.isArray(playlist[0])) {
      playlist = playlist[0];
    }
    if (Array.isArray(playlist)) {
      const insert = db.prepare('INSERT INTO playlist (videoId, title, addedAt) VALUES (?, ?, ?)');
      const now = Date.now();
      for (const item of playlist) {
        insert.run(item.id, item.title || '', now);
      }
      socket.emit('playlistAdded', { success: true });
      console.log('已寫入 playlist:', playlist);
    } else {
      socket.emit('playlistAdded', { success: false, error: '格式錯誤' });
      console.log('收到不正確的 playlist 資料:', playlist);
    }
  });

  // 新增：接收 client 載入 playlist 的請求
  socket.on('loadPlaylist', () => {
    console.log('收到 loadPlaylist 請求');
    try {
      const select = db.prepare('SELECT videoId, title FROM playlist ORDER BY addedAt ASC');
      const playlist = select.all();
      socket.emit('playlistLoaded', playlist);
      console.log('已從資料庫載入 playlist 並發送:', playlist);
    } catch (error) {
      console.error('從資料庫載入 playlist 時發生錯誤:', error);
      socket.emit('playlistLoaded', { error: '無法載入播放清單' });
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