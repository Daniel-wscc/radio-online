import { Component, OnInit, ViewChild, ChangeDetectorRef, AfterViewInit, OnDestroy, DestroyRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { YouTubePlayer, YouTubePlayerModule } from '@angular/youtube-player';
import { DragDropModule } from '@angular/cdk/drag-drop';
import { ScrollingModule } from '@angular/cdk/scrolling';
import { RadioSyncService, RadioState } from '../services/radio-sync.service';
import { CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import { ChatService } from '../services/chat.service';
import { ThemeSwitcherComponent } from '../shared/theme-switcher/theme-switcher.component';
import { take } from 'rxjs/operators';
import { Subject } from 'rxjs';
import { debounceTime } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

@Component({
  selector: 'app-youtube-radio',
  templateUrl: './youtube-radio.component.html',
  styleUrls: ['./youtube-radio.component.less'],
  imports: [
    CommonModule,
    FormsModule,
    YouTubePlayerModule,
    DragDropModule,
    ScrollingModule,
    ThemeSwitcherComponent
  ],
  standalone: true
})
export class YoutubeRadioComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('youtubePlayer', { static: false }) youtubePlayer?: YouTubePlayer;

  urlInput: string = '';
  playlist: Array<{ id: string, title?: string }> = [];
  currentVideoId: string | null = null;
  currentIndex: number = -1;

  playerConfig: YT.PlayerVars = {
    autoplay: 0,
    controls: 1,
    modestbranding: 1,
    rel: 0,
    fs: 1,
    enablejsapi: 1
  };

  isDarkTheme = false;

  videoWidth: number | undefined;
  videoHeight: number | undefined;

  private isPlayerReady = false;
  private maxRetries = 5;
  private retryCount = 0;
  private suppressIndexUpdatesUntil = 0;
  private destroyRef = inject(DestroyRef);

  private capturePlaybackSnapshot() {
    try {
      const player = this.getCurrentPlayer();
      const seconds = player && typeof (player as any).getCurrentTime === 'function' ? (player as any).getCurrentTime() : 0;
      return {
        videoId: this.currentVideoId,
        seconds: typeof seconds === 'number' ? seconds : 0,
        wasPlaying: this.isPlaying
      };
    } catch {
      return { videoId: this.currentVideoId, seconds: 0, wasPlaying: this.isPlaying };
    }
  }

  private restorePlaybackSnapshot(snapshot: { videoId: string | null, seconds: number, wasPlaying: boolean }) {
    if (!snapshot || !snapshot.videoId || snapshot.videoId !== this.currentVideoId) return;
    const player = this.getCurrentPlayer();
    if (!player || !this.isPlayerReady) return;
    try {
      if (typeof (player as any).seekTo === 'function') {
        (player as any).seekTo(Math.max(0, snapshot.seconds), true);
      }
      if (snapshot.wasPlaying && typeof (player as any).playVideo === 'function') {
        (player as any).playVideo();
      }
    } catch {}
  }

  isChatOpen = false;
  isPlayerExpanded = false;
  isPlaying = false;
  volume = 1;
  isMuted = false;
  Math = Math;

  // 音量防抖相關
  private volumeChangeSubject = new Subject<number>();
  private volumeDebounceTime = 300;

  // 播放清單管理相關
  availablePlaylists: any[] = [];
  playlistThumbnails: { [playlistId: number]: string[] } = {};
  playlistItemCounts: { [playlistId: number]: number } = {};
  showAddToPlaylistModal = false;
  selectedVideoForPlaylist: { id: string, title: string } | null = null;

  // Toast 通知相關
  toastMessage = '';
  toastType: 'success' | 'error' | 'info' = 'info';
  showToast = false;

  // resize handler（存為 property 以便正確移除）
  private boundOnResize = this.onResize.bind(this);

  // 獲取當前播放器
  private getCurrentPlayer(): YouTubePlayer | null {
    if (!this.youtubePlayer) {
      return null;
    }
    return this.youtubePlayer;
  }

  constructor(
    private radioSync: RadioSyncService,
    private chatService: ChatService,
    private cdr: ChangeDetectorRef,
    private router: Router
  ) {
    // 設置音量防抖訂閱
    this.volumeChangeSubject.pipe(
      debounceTime(this.volumeDebounceTime),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe((volume: number) => {
      this.applyVolumeChange(volume);
    });

    // 訂閱狀態更新
    this.radioSync.radioState$.pipe(
      takeUntilDestroyed(this.destroyRef)
    ).subscribe((state: RadioState) => {
      if (state.youtubeState) {
        const youtubeState = state.youtubeState;

        // 避免無限循環：只有當播放清單有變化時才更新
        const newPlaylist = youtubeState.playlist || [];
        const playlistChanged = !this.playlistsEqual(this.playlist, newPlaylist);

        setTimeout(() => {
          if (playlistChanged) {
            // 保存當前播放狀態
            const wasPlaying = this.isPlaying;
            const oldCurrentIndex = this.currentIndex;
            const oldCurrentVideoId = this.currentVideoId;

            this.playlist = [...newPlaylist];

            // 如果播放清單被清空，需要重置相關狀態
            if (this.playlist.length === 0) {
              this.currentVideoId = null;
              this.currentIndex = -1;
              this.isPlayerReady = false;
            } else {
              // 如果當前索引仍然有效，保持當前播放狀態
              if (oldCurrentIndex >= 0 && oldCurrentIndex < this.playlist.length) {
                const currentVideoStillExists = this.playlist[oldCurrentIndex].id === oldCurrentVideoId;
                if (!currentVideoStillExists) {
                  const newIndex = this.playlist.findIndex(video => video.id === oldCurrentVideoId);
                  if (newIndex !== -1) {
                    this.currentIndex = newIndex;
                  } else {
                    this.currentIndex = 0;
                    this.currentVideoId = this.playlist[0].id;
                  }
                }
              } else if (this.currentIndex === -1 && this.playlist.length > 0) {
                this.currentIndex = 0;
                this.currentVideoId = this.playlist[0].id;
              }

              this.syncPlaylistOnly();
            }
          }

          // 本地剛剛做了重排時，短暫忽略遠端索引/影片ID更新，避免跳動
          if (Date.now() < this.suppressIndexUpdatesUntil) {
            // 保護期內，忽略遠端索引更新
          } else {
            const indexChanged = this.currentIndex !== youtubeState.currentIndex;
            const videoIdChanged = this.currentVideoId !== youtubeState.currentVideoId;

            if (indexChanged || videoIdChanged) {
              const oldVideoId = this.currentVideoId;

              this.currentIndex = youtubeState.currentIndex;

              if (youtubeState.currentVideoId) {
                this.currentVideoId = youtubeState.currentVideoId;
              } else if (this.currentIndex >= 0 && this.currentIndex < this.playlist.length) {
                this.currentVideoId = this.playlist[this.currentIndex].id;
              } else {
                this.currentVideoId = null;
              }

              const videoActuallyChanged = oldVideoId !== this.currentVideoId;
              if (videoActuallyChanged && youtubeState.isYoutubeMode && this.currentVideoId && this.isPlayerReady && !this.isComponentInitializing) {
                this.safePlayVideo();
              }
            }
          }

          // 如果切換到 YouTube 模式且狀態顯示正在播放，確保播放器開始播放
          if (youtubeState.isYoutubeMode && state.isPlaying && this.currentVideoId && this.isPlayerReady && !this.isComponentInitializing) {
            this.safePlayVideo();
          }

          // 同步音量狀態
          if (typeof state.volume === 'number' && state.volume !== this.volume) {
            this.volume = state.volume;
            this.isMuted = this.volume === 0;

            const currentPlayer = this.getCurrentPlayer();
            if (currentPlayer && this.isPlayerReady) {
              try {
                currentPlayer.setVolume(this.volume * 100);
                if (this.isMuted) {
                  currentPlayer.mute();
                } else {
                  currentPlayer.unMute();
                }
              } catch (error) {
                console.error('同步音量失敗:', error);
              }
            }
          }

          this.cdr.markForCheck();
        });
      }
    });

    // 監聽聊天室狀態
    this.chatService.chatVisible$.pipe(
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(visible => {
      this.isChatOpen = visible;
      this.cdr.markForCheck();
    });

    // 監聽從伺服器載入的播放清單
    this.radioSync.onPlaylistLoaded().pipe(
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(data => {
      if (Array.isArray(data) && !this.isLoadingPlaylist) {
        this.isLoadingPlaylist = true;

        const newPlaylist = data.map(item => ({
          id: item.videoId,
          title: item.title || item.videoId
        }));

        if (!this.playlistsEqual(this.playlist, newPlaylist)) {
          this.playlist = newPlaylist;

          if (this.currentIndex === -1 && this.playlist.length > 0) {
            this.playIndex(0);
          } else if (this.currentIndex >= 0 && this.currentIndex < this.playlist.length) {
            if (!this.currentVideoId) {
              this.currentVideoId = this.playlist[this.currentIndex].id;
            }
            this.syncPlaylistOnly();
          } else {
            this.syncPlaylistOnly();
          }
        }

        setTimeout(() => {
          this.isLoadingPlaylist = false;
        }, 1000);

        this.cdr.markForCheck();
      }
    });

    // 監聽播放清單列表載入
    this.radioSync.onPlaylistsLoaded().pipe(
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(data => {
      if (Array.isArray(data)) {
        this.availablePlaylists = data;
        this.loadPlaylistThumbnails();
        this.cdr.markForCheck();
      }
    });

    // 監聽歌曲新增到播放清單的結果
    this.radioSync.onSongAddedToPlaylist().pipe(
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(result => {
      if (result.success) {
        this.showToastMessage('歌曲已成功加入播放清單！', 'success');
        this.closeAddToPlaylistModal();
      } else {
        this.showToastMessage('加入播放清單失敗：' + result.error, 'error');
      }
    });

    // 監聽播放清單詳情載入（用於獲取縮圖）
    this.radioSync.onPlaylistDetailLoaded().pipe(
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(data => {
      if (data.playlist && data.items) {
        const playlistId = data.playlist.id;
        const thumbnails = data.items.slice(0, 4).map((item: any) =>
          `https://img.youtube.com/vi/${item.videoId}/mqdefault.jpg`
        );
        this.playlistThumbnails[playlistId] = thumbnails;
        this.playlistItemCounts[playlistId] = data.items.length;
        this.cdr.markForCheck();
      }
    });

    // 監聽播放清單清除事件
    this.radioSync.onPlaylistCleared().pipe(
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(data => {
      if (data.success) {
        this.playlist = [];
        this.currentIndex = -1;
        this.currentVideoId = null;

        if (this.youtubePlayer && this.youtubePlayer.stopVideo) {
          this.youtubePlayer.stopVideo();
        }

        this.cdr.markForCheck();
      } else {
        console.error('清除播放清單失敗:', data.error);
      }
    });
  }

  /** 比較兩個播放清單是否相同（避免 JSON.stringify） */
  private playlistsEqual(a: Array<{ id: string, title?: string }>, b: Array<{ id: string, title?: string }>): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i].id !== b[i].id) return false;
    }
    return true;
  }

  private isLoadingPlaylist = false;
  private isComponentInitializing = true;

  ngOnInit() {
    // 載入 YouTube IFrame API - 確保只載入一次
    this.loadYouTubeAPI();

    // 當切換到YouTube模式時，從伺服器載入播放清單
    if (!this.isLoadingPlaylist) {
      this.isLoadingPlaylist = true;
      this.radioSync.loadPlaylist();
      setTimeout(() => {
        this.isLoadingPlaylist = false;
      }, 1000);
    }

    // 載入可用的播放清單用於快速訪問
    this.loadAvailablePlaylists();

    // 延遲設置初始化完成標誌，避免在狀態同步時重複播放
    setTimeout(() => {
      this.isComponentInitializing = false;
    }, 2000);
  }

  // 載入 YouTube IFrame API
  private loadYouTubeAPI(): void {
    if ((window as any).YT && (window as any).YT.Player) {
      return;
    }

    if (document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
      return;
    }

    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    tag.async = true;
    tag.defer = true;

    tag.onerror = (error) => {
      console.error('YouTube API script 載入失敗:', error);
    };

    const firstScriptTag = document.getElementsByTagName('script')[0];
    if (firstScriptTag && firstScriptTag.parentNode) {
      firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
    } else {
      document.head.appendChild(tag);
    }
  }

  ngAfterViewInit(): void {
    this.onResize();
    window.addEventListener('resize', this.boundOnResize);

    // 初始化播放器位置
    setTimeout(() => {
      this.updatePlayerPosition();
    }, 100);

    // 暴露音量檢查方法到 window
    (window as any).checkVolume = () => {
      const player = this.getCurrentPlayer();
      console.log('目前元件記錄音量 (this.volume):', this.volume);
      console.log('目前元件記錄靜音狀態 (this.isMuted):', this.isMuted);

      if (player) {
        const playerVolume = (player as any).getVolume ? (player as any).getVolume() : 'Unknown';
        const playerMuted = (player as any).isMuted ? (player as any).isMuted() : 'Unknown';
        console.log('實際播放器音量 (0-100):', playerVolume);
        console.log('實際播放器靜音狀態:', playerMuted);
      } else {
        console.log('播放器實例未找到');
      }
    };
  }

  onResize(): void {
    this.videoWidth = 640;
    this.videoHeight = 360;
    this.cdr.markForCheck();

    setTimeout(() => {
      this.updatePlayerPosition();
    }, 100);
  }

  async loadPlaylist() {
    if (!this.urlInput) return;

    const urls = this.urlInput.split('\n').filter(url => url.trim());
    const newVideos: Array<{ id: string, title?: string }> = [];

    const videoIds = urls
      .map(url => this.extractVideoId(url))
      .filter(id => id) as string[];

    try {
      const titles = await Promise.all(
        videoIds.map(id => this.getVideoTitle(id))
      );

      newVideos.push(...videoIds.map((id, index) => ({
        id,
        title: titles[index] || id
      })));

      const wasEmpty = this.playlist.length === 0;

      this.playlist = [...this.playlist, ...newVideos];
      this.urlInput = '';

      this.cdr.markForCheck();

      if (wasEmpty && this.playlist.length > 0) {
        this.isPlayerReady = false;
        this.currentVideoId = this.playlist[0].id;
        this.currentIndex = 0;

        setTimeout(() => {
          this.cdr.detectChanges();
        }, 100);
      } else if (this.currentIndex === -1 && this.playlist.length > 0) {
        this.currentVideoId = this.playlist[0].id;
        this.currentIndex = 0;
      }

      this.syncPlaylistOnly();
    } catch (error) {
      console.error('Error processing URLs:', error);
    }
  }

  private async getVideoTitle(videoId: string): Promise<string> {
    try {
      const response = await fetch(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${videoId}`);
      const data = await response.json();
      return data.title || '';
    } catch (error) {
      console.error('Error fetching video title:', error);
      return '';
    }
  }

  clearPlaylist() {
    this.playlist = [];
    this.currentVideoId = null;
    this.currentIndex = -1;
    this.urlInput = '';
    this.isPlayerReady = false;

    this.cdr.markForCheck();

    this.syncYoutubeState();

    // 清除伺服器上的播放清單
    this.radioSync.clearPlaylist();
  }

  private extractVideoId(url: string): string {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : '';
  }

  playIndex(index: number) {
    if (index >= 0 && index < this.playlist.length) {
      this.currentIndex = index;
      this.currentVideoId = this.playlist[index].id;

      this.retryCount = 0;

      if (this.isPlayerReady) {
        this.safePlayVideo();
      }
      this.syncPlaybackState();
    }
  }

  playNext() {
    if (this.playlist.length === 0) return;

    if (this.currentIndex >= this.playlist.length - 1) {
      this.currentIndex = 0;
    } else {
      this.currentIndex++;
    }

    this.currentVideoId = this.playlist[this.currentIndex].id;
    if (this.isPlayerReady) {
      this.safePlayVideo();
    }
    this.syncPlaybackState();
  }

  playPrevious() {
    if (this.currentIndex > 0) {
      this.playIndex(this.currentIndex - 1);
    }
  }

  removeFromPlaylist(index: number) {
    this.playlist.splice(index, 1);
    if (index === this.currentIndex) {
      if (this.playlist.length > 0) {
        this.playIndex(Math.min(index, this.playlist.length - 1));
      } else {
        this.currentVideoId = null;
        this.currentIndex = -1;
        this.syncYoutubeState();
      }
    } else if (index < this.currentIndex) {
      this.currentIndex--;
      this.syncPlaylistOnly();
    } else {
      this.syncYoutubeState();
    }
  }

  onPlayerStateChange(event: YT.OnStateChangeEvent) {
    const playerState = event.target.getPlayerState();

    this.isPlaying = playerState === YT.PlayerState.PLAYING;

    // 當狀態變為 PLAYING 時，確保音量正確
    if (playerState === YT.PlayerState.PLAYING) {
      setTimeout(() => {
        const player = this.getCurrentPlayer();
        if (player) {
          try {
            player.setVolume(this.volume * 100);
            if (this.isMuted) {
              player.mute();
            } else {
              player.unMute();
            }
          } catch (error) {
            console.error('播放時同步音量失敗:', error);
          }
        }
      }, 500);
    }

    if (playerState === YT.PlayerState.ENDED) {
      if (this.currentIndex >= this.playlist.length - 1) {
        this.currentIndex = 0;
      } else {
        this.currentIndex++;
      }

      this.currentVideoId = this.playlist[this.currentIndex].id;
      if (this.isPlayerReady) {
        this.safePlayVideo();
      }
      this.syncPlaybackState();
    } else {
      this.syncPlaybackState();
    }
  }

  private syncYoutubeState(sendAddPlaylist = true) {
    if (this.isComponentInitializing) {
      return;
    }

    if (sendAddPlaylist && this.playlist.length > 0) {
      this.radioSync.addPlaylist(this.playlist);
    }

    const newState = {
      isPlaying: this.isPlaying,
      volume: this.isMuted ? 0 : this.volume,
      youtubeState: {
        isYoutubeMode: true,
        playlist: this.playlist,
        currentIndex: this.currentIndex,
        currentVideoId: this.currentVideoId
      }
    };

    this.radioSync.updateState(newState);
  }

  private syncPlaylistOnly() {
    if (this.isComponentInitializing) {
      return;
    }

    if (this.playlist.length > 0) {
      this.radioSync.addPlaylist(this.playlist);
    }
  }

  // 同步播放索引和影片ID（也用於音量同步），不發送播放清單
  private syncPlaybackState() {
    if (this.isComponentInitializing) {
      return;
    }

    this.radioSync.updateLightweightState({
      isPlaying: this.isPlaying,
      volume: this.isMuted ? 0 : this.volume,
      youtubeState: {
        isYoutubeMode: true,
        currentIndex: this.currentIndex,
        currentVideoId: this.currentVideoId
      }
    });
  }

  onPlayerReady(event: YT.PlayerEvent) {
    if (!event.target) {
      console.error('播放器實例不存在');
      return;
    }

    this.isPlayerReady = true;

    // 設置初始音量
    try {
      event.target.setVolume(this.volume * 100);
      if (this.isMuted) {
        event.target.mute();
      }
    } catch (error) {
      console.error('設置初始音量失敗:', error);
    }

    if (this.playlist.length === 0) {
      return;
    }

    // 如果沒有當前影片但有播放清單，設置第一個影片但不自動播放
    if (!this.currentVideoId && this.playlist.length > 0) {
      this.currentVideoId = this.playlist[0].id;
      this.currentIndex = 0;

      try {
        event.target.cueVideoById(this.currentVideoId);
      } catch (error) {
        console.error('載入影片失敗:', error);
      }
    }

    if (this.currentVideoId) {
      this.getVideoTitle(this.currentVideoId!).then(title => {
        if (title && this.currentIndex !== -1 && this.currentIndex < this.playlist.length) {
          this.playlist[this.currentIndex].title = title;
          this.syncPlaylistOnly();
        }
      });

      // 只有在明確需要播放時才開始播放
      setTimeout(() => {
        try {
          const state = this.radioSync.currentState;
          if (state.youtubeState?.isYoutubeMode && state.isPlaying) {
            event.target.playVideo();
          }
        } catch (error) {
          console.error('檢查播放狀態時發生錯誤:', error);
        }
      }, 100);
    }
  }

  private safePlayVideo() {
    const currentPlayer = this.getCurrentPlayer();
    if (currentPlayer && this.isPlayerReady && this.currentVideoId) {
      try {
        const playerState = currentPlayer.getPlayerState();

        if (playerState !== 1 && playerState !== 3) {
          currentPlayer.playVideo();
        }
        this.retryCount = 0;
      } catch (error) {
        this.retryCount++;
        console.error(`播放失敗，第 ${this.retryCount} 次重試:`, error);
        if (this.retryCount < this.maxRetries) {
          setTimeout(() => this.safePlayVideo(), 1000);
        } else {
          console.error('播放失敗，已達最大重試次數');
          this.retryCount = 0;
        }
      }
    } else if (this.retryCount < this.maxRetries && this.currentVideoId) {
      this.retryCount++;
      setTimeout(() => this.safePlayVideo(), 1000);
    } else {
      this.retryCount = 0;
    }
  }

  onDrop(event: CdkDragDrop<any[]>) {
    const playbackSnapshot = this.capturePlaybackSnapshot();
    // 更新當前播放索引
    if (this.currentIndex === event.previousIndex) {
      this.currentIndex = event.currentIndex;
    } else if (this.currentIndex > event.previousIndex && this.currentIndex <= event.currentIndex) {
      this.currentIndex--;
    } else if (this.currentIndex < event.previousIndex && this.currentIndex >= event.currentIndex) {
      this.currentIndex++;
    }

    moveItemInArray(this.playlist, event.previousIndex, event.currentIndex);
    // 設置本地重排保護期
    this.suppressIndexUpdatesUntil = Date.now() + 800;

    this.syncPlaylistOnly();
    this.syncPlaybackState();

    // 恢復播放進度
    setTimeout(() => this.restorePlaybackSnapshot(playbackSnapshot), 100);
  }

  shufflePlaylist() {
    const currentVideo = this.currentIndex !== -1 ? this.playlist[this.currentIndex] : null;

    // Fisher-Yates 洗牌算法
    for (let i = this.playlist.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.playlist[i], this.playlist[j]] = [this.playlist[j], this.playlist[i]];
    }

    if (currentVideo) {
      this.currentIndex = this.playlist.findIndex(video => video.id === currentVideo.id);
    }

    this.syncPlaylistOnly();
  }

  togglePlayer() {
    this.isPlayerExpanded = !this.isPlayerExpanded;
    this.cdr.markForCheck();

    setTimeout(() => {
      this.updatePlayerPosition();
    }, 50);
  }

  private updatePlayerPosition() {
    const playerContainer = document.querySelector('.youtube-player-container');
    const targetContainer = document.getElementById('video-target');

    if (!playerContainer || !targetContainer) return;

    const playerElement = playerContainer as HTMLElement;

    if (this.isPlayerExpanded) {
      const targetRect = targetContainer.getBoundingClientRect();

      playerElement.style.position = 'fixed';
      playerElement.style.top = `${targetRect.top}px`;
      playerElement.style.left = `${targetRect.left}px`;
      playerElement.style.width = `${targetRect.width}px`;
      playerElement.style.height = `${targetRect.height}px`;
      playerElement.style.zIndex = '1000';
      playerElement.style.borderRadius = '12px';
      playerElement.style.overflow = 'hidden';
      playerElement.style.boxShadow = '0 8px 32px hsl(var(--bc) / 0.2)';
      playerElement.style.background = '#000';
    } else {
      playerElement.removeAttribute('style');
      playerElement.offsetHeight;
    }
  }

  togglePlayPause() {
    if (this.playlist.length === 0) {
      this.showToastMessage('請先添加影片到播放清單', 'info');
      return;
    }

    const currentPlayer = this.getCurrentPlayer();

    if (currentPlayer) {
      try {
        if (!this.currentVideoId && this.playlist.length > 0) {
          this.playIndex(0);
          return;
        }
        if (this.currentVideoId) {
          const playerState = currentPlayer.getPlayerState();
          if (playerState === YT.PlayerState.PLAYING) {
            currentPlayer.pauseVideo();
          } else if (playerState !== -1) {
            currentPlayer.playVideo();
          } else {
            this.showToastMessage('播放器正在初始化，請稍候再試', 'info');
          }
        } else {
          this.showToastMessage('沒有影片可播放，請先添加影片到播放清單', 'info');
        }
      } catch (error) {
        console.error('Error toggling play/pause:', error);
        this.showToastMessage('播放控制發生錯誤', 'error');
      }
    } else {
      this.showToastMessage('播放器正在載入，請稍候再試', 'info');
    }
  }

  getCurrentVideoTitle(): string {
    if (this.currentIndex >= 0 && this.currentIndex < this.playlist.length) {
      return this.playlist[this.currentIndex].title || this.playlist[this.currentIndex].id;
    }
    if (this.playlist.length > 0) {
      return '請選擇要播放的影片';
    }
    return '請添加影片到播放清單';
  }

  // 音量控制方法
  onVolumeChange(value: number) {
    this.volume = value / 10;
    this.isMuted = this.volume === 0;

    this.volumeChangeSubject.next(this.volume);
  }

  // 應用音量變更（防抖後執行）
  private applyVolumeChange(volume: number) {
    const currentPlayer = this.getCurrentPlayer();
    if (currentPlayer && this.isPlayerReady) {
      try {
        currentPlayer.setVolume(volume * 100);
        if (this.isMuted) {
          currentPlayer.mute();
        } else {
          currentPlayer.unMute();
        }
      } catch (error) {
        console.error('設置音量失敗:', error);
      }
    }

    // 同步音量狀態到伺服器（不發送播放清單）
    this.syncPlaybackState();
  }

  toggleMute() {
    this.isMuted = !this.isMuted;

    const currentPlayer = this.getCurrentPlayer();
    if (currentPlayer && this.isPlayerReady) {
      try {
        if (this.isMuted) {
          currentPlayer.mute();
        } else {
          currentPlayer.unMute();
        }
      } catch (error) {
        console.error('切換靜音失敗:', error);
      }
    }

    this.syncPlaybackState();
  }

  goToPlaylistManager() {
    this.router.navigate(['/playlists']);
  }

  loadAvailablePlaylists() {
    this.radioSync.getPlaylists();
  }

  loadPlaylistThumbnails() {
    this.availablePlaylists.forEach(playlist => {
      this.radioSync.getPlaylistDetail(playlist.id);
    });
  }

  openAddToPlaylistModal(video: { id: string, title?: string }) {
    this.selectedVideoForPlaylist = {
      id: video.id,
      title: video.title || video.id
    };
    this.showAddToPlaylistModal = true;

    this.radioSync.getPlaylists();
  }

  closeAddToPlaylistModal() {
    this.showAddToPlaylistModal = false;
    this.selectedVideoForPlaylist = null;
  }

  addToPlaylist(playlistId: number) {
    if (this.selectedVideoForPlaylist) {
      this.radioSync.addSongToPlaylist(
        playlistId,
        this.selectedVideoForPlaylist.id,
        this.selectedVideoForPlaylist.title
      );
    }
  }

  goToPlaylist(playlistId: number) {
    this.router.navigate(['/playlist', playlistId]);
  }

  getDisplayPlaylists(): any[] {
    const maxDisplay = window.innerWidth >= 1024 ? 4 : 3;
    return this.availablePlaylists.slice(0, maxDisplay);
  }

  getPlaylistThumbnails(playlistId: number): string[] {
    return this.playlistThumbnails[playlistId] || [];
  }

  getPlaylistItemCount(playlistId: number): number {
    return this.playlistItemCounts[playlistId] || 0;
  }

  showToastMessage(message: string, type: 'success' | 'error' | 'info' = 'info') {
    this.toastMessage = message;
    this.toastType = type;
    this.showToast = true;

    setTimeout(() => {
      this.showToast = false;
      this.cdr.markForCheck();
    }, 3000);

    this.cdr.markForCheck();
  }

  ngOnDestroy() {
    this.volumeChangeSubject.complete();
    window.removeEventListener('resize', this.boundOnResize);
    delete (window as any).checkVolume;
  }

}
