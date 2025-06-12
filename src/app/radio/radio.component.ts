import { Component, OnInit, ElementRef, ViewChild, AfterViewInit, ChangeDetectorRef, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import Hls from 'hls.js';
import { RadioSyncService, RadioState } from '../services/radio-sync.service';
import { RouterModule } from '@angular/router';
import { YouTubePlayerModule } from '@angular/youtube-player';
import { YoutubeRadioComponent } from '../youtube-radio/youtube-radio.component';
import { ThemeSwitcherComponent } from '../shared/theme-switcher/theme-switcher.component';
import { ChatService } from '../services/chat.service';
import { Subject } from 'rxjs';
import { debounceTime } from 'rxjs/operators';
// import VConsole from 'vconsole';

@Component({
  selector: 'app-radio',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    YouTubePlayerModule,
    YoutubeRadioComponent,
    ThemeSwitcherComponent
  ],
  templateUrl: './radio.component.html',
  // styleUrls: ['./radio.component.less']
})
export class RadioComponent implements OnDestroy, AfterViewInit {
  @ViewChild('audioPlayer') audioPlayer!: ElementRef<HTMLAudioElement>;
  private isAudioPlayerReady = false;
  
  // private vConsole = new VConsole();
  public stations: any[] = [];
  protected Array = Array;
  public currentStation: any = null;
  public isPlaying: boolean = false;
  public currentTime: number = 0;
  public duration: number = 0;
  public featuredStations: any[] = [];
  isYoutubeMode: boolean = false;
  youtubeUrlInput: string = '';
  youtubePlaylist: Array<{ id: string, title?: string }> = [];
  currentVideoId: string | null = null;
  currentYoutubeIndex: number = -1;
  volume: number = 1;
  onlineUsers: number = 0;

  playerConfig = {
    origin: window.location.origin,
    widget_referrer: window.location.href
  };

  // 自定義電台資料
  private customStations = [
    {
      name: '飛碟電台 FM92.1 UFO Radio Live Stream',
      url: 'https://stream.rcs.revma.com/em90w4aeewzuv',
      tags: ['local'],
      id: 'custom_1'
    },
    {
      name: '飛揚調頻 FM89.5 Live Stream',
      url: 'https://stream.rcs.revma.com/e0tdah74hv8uv',
      tags: ['music'],
      id: 'custom_2'
    },
    {
      name: '中廣流行網 I like radio FM103.3 Live Stream',
      url: 'https://stream.rcs.revma.com/aw9uqyxy2tzuv',
      tags: ['music'],
      id: 'custom_3'
    },
    {
      name: '亞洲電台 FM92.7 Live Stream',
      url: 'https://stream.rcs.revma.com/xpgtqc74hv8uv',
      tags: ['music'],
      id: 'custom_4'
    },
    {
      name: 'Hit FM台北之音廣播',
      url: 'https://m3u8-proxy.wscc1031.synology.me/fetch/?url=http://202.39.43.67:1935/live/RA000036/chunklist.m3u8',
      tags: ['music'],
      id: 'custom_5'
    },
    {
      name: 'BigBRadio Kpop Channel',
      url: 'https://antares.dribbcast.com/proxy/kpop?mp=/s',
      tags: ['music'],
      id: 'custom_6'
    },
    {
      name: 'BigBRadio Jpop Channel',
      url: 'https://antares.dribbcast.com/proxy/jpop?mp=/s',
      tags: ['music'],
      id: 'custom_7'
    },
    {
      name: 'BigBRadio Cpop Channel',
      url: 'https://antares.dribbcast.com/proxy/cpop?mp=/s',
      tags: ['music'],
      id: 'custom_8'
    },
    {
      name: 'BigBRadio Apop Channel',
      url: 'https://antares.dribbcast.com/proxy/apop?mp=/s',
      tags: ['music'],
      id: 'custom_9'
    }
  ];

  private currentPlayPromise: Promise<void> | null = null;



  private volumeChange$ = new Subject<number>();

  constructor(
    private cdr: ChangeDetectorRef,
    private radioSync: RadioSyncService,
    private chatService: ChatService
  ) {
    // 訂閱 radioState 的變化
    this.radioSync.radioState$.subscribe((state: RadioState) => {
      // 處理 YouTube 模式切換
      if (state.youtubeState?.isYoutubeMode) {
        this.isYoutubeMode = true;
        this.currentStation = null;
        if (this.audioPlayer?.nativeElement) {
          this.audioPlayer.nativeElement.pause();
          this.audioPlayer.nativeElement.src = '';
        }
      } 
      // 只有當電台改變時才重新播放
      else if (state.currentStation && 
          (!this.currentStation || 
           this.currentStation.name !== state.currentStation.name)) {
        this.isYoutubeMode = false;
        this.currentStation = state.currentStation;
        const url = state.currentStation.url_resolved || state.currentStation.url;
        this.playStation(url, state.currentStation.name);
      }
      
      // 單獨處理音量變化
      if (typeof state.volume === 'number') {
        this.volume = state.volume;
        if (!this.isYoutubeMode && this.audioPlayer?.nativeElement) {
          this.audioPlayer.nativeElement.volume = this.volume;
        }
      }
    });

    // 訂閱線上人數更新
    this.radioSync.onlineUsers$.subscribe(count => {
      this.onlineUsers = count;
      this.cdr.detectChanges();
    });

    this.volumeChange$.pipe(
      debounceTime(300) // 300ms 可依需求調整
    ).subscribe((vol) => {
      this.radioSync.updateState({
        currentStation: this.currentStation,
        isPlaying: this.isPlaying,
        volume: vol
      });
    });
  }

  ngAfterViewInit() {
    if (this.audioPlayer?.nativeElement) {
      console.log('Audio player initialized');
      this.isAudioPlayerReady = true;
      this.audioPlayer.nativeElement.addEventListener('timeupdate', () => {
        this.currentTime = this.audioPlayer.nativeElement.currentTime;
        this.duration = this.audioPlayer.nativeElement.duration || 0;
        this.cdr.detectChanges();
      });
    } else {
      console.error('Audio player not found');
    }
    this.initializeStations();  // 改用新方法初始化電台
    this.cdr.detectChanges();
  }

  // 簡化初始化電台列表方法
  private initializeStations() {
    this.stations = this.customStations;
    this.featuredStations = this.stations;
  }

  adjustVolume(change: number) {
    const audio = this.audioPlayer.nativeElement;
    let newVolume = Math.min(Math.max(audio.volume + change, 0), 1);
    audio.volume = newVolume;
    this.volume = newVolume;
    this.radioSync.updateState({
      currentStation: this.currentStation,
      isPlaying: this.isPlaying,
      volume: this.volume
    });
    this.cdr.detectChanges();
  }

  playStation(url: string, stationName: string) {
    if (!this.isAudioPlayerReady) {
      console.error('Audio player is not ready yet');
      return;
    }

    this.currentStation = this.stations.find(s => s.name === stationName);
    try {
      console.log(`嘗試播放電台: ${stationName}`);
      
      if (!this.audioPlayer?.nativeElement) {
        throw new Error('Audio player not initialized');
      }
      
      const audio = this.audioPlayer.nativeElement;

      // 如果有正在進行的播放，先等它完成
      if (this.currentPlayPromise) {
        this.currentPlayPromise
          .then(() => {
            this.startNewPlayback(audio, url);
          })
          .catch(() => {
            this.startNewPlayback(audio, url);
          });
      } else {
        this.startNewPlayback(audio, url);
      }

    } catch (error) {
      console.error("設定音源時發生錯誤：", error);
    }
  }

  private startNewPlayback(audio: HTMLAudioElement, url: string) {
    audio.pause();
    audio.src = '';
    audio.crossOrigin = "anonymous";

    if (url.endsWith('m3u8')) {
      this.handleHLSPlayback(audio, url);
    } else {
      audio.src = url;
      this.currentPlayPromise = audio.play();
      this.currentPlayPromise.catch(error => {
        console.error("播放失敗：", error);
        this.currentPlayPromise = null;
      });
    }
  }

  private handleHLSPlayback(audio: HTMLAudioElement, url: string) {
    if (Hls.isSupported()) {
      const hls = new Hls();
      hls.loadSource(url);
      hls.attachMedia(audio);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        this.currentPlayPromise = audio.play();
        this.currentPlayPromise.catch(error => {
          console.error("HLS 播放失敗：", error);
          this.currentPlayPromise = null;
        });
      });
    } else {
      console.error("瀏覽器不支援 HLS");
    }
  }

  // 修改音量控制
  onVolumeChange(event: any) {
    if (!this.isYoutubeMode && this.audioPlayer?.nativeElement) {
      this.volume = Number(event) / 100;
      if (isNaN(this.volume) || !isFinite(this.volume)) {
        this.volume = 1;
      }
      this.audioPlayer.nativeElement.volume = this.volume;
      this.volumeChange$.next(this.volume); // 只推送，不直接 update
    }
  }

  // 修改選擇電台的方法
  selectStation(station: any) {
    this.isYoutubeMode = false;
    this.currentStation = station;
    const url = station.url_resolved || station.url;
    this.playStation(url, station.name);
    
    // 發送系統訊息
    const userName = localStorage.getItem('userName') || '訪客';
    this.chatService.sendSystemMessage(`${userName} 切換到 ${station.name}`);
    
    let currentState: RadioState = {
      isPlaying: false,
      volume: 1,
      youtubeState: {
        playlist: [],
        currentIndex: -1,
        currentVideoId: null,
        isYoutubeMode: false
      }
    };
    
    this.radioSync.radioState$.subscribe(state => {
      currentState = state;
    }).unsubscribe();

    this.radioSync.updateState({
      currentStation: station,
      isPlaying: true,
      volume: this.audioPlayer.nativeElement.volume,
      youtubeState: {
        playlist: currentState.youtubeState?.playlist || [],
        currentIndex: currentState.youtubeState?.currentIndex || -1,
        currentVideoId: currentState.youtubeState?.currentVideoId || null,
        isYoutubeMode: false
      }
    });
  }

  // 修改切換到 YouTube 的方法
  switchToYoutube() {
    this.isYoutubeMode = true;
    this.currentStation = null;
    if (this.audioPlayer?.nativeElement) {
      this.audioPlayer.nativeElement.pause();
      this.audioPlayer.nativeElement.src = '';
    }

    // 發送系統訊息
    const userName = localStorage.getItem('userName') || '訪客';
    this.chatService.sendSystemMessage(`${userName} 切換到 YouTube 模式`);

    // 檢查是否有播放清單，如果沒有則設置為播放第一首
    let playlistToUse = this.youtubePlaylist || [];
    let indexToUse = this.currentYoutubeIndex || -1;
    let videoIdToUse = this.currentVideoId || null;

    // 如果播放清單不為空但沒有選擇影片，自動選擇第一首
    if (playlistToUse.length > 0 && indexToUse === -1) {
      indexToUse = 0;
      videoIdToUse = playlistToUse[0].id;
      this.currentYoutubeIndex = 0;
      this.currentVideoId = videoIdToUse;
    }

    // 更新遠端狀態，包含完整的 YouTube 狀態
    this.radioSync.updateState({
      currentStation: null,
      isPlaying: playlistToUse.length > 0 && indexToUse >= 0, // 如果有播放清單且有選擇影片，設為播放中
      volume: this.audioPlayer?.nativeElement?.volume || 1,
      youtubeState: {
        isYoutubeMode: true,
        playlist: playlistToUse,
        currentIndex: indexToUse,
        currentVideoId: videoIdToUse
      }
    });
  }

  switchToRadio() {
    this.isYoutubeMode = false;
    this.currentVideoId = null;
  }

  loadYoutubePlaylist() {
    const urls = this.youtubeUrlInput.split('\n').filter(url => url.trim());
    const newVideos = urls.map(url => {
      const videoId = this.extractVideoId(url);
      return { id: videoId };
    }).filter(video => video.id);

    this.youtubePlaylist = [...this.youtubePlaylist, ...newVideos];
    this.youtubeUrlInput = '';

    if (this.currentYoutubeIndex === -1 && this.youtubePlaylist.length > 0) {
      this.playYoutubeIndex(0);
    }
  }

  private extractVideoId(url: string): string {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : '';
  }

  playYoutubeIndex(index: number) {
    if (index >= 0 && index < this.youtubePlaylist.length) {
      this.currentYoutubeIndex = index;
      this.currentVideoId = this.youtubePlaylist[index].id;
      this.switchToYoutube();
    }
  }

  playNextYoutube() {
    if (this.currentYoutubeIndex < this.youtubePlaylist.length - 1) {
      this.playYoutubeIndex(this.currentYoutubeIndex + 1);
    }
  }

  playPreviousYoutube() {
    if (this.currentYoutubeIndex > 0) {
      this.playYoutubeIndex(this.currentYoutubeIndex - 1);
    }
  }

  onYoutubePlayerStateChange(event: YT.OnStateChangeEvent) {
    if (event.data === YT.PlayerState.ENDED) {
      this.playNextYoutube();
    }
  }

  getTagSeverity(tag: string): 'success' | 'info' | 'warning' | 'error' | 'secondary' | 'primary' | 'accent' | 'neutral' | undefined {
    switch (tag.toLowerCase()) {
      case 'news': return 'info';
      case 'music': return 'success';
      case 'talk': return 'warning';
      case 'sport': return 'error';
      case 'local': return 'secondary';
      default: return 'secondary';
    }
  }



  // 添加 ngOnDestroy 方法
  ngOnDestroy() {
    // 清理訂閱
    if (this.audioPlayer?.nativeElement) {
      this.audioPlayer.nativeElement.pause();
      this.audioPlayer.nativeElement.src = '';
    }
  }
}
