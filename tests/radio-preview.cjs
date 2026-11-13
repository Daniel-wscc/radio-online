// 本機試聽頁。Socket.IO 被換成空實作，點電台不會影響正式聊天室。
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../radio-online-vanillaJS');
const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2'
};

http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const name = decodeURIComponent(url.pathname);
    const rel = name === '/' ? 'index.html' : name.replace(/^\/+/, '');
    const file = path.resolve(root, rel);
    if (file !== root && !file.startsWith(root + path.sep)) {
        res.writeHead(403);
        res.end();
        return;
    }
    fs.readFile(file, (err, buf) => {
        if (err) {
            res.writeHead(404);
            res.end();
            return;
        }
        let body = buf;
        if (rel === 'index.html') {
            let text = buf.toString('utf8');
            text = text.replace(/<!-- SOCKET_CLIENT -->[\s\S]*?<!-- \/SOCKET_CLIENT -->/,
                '<script>window.io=function(){return {on:function(){},emit:function(){}}};</script>');
            text = text.replace('</body>', `<details open><summary>本機播放診斷（未連線到正式同步服務）</summary><pre id="diagnostics"></pre></details>
<script>
setInterval(function(){
 var p=radioStreamPlayer;
 function info(e){ if(!e)return null;var a=e.audio;return {station:e.station.name,paused:a.paused,muted:a.muted,time:a.currentTime,ready:a.readyState,buffered:a.buffered.length?a.buffered.end(a.buffered.length-1):0};}
 document.getElementById('diagnostics').textContent=JSON.stringify({phase:radioPlaybackPhase,active:info(p&&p.active),pending:info(p&&p.pending)},null,2);
},500);
</script></body>`);
            body = text;
        }
        if (rel === 'app.js') {
            body = buf.toString('utf8').replace('    loadYouTubeAPI();', '    // YouTube API disabled in isolated radio smoke test.');
        }
        res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
        res.end(body);
    });
}).listen(4187, '127.0.0.1', () => console.log('Isolated TV preview: http://127.0.0.1:4187'));
