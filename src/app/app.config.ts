import { ApplicationConfig, importProvidersFrom } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { providePrimeNG } from 'primeng/config';
import { SocketIoModule, SocketIoConfig } from 'ngx-socket-io';

import Aura from '@primeng/themes/aura';

import { routes } from './app.routes';

const config: SocketIoConfig = { 
  url: 'https://radio.wscc1031.synology.me', 
  options: {
    transports: ['polling', 'websocket'],
    autoConnect: true,
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
    timeout: 5000,
    withCredentials: true
  }
};

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes),
    provideAnimationsAsync(),
    providePrimeNG({
      theme: {
        preset: Aura,
        options: {
          prefix: 'p',
          darkModeSelector: 'system',
          cssLayer: false
        }
      }
    }),
    importProvidersFrom(
      SocketIoModule.forRoot(config)
    )
  ]
};
