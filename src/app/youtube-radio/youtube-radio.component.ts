import { Component, OnInit, OnDestroy, ViewChild, ChangeDetectorRef, AfterViewInit, ElementRef } from '@angular/core';
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
export class YoutubeRadioComponent implements OnInit, OnDestroy, AfterViewInit {
  @ViewChild('youtubePlayer', { static: false }) youtubePlayerContainer!: ElementRef;
  @ViewChild(YouTubePlayer) youtubePlayer!: YouTubePlayer;

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

  constructor(
    private radioSync: RadioSyncService,
    private chatService: ChatService,
    private cdr: ChangeDetectorRef
  ) {
    // 訂閱狀態更新
    this.radioSync.radioState$.subscribe((state: RadioState) => {
      if (state.youtubeState) {
        const youtubeState = state.youtubeState;
        
        setTimeout(() => {
          if (JSON.stringify(this.playlist) !== JSON.stringify(youtubeState.playlist)) {
            this.playlist = youtubeState.playlist;
          }
          
          if (this.currentIndex !== youtubeState.currentIndex) {
            this.currentIndex = youtubeState.currentIndex;
            this.currentVideoId = youtubeState.currentVideoId;
            if (this.currentVideoId && this.isPlayerReady) {  // 確認播放器已準備就緒
              this.safePlayVideo();
            }
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
  }

  ngOnInit() {
    // 載入 YouTube IFrame API
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    document.body.appendChild(tag);
  }

  ngOnDestroy() {
    // 儲存播放清單到 localStorage
    localStorage.setItem('youtube-playlist', JSON.stringify(this.playlist));
  }

  ngAfterViewInit(): void {
    this.onResize();
    window.addEventListener('resize', this.onResize.bind(this));
  }

  onResize(): void {
    this.videoWidth = Math.min(
      this.youtubePlayerContainer.nativeElement.clientWidth,
      1200
    );
    this.videoHeight = this.videoWidth * 0.5625;
    this.cdr.detectChanges();
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
      if (this.isPlayerReady) {
        this.safePlayVideo();
      }
      this.syncYoutubeState();
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
    this.syncYoutubeState();
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
      }
    } else if (index < this.currentIndex) {
      this.currentIndex--;
    }
    this.syncYoutubeState();
  }

  onPlayerStateChange(event: YT.OnStateChangeEvent) {
    if (event.target.getPlayerState() === YT.PlayerState.ENDED) {
      if (this.currentIndex >= this.playlist.length - 1) {
        this.currentIndex = 0;
      } else {
        this.currentIndex++;
      }
      
      this.currentVideoId = this.playlist[this.currentIndex].id;
      if (this.isPlayerReady) {
        this.safePlayVideo();
      }
      this.syncYoutubeState();
    }
  }

  private syncYoutubeState() {
    this.radioSync.updateState({
      isPlaying: true,
      volume: 1,
      youtubeState: {
        isYoutubeMode: true,
        playlist: this.playlist,
        currentIndex: this.currentIndex,
        currentVideoId: this.currentVideoId
      }
    });
  }

  onPlayerReady(event: YT.PlayerEvent) {
    this.isPlayerReady = true;
    if (this.currentVideoId) {
      event.target.playVideo();  // 直接使用事件對象來播放
      this.getVideoTitle(this.currentVideoId).then(title => {
        if (title && this.currentIndex !== -1) {
          this.playlist[this.currentIndex].title = title;
          this.syncYoutubeState();
        }
      });
    }
  }

  private safePlayVideo() {
    if (this.youtubePlayer && this.isPlayerReady) {
      try {
        // 檢查當前播放狀態
        const playerState = this.youtubePlayer.getPlayerState();
        
        // YouTube Player States:
        // -1 (未開始)
        // 0 (結束)
        // 1 (正在播放)
        // 2 (暫停)
        // 3 (緩衝中)
        // 5 (已插入影片)
        
        if (playerState !== 1 && playerState !== 3) {  // 不是正在播放或緩衝中
          this.youtubePlayer.playVideo();
        }
        this.retryCount = 0;
      } catch (error) {
        this.retryCount++;
        if (this.retryCount < this.maxRetries) {
          // console.log(`播放失敗，第 ${this.retryCount} 次重試`);
          setTimeout(() => this.safePlayVideo(), 1000);
        } else {
          console.error('播放失敗，已達最大重試次數');
          this.retryCount = 0;
        }
      }
    } else if (this.retryCount < this.maxRetries) {
      this.retryCount++;
      console.log(`播放器未就緒，第 ${this.retryCount} 次重試`);
      setTimeout(() => this.safePlayVideo(), 1000);
    } else {
      console.error('播放器初始化失敗，已達最大重試次數');
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
    
    this.syncYoutubeState();
  }
} 