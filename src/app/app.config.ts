import { ApplicationConfig, importProvidersFrom } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { providePrimeNG } from 'primeng/config';
import { SocketIoModule } from 'ngx-socket-io';

import Aura from '@primeng/themes/aura';

import { routes } from './app.routes';

const config = { url: 'https://radio.wscc1031.synology.me', options: {} };

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
