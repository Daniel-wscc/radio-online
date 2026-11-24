/* 從公開的 YouTube 播放清單頁面展開影片。不使用使用者的 API 金鑰。 */
'use strict';

var MAX_PLAYLIST_VIDEOS = 500;
var USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function playlistIdFromLine(line) {
    var match = String(line || '').match(/[?&]list=([A-Za-z0-9_-]+)/);
    return match ? match[1] : '';
}

function isMixPlaylist(playlistId) {
    return /^RD/i.test(playlistId || '');
}

function textOf(node) {
    if (!node) return '';
    if (typeof node === 'string') return node;
    if (node.simpleText) return String(node.simpleText);
    if (node.runs && node.runs.length) {
        var out = '';
        var i;
        for (i = 0; i < node.runs.length; i++) out += node.runs[i].text || '';
        return out;
    }
    return '';
}

function extractJsonAfter(source, marker) {
    var at = String(source || '').indexOf(marker);
    if (at < 0) return null;
    var start = source.indexOf('{', at);
    if (start < 0) return null;
    var depth = 0;
    var inString = false;
    var escaped = false;
    var i;
    for (i = start; i < source.length; i++) {
        var ch = source.charAt(i);
        if (inString) {
            if (escaped) escaped = false;
            else if (ch === '\\') escaped = true;
            else if (ch === '"') inString = false;
            continue;
        }
        if (ch === '"') inString = true;
        else if (ch === '{') depth++;
        else if (ch === '}') {
            depth--;
            if (depth === 0) return source.slice(start, i + 1);
        }
    }
    return null;
}

function findNode(node, key, found) {
    if (!node || typeof node !== 'object' || found.length) return;
    if (!Array.isArray(node) && node[key]) {
        found.push(node[key]);
        return;
    }
    var list = Array.isArray(node) ? node : Object.keys(node);
    var i;
    if (Array.isArray(node)) {
        for (i = 0; i < node.length; i++) findNode(node[i], key, found);
        return;
    }
    for (i = 0; i < list.length; i++) findNode(node[list[i]], key, found);
}

function videoFromRenderer(renderer) {
    if (!renderer || !renderer.videoId) return null;
    if (renderer.isPlayable === false) return null;
    var title = textOf(renderer.title).replace(/^\s+|\s+$/g, '');
    if (/^\[?(private video|deleted video|私人影片|已刪除的影片)\]?$/i.test(title)) return null;
    return { videoId: String(renderer.videoId), title: title || String(renderer.videoId) };
}

function continuationFrom(row) {
    if (!row || typeof row !== 'object') return '';
    var item = row.continuationItemRenderer;
    if (item && item.continuationEndpoint && item.continuationEndpoint.continuationCommand &&
        item.continuationEndpoint.continuationCommand.token) {
        return String(item.continuationEndpoint.continuationCommand.token);
    }
    if (row.nextContinuationData && row.nextContinuationData.continuation) {
        return String(row.nextContinuationData.continuation);
    }
    return '';
}

function readContents(contents) {
    var items = [];
    var continuation = '';
    var list = Array.isArray(contents) ? contents : [];
    var i;
    for (i = 0; i < list.length; i++) {
        var row = list[i];
        if (row && row.playlistVideoRenderer) {
            var video = videoFromRenderer(row.playlistVideoRenderer);
            if (video) items.push(video);
        }
        var token = continuationFrom(row);
        if (token) continuation = token;
    }
    return { items: items, continuation: continuation };
}

function alertText(data) {
    var found = [];
    findNode(data, 'alertRenderer', found);
    var parts = [];
    var i;
    for (i = 0; i < found.length; i++) parts.push(textOf(found[i].text));
    return parts.join(' ');
}

function failureFromAlert(text) {
    if (/private|私人/i.test(text)) return '這是私人播放清單，無法匯入。';
    if (/does not exist|unavailable|無法使用|不存在/i.test(text)) return '找不到這份播放清單。';
    if (/sign in|登入/i.test(text)) return '這份播放清單需要登入，無法匯入。';
    return '';
}

function parsePlaylistHtml(html) {
    var raw = extractJsonAfter(html, 'ytInitialData');
    if (!raw) return { ok: false, error: '無法讀取播放清單。' };
    var data;
    try {
        data = JSON.parse(raw);
    } catch (error) {
        return { ok: false, error: '無法讀取播放清單。' };
    }
    var notice = failureFromAlert(alertText(data));
    var found = [];
    findNode(data, 'playlistVideoListRenderer', found);
    if (!found.length) {
        return { ok: false, error: notice || '找不到這份播放清單。它可能是私人清單，或網址不正確。' };
    }
    var parsed = readContents(found[0].contents || []);
    if (!parsed.continuation && found[0].continuations && found[0].continuations[0]) {
        parsed.continuation = continuationFrom(found[0].continuations[0]);
    }
    var apiKeyMatch = String(html).match(/"INNERTUBE_API_KEY":"([^"]+)"/);
    var versionMatch = String(html).match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/);
    return {
        ok: true,
        items: parsed.items,
        continuation: parsed.continuation,
        apiKey: apiKeyMatch ? apiKeyMatch[1] : '',
        clientVersion: versionMatch ? versionMatch[1] : ''
    };
}

function parseBrowseJson(data) {
    var buckets = [];
    var actions = data && data.onResponseReceivedActions ? data.onResponseReceivedActions : [];
    var i;
    for (i = 0; i < actions.length; i++) {
        var action = actions[i] && actions[i].appendContinuationItemsAction;
        if (action && action.continuationItems) buckets.push(action.continuationItems);
    }
    var continuationList = data && data.continuationContents && data.continuationContents.playlistVideoListContinuation;
    if (continuationList) {
        if (continuationList.contents) buckets.push(continuationList.contents);
        if (!buckets.length && continuationList.continuations) buckets.push([]);
    }
    var items = [];
    var continuation = '';
    for (i = 0; i < buckets.length; i++) {
        var parsed = readContents(buckets[i]);
        items = items.concat(parsed.items);
        if (parsed.continuation) continuation = parsed.continuation;
    }
    if (continuationList && continuationList.continuations && continuationList.continuations[0]) {
        var extra = continuationFrom(continuationList.continuations[0]);
        if (extra) continuation = extra;
    }
    return { items: items, continuation: continuation };
}

function defaultTransport() {
    return {
        fetchText: function (url) {
            return fetch(url, {
                headers: {
                    'user-agent': USER_AGENT,
                    'accept-language': 'zh-TW,zh;q=0.9,en;q=0.8',
                    'cookie': 'SOCS=CAI; CONSENT=YES+cb'
                }
            }).then(function (response) {
                if (!response.ok) throw new Error('status ' + response.status);
                return response.text();
            });
        },
        fetchBrowse: function (apiKey, clientVersion, token) {
            var version = clientVersion || '2.20241101.00.00';
            var endpoint = 'https://www.youtube.com/youtubei/v1/browse?prettyPrint=false';
            if (apiKey) endpoint += '&key=' + encodeURIComponent(apiKey);
            return fetch(endpoint, {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    'user-agent': USER_AGENT,
                    'x-youtube-client-name': '1',
                    'x-youtube-client-version': version
                },
                body: JSON.stringify({
                    context: { client: { clientName: 'WEB', clientVersion: version, hl: 'zh-TW', gl: 'TW' } },
                    continuation: token
                })
            }).then(function (response) {
                if (!response.ok) throw new Error('status ' + response.status);
                return response.json();
            });
        }
    };
}

function expandYoutubePlaylist(playlistId, transport) {
    var id = String(playlistId || '');
    if (!/^[A-Za-z0-9_-]{8,80}$/.test(id)) {
        return Promise.resolve({ ok: false, error: '播放清單網址不正確。' });
    }
    if (isMixPlaylist(id)) {
        return Promise.resolve({ ok: false, error: '這是 YouTube 自動產生的混合清單，無法匯入。請改用一般播放清單。' });
    }
    var base = defaultTransport();
    var net = transport || {};
    var fetchText = net.fetchText || base.fetchText;
    var fetchBrowse = net.fetchBrowse || base.fetchBrowse;
    return fetchText('https://www.youtube.com/playlist?list=' + encodeURIComponent(id)).then(function (html) {
        var first = parsePlaylistHtml(html);
        if (!first.ok) return first;
        var items = first.items.slice();
        var token = first.continuation;
        var truncated = false;
        function finish() {
            if (items.length > MAX_PLAYLIST_VIDEOS) {
                items = items.slice(0, MAX_PLAYLIST_VIDEOS);
                truncated = true;
            }
            return {
                ok: items.length > 0,
                items: items,
                truncated: truncated,
                error: items.length ? '' : '這份播放清單沒有可播放的影片。',
                message: truncated ? '播放清單超過 500 首，已匯入前 500 首。' : ''
            };
        }
        function step() {
            if (!token || items.length >= MAX_PLAYLIST_VIDEOS) {
                if (token && items.length >= MAX_PLAYLIST_VIDEOS) truncated = true;
                return Promise.resolve(finish());
            }
            return fetchBrowse(first.apiKey, first.clientVersion, token).then(function (json) {
                var page = parseBrowseJson(json);
                var i;
                for (i = 0; i < page.items.length; i++) {
                    if (items.length >= MAX_PLAYLIST_VIDEOS) {
                        truncated = true;
                        break;
                    }
                    items.push(page.items[i]);
                }
                token = page.continuation;
                if (typeof net.onProgress === 'function') net.onProgress(items.length);
                return step();
            });
        }
        if (typeof net.onProgress === 'function') net.onProgress(items.length);
        return step();
    }).catch(function () {
        return { ok: false, error: '讀取播放清單時發生錯誤。請稍後再試。' };
    });
}

module.exports = {
    MAX_PLAYLIST_VIDEOS: MAX_PLAYLIST_VIDEOS,
    playlistIdFromLine: playlistIdFromLine,
    isMixPlaylist: isMixPlaylist,
    parsePlaylistHtml: parsePlaylistHtml,
    parseBrowseJson: parseBrowseJson,
    expandYoutubePlaylist: expandYoutubePlaylist
};
