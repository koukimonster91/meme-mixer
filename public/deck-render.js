// Draws Stream Deck key images (144x144 SVG) from the key views made by deck.js.
// Shared by the web UI preview and the Stream Deck plugin, so both look identical.
(function (root) {
  const W = 144;
  const C = {
    bg: '#0d1017', text: '#f2f4f8', sub: '#8b93a7', accent: '#5b8cff', teal: '#42d6c4',
    red: '#ff4d5e', amber: '#ffb547', dim: '#262b37', green: '#3ddc84', yellow: '#ffd23f',
  };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fit = (s, n) => { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
  const FONT = 'Segoe UI, Arial, Helvetica, sans-serif';
  const text = (x, y, s, size, color, weight, anchor) =>
    `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="${weight || 600}" fill="${color}" text-anchor="${anchor || 'middle'}">${esc(s)}</text>`;
  const svg = (body, bg) => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${W}" viewBox="0 0 ${W} ${W}"><rect width="${W}" height="${W}" fill="${bg || C.bg}"/>${body}</svg>`;
  const nameSize = (s) => { const n = String(s || '').length; return n <= 8 ? 24 : n <= 10 ? 21 : 18; };
  const head = (v, color) => text(72, 30, fit(v.name, 13), nameSize(v.name), color || C.text, 700) + (v.sub ? text(72, 52, fit(v.sub, 14), 16, C.sub, 500) : '');
  const fmtDb = (v, min) => (v == null ? '—' : v <= min + 0.05 ? '-inf' : (v > 0 ? '+' : '') + v.toFixed(1));

  function mute(v) {
    const m = v.muted;
    const fill = m === true ? C.red : m === false ? C.dim : '#1a1e27';
    const label = m === true ? 'MUTED' : m === false ? 'LIVE' : '—';
    return svg(head(v) +
      `<rect x="16" y="72" width="112" height="52" rx="12" fill="${fill}"${m === false ? ` stroke="${C.teal}" stroke-opacity="0.5" stroke-width="2"` : ''}/>` +
      text(72, 107, label, 26, m === true ? '#fff' : m === false ? C.teal : C.sub, 800));
  }

  function volume(v) {
    const up = v.dir !== 'down';
    const arrow = up ? 'M72 62 L100 92 L44 92 Z' : 'M72 92 L100 62 L44 62 Z';
    const lv = v.muted === true ? 'MUTED' : `${fmtDb(v.level, v.min)} ${v.level == null || v.level <= v.min + 0.05 ? '' : v.unit || 'dB'}`.trim();
    return svg(head(v) +
      `<path d="${arrow}" fill="${up ? C.teal : C.accent}"/>` +
      text(72, 126, lv, 20, v.muted === true ? C.red : C.text, 700));
  }

  function meter(v) {
    const r = v.range || { min: -60, max: 24, yellow: 0, red: 18 };
    const vals = v.meter || [];
    const n = Math.max(1, vals.length);
    const top = 62, bottom = 132, h = bottom - top;
    const gap = 6, width = Math.min(34, (112 - gap * (n - 1)) / n);
    const x0 = 72 - (n * width + (n - 1) * gap) / 2;
    const pos = (db) => Math.max(0, Math.min(1, (db - r.min) / (r.max - r.min)));
    let bars = '';
    vals.forEach((db, i) => {
      const x = x0 + i * (width + gap);
      bars += `<rect x="${x}" y="${top}" width="${width}" height="${h}" rx="4" fill="#161a23"/>`;
      if (db == null) return;
      if (v.gr) { // gain reduction grows down from the top
        const gh = Math.max(0, Math.min(1, -db / 40)) * h;
        if (gh > 0.5) bars += `<rect x="${x}" y="${top}" width="${width}" height="${gh}" rx="4" fill="${C.amber}"/>`;
        return;
      }
      const p = pos(db);
      const yY = bottom - pos(r.yellow) * h, yR = bottom - pos(r.red) * h, y = bottom - p * h;
      const seg = (from, to, color) => { const a = Math.max(from, y), b = to; if (b > a) bars += `<rect x="${x}" y="${a}" width="${width}" height="${b - a}" fill="${color}"/>`; };
      seg(yY, bottom, C.green); seg(yR, yY, C.yellow); seg(top, yR, C.red);
    });
    const peak = vals.filter((x) => x != null);
    const readout = peak.length ? (v.gr ? `${Math.min(...peak)}` : `${Math.max(...peak)}`) : '';
    return svg(text(72, 26, fit(v.name, 11), 20, v.muted === true ? C.red : C.text, 700) +
      text(72, 48, v.muted === true ? 'MUTED' : `${fit(v.sub, 9)}${readout !== '' ? '  ' + readout : ''}`, 15, v.muted === true ? C.red : C.sub, 600) + bars);
  }

  function scene(v) {
    return svg(
      `<rect x="44" y="20" width="56" height="42" rx="8" fill="none" stroke="${C.teal}" stroke-width="4"/>` +
      `<path d="M66 31 L80 41 L66 51 Z" fill="${C.teal}"/>` +
      text(72, 96, fit(v.name, 11), 22, C.text, 700) + text(72, 120, 'Scene', 16, C.sub, 500));
  }

  function page(v) {
    const chev = v.dir === 'prev' ? 'M84 30 L58 54 L84 78' : 'M60 30 L86 54 L60 78';
    return svg(
      (v.dir === 'go' ? `<rect x="46" y="28" width="52" height="52" rx="10" fill="none" stroke="${C.accent}" stroke-width="5"/>` : `<path d="${chev}" fill="none" stroke="${C.accent}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>`) +
      text(72, 112, fit(v.name, 11), 20, C.text, 700) + text(72, 133, v.dir === 'prev' ? 'Back' : v.dir === 'next' ? 'Next' : 'Go to', 15, C.sub, 500));
  }

  function invalid(v) { return svg(text(72, 70, '?', 44, C.sub, 700) + text(72, 110, fit(v.name, 11), 18, C.sub, 600) + text(72, 130, v.sub || '', 14, C.red, 600)); }

  function renderKey(v) {
    if (!v) return svg('');
    switch (v.type) {
      case 'mute': return mute(v);
      case 'volume': return volume(v);
      case 'meter': return meter(v);
      case 'scene': return scene(v);
      case 'page': return page(v);
      default: return invalid(v);
    }
  }

  // Shown on every key while the plugin can't reach MemeMixer.
  function renderOffline(line) {
    return svg(text(72, 58, 'MemeMixer', 21, C.text, 700) + text(72, 84, line || 'not running', 17, C.amber, 600), '#14100a');
  }

  // Small corner badge when MemeMixer runs but the Tesira isn't connected.
  function withTesiraOffline(s) {
    return s.replace('</svg>', `<circle cx="130" cy="14" r="7" fill="${C.amber}"/></svg>`);
  }

  const api = { renderKey, renderOffline, withTesiraOffline, SIZE: W };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DeckRender = api;
})(typeof window !== 'undefined' ? window : this);
