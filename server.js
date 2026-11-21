// MemeMixer — local web server.
// Holds one TTP connection to the Tesira, keeps a live state cache via
// subscriptions, and serves the browser UI (Server-Sent Events + JSON POSTs).
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { Tesira } = require('./tesira');
const discover = require('./discover');
const createDeck = require('./deck');
const { createAuth, parseCookies } = require('./auth');

const ROOT = __dirname;
// MIXER_DATA: folder for settings and scenes. The installed (tray) version keeps
// them outside the program folder so updates never overwrite them.
const DATA = process.env.MIXER_DATA || ROOT;
try { fs.mkdirSync(DATA, { recursive: true }); } catch {}
// MIXER_DEMO=1: run a built-in fake Tesira and keep demo settings/scenes apart from the real ones.
const DEMO = process.env.MIXER_DEMO === '1';
const TRAY = process.env.MIXER_TRAY === '1'; // started by the Windows tray app
const CONFIG_PATH = path.join(DATA, process.env.MIXER_CONFIG || (DEMO ? 'config.demo.json' : 'config.json'));
const SNAP_PATH = path.join(DATA, process.env.MIXER_CONFIG || DEMO ? 'snapshots.demo.json' : 'snapshots.json');
const VERSION = (() => { try { return fs.readFileSync(path.join(ROOT, 'VERSION'), 'utf8').trim(); } catch { return 'dev'; } })();
const PUBLIC = path.join(ROOT, 'public');

// ---------------------------------------------------------------- config
const DEFAULT_CONFIG = {
  // autoConnect: if the Tesira can't be reached, scan the network and switch to
  // the Tesira found there (only when exactly one is found).
  tesira: { host: '192.168.1.100', port: 23, autoConnect: true },
  // host 0.0.0.0 = reachable from phones/tablets on the same network; 127.0.0.1 = this PC only
  web: { host: '0.0.0.0', port: 8080 },
  tags: {
    mixer: 'Mixer1',
    inputMaster: 'Level1',
    inputMeter: 'AudioMeter2',
    noiseGate: 'NoiseGate1',
    aecInput: 'AecInput1',
    masters: ['Level2', 'Level3', 'Level4', 'Level5', 'Level6'],
    // Peak meter for each output master (same order as masters). Blank = no meter. Several outputs
    // can share one meter block; each output's `masterMeterChannels` picks its L/R channels on it.
    masterMeters: ['AudioMeter3', 'AudioMeter3', 'AudioMeter3', 'AudioMeter3', 'AudioMeter3'],
  },
  // Mixer inputs. `inputs` are matrix-mixer input numbers; `meter` are channels
  // on the input meter (the Peak Meter after the Input Master).
  sources: [
    { name: 'Mic 1', inputs: [1], meter: [1] },
    { name: 'Mic 2', inputs: [2], meter: [2] },
    { name: 'Mic 3', inputs: [3], meter: [3] },
    { name: 'Mic 4', inputs: [4], meter: [4] },
    { name: 'TV/AUX', inputs: [5, 6], meter: [5, 6] },
    { name: 'PC', inputs: [7, 8], meter: [7, 8] },
  ],
  // Mixer outputs (L, R) and which sources each output gets. `master` indexes tags.masters.
  outputs: [
    { name: 'Headphone 1', mixerOutputs: [1, 2], master: 0, masterMeterChannels: [1, 2], sources: ['Mic 1', 'Mic 2', 'Mic 3', 'Mic 4', 'TV/AUX', 'PC'] },
    { name: 'Headphone 2', mixerOutputs: [3, 4], master: 1, masterMeterChannels: [3, 4], sources: ['Mic 1', 'Mic 2', 'Mic 3', 'Mic 4', 'TV/AUX', 'PC'] },
    { name: 'Headphone 3', mixerOutputs: [5, 6], master: 2, masterMeterChannels: [5, 6], sources: ['Mic 1', 'Mic 2', 'Mic 3', 'Mic 4', 'TV/AUX', 'PC'] },
    { name: 'Headphone 4', mixerOutputs: [7, 8], master: 3, masterMeterChannels: [7, 8], sources: ['Mic 1', 'Mic 2', 'Mic 3', 'Mic 4', 'TV/AUX', 'PC'] },
    { name: 'USB Out', mixerOutputs: [9, 10], master: 4, masterMeterChannels: [9, 10], sources: ['Mic 1', 'Mic 2', 'Mic 3', 'Mic 4', 'TV/AUX'] },
  ],
  // Input Master channels (Level block) and their meter channel.
  inputChannels: [
    { name: 'Mic 1', channel: 1, meter: 1 },
    { name: 'Mic 2', channel: 2, meter: 2 },
    { name: 'Mic 3', channel: 3, meter: 3 },
    { name: 'Mic 4', channel: 4, meter: 4 },
    { name: 'TV/AUX L', channel: 5, meter: 5, link: 6 },
    { name: 'TV/AUX R', channel: 6, meter: 6, link: 5 },
    { name: 'PC L', channel: 7, meter: 7, link: 8 },
    { name: 'PC R', channel: 8, meter: 8, link: 7 },
  ],
  noiseGateChannels: ['TV/AUX L', 'TV/AUX R'],
  aecChannels: 12,
  meter: { min: -60, max: 24, yellow: 0, red: 18 },
  presets: [],
  // Noise Gate blocks shown on the Noise Gate page. Each block has one threshold / attack /
  // release / bypass; `channels` names its gain-reduction meters.
  noiseGates: [
    { name: 'TV/AUX', tag: 'NoiseGate1', channels: ['TV/AUX L', 'TV/AUX R'] },
    { name: 'Mic 1', tag: 'NoiseGate2', channels: ['Mic 1'] },
    { name: 'Mic 2', tag: 'NoiseGate3', channels: ['Mic 2'] },
    { name: 'Mic 3', tag: 'NoiseGate4', channels: ['Mic 3'] },
    { name: 'Mic 4', tag: 'NoiseGate5', channels: ['Mic 4'] },
  ],
};

function deepMerge(base, over) {
  if (Array.isArray(base) || typeof base !== 'object' || base === null) return over === undefined ? base : over;
  const out = { ...base };
  for (const k of Object.keys(over || {})) out[k] = deepMerge(base[k], over[k]);
  return out;
}

function loadConfig() {
  let raw;
  try { raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); }
  catch { fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2)); return structuredClone(DEFAULT_CONFIG); }
  const cfg = deepMerge(DEFAULT_CONFIG, raw);
  const OLD_METERS = ['AudioMeter3', 'AudioMeter4', 'AudioMeter5', 'AudioMeter6', 'AudioMeter7'];
  const savedMeters = raw.tags && raw.tags.masterMeters;
  if (Array.isArray(savedMeters) && JSON.stringify(savedMeters) === JSON.stringify(OLD_METERS) &&
      !(raw.outputs || []).some((o) => o && o.masterMeterChannels)) {
    // 1.5.0 and earlier assumed one meter block per output. Untouched defaults move to the shared
    // AudioMeter3: Headphone 1-4 on channels 1-2, 3-4, 5-6, 7-8 and USB Out on 9-10.
    cfg.tags.masterMeters = cfg.outputs.map(() => 'AudioMeter3');
    cfg.outputs.forEach((o, i) => { o.masterMeterChannels = [i * 2 + 1, i * 2 + 2]; });
    try { fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2)); } catch {}
  } else if (Array.isArray(savedMeters) && cfg.outputs[4] && savedMeters[cfg.outputs[4].master] === 'AudioMeter7' &&
      JSON.stringify(cfg.outputs[4].masterMeterChannels) === '[1,2]' && savedMeters.filter((t) => t === 'AudioMeter3').length >= 4) {
    // 1.5.1 left USB Out on AudioMeter7 channels 1-2; it shares AudioMeter3 too (channels 9-10).
    cfg.tags.masterMeters[cfg.outputs[4].master] = 'AudioMeter3';
    cfg.outputs[4].masterMeterChannels = [9, 10];
    try { fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2)); } catch {}
  }
  if (!Array.isArray(raw.noiseGates)) {
    // Before 1.5.0 there was one gate (tags.noiseGate): keep its tag and channel names, add the mic gates.
    cfg.noiseGates = structuredClone(DEFAULT_CONFIG.noiseGates);
    cfg.noiseGates[0].tag = cfg.tags.noiseGate || 'NoiseGate1';
    if (Array.isArray(cfg.noiseGateChannels) && cfg.noiseGateChannels.join() !== 'Gate 1,Gate 2') cfg.noiseGates[0].channels = cfg.noiseGateChannels;
    try { fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2)); } catch {}
  } else if (cfg.noiseGates[0] && cfg.noiseGates[0].name === 'Gate') {
    // 1.5.0-1.5.2 called the TV/AUX gate just "Gate".
    cfg.noiseGates[0].name = 'TV/AUX';
    if ((cfg.noiseGates[0].channels || []).join() === 'Gate 1,Gate 2') cfg.noiseGates[0].channels = ['TV/AUX L', 'TV/AUX R'];
    try { fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2)); } catch {}
  }
  return cfg;
}
const gateTags = () => (config.noiseGates || []).map((g) => g.tag).filter(Boolean);
function saveConfig() { fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2)); }

function loadSnapshots() { try { return JSON.parse(fs.readFileSync(SNAP_PATH, 'utf8')); } catch { return {}; } }
function saveSnapshots() { fs.writeFileSync(SNAP_PATH, JSON.stringify(snapshots, null, 2)); }

let config = loadConfig();
if (DEMO) {
  // Demo uses the same web address as the real setup, so links and phone bookmarks keep working.
  try { config.web = { ...config.web, ...JSON.parse(fs.readFileSync(path.join(DATA, 'config.json'), 'utf8')).web }; } catch {}
}
let snapshots = loadSnapshots();

// ---------------------------------------------------------------- state
const state = new Map();          // "tag|attr|idx" -> value
let aliases = [];
const tokens = new Map();         // publishToken -> handler(value)
let meters = {};                  // tag -> array of dB
const lastMeters = {};            // latest meter values per tag (for the Stream Deck)
let pending = {};                 // patches to broadcast
let log = [];

const key = (tag, attr, idx) => `${tag}|${attr}|${[].concat(idx).join(',')}`;

function put(k, v) {
  if (state.get(k) === v) return;
  state.set(k, v);
  pending[k] = v;
}

function addLog(msg) {
  const line = `${new Date().toLocaleTimeString()}  ${msg}`;
  log.push(line);
  if (log.length > 200) log.shift();
  broadcast('log', line);
}

// ---------------------------------------------------------------- SSE
const clients = new Set();
function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(msg);
}
setInterval(() => {
  if (Object.keys(pending).length) { broadcast('patch', pending); pending = {}; }
}, 40);
setInterval(() => {
  if (Object.keys(meters).length) { Object.assign(lastMeters, meters); broadcast('meters', meters); meters = {}; }
}, 66);

// ---------------------------------------------------------------- Tesira
const tesira = new Tesira();
let generation = 0;

tesira.on('log', addLog);
tesira.on('status', (s) => { broadcast('status', status()); if (!s.connected) addLog('disconnected'); });
tesira.on('publish', (tok, value) => { const h = tokens.get(tok); if (h) h(value); });
tesira.on('ready', () => { addLog(`connected to ${config.tesira.host}:${config.tesira.port}`); setup(++generation); });

function status() {
  return { connected: tesira.connected, ready: tesira.ready, host: config.tesira.host, port: config.tesira.port };
}

let tokenSeq = 0;
function sub(tag, attr, idx, handler, rate) {
  const tok = `tm${++tokenSeq}`;
  tokens.set(tok, handler);
  return tesira.subscribe(tag, attr, [].concat(idx ?? []), tok, rate).then((r) => {
    if (!r.ok) addLog(`subscribe failed: ${tag} ${attr} ${[].concat(idx ?? []).join(' ')} → ${r.raw}`);
  }).catch(() => {});
}

function arrayTo(tag, attr) {
  return (v) => { if (Array.isArray(v)) v.forEach((x, i) => put(key(tag, attr, i + 1), x)); };
}

async function getInto(tag, attr, idx = []) {
  try {
    const r = await tesira.get(tag, attr, idx);
    if (r.ok) put(key(tag, attr, idx), r.value);
    return r;
  } catch { return null; }
}

function crosspoints() {
  const list = [];
  for (const out of config.outputs) {
    for (const name of out.sources) {
      const src = config.sources.find((s) => s.name === name);
      if (src) list.push(...pairs(src, out));
    }
  }
  return list;
}
// Mono source feeds both sides; stereo source feeds L->L and R->R.
function pairs(src, out) {
  const [l, r] = out.mixerOutputs;
  if (src.inputs.length === 1) return [[src.inputs[0], l], [src.inputs[0], r]];
  return [[src.inputs[0], l], [src.inputs[1], r]];
}

let pollTimer = null;
async function setup(gen) {
  tokens.clear();
  const T = config.tags;
  try {
    const r = await tesira.send('SESSION get aliases');
    if (r.ok && Array.isArray(r.value)) { aliases = r.value.map(String); broadcast('aliases', aliases); }
  } catch {}
  const missing = [T.mixer, T.inputMaster, T.inputMeter, ...gateTags(), T.aecInput, ...T.masters, ...(T.masterMeters || [])]
    .filter((t) => t && aliases.length && !aliases.includes(t));
  if (missing.length) addLog(`instance tags not found on device: ${missing.join(', ')} — check Settings`);

  // Mixer crosspoints: every crosspoint in the matrix (for the Matrix page) plus any in the config.
  const dims = await Promise.all([getInto(T.mixer, 'numInputs'), getInto(T.mixer, 'numOutputs')]);
  const nIn = Math.min(Number(dims[0]?.value) || 0, 32), nOut = Math.min(Number(dims[1]?.value) || 0, 32);
  const all = [...crosspoints()];
  for (let i = 1; i <= nIn; i++) for (let o = 1; o <= nOut; o++) all.push([i, o]);
  const seen = new Set();
  for (const [i, o] of all) {
    if (gen !== generation) return;
    const id = `${i},${o}`;
    if (seen.has(id)) continue;
    seen.add(id);
    sub(T.mixer, 'crosspointLevel', [i, o], (v) => put(key(T.mixer, 'crosspointLevel', [i, o]), v));
    sub(T.mixer, 'crosspointLevelState', [i, o], (v) => put(key(T.mixer, 'crosspointLevelState', [i, o]), v));
  }
  // Level blocks: input master + output masters
  for (const tag of [T.inputMaster, ...T.masters]) {
    if (!tag) continue;
    sub(tag, 'levels', null, arrayTo(tag, 'level'));
    sub(tag, 'mutes', null, arrayTo(tag, 'mute'));
    getInto(tag, 'minLevel', [1]);
    getInto(tag, 'maxLevel', [1]);
  }
  // Meters
  sub(T.inputMeter, 'levels', null, (v) => { meters[T.inputMeter] = v; }, 100);
  for (const tag of new Set((T.masterMeters || []).filter(Boolean))) {
    if (tag !== T.inputMeter) sub(tag, 'levels', null, (v) => { meters[tag] = [].concat(v); }, 100);
  }
  for (const tag of new Set(gateTags())) sub(tag, 'allGainReduction', null, (v) => { meters[tag] = [].concat(v); }, 100);
  sub(T.aecInput, 'phantomPowers', null, arrayTo(T.aecInput, 'phantomPower'));
  sub(T.aecInput, 'peaks', null, (v) => { meters[`${T.aecInput}:peaks`] = [].concat(v); }, 200);

  clearInterval(pollTimer);
  const poll = () => {
    if (!tesira.ready) return;
    for (const tag of new Set(gateTags())) for (const a of ['threshold', 'attackTime', 'releaseTime', 'bypass']) getInto(tag, a);
    for (let c = 1; c <= config.aecChannels; c++) getInto(T.aecInput, 'gain', [c]);
  };
  poll();
  pollTimer = setInterval(poll, 5000);
}

let connectStarted = 0;
function connect() {
  state.clear();
  broadcast('reset', {});
  connectStarted = Date.now();
  tesira.connect(config.tesira.host, Number(config.tesira.port) || 23);
}

// ---------------------------------------------------------------- scan / auto-connect
let lastScan = { devices: [], subnets: [], at: null, scanning: false };
async function runScan(reason) {
  if (discover.isScanning()) return discover.scan();
  lastScan = { ...lastScan, scanning: true };
  broadcast('scan', lastScan);
  addLog(`scanning network for Tesira (${reason})…`);
  const r = await discover.scan(Number(config.tesira.port) || 23);
  lastScan = { ...r, at: new Date().toISOString(), scanning: false };
  broadcast('scan', lastScan);
  addLog(`scan found ${r.devices.length} Tesira${r.devices.length === 1 ? '' : 's'} on ${r.subnets.join(', ') || 'no network'} (${(r.ms / 1000).toFixed(1)} s)` +
    (r.devices.length ? ': ' + r.devices.map((d) => d.name ? `${d.name} ${d.host}` : d.host).join(', ') : ''));
  return r;
}

let lastAutoScan = 0;
async function autoConnectCheck() {
  if (!config.tesira.autoConnect || tesira.ready || discover.isScanning()) return;
  const now = Date.now();
  // Give the saved address 8 s, then scan; repeat at most once a minute while offline.
  if (now - connectStarted < 8000 || now - lastAutoScan < 60000) return;
  lastAutoScan = now;
  const r = await runScan('saved address not answering');
  if (tesira.ready || !config.tesira.autoConnect) return;
  if (r.devices.some((d) => d.host === config.tesira.host)) return; // it's there, just slow
  if (r.devices.length === 1) {
    const d = r.devices[0];
    addLog(`auto-connect: switching to ${d.name || 'Tesira'} at ${d.host}:${d.port}`);
    config.tesira.host = d.host;
    config.tesira.port = d.port;
    saveConfig();
    broadcast('config', config);
    connect();
  } else if (r.devices.length > 1) {
    addLog('auto-connect: more than one Tesira found; pick one in Settings');
  }
}
setInterval(autoConnectCheck, 3000);

// ---------------------------------------------------------------- set ops
const SETTABLE = new Set(['crosspointLevel', 'crosspointLevelState', 'level', 'mute', 'threshold',
  'attackTime', 'releaseTime', 'bypass', 'phantomPower', 'gain']);

function allowedTags() {
  const T = config.tags;
  return new Set([T.mixer, T.inputMaster, ...gateTags(), T.aecInput, ...T.masters].filter(Boolean));
}

function applyOps(ops) {
  const tags = allowedTags();
  const results = [];
  for (const op of ops || []) {
    const idx = [].concat(op.idx ?? []).map(Number);
    if (!tags.has(op.tag) || !SETTABLE.has(op.attr) || idx.some((n) => !Number.isInteger(n) || n < 1)) {
      results.push(Promise.resolve({ ok: false, raw: 'rejected' }));
      continue;
    }
    let v = op.value;
    if (typeof v !== 'boolean') { v = Number(v); if (!Number.isFinite(v)) continue; }
    put(key(op.tag, op.attr, idx), v);
    results.push(tesira.set(op.tag, op.attr, idx, v).then((r) => {
      if (!r.ok) addLog(`set failed: ${op.tag} ${op.attr} ${idx.join(' ')} ${v} → ${r.raw}`);
      return r;
    }).catch((e) => ({ ok: false, raw: e.message })));
  }
  return Promise.all(results);
}

// ---------------------------------------------------------------- snapshots
const SNAP_ATTRS = new Set(['crosspointLevel', 'crosspointLevelState', 'level', 'mute', 'threshold', 'attackTime', 'releaseTime', 'bypass']);
function captureSnapshot() {
  const ops = [];
  for (const [k, v] of state) {
    const [tag, attr, idx] = k.split('|');
    if (!SNAP_ATTRS.has(attr) || v === null || v === undefined) continue;
    ops.push({ tag, attr, idx: idx ? idx.split(',').map(Number) : [], value: v });
  }
  return ops;
}

async function recallScene(name) {
  const s = snapshots[name];
  if (!s) return { ok: false, message: `no scene "${name}"` };
  await applyOps(s.ops);
  addLog(`recalled snapshot "${name}"`);
  return { ok: true };
}

// ---------------------------------------------------------------- Stream Deck
// The key layout has its own file, shared by normal and demo mode (which have separate settings).
const DECK_PATH = path.join(DATA, 'streamdeck.json');
function loadDeckLayout() {
  try { const l = JSON.parse(fs.readFileSync(DECK_PATH, 'utf8')); if (l && Array.isArray(l.pages)) return l; } catch {}
  // 1.2.0 kept the layout inside the settings file: move it out (the real settings first).
  for (const f of ['config.json', path.basename(CONFIG_PATH)]) {
    try {
      const c = JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));
      if (c.streamDeck && Array.isArray(c.streamDeck.pages)) { fs.writeFileSync(DECK_PATH, JSON.stringify(c.streamDeck, null, 2)); return c.streamDeck; }
    } catch {}
  }
  return null;
}
let deckLayout = loadDeckLayout();
if (config.streamDeck) { delete config.streamDeck; saveConfig(); }

const deck = createDeck({
  getConfig: () => ({ ...config, streamDeck: deckLayout || createDeck.defaultLayout(config) }),
  getState: (k) => state.get(k),
  applyOps,
  getMeter: (tag) => lastMeters[tag],
  recallScene,
});
// The plugin listens on /deck/events: the whole layout as key views, sent when anything changes.
const deckClients = new Set();
let pluginClients = 0;
let lastDeckJson = '';
function deckPayload() { return JSON.stringify({ ...deck.views(tesira.ready), scenes: Object.keys(snapshots) }); }
setInterval(() => {
  if (!deckClients.size) return;
  const j = deckPayload();
  if (j === lastDeckJson) return;
  lastDeckJson = j;
  for (const res of deckClients) res.write(`event: deck\ndata: ${j}\n\n`);
}, 100);
setInterval(() => { for (const res of deckClients) res.write(': keepalive\n\n'); }, 15000);

// ---------------------------------------------------------------- HTTP
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

function body(req) {
  return new Promise((resolve) => {
    let d = '';
    req.on('data', (c) => { d += c; if (d.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(d || '{}')); } catch { resolve({}); } });
  });
}
function json(res, obj, code = 200) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

// ---------------------------------------------------------------- security (see auth.js)
const auth = createAuth({ dataDir: DATA, log: (m) => addLog(m), extraHosts: () => (config.web && config.web.allowedHosts) || [] });
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
};
// What a device that isn't paired yet may load: the pairing page and what it needs.
const PAIR_FILES = new Set(['/pair', '/pair.html', '/pair.js', '/style.css', '/logo.png', '/favicon.ico']);
// Close the live streams of a removed device so it stops getting updates at once.
function dropDevice(id) {
  for (const set of [clients, deckClients]) for (const r of set) if (id === '*' ? r.deviceId : r.deviceId === id) r.end();
}

const server = http.createServer(async (req, res) => {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  let url;
  try { url = new URL(req.url, 'http://x'); } catch { res.writeHead(400); return res.end(); }
  const p = url.pathname;

  // Only IP addresses and this PC's name (DNS rebinding), and no requests from other websites (CSRF).
  if (!auth.hostOk(req)) { res.writeHead(421, { 'Content-Type': 'text/plain' }); return res.end('MemeMixer: open it by IP address or this PC\'s name.'); }
  const isApi = p.startsWith('/api/') || p === '/events' || p === '/deck/events';
  if ((req.method !== 'GET' && req.method !== 'HEAD') || isApi) {
    if (!auth.sameOrigin(req)) return json(res, { ok: false, error: 'cross-site request refused' }, 403);
  }
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'POST') { res.writeHead(405); return res.end(); }

  // Who is it: this PC, a paired device, or an unknown device.
  const local = auth.isLocal(req);
  const device = local ? null : auth.deviceFor(req);
  if (!local) {
    if (!auth.remoteAccess()) {
      if (isApi) return json(res, { ok: false, error: 'remote access off' }, 403);
      res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end('<!doctype html><meta name="viewport" content="width=device-width"><body style="font-family:sans-serif;background:#090b10;color:#ddd;padding:24px"><h2>MemeMixer</h2><p>Phone &amp; tablet access is switched off. Turn it on in Settings on the MemeMixer PC.</p>');
    }
    if (p === '/api/pair' && req.method === 'POST') {
      const b = await body(req);
      const r = auth.pair(req, b.code, b.name);
      if (r.ok) res.setHeader('Set-Cookie', r.cookie);
      return json(res, { ok: r.ok, error: r.error, wait: r.wait }, r.ok ? 200 : r.error === 'wrong' || r.error === 'closed' ? 400 : 429);
    }
    if (!device) {
      if (p === '/api/pair/status') return json(res, { paired: false, open: auth.pairingOpen() });
      if (isApi || req.method !== 'GET') return json(res, { ok: false, error: 'not paired' }, 401);
      if (!PAIR_FILES.has(p)) { res.writeHead(302, { Location: '/pair', 'Cache-Control': 'no-store' }); return res.end(); }
    }
  }
  if (p === '/pair' || p === '/pair.html') {
    if (local || device) { res.writeHead(302, { Location: '/' }); return res.end(); }
    return serveFile(res, path.join(PUBLIC, 'pair.html'));
  }
  if (p === '/api/pair/status') return json(res, { paired: true });
  if (p === '/api/device/forget' && req.method === 'POST' && device) {
    auth.remove(device.id); dropDevice(device.id);
    res.setHeader('Set-Cookie', auth.clearCookie());
    return json(res, { ok: true });
  }
  if (device && req.method === 'GET' && !isApi && (p === '/' || p === '/index.html')) {
    res.setHeader('Set-Cookie', `mm_device=${parseCookies(req.headers.cookie).mm_device}; Path=/; Max-Age=${365 * 24 * 3600}; HttpOnly; SameSite=Strict`); // keep the cookie fresh
  }

  // Security settings: this PC only.
  if (p.startsWith('/api/security')) {
    if (!local) return json(res, { ok: false, error: 'only on the MemeMixer PC' }, 403);
    if (p === '/api/security' && req.method === 'GET') {
      return json(res, { remoteAccess: auth.remoteAccess(), pairing: auth.remoteAccess() ? auth.currentCode() : null, devices: auth.devices() });
    }
    if (req.method === 'POST') {
      const b = await body(req);
      if (p === '/api/security/remove') { const ok = auth.remove(String(b.id || '')); dropDevice(String(b.id || '')); return json(res, { ok }); }
      if (p === '/api/security/remove-all') { const n = auth.removeAll(); dropDevice('*'); return json(res, { ok: true, removed: n }); }
      if (p === '/api/security/remote-access') { auth.setRemoteAccess(!!b.on); if (!b.on) dropDevice('*'); broadcast('security', { remoteAccess: !!b.on }); return json(res, { ok: true }); }
    }
    return json(res, { error: 'not found' }, 404);
  }

  if (p === '/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write(`event: hello\ndata: {}\n\n`);
    res.deviceId = device && device.id;
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  if (p === '/deck/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write(`event: deck\ndata: ${deckPayload()}\n\n`);
    res.deviceId = device && device.id;
    deckClients.add(res);
    const isPlugin = url.searchParams.get('client') === 'plugin';
    if (isPlugin) pluginClients++;
    req.on('close', () => { deckClients.delete(res); if (isPlugin) pluginClients--; });
    return;
  }
  if (p === '/api/deck' && req.method === 'GET') {
    return json(res, { layout: deckLayout || createDeck.defaultLayout(config), custom: !!deckLayout, connected: pluginClients });
  }
  if (p === '/api/state' && req.method === 'GET') {
    return json(res, { config, state: Object.fromEntries(state), status: status(), aliases, log, snapshots: Object.keys(snapshots), networkUrls: networkUrls(), scan: lastScan, version: VERSION, demo: DEMO, canSwitchDemo: TRAY, local, device: device ? { id: device.id, name: device.name } : null });
  }
  if (req.method === 'POST') {
    const b = await body(req);
    switch (p) {
      case '/api/set':
        return json(res, { results: await applyOps(b.ops) });
      case '/api/config': {
        // web server settings (address, port, allowed names) can only be changed on this PC
        if (!local && b.config) delete b.config.web;
        const next = deepMerge(config, b.config || {});
        const reconnect = next.tesira.host !== config.tesira.host || Number(next.tesira.port) !== Number(config.tesira.port);
        config = next;
        saveConfig();
        broadcast('config', config);
        if (reconnect || b.reconnect) connect(); else if (tesira.ready) setup(++generation);
        return json(res, { ok: true });
      }
      case '/api/reconnect':
        connect();
        return json(res, { ok: true });
      case '/api/demo': {
        // Only when run by the tray app, which restarts the server on exit code 3.
        if (!TRAY) return json(res, { ok: false, raw: 'demo mode can only be switched in the installed app' });
        const flag = path.join(DATA, 'demo-mode');
        if (b.on) fs.writeFileSync(flag, 'Delete this file (or untick Demo mode) to use the real Tesira.');
        else { try { fs.unlinkSync(flag); } catch {} }
        json(res, { ok: true });
        broadcast('restarting', { demo: !!b.on });
        setTimeout(() => process.exit(3), 300);
        return;
      }
      case '/api/scan':
        return json(res, await runScan('requested'));
      case '/api/raw': {
        try { const r = await tesira.send(String(b.cmd || '')); addLog(`> ${b.cmd}  ${r.raw}`); return json(res, r); }
        catch (e) { return json(res, { ok: false, raw: e.message }); }
      }
      case '/api/preset': {
        const id = parseInt(b.id, 10);
        if (!Number.isInteger(id)) return json(res, { ok: false, raw: 'bad preset id' });
        try { const r = await tesira.send(`DEVICE recallPreset ${id}`); addLog(`recall preset ${id} → ${r.raw}`); return json(res, r); }
        catch (e) { return json(res, { ok: false, raw: e.message }); }
      }
      case '/api/snapshot/save': {
        const name = String(b.name || '').trim().slice(0, 60);
        if (!name) return json(res, { ok: false });
        snapshots[name] = { saved: new Date().toISOString(), ops: captureSnapshot() };
        saveSnapshots();
        broadcast('snapshots', Object.keys(snapshots));
        return json(res, { ok: true });
      }
      case '/api/snapshot/recall':
        return json(res, await recallScene(b.name));
      case '/api/deck/save': {
        // layout null = back to the default layout
        if (b.layout && Array.isArray(b.layout.pages)) {
          deckLayout = { pages: b.layout.pages.slice(0, 50) };
          fs.writeFileSync(DECK_PATH, JSON.stringify(deckLayout, null, 2));
        } else {
          deckLayout = null;
          try { fs.unlinkSync(DECK_PATH); } catch {}
        }
        return json(res, { ok: true });
      }
      case '/api/deck/press': {
        const r = await deck.press(Number(b.page) || 0, Number(b.key) || 0).catch((e) => ({ ok: false, message: e.message }));
        return json(res, r);
      }
      case '/api/snapshot/delete':
        delete snapshots[b.name];
        saveSnapshots();
        broadcast('snapshots', Object.keys(snapshots));
        return json(res, { ok: true });
    }
    return json(res, { error: 'not found' }, 404);
  }

  // static files
  let rel;
  try { rel = decodeURIComponent(p === '/' ? '/index.html' : p); } catch { res.writeHead(400); return res.end(); }
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end(); }
  serveFile(res, file);
});
function serveFile(res, file) {
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}
server.maxConnections = 200;
server.headersTimeout = 15000;
server.requestTimeout = 0; // live update streams stay open

const webHost = process.env.WEB_HOST || config.web.host;
const webPort = Number(process.env.WEB_PORT || config.web.port);
// Addresses other devices on the network can use to reach this app.
function networkUrls() {
  if (webHost !== '0.0.0.0') return [];
  const urls = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    if (/virtualbox|vmware|vethernet|hyper-v|loopback|wsl|docker/i.test(name)) continue;
    for (const a of addrs || []) if (a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.') && !/^(0a|08):00:27/i.test(a.mac)) urls.push(`http://${a.address}:${webPort}`);
  }
  return urls;
}

server.on('error', (e) => {
  console.error(e.code === 'EADDRINUSE' ? `Port ${webPort} is already in use (is MemeMixer already running?)` : `Web server error: ${e.message}`);
  process.exit(2);
});
server.listen(webPort, webHost, () => {
  console.log(`MemeMixer ${VERSION} running at http://localhost:${webPort}`);
  for (const u of networkUrls()) console.log(`  On your phone (same Wi-Fi/network): ${u}`);
  console.log(DEMO ? 'Demo mode: using a built-in fake Tesira' : `Tesira target ${config.tesira.host}:${config.tesira.port} (change in Settings)`);
});
if (DEMO) {
  require('./mock-tesira').start(0).then((port) => {
    config.tesira = { ...config.tesira, host: '127.0.0.1', port, autoConnect: false };
    addLog('demo mode: connected to the built-in fake Tesira (no hardware needed)');
    connect();
  }).catch((e) => { console.error(`Demo Tesira failed to start: ${e.message}`); connect(); });
} else connect();
