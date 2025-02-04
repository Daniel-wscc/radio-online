import { Component } from '@angular/core';
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
export class ChatDrawerComponent {
  newMessage = '';
  messages$;
  unreadCount = 0;
  
  constructor(private chatService: ChatService) {
    this.messages$ = this.chatService.messages$;
    
    // 修改監聽邏輯，只在有新訊息時增加未讀數
    this.messages$.subscribe(messages => {
      // 只有在有訊息且聊天室關閉時才增加未讀數
      if (!this.visible && messages && messages.length > 0) {
        // 使用上一次的訊息長度來判斷是否真的有新訊息
        if (!this.lastMessageCount || messages.length > this.lastMessageCount) {
          this.unreadCount++;
        }
        this.lastMessageCount = messages.length;
      }
    });
  }

  visible = false;

  // 添加新的屬性來追蹤訊息數量
  private lastMessageCount = 0;

  // 重置未讀數時也重置最後訊息數
  onCollapsedChange(event: boolean) {
    this.visible = !event;
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
} 