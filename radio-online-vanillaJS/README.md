# 電視版切台

部署時一起更新 `index.html`、`app.js` 與 `stream-player.js`。電視版是獨立的 JavaScript 專案，不需要 Angular、TypeScript 宣告檔或建置步驟。Angular 使用自己的 `src/app/radio/stream-player.ts`，各自維護、建置與部署；不需要更改伺服器的同步協定。

各裝置收到目標電台 B 後，保留本機正在播放的 A，另外建立靜音音訊元素載入 B。一般先累積約 2 秒可播放資料，再確認播放時間連續前進至少 1 秒、且仍有約 1 秒緩衝，才停止 A 並將 B 套用目前音量。這些是媒體緩衝門檻，並非固定等待秒數，也不能保證後續網路不會中斷。

畫面區分「正在載入 B／正在重新載入 B」與「本裝置播放中」。電腦與電視各自交接，不以電腦播放圖示判定電視狀態。B 載入失敗時保留 A；15 秒完全沒有資料或播放進度才觸發重試，重試間隔為 2、4、8、15 秒。快速連切、切回 A 或切到 YouTube 會清理不再需要的候選串流。若瀏覽器擋下播放，畫面提供本機「重試播放」按鈕。

回歸測試：`node --test tests/stream-player.test.cjs`（在專案根目錄執行）。

同一套測試也可檢查 Angular 的獨立實作；PowerShell 執行 `$env:PLAYER_IMPL='angular'; node --test tests/stream-player.test.cjs`，結束後用 `Remove-Item Env:PLAYER_IMPL` 還原。

隔離試聽：`node tests/radio-preview.cjs`，開啟 `http://127.0.0.1:4187`。這個頁面使用真實電台串流，但不連接正式聊天室／遙控同步服務；底部顯示本機播放與緩衝診斷。電視實機仍須驗證是否支援兩個音訊元素同時載入及靜音播放。
