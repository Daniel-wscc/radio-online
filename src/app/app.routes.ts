import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./radio/radio.component').then(m => m.RadioComponent)
  },
  {
    path: 'playlists',
    loadComponent: () => import('./playlist-manager/playlist-manager.component').then(m => m.PlaylistManagerComponent)
  },
  {
    path: 'playlist/:id',
    loadComponent: () => import('./playlist-detail/playlist-detail.component').then(m => m.PlaylistDetailComponent)
  }
];
