import { Component, OnInit, DestroyRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ChatService, ChatMessage } from '../services/chat.service';
import { ViewEncapsulation } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

@Component({
  selector: 'app-chat-drawer',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
  ],
  templateUrl: './chat-drawer.component.html',
  styleUrls: ['./chat-drawer.component.css'],
  encapsulation : ViewEncapsulation.None
})
export class ChatDrawerComponent implements OnInit {
  newMessage = '';
  messages$;
  unreadCount = 0;
  notificationPermission: NotificationPermission = 'default';
  showNotificationPrompt = false;

  visible = false;
  private lastMessageCount = 0;
  private destroyRef = inject(DestroyRef);

  constructor(private chatService: ChatService) {
    this.messages$ = this.chatService.messages$;

    // 監聽新訊息，只在有新的非系統訊息時增加未讀數並顯示通知
    this.messages$.pipe(
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(messages => {
      if (!this.visible && messages && messages.length > 0) {
        const lastMessage = messages[messages.length - 1];
        if (!lastMessage.isSystem && (!this.lastMessageCount || messages.length > this.lastMessageCount)) {
          this.unreadCount++;
          this.showNotification(lastMessage);
        }
        this.lastMessageCount = messages.length;
      }
    });
  }

  ngOnInit() {
    if ('Notification' in window) {
      this.notificationPermission = Notification.permission;
      this.showNotificationPrompt = this.notificationPermission === 'default';
    }
  }

  async requestNotificationPermission() {
    if (!('Notification' in window)) {
      return;
    }

    try {
      this.notificationPermission = await Notification.requestPermission();
      this.showNotificationPrompt = this.notificationPermission === 'default';
    } catch (error) {
      console.error('請求通知權限時發生錯誤:', error);
    }
  }

  private showNotification(message: ChatMessage) {
    if (
      this.notificationPermission === 'granted' &&
      'Notification' in window &&
      document.hidden
    ) {
      const userName = message.userName || '訪客';
      const messageText = message.message || '發送了一則訊息';
      const notification = new Notification('新聊天訊息', {
        body: `${userName}: ${messageText}`,
        icon: '/favicon.ico'
      });

      notification.onclick = () => {
        window.focus();
        this.visible = true;
        this.chatService.setChatVisible(true);
        notification.close();
      };

      setTimeout(() => notification.close(), 5000);
    }
  }

  onCollapsedChange(event: boolean) {
    this.visible = event;
    this.chatService.setChatVisible(this.visible);
    if (this.visible) {
      this.unreadCount = 0;
      // 使用 take(1) 同步讀取當前訊息數量
      this.messages$.pipe(
        takeUntilDestroyed(this.destroyRef)
      ).subscribe(messages => {
        this.lastMessageCount = messages ? messages.length : 0;
      });
    }
  }

  sendMessage() {
    if (this.newMessage.trim()) {
      this.chatService.sendMessage(this.newMessage);
      this.newMessage = '';
    }
  }

  setUserName() {
    const userName = prompt('請輸入您的名稱：', localStorage.getItem('userName') || '訪客');
    if (userName) {
      localStorage.setItem('userName', userName);
    }
  }

  dismissNotificationPrompt() {
    this.showNotificationPrompt = false;
  }
}
