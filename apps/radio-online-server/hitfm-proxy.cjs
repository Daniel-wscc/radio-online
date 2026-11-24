/* Hit FM 串流代理。上游 CDN 沒有 Referer 會回 451，瀏覽器又不能自訂 Referer，所以由伺服器代抓。 */
'use strict';

const { Readable } = require('stream');

const RESOLVE_URL = 'https://www.hitoradio.com/newweb/hichannel.php';
const REFERER = 'https://www.hitoradio.com/';
const ORIGIN = 'https://www.hitoradio.com';
const REFRESH_SKEW_MS = 60 * 1000;
const FALLBACK_TTL_MS = 5 * 60 * 60 * 1000;

function isAllowedUpstream(urlString) {
    let url;
    try {
        url = new URL(String(urlString));
    } catch (error) {
        return false;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
    if (url.username || url.password) return false;
    const host = url.hostname.toLowerCase();
    return host === 'cdn.hinet.net' || host.endsWith('.cdn.hinet.net');
}

function headerValue(response, name) {
    const headers = response && response.headers;
    if (!headers) return '';
    if (typeof headers.get === 'function') return headers.get(name) || '';
    const key = String(name).toLowerCase();
    return headers[key] || headers[name] || '';
}

function expiryMs(liveUrl, now) {
    const match = String(liveUrl).match(/[?&]expires=(\d+)/);
    if (match) return Number(match[1]) * 1000;
    return now + FALLBACK_TTL_MS;
}

function rewritePlaylist(text, baseUrl, mapUrl) {
    const map = mapUrl || function (absolute) {
        return '/stream/hitfm/media?u=' + encodeURIComponent(absolute);
    };
    return String(text || '').replace(/\r\n/g, '\n').split('\n').map(function (line) {
        const trimmed = line.trim();
        if (!trimmed) return line;
        if (trimmed.charAt(0) !== '#') {
            if (!isAllowedUpstream(new URL(trimmed, baseUrl).toString())) return line;
            return map(new URL(trimmed, baseUrl).toString());
        }
        return line.replace(/URI="([^"]+)"/g, function (_all, uri) {
            const absolute = new URL(uri, baseUrl).toString();
            if (!isAllowedUpstream(absolute)) return 'URI="' + uri + '"';
            return 'URI="' + map(absolute) + '"';
        });
    }).join('\n');
}

function contentTypeFor(response, url) {
    const path = new URL(url).pathname.toLowerCase();
    if (path.endsWith('.m3u8')) return 'application/vnd.apple.mpegurl';
    if (path.endsWith('.aac')) return 'audio/aac';
    if (path.endsWith('.ts')) return 'video/MP2T';
    const raw = headerValue(response, 'content-type');
    if (raw) return raw.split(';')[0].trim();
    return 'application/octet-stream';
}

function isPlaylistUrl(url) {
    return new URL(url).pathname.toLowerCase().endsWith('.m3u8');
}

function applyStreamCors(req, res) {
    const origin = req && req.headers ? req.headers.origin : '';
    const allowed = {
        'https://demo.wscc1031.synology.me': true,
        'https://radio.wscc1031.synology.me': true,
        'https://test.wscc1031.synology.me': true,
        'http://localhost:4200': true,
        'http://127.0.0.1:4200': true,
        'http://192.168.0.10:4200': true,
        'http://192.168.11.125:4200': true
    };
    if (origin && allowed[origin]) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
    }
}

function sendText(res, status, type, body) {
    res.statusCode = status;
    res.setHeader('Content-Type', type);
    res.setHeader('Cache-Control', 'no-store');
    res.end(body);
}

function createHitFmProxy(options) {
    const deps = options || {};
    const fetchImpl = deps.fetch || fetch;
    const now = deps.now || function () { return Date.now(); };
    const cache = { url: '', expiresAt: 0, pending: null };

    function invalidate() {
        cache.url = '';
        cache.expiresAt = 0;
    }

    function resolveLiveUrl(force) {
        const current = now();
        if (!force && cache.url && cache.expiresAt - REFRESH_SKEW_MS > current) {
            return Promise.resolve(cache.url);
        }
        if (cache.pending) return cache.pending;
        const pending = fetchImpl(RESOLVE_URL, {
            method: 'POST',
            headers: {
                'content-type': 'application/x-www-form-urlencoded',
                'referer': REFERER,
                'origin': ORIGIN
            },
            body: 'channelID=1&action=getLIVEURL'
        }).then(function (response) {
            return response.text().then(function (text) {
                const liveUrl = String(text || '').trim();
                const status = response.status || 200;
                if (status !== 200) throw new Error('resolve status ' + status);
                if (!isAllowedUpstream(liveUrl)) throw new Error('live url rejected');
                cache.url = liveUrl;
                cache.expiresAt = expiryMs(liveUrl, now());
                return liveUrl;
            });
        }).finally(function () {
            if (cache.pending === pending) cache.pending = null;
        });
        cache.pending = pending;
        return pending;
    }

    function fetchUpstream(url) {
        let current = url;
        function hop(left) {
            if (!isAllowedUpstream(current)) {
                const error = new Error('disallowed');
                error.code = 'DISALLOWED';
                return Promise.reject(error);
            }
            return fetchImpl(current, {
                method: 'GET',
                redirect: 'manual',
                headers: {
                    'referer': REFERER,
                    'origin': ORIGIN,
                    'user-agent': 'Mozilla/5.0 radio-hitfm-proxy'
                }
            }).then(function (response) {
                const status = response.status;
                const location = headerValue(response, 'location');
                if (status >= 300 && status < 400 && location && left > 0) {
                    current = new URL(location, current).toString();
                    return hop(left - 1);
                }
                return { status: status, response: response, finalUrl: current };
            });
        }
        return hop(3);
    }

    function handleMaster(req, res) {
        applyStreamCors(req, res);
        function load(force) {
            return resolveLiveUrl(force).then(function (liveUrl) {
                return fetchUpstream(liveUrl).then(function (upstream) {
                    return { liveUrl: liveUrl, upstream: upstream };
                });
            });
        }
        return load(false).then(function (first) {
            const status = first.upstream.status;
            if (status === 451 || status === 403 || status === 404) {
                invalidate();
                return load(true);
            }
            return first;
        }).then(function (result) {
            if (!result || result.upstream.status !== 200) {
                sendText(res, 502, 'text/plain; charset=utf-8', 'Hit FM 串流暫時無法取得');
                return;
            }
            return result.upstream.response.text().then(function (playlist) {
                const rewritten = rewritePlaylist(playlist, result.upstream.finalUrl);
                sendText(res, 200, 'application/vnd.apple.mpegurl', rewritten);
            });
        }).catch(function () {
            if (!res.headersSent && !res.writableEnded) {
                sendText(res, 502, 'text/plain; charset=utf-8', 'Hit FM 串流暫時無法取得');
            }
        });
    }

    function handleMedia(req, res) {
        applyStreamCors(req, res);
        const target = req.query && req.query.u ? String(req.query.u) : '';
        if (!isAllowedUpstream(target)) {
            sendText(res, 400, 'text/plain; charset=utf-8', '不允許的位址');
            return Promise.resolve();
        }
        return fetchUpstream(target).then(function (upstream) {
            if (upstream.status === 451 || upstream.status === 403 || upstream.status === 404) {
                invalidate();
                sendText(res, 502, 'text/plain; charset=utf-8', 'Hit FM 串流需要更新，請重試');
                return;
            }
            if (upstream.status !== 200) {
                sendText(res, 502, 'text/plain; charset=utf-8', 'Hit FM 串流暫時無法取得');
                return;
            }
            const type = contentTypeFor(upstream.response, upstream.finalUrl);
            if (isPlaylistUrl(upstream.finalUrl)) {
                return upstream.response.text().then(function (playlist) {
                    sendText(res, 200, 'application/vnd.apple.mpegurl', rewritePlaylist(playlist, upstream.finalUrl));
                });
            }
            res.statusCode = 200;
            res.setHeader('Content-Type', type);
            res.setHeader('Cache-Control', 'no-store');
            if (upstream.response.body && typeof Readable.fromWeb === 'function') {
                Readable.fromWeb(upstream.response.body).pipe(res);
                return;
            }
            return upstream.response.arrayBuffer().then(function (bytes) {
                res.end(Buffer.from(bytes));
            });
        }).catch(function (error) {
            if (res.headersSent || res.writableEnded) return;
            const status = error && error.code === 'DISALLOWED' ? 400 : 502;
            sendText(res, status, 'text/plain; charset=utf-8', status === 400 ? '不允許的位址' : 'Hit FM 串流暫時無法取得');
        });
    }

    return {
        resolveLiveUrl: resolveLiveUrl,
        rewritePlaylist: rewritePlaylist,
        isAllowedUpstream: isAllowedUpstream,
        invalidate: invalidate,
        handleMaster: handleMaster,
        handleMedia: handleMedia
    };
}

function attachHitFmRoutes(app, proxy) {
    const hit = proxy || createHitFmProxy();
    app.get('/stream/hitfm.m3u8', function (req, res) {
        hit.handleMaster(req, res);
    });
    app.get('/stream/hitfm/media', function (req, res) {
        hit.handleMedia(req, res);
    });
    return hit;
}

module.exports = {
    createHitFmProxy: createHitFmProxy,
    attachHitFmRoutes: attachHitFmRoutes,
    rewritePlaylist: rewritePlaylist,
    isAllowedUpstream: isAllowedUpstream
};
