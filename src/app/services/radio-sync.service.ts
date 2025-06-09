import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { Socket } from 'ngx-socket-io';

export interface RadioState {
  currentStation?: any;
  isPlaying: boolean;
  volume: number;
  isMuted?: boolean;
  youtubeState?: {
    playlist: Array<{ id: string, title?: string }>;
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
      this.radioState.next(state);
    });

    // 監聽線上人數更新
    this.socket.fromEvent<number>('onlineUsers').subscribe(count => {
      this.onlineUsersSubject.next(count);
    });
  }

  // 更新廣播狀態
  updateState(state: RadioState) {
    this.socket.emit('updateRadioState', state);
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
}
