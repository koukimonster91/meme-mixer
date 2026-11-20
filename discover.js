// Finds Tesira devices on the local network.
// Biamp's own discovery protocol is proprietary, so this tries every address on
// each local subnet and keeps the ones whose Telnet port answers with the
// "Tesira Text Protocol Server" banner. It then asks each device for its hostname.
const net = require('net');
const os = require('os');

const IAC = 255, DO = 253, DONT = 254, WILL = 251, WONT = 252;
const VIRTUAL = /virtualbox|vmware|vethernet|hyper-v|loopback|wsl|docker/i;

const ipToInt = (ip) => ip.split('.').reduce((n, o) => n * 256 + Number(o), 0);
const intToIp = (n) => [24, 16, 8, 0].map((s) => Math.floor(n / 2 ** s) % 256).join('.');

// Hosts to probe on each real network adapter. Subnets larger than /24 are cut
// down to the /24 around this PC's address so a scan stays a few seconds long.
function localTargets() {
  const hosts = new Set(['127.0.0.1']);
  const subnets = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    if (VIRTUAL.test(name)) continue;
    for (const a of addrs || []) {
      if (a.family !== 'IPv4' || a.internal || /^(0a|08):00:27/i.test(a.mac)) continue;
      let prefix = Number((a.cidr || '').split('/')[1]) || 24;
      if (prefix < 24) prefix = 24;
      const size = 2 ** (32 - prefix);
      const base = Math.floor(ipToInt(a.address) / size) * size;
      subnets.push(`${intToIp(base)}/${prefix}`);
      for (let i = 1; i < size - 1; i++) hosts.add(intToIp(base + i));
    }
  }
  return { hosts: [...hosts], subnets };
}

function probe(host, port, timeoutMs) {
  return new Promise((resolve) => {
    let text = '', found = false, done = false;
    const s = net.createConnection({ host, port });
    const finish = (result) => { if (done) return; done = true; clearTimeout(t); s.destroy(); resolve(result); };
    let t = setTimeout(() => finish(null), timeoutMs);
    s.on('connect', () => { clearTimeout(t); t = setTimeout(() => finish(found ? { host, port } : null), 2500); });
    s.on('error', () => finish(null));
    s.on('data', (buf) => {
      const reply = [];
      for (let i = 0; i < buf.length; i++) {
        if (buf[i] === IAC && i + 2 < buf.length &&[DO, DONT, WILL, WONT].includes(buf[i + 1])) {
          if (buf[i + 1] === DO) reply.push(IAC, WONT, buf[i + 2]);
          if (buf[i + 1] === WILL) reply.push(IAC, DONT, buf[i + 2]);
          i += 2;
        } else text += String.fromCharCode(buf[i]);
      }
      if (reply.length) s.write(Buffer.from(reply));
      if (!found && /Tesira Text Protocol/i.test(text)) {
        found = true;
        text = '';
        s.write('DEVICE get hostname\r\n');
      }
      if (found) {
        const m = text.match(/\+OK\s+"value":"([^"]*)"/);
        if (m) finish({ host, port, name: m[1] });
        else if (/-ERR/.test(text)) finish({ host, port });
      }
    });
  });
}

let running = null;
// Returns { devices: [{host, port, name?}], subnets, ms }. Concurrent calls share one scan.
function scan(port = 23, { timeoutMs = 900, concurrency = 96 } = {}) {
  if (running) return running;
  running = (async () => {
    const t0 = Date.now();
    const { hosts, subnets } = localTargets();
    const devices = [];
    let next = 0;
    const worker = async () => {
      while (next < hosts.length) {
        const r = await probe(hosts[next++], port, timeoutMs);
        if (r) devices.push(r);
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, hosts.length) }, worker));
    devices.sort((a, b) => ipToInt(a.host) - ipToInt(b.host));
    return { devices, subnets, ms: Date.now() - t0 };
  })().finally(() => { running = null; });
  return running;
}

module.exports = { scan, isScanning: () => !!running };
