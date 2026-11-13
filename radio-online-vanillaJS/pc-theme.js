/* 電腦版主題。只用 CSS 變數，不引入 Tailwind 或 DaisyUI。電視不載入這支檔案。 */
(function () {
    'use strict';
    if (window.isTv) return;

    var THEMES = [
        { id: 'light', label: '淺色', dark: false },
        { id: 'dark', label: '深色', dark: true },
        { id: 'cupcake', label: '杯子蛋糕', dark: false },
        { id: 'emerald', label: '翡翠', dark: false },
        { id: 'synthwave', label: '合成波', dark: true },
        { id: 'forest', label: '森林', dark: true },
        { id: 'coffee', label: '咖啡', dark: true },
        { id: 'dracula', label: '德古拉', dark: true }
    ];

    function findTheme(id) {
        var i;
        for (i = 0; i < THEMES.length; i++) {
            if (THEMES[i].id === id) return THEMES[i];
        }
        return THEMES[0];
    }

    function readSaved() {
        try {
            return localStorage.getItem('theme') || 'light';
        } catch (error) {
            return 'light';
        }
    }

    function applyThemeById(id) {
        var theme = findTheme(id);
        document.documentElement.setAttribute('data-theme', theme.id);
        document.body.classList.toggle('dark-mode', theme.id === 'dark');
        try {
            localStorage.setItem('theme', theme.id);
        } catch (error) { /* 隱私模式可能無法寫入 */ }
        if (typeof isDarkMode !== 'undefined') isDarkMode = theme.id === 'dark';
        var toggle = document.getElementById('themeToggle');
        if (toggle) {
            toggle.innerHTML = theme.dark ? '<i class="bi bi-sun"></i>' : '<i class="bi bi-moon"></i>';
        }
        var current = document.getElementById('themeCurrent');
        if (current) current.textContent = theme.label;
    }

    function buildMenu() {
        var menu = document.getElementById('themeMenu');
        if (!menu) return;
        menu.innerHTML = '';
        THEMES.forEach(function (theme) {
            var item = document.createElement('li');
            var button = document.createElement('button');
            button.type = 'button';
            button.className = 'dropdown-item';
            button.setAttribute('data-theme-id', theme.id);
            button.setAttribute('aria-label', theme.label);
            var swatch = document.createElement('span');
            swatch.className = 'swatch';
            swatch.setAttribute('data-theme', theme.id);
            swatch.setAttribute('aria-hidden', 'true');
            swatch.innerHTML = '<i></i><i></i><i></i><i></i>';
            var label = document.createElement('span');
            label.className = 'theme-label';
            label.textContent = theme.label;
            button.appendChild(swatch);
            button.appendChild(label);
            button.addEventListener('click', function () {
                applyThemeById(theme.id);
                var switcher = document.getElementById('themeSwitcher');
                if (switcher) switcher.classList.remove('is-open');
            });
            item.appendChild(button);
            menu.appendChild(item);
        });
    }

    document.addEventListener('DOMContentLoaded', function () {
        buildMenu();
        applyThemeById(readSaved());
        var switcher = document.getElementById('themeSwitcher');
        var trigger = document.getElementById('themeTrigger');
        if (trigger && switcher) {
            trigger.addEventListener('click', function (event) {
                event.stopPropagation();
                var open = switcher.classList.toggle('is-open');
                trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
            });
            document.addEventListener('click', function (event) {
                if (!switcher.contains(event.target)) switcher.classList.remove('is-open');
            });
        }
    });

    window.PcTheme = { apply: applyThemeById, themes: THEMES };
})();
