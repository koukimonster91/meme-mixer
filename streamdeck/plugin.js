// MemeMixer Stream Deck plugin.
// Every "MemeMixer Key" shows whatever MemeMixer's Stream Deck page sets for its position
// (5 x 3 grid, several pages). MemeMixer sends a description of every key; this plugin
// draws it and reports presses. No dependencies: uses Node's built-in http/net/crypto.
'use strict';
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const render = require('./deck-render.js');

// ------------------------------------------------------------------ arguments from Stream Deck
const args = {};
for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^-+/, '')] = process.argv[i + 1];
const SD_PORT = Number(args.port);
const PLUGIN_UUID = args.pluginUUID;
const REGISTER_EVENT = args.registerEvent || 'registerPlugin';
const COLS = 5, ROWS = 3;

const log = (...a) => { try { console.log(new Date().toISOString(), ...a); } catch {} };

// ------------------------------------------------------------------ where MemeMixer is
function mixerBase() {
  if (process.env.MEMEMIXER_URL) return process.env.MEMEMIXER_URL.replace(/\/$/, '');
  let port = 8080;
  try {
    const home = process.env.MEMEMIXER_HOME || path.join(process.env.LOCALAPPDATA || '', 'MemeMixer');
    const cfg = JSON.parse(fs.readFileSync(path.join(home, 'data', 'config.json'), 'utf8'));
    if (cfg.web && Number(cfg.web.port)) port = Number(cfg.web.port);
  } catch {}
  return `http://127.0.0.1:${port}`;
}

// ------------------------------------------------------------------ minimal WebSocket client (RFC 6455)
function connectWs(port, handlers) {
  const key = crypto.randomBytes(16).toString('base64');
  const req = http.request({ host: '127.0.0.1', port, path: '/', headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Key': key, 'Sec-WebSocket-Version': '13' } });
  req.on('error', (e) => handlers.close(e));
  req.on('response', () => handlers.close(new Error('websocket upgrade refused')));
  req.on('upgrade', (res, sock, head) => {
    let buf = head && head.length ? Buffer.from(head) : Buffer.alloc(0);
    let frag = [];
    const frame = (opcode, payload) => {
      const len = payload.length;
      const hdr = len < 126 ? Buffer.alloc(2) : len < 65536 ? Buffer.alloc(4) : Buffer.alloc(10);
      hdr[0] = 0x80 | opcode;
      if (len < 126) hdr[1] = 0x80 | len;
      else if (len < 65536) { hdr[1] = 0x80 | 126; hdr.writeUInt16BE(len, 2); }
      else { hdr[1] = 0x80 | 127; hdr.writeBigUInt64BE(BigInt(len), 2); }
      const mask = crypto.randomBytes(4);
      const body = Buffer.alloc(len);
      for (let i = 0; i < len; i++) body[i] = payload[i] ^ mask[i & 3];
      sock.write(Buffer.concat([hdr, mask, body]));
    };
    const ws = { send: (text) => { if (!sock.destroyed) frame(1, Buffer.from(text, 'utf8')); } };
    sock.setNoDelay(true);
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      for (;;) {
        if (buf.length < 2) return;
        const fin = (buf[0] & 0x80) !== 0, op = buf[0] & 0x0f, masked = (buf[1] & 0x80) !== 0;
        let len = buf[1] & 0x7f, off = 2;
        if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
        else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
        const maskKey = masked ? buf.slice(off, off + 4) : null;
        if (masked) off += 4;
        if (buf.length < off + len) return;
        let payload = buf.slice(off, off + len);
        if (maskKey) { payload = Buffer.from(payload); for (let i = 0; i < payload.length; i++) payload[i] ^= maskKey[i & 3]; }
        buf = buf.slice(off + len);
        if (op === 8) { sock.end(); return; }
        if (op === 9) { frame(10, payload); continue; }
        if (op === 10) continue;
        if (op === 1 || op === 2 || op === 0) {
          frag.push(payload);
          if (fin) { const msg = Buffer.concat(frag).toString('utf8'); frag = []; handlers.message(msg); }
        }
      }
    });
    sock.on('close', () => handlers.close());
    sock.on('error', () => {});
    handlers.open(ws);
  });
  req.end();
}

// ------------------------------------------------------------------ Stream Deck side
let sd = null;
const sdSend = (event, context, payload) => { if (sd) sd.send(JSON.stringify(Object.assign({ event, context }, payload ? { payload } : {}))); };

const keys = new Map();     // context -> { device, col, row, img }
const pageOf = new Map();   // device -> page index
const held = new Map();     // context -> repeat timers

function keyIndex(k) { return k.col < COLS && k.row < ROWS ? k.row * COLS + k.col : -1; }

// ------------------------------------------------------------------ MemeMixer side
let deck = null;            // latest payload from /deck/events
let mixerUp = false;

function listenMixer() {
  const base = mixerBase();
  let retry = false;
  const again = () => { if (retry) return; retry = true; if (mixerUp) { mixerUp = false; drawAll(); } setTimeout(listenMixer, 2000); };
  const req = http.get(`${base}/deck/events?client=plugin`, { headers: { Accept: 'text/event-stream' } }, (res) => {
    if (res.statusCode !== 200) { res.resume(); return again(); }
    res.setEncoding('utf8');
    let text = '';
    res.on('data', (chunk) => {
      text += chunk;
      let i;
      while ((i = text.indexOf('\n\n')) >= 0) {
        const block = text.slice(0, i); text = text.slice(i + 2);
        let ev = 'message', data = '';
        for (const line of block.split('\n')) {
          if (line.startsWith('event:')) ev = line.slice(6).trim();
          else if (line.startsWith('data:')) data += line.slice(5).trim();
        }
        if (ev === 'deck' && data) {
          try { deck = JSON.parse(data); mixerUp = true; drawAll(); } catch (e) { log('bad deck data', e.message); }
        }
      }
    });
    res.on('end', again);
    res.on('error', again);
  });
  req.on('error', again);
  req.setTimeout(0);
}

function press(page, key) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ page, key });
    const u = new URL(`${mixerBase()}/api/deck/press`);
    const req = http.request({ host: u.hostname, port: u.port, path: u.pathname, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, (res) => {
      let d = ''; res.setEncoding('utf8');
      res.on('data', (c) => { d += c; });
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({ ok: false }); } });
    });
    req.on('error', () => resolve({ ok: false }));
    req.setTimeout(4000, () => { req.destroy(); resolve({ ok: false }); });
    req.end(body);
  });
}

// ------------------------------------------------------------------ drawing
function viewFor(k) {
  if (!deck) return undefined;
  const idx = keyIndex(k);
  const pages = deck.pages || [];
  const p = Math.min(pageOf.get(k.device) || 0, Math.max(0, pages.length - 1));
  return idx < 0 || !pages[p] ? null : pages[p].keys[idx];
}

function draw(context) {
  const k = keys.get(context);
  if (!k) return;
  let svg;
  if (!mixerUp) svg = render.renderOffline('not running');
  else {
    svg = render.renderKey(viewFor(k));
    if (deck && deck.online === false) svg = render.withTesiraOffline(svg);
  }
  if (svg === k.img) return;
  k.img = svg;
  sdSend('setImage', context, { image: 'data:image/svg+xml;charset=utf8,' + encodeURIComponent(svg), target: 0 });
}
function drawAll() { for (const c of keys.keys()) draw(c); }

// ------------------------------------------------------------------ key presses
async function keyDown(context) {
  const k = keys.get(context);
  if (!k || !mixerUp) { sdSend('showAlert', context); return; }
  const v = viewFor(k);
  if (!v) return;
  const dev = k.device;
  if (v.type === 'page') {
    pageOf.set(dev, v.to);
    for (const [c, kk] of keys) if (kk.device === dev) draw(c);
    return;
  }
  const page = pageOf.get(dev) || 0, idx = keyIndex(k);
  const r = await press(page, idx);
  if (!r.ok) { sdSend('showAlert', context); return; }
  if (v.type === 'scene') sdSend('showOk', context);
  if (v.type === 'volume') {
    // Hold to repeat.
    stopRepeat(context);
    const t = { busy: false };
    t.start = setTimeout(() => {
      t.every = setInterval(async () => {
        if (t.busy) return;
        t.busy = true;
        await press(page, idx);
        t.busy = false;
      }, 130);
    }, 420);
    held.set(context, t);
  }
}
function stopRepeat(context) {
  const t = held.get(context);
  if (t) { clearTimeout(t.start); clearInterval(t.every); held.delete(context); }
}

// ------------------------------------------------------------------ main
function onSdMessage(msg) {
  let m;
  try { m = JSON.parse(msg); } catch { return; }
  const { event, context, device, payload } = m;
  switch (event) {
    case 'willAppear': {
      if (payload && payload.isInMultiAction) return;
      const c = (payload && payload.coordinates) || { column: 0, row: 0 };
      keys.set(context, { device, col: c.column, row: c.row, img: null });
      sdSend('setTitle', context, { title: '', target: 0 });
      draw(context);
      break;
    }
    case 'willDisappear': stopRepeat(context); keys.delete(context); break;
    case 'keyDown': keyDown(context); break;
    case 'keyUp': stopRepeat(context); break;
    case 'deviceDidDisconnect': pageOf.delete(device); break;
    case 'systemDidWakeUp': for (const k of keys.values()) k.img = null; drawAll(); break;
  }
}

function connectStreamDeck() {
  connectWs(SD_PORT, {
    open(ws) {
      sd = ws;
      ws.send(JSON.stringify({ event: REGISTER_EVENT, uuid: PLUGIN_UUID }));
      log('registered with Stream Deck');
    },
    message: onSdMessage,
    close(err) { log('Stream Deck connection closed', err ? err.message : ''); process.exit(0); },
  });
}

if (!SD_PORT || !PLUGIN_UUID) { log('start me from the Stream Deck app'); process.exit(1); }
connectStreamDeck();
listenMixer();
