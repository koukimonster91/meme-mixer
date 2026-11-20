// Tesira Text Protocol (TTP) client over Telnet.
// One command in flight at a time; queued "set" commands with the same key are
// coalesced so a fast fader drag only sends the latest value.
const net = require('net');
const EventEmitter = require('events');

const IAC = 255, DONT = 254, DO = 253, WONT = 252, WILL = 251, SB = 250, SE = 240;

function parseToken(t) {
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (/^"(.*)"$/.test(t)) return t.slice(1, -1);
  const n = Number(t);
  return Number.isFinite(n) ? n : t;
}

// Parse the text after "value": or "list": — a scalar, a quoted string or a [ ... ] array.
function parseValue(s) {
  s = s.trim().replace(/\s*\+OK\s*$/, '');
  if (s.startsWith('[')) {
    const inner = s.slice(1, s.lastIndexOf(']'));
    const toks = inner.match(/"[^"]*"|[^\s\[\]]+/g) || [];
    return toks.map(parseToken);
  }
  const m = s.match(/^"[^"]*"|^\S+/);
  return m ? parseToken(m[0]) : null;
}

function parseResponse(line) {
  const ok = line.startsWith('+OK');
  const m = line.match(/"(?:value|list)":(.*)$/);
  return { ok, raw: line, value: m ? parseValue(m[1]) : (ok ? parseValue(line.slice(3)) : null) };
}

function quoteTag(tag) {
  return /[\s"]/.test(tag) ? `"${tag.replace(/"/g, '')}"` : tag;
}

class Tesira extends EventEmitter {
  constructor() {
    super();
    this.sock = null;
    this.queue = [];
    this.inflight = null;
    this.connected = false;
    this.ready = false;
    this.text = '';
    this.retryTimer = null;
    this.pingTimer = null;
    this.readyTimer = null;
    this.running = false;
  }

  connect(host, port) {
    this.close();
    this.host = host;
    this.port = port;
    this.running = true;
    this._open();
  }

  close() {
    this.running = false;
    clearTimeout(this.retryTimer);
    clearTimeout(this.readyTimer);
    clearInterval(this.pingTimer);
    if (this.sock) { this.sock.removeAllListeners(); this.sock.destroy(); this.sock = null; }
    this._failAll('disconnected');
    this._setState(false, false);
  }

  _setState(connected, ready) {
    const changed = connected !== this.connected || ready !== this.ready;
    this.connected = connected;
    this.ready = ready;
    if (changed) this.emit('status', { connected, ready });
  }

  _open() {
    this.text = '';
    const s = net.createConnection({ host: this.host, port: this.port });
    this.sock = s;
    s.setNoDelay(true);
    s.setTimeout(10000);
    s.on('connect', () => {
      s.setTimeout(0);
      this._setState(true, false);
      // The welcome banner normally triggers ready; fall back after 2 s.
      this.readyTimer = setTimeout(() => this._becomeReady(), 2000);
    });
    s.on('data', (b) => this._onData(b));
    s.on('timeout', () => s.destroy(new Error('connect timeout')));
    s.on('error', (e) => this.emit('log', `socket error: ${e.message}`));
    s.on('close', () => {
      clearInterval(this.pingTimer);
      clearTimeout(this.readyTimer);
      this.sock = null;
      this._failAll('connection closed');
      this._setState(false, false);
      if (this.running) this.retryTimer = setTimeout(() => this._open(), 3000);
    });
  }

  _becomeReady() {
    if (this.ready || !this.connected) return;
    clearTimeout(this.readyTimer);
    this._setState(true, true);
    this.send('SESSION set verbose true').catch(() => {});
    this.emit('ready');
    clearInterval(this.pingTimer);
    this.pingTimer = setInterval(() => {
      this.send('SESSION get verbose').catch(() => {
        this.emit('log', 'keepalive failed, reconnecting');
        if (this.sock) this.sock.destroy();
      });
    }, 20000);
  }

  // Strip Telnet negotiation (refuse every option) and return plain bytes.
  _stripTelnet(buf) {
    const out = [];
    const reply = [];
    for (let i = 0; i < buf.length; i++) {
      const c = buf[i];
      if (c !== IAC) { out.push(c); continue; }
      const cmd = buf[i + 1];
      if (cmd === IAC) { out.push(IAC); i++; continue; }
      if (cmd === DO || cmd === DONT || cmd === WILL || cmd === WONT) {
        const opt = buf[i + 2];
        if (cmd === DO) reply.push(IAC, WONT, opt);
        if (cmd === WILL) reply.push(IAC, DONT, opt);
        i += 2;
        continue;
      }
      if (cmd === SB) {
        let j = i + 2;
        while (j < buf.length - 1 && !(buf[j] === IAC && buf[j + 1] === SE)) j++;
        i = j + 1;
        continue;
      }
      i++;
    }
    if (reply.length && this.sock) this.sock.write(Buffer.from(reply));
    return Buffer.from(out).toString('utf8');
  }

  _onData(buf) {
    this.text += this._stripTelnet(buf);
    let idx;
    while ((idx = this.text.search(/\r?\n/)) >= 0) {
      const line = this.text.slice(0, idx).trim();
      this.text = this.text.slice(idx).replace(/^\r?\n/, '');
      if (line) this._onLine(line);
    }
  }

  _onLine(line) {
    if (/Welcome to the Tesira Text Protocol Server/i.test(line)) { this._becomeReady(); return; }
    if (line.startsWith('!')) {
      const tok = line.match(/"publishToken":"([^"]*)"/);
      const val = line.match(/"value":(.*)$/);
      if (tok && val) this.emit('publish', tok[1], parseValue(val[1]));
      if (/\+OK\s*$/.test(line)) this._resolve(parseResponse('+OK'));
      return;
    }
    if (line.startsWith('+OK') || line.startsWith('-ERR')) {
      this._resolve(parseResponse(line));
      return;
    }
    // Anything else is the echo of our own command or banner text.
  }

  _resolve(res) {
    const job = this.inflight;
    if (!job) return;
    clearTimeout(job.timer);
    this.inflight = null;
    for (const r of job.waiters) r.resolve(res);
    this._pump();
  }

  _failAll(reason) {
    const jobs = this.inflight ? [this.inflight, ...this.queue] : this.queue;
    for (const j of jobs) { clearTimeout(j.timer); for (const w of j.waiters) w.reject(new Error(reason)); }
    this.inflight = null;
    this.queue = [];
  }

  // Send a raw TTP command. `key` coalesces queued commands with the same key.
  send(cmd, key) {
    cmd = String(cmd).replace(/[\r\n]/g, ' ').trim();
    return new Promise((resolve, reject) => {
      if (!this.connected || !this.sock) return reject(new Error('not connected'));
      if (key) {
        const existing = this.queue.find((j) => j.key === key);
        if (existing) { existing.cmd = cmd; existing.waiters.push({ resolve, reject }); return; }
      }
      this.queue.push({ cmd, key, waiters: [{ resolve, reject }] });
      this._pump();
    });
  }

  _pump() {
    if (this.inflight || !this.queue.length || !this.sock) return;
    const job = this.queue.shift();
    this.inflight = job;
    job.timer = setTimeout(() => {
      this.emit('log', `timeout: ${job.cmd}`);
      this.inflight = null;
      for (const w of job.waiters) w.reject(new Error('timeout'));
      this._pump();
    }, 4000);
    this.sock.write(job.cmd + '\n');
  }

  // Helpers -------------------------------------------------------------
  static fmt(v) {
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    if (typeof v === 'number') return (Math.round(v * 10) / 10).toFixed(1);
    return String(v);
  }

  get(tag, attr, idx = []) {
    return this.send([quoteTag(tag), 'get', attr, ...idx].join(' '));
  }

  set(tag, attr, idx = [], value) {
    const cmd = [quoteTag(tag), 'set', attr, ...idx, Tesira.fmt(value)].join(' ');
    return this.send(cmd, `set|${tag}|${attr}|${idx.join(',')}`);
  }

  subscribe(tag, attr, idx = [], token, rateMs) {
    const parts = [quoteTag(tag), 'subscribe', attr, ...idx, token];
    if (rateMs) parts.push(rateMs);
    return this.send(parts.join(' '));
  }
}

module.exports = { Tesira, parseValue, parseResponse };
