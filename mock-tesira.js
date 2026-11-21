// Mock Tesira Text Protocol server for testing without hardware.
// Usage: node mock-tesira.js [port]   (default 2323) — then point Settings at 127.0.0.1:2323
const net = require('net');
const PORT = Number(process.argv[2] || 2323);

const blocks = {
  Mixer1: { type: 'mixer', inputs: 8, outputs: 10, xl: {}, xs: {} },
  Level1: { type: 'level', n: 8 },
  Level2: { type: 'level', n: 2 }, Level3: { type: 'level', n: 2 }, Level4: { type: 'level', n: 2 },
  Level5: { type: 'level', n: 2 }, Level6: { type: 'level', n: 2 },
  AudioMeter1: { type: 'meter', n: 12 },
  AudioMeter2: { type: 'meter', n: 8 },
  AudioMeter3: { type: 'meter', n: 2 }, AudioMeter4: { type: 'meter', n: 2 }, AudioMeter5: { type: 'meter', n: 2 },
  AudioMeter6: { type: 'meter', n: 2 }, AudioMeter7: { type: 'meter', n: 2 },
  NoiseGate1: { type: 'gate', n: 2, threshold: -40, attackTime: 5, releaseTime: 200, bypass: false },
  NoiseGate2: { type: 'gate', n: 1, threshold: -45, attackTime: 2, releaseTime: 150, bypass: false },
  NoiseGate3: { type: 'gate', n: 1, threshold: -45, attackTime: 2, releaseTime: 150, bypass: false },
  NoiseGate4: { type: 'gate', n: 1, threshold: -45, attackTime: 2, releaseTime: 150, bypass: false },
  NoiseGate5: { type: 'gate', n: 1, threshold: -45, attackTime: 2, releaseTime: 150, bypass: false },
  AecInput1: { type: 'aec', n: 12 },
};
for (const b of Object.values(blocks)) {
  if (b.type === 'level') { b.level = Array(b.n).fill(0); b.mute = Array(b.n).fill(false); }
  if (b.type === 'aec') { b.phantomPower = Array(b.n).fill(false); b.gain = Array(b.n).fill(24); }
  if (b.type === 'mixer') for (let i = 1; i <= b.inputs; i++) for (let o = 1; o <= b.outputs; o++) { b.xl[`${i},${o}`] = -10; b.xs[`${i},${o}`] = true; }
}

const f = (v) => (typeof v === 'number' ? v.toFixed(6) : typeof v === 'boolean' ? String(v) : `"${v}"`);
const fv = (v) => (Array.isArray(v) ? `[${v.map(f).join(' ')}]` : f(v));
const clients = new Set();

function meterVals(b, t) {
  return Array.from({ length: b.n }, (_, i) => {
    const base = -30 + 18 * Math.sin(t / 700 + i * 1.3) + Math.random() * 8;
    return Math.round(base * 10) / 10;
  });
}

function getAttr(b, attr, idx) {
  const ch = idx[0] - 1;
  switch (b.type) {
    case 'mixer':
      if (attr === 'crosspointLevel') return b.xl[idx.join(',')];
      if (attr === 'crosspointLevelState') return b.xs[idx.join(',')];
      if (attr === 'numInputs') return b.inputs;
      if (attr === 'numOutputs') return b.outputs;
      break;
    case 'level':
      if (attr === 'level') return b.level[ch];
      if (attr === 'mute') return b.mute[ch];
      if (attr === 'levels') return b.level;
      if (attr === 'mutes') return b.mute;
      if (attr === 'minLevel') return -100;
      if (attr === 'maxLevel') return 12;
      if (attr === 'numChannels') return b.n;
      break;
    case 'gate':
      if (['threshold', 'attackTime', 'releaseTime', 'bypass'].includes(attr)) return b[attr];
      if (attr === 'allGainReduction') return Array.from({ length: b.n }, () => -Math.round(Math.random() * 200) / 10);
      if (attr === 'numChannels') return b.n;
      break;
    case 'aec':
      if (attr === 'phantomPower') return b.phantomPower[ch];
      if (attr === 'phantomPowers') return b.phantomPower;
      if (attr === 'gain') return b.gain[ch];
      if (attr === 'peaks') return Array.from({ length: b.n }, () => Math.random() < 0.03);
      if (attr === 'numChannels') return b.n;
      break;
    case 'meter':
      if (attr === 'levels') return meterVals(b, Date.now());
      if (attr === 'level') return meterVals(b, Date.now())[ch];
      break;
  }
  return undefined;
}

function setAttr(b, attr, idx, raw) {
  const v = raw === 'true' ? true : raw === 'false' ? false : Number(raw);
  const ch = idx[0] - 1;
  if (b.type === 'mixer' && attr === 'crosspointLevel') b.xl[idx.join(',')] = Math.max(-100, Math.min(0, v));
  else if (b.type === 'mixer' && attr === 'crosspointLevelState') b.xs[idx.join(',')] = v;
  else if (b.type === 'level' && attr === 'level' && ch < b.n) b.level[ch] = Math.max(-100, Math.min(12, v));
  else if (b.type === 'level' && attr === 'mute' && ch < b.n) b.mute[ch] = v;
  else if (b.type === 'gate' && attr in b) b[attr] = v;
  else if (b.type === 'aec' && attr === 'phantomPower') b.phantomPower[ch] = v;
  else if (b.type === 'aec' && attr === 'gain') b.gain[ch] = v;
  else return false;
  return true;
}

function publishChange(tag) {
  for (const c of clients) {
    for (const s of c.subs) {
      if (s.tag !== tag || s.timer) continue;
      const v = getAttr(blocks[tag], s.attr, s.idx);
      c.sock.write(`! "publishToken":"${s.token}" "value":${fv(v)}\r\n`);
    }
  }
}

function handle(c, line) {
  c.sock.write(line + '\r\n'); // echo, like the real Telnet server
  const parts = line.match(/"[^"]*"|\S+/g) || [];
  const [tagRaw, cmd, attr, ...rest] = parts;
  const tag = tagRaw?.replace(/"/g, '');
  const out = (s) => c.sock.write(s + '\r\n');
  if (tag === 'SESSION') {
    if (cmd === 'get' && attr === 'aliases') return out(`+OK "list":[${Object.keys(blocks).map((k) => `"${k}"`).join(' ')}]`);
    if (attr === 'verbose') return out(cmd === 'get' ? '+OK "value":true' : '+OK');
    return out('-ERR unknown session command');
  }
  if (tag === 'DEVICE' && cmd === 'get' && attr === 'hostname') return out('+OK "value":"MockTesira"');
  if (tag === 'DEVICE' && cmd === 'recallPreset') {
    for (const b of Object.values(blocks)) if (b.type === 'level') b.level.fill(-6);
    out('+OK');
    for (const k of Object.keys(blocks)) publishChange(k);
    return;
  }
  const b = blocks[tag];
  if (!b) return out('-ERR address not found: {"deviceId":0 "classCode":0 "instanceNum":0}');
  if (cmd === 'get') {
    const v = getAttr(b, attr, rest.map(Number));
    return out(v === undefined ? '-ERR INVALID_PARAMETER' : `+OK "value":${fv(v)}`);
  }
  if (cmd === 'set') {
    const value = rest.pop();
    if (!setAttr(b, attr, rest.map(Number), value)) return out('-ERR INVALID_PARAMETER');
    out('+OK');
    publishChange(tag);
    return;
  }
  if (cmd === 'subscribe') {
    const nums = rest.filter((x) => /^\d+$/.test(x));
    const token = rest.find((x) => !/^\d+$/.test(x));
    // index args come before the token; a trailing number after the token is the rate
    const tokPos = rest.indexOf(token);
    const idx = rest.slice(0, tokPos).map(Number);
    const rate = Number(rest[tokPos + 1]) || 0;
    const v = getAttr(b, attr, idx);
    if (v === undefined || !token) return out('-ERR INVALID_PARAMETER');
    const s = { tag, attr, idx, token };
    if (b.type === 'meter' || attr === 'allGainReduction' || attr === 'peaks') {
      s.timer = setInterval(() => c.sock.write(`! "publishToken":"${token}" "value":${fv(getAttr(b, attr, idx))}\r\n`), Math.max(rate, 100));
    }
    c.subs.push(s);
    out(`! "publishToken":"${token}" "value":${fv(v)}`);
    out('+OK');
    void nums;
    return;
  }
  out('-ERR unknown command');
}

// Start the fake Tesira. Port 0 picks a free port. Resolves with the port used.
function start(port = PORT) {
  return new Promise((resolve, reject) => {
  const srv = net.createServer((sock) => {
  const c = { sock, subs: [], buf: '' };
  clients.add(c);
  sock.write(Buffer.from([255, 253, 24, 255, 253, 32, 255, 253, 35, 255, 253, 39]));
  setTimeout(() => sock.write('Welcome to the Tesira Text Protocol Server...\r\n'), 150);
  sock.on('data', (d) => {
    const bytes = [...d].filter((x, i, a) => !(x === 255 || (i > 0 && a[i - 1] === 255) || (i > 1 && a[i - 2] === 255)));
    c.buf += Buffer.from(bytes).toString();
    let i;
    while ((i = c.buf.indexOf('\n')) >= 0) {
      const line = c.buf.slice(0, i).trim();
      c.buf = c.buf.slice(i + 1);
      if (line) handle(c, line);
    }
  });
  const end = () => { for (const s of c.subs) clearInterval(s.timer); clients.delete(c); };
  sock.on('close', end);
  sock.on('error', end);
});
  srv.on('error', reject);
  srv.listen(port, '127.0.0.1', () => resolve(srv.address().port));
  });
}

module.exports = { start };
if (require.main === module) start().then((p) => console.log(`Mock Tesira listening on 127.0.0.1:${p}`));
