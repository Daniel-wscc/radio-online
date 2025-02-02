import { Injectable } from '@angular/core';
import { Socket } from 'ngx-socket-io';
import { BehaviorSubject } from 'rxjs';

export interface ChatMessage {
  userName: string;
  message: string;
  timestamp: number;
}

@Injectable({
  providedIn: 'root'
})
export class ChatService {
  private messages = new BehaviorSubject<ChatMessage[]>([]);
  messages$ = this.messages.asObservable();

  constructor(private socket: Socket) {
    this.socket.fromEvent<ChatMessage>('newChatMessage').subscribe(message => {
      const currentMessages = this.messages.value;
      this.messages.next([...currentMessages, message]);
    });
  }

  sendMessage(message: string) {
    const userName = localStorage.getItem('userName') || '訪客';
    const chatMessage: ChatMessage = {
      userName,
      message,
      timestamp: Date.now()
    };
    this.socket.emit('chatMessage', chatMessage);
  }
} 