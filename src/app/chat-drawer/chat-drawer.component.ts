import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SidebarModule } from 'primeng/sidebar';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { TooltipModule } from 'primeng/tooltip';
import { ChatService } from '../services/chat.service';
import { PanelModule } from 'primeng/panel';
import { BadgeModule } from 'primeng/badge';
import { ViewEncapsulation } from '@angular/core';

@Component({
  selector: 'app-chat-drawer',
  standalone: true,
  imports: [
    CommonModule, 
    FormsModule, 
    SidebarModule, 
    ButtonModule, 
    InputTextModule,
    TooltipModule,
    PanelModule,
    BadgeModule
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
  
  constructor(private chatService: ChatService) {
    this.messages$ = this.chatService.messages$;
    
    // 修改監聽邏輯，只在有新訊息且不是系統訊息時增加未讀數並顯示通知
    this.messages$.subscribe(messages => {
      if (!this.visible && messages && messages.length > 0) {
        const lastMessage = messages[messages.length - 1];
        // 只有在不是系統訊息時才增加未讀數和顯示通知
        if (!lastMessage.isSystem && (!this.lastMessageCount || messages.length > this.lastMessageCount)) {
          this.unreadCount++;
          this.showNotification(lastMessage);
        }
        this.lastMessageCount = messages.length;
      }
    });
  }

  ngOnInit() {
    // 檢查通知權限
    if ('Notification' in window) {
      this.notificationPermission = Notification.permission;
      this.showNotificationPrompt = this.notificationPermission === 'default';
    }
  }

  // 請求通知權限
  async requestNotificationPermission() {
    if (!('Notification' in window)) {
      console.log('此瀏覽器不支援通知功能');
      return;
    }

    try {
      this.notificationPermission = await Notification.requestPermission();
      this.showNotificationPrompt = this.notificationPermission === 'default';
    } catch (error) {
      console.error('請求通知權限時發生錯誤:', error);
    }
  }

  // 顯示通知
  private showNotification(message: any) {
    if (
      this.notificationPermission === 'granted' && 
      'Notification' in window && 
      document.hidden
    ) {
      const userName = message.userName || '訪客';
      const messageText = message.text || message.content || '發送了一則訊息';  // 根據消息格式調整
      const notification = new Notification('新聊天訊息', {
        body: `${userName}: ${messageText}`,
        icon: '/favicon.ico'
      });

      // 點擊通知時打開聊天視窗
      notification.onclick = () => {
        window.focus();
        this.visible = true;
        this.chatService.setChatVisible(true);
        notification.close();
      };

      // 自動關閉通知
      setTimeout(() => notification.close(), 5000);
    }
  }

  visible = false;

  // 添加新的屬性來追蹤訊息數量
  private lastMessageCount = 0;

  // 重置未讀數時也重置最後訊息數
  onCollapsedChange(event: boolean) {
    this.visible = !event;
    this.chatService.setChatVisible(this.visible);
    if (this.visible) {
        this.unreadCount = 0;
        this.messages$.subscribe(messages => {
            this.lastMessageCount = messages ? messages.length : 0;
        }).unsubscribe();
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

  // 關閉通知提示
  dismissNotificationPrompt() {
    this.showNotificationPrompt = false;
  }
} 