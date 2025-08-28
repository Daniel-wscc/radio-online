import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { RadioSyncService } from '../services/radio-sync.service';
import { Subscription } from 'rxjs';

interface Playlist {
  id: number;
  name: string;
  description: string;
  createdAt: number;
  updatedAt: number;
}

@Component({
  selector: 'app-playlist-manager',
  templateUrl: './playlist-manager.component.html',
  styleUrls: ['./playlist-manager.component.less'],
  imports: [CommonModule, FormsModule],
  standalone: true
})
export class PlaylistManagerComponent implements OnInit, OnDestroy {
  playlists: Playlist[] = [];
  isLoading = false;
  showCreateModal = false;
  newPlaylistName = '';
  newPlaylistDescription = '';
  
  private subscriptions: Subscription[] = [];

  constructor(
    private radioSync: RadioSyncService,
    private router: Router,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit() {
    this.loadPlaylists();
    this.setupSubscriptions();
  }

  ngOnDestroy() {
    this.subscriptions.forEach(sub => sub.unsubscribe());
  }

  private setupSubscriptions() {
    // 監聽播放清單列表載入
    this.subscriptions.push(
      this.radioSync.onPlaylistsLoaded().subscribe(data => {
        this.isLoading = false;
        if (Array.isArray(data)) {
          this.playlists = data;
        } else if (data.error) {
          console.error('載入播放清單失敗:', data.error);
        }
        this.cdr.markForCheck();
      })
    );

    // 監聽播放清單創建結果
    this.subscriptions.push(
      this.radioSync.onPlaylistCreated().subscribe(result => {
        if (result.success) {
          this.playlists.unshift(result.playlist);
          this.closeCreateModal();
          this.cdr.markForCheck();
        } else {
          console.error('創建播放清單失敗:', result.error);
          alert('創建播放清單失敗: ' + result.error);
        }
      })
    );

    // 監聽播放清單刪除結果
    this.subscriptions.push(
      this.radioSync.onPlaylistDeleted().subscribe(result => {
        if (result.success) {
          this.playlists = this.playlists.filter(p => p.id !== result.playlistId);
          this.cdr.markForCheck();
        } else {
          console.error('刪除播放清單失敗:', result.error);
          alert('刪除播放清單失敗: ' + result.error);
        }
      })
    );
  }

  loadPlaylists() {
    this.isLoading = true;
    this.radioSync.getPlaylists();
  }

  openCreateModal() {
    this.showCreateModal = true;
    this.newPlaylistName = '';
    this.newPlaylistDescription = '';
  }

  closeCreateModal() {
    this.showCreateModal = false;
    this.newPlaylistName = '';
    this.newPlaylistDescription = '';
  }

  createPlaylist() {
    if (!this.newPlaylistName.trim()) {
      alert('請輸入播放清單名稱');
      return;
    }

    this.radioSync.createPlaylist(this.newPlaylistName.trim(), this.newPlaylistDescription.trim());
  }

  deletePlaylist(playlist: Playlist) {
    if (confirm(`確定要刪除播放清單「${playlist.name}」嗎？此操作無法復原。`)) {
      this.radioSync.deletePlaylist(playlist.id);
    }
  }

  openPlaylist(playlist: Playlist) {
    this.router.navigate(['/playlist', playlist.id]);
  }

  goBack() {
    this.router.navigate(['/']);
  }

  formatDate(timestamp: number): string {
    return new Date(timestamp).toLocaleDateString('zh-TW', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  }
}
