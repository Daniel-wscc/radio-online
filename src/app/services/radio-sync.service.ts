import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { Socket } from 'ngx-socket-io';

export interface RadioState {
  currentStation?: any;
  isPlaying: boolean;
  volume: number;
  isMuted?: boolean;
  youtubeState?: {
    playlist?: Array<{ id: string, title?: string }>; // 使播放清單變為可選
    currentIndex: number;
    currentVideoId: string | null;
    isYoutubeMode: boolean;
  };
}

@Injectable({
  providedIn: 'root'
})
export class RadioSyncService {
  private radioState = new BehaviorSubject<RadioState>({
    isPlaying: false,
    volume: 1,
    youtubeState: {
      playlist: [],
      currentIndex: -1,
      currentVideoId: null,
      isYoutubeMode: false
    }
  });

  radioState$ = this.radioState.asObservable();

  private onlineUsersSubject = new BehaviorSubject<number>(0);
  onlineUsers$ = this.onlineUsersSubject.asObservable();

  constructor(private socket: Socket) {
    // 監聽來自伺服器的狀態更新
    this.socket.fromEvent<RadioState>('radioStateUpdate').subscribe(state => {
      console.log('收到狀態更新:', state);
      this.radioState.next(state);
    });

    // 監聽只有音量的更新
    this.socket.fromEvent<{volume: number}>('volumeUpdate').subscribe(data => {
      const currentState = this.radioState.value;
      this.radioState.next({
        ...currentState,
        volume: data.volume
      });
    });

    // 監聽線上人數更新
    this.socket.fromEvent<number>('onlineUsers').subscribe(count => {
      console.log('收到線上人數更新:', count);
      this.onlineUsersSubject.next(count);
    });

    // 監聽Socket連接事件
    this.socket.fromEvent('connect').subscribe(() => {
      console.log('Socket已連接，請求當前狀態和線上人數');
      this.requestCurrentState();
      this.requestOnlineUsers();
    });

    // 監聽Socket斷開事件
    this.socket.fromEvent('disconnect').subscribe(() => {
      console.log('Socket已斷開連接');
    });

    // 如果已經連接，立即請求狀態
    if (this.socket.ioSocket.connected) {
      console.log('Socket已連接，立即請求當前狀態和線上人數');
      this.requestCurrentState();
      this.requestOnlineUsers();
    } else {
      console.log('Socket尚未連接，等待連接事件');
    }
  }

  // 請求當前狀態
  requestCurrentState() {
    this.socket.emit('requestCurrentState');
  }

  // 請求線上人數
  requestOnlineUsers() {
    this.socket.emit('requestOnlineUsers');
  }

  // 更新廣播狀態
  updateState(state: RadioState) {
    this.socket.emit('updateRadioState', state);
  }

  // 新增：發送輕量級狀態更新（不包含播放清單）
  updateLightweightState(state: Partial<RadioState>) {
    // 確保不包含播放清單
    const lightweightState = {
      ...state,
      youtubeState: state.youtubeState ? {
        ...state.youtubeState,
        playlist: undefined // 不發送播放清單
      } : undefined
    };
    this.socket.emit('updateRadioState', lightweightState);
  }

  // 新增播放清單
  addPlaylist(playlist: Array<{ id: string, title?: string }>) {
    this.socket.emit('addPlaylist', playlist);
  }

  // 從伺服器載入播放清單
  loadPlaylist() {
    this.socket.emit('loadPlaylist');
  }
  
  // 清除播放清單
  clearPlaylist() {
    this.socket.emit('clearPlaylist');
  }

  // 監聽從伺服器載入的播放清單
  onPlaylistLoaded(): Observable<any> {
    return this.socket.fromEvent<any>('playlistLoaded');
  }

  // 監聽播放清單處理進度
  onPlaylistProcessing(): Observable<any> {
    return this.socket.fromEvent<any>('playlistProcessing');
  }

  // 監聽播放清單添加完成事件
  onPlaylistAdded(): Observable<any> {
    return this.socket.fromEvent<any>('playlistAdded');
  }

  // 播放清單管理相關方法

  // 獲取所有播放清單
  getPlaylists() {
    this.socket.emit('getPlaylists');
  }

  // 監聽播放清單列表載入
  onPlaylistsLoaded(): Observable<any> {
    return this.socket.fromEvent<any>('playlistsLoaded');
  }

  // 創建新播放清單
  createPlaylist(name: string, description?: string) {
    this.socket.emit('createPlaylist', { name, description });
  }

  // 監聽播放清單創建結果
  onPlaylistCreated(): Observable<any> {
    return this.socket.fromEvent<any>('playlistCreated');
  }

  // 刪除播放清單
  deletePlaylist(playlistId: number) {
    this.socket.emit('deletePlaylist', playlistId);
  }

  // 監聽播放清單刪除結果
  onPlaylistDeleted(): Observable<any> {
    return this.socket.fromEvent<any>('playlistDeleted');
  }

  // 獲取播放清單詳情
  getPlaylistDetail(playlistId: number) {
    this.socket.emit('getPlaylistDetail', playlistId);
  }

  // 監聽播放清單詳情載入
  onPlaylistDetailLoaded(): Observable<any> {
    return this.socket.fromEvent<any>('playlistDetailLoaded');
  }

  onPlaylistCleared(): Observable<any> {
    return this.socket.fromEvent<any>('playlistCleared');
  }

  // 新增歌曲到播放清單
  addSongToPlaylist(playlistId: number, videoId: string, title?: string) {
    this.socket.emit('addSongToPlaylist', { playlistId, videoId, title });
  }

  // 監聽歌曲新增結果
  onSongAddedToPlaylist(): Observable<any> {
    return this.socket.fromEvent<any>('songAddedToPlaylist');
  }

  // 從播放清單中移除歌曲
  removeSongFromPlaylist(playlistId: number, itemId: number) {
    this.socket.emit('removeSongFromPlaylist', { playlistId, itemId });
  }

  // 監聽歌曲移除結果
  onSongRemovedFromPlaylist(): Observable<any> {
    return this.socket.fromEvent<any>('songRemovedFromPlaylist');
  }
}
