const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

const app = fs.readFileSync('radio-online-vanillaJS/app.js', 'utf8');
const ast = ts.createSourceFile('app.js', app, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const names = ['ensureYoutubeFrameHost', 'layoutYoutubeFrame'];
const code = ast.statements.filter(function (node) {
    return ts.isFunctionDeclaration(node) && names.indexOf(node.name.text) !== -1;
}).map(function (node) { return node.getText(ast); }).join('\n');

function element(id, rect) {
    return {
        id: id,
        parentNode: null,
        style: {},
        rect: rect,
        getBoundingClientRect: function () { return this.rect; },
        appendChild: function (child) { child.parentNode = this; }
    };
}

test('展開時播放器留在原父節點，並把尺寸設成舞台大小', () => {
    const section = element('youtubeSection', { left: 0, top: 0, width: 10, height: 10 });
    const frame = element('ytFrame', { left: 0, top: 0, width: 48, height: 48 });
    const slot = element('miniThumbSlot', { left: 0, top: 0, width: 48, height: 48 });
    slot.appendChild(frame);
    const target = element('videoTarget', { left: 30, top: 40, width: 640, height: 360 });
    const sizes = [];
    const context = vm.createContext({
        document: {
            getElementById: function (id) {
                return { youtubeSection: section, ytFrame: frame, videoTarget: target, miniThumbSlot: slot, ytStage: null }[id] || null;
            }
        },
        isYoutubeMode: true,
        playerExpanded: true,
        playlist: [{ id: 'abcdefghijk' }],
        youtubePlayer: { setSize: function (w, h) { sizes.push([w, h]); } },
        console: { log() {} },
        radioDebug() {}
    });
    vm.runInContext(code, context);
    context.layoutYoutubeFrame();
    assert.equal(frame.parentNode, section);
    assert.equal(frame.style.position, 'fixed');
    assert.equal(frame.style.width, '640px');
    assert.equal(frame.style.height, '360px');
    assert.deepEqual(sizes[0], [640, 360]);
    context.layoutYoutubeFrame();
    assert.equal(frame.parentNode, section);
});

test('展開控制列跟播放器同寬，音量槽吃掉剩餘寬度', () => {
    const css = fs.readFileSync('radio-online-vanillaJS/styles.css', 'utf8');
    assert.match(css, /\.expanded-actions\s*\{[^}]*width:\s*100%/);
    assert.match(css, /\.expanded-actions #youtubeVolumeHost\s*\{[^}]*flex:\s*1 1 auto/);
    assert.match(css, /\.expanded-actions \.form-range\s*\{[^}]*flex:\s*1 1 auto/);
    assert.match(css, /\.expanded-actions \.btn,\s*\.expanded-actions \.volume-btn\s*\{[^}]*flex:\s*0 0 auto/);
    assert.match(css, /html\.is-tv \.expanded-actions #youtubeVolumeHost\s*\{[^}]*min-width:\s*0/);
    assert.doesNotMatch(css, /oklch\(|color-mix\(|@layer|:has\(|aspect-ratio/);
});
