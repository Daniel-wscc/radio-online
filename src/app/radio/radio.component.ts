import { Component, OnInit, ElementRef, ViewChild, AfterViewInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RadioBrowserApi } from 'radio-browser-api';
import VConsole from 'vconsole';
import Hls from 'hls.js';
import { RadioSyncService, RadioState } from '../services/radio-sync.service';
import { RouterModule } from '@angular/router';
import { YouTubePlayerModule } from '@angular/youtube-player';
import { TextareaModule } from 'primeng/textarea';
import { YoutubeRadioComponent } from '../youtube-radio/youtube-radio.component';
import { ThemeService } from '../services/theme.service';

// PrimeNG 組件
import { InputTextModule } from 'primeng/inputtext';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { SliderModule } from 'primeng/slider';
import { DividerModule } from 'primeng/divider';
import { AccordionModule } from 'primeng/accordion';
import { SplitterModule } from 'primeng/splitter';
import { TagModule } from 'primeng/tag';

@Component({
  selector: 'app-radio',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    // PrimeNG 模組
    InputTextModule,
    ButtonModule,
    CardModule,
    SliderModule,
    DividerModule,
    AccordionModule,
    SplitterModule,
    TagModule,
    YouTubePlayerModule,
    TextareaModule,
    YoutubeRadioComponent
  ],
  templateUrl: './radio.component.html',
  styleUrls: ['./radio.component.less']
})
export class RadioComponent implements OnInit, AfterViewInit {
  @ViewChild('audioPlayer') audioPlayer!: ElementRef<HTMLAudioElement>;
  private isAudioPlayerReady = false;
  private hasUserInteracted = false;
  
  private vConsole = new VConsole();
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
  isDarkTheme = false;

  playerConfig = {
    origin: window.location.origin,
    widget_referrer: window.location.href
  };

  // 自定義電台資料
  private customStations = [
    {
      name: '飛碟電台 FM92.1 UFO Radio Live Stream',
      url: 'https://stream.rcs.revma.com/em90w4aeewzuv',
      tags: ['不明'],
      codec: 'MP3',
      id: 'custom_1'
    },
    {
      name: '飛揚調頻 FM89.5 Live Stream',
      url: 'https://stream.rcs.revma.com/e0tdah74hv8uv',
      tags: ['不明'],
      codec: 'MP3',
      id: 'custom_2'
    },
    {
      name: '中廣流行網 I like radio FM103.3 Live Stream',
      url: 'https://stream.rcs.revma.com/aw9uqyxy2tzuv',
      tags: ['不明'],
      codec: 'MP3',
      id: 'custom_3'
    },
    {
      name: '亞洲電台 FM92.7 Live Stream',
      url: 'https://stream.rcs.revma.com/xpgtqc74hv8uv',
      tags: ['不明'],
      codec: 'MP3',
      id: 'custom_4'
    },
    {
      name: 'Hit FM台北之音廣播',
      url: 'https://renewed-georgeanne-nekonode-1aa70c0c.koyeb.app/fetch/?url=http://202.39.43.67:1935/live/RA000036/chunklist.m3u8',
      tags: ['不明'],
      codec: 'MP3',
      id: 'custom_5'
    }
  ];

  constructor(
    private cdr: ChangeDetectorRef,
    private radioSync: RadioSyncService,
    private themeService: ThemeService
  ) {
    // 訂閱狀態更新
    this.radioSync.radioState$.subscribe((state: RadioState) => {
      if (state.currentStation?.name !== this.currentStation?.name) {
        this.currentStation = state.currentStation;
        if (state.currentStation) {
          const url = state.currentStation.url;  // 移除 url_resolved
          this.playStation(url, state.currentStation.name);
        }
      }

      if (state.isPlaying !== this.isPlaying) {
        if (state.isPlaying) {
          this.audioPlayer.nativeElement.play();
        } else {
          this.audioPlayer.nativeElement.pause();
        }
        this.isPlaying = state.isPlaying;
      }

      if (state.volume !== this.audioPlayer.nativeElement.volume) {
        this.audioPlayer.nativeElement.volume = state.volume;
      }
    });

    // 訂閱主題變化
    this.themeService.darkMode$.subscribe(isDark => {
      this.isDarkTheme = isDark;
      this.cdr.detectChanges();
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

  ngOnInit() {
    document.addEventListener('click', () => {
      this.hasUserInteracted = true;
    }, { once: true });
    
    // 檢查本地儲存的主題設定
    const savedTheme = localStorage.getItem('theme');
    this.isDarkTheme = savedTheme === 'dark';
    this.applyTheme();
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
  }

  playStation(url: string, stationName: string) {
    console.log('Audio player ready status:', this.isAudioPlayerReady);
    console.log('Audio player element:', this.audioPlayer?.nativeElement);
    
    if (!this.isAudioPlayerReady) {
      console.error('Audio player is not ready yet');
      // alert('播放器尚未準備好，請稍候再試。');
      return;
    }
    
    this.currentStation = this.stations.find(s => s.name === stationName);
    try {
      console.log(`嘗試播放電台: ${stationName}`);
      console.log(`串流網址: ${url}`);
      
      if (!this.audioPlayer?.nativeElement) {
        throw new Error('Audio player not initialized');
      }
      
      const audio = this.audioPlayer.nativeElement;
      audio.pause();
      audio.src = '';
      audio.crossOrigin = "anonymous";

      if (url.endsWith('m3u8')) {
        if (Hls.isSupported()) {
          const hls = new Hls();
          hls.loadSource(url);
          hls.attachMedia(audio);
          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            audio.play().catch(error => {
              console.error("HLS 播放失敗：", error, {
                電台名稱: stationName,
                串流網址: url,
                錯誤訊息: error.message
              });
              // alert(`無法播放電台 ${stationName}，請嘗試其他電台。`);
            });
          });
        } else {
          console.error("瀏覽器不支援 HLS");
          // alert("您的瀏覽器不支援此格式的串流播放");
        }
      } else {
        audio.src = url;
        audio.play().catch(error => {
          console.error("播放失敗：", error, {
            電台名稱: stationName,
            串流網址: url,
            錯誤訊息: error.message
          });
          // alert(`無法播放電台 ${stationName}，請嘗試其他電台。`);
        });
      }

      // 重置時間
      this.currentTime = 0;
      this.duration = 0;
    } catch (error) {
      console.error("設定音源時發生錯誤：", error);
      // alert("播放器發生錯誤，請重新整理頁面。");
    }
  }

  // 添加一個 getter 方法來安全地獲取音量
  get volume(): number {
    return this.audioPlayer?.nativeElement?.volume || 0;
  }

  // 添加一個方法來計算音量條寬度
  getVolumeWidth(): string {
    if (!this.audioPlayer?.nativeElement) return '0%';
    return `${(this.audioPlayer.nativeElement.volume * 100)}%`;
  }

  onVolumeChange(event: any) {
    if (this.audioPlayer?.nativeElement) {
      this.audioPlayer.nativeElement.volume = event.value / 100;
      this.radioSync.updateState({
        currentStation: this.currentStation,
        isPlaying: this.isPlaying,
        volume: this.audioPlayer.nativeElement.volume
      });
    }
  }

  // 新增選擇電台的方法
  selectStation(station: any) {
    this.isYoutubeMode = false;  // 切換回 radio 模式
    this.currentStation = station;
    const url = station.url_resolved || station.url;
    this.playStation(url, station.name);
    
    this.radioSync.updateState({
      currentStation: station,
      isPlaying: true,
      volume: this.audioPlayer.nativeElement.volume
    });
  }

  // 加入 YouTube 相關方法
  switchToYoutube() {
    this.isYoutubeMode = true;
    if (this.audioPlayer?.nativeElement) {
      this.audioPlayer.nativeElement.pause();
    }
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

  toggleTheme() {
    this.themeService.toggleDarkMode();
  }

  private applyTheme() {
    if (this.isDarkTheme) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }
}
