/* BigB Radio 現正播放。跟 Angular 電台元件一樣，向站台的 /api/nowplaying 一次詢問多個頻道。 */
(function (root) {
    'use strict';

    var CACHE_MS = 20000;
    var INTERVAL_MS = 15000;
    var cache = {};
    var stations = [];
    var channelById = {};
    var timer = null;
    var inFlight = false;
    var abortController = null;

    function channelOf(station) {
        if (!station || !station.url) return null;
        var match = String(station.url).match(/antares\.dribbcast\.com\/proxy\/([A-Za-z]+)/);
        return match ? match[1] : null;
    }

    function isBigB(station) {
        return !!channelOf(station);
    }

    function textFor(station) {
        var channel = station && channelById[station.id];
        if (!channel) return null;
        var cached = cache[channel];
        if (cached && (Date.now() - cached.timestamp) < CACHE_MS) return cached.data;
        return null;
    }

    function shouldPoll() {
        var doc = root.document;
        if (!doc || doc.hidden) return false;
        if (root.isTv) return true;
        if (root.matchMedia && root.matchMedia('(min-width: 768px)').matches) return true;
        return !!(doc.body && doc.body.classList.contains('sidebar-open'));
    }

    function render() {
        if (!root.document) return;
        var nodes = root.document.querySelectorAll('[data-now-playing]');
        var i;
        for (i = 0; i < nodes.length; i++) {
            var id = nodes[i].getAttribute('data-now-playing');
            var station = null;
            var j;
            for (j = 0; j < stations.length; j++) {
                if (stations[j].id === id) station = stations[j];
            }
            var text = station ? textFor(station) : null;
            var display = text || '載入中...';
            var label = nodes[i].querySelector('.now-playing-text');
            if (!label) continue;
            label.textContent = display;
            label.setAttribute('data-text', display);
            label.setAttribute('title', display);
            if (display.length > 30) label.classList.add('marquee');
            else label.classList.remove('marquee');
        }
    }

    function stopTimer() {
        if (timer) {
            clearInterval(timer);
            timer = null;
        }
        if (abortController) {
            abortController.abort();
            abortController = null;
        }
        inFlight = false;
    }

    function updateAll() {
        if (!shouldPoll()) {
            stopTimer();
            return;
        }
        if (inFlight) return;
        var channels = [];
        var id;
        for (id in channelById) {
            if (Object.prototype.hasOwnProperty.call(channelById, id) && channels.indexOf(channelById[id]) === -1) {
                channels.push(channelById[id]);
            }
        }
        if (!channels.length || !root.RADIO_NOWPLAYING_URL) return;
        inFlight = true;
        abortController = typeof root.AbortController === 'function' ? new root.AbortController() : null;
        var url = root.RADIO_NOWPLAYING_URL + '?channels=' + encodeURIComponent(channels.join(','));
        root.fetch(url, {
            headers: { 'Accept': 'application/json' },
            signal: abortController ? abortController.signal : undefined
        }).then(function (response) {
            if (!response.ok) throw new Error('Now Playing request failed: ' + response.status);
            return response.json();
        }).then(function (results) {
            var n;
            for (n = 0; n < channels.length; n++) {
                cache[channels[n]] = {
                    data: (results && results[channels[n]]) || '無播放資訊',
                    timestamp: Date.now()
                };
            }
            render();
        }).catch(function (error) {
            if (!error || error.name !== 'AbortError') {
                console.error('取得 Now Playing 資訊失敗:', error);
            }
        }).then(function () {
            inFlight = false;
            abortController = null;
        });
    }

    function syncPolling() {
        if (!shouldPoll()) {
            stopTimer();
            return;
        }
        if (!timer) {
            updateAll();
            timer = setInterval(updateAll, INTERVAL_MS);
        }
    }

    function init(list) {
        stations = list || [];
        channelById = {};
        var i;
        for (i = 0; i < stations.length; i++) {
            var channel = channelOf(stations[i]);
            if (channel) channelById[stations[i].id] = channel;
        }
        if (root.document) root.document.addEventListener('visibilitychange', syncPolling);
        root.addEventListener('resize', syncPolling);
        syncPolling();
    }

    root.NowPlaying = {
        init: init,
        syncPolling: syncPolling,
        isBigB: isBigB,
        channelOf: channelOf,
        textFor: textFor,
        render: render
    };
})(typeof window !== 'undefined' ? window : globalThis);
