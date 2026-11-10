/* 電腦版聊天室抽屜。名稱存在 localStorage 的 userName，與 Angular 相同。電視不載入這支檔案。 */
(function () {
    'use strict';
    if (window.isTv) return;

    var panel = document.getElementById('chatPanel');
    var toggle = document.getElementById('chatToggle');
    var closeButton = document.getElementById('chatCloseButton');
    var nameButton = document.getElementById('chatNameButton');
    var form = document.getElementById('chatForm');
    var input = document.getElementById('chatInput');
    var list = document.getElementById('chatMessages');
    var unreadBadge = document.getElementById('chatUnread');
    var messages = [];
    var unread = 0;
    var visible = false;

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function userName() {
        try {
            return localStorage.getItem('userName') || '訪客';
        } catch (error) {
            return '訪客';
        }
    }

    function formatTime(timestamp) {
        var date = new Date(timestamp);
        function pad(n) { return (n < 10 ? '0' : '') + n; }
        if (isNaN(date.getTime())) return '';
        return pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds());
    }

    function updateUnread() {
        if (!unreadBadge) return;
        unreadBadge.textContent = String(unread);
        unreadBadge.hidden = unread <= 0;
    }

    function render() {
        if (!list) return;
        var html = '';
        var i;
        for (i = 0; i < messages.length; i++) {
            var msg = messages[i] || {};
            var systemClass = msg.isSystem ? ' is-system' : '';
            html += '<div class="chat-message' + systemClass + '">' +
                '<div class="chat-user">' + escapeHtml(msg.userName || '訪客') + '</div>' +
                '<div class="chat-bubble">' + escapeHtml(msg.message || '') + '</div>' +
                '<div class="chat-time">' + escapeHtml(formatTime(msg.timestamp)) + '</div>' +
                '</div>';
        }
        list.innerHTML = html || '<div class="text-muted small">還沒有訊息</div>';
        list.scrollTop = list.scrollHeight;
    }

    function openChat() {
        visible = true;
        unread = 0;
        updateUnread();
        if (panel) panel.hidden = false;
        if (toggle) toggle.hidden = true;
        render();
        if (input) input.focus();
    }

    function closeChat() {
        visible = false;
        if (panel) panel.hidden = true;
        if (toggle) toggle.hidden = false;
    }

    function notify(message) {
        if (!message || message.isSystem || visible || !document.hidden) return;
        if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
        try {
            var note = new Notification('新聊天訊息', {
                body: (message.userName || '訪客') + ': ' + (message.message || '')
            });
            note.onclick = function () {
                window.focus();
                openChat();
                note.close();
            };
            setTimeout(function () { note.close(); }, 5000);
        } catch (error) { /* 電視或權限被拒時略過 */ }
    }

    function send(text) {
        var trimmed = String(text || '').replace(/^\s+|\s+$/g, '');
        if (!trimmed || typeof socket === 'undefined') return;
        socket.emit('chatMessage', {
            userName: userName(),
            message: trimmed,
            timestamp: Date.now()
        });
    }

    if (typeof socket !== 'undefined' && socket && typeof socket.on === 'function') {
        socket.on('newChatMessage', function (message) {
            if (!message) return;
            messages.push(message);
            if (!visible && !message.isSystem) unread++;
            updateUnread();
            render();
            notify(message);
        });
    }

    if (toggle) toggle.addEventListener('click', openChat);
    if (closeButton) closeButton.addEventListener('click', closeChat);
    if (nameButton) {
        nameButton.addEventListener('click', function () {
            var next = window.prompt('請輸入您的名稱：', userName());
            if (next && String(next).replace(/^\s+|\s+$/g, '')) {
                try {
                    localStorage.setItem('userName', String(next).replace(/^\s+|\s+$/g, ''));
                } catch (error) { /* 略過 */ }
            }
        });
    }
    if (form) {
        form.addEventListener('submit', function (event) {
            event.preventDefault();
            send(input ? input.value : '');
            if (input) input.value = '';
        });
    }

    window.PcChat = {
        system: function (text) {
            if (typeof socket === 'undefined' || !text) return;
            socket.emit('chatMessage', {
                userName: 'System',
                message: text,
                timestamp: Date.now(),
                isSystem: true
            });
        }
    };
})();
