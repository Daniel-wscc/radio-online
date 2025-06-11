import { Component, OnInit, ViewChild, ChangeDetectorRef, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { YouTubePlayer, YouTubePlayerModule } from '@angular/youtube-player';
import { DragDropModule } from '@angular/cdk/drag-drop';
import { RadioSyncService, RadioState } from '../services/radio-sync.service';
import { CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import { ChatService } from '../services/chat.service';

@Component({
  selector: 'app-youtube-radio',
  templateUrl: './youtube-radio.component.html',
  styleUrls: ['./youtube-radio.component.less'],
  imports: [
    CommonModule,
    FormsModule,
    YouTubePlayerModule,
    DragDropModule
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

  // 獲取當前播放器
  private getCurrentPlayer(): YouTubePlayer | null {
    return this.youtubePlayer || null;
  }

  constructor(
    private radioSync: RadioSyncService,
    private chatService: ChatService,
    private cdr: ChangeDetectorRef
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
            if (youtubeState.isYoutubeMode && this.currentVideoId && this.isPlayerReady) {
              this.safePlayVideo();
            }
            // 如果播放器還沒準備好，但有影片要播放，等播放器準備好後會自動播放
          }

          // 如果切換到 YouTube 模式且狀態顯示正在播放，確保播放器開始播放
          if (youtubeState.isYoutubeMode && state.isPlaying && this.currentVideoId && this.isPlayerReady) {
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
  }

  // 添加一個標誌來追蹤是否正在載入播放清單
  private isLoadingPlaylist = false;

  ngOnInit() {
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

      // 將新影片加入到現有播放清單的最後
      this.playlist = [...this.playlist, ...newVideos];
      this.urlInput = '';

      // 如果目前沒有播放任何影片且播放清單不為空，開始播放第一首
      if (this.currentIndex === -1 && this.playlist.length > 0) {
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

    this.radioSync.updateState(newState);
  }

  // 只同步播放狀態，不發送 addPlaylist
  private syncPlayingState() {
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

    this.radioSync.updateState(newState);
  }

  onPlayerReady(event: YT.PlayerEvent) {
    this.isPlayerReady = true;
    console.log('YouTube 播放器已準備就緒');

    if (this.currentVideoId) {
      console.log('開始播放影片:', this.currentVideoId);
      // 使用 setTimeout 確保播放器完全初始化後再播放
      setTimeout(() => {
        try {
          event.target.playVideo();  // 直接使用事件對象來播放
          this.getVideoTitle(this.currentVideoId!).then(title => {
            if (title && this.currentIndex !== -1) {
              this.playlist[this.currentIndex].title = title;
              // 更新標題時不需要發送 addPlaylist
              this.syncYoutubeState(false);
            }
          });
        } catch (error) {
          console.error('播放影片時發生錯誤:', error);
          // 如果直接播放失敗，嘗試使用 safePlayVideo
          this.safePlayVideo();
        }
      }, 100);
    } else if (this.playlist.length > 0 && this.currentIndex === -1) {
      // 如果沒有當前影片但有播放清單，自動播放第一首
      console.log('自動播放第一首影片');
      this.playIndex(0);
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
    const currentPlayer = this.getCurrentPlayer();
    if (currentPlayer && this.isPlayerReady) {
      try {
        const playerState = currentPlayer.getPlayerState();
        if (playerState === YT.PlayerState.PLAYING) {
          console.log('暫停播放');
          currentPlayer.pauseVideo();
        } else {
          console.log('開始播放');
          currentPlayer.playVideo();
        }
        // 注意：不要在這裡調用 syncYoutubeState()，播放狀態變化會通過 onPlayerStateChange 處理
      } catch (error) {
        console.error('Error toggling play/pause:', error);
      }
    } else {
      console.log('播放器未就緒 - 播放器存在:', !!currentPlayer, '播放器就緒:', this.isPlayerReady);
    }
  }

  getCurrentVideoTitle(): string {
    if (this.currentIndex >= 0 && this.currentIndex < this.playlist.length) {
      return this.playlist[this.currentIndex].title || this.playlist[this.currentIndex].id;
    }
    return '';
  }
}
