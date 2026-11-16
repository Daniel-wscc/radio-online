/* 本機電台載入狀態。失敗標記只活在這次頁面，成功播放後清掉。 */
(function (root) {
    'use strict';

    function createStationStatus() {
        var failed = {};
        var loadingId = '';
        function view() {
            var copy = {};
            var id;
            for (id in failed) {
                if (Object.prototype.hasOwnProperty.call(failed, id)) copy[id] = true;
            }
            return { loadingId: loadingId, failed: copy };
        }
        return {
            apply: function (event) {
                if (!event || !event.stationId) return view();
                var id = event.stationId;
                if (event.phase === 'playing') {
                    delete failed[id];
                    if (loadingId === id) loadingId = '';
                } else if (event.phase === 'loading' || event.phase === 'retrying') {
                    loadingId = id;
                    if (event.phase === 'retrying') failed[id] = true;
                } else if (event.phase === 'blocked' || event.phase === 'idle') {
                    if (loadingId === id) loadingId = '';
                }
                return view();
            },
            view: view
        };
    }

    root.StationStatus = { create: createStationStatus };
})(typeof window !== 'undefined' ? window : globalThis);
