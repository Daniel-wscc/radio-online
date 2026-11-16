/* 電腦窄螢幕的電台清單抽屜。電視維持原本上下排列，不載入這支檔案。 */
(function () {
    'use strict';
    if (window.isTv) return;

    var toggle = document.getElementById('mobileMenuButton');
    var backdrop = document.getElementById('mobileSidebarBackdrop');
    var sidebar = document.getElementById('stationSidebar');

    function setOpen(open) {
        document.body.classList.toggle('sidebar-open', !!open);
        if (toggle) toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        if (window.NowPlaying && typeof NowPlaying.syncPolling === 'function') NowPlaying.syncPolling();
    }

    if (toggle) {
        toggle.addEventListener('click', function () {
            setOpen(!document.body.classList.contains('sidebar-open'));
        });
    }
    if (backdrop) {
        backdrop.addEventListener('click', function () {
            setOpen(false);
        });
    }
    if (sidebar) {
        sidebar.addEventListener('click', function (event) {
            if (!event.target.closest || !event.target.closest('.station-item')) return;
            if (window.matchMedia('(max-width: 767px)').matches) setOpen(false);
        });
    }
})();
