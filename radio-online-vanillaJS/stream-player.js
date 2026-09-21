/* Standalone TV player. Keep this file compatible with classic scripts; no Angular dependency. */
(function (root) {
    'use strict';

    function StreamPlayer(options) {
        this.options = options;
        this.active = null;
        this.pending = null;
        this.target = null;
        this.volume = 1;
        this.retryCount = 0;
        this.retryAt = 0;
        this.blocked = false;
        var self = this;
        this.timer = setInterval(function () { self.tick(); }, 250);
    }

    StreamPlayer.prototype.notify = function (phase) {
        this.options.onState({
            phase: phase,
            targetName: this.target ? this.target.name : '',
            activeName: this.active ? this.active.station.name : '',
            audio: this.active ? this.active.audio : null
        });
    };

    StreamPlayer.prototype.dispose = function (entry) {
        if (!entry) return;
        entry.audio.removeEventListener('error', entry.onError);
        entry.audio.removeEventListener('pause', entry.onPause);
        entry.audio.removeEventListener('waiting', entry.onWaiting);
        if (entry.hls) entry.hls.destroy();
        entry.audio.pause();
        entry.audio.removeAttribute('src');
        entry.audio.load();
        if (entry.audio.parentNode) entry.audio.parentNode.removeChild(entry.audio);
    };

    StreamPlayer.prototype.setVolume = function (volume) {
        this.volume = Math.max(0, Math.min(1, volume));
        if (this.active) {
            this.active.audio.volume = this.volume;
            this.active.audio.muted = this.volume === 0;
        }
        // The candidate always stays silent until handoff, including during remote volume updates.
    };

    StreamPlayer.prototype.select = function (station) {
        var url = station.url_resolved || station.url;
        if (this.target && this.target.url === url && (this.pending || this.retryAt)) return;
        var previousPending = this.pending;
        this.pending = null;
        this.dispose(previousPending);
        this.target = { id: station.id, name: station.name, url: url };
        this.retryAt = 0;
        this.retryCount = 0;
        this.blocked = false;
        if (this.active && this.active.station.url === this.target.url && !this.active.audio.paused &&
            this.active.audio.readyState >= 3) {
            this.notify('playing');
            return;
        }
        this.begin();
    };

    StreamPlayer.prototype.begin = function () {
        var self = this;
        var audio = document.createElement('audio');
        audio.preload = 'auto';
        audio.muted = true;
        audio.volume = 0;
        audio.setAttribute('playsinline', '');
        audio.style.display = 'none';
        this.options.host.appendChild(audio);
        var entry = {
            audio: audio, station: this.target, hls: null, starting: false, started: false,
            startTime: 0, lastTime: 0, lastEnd: 0, lastProgress: Date.now(),
            onError: function () { self.fail(entry); }
        };
        entry.onPause = function () {
            if (self.active === entry && Date.now() - entry.promotedAt < 1000) {
                self.blocked = true;
                self.notify('blocked');
            }
        };
        entry.onWaiting = function () {
            // Require a fresh continuous stretch of playback after any startup interruption.
            if (self.pending === entry) entry.startTime = audio.currentTime;
        };
        this.pending = entry;
        audio.addEventListener('error', entry.onError);
        audio.addEventListener('pause', entry.onPause);
        audio.addEventListener('waiting', entry.onWaiting);
        this.notify(this.retryCount ? 'retrying' : 'loading');
        var url = entry.station.url;
        if (this.retryCount && url.indexOf('antares.dribbcast.com/proxy/') !== -1) {
            url += (url.indexOf('?') === -1 ? '?' : '&') + '_streamRetry=' + Date.now();
        }
        try {
            if (/\.m3u8(?:$|[?&])/i.test(url) && this.options.Hls && this.options.Hls.isSupported()) {
                var Hls = this.options.Hls;
                entry.hls = new Hls();
                entry.hls.on(Hls.Events.ERROR, function (event, data) {
                    if (data.fatal) self.fail(entry);
                });
                entry.hls.loadSource(url);
                entry.hls.attachMedia(audio);
            } else {
                audio.src = url;
                audio.load();
            }
        } catch (error) {
            this.fail(entry, error);
        }
    };

    StreamPlayer.prototype.fail = function (entry, error) {
        if (entry !== this.pending && entry !== this.active) return;
        // An error from A must not cancel or restart the candidate B.
        if (entry === this.active && (this.pending || this.retryAt || this.blocked)) return;
        if (entry === this.pending) {
            this.pending = null;
            this.dispose(entry);
        }
        if (error && error.name === 'NotAllowedError') {
            this.blocked = true;
            this.retryAt = 0;
            this.notify('blocked');
            return;
        }
        this.retryAt = Date.now() + Math.min(2000 * Math.pow(2, this.retryCount++), 15000);
        this.notify('retrying');
    };

    StreamPlayer.prototype.startSilent = function (entry) {
        var self = this;
        entry.starting = true;
        entry.startTime = entry.audio.currentTime;
        try {
            Promise.resolve(entry.audio.play()).then(function () {
                if (self.pending === entry) entry.started = true;
            }, function (error) { self.fail(entry, error); });
        } catch (error) {
            this.fail(entry, error);
        }
    };

    StreamPlayer.prototype.tick = function () {
        if (this.retryAt && Date.now() >= this.retryAt) {
            this.retryAt = 0;
            this.begin();
        }
        var entry = this.pending || this.active;
        if (!entry || this.blocked) return;
        var audio = entry.audio;
        var ahead = 0;
        var end = 0;
        for (var i = 0; i < audio.buffered.length; i++) {
            end = Math.max(end, audio.buffered.end(i));
            if (audio.buffered.start(i) <= audio.currentTime + 0.1 && audio.buffered.end(i) > audio.currentTime) {
                ahead = audio.buffered.end(i) - audio.currentTime;
            }
        }
        // Reset the watchdog on actual progress, not merely a repeated browser event.
        if (audio.currentTime > entry.lastTime + 0.05 || (entry === this.pending && end > entry.lastEnd + 0.05)) {
            entry.lastProgress = Date.now();
            entry.lastTime = audio.currentTime;
            entry.lastEnd = end;
        }
        if (Date.now() - entry.lastProgress > 15000) {
            this.fail(entry);
            return;
        }
        if (entry !== this.pending) return;
        // Live streams do not consistently emit canplaythrough. Use their buffered duration instead.
        var opaqueReady = audio.buffered.length === 0 && audio.readyState >= 4;
        if (!entry.starting && audio.readyState >= 3 && (ahead >= 2 || opaqueReady)) {
            this.startSilent(entry);
        }
        // Confirm decoded playback is advancing while silent before interrupting the old station.
        if (entry.started && !audio.paused && audio.currentTime - entry.startTime >= 1 &&
            audio.readyState >= 3 && (ahead >= 1 || opaqueReady)) {
            var previous = this.active;
            this.pending = null;
            this.active = entry;
            entry.promotedAt = Date.now();
            this.retryCount = 0;
            this.retryAt = 0;
            this.dispose(previous);
            this.setVolume(this.volume);
            this.notify('playing');
        }
    };

    StreamPlayer.prototype.retry = function () {
        var self = this;
        if (!this.target) return;
        // Called directly by a user gesture, so the TV can grant audible playback permission.
        if (this.active && this.active.station.url === this.target.url && this.blocked) {
            var entry = this.active;
            this.blocked = false;
            this.setVolume(this.volume);
            Promise.resolve(entry.audio.play()).then(function () {
                if (self.active === entry) {
                    entry.lastProgress = Date.now();
                    self.notify('playing');
                }
            }, function (error) { self.fail(entry, error); });
        } else {
            this.select(this.target);
            if (this.pending) this.startSilent(this.pending);
        }
    };

    StreamPlayer.prototype.stop = function () {
        var pending = this.pending;
        var active = this.active;
        this.pending = null;
        this.active = null;
        this.target = null;
        this.retryAt = 0;
        this.blocked = false;
        this.dispose(pending);
        this.dispose(active);
        this.notify('idle');
    };

    StreamPlayer.prototype.destroy = function () {
        this.stop();
        clearInterval(this.timer);
    };

    root.RadioStreamPlayer = StreamPlayer;
})(typeof window !== 'undefined' ? window : globalThis);
