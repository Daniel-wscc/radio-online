/* 連線設定。
   socketUrl 留空時：網址路徑含 radio-online-test 用測試站，否則用正式站。
   若要固定連到某一台，把 socketUrl 改成完整網址即可。
   features.chat、features.savedPlaylists 預設關閉，與 Angular 把聊天室和「我的播放清單」入口註解掉相同。
   改成 true 就會再顯示並註冊對應的 socket。YouTube 清單上的「加入播放清單」視窗不受這兩個開關影響。 */
(function (root) {
    'use strict';

    var PRODUCTION_SOCKET_URL = 'https://radio.wscc1031.synology.me';
    var TEST_SOCKET_URL = 'https://test.wscc1031.synology.me';

    root.RADIO_CONFIG = root.RADIO_CONFIG || {
        socketUrl: '',
        productionSocketUrl: PRODUCTION_SOCKET_URL,
        testSocketUrl: TEST_SOCKET_URL,
        features: {
            chat: false,
            savedPlaylists: false
        }
    };
    if (!root.RADIO_CONFIG.features) {
        root.RADIO_CONFIG.features = { chat: false, savedPlaylists: false };
    }

    function resolveRadioSocketUrl(config, pathname) {
        config = config || {};
        if (config.socketUrl) return config.socketUrl;
        var testUrl = config.testSocketUrl || TEST_SOCKET_URL;
        var prodUrl = config.productionSocketUrl || PRODUCTION_SOCKET_URL;
        if (String(pathname || '').indexOf('radio-online-test') !== -1) return testUrl;
        return prodUrl;
    }

    root.resolveRadioSocketUrl = resolveRadioSocketUrl;

    var path = root.location && root.location.pathname ? root.location.pathname : '';
    root.RADIO_SOCKET_URL = resolveRadioSocketUrl(root.RADIO_CONFIG, path);
    root.RADIO_NOWPLAYING_URL = String(root.RADIO_SOCKET_URL).replace(/\/$/, '') + '/api/nowplaying';
})(typeof window !== 'undefined' ? window : globalThis);
