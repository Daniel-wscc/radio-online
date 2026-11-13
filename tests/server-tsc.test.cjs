const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const serverDir = path.join(root, 'apps/radio-online-server');
const tscJs = path.join(root, 'node_modules/typescript/lib/tsc.js');

function dockerTsconfig() {
    const docker = fs.readFileSync(path.join(serverDir, 'Dockerfile'), 'utf8');
    const match = docker.match(/echo '([\s\S]*?)' > tsconfig\.json/);
    assert.ok(match, 'Dockerfile 要寫出 tsconfig.json');
    return JSON.parse(match[1].replace(/\\\r?\n/g, ''));
}

test('伺服器 Dockerfile 的 tsc 不會覆寫 radio-sync.cjs', (t) => {
    if (!fs.existsSync(tscJs)) {
        t.skip('沒有安裝 typescript，略過伺服器編譯檢查');
        return;
    }
    const config = dockerTsconfig();
    assert.equal(config.compilerOptions.allowJs, false);
    assert.equal(config.compilerOptions.outDir, '.');
    const dir = fs.mkdtempSync(path.join(serverDir, '.tsc-check-'));
    const original = fs.readFileSync(path.join(serverDir, 'radio-sync.cjs'));
    try {
        fs.copyFileSync(path.join(serverDir, 'index.ts'), path.join(dir, 'index.ts'));
        fs.readdirSync(serverDir).forEach((name) => {
            if (name.endsWith('.cjs')) fs.copyFileSync(path.join(serverDir, name), path.join(dir, name));
        });
        fs.writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify(config));
        const result = spawnSync(process.execPath, [tscJs, '-p', dir, '--pretty', 'false'], {
            cwd: dir,
            encoding: 'utf8'
        });
        assert.equal(result.status, 0, (result.stdout || '') + (result.stderr || ''));
        const emitted = fs.readFileSync(path.join(dir, 'index.js'), 'utf8');
        assert.equal(emitted.includes('require("./radio-sync.cjs")'), true);
        assert.deepEqual(fs.readFileSync(path.join(dir, 'radio-sync.cjs')), original);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
