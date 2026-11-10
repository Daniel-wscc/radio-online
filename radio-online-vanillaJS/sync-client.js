/* 匯入 YouTube 網址與套用伺服器版號。傳統 script，給 Chromium 87 使用。 */
(function (root) {
    'use strict';

    function collectYoutubeImport(text, extractVideoId) {
        var lines = String(text || '').split('\n');
        var items = [];
        var i;
        for (i = 0; i < lines.length; i++) {
            var line = lines[i].replace(/^\s+|\s+$/g, '');
            if (!line) continue;
            var videoId = extractVideoId(line);
            if (!videoId) continue;
            items.push({ videoId: videoId, sourceIndex: i });
        }
        return items;
    }

    function isStaleRevision(appliedRevision, incomingRevision) {
        return typeof incomingRevision === 'number' &&
            typeof appliedRevision === 'number' &&
            incomingRevision < appliedRevision;
    }

    function nextAppliedRevision(appliedRevision, incomingRevision) {
        if (typeof incomingRevision !== 'number') return appliedRevision;
        if (typeof appliedRevision !== 'number' || incomingRevision > appliedRevision) return incomingRevision;
        return appliedRevision;
    }

    /* 拖曳音量時先記住伺服器的值，放開後再套用，避免把遠端更新丟掉。 */
    function reconcileVolume(dragging, deferredVolume, incomingVolume) {
        if (dragging) {
            return { applyNow: false, deferredVolume: incomingVolume };
        }
        return { applyNow: true, deferredVolume: null, volume: incomingVolume };
    }

    root.RadioSyncClient = {
        collectYoutubeImport: collectYoutubeImport,
        isStaleRevision: isStaleRevision,
        nextAppliedRevision: nextAppliedRevision,
        reconcileVolume: reconcileVolume
    };
})(typeof window !== 'undefined' ? window : globalThis);
