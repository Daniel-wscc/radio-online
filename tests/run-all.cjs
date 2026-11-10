/* 在 Windows 與 Linux 都能跑，不依賴 shell 展開萬用字元。 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const dir = __dirname;
const files = fs.readdirSync(dir)
    .filter((name) => name.endsWith('.test.cjs'))
    .map((name) => path.join(dir, name));
const result = spawnSync(process.execPath, ['--test'].concat(files), { stdio: 'inherit' });
process.exit(result.status == null ? 1 : result.status);
