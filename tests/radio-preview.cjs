// Local-only smoke test page. Socket.IO is stubbed so station clicks never affect the live room.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../radio-online-vanillaJS');
http.createServer((req, res) => {
    const name = new URL(req.url, 'http://localhost').pathname;
    const routes = { '/': 'index.html', '/app.js': 'app.js', '/stream-player.js': 'stream-player.js', '/styles.css': 'styles.css' };
    if (!routes[name]) { res.writeHead(404); res.end(); return; }
    let text = fs.readFileSync(path.join(root, routes[name]), 'utf8');
    if (name === '/') {
        text = text.replace(/<script src="https:\/\/cdn.socket.io[^>]+><\/script>/,
            '<script>window.io=function(){return {on:function(){},emit:function(){}}};</script>');
        text = text.replace('</body>', `<details open><summary>Local playback diagnostics (no live-room connection)</summary><pre id="diagnostics"></pre></details>
<script>
setInterval(function(){
 var p=radioStreamPlayer;
 function info(e){ if(!e)return null;var a=e.audio;return {station:e.station.name,paused:a.paused,muted:a.muted,time:a.currentTime,ready:a.readyState,buffered:a.buffered.length?a.buffered.end(a.buffered.length-1):0};}
 document.getElementById('diagnostics').textContent=JSON.stringify({phase:radioPlaybackPhase,active:info(p&&p.active),pending:info(p&&p.pending)},null,2);
},500);
</script></body>`);
    }
    if (name === '/app.js') {
        text = text.replace('    loadYouTubeAPI();', '    // YouTube API disabled in isolated radio smoke test.');
    }
    res.setHeader('Content-Type', name === '/' ? 'text/html; charset=utf-8' : name.endsWith('.css') ? 'text/css' : 'text/javascript');
    res.end(text);
}).listen(4187, '127.0.0.1', () => console.log('Isolated TV preview: http://127.0.0.1:4187'));
