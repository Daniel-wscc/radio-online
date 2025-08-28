import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { RadioSyncService } from '../services/radio-sync.service';
import { Subscription } from 'rxjs';

interface Playlist {
  id: number;
  name: string;
  description: string;
  createdAt: number;
  updatedAt: number;
}

interface PlaylistItem {
  id: number;
  playlistId: number;
  videoId: string;
  title: string;
  addedAt: number;
  sortOrder: number;
}

@Component({
  selector: 'app-playlist-detail',
  templateUrl: './playlist-detail.component.html',
  styleUrls: ['./playlist-detail.component.less'],
  imports: [CommonModule, FormsModule],
  standalone: true
})
export class PlaylistDetailComponent implements OnInit, OnDestroy {
  playlist: Playlist | null = null;
  items: PlaylistItem[] = [];
  isLoading = false;
  playlistId: number = 0;

  // 新增歌曲相關
  showAddSongModal = false;
  urlInput = '';

  // 批量新增追蹤
  private pendingAdditions = 0;
  private successfulAdditions = 0;
  private failedAdditions = 0;

  // Toast 通知相關
  toastMessage = '';
  toastType: 'success' | 'error' | 'info' = 'info';
  showToast = false;

  private subscriptions: Subscription[] = [];

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private radioSync: RadioSyncService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit() {
    this.route.params.subscribe(params => {
      this.playlistId = +params['id'];
      if (this.playlistId) {
        this.loadPlaylistDetail();
      }
    });
    
    this.setupSubscriptions();
  }

  ngOnDestroy() {
    this.subscriptions.forEach(sub => sub.unsubscribe());
  }

  private setupSubscriptions() {
    // 監聽播放清單詳情載入
    this.subscriptions.push(
      this.radioSync.onPlaylistDetailLoaded().subscribe(data => {
        this.isLoading = false;
        if (data.error) {
          console.error('載入播放清單詳情失敗:', data.error);
          alert('載入播放清單詳情失敗: ' + data.error);
          this.goBack();
        } else {
          this.playlist = data.playlist;
          this.items = data.items || [];
        }
        this.cdr.markForCheck();
      })
    );

    // 監聽歌曲移除結果
    this.subscriptions.push(
      this.radioSync.onSongRemovedFromPlaylist().subscribe(result => {
        if (result.success) {
          this.items = this.items.filter(item => item.id !== result.itemId);
          this.cdr.markForCheck();
        } else {
          console.error('移除歌曲失敗:', result.error);
          alert('移除歌曲失敗: ' + result.error);
        }
      })
    );

    // 監聽歌曲新增結果
    this.subscriptions.push(
      this.radioSync.onSongAddedToPlaylist().subscribe(result => {
        if (result.success) {
          this.items.push(result.item);
          this.successfulAdditions++;
        } else {
          console.error('新增歌曲失敗:', result.error);
          this.failedAdditions++;
        }

        this.pendingAdditions--;

        // 當所有新增操作完成時，顯示結果
        if (this.pendingAdditions === 0) {
          this.showBatchAddResult();
          this.closeAddSongModal();
        }

        this.cdr.markForCheck();
      })
    );
  }

  loadPlaylistDetail() {
    this.isLoading = true;
    this.radioSync.getPlaylistDetail(this.playlistId);
  }

  addToCurrentQueue() {
    if (this.items.length === 0) {
      alert('播放清單是空的');
      return;
    }

    // 將播放清單中的所有歌曲加入到當前播放佇列
    const playlist = this.items.map(item => ({
      id: item.videoId,
      title: item.title || item.videoId
    }));

    // 使用現有的 addPlaylist 方法來加入歌曲到當前播放佇列
    this.radioSync.addPlaylist(playlist);
    
    // 顯示成功訊息並返回
    alert(`已將 ${this.items.length} 首歌曲加入到播放佇列`);
    this.goBack();
  }

  addSingleToQueue(item: PlaylistItem) {
    // 將單首歌曲加入到當前播放佇列
    const singleSong = [{
      id: item.videoId,
      title: item.title || item.videoId
    }];

    this.radioSync.addPlaylist(singleSong);
    alert('已將歌曲加入到播放佇列');
  }

  removeSong(item: PlaylistItem) {
    if (confirm(`確定要從播放清單中移除「${item.title || item.videoId}」嗎？`)) {
      this.radioSync.removeSongFromPlaylist(this.playlistId, item.id);
    }
  }

  goBack() {
    this.router.navigate(['/playlists']);
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

  getYoutubeThumbnail(videoId: string): string {
    return `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;
  }

  openYouTubeVideo(videoId: string) {
    window.open(`https://www.youtube.com/watch?v=${videoId}`, '_blank');
  }

  // 新增歌曲相關方法
  openAddSongModal() {
    this.showAddSongModal = true;
    this.urlInput = '';
  }

  closeAddSongModal() {
    this.showAddSongModal = false;
    this.urlInput = '';
  }

  async addSongsToPlaylist() {
    if (!this.urlInput.trim()) {
      alert('請輸入 YouTube 網址');
      return;
    }

    const urls = this.urlInput.split('\n').filter(url => url.trim());

    // 重置計數器
    this.pendingAdditions = 0;
    this.successfulAdditions = 0;
    this.failedAdditions = 0;

    // 計算有效的 URL 數量
    const validUrls = urls.filter(url => this.extractVideoId(url));
    this.pendingAdditions = validUrls.length;

    if (this.pendingAdditions === 0) {
      alert('沒有找到有效的 YouTube 網址');
      return;
    }

    // 批量處理
    for (const url of validUrls) {
      const videoId = this.extractVideoId(url);
      if (videoId) {
        try {
          const title = await this.getVideoTitle(videoId);
          this.radioSync.addSongToPlaylist(this.playlistId, videoId, title);
        } catch (error) {
          console.error('獲取影片標題失敗:', error);
          this.radioSync.addSongToPlaylist(this.playlistId, videoId, videoId);
        }
      }
    }
  }

  private showBatchAddResult() {
    let message = '';
    let type: 'success' | 'error' | 'info' = 'info';

    if (this.successfulAdditions > 0 && this.failedAdditions === 0) {
      message = `成功新增 ${this.successfulAdditions} 首歌曲到播放清單！`;
      type = 'success';
    } else if (this.successfulAdditions > 0 && this.failedAdditions > 0) {
      message = `成功新增 ${this.successfulAdditions} 首歌曲，${this.failedAdditions} 首失敗`;
      type = 'info';
    } else if (this.failedAdditions > 0) {
      message = `新增失敗，${this.failedAdditions} 首歌曲無法加入播放清單`;
      type = 'error';
    }

    if (message) {
      // 使用 toast 通知替代 alert
      this.showToastMessage(message, type);
    }
  }

  // Toast 通知方法
  showToastMessage(message: string, type: 'success' | 'error' | 'info' = 'info') {
    this.toastMessage = message;
    this.toastType = type;
    this.showToast = true;

    // 5 秒後自動隱藏（批量操作結果需要更長時間顯示）
    setTimeout(() => {
      this.showToast = false;
      this.cdr.markForCheck();
    }, 5000);

    this.cdr.markForCheck();
  }

  private extractVideoId(url: string): string {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : '';
  }

  private async getVideoTitle(videoId: string): Promise<string> {
    try {
      const response = await fetch(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${videoId}`);
      const data = await response.json();
      return data.title || videoId;
    } catch (error) {
      console.error('Error fetching video title:', error);
      return videoId;
    }
  }
}
