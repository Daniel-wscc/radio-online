import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SidebarModule } from 'primeng/sidebar';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { TooltipModule } from 'primeng/tooltip';
import { ChatService } from '../services/chat.service';

@Component({
  selector: 'app-chat-drawer',
  standalone: true,
  imports: [
    CommonModule, 
    FormsModule, 
    SidebarModule, 
    ButtonModule, 
    InputTextModule,
    TooltipModule
  ],
  templateUrl: './chat-drawer.component.html',
  styles: [`
    :host ::ng-deep .p-sidebar {
      background-color: var(--surface-card);
    }
    
    :host ::ng-deep .p-sidebar.p-sidebar-active {
      background-color: var(--surface-card);
    }
    
    :host ::ng-deep .p-sidebar .p-sidebar-header,
    :host ::ng-deep .p-sidebar .p-sidebar-content {
      background-color: var(--surface-card);
      padding: 0;
      display: flex;
      flex-direction: column;
      height: 100%;
    }

    :host ::ng-deep .dark .p-sidebar,
    :host ::ng-deep .dark .p-sidebar.p-sidebar-active,
    :host ::ng-deep .dark .p-sidebar .p-sidebar-header,
    :host ::ng-deep .dark .p-sidebar .p-sidebar-content {
      background-color: #1f2937 !important; /* Tailwind's gray-800 */
    }
  `]
})
export class ChatDrawerComponent {
  visible = false;
  newMessage = '';
  messages$ = this.chatService.messages$;

  constructor(private chatService: ChatService) {}

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