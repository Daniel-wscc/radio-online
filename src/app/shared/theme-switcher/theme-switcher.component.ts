import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-theme-switcher',
  templateUrl: './theme-switcher.component.html',
  styleUrls: ['./theme-switcher.component.less'],
  imports: [CommonModule],
  standalone: true
})
export class ThemeSwitcherComponent implements OnInit {
  themeList = [
    { value: 'light', label: '淺色' },
    { value: 'dark', label: '深色' },
    { value: 'cupcake', label: '杯子蛋糕' },
    { value: 'bumblebee', label: '大黃蜂' },
    { value: 'emerald', label: '翡翠' },
    { value: 'corporate', label: '企業' },
    { value: 'synthwave', label: '合成波' },
    { value: 'retro', label: '復古' },
    { value: 'cyberpunk', label: '賽博朋克' },
    { value: 'valentine', label: '情人節' },
    { value: 'halloween', label: '萬聖節' },
    { value: 'garden', label: '花園' },
    { value: 'forest', label: '森林' },
    { value: 'aqua', label: '水藍' },
    { value: 'lofi', label: 'Lo-Fi' },
    { value: 'pastel', label: '粉彩' },
    { value: 'fantasy', label: '幻想' },
    { value: 'wireframe', label: '線框' },
    { value: 'black', label: '黑色' },
    { value: 'luxury', label: '奢華' },
    { value: 'dracula', label: '德古拉' },
    { value: 'cmyk', label: 'CMYK' },
    { value: 'autumn', label: '秋天' },
    { value: 'business', label: '商務' },
    { value: 'acid', label: '酸性' },
    { value: 'lemonade', label: '檸檬水' },
    { value: 'night', label: '夜晚' },
    { value: 'coffee', label: '咖啡' },
    { value: 'winter', label: '冬天' }
  ];

  ngOnInit() {
    // 載入儲存的主題
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme) {
      document.documentElement.setAttribute('data-theme', savedTheme);
    }
  }

  changeTheme(event: Event) {
    const target = event.target as HTMLElement;
    const button = target.closest('button');
    if (button) {
      const theme = button.getAttribute('data-value');
      if (theme) {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('theme', theme);
      }
    }
  }
}
