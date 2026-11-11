const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
    parsePlaylistHtml,
    parseBrowseJson,
    expandYoutubePlaylist
} = require('../apps/radio-online-server/youtube-playlist.cjs');

const fixtures = path.join(__dirname, 'fixtures');
const pageHtml = fs.readFileSync(path.join(fixtures, 'playlist-page.html'), 'utf8');
const browseJson = JSON.parse(fs.readFileSync(path.join(fixtures, 'playlist-browse.json'), 'utf8'));
const privateHtml = fs.readFileSync(path.join(fixtures, 'private-playlist.html'), 'utf8');

test('播放清單頁面解析出可播放的影片，並略過私人影片', () => {
    const parsed = parsePlaylistHtml(pageHtml);
    assert.equal(parsed.ok, true);
    assert.deepEqual(parsed.items.map((item) => item.videoId), ['aaaaaaaaaaa', 'ccccccccccc']);
    assert.deepEqual(parsed.items.map((item) => item.title), ['歌曲甲', '歌曲丙']);
    assert.equal(parsed.continuation, 'CONT_PAGE_2');
    assert.equal(parsed.apiKey, 'TEST_KEY');
});

test('續頁 JSON 只留下可播放的影片', () => {
    const page = parseBrowseJson(browseJson);
    assert.deepEqual(page.items, [{ videoId: 'ddddddddddd', title: '歌曲丁' }]);
    assert.equal(page.continuation, '');
});

test('展開時會跟著 continuation，私人清單與混合清單會拒絕', async () => {
    let browseCalls = 0;
    const expanded = await expandYoutubePlaylist('PLplaylist01', {
        fetchText: async () => pageHtml,
        fetchBrowse: async () => {
            browseCalls += 1;
            return browseJson;
        }
    });
    assert.equal(browseCalls, 1);
    assert.equal(expanded.ok, true);
    assert.deepEqual(expanded.items.map((item) => item.videoId), ['aaaaaaaaaaa', 'ccccccccccc', 'ddddddddddd']);

    const privateList = await expandYoutubePlaylist('PLprivate01', {
        fetchText: async () => privateHtml,
        fetchBrowse: async () => {
            throw new Error('不該讀續頁');
        }
    });
    assert.equal(privateList.ok, false);
    assert.match(privateList.error, /私人/);

    const mix = await expandYoutubePlaylist('RDmixmixmix', {
        fetchText: async () => {
            throw new Error('不該請求網頁');
        }
    });
    assert.equal(mix.ok, false);
    assert.match(mix.error, /混合清單/);
});

test('超過 500 首會截斷並標明', async () => {
    const many = [];
    for (let i = 0; i < 120; i++) {
        many.push({
            playlistVideoRenderer: {
                videoId: 'v' + String(100000000 + i),
                title: { simpleText: '曲' + i },
                isPlayable: true
            }
        });
    }
    let page = 0;
    const result = await expandYoutubePlaylist('PLlonglist1', {
        fetchText: async () => pageHtml.replace('CONT_PAGE_2', 'MORE'),
        fetchBrowse: async () => {
            page += 1;
            return {
                onResponseReceivedActions: [{
                    appendContinuationItemsAction: {
                        continuationItems: many.concat([{
                            continuationItemRenderer: {
                                continuationEndpoint: { continuationCommand: { token: 'MORE' + page } }
                            }
                        }])
                    }
                }]
            };
        }
    });
    assert.equal(result.ok, true);
    assert.equal(result.items.length, 500);
    assert.equal(result.truncated, true);
    assert.match(result.message, /500/);
});
