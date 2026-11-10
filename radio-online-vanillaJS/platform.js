/* 判斷這次開啟的是 LG 電視還是電腦，並把結果標在 <html class="is-tv">。
   網址 ?tv=1 強制電視版，?tv=0 強制電腦版，方便用模擬器或桌面瀏覽器測試。 */
(function (root) {
    'use strict';

    function detectTvMode(userAgent, search) {
        var query = search || '';
        if (/[?&]tv=1(?:&|$)/.test(query)) return true;
        if (/[?&]tv=0(?:&|$)/.test(query)) return false;
        return /Web0S|webOS|NetCast|SmartTV/i.test(userAgent || '');
    }

    root.detectTvMode = detectTvMode;

    if (root.document && root.document.documentElement && root.navigator) {
        var isTv = detectTvMode(
            root.navigator.userAgent,
            root.location && root.location.search
        );
        root.isTv = isTv;
        if (isTv) {
            root.document.documentElement.classList.add('is-tv');
            root.document.title = '芯禾電台 電視版';
        } else {
            root.document.documentElement.classList.remove('is-tv');
        }
    }
})(typeof window !== 'undefined' ? window : globalThis);
