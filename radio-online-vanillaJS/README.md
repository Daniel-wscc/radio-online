# 芯禾電台前端

這個資料夾是唯一會部署的前端，電腦與 LG webOS TV 22（Chromium 87）共用同一份頁面。`src/` 的 Angular 程式仍留在儲存庫，但根目錄 `project.json` 的 `deploy` 不再建置它。

電視與否：使用者代理字串含 `Web0S`、`webOS`、`NetCast` 或 `SmartTV` 時，`<html>` 會加上 `is-tv`。網址加上 `?tv=1` 或 `?tv=0` 可強制切換，方便用 webOS TV 22 模擬器或桌面瀏覽器測試。電視不載入播放清單、聊天室、多主題與手機抽屜腳本。

Socket 位址在 `config.js`。路徑含 `radio-online-test` 時連到 `https://test.wscc1031.synology.me`，否則連到 `https://radio.wscc1031.synology.me`。第三方套件放在 `vendor/`，不再從 CDN 載入。

切台時保留原本音源，直到新電台緩衝並確認播放前進後才交接。回歸測試在專案根目錄執行：`node --test tests/stream-player.test.cjs`。

隔離試聽：`node tests/radio-preview.cjs`，開啟 `http://127.0.0.1:4187`。這個頁面使用真實電台串流，但不連接正式聊天室／遙控同步服務。
