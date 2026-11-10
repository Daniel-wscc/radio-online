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

    function createSession() {
        return {
            clientId: 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
            opId: 0,
            volumeOpId: 0,
            stationOpId: 0
        };
    }

    function issueOp(session, field) {
        session.opId += 1;
        if (field === 'volume') session.volumeOpId = session.opId;
        if (field === 'station') session.stationOpId = session.opId;
        return { clientId: session.clientId, opId: session.opId };
    }

    function isOwnStaleEcho(origin, clientId, latestLocalOpId) {
        return !!(origin && origin.clientId && origin.clientId === clientId &&
            typeof origin.opId === 'number' && typeof latestLocalOpId === 'number' &&
            origin.opId < latestLocalOpId);
    }

    /* 音量：自己較舊的回聲一律不蓋掉本機。操作中與結束後的短時間內，別人的音量先暫存。 */
    function decideVolumeSync(opts) {
        var origin = opts.origin || null;
        var own = !!(origin && origin.clientId && origin.clientId === opts.clientId);
        var opId = origin && typeof origin.opId === 'number' ? origin.opId : null;
        var latest = opts.latestLocalOpId;
        if (own && opId !== null && typeof latest === 'number' && opId < latest) {
            return {
                applyNow: false,
                ignore: true,
                deferredVolume: opts.deferredVolume,
                deferredOrigin: opts.deferredOrigin || null
            };
        }
        if (own && opId !== null && typeof latest === 'number' && opId === latest) {
            return { applyNow: false, confirm: true, deferredVolume: null, deferredOrigin: null };
        }
        var hold = !!opts.interacting || !!opts.withinSettle;
        if (hold && !own) {
            return {
                applyNow: false,
                deferredVolume: opts.incomingVolume,
                deferredOrigin: origin
            };
        }
        return {
            applyNow: true,
            volume: opts.incomingVolume,
            deferredVolume: null,
            deferredOrigin: null
        };
    }

    root.RadioSyncClient = {
        collectYoutubeImport: collectYoutubeImport,
        isStaleRevision: isStaleRevision,
        nextAppliedRevision: nextAppliedRevision,
        reconcileVolume: reconcileVolume,
        createSession: createSession,
        issueOp: issueOp,
        isOwnStaleEcho: isOwnStaleEcho,
        decideVolumeSync: decideVolumeSync
    };
})(typeof window !== 'undefined' ? window : globalThis);
