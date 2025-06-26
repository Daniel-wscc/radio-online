import { Component, OnInit, ViewChild, ChangeDetectorRef, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { YouTubePlayer, YouTubePlayerModule } from '@angular/youtube-player';
import { DragDropModule } from '@angular/cdk/drag-drop';
import { RadioSyncService, RadioState } from '../services/radio-sync.service';
import { CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import { ChatService } from '../services/chat.service';
import { ThemeSwitcherComponent } from '../shared/theme-switcher/theme-switcher.component';
import { take } from 'rxjs/operators';

@Component({
  selector: 'app-youtube-radio',
  templateUrl: './youtube-radio.component.html',
  styleUrls: ['./youtube-radio.component.less'],
  imports: [
    CommonModule,
    FormsModule,
    YouTubePlayerModule,
    DragDropModule,
    ThemeSwitcherComponent
  ],
  standalone: true
})
export class YoutubeRadioComponent implements OnInit, AfterViewInit {
  @ViewChild('youtubePlayer', { static: false }) youtubePlayer!: YouTubePlayer;

  urlInput: string = '';
  playlist: Array<{ id: string, title?: string }> = [];
  currentVideoId: string | null = null;
  currentIndex: number = -1;

  playerConfig = {
    origin: window.location.origin,
    widget_referrer: window.location.href,
    autoplay: 1  // 添加自動播放設定
  };

  isDarkTheme = false;

  videoWidth: number | undefined;
  videoHeight: number | undefined;

  private isPlayerReady = false;  // 新增此變數追蹤播放器狀態
  private maxRetries = 5;  // 最大重試次數
  private retryCount = 0;  // 當前重試次數

  isChatOpen = false;
  isPlayerExpanded = false;  // 播放器展開狀態
  isPlaying = false;  // 播放狀態

  // 播放清單管理相關
  availablePlaylists: any[] = [];
  playlistThumbnails: { [playlistId: number]: string[] } = {}; // 儲存播放清單縮圖
  playlistItemCounts: { [playlistId: number]: number } = {}; // 儲存播放清單歌曲數量
  showAddToPlaylistModal = false;
  selectedVideoForPlaylist: { id: string, title: string } | null = null;

  // Toast 通知相關
  toastMessage = '';
  toastType: 'success' | 'error' | 'info' = 'info';
  showToast = false;



  // 獲取當前播放器
  private getCurrentPlayer(): YouTubePlayer | null {
    return this.youtubePlayer || null;
  }

  constructor(
    private radioSync: RadioSyncService,
    private chatService: ChatService,
    private cdr: ChangeDetectorRef,
    private router: Router
  ) {
    // 訂閱狀態更新
    this.radioSync.radioState$.subscribe((state: RadioState) => {
      if (state.youtubeState) {
        const youtubeState = state.youtubeState;

        // 避免無限循環：只有當播放清單有變化時才更新
        const newPlaylist = youtubeState.playlist || [];
        const playlistChanged = JSON.stringify(this.playlist) !== JSON.stringify(newPlaylist);

        setTimeout(() => {
          if (playlistChanged) {
            this.playlist = [...newPlaylist];
            // 避免空播放清單時發送 addPlaylist
            if (this.playlist.length > 0) {
              this.syncYoutubeState(false); // 傳入 false 表示不要發送 addPlaylist
            }
          }

          // 檢查是否需要更新當前播放的影片
          const indexChanged = this.currentIndex !== youtubeState.currentIndex;
          const videoIdChanged = this.currentVideoId !== youtubeState.currentVideoId;

          if (indexChanged || videoIdChanged) {
            this.currentIndex = youtubeState.currentIndex;

            // 如果伺服器傳來的 currentVideoId 是 null，但我們有播放清單且索引有效，
            // 則從播放清單中獲取正確的 videoId
            if (youtubeState.currentVideoId) {
              this.currentVideoId = youtubeState.currentVideoId;
            } else if (this.currentIndex >= 0 && this.currentIndex < this.playlist.length) {
              this.currentVideoId = this.playlist[this.currentIndex].id;
              console.log('從播放清單中獲取影片ID:', this.currentVideoId, '索引:', this.currentIndex);
            } else {
              this.currentVideoId = null;
            }

            // 如果是 YouTube 模式且有影片要播放，且播放器已準備就緒
            // 但只有在組件初始化完成後才自動播放
            if (youtubeState.isYoutubeMode && this.currentVideoId && this.isPlayerReady && !this.isComponentInitializing) {
              console.log('狀態更新觸發播放');
              this.safePlayVideo();
            }
            // 如果播放器還沒準備好，但有影片要播放，等播放器準備好後會自動播放
          }

          // 如果切換到 YouTube 模式且狀態顯示正在播放，確保播放器開始播放
          // 但只有在組件初始化完成後才自動播放
          if (youtubeState.isYoutubeMode && state.isPlaying && this.currentVideoId && this.isPlayerReady && !this.isComponentInitializing) {
            console.log('播放狀態更新觸發播放');
            this.safePlayVideo();
          }

          this.cdr.detectChanges();
        });
      }
    });

    // 監聽聊天室狀態
    this.chatService.chatVisible$.subscribe(visible => {
      this.isChatOpen = visible;
      this.cdr.detectChanges();
    });

    // 監聽從伺服器載入的播放清單
    this.radioSync.onPlaylistLoaded().subscribe(data => {
      if (Array.isArray(data) && !this.isLoadingPlaylist) {
        this.isLoadingPlaylist = true;

        // 將從伺服器載入的播放清單轉換為正確的格式
        const newPlaylist = data.map(item => ({
          id: item.videoId,
          title: item.title || item.videoId
        }));

        // 只有當播放清單有變化時才更新
        if (JSON.stringify(this.playlist) !== JSON.stringify(newPlaylist)) {
          this.playlist = newPlaylist;

          // 如果目前沒有播放任何影片且播放清單不為空，開始播放第一首
          if (this.currentIndex === -1 && this.playlist.length > 0) {
            this.playIndex(0);
          } else if (this.currentIndex >= 0 && this.currentIndex < this.playlist.length) {
            // 如果有有效的索引但沒有 currentVideoId，從播放清單中獲取
            if (!this.currentVideoId) {
              this.currentVideoId = this.playlist[this.currentIndex].id;
              console.log('載入播放清單後設置影片ID:', this.currentVideoId, '索引:', this.currentIndex);
            }
            this.syncYoutubeState(false); // 傳入 false 表示不要發送 addPlaylist
          } else {
            this.syncYoutubeState(false); // 傳入 false 表示不要發送 addPlaylist
          }
        }

        setTimeout(() => {
          this.isLoadingPlaylist = false;
        }, 1000);

        this.cdr.detectChanges();
      }
    });

    // 監聽播放清單列表載入
    this.radioSync.onPlaylistsLoaded().subscribe(data => {
      if (Array.isArray(data)) {
        this.availablePlaylists = data;
        // 載入每個播放清單的縮圖
        this.loadPlaylistThumbnails();
        this.cdr.detectChanges();
      }
    });

    // 監聽歌曲新增到播放清單的結果
    this.radioSync.onSongAddedToPlaylist().subscribe(result => {
      if (result.success) {
        // 使用 toast 通知替代 alert
        this.showToastMessage('歌曲已成功加入播放清單！', 'success');
        this.closeAddToPlaylistModal();
      } else {
        // 失敗時使用 toast 通知
        this.showToastMessage('加入播放清單失敗：' + result.error, 'error');
      }
    });

    // 監聽播放清單詳情載入（用於獲取縮圖）
    this.radioSync.onPlaylistDetailLoaded().subscribe(data => {
      if (data.playlist && data.items) {
        const playlistId = data.playlist.id;
        const thumbnails = data.items.slice(0, 4).map((item: any) =>
          `https://img.youtube.com/vi/${item.videoId}/mqdefault.jpg`
        );
        this.playlistThumbnails[playlistId] = thumbnails;
        this.playlistItemCounts[playlistId] = data.items.length;
        this.cdr.detectChanges();
      }
    });
  }

  // 添加一個標誌來追蹤是否正在載入播放清單
  private isLoadingPlaylist = false;

  // 添加一個標誌來追蹤組件是否剛初始化
  private isComponentInitializing = true;

  ngOnInit() {
    console.log('YouTube組件初始化');

    // 載入 YouTube IFrame API
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    document.body.appendChild(tag);

    // 當切換到YouTube模式時，從伺服器載入播放清單
    // 避免無限循環：只在初始化時載入一次
    if (!this.isLoadingPlaylist) {
      this.isLoadingPlaylist = true;
      this.radioSync.loadPlaylist();
      setTimeout(() => {
        this.isLoadingPlaylist = false;
      }, 1000);
    }

    // 載入可用的播放清單用於快速訪問
    this.loadAvailablePlaylists();

    // 延迟设置初始化完成标志，避免在状态同步时重复播放
    setTimeout(() => {
      this.isComponentInitializing = false;
      console.log('YouTube組件初始化完成');
    }, 2000);
  }

  ngAfterViewInit(): void {
    this.onResize();
    window.addEventListener('resize', this.onResize.bind(this));

    // 初始化播放器位置
    setTimeout(() => {
      this.updatePlayerPosition();
    }, 100);
  }

  onResize(): void {
    // 設定播放器的基本尺寸
    this.videoWidth = 640;
    this.videoHeight = 360;
    this.cdr.detectChanges();

    // 重新計算播放器位置
    setTimeout(() => {
      this.updatePlayerPosition();
    }, 100);
  }

  async loadPlaylist() {
    if (!this.urlInput) return;
    
    const urls = this.urlInput.split('\n').filter(url => url.trim());
    const newVideos: Array<{ id: string, title?: string }> = [];
    
    // 批次處理所有 URL
    const videoIds = urls
      .map(url => this.extractVideoId(url))
      .filter(id => id) as string[];

    try {
      // 批次獲取所有影片標題
      const titles = await Promise.all(
        videoIds.map(id => this.getVideoTitle(id))
      );

      // 組合結果
      newVideos.push(...videoIds.map((id, index) => ({
        id,
        title: titles[index] || id
      })));

      // 記錄播放清單是否原本為空
      const wasEmpty = this.playlist.length === 0;

      // 將新影片加入到現有播放清單的最後
      this.playlist = [...this.playlist, ...newVideos];
      this.urlInput = '';

      // 觸發變更檢測，確保播放器能正確渲染
      this.cdr.detectChanges();

      // 如果播放清單原本為空，現在有內容了，需要等待播放器初始化
      if (wasEmpty && this.playlist.length > 0) {
        console.log('播放清單從空變為非空，等待播放器初始化');
        // 重置播放器就緒狀態，等待新播放器初始化
        this.isPlayerReady = false;
        // 設置第一個影片為當前影片
        this.currentVideoId = this.playlist[0].id;
        this.currentIndex = 0;
      } else if (this.currentIndex === -1 && this.playlist.length > 0) {
        // 如果目前沒有播放任何影片且播放清單不為空，開始播放第一首
        this.playIndex(0);
      }

      this.syncYoutubeState();
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
    this.isPlayerReady = false; // 重置播放器狀態

    // 觸發變更檢測，確保 UI 正確更新
    this.cdr.detectChanges();

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
      console.log('播放索引:', index, '影片ID:', this.playlist[index].id);
      this.currentIndex = index;
      this.currentVideoId = this.playlist[index].id;

      // 重置重試計數器
      this.retryCount = 0;

      if (this.isPlayerReady) {
        this.safePlayVideo();
      } else {
        console.log('播放器尚未準備就緒，等待播放器初始化完成');
      }
      // 切換播放索引時不需要發送 addPlaylist
      this.syncYoutubeState(false);
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
    // 切換影片時不需要發送 addPlaylist
    this.syncYoutubeState(false);
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
        // 清空播放清單時需要發送 addPlaylist 來同步
        this.syncYoutubeState();
      }
    } else if (index < this.currentIndex) {
      this.currentIndex--;
      // 只是調整索引，不需要發送 addPlaylist
      this.syncYoutubeState(false);
    } else {
      // 移除其他項目，需要同步播放清單
      this.syncYoutubeState();
    }
  }

  onPlayerStateChange(event: YT.OnStateChangeEvent) {
    const playerState = event.target.getPlayerState();

    // 更新播放狀態
    this.isPlaying = playerState === YT.PlayerState.PLAYING;
    console.log('播放器狀態變化:', playerState, '是否播放中:', this.isPlaying);

    if (playerState === YT.PlayerState.ENDED) {
      console.log('影片播放結束，切換到下一首');
      if (this.currentIndex >= this.playlist.length - 1) {
        this.currentIndex = 0;
      } else {
        this.currentIndex++;
      }

      this.currentVideoId = this.playlist[this.currentIndex].id;
      if (this.isPlayerReady) {
        this.safePlayVideo();
      }
      // 只在切換影片時才同步狀態，不發送 addPlaylist
      this.syncYoutubeState(false);
    } else {
      // 對於其他狀態變化（播放、暫停等），只更新播放狀態，不發送 addPlaylist
      this.syncPlayingState();
    }
  }

  // 修改 syncYoutubeState 方法，添加參數控制是否發送 addPlaylist
  private syncYoutubeState(sendAddPlaylist = true) {
    // 如果組件正在初始化，不發送狀態更新，避免中斷播放
    if (this.isComponentInitializing) {
      console.log('組件初始化中，跳過狀態更新');
      return;
    }

    // 只有當播放清單不為空且需要發送 addPlaylist 時才發送
    if (sendAddPlaylist && this.playlist.length > 0) {
      this.radioSync.addPlaylist(this.playlist);
    }

    // 更新狀態並設置為YouTube模式
    const newState = {
      isPlaying: this.isPlaying,
      volume: 1,
      youtubeState: {
        isYoutubeMode: true,
        playlist: this.playlist,
        currentIndex: this.currentIndex,
        currentVideoId: this.currentVideoId
      }
    };

    console.log('發送YouTube狀態更新:', newState);
    this.radioSync.updateState(newState);
  }

  // 只同步播放狀態，不發送 addPlaylist
  private syncPlayingState() {
    // 如果組件正在初始化，不發送狀態更新，避免中斷播放
    if (this.isComponentInitializing) {
      console.log('組件初始化中，跳過播放狀態更新');
      return;
    }

    const newState = {
      isPlaying: this.isPlaying,
      volume: 1,
      youtubeState: {
        isYoutubeMode: true,
        playlist: this.playlist,
        currentIndex: this.currentIndex,
        currentVideoId: this.currentVideoId
      }
    };

    console.log('發送播放狀態更新:', newState);
    this.radioSync.updateState(newState);
  }

  onPlayerReady(event: YT.PlayerEvent) {
    this.isPlayerReady = true;
    console.log('YouTube 播放器已準備就緒，當前影片ID:', this.currentVideoId, '播放狀態:', this.isPlaying);

    // 確保播放清單存在且有內容
    if (this.playlist.length === 0) {
      console.log('播放器已準備就緒，但沒有播放清單');
      return;
    }

    // 如果沒有當前影片但有播放清單，設置第一個影片但不自動播放
    if (!this.currentVideoId && this.playlist.length > 0) {
      this.currentVideoId = this.playlist[0].id;
      this.currentIndex = 0;
      console.log('設置第一個影片為當前影片:', this.currentVideoId);
      // 載入影片但不自動播放
      event.target.loadVideoById(this.currentVideoId);
    }

    if (this.currentVideoId) {
      // 獲取影片標題但不自動播放
      this.getVideoTitle(this.currentVideoId!).then(title => {
        if (title && this.currentIndex !== -1 && this.currentIndex < this.playlist.length) {
          this.playlist[this.currentIndex].title = title;
          // 更新標題時不需要發送 addPlaylist
          this.syncYoutubeState(false);
        }
      });

      // 只有在明確需要播放時才開始播放
      // 檢查當前的播放狀態，如果應該播放則播放
      setTimeout(() => {
        try {
          // 從RadioState檢查是否應該播放
          this.radioSync.radioState$.pipe(
            // 只取第一個值
            take(1)
          ).subscribe(state => {
            if (state.youtubeState?.isYoutubeMode && state.isPlaying) {
              console.log('根據狀態開始播放影片:', this.currentVideoId);
              event.target.playVideo();
            } else {
              console.log('根據狀態不播放影片，當前播放狀態:', state.isPlaying);
            }
          });
        } catch (error) {
          console.error('檢查播放狀態時發生錯誤:', error);
        }
      }, 100);
    } else {
      console.log('播放器已準備就緒，等待用戶添加影片');
    }
  }

  private safePlayVideo() {
    const currentPlayer = this.getCurrentPlayer();
    if (currentPlayer && this.isPlayerReady && this.currentVideoId) {
      try {
        // 檢查當前播放狀態
        const playerState = currentPlayer.getPlayerState();
        console.log('當前播放器狀態:', playerState, '影片ID:', this.currentVideoId);

        // YouTube Player States:
        // -1 (未開始)
        // 0 (結束)
        // 1 (正在播放)
        // 2 (暫停)
        // 3 (緩衝中)
        // 5 (已插入影片)

        if (playerState !== 1 && playerState !== 3) {  // 不是正在播放或緩衝中
          console.log('開始播放影片');
          currentPlayer.playVideo();
        } else {
          console.log('影片已在播放或緩衝中');
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
      console.log(`播放器未就緒，第 ${this.retryCount} 次重試 - 播放器存在:`, !!currentPlayer, '播放器就緒:', this.isPlayerReady, '影片ID:', this.currentVideoId);
      setTimeout(() => this.safePlayVideo(), 1000);
    } else {
      if (!this.currentVideoId) {
        console.error('無法播放：沒有影片ID');
      } else {
        console.error('播放器初始化失敗，已達最大重試次數');
      }
      this.retryCount = 0;
    }
  }

  onDrop(event: CdkDragDrop<any[]>) {
    // 更新當前播放索引
    if (this.currentIndex === event.previousIndex) {
      this.currentIndex = event.currentIndex;
    } else if (this.currentIndex > event.previousIndex && this.currentIndex <= event.currentIndex) {
      this.currentIndex--;
    } else if (this.currentIndex < event.previousIndex && this.currentIndex >= event.currentIndex) {
      this.currentIndex++;
    }

    // 移動項目
    moveItemInArray(this.playlist, event.previousIndex, event.currentIndex);
    // 拖拽重新排序需要同步播放清單
    this.syncYoutubeState();
  }

  shufflePlaylist() {
    // 保存當前播放的影片
    const currentVideo = this.currentIndex !== -1 ? this.playlist[this.currentIndex] : null;

    // Fisher-Yates 洗牌算法
    for (let i = this.playlist.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.playlist[i], this.playlist[j]] = [this.playlist[j], this.playlist[i]];
    }

    // 更新當前播放索引
    if (currentVideo) {
      this.currentIndex = this.playlist.findIndex(video => video.id === currentVideo.id);
    }

    // 隨機排序需要同步播放清單
    this.syncYoutubeState();
  }

  // 切換播放器展開/收起狀態
  togglePlayer() {
    this.isPlayerExpanded = !this.isPlayerExpanded;

    // 觸發變更檢測以更新 CSS 類別
    this.cdr.detectChanges();

    // 在展開模式下，動態計算播放器位置
    setTimeout(() => {
      this.updatePlayerPosition();
    }, 50);
  }

  // 更新播放器位置
  private updatePlayerPosition() {
    const playerContainer = document.querySelector('.youtube-player-container');
    const targetContainer = document.getElementById('video-target');

    if (!playerContainer || !targetContainer) return;

    const playerElement = playerContainer as HTMLElement;

    if (this.isPlayerExpanded) {
      // 展開模式：計算目標容器的位置
      const targetRect = targetContainer.getBoundingClientRect();

      playerElement.style.position = 'fixed';
      playerElement.style.top = `${targetRect.top}px`;
      playerElement.style.left = `${targetRect.left}px`;
      playerElement.style.width = `${targetRect.width}px`;
      playerElement.style.height = `${targetRect.height}px`;
      playerElement.style.zIndex = '1000'; // 確保在最上層
      playerElement.style.borderRadius = '12px';
      playerElement.style.overflow = 'hidden';
      playerElement.style.boxShadow = '0 8px 32px hsl(var(--bc) / 0.2)';
      playerElement.style.background = '#000';
    } else {
      // 迷你模式：移除所有內聯樣式，讓 CSS 接管
      playerElement.removeAttribute('style');

      // 強制觸發 CSS 重新計算
      playerElement.offsetHeight;
    }
  }

  togglePlayPause() {
    // 檢查是否有播放清單
    if (this.playlist.length === 0) {
      console.log('沒有播放清單，請先添加影片');
      this.showToastMessage('請先添加影片到播放清單', 'info');
      return;
    }

    const currentPlayer = this.getCurrentPlayer();

    // 允許只要 currentPlayer 存在就嘗試操作
    if (currentPlayer) {
      try {
        // 如果沒有當前影片但有播放清單，先設置第一個影片
        if (!this.currentVideoId && this.playlist.length > 0) {
          this.playIndex(0);
          return;
        }
        if (this.currentVideoId) {
          const playerState = currentPlayer.getPlayerState();
          // 只要播放器不是未初始化(-1)就允許操作
          if (playerState === YT.PlayerState.PLAYING) {
            console.log('暫停播放');
            currentPlayer.pauseVideo();
          } else if (playerState !== -1) {
            console.log('開始播放');
            currentPlayer.playVideo();
          } else {
            console.log('播放器尚未初始化，請稍候再試');
            this.showToastMessage('播放器正在初始化，請稍候再試', 'info');
          }
        } else {
          console.log('沒有影片可播放，請先添加影片到播放清單');
          this.showToastMessage('沒有影片可播放，請先添加影片到播放清單', 'info');
        }
        // 注意：不要在這裡調用 syncYoutubeState()，播放狀態變化會通過 onPlayerStateChange 處理
      } catch (error) {
        console.error('Error toggling play/pause:', error);
        this.showToastMessage('播放控制發生錯誤', 'error');
      }
    } else {
      console.log('播放器未就緒 - 播放器存在:', !!currentPlayer, '播放器就緒:', this.isPlayerReady);
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

  // 導航到播放清單管理頁面
  goToPlaylistManager() {
    this.router.navigate(['/playlists']);
  }

  // 播放清單管理相關方法
  loadAvailablePlaylists() {
    this.radioSync.getPlaylists();
  }

  // 載入播放清單縮圖
  loadPlaylistThumbnails() {
    this.availablePlaylists.forEach(playlist => {
      // 為每個播放清單載入詳情以獲取縮圖
      this.radioSync.getPlaylistDetail(playlist.id);
    });
  }

  openAddToPlaylistModal(video: { id: string, title?: string }) {
    this.selectedVideoForPlaylist = {
      id: video.id,
      title: video.title || video.id
    };
    this.showAddToPlaylistModal = true;

    // 載入可用的播放清單
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

  // 快速訪問播放清單
  goToPlaylist(playlistId: number) {
    this.router.navigate(['/playlist', playlistId]);
  }

  // 獲取要顯示的播放清單（根據螢幕寬度限制數量）
  getDisplayPlaylists(): any[] {
    // 根據螢幕寬度決定顯示數量
    const maxDisplay = window.innerWidth >= 1024 ? 4 : 3; // lg 螢幕顯示 4 個，其他顯示 3 個
    return this.availablePlaylists.slice(0, maxDisplay);
  }

  // 獲取播放清單縮圖
  getPlaylistThumbnails(playlistId: number): string[] {
    return this.playlistThumbnails[playlistId] || [];
  }

  // 獲取播放清單歌曲數量
  getPlaylistItemCount(playlistId: number): number {
    return this.playlistItemCounts[playlistId] || 0;
  }

  // Toast 通知方法
  showToastMessage(message: string, type: 'success' | 'error' | 'info' = 'info') {
    this.toastMessage = message;
    this.toastType = type;
    this.showToast = true;

    // 3 秒後自動隱藏
    setTimeout(() => {
      this.showToast = false;
      this.cdr.detectChanges();
    }, 3000);

    this.cdr.detectChanges();
  }

}
