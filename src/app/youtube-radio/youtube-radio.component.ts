import { Component, OnInit, OnDestroy, ViewChild, ChangeDetectorRef, AfterViewInit, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { YouTubePlayer, YouTubePlayerModule } from '@angular/youtube-player';
import { TextareaModule } from 'primeng/textarea';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { RadioSyncService, RadioState } from '../services/radio-sync.service';
import { ThemeService } from '../services/theme.service';
import { CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import { DragDropModule } from '@angular/cdk/drag-drop';
import { TooltipModule } from 'primeng/tooltip';

@Component({
  selector: 'app-youtube-radio',
  templateUrl: './youtube-radio.component.html',
  styleUrls: ['./youtube-radio.component.less'],
  imports: [
    CommonModule,
    FormsModule,
    YouTubePlayerModule,
    TextareaModule,
    ButtonModule,
    CardModule,
    DragDropModule,
    TooltipModule
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
    widget_referrer: window.location.href
  };

  isDarkTheme = false;

  videoWidth: number | undefined;
  videoHeight: number | undefined;

  private idleTimer: any;
  private readonly IDLE_TIMEOUT = 5000; // 5秒
  private lastInteractionTime: number = Date.now();

  constructor(
    private radioSync: RadioSyncService,
    private themeService: ThemeService,
    private cdr: ChangeDetectorRef
  ) {
    // 訂閱狀態更新
    this.radioSync.radioState$.subscribe((state: RadioState) => {
      if (state.youtubeState) {
        const youtubeState = state.youtubeState;
        
        // 使用 NgZone.run 或 setTimeout 來確保在正確的時機更新
        setTimeout(() => {
          // 只有當狀態真的改變時才更新
          if (JSON.stringify(this.playlist) !== JSON.stringify(youtubeState.playlist)) {
            this.playlist = youtubeState.playlist;
          }
          
          if (this.currentIndex !== youtubeState.currentIndex) {
            this.currentIndex = youtubeState.currentIndex;
            this.currentVideoId = youtubeState.currentVideoId;
            if (this.currentVideoId) {
              setTimeout(() => {
                this.youtubePlayer?.playVideo();
              }, 1000);
            }
          }
          this.cdr.detectChanges();
        });
      }
    });

    // 訂閱主題變化
    this.themeService.darkMode$.subscribe(isDark => {
      setTimeout(() => {
        this.isDarkTheme = isDark;
        this.cdr.detectChanges();
      });
    });

    // 監聽使用者互動
    this.setupIdleDetection();
  }

  ngOnInit() {
    // 載入 YouTube IFrame API
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    document.body.appendChild(tag);
  }

  ngOnDestroy() {
    // 清理監聽器
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
    }
    document.removeEventListener('mousemove', () => this.resetIdleTimer());
    document.removeEventListener('touchstart', () => this.resetIdleTimer());
    document.removeEventListener('scroll', () => this.resetIdleTimer());
    document.removeEventListener('keypress', () => this.resetIdleTimer());

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
    const newPlaylist: Array<{ id: string, title?: string }> = [];
    
    for (const url of urls) {
      try {
        const videoId = this.extractVideoId(url);
        if (videoId) {
          // 獲取影片標題
          const title = await this.getVideoTitle(videoId);
          newPlaylist.push({
            id: videoId,
            title: title || videoId // 如果無法獲取標題，使用 ID
          });
        }
      } catch (error) {
        console.error('Error processing URL:', url, error);
      }
    }
    
    this.playlist = newPlaylist;
    this.urlInput = '';

    if (this.currentIndex === -1 && this.playlist.length > 0) {
      this.playIndex(0);
    }

    this.syncYoutubeState();
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
      setTimeout(() => {
        this.youtubePlayer?.playVideo();
      }, 1000);
      this.syncYoutubeState();
    }
  }

  playNext() {
    if (this.currentIndex < this.playlist.length - 1) {
      this.playIndex(this.currentIndex + 1);
    }
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
    if (event.data === YT.PlayerState.ENDED) {
      this.playNext();
      // 自動播放下一首
      const player = (event.target as YT.Player);
      player.playVideo();
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

  private setupIdleDetection() {
    // 監聽滑鼠移動
    document.addEventListener('mousemove', () => this.resetIdleTimer());
    // 監聽觸摸事件
    document.addEventListener('touchstart', () => this.resetIdleTimer());
    // 監聽滾動
    document.addEventListener('scroll', () => this.resetIdleTimer());
    // 監聽按鍵
    document.addEventListener('keypress', () => this.resetIdleTimer());
    
    // 開始檢查閒置狀態
    this.startIdleTimer();
  }

  private resetIdleTimer() {
    this.lastInteractionTime = Date.now();
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
    }
    this.startIdleTimer();
  }

  private startIdleTimer() {
    this.idleTimer = setTimeout(() => {
      if (this.currentVideoId) {
        this.requestFullscreen();
      }
    }, this.IDLE_TIMEOUT);
  }

  private requestFullscreen() {
    const youtubePlayer = document.querySelector('youtube-player iframe');
    if (youtubePlayer && !document.fullscreenElement) {
      youtubePlayer.requestFullscreen().catch(err => {
        console.log('無法進入全螢幕模式:', err);
      });
    }
  }

  // 當播放器準備好時的事件處理
  onPlayerReady(event: YT.PlayerEvent) {
    if (this.currentVideoId) {
      this.getVideoTitle(this.currentVideoId).then(title => {
        if (title && this.currentIndex !== -1) {
          this.playlist[this.currentIndex].title = title;
          this.syncYoutubeState();
        }
      });
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