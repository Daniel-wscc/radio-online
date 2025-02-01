import { Component, OnInit, OnDestroy, ViewChild, ChangeDetectorRef, AfterViewInit, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { YouTubePlayer, YouTubePlayerModule } from '@angular/youtube-player';
import { TextareaModule } from 'primeng/textarea';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { RadioSyncService, RadioState } from '../services/radio-sync.service';
import { ThemeService } from '../services/theme.service';

@Component({
  selector: 'app-youtube-radio',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    YouTubePlayerModule,
    TextareaModule,
    ButtonModule,
    CardModule
  ],
  templateUrl: './youtube-radio.component.html',
  styleUrls: ['./youtube-radio.component.less']
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

  constructor(
    private radioSync: RadioSyncService,
    private themeService: ThemeService,
    private cdr: ChangeDetectorRef
  ) {
    // 訂閱狀態更新
    this.radioSync.radioState$.subscribe((state: RadioState) => {
      if (state.youtubeState) {
        const youtubeState = state.youtubeState;
        
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
      }
    });

    // 訂閱主題變化
    this.themeService.darkMode$.subscribe(isDark => {
      this.isDarkTheme = isDark;
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

  loadPlaylist() {
    const urls = this.urlInput.split('\n').filter(url => url.trim());
    const newVideos = urls.map(url => {
      const videoId = this.extractVideoId(url);
      return { id: videoId };
    }).filter(video => video.id);

    this.playlist = [...this.playlist, ...newVideos];
    this.urlInput = '';

    if (this.currentIndex === -1 && this.playlist.length > 0) {
      this.playIndex(0);
    }

    this.syncYoutubeState();
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
        playlist: this.playlist,
        currentIndex: this.currentIndex,
        currentVideoId: this.currentVideoId,
        isYoutubeMode: true
      }
    });
  }
} 