// MemeMixer — access control for phones and tablets (no accounts).
//
// * Requests from this PC itself are always allowed.
// * Any other device must be paired once: it enters the 6-digit code shown on this PC
//   (Settings → Phone & tablet access). The code changes every 30 seconds, works once, and
//   only exists while that card is open on this PC, so nothing can pair while nobody is looking.
// * A paired device gets a random 256-bit token in an HttpOnly cookie. Only a SHA-256 hash of the
//   token is stored (security.json), so the file can't be used to impersonate a device.
// * Wrong codes are rate limited per address and in total.
// * Paired devices can be removed one by one (or all at once), and phone access can be switched off.
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const CODE_MS = 30000;          // a pairing code lasts 30 seconds
const GRACE_MS = 5000;          // the previous code still works for 5 seconds (typing it as it changes)
const VIEW_MS = 6000;           // codes exist only while the PC's Settings card asked for one this recently
const COOKIE = 'mm_device';
const COOKIE_AGE = 365 * 24 * 3600;           // seconds; renewed while the device is used
const DEVICE_IDLE_DAYS = 90;                  // a device unused this long has to pair again
const IP_FAILS = 5, IP_WINDOW = 5 * 60000, IP_LOCK = 5 * 60000;   // per address: 5 wrong codes / 5 min → locked 5 min
const ALL_FAILS = 20, ALL_WINDOW = 10 * 60000;                     // all addresses: 20 wrong codes / 10 min → pairing paused

const normIp = (a) => String(a || '').replace(/^::ffff:/i, '');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

function parseCookies(h) {
  const out = {};
  for (const part of String(h || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

// A short name for a device from its browser's user-agent ("iPhone · Safari").
function deviceName(ua) {
  ua = String(ua || '');
  const osName = /iPad/.test(ua) ? 'iPad' : /iPhone/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android'
    : /Windows/.test(ua) ? 'Windows' : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /CrOS/.test(ua) ? 'Chromebook' : /Linux/.test(ua) ? 'Linux' : 'Device';
  const br = /EdgA?\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /SamsungBrowser/.test(ua) ? 'Samsung Internet'
    : /Firefox\/|FxiOS/.test(ua) ? 'Firefox' : /Chrome\/|CriOS/.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  return `${osName} · ${br}`;
}

function createAuth({ dataDir, log = () => {}, extraHosts = () => [] }) {
  const FILE = path.join(dataDir, 'security.json');
  let db = { remoteAccess: true, devices: [] };
  try {
    const d = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    db = { remoteAccess: d.remoteAccess !== false, devices: Array.isArray(d.devices) ? d.devices : [] };
  } catch {}
  let dirty = false;
  function save() {
    dirty = false;
    try {
      fs.writeFileSync(FILE + '.tmp', JSON.stringify(db, null, 2));
      fs.renameSync(FILE + '.tmp', FILE);
    } catch (e) { log(`could not save security.json: ${e.message}`); }
  }
  // drop devices that haven't been used for a long time
  function prune() {
    const cutoff = Date.now() - DEVICE_IDLE_DAYS * 86400000;
    const before = db.devices.length;
    db.devices = db.devices.filter((d) => Date.parse(d.lastSeen || d.created) > cutoff);
    if (db.devices.length !== before) save();
  }
  prune();
  setInterval(() => { prune(); if (dirty) save(); }, 60000).unref();

  // ---- who is asking
  const ownAddrs = () => {
    const s = new Set(['127.0.0.1', '::1']);
    for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) s.add(normIp(a.address));
    return s;
  };
  // Requests from this PC (loopback, or one of this PC's own addresses) are trusted.
  const isLocal = (req) => {
    const ip = normIp(req.socket.remoteAddress);
    if (ip.startsWith('127.') || ip === '::1') return true;
    // test switch: treat this PC's network address like another device
    return process.env.MIXER_TEST_LAN_IS_REMOTE !== '1' && ownAddrs().has(ip);
  };

  // Host header check, against DNS rebinding: only IP addresses, localhost and this PC's own name.
  function hostOk(req) {
    const host = String(req.headers.host || '');
    if (!host) return false;
    let name;
    try { name = new URL(`http://${host}`).hostname.toLowerCase(); } catch { return false; }
    name = name.replace(/^\[|\]$/g, '');
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(name) || name.includes(':')) return true; // IPv4 / IPv6 literal
    const pc = os.hostname().toLowerCase();
    const ok = ['localhost', pc, `${pc}.local`, `${pc}.lan`, `${pc}.home`, ...extraHosts().map((h) => String(h).toLowerCase())];
    return ok.includes(name) || name.endsWith('.localhost');
  }

  // Cross-site request check: a browser always sends Origin on a POST from another site.
  function sameOrigin(req) {
    const site = req.headers['sec-fetch-site'];
    if (site && site !== 'same-origin' && site !== 'none') return false;
    const origin = req.headers.origin;
    if (!origin) return true; // not a browser (Stream Deck plugin, tray), or a same-origin GET
    return origin === `http://${req.headers.host}`;
  }

  // ---- devices
  function deviceFor(req) {
    const tok = parseCookies(req.headers.cookie)[COOKIE];
    if (!tok || tok.length > 100) return null;
    const hash = sha(tok);
    const d = db.devices.find((x) => x.hash === hash);
    if (!d) return null;
    const now = new Date();
    if (now - Date.parse(d.lastSeen || 0) > 60000) {
      d.lastSeen = now.toISOString();
      d.ip = normIp(req.socket.remoteAddress);
      dirty = true;
    }
    return d;
  }
  const cookieHeader = (tok, age = COOKIE_AGE) => `${COOKIE}=${tok}; Path=/; Max-Age=${age}; HttpOnly; SameSite=Strict`;
  const publicDevice = (d) => ({ id: d.id, name: d.name, ip: d.ip, created: d.created, lastSeen: d.lastSeen });

  // ---- pairing codes
  let cur = null, prev = null, lastView = 0;
  function newCode() {
    prev = cur ? { code: cur.code, until: Date.now() + GRACE_MS } : null;
    cur = { code: String(crypto.randomInt(0, 1000000)).padStart(6, '0'), expires: Date.now() + CODE_MS };
  }
  // Called by the PC's Settings page (about once a second while the card is open).
  function currentCode() {
    lastView = Date.now();
    if (!cur || Date.now() >= cur.expires) newCode();
    return { code: cur.code, expiresIn: cur.expires - Date.now(), period: CODE_MS };
  }
  const pairingOpen = () => db.remoteAccess && Date.now() - lastView < VIEW_MS;
  const eq = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

  const fails = new Map(); // ip → { times: [], lockedUntil }
  let allFails = [];
  function pair(req, code, name) {
    const ip = normIp(req.socket.remoteAddress);
    const now = Date.now();
    const f = fails.get(ip) || { times: [], lockedUntil: 0 };
    if (f.lockedUntil > now) return { ok: false, error: 'locked', wait: Math.ceil((f.lockedUntil - now) / 1000) };
    allFails = allFails.filter((t) => now - t < ALL_WINDOW);
    if (allFails.length >= ALL_FAILS) return { ok: false, error: 'paused', wait: Math.ceil((allFails[0] + ALL_WINDOW - now) / 1000) };
    if (!db.remoteAccess) return { ok: false, error: 'off' };
    if (!pairingOpen()) return { ok: false, error: 'closed' };
    code = String(code || '').replace(/\D/g, '');
    const good = code.length === 6 && ((cur && now < cur.expires && eq(code, cur.code)) || (prev && now < prev.until && eq(code, prev.code)));
    if (!good) {
      f.times = f.times.filter((t) => now - t < IP_WINDOW).concat(now);
      allFails.push(now);
      if (f.times.length >= IP_FAILS) { f.lockedUntil = now + IP_LOCK; f.times = []; log(`pairing: too many wrong codes from ${ip}, blocked for 5 minutes`); }
      fails.set(ip, f);
      if (allFails.length === ALL_FAILS) log('pairing: too many wrong codes, pairing paused for a few minutes');
      return { ok: false, error: 'wrong' };
    }
    fails.delete(ip);
    newCode(); prev = null; // each code works once
    const tok = crypto.randomBytes(32).toString('base64url');
    const d = {
      id: crypto.randomBytes(6).toString('hex'),
      hash: sha(tok),
      name: String(name || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 40) || deviceName(req.headers['user-agent']),
      ip,
      created: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
    };
    db.devices.push(d);
    save();
    log(`paired a new device: ${d.name} (${ip})`);
    return { ok: true, device: publicDevice(d), cookie: cookieHeader(tok) };
  }

  function remove(id) {
    const d = db.devices.find((x) => x.id === id);
    db.devices = db.devices.filter((x) => x.id !== id);
    save();
    if (d) log(`removed device: ${d.name}`);
    return !!d;
  }
  function removeAll() { const n = db.devices.length; db.devices = []; save(); if (n) log(`removed all ${n} paired devices`); return n; }
  function setRemoteAccess(on) { db.remoteAccess = !!on; save(); log(`phone & tablet access ${on ? 'on' : 'off'}`); }

  return {
    isLocal, hostOk, sameOrigin, deviceFor, pair, currentCode, pairingOpen, remove, removeAll, setRemoteAccess,
    remoteAccess: () => db.remoteAccess,
    devices: () => db.devices.map(publicDevice),
    clearCookie: () => cookieHeader('', 0),
    deviceName,
  };
}

module.exports = { createAuth, deviceName, parseCookies };
