const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
    createHitFmProxy,
    rewritePlaylist,
    isAllowedUpstream
} = require('../apps/radio-online-server/hitfm-proxy.cjs');

function textResponse(status, body, extraHeaders) {
    const headers = Object.assign({ 'content-type': 'text/plain' }, extraHeaders || {});
    return {
        status: status,
        headers: {
            get(name) { return headers[String(name).toLowerCase()] || ''; }
        },
        text: async () => body,
        arrayBuffer: async () => Buffer.from(body)
    };
}

function mockRes() {
    return {
        statusCode: 200,
        headersSent: false,
        writableEnded: false,
        headers: {},
        body: null,
        setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
        end(data) {
            this.headersSent = true;
            this.writableEnded = true;
            this.body = data;
        }
    };
}

const BASE = 'https://hitoradio-ott2b2.cdn.hinet.net/ott2b2-hitoradio/n1077/playlist.m3u8?token=abc&expires=1700000000';

test('只允許 hinet CDN，播放清單網址改寫進自己的代理', () => {
    assert.equal(isAllowedUpstream(BASE), true);
    assert.equal(isAllowedUpstream('https://cdn.hinet.net/a.m3u8'), true);
    assert.equal(isAllowedUpstream('https://evil.example/playlist.m3u8'), false);
    assert.equal(isAllowedUpstream('https://cdn.hinet.net.evil.example/a.m3u8'), false);
    assert.equal(isAllowedUpstream('http://127.0.0.1/secret'), false);

    const rewritten = rewritePlaylist([
        '#EXTM3U',
        '#EXT-X-STREAM-INF:BANDWIDTH=130821,CODECS="mp4a.40.2"',
        'chunklist.m3u8?token=abc&expires=1700000000',
        '#EXT-X-MAP:URI="init.mp4"',
        'https://evil.example/nope.ts'
    ].join('\n'), BASE);
    const lines = rewritten.split('\n');
    assert.equal(lines[0], '#EXTM3U');
    assert.match(lines[2], /^\/stream\/hitfm\/media\?u=/);
    const chunk = new URL(lines[2], 'https://radio.wscc1031.synology.me');
    assert.equal(
        decodeURIComponent(chunk.searchParams.get('u')),
        'https://hitoradio-ott2b2.cdn.hinet.net/ott2b2-hitoradio/n1077/chunklist.m3u8?token=abc&expires=1700000000'
    );
    assert.match(lines[3], /URI="\/stream\/hitfm\/media\?u=/);
    assert.equal(lines[4], 'https://evil.example/nope.ts');
});

test('直播網址會快取，到期前更新，上游請求帶 Referer', async () => {
    let now = 1_700_000_000_000;
    let generation = 0;
    const calls = [];
    const proxy = createHitFmProxy({
        now: () => now,
        fetch: async (url, opts) => {
            calls.push({ url: String(url), opts: opts || {} });
            if (String(url).includes('hichannel.php')) {
                generation += 1;
                const expires = Math.floor(now / 1000) + 21600;
                return textResponse(200, 'https://hitoradio-ott2b2.cdn.hinet.net/ott2b2-hitoradio/n1077/playlist.m3u8?token=t' + generation + '&expires=' + expires);
            }
            return textResponse(200, '#EXTM3U\nchunklist.m3u8?token=t' + generation + '\n', {
                'content-type': 'application/vnd.apple.mpegurl'
            });
        }
    });
    const first = await proxy.resolveLiveUrl();
    const second = await proxy.resolveLiveUrl();
    assert.equal(first, second);
    assert.equal(calls.filter((call) => String(call.url).includes('hichannel.php')).length, 1);
    now = 1_700_021_600_000;
    const third = await proxy.resolveLiveUrl();
    assert.notEqual(third, first);
    assert.equal(calls.filter((call) => String(call.url).includes('hichannel.php')).length, 2);

    const res = mockRes();
    await proxy.handleMaster({ headers: { origin: 'https://demo.wscc1031.synology.me' } }, res);
    const cdnCall = calls.filter((call) => String(call.url).includes('cdn.hinet.net')).pop();
    assert.equal(cdnCall.opts.headers.referer, 'https://www.hitoradio.com/');
    assert.equal(res.statusCode, 200);
    assert.match(String(res.body), /\/stream\/hitfm\/media\?u=/);
    assert.equal(res.headers['access-control-allow-origin'], 'https://demo.wscc1031.synology.me');
});

test('451 會丟掉舊網址並重抓，不允許的媒體位址直接拒絕', async () => {
    let liveHits = 0;
    let masterHits = 0;
    const proxy = createHitFmProxy({
        now: () => 1_700_000_000_000,
        fetch: async (url) => {
            if (String(url).includes('hichannel.php')) {
                liveHits += 1;
                const token = liveHits === 1 ? 'old' : 'new';
                return textResponse(200, 'https://hitoradio-ott2b2.cdn.hinet.net/live/playlist.m3u8?token=' + token + '&expires=1700021600');
            }
            masterHits += 1;
            if (String(url).includes('token=old')) return textResponse(451, 'ILLEGAL');
            return textResponse(200, '#EXTM3U\nchunklist.m3u8?token=new\n');
        }
    });
    const res = mockRes();
    await proxy.handleMaster({ headers: {} }, res);
    assert.equal(liveHits, 2);
    assert.equal(masterHits, 2);
    assert.equal(res.statusCode, 200);
    assert.match(String(res.body), /token%3Dnew/);

    const blocked = mockRes();
    await proxy.handleMedia({ headers: {}, query: { u: 'https://evil.example/secret.aac' } }, blocked);
    assert.equal(blocked.statusCode, 400);

    const segment = mockRes();
    await proxy.handleMedia({
        headers: {},
        query: { u: 'https://hitoradio-ott2b2.cdn.hinet.net/live/seg-1.aac?token=new' }
    }, segment);
    assert.equal(segment.statusCode, 200);
    assert.equal(segment.headers['content-type'], 'audio/aac');
});
