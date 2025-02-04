import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { RadioComponent } from './radio/radio.component';
import { ButtonModule } from 'primeng/button';
import { ChatDrawerComponent } from './chat-drawer/chat-drawer.component';
@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RadioComponent, ButtonModule, ChatDrawerComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.less'
})
export class AppComponent {
  title = 'radio-online';
}
