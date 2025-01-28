import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: ["http://localhost:4200", "http://192.168.0.10:4200"],
    methods: ["GET", "POST"]
  }
});

let currentRadioState = {
  isPlaying: false,
  volume: 1
};

io.on('connection', (socket) => {
  console.log('使用者連接');
  
  // 發送當前狀態給新連接的使用者
  socket.emit('radioStateUpdate', currentRadioState);

  // 處理狀態更新
  socket.on('updateRadioState', (state) => {
    currentRadioState = state;
    // 廣播給所有其他使用者
    socket.broadcast.emit('radioStateUpdate', state);
  });

  socket.on('disconnect', () => {
    console.log('使用者斷開連接');
  });
});

httpServer.listen(3000, () => {
  console.log('伺服器運行在 port 3000');
}); 