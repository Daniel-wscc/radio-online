import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { Socket } from 'ngx-socket-io';

export interface RadioState {
  currentStation?: any;
  isPlaying: boolean;
  volume: number;
  isMuted?: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class RadioSyncService {
  private radioState = new BehaviorSubject<RadioState>({
    isPlaying: false,
    volume: 1
  });

  radioState$ = this.radioState.asObservable();

  constructor(private socket: Socket) {
    // 監聽來自伺服器的狀態更新
    this.socket.fromEvent<RadioState>('radioStateUpdate').subscribe(state => {
      this.radioState.next(state);
    });
  }

  // 更新廣播狀態
  updateState(state: RadioState) {
    this.socket.emit('updateRadioState', state);
  }
} 