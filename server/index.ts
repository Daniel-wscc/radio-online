import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';

const app = express();

// 加入 Express CORS 中間件
app.use(cors({
  origin: [
    "http://localhost:4200", 
    "http://192.168.0.10:4200", 
    "https://demo.wscc1031.synology.me",
    "https://radio.wscc1031.synology.me"
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
      "https://demo.wscc1031.synology.me",
      "https://radio.wscc1031.synology.me"
    ],
    methods: ["GET", "POST", "OPTIONS"],
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization"]
  },
  allowEIO3: true,
  transports: ['websocket', 'polling']
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