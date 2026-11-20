'use strict';
// MemeMixer — browser UI. Talks to server.js: GET /api/state, SSE /events, POST /api/*.

// ------------------------------------------------------------------ helpers
const $ = (s, el = document) => el.querySelector(s);
function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k === 'class') e.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'value') e.value = v;
    else if (k === 'checked') e.checked = !!v;
    else if (k === 'html') e.innerHTML = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) e.append(kid.nodeType ? kid : document.createTextNode(kid));
  return e;
}
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// Vertical touch drag that coexists with sideways scrolling. Uses touch events
// (not pointer events) so a vertical drag can claim the gesture with
// preventDefault on its first move. That blocks page scroll and pull-to-refresh
// for the whole drag, and the browser can never take it over halfway through.
// A mostly-sideways swipe is left alone so the page scrolls. A tap does nothing.
function touchDragY(el, { start, move, end }) {
  let id = null, x0 = 0, y0 = 0, mode = null;
  el.addEventListener('touchstart', (e) => {
    if (id !== null || e.touches.length !== 1) return;
    const t = e.changedTouches[0];
    id = t.identifier; x0 = t.clientX; y0 = t.clientY; mode = null;
  }, { passive: true });
  el.addEventListener('touchmove', (e) => {
    const t = [...e.changedTouches].find((c) => c.identifier === id);
    if (!t) return;
    const dx = t.clientX - x0, dy = t.clientY - y0;
    if (mode === null) {
      if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
      // Not cancelable = the browser is already scrolling; leave it be.
      mode = e.cancelable && Math.abs(dy) > Math.abs(dx) * 0.8 ? 'drag' : 'scroll';
      if (mode === 'drag') start();
    }
    if (mode !== 'drag') return;
    if (e.cancelable) e.preventDefault();
    move(dy, t);
  }, { passive: false });
  const finish = (e) => {
    if (![...e.changedTouches].some((c) => c.identifier === id)) return;
    if (mode === 'drag') end(e.type === 'touchcancel');
    id = null; mode = null;
  };
  el.addEventListener('touchend', finish);
  el.addEventListener('touchcancel', finish);
}
const key = (tag, attr, idx) => `${tag}|${attr}|${[].concat(idx ?? []).join(',')}`;
const fmtDb = (v, min) => (v == null ? '—' : v <= min + 0.05 ? '-inf' : (v > 0 ? '+' : '') + v.toFixed(1));

async function post(url, data) {
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data || {}) });
    return await r.json();
  } catch { toast('Server not reachable'); return { ok: false }; }
}
function send(ops) {
  for (const op of ops) S.state[key(op.tag, op.attr, op.idx)] = op.value;
  scheduleUpdate();
  return post('/api/set', { ops });
}
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

const ICONS = {
  head: '<path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="3" y="14" width="5" height="7" rx="2"/><rect x="16" y="14" width="5" height="7" rx="2"/>',
  usb: '<path d="M12 3v14"/><path d="M9 6l3-3 3 3"/><path d="M12 13l-5-3V7"/><path d="M12 11l5-3V5"/><circle cx="12" cy="19" r="2"/>',
  input: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3"/><path d="M1 14h6M9 8h6M17 16h6"/>',
  gate: '<path d="M3 12h3l2-6 4 12 2-6h7"/>',
  extras: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-2.7-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3.6 15H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.1-2.7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 9.7 4.4V4a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/>',
  matrix: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="18" cy="6" r="1.2" fill="currentColor"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
};
const icon = (name, cls = 'nav-icon') => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '1.8'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
  s.setAttribute('class', cls); s.innerHTML = ICONS[name] || '';
  return s;
};

// ------------------------------------------------------------------ state
const S = { config: null, state: {}, status: {}, aliases: [], snapshots: [], log: [], networkUrls: [], scan: { devices: [], scanning: false, at: null } };
const lastMeters = {};    // most recent meter frame, so new pages start where the meters already are
let comps = [];           // live components on the current page: { update(), meters?(m) }
let navComps = [];
let updateQueued = false;
function scheduleUpdate() {
  if (updateQueued) return;
  updateQueued = true;
  requestAnimationFrame(() => {
    updateQueued = false;
    for (const c of comps) c.update && c.update();
    for (const c of navComps) c.update();
  });
}
const T = () => S.config.tags;
const st = (tag, attr, idx) => S.state[key(tag, attr, idx)];

function pairs(src, out) {
  const [l, r] = out.mixerOutputs;
  return src.inputs.length === 1 ? [[src.inputs[0], l], [src.inputs[0], r]] : [[src.inputs[0], l], [src.inputs[1], r]];
}
const masterChannels = (out) => out.masterChannels || [1, 2];

// ------------------------------------------------------------------ fader taper
const SEG = [[-100, -60, 1], [-60, -40, 1.3], [-40, -20, 2.2], [-20, -10, 1.8], [-10, 0, 2], [0, 12, 1.7], [12, 24, 1]];
function makeTaper(min, max, linear) {
  if (linear) return { toPos: (v) => clamp((v - min) / (max - min), 0, 1), toDb: (p) => min + clamp(p, 0, 1) * (max - min) };
  const segs = SEG.map(([a, b, w]) => [Math.max(a, min), Math.min(b, max), (w * (Math.min(b, max) - Math.max(a, min))) / (b - a)]).filter(([a, b]) => b > a);
  const total = segs.reduce((s, x) => s + x[2], 0);
  return {
    toPos(v) {
      v = clamp(v, min, max);
      let acc = 0;
      for (const [a, b, w] of segs) {
        if (v <= b) return (acc + ((v - a) / (b - a)) * w) / total;
        acc += w;
      }
      return 1;
    },
    toDb(p) {
      let t = clamp(p, 0, 1) * total;
      for (const [a, b, w] of segs) {
        if (t <= w) return a + (t / w) * (b - a);
        t -= w;
      }
      return max;
    },
  };
}

// ------------------------------------------------------------------ meters
function meterGradient() {
  const m = S.config.meter;
  const pct = (v) => (((v - m.min) / (m.max - m.min)) * 100).toFixed(1) + '%';
  return `linear-gradient(to top, #1fd18a 0%, #42d6c4 ${pct(m.yellow - 6)}, #ffd257 ${pct(m.yellow)}, #ffb547 ${pct(m.red - 1)}, #ff4d61 ${pct(m.red)}, #ff4d61 100%)`;
}
function Meter(cls = 'meter') {
  const cover = h('div', { class: 'cover' });
  const peak = h('div', { class: 'peak' });
  const el = h('div', { class: cls }, cover, peak);
  let hold = -200, holdT = 0;
  return {
    el,
    set(db) {
      const m = S.config.meter;
      if (typeof db !== 'number') db = m.min;
      const p = clamp((db - m.min) / (m.max - m.min), 0, 1);
      cover.style.height = ((1 - p) * 100).toFixed(1) + '%';
      const now = performance.now();
      if (db >= hold || now - holdT > 1500) { hold = db; holdT = now; }
      const hp = clamp((hold - m.min) / (m.max - m.min), 0, 1);
      peak.style.bottom = `calc(${(hp * 100).toFixed(1)}% - 1px)`;
      peak.style.opacity = hp > 0.01 ? (hold >= m.red ? 1 : 0.6) : 0;
      peak.style.background = hold >= m.red ? '#ff4d61' : '#fff';
    },
  };
}

// ------------------------------------------------------------------ fader strip
// o: { name, sub, min, max, linear, unit, def, get(), set(v), mute?:{get(),set(m)}, meter?:{tag, channels}, className, headExtra }
function Strip(o) {
  const readout = h('input', { class: 'readout', spellcheck: 'false', 'aria-label': `${o.name} value` });
  const thumb = h('div', { class: 'thumb' }, h('span'));
  const track = h('div', { class: 'track' }, h('div', { class: 'fill' }));
  const fader = h('div', { class: 'fader', tabindex: '0', role: 'slider', 'aria-label': o.name }, track, thumb);
  const scale = h('div', { class: 'scale' });
  const area = h('div', { class: 'fader-area' }, scale, fader);
  const meters = (o.meter?.channels || []).map(() => Meter());
  if (meters.length) {
    const wrap = h('div', { class: 'meters' }, meters.map((m) => m.el));
    wrap.style.setProperty('--meter-grad', meterGradient());
    area.append(wrap);
  }
  const muteBtn = o.mute ? h('button', { class: 'mute', onclick: () => { const m = o.mute.get(); if (m != null) o.mute.set(!m); } }, 'MUTE') : null;
  const el = h('div', { class: `strip ${o.className || ''}` },
    h('div', { class: 'strip-head' }, h('div', { class: 'strip-name' }, o.name), h('div', { class: 'strip-sub' }, o.sub || '', o.headExtra || null)),
    h('div', { class: 'readout-wrap' }, readout, h('span', { class: 'unit' }, o.unit || 'dB')),
    area,
    muteBtn);

  let value = null, dragging = false, holdUntil = 0, taper, rmin, rmax, lastSend = 0, sendTimer;
  const resolve = (x, d) => { const v = typeof x === 'function' ? x() : x; return typeof v === 'number' ? v : d; };

  function range() {
    const mn = resolve(o.min, -100), mx = resolve(o.max, 0);
    if (mn === rmin && mx === rmax) return;
    rmin = mn; rmax = mx;
    taper = makeTaper(rmin, rmax, o.linear);
    scale.replaceChildren();
    const marks = o.linear
      ? Array.from({ length: 7 }, (_, i) => Math.round(rmin + (i * (rmax - rmin)) / 6))
      : [12, 6, 0, -10, -20, -40, -60, -100].filter((d) => d >= rmin && d <= rmax);
    for (const d of marks) scale.append(h('span', { style: { bottom: (taper.toPos(d) * 100).toFixed(2) + '%' } }, d === -100 ? '∞' : d > 0 ? `+${d}` : `${d}`));
  }
  function render() {
    el.style.setProperty('--pos', value == null ? 0 : taper.toPos(value));
    el.classList.toggle('unknown', value == null);
    if (document.activeElement !== readout) readout.value = o.linear ? (value == null ? '—' : value.toFixed(1)) : fmtDb(value, rmin);
    fader.setAttribute('aria-valuenow', value ?? '');
  }
  function update() {
    range();
    if (!dragging && performance.now() > holdUntil) { const v = o.get(); value = typeof v === 'number' ? v : null; }
    render();
    if (muteBtn) {
      const m = o.mute.get();
      muteBtn.classList.toggle('on', m === true);
      muteBtn.disabled = m == null;
      el.classList.toggle('muted', m === true);
    }
  }
  // Bottom of the fader = muted. Leaving the bottom unmutes.
  function autoMute(v, wasMin) {
    if (!o.mute) return;
    const m = o.mute.get();
    if (v <= rmin && m === false) o.mute.set(true);
    else if (v > rmin && wasMin && m === true) o.mute.set(false);
  }
  function commit(v, final) {
    v = Math.round(clamp(v, rmin, rmax) * 10) / 10;
    const wasMin = value != null && value <= rmin;
    autoMute(v, wasMin);
    value = v;
    holdUntil = performance.now() + 900;
    render();
    clearTimeout(sendTimer);
    const now = performance.now();
    if (final || now - lastSend > 60) { lastSend = now; o.set(v); }
    else sendTimer = setTimeout(() => { lastSend = performance.now(); o.set(value); }, 60);
  }
  const base = () => value ?? resolve(o.def, rmin);

  fader.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch') return; // handled by touchDragY below
    e.preventDefault();
    fader.focus();
    fader.setPointerCapture(e.pointerId);
    const rect = track.getBoundingClientRect();
    let startPos, startY = e.clientY;
    if (e.target.closest('.thumb')) startPos = taper.toPos(base());
    else { startPos = 1 - (e.clientY - rect.top) / rect.height; commit(taper.toDb(startPos)); }
    dragging = true;
    el.classList.add('active');
    const move = (ev) => {
      const fine = ev.shiftKey ? 0.2 : 1;
      commit(taper.toDb(startPos - ((ev.clientY - startY) / rect.height) * fine));
      if (ev.shiftKey) { startPos = taper.toPos(value); startY = ev.clientY; }
    };
    const up = () => {
      dragging = false;
      el.classList.remove('active');
      commit(value ?? base(), true);
      fader.removeEventListener('pointermove', move);
      fader.removeEventListener('pointerup', up);
      fader.removeEventListener('pointercancel', up);
    };
    fader.addEventListener('pointermove', move);
    fader.addEventListener('pointerup', up);
    fader.addEventListener('pointercancel', up);
  });
  // Touch: only a mostly-vertical drag moves the fader, relative to where it was.
  // A tap or a sideways swipe never changes the level.
  {
    let startPos = 0, h0 = 1;
    touchDragY(fader, {
      start: () => { startPos = taper.toPos(base()); h0 = track.getBoundingClientRect().height || 1; dragging = true; el.classList.add('active'); },
      move: (dy) => commit(taper.toDb(startPos - dy / h0)),
      end: () => { dragging = false; el.classList.remove('active'); commit(value ?? base(), true); },
    });
  }
  fader.addEventListener('wheel', (e) => { e.preventDefault(); commit(base() + (e.deltaY < 0 ? 1 : -1) * (e.shiftKey ? 0.1 : 0.5)); }, { passive: false });
  fader.addEventListener('dblclick', () => commit(clamp(resolve(o.def, 0), rmin, rmax), true));
  fader.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 0.1 : 0.5;
    const map = { ArrowUp: step, ArrowRight: step, ArrowDown: -step, ArrowLeft: -step, PageUp: 5, PageDown: -5 };
    if (e.key in map) { e.preventDefault(); commit(base() + map[e.key], true); }
    else if (e.key === 'Home') { e.preventDefault(); commit(rmax, true); }
    else if (e.key === 'End') { e.preventDefault(); commit(rmin, true); }
  });

  // Manual entry
  readout.addEventListener('focus', () => setTimeout(() => readout.select(), 0));
  const apply = () => {
    const t = readout.value.trim().toLowerCase().replace(/db.*$/, '');
    if (['-inf', 'inf', 'off', 'min', '-∞'].includes(t)) return commit(rmin, true);
    const n = parseFloat(t);
    if (Number.isFinite(n)) commit(n, true); else render();
  };
  readout.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { apply(); readout.blur(); }
    if (e.key === 'Escape') { readout.value = ''; readout.blur(); }
  });
  readout.addEventListener('blur', () => { if (readout.value.trim() && readout.value !== fmtDb(value, rmin)) apply(); render(); });

  const meterFrame = (m) => {
    if (!o.meter) return;
    const arr = m[o.meter.tag];
    if (!arr) return;
    o.meter.channels.forEach((c, i) => meters[i].set(arr[c - 1]));
  };
  range();
  update();
  meterFrame(lastMeters); // set before first paint, so the bars don't grow up from zero
  return { el, update, meters: meterFrame };
}

// ------------------------------------------------------------------ pages
function pages() {
  const outs = S.config.outputs.map((o, i) => ({ id: `out${i}`, group: 'Outputs', title: o.name, icon: /usb/i.test(o.name) ? 'usb' : 'head', out: o, render: () => renderOutput(o) }));
  return [
    ...outs,
    { id: 'matrix', group: 'Outputs', title: 'Matrix', icon: 'matrix', render: renderMatrix },
    { id: 'input', group: 'Inputs', title: 'Input Master', icon: 'input', render: renderInput },
    { id: 'gate', group: 'Inputs', title: 'Noise Gate', icon: 'gate', render: renderGate },
    { id: 'extras', group: 'Tools', title: 'Extras', icon: 'extras', render: renderExtras },
    { id: 'settings', group: 'Tools', title: 'Settings', icon: 'settings', render: renderSettings },
  ];
}

function renderNav() {
  const nav = $('#nav');
  nav.replaceChildren();
  navComps = [];
  const current = location.hash.slice(1) || 'out0';
  const groups = {};
  for (const p of pages()) (groups[p.group] ||= []).push(p);
  for (const [g, list] of Object.entries(groups)) {
    const grp = h('div', { class: 'nav-group' }, h('div', { class: 'nav-label' }, g));
    for (const p of list) {
      const meta = h('span', { class: 'nav-meta' });
      grp.append(h('button', { class: `nav-item ${p.id === current ? 'active' : ''}`, onclick: () => { location.hash = p.id; } },
        icon(p.icon), h('span', { class: 'nav-title' }, p.title), meta));
      if (p.out) {
        const tag = T().masters[p.out.master];
        navComps.push({
          update() {
            const lv = st(tag, 'level', masterChannels(p.out)[0]);
            const mu = st(tag, 'mute', masterChannels(p.out)[0]);
            meta.replaceChildren(...(mu ? [h('span', { class: 'mdot', title: 'Master muted' })] : []), typeof lv === 'number' ? fmtDb(lv, -100) : '');
          },
        });
      }
    }
    nav.append(grp);
  }
  for (const c of navComps) c.update();
}

function renderPage() {
  const list = pages();
  const id = location.hash.slice(1) || 'out0';
  const p = list.find((x) => x.id === id) || list[0];
  comps = [];
  $('#headActions').replaceChildren();
  $('#pageTitle').textContent = p.title;
  $('#pageSub').textContent = '';
  const page = $('#page');
  page.replaceChildren();
  page.scrollTop = 0;
  p.render(page);
  for (const c of comps) c.update && c.update();
  renderNav();
  updateBanner();
}

// --- output mix page
function renderOutput(out) {
  const tag = T().masters[out.master];
  const mix = T().mixer;
  $('#pageSub').textContent = `Mixer outputs ${out.mixerOutputs.join(' / ')}  ·  Master ${tag}`;
  const strips = out.sources.map((name) => {
    const src = S.config.sources.find((s) => s.name === name);
    if (!src) return null;
    const prs = pairs(src, out);
    return Strip({
      name: src.name,
      sub: src.inputs.length > 1 ? 'Stereo' : 'Mono',
      min: -100, max: 0, def: 0,
      get: () => st(mix, 'crosspointLevel', prs[0]),
      set: (v) => send(prs.map((p) => ({ tag: mix, attr: 'crosspointLevel', idx: p, value: v }))),
      mute: {
        get: () => { const s = st(mix, 'crosspointLevelState', prs[0]); return s == null ? null : !s; },
        set: (m) => send(prs.map((p) => ({ tag: mix, attr: 'crosspointLevelState', idx: p, value: !m }))),
      },
      meter: { tag: T().inputMeter, channels: src.meter || src.inputs },
    });
  }).filter(Boolean);
  const chs = masterChannels(out);
  const meterTag = (T().masterMeters || [])[out.master];
  const master = Strip({
    meter: meterTag ? { tag: meterTag, channels: out.masterMeterChannels || [1, 2] } : null,
    name: 'Master', sub: tag, className: 'master',
    min: () => st(tag, 'minLevel', 1) ?? -100, max: () => st(tag, 'maxLevel', 1) ?? 12, def: 0,
    get: () => st(tag, 'level', chs[0]),
    set: (v) => send(chs.map((c) => ({ tag, attr: 'level', idx: [c], value: v }))),
    mute: {
      get: () => st(tag, 'mute', chs[0]) ?? null,
      set: (m) => send(chs.map((c) => ({ tag, attr: 'mute', idx: [c], value: m }))),
    },
  });
  comps.push(...strips, master);

  const sourcesMuted = () => strips.length && out.sources.every((name) => {
    const src = S.config.sources.find((s) => s.name === name);
    return src && st(mix, 'crosspointLevelState', pairs(src, out)[0]) === false;
  });
  const muteAllBtn = h('button', { class: 'btn danger', onclick: () => {
    const target = !sourcesMuted();
    const ops = [];
    for (const name of out.sources) {
      const src = S.config.sources.find((s) => s.name === name);
      if (src) for (const p of pairs(src, out)) ops.push({ tag: mix, attr: 'crosspointLevelState', idx: p, value: !target });
    }
    send(ops);
  } }, 'Mute all sources');
  comps.push({ update() { const m = sourcesMuted(); muteAllBtn.classList.toggle('on', !!m); muteAllBtn.textContent = m ? 'Unmute all sources' : 'Mute all sources'; } });
  $('#headActions').append(muteAllBtn);

  $('#page').append(h('div', { class: 'mixer' },
    h('div', { class: 'mix-col' }, h('div', { class: 'group-label' }, 'Sources'), h('div', { class: 'strips' }, strips.map((s) => s.el))),
    h('div', { class: 'mix-col' }, h('div', { class: 'group-label' }, 'Output'), h('div', { class: 'master-panel' }, master.el))));
}

// --- matrix page: every crosspoint of the matrix mixer
function renderMatrix() {
  const mix = T().mixer;
  const cfg = S.config;
  const nIn = st(mix, 'numInputs') || Math.max(...cfg.sources.flatMap((s) => s.inputs));
  const nOut = st(mix, 'numOutputs') || Math.max(...cfg.outputs.flatMap((o) => o.mixerOutputs));
  $('#pageSub').textContent = `${mix}  ·  ${nIn} inputs × ${nOut} outputs`;

  const inLabel = {};
  for (const s of cfg.sources) s.inputs.forEach((n, i) => { inLabel[n] = s.inputs.length > 1 ? `${s.name} ${i ? 'R' : 'L'}` : s.name; });
  const outGroups = [];
  const covered = new Set();
  for (const o of cfg.outputs) { outGroups.push({ name: o.name, cols: o.mixerOutputs }); o.mixerOutputs.forEach((n) => covered.add(n)); }
  for (let n = 1; n <= nOut; n++) if (!covered.has(n)) outGroups.push({ name: `Out ${n}`, cols: [n] });
  const cols = outGroups.flatMap((g) => g.cols.map((n, i) => ({ n, sub: g.cols.length > 1 ? (i ? 'R' : 'L') : '', group: g.name })));
  const MIN = -100, MAX = 0;
  const heatTaper = makeTaper(MIN, MAX);

  const level = (i, o) => st(mix, 'crosspointLevel', [i, o]);
  const on = (i, o) => st(mix, 'crosspointLevelState', [i, o]);
  // Level change with the same bottom = off rule as the faders.
  const setLevel = (i, o, v) => {
    v = Math.round(clamp(v, MIN, MAX) * 10) / 10;
    const prev = level(i, o);
    const ops = [{ tag: mix, attr: 'crosspointLevel', idx: [i, o], value: v }];
    if (v <= MIN && on(i, o) === true) ops.push({ tag: mix, attr: 'crosspointLevelState', idx: [i, o], value: false });
    else if (v > MIN && prev <= MIN && on(i, o) === false) ops.push({ tag: mix, attr: 'crosspointLevelState', idx: [i, o], value: true });
    send(ops);
  };
  const toggle = (i, o) => { const s = on(i, o); if (s != null) send([{ tag: mix, attr: 'crosspointLevelState', idx: [i, o], value: !s }]); };

  // Inspector for the selected crosspoint
  let sel = null;
  const selName = h('div', { class: 'insp-name' }, 'Click a crosspoint to select it');
  const selInput = h('input', { class: 'readout', spellcheck: 'false', disabled: true });
  const selBtn = h('button', { class: 'btn', disabled: true, onclick: () => sel && toggle(...sel) }, 'On');
  selInput.addEventListener('focus', () => setTimeout(() => selInput.select(), 0));
  selInput.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !sel) return;
    const t = selInput.value.trim().toLowerCase();
    const v = ['-inf', 'inf', 'off', 'min'].includes(t) ? MIN : parseFloat(t);
    if (Number.isFinite(v)) setLevel(...sel, v);
    selInput.blur();
  });
  const inspector = h('div', { class: 'inspector card' },
    h('div', { class: 'grow' }, h('div', { class: 'insp-label' }, 'Selected crosspoint'), selName),
    h('div', { class: 'readout-wrap', style: { width: '120px' } }, selInput, h('span', { class: 'unit' }, 'dB')),
    selBtn);

  const cells = [];
  const table = h('table', { class: 'matrix' });
  const head1 = h('tr', {}, h('th', { class: 'corner', rowspan: 2 }, h('span', {}, 'Inputs ↓  Outputs →')));
  for (const g of outGroups) head1.append(h('th', { class: 'out-group', colspan: g.cols.length }, g.name));
  const head2 = h('tr', {}, cols.map((c) => h('th', { class: 'out-sub' }, c.sub || `#${c.n}`)));
  table.append(h('thead', {}, head1, head2));
  const body = h('tbody');
  for (let i = 1; i <= nIn; i++) {
    const tr = h('tr', {}, h('th', { class: 'in-label' }, h('span', {}, inLabel[i] || `In ${i}`), h('small', {}, `#${i}`)));
    for (const c of cols) {
      const lv = h('div', { class: 'xp-level' });
      const pill = h('button', { class: 'xp-pill', title: 'On / off', onclick: () => toggle(i, c.n) });
      const cell = h('td', { class: `xp ${c.sub === 'R' || !c.sub ? 'grp-end' : ''}` }, h('div', { class: 'xp-in' }, lv, pill));
      const x = { i, o: c.n, cell, lv, pill, name: `${inLabel[i] || `In ${i}`}  →  ${c.group}${c.sub ? ' ' + c.sub : ''}` };
      cells.push(x);
      // Drag up/down (or wheel) to change level; a plain click selects.
      {
        let v0 = MIN, last = 0, lastDy = 0;
        touchDragY(lv, {
          start: () => { lastDy = 0; v0 = typeof level(i, c.n) === 'number' ? level(i, c.n) : MIN; cell.classList.add('dragging'); },
          move: (dy) => {
            lastDy = dy;
            const now = performance.now();
            if (now - last < 50) return;
            last = now;
            setLevel(i, c.n, v0 - dy * 0.4);
          },
          end: () => { cell.classList.remove('dragging'); setLevel(i, c.n, v0 - lastDy * 0.4); select(x); },
        });
        lv.addEventListener('click', (e) => { if (e.pointerType === 'touch' || e.sourceCapabilities?.firesTouchEvents) select(x); });
      }
      lv.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'touch') return; // handled by touchDragY above
        e.preventDefault();
        lv.setPointerCapture(e.pointerId);
        const y0 = e.clientY, v0 = typeof level(i, c.n) === 'number' ? level(i, c.n) : MIN;
        let moved = false, last = 0;
        const move = (ev) => {
          if (!moved && Math.abs(ev.clientY - y0) < 4) return;
          moved = true;
          cell.classList.add('dragging');
          const now = performance.now();
          if (now - last < 50) return;
          last = now;
          setLevel(i, c.n, v0 + (y0 - ev.clientY) * (ev.shiftKey ? 0.05 : 0.4));
        };
        const up = (ev) => {
          lv.removeEventListener('pointermove', move);
          lv.removeEventListener('pointerup', up);
          lv.removeEventListener('pointercancel', up);
          cell.classList.remove('dragging');
          if (ev.type === 'pointercancel') return; // the browser took the gesture to scroll
          if (moved) setLevel(i, c.n, v0 + (y0 - ev.clientY) * (ev.shiftKey ? 0.05 : 0.4));
          select(x);
        };
        lv.addEventListener('pointermove', move);
        lv.addEventListener('pointerup', up);
        lv.addEventListener('pointercancel', up);
      });
      lv.addEventListener('wheel', (e) => {
        e.preventDefault();
        const cur = typeof level(i, c.n) === 'number' ? level(i, c.n) : MIN;
        setLevel(i, c.n, cur + (e.deltaY < 0 ? 1 : -1) * (e.shiftKey ? 0.1 : 1));
        select(x);
      }, { passive: false });
      lv.addEventListener('dblclick', () => { select(x); selInput.focus(); });
      tr.append(cell);
    }
    body.append(tr);
  }
  table.append(body);

  function select(x) {
    if (sel) cells.find((c) => c.i === sel[0] && c.o === sel[1])?.cell.classList.remove('selected');
    sel = [x.i, x.o];
    x.cell.classList.add('selected');
    selName.textContent = x.name;
    selInput.disabled = false; selBtn.disabled = false;
    drawInspector();
  }
  function drawInspector() {
    if (!sel) return;
    const v = level(...sel), s = on(...sel);
    if (document.activeElement !== selInput) selInput.value = fmtDb(typeof v === 'number' ? v : null, MIN);
    selBtn.textContent = s ? 'On' : 'Off';
    selBtn.className = `btn ${s ? 'primary' : 'danger'}`;
  }
  comps.push({
    update() {
      for (const x of cells) {
        const v = level(x.i, x.o), s = on(x.i, x.o);
        const known = typeof v === 'number';
        x.lv.textContent = known ? (v <= MIN ? '-∞' : v.toFixed(1)) : '—';
        x.cell.classList.toggle('on', s === true);
        x.cell.classList.toggle('off', s === false);
        x.cell.style.setProperty('--heat', known && s ? heatTaper.toPos(v).toFixed(3) : 0);
      }
      drawInspector();
    },
  });

  $('#page').append(inspector,
    h('p', { class: 'hint', style: { margin: '0 0 12px 2px' } }, 'Drag a crosspoint up or down (or use the wheel) to change its level. Click the dot to switch it on or off. Double-click to type a level. Pulling a level to the bottom switches it off.'),
    h('div', { class: 'matrix-wrap card-live' }, table));
}

// --- input master page
function renderInput() {
  const tag = T().inputMaster;
  $('#pageSub').textContent = `Input Master gain and mutes  ·  ${tag}`;
  const linked = (ch) => store.get(`link:${ch.channel}`, true);
  const strips = S.config.inputChannels.map((ch) => {
    const targets = () => (ch.link && linked(ch) ? [ch.channel, ch.link] : [ch.channel]);
    let chip = null;
    if (ch.link) {
      chip = h('button', { class: 'link-chip', title: 'Link stereo pair', onclick: () => {
        const v = !linked(ch);
        store.set(`link:${ch.channel}`, v); store.set(`link:${ch.link}`, v);
        scheduleUpdate();
      } }, icon('link', ''));
      chip.firstChild.style.cssText = 'width:11px;height:11px';
    }
    const s = Strip({
      name: ch.name, sub: `Ch ${ch.channel}`, headExtra: chip,
      min: () => st(tag, 'minLevel', 1) ?? -100, max: () => st(tag, 'maxLevel', 1) ?? 12, def: 0,
      get: () => st(tag, 'level', ch.channel),
      set: (v) => send(targets().map((c) => ({ tag, attr: 'level', idx: [c], value: v }))),
      mute: {
        get: () => st(tag, 'mute', ch.channel) ?? null,
        set: (m) => send(targets().map((c) => ({ tag, attr: 'mute', idx: [c], value: m }))),
      },
      meter: { tag: T().inputMeter, channels: [ch.meter || ch.channel] },
    });
    const upd = s.update;
    s.update = () => { upd(); if (chip) chip.classList.toggle('on', linked(ch)); };
    s.update();
    return s;
  });
  comps.push(...strips);
  $('#page').append(h('div', { class: 'mixer' },
    h('div', { class: 'mix-col' }, h('div', { class: 'group-label' }, 'Channels'), h('div', { class: 'strips' }, strips.map((s) => s.el)))));
}

// --- param control (number + horizontal slider, optional log scale)
function Param(o) {
  const toP = (v) => (o.log ? Math.log(v / o.min) / Math.log(o.max / o.min) : (v - o.min) / (o.max - o.min));
  const fromP = (p) => (o.log ? o.min * Math.pow(o.max / o.min, p) : o.min + p * (o.max - o.min));
  const slider = h('input', { type: 'range', class: 'slider', min: 0, max: 1000, step: 1 });
  const readout = h('input', { class: 'readout', spellcheck: 'false' });
  let holdUntil = 0, timer;
  const round = (v) => (v >= 100 ? Math.round(v) : Math.round(v * 10) / 10);
  const show = (v) => {
    slider.value = Math.round(toP(v) * 1000);
    slider.style.setProperty('--p', `${(toP(v) * 100).toFixed(1)}%`);
    if (document.activeElement !== readout) readout.value = v == null ? '—' : round(v);
  };
  const commit = (v, now) => {
    v = round(clamp(v, o.min, o.max));
    holdUntil = performance.now() + 900;
    show(v);
    clearTimeout(timer);
    if (now) o.set(v); else timer = setTimeout(() => o.set(v), 80);
  };
  slider.addEventListener('input', () => commit(fromP(slider.value / 1000)));
  slider.addEventListener('change', () => commit(fromP(slider.value / 1000), true));
  readout.addEventListener('focus', () => setTimeout(() => readout.select(), 0));
  readout.addEventListener('keydown', (e) => { if (e.key === 'Enter') readout.blur(); if (e.key === 'Escape') { readout.value = ''; readout.blur(); } });
  readout.addEventListener('blur', () => { const n = parseFloat(readout.value); if (Number.isFinite(n)) commit(n, true); else show(o.get()); });
  const el = h('div', { class: 'param' },
    h('div', { class: 'param-top' }, h('span', { class: 'param-name' }, o.name),
      h('div', { class: 'readout-wrap' }, readout, h('span', { class: 'unit' }, o.unit))),
    slider);
  const update = () => { if (performance.now() > holdUntil) { const v = o.get(); if (typeof v === 'number') show(v); } };
  update();
  return { el, update };
}

function Toggle(label, get, set, cls = '') {
  const input = h('input', { type: 'checkbox', onchange: () => set(input.checked) });
  const el = h('label', { class: `switch ${cls}` }, input, h('span', { class: 'knob' }), h('span', {}, label));
  return { el, update: () => { const v = get(); input.checked = !!v; input.disabled = v == null; } };
}

// --- noise gate page
function renderGate() {
  const tag = T().noiseGate;
  $('#pageSub').textContent = `Noise Gate  ·  ${tag}`;
  const set = (attr) => (v) => send([{ tag, attr, idx: [], value: v }]);
  const thr = Strip({ name: 'Threshold', sub: 'dBu', unit: 'dBu', linear: true, min: -60, max: 24, def: -40,
    get: () => st(tag, 'threshold'), set: set('threshold') });
  const attack = Param({ name: 'Attack', unit: 'ms', min: 0.1, max: 2000, log: true, get: () => st(tag, 'attackTime'), set: set('attackTime') });
  const release = Param({ name: 'Release', unit: 'ms', min: 0.1, max: 40000, log: true, get: () => st(tag, 'releaseTime'), set: set('releaseTime') });
  const bypass = Toggle('Bypass gate', () => st(tag, 'bypass'), set('bypass'), 'warn');

  const grs = S.config.noiseGateChannels.map((name) => {
    const m = Meter('meter gr');
    const val = h('span', { class: 'val' }, '0.0');
    return { name, m, val, el: h('div', { class: 'gr-meter' }, m.el, val, h('span', {}, name)) };
  });
  // Gain reduction: 0 dB (none) → -40 dB, drawn downward.
  const grFrame = (m) => {
    const arr = m[tag];
    if (!arr) return;
    grs.forEach((g, i) => {
      const v = typeof arr[i] === 'number' ? arr[i] : 0;
      const p = clamp(-v / 40, 0, 1);
      g.m.el.firstChild.style.height = ((1 - p) * 100).toFixed(1) + '%';
      g.val.textContent = v.toFixed(1);
    });
  };
  comps.push(thr, attack, release, bypass, { meters: grFrame });
  grs.forEach((g) => { g.m.el.firstChild.style.height = '100%'; });
  grFrame(lastMeters);

  $('#page').append(h('div', { class: 'gate-layout' },
    h('div', { class: 'master-panel' }, thr.el),
    h('div', { class: 'grid' },
      h('div', { class: 'card card-live' }, h('h2', {}, 'Timing'), h('p', { class: 'hint' }, 'How fast the gate opens and closes. Drag, or type a value and press Enter.'), attack.el, release.el,
        h('div', { class: 'row', style: { marginTop: '26px', paddingTop: '18px', borderTop: '1px solid var(--line)' } }, bypass.el, h('span', { class: 'meta', style: { color: 'var(--faint)', fontSize: '12px' } }, 'passes audio straight through'))),
      h('div', { class: 'card card-live' }, h('h2', {}, 'Gain reduction'), h('p', { class: 'hint' }, 'How much the gate is turning each channel down right now.'), h('div', { class: 'gr-meters' }, grs.map((g) => g.el))))));
}

// --- extras page
function renderExtras() {
  $('#pageSub').textContent = 'Scenes, quick actions, phantom power, presets and a command console';
  const mix = T().mixer;
  const page = $('#page');

  // Quick actions
  const masterTags = S.config.outputs.map((o) => ({ tag: T().masters[o.master], chs: masterChannels(o) }));
  const allMuted = () => masterTags.every(({ tag, chs }) => st(tag, 'mute', chs[0]) === true);
  const muteAll = h('button', { class: 'btn danger', onclick: () => {
    const m = !allMuted();
    send(masterTags.flatMap(({ tag, chs }) => chs.map((c) => ({ tag, attr: 'mute', idx: [c], value: m }))));
  } });
  comps.push({ update() { const m = allMuted(); muteAll.classList.toggle('on', m); muteAll.textContent = m ? 'Unmute all outputs' : 'Mute all outputs'; } });

  const micNames = S.config.sources.filter((s) => s.inputs.length === 1).map((s) => s.name);
  const micSel = h('select', { class: 'input' }, micNames.map((n) => h('option', { value: n }, n)));
  const micAction = (on) => {
    const src = S.config.sources.find((s) => s.name === micSel.value);
    const ops = [];
    for (const o of S.config.outputs) if (o.sources.includes(src.name)) for (const p of pairs(src, o)) ops.push({ tag: mix, attr: 'crosspointLevelState', idx: p, value: on });
    send(ops);
    toast(`${src.name} ${on ? 'unmuted' : 'muted'} in every mix`);
  };

  const outOpts = () => S.config.outputs.map((o, i) => h('option', { value: i }, o.name));
  const fromSel = h('select', { class: 'input' }, outOpts());
  const toSel = h('select', { class: 'input' }, outOpts());
  toSel.value = '1';
  const copyMix = () => {
    const from = S.config.outputs[fromSel.value], to = S.config.outputs[toSel.value];
    if (from === to) return toast('Pick two different outputs');
    const ops = [];
    for (const name of to.sources) {
      if (!from.sources.includes(name)) continue;
      const src = S.config.sources.find((s) => s.name === name);
      const fp = pairs(src, from)[0];
      const lv = st(mix, 'crosspointLevel', fp), on = st(mix, 'crosspointLevelState', fp);
      for (const p of pairs(src, to)) {
        if (typeof lv === 'number') ops.push({ tag: mix, attr: 'crosspointLevel', idx: p, value: lv });
        if (typeof on === 'boolean') ops.push({ tag: mix, attr: 'crosspointLevelState', idx: p, value: on });
      }
    }
    send(ops);
    toast(`Copied ${from.name} mix to ${to.name}`);
  };

  const quick = h('div', { class: 'card' }, h('h2', {}, 'Quick actions'), h('p', { class: 'hint' }, 'Mute everything at once, mute one mic in every mix, or copy a mix to another output.'),
    h('div', { class: 'row' }, muteAll),
    h('div', { class: 'row', style: { marginTop: '18px' } }, h('div', { class: 'field' }, h('label', {}, 'Mic in every mix'), micSel)),
    h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => micAction(false) }, 'Mute everywhere'), h('button', { class: 'btn', onclick: () => micAction(true) }, 'Unmute everywhere')),
    h('div', { class: 'row', style: { marginTop: '18px' } }, h('div', { class: 'field' }, h('label', {}, 'Copy mix from'), fromSel), h('div', { class: 'field' }, h('label', {}, 'to'), toSel)),
    h('div', { class: 'row' }, h('button', { class: 'btn', onclick: copyMix }, 'Copy mix')));

  // Scenes (snapshots stored by this app)
  const snapName = h('input', { class: 'input', placeholder: 'Scene name, e.g. Show A' });
  const snapList = h('div', { class: 'list' });
  const drawSnaps = () => {
    snapList.replaceChildren(...(S.snapshots.length ? S.snapshots.map((n) => h('div', { class: 'list-item' },
      h('span', { class: 'grow' }, n),
      h('button', { class: 'btn sm primary', onclick: async () => { await post('/api/snapshot/recall', { name: n }); toast(`Recalled "${n}"`); } }, 'Recall'),
      h('button', { class: 'btn sm ghost', onclick: () => { if (confirm(`Delete scene "${n}"?`)) post('/api/snapshot/delete', { name: n }); } }, 'Delete'))) : [h('div', { class: 'empty' }, 'No scenes saved yet.')]));
  };
  drawSnaps();
  comps.push({ snaps: drawSnaps });
  const saveSnap = async () => {
    const name = snapName.value.trim();
    if (!name) return snapName.focus();
    if (S.snapshots.includes(name) && !confirm(`Overwrite scene "${name}"?`)) return;
    await post('/api/snapshot/save', { name });
    snapName.value = '';
    toast(`Saved "${name}"`);
  };
  snapName.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveSnap(); });
  const scenes = h('div', { class: 'card' }, h('h2', {}, 'Scenes'), h('p', { class: 'hint' }, 'Save every mix, master, Input Master and gate setting, then recall it in one click. Stored on this PC.'),
    h('div', { class: 'row' }, snapName, h('button', { class: 'btn primary', onclick: saveSnap }, 'Save')), h('div', { style: { marginTop: '14px' } }, snapList));

  // Tesira presets
  const presetList = h('div', { class: 'list' });
  const pName = h('input', { class: 'input', placeholder: 'Name' });
  const pId = h('input', { class: 'input mono', placeholder: '1001', style: { maxWidth: '110px' } });
  const drawPresets = () => presetList.replaceChildren(...(S.config.presets.length ? S.config.presets.map((p, i) => h('div', { class: 'list-item' },
    h('span', { class: 'grow' }, p.name), h('span', { class: 'meta' }, `#${p.id}`),
    h('button', { class: 'btn sm primary', onclick: async () => { const r = await post('/api/preset', { id: p.id }); toast(r.ok ? `Preset ${p.name} recalled` : `Preset failed: ${r.raw}`); } }, 'Recall'),
    h('button', { class: 'btn sm ghost', onclick: () => post('/api/config', { config: { presets: S.config.presets.filter((_, j) => j !== i) } }) }, 'Remove'))) : [h('div', { class: 'empty' }, 'No presets added. Add the preset number from Tesira software.')]));
  drawPresets();
  comps.push({ presets: drawPresets });
  const presets = h('div', { class: 'card' }, h('h2', {}, 'Tesira presets'), h('p', { class: 'hint' }, 'Recall presets stored in the Tesira design (Preset numbers start at 1001).'),
    presetList,
    h('div', { class: 'row', style: { marginTop: '14px' } }, pName, pId, h('button', { class: 'btn', onclick: () => {
      const id = parseInt(pId.value, 10);
      if (!pName.value.trim() || !Number.isInteger(id)) return toast('Enter a name and a preset number');
      post('/api/config', { config: { presets: [...S.config.presets, { name: pName.value.trim(), id }] } });
      pName.value = ''; pId.value = '';
    } }, 'Add')));

  // Phantom power + gain
  const aec = T().aecInput;
  const tiles = [];
  for (let c = 1; c <= S.config.aecChannels; c++) {
    const p48 = h('button', { class: 'p48', onclick: () => { const v = st(aec, 'phantomPower', c); if (v != null) send([{ tag: aec, attr: 'phantomPower', idx: [c], value: !v }]); } }, '48V');
    const gain = h('select', { class: 'input', onchange: () => send([{ tag: aec, attr: 'gain', idx: [c], value: Number(gain.value) }]) },
      Array.from({ length: 12 }, (_, i) => h('option', { value: i * 6 }, `${i * 6} dB`)));
    const led = h('span', { class: 'led', title: 'Clip' });
    tiles.push({ el: h('div', { class: 'ch-tile' }, h('div', { class: 'ch-tile-top' }, `In ${c}`, led), p48, gain), p48, gain, led, c });
  }
  comps.push({
    update() {
      for (const t of tiles) {
        const v = st(aec, 'phantomPower', t.c);
        t.p48.classList.toggle('on', v === true);
        const g = st(aec, 'gain', t.c);
        if (typeof g === 'number' && document.activeElement !== t.gain) t.gain.value = String(Math.round(g / 6) * 6);
      }
    },
    meters(m) {
      const pk = m[`${aec}:peaks`];
      if (pk) tiles.forEach((t) => t.led.classList.toggle('on', pk[t.c - 1] === true));
    },
  });
  const phantom = h('div', { class: 'card wide card-live' }, h('h2', {}, 'Phantom power & mic gain'), h('p', { class: 'hint' }, `${aec} — 48V phantom and preamp gain per input. The dot lights when an input clips.`),
    h('div', { class: 'ch-grid' }, tiles.map((t) => t.el)));

  // Console
  const out = h('div', { class: 'console' });
  const cmd = h('input', { class: 'input mono', placeholder: `${mix} get crosspointLevel 1 1` });
  const run = async () => {
    const c = cmd.value.trim();
    if (!c) return;
    out.append(h('div', { class: 'cmd' }, `> ${c}`));
    const r = await post('/api/raw', { cmd: c });
    out.append(h('div', { class: r.ok ? 'ok' : 'err' }, r.raw || ''));
    out.scrollTop = out.scrollHeight;
    cmd.value = '';
  };
  cmd.addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });
  const consoleCard = h('div', { class: 'card wide' }, h('h2', {}, 'Command console'), h('p', { class: 'hint' }, 'Send any Tesira Text Protocol command and see the reply.'),
    out, h('div', { class: 'row', style: { marginTop: '10px' } }, cmd, h('button', { class: 'btn primary', onclick: run }, 'Send')));

  page.append(h('div', { class: 'grid' }, quick, scenes, presets, phantom, consoleCard));
}

// --- settings page
function renderSettings() {
  $('#pageSub').textContent = `Connection and instance tags${S.version && S.version !== 'dev' ? ` · MemeMixer v${S.version}` : ''}`;
  const c = S.config;
  const host = h('input', { class: 'input mono', value: c.tesira.host });
  const port = h('input', { class: 'input mono', value: c.tesira.port, style: { maxWidth: '110px' } });
  const dl = h('datalist', { id: 'aliases' }, S.aliases.map((a) => h('option', { value: a })));
  const tagInput = (v) => {
    const i = h('input', { class: 'input mono', value: v, list: 'aliases' });
    const check = () => i.classList.toggle('bad', S.aliases.length > 0 && !S.aliases.includes(i.value.trim()));
    i.addEventListener('input', check); check();
    return i;
  };
  const tags = {
    mixer: ['Matrix mixer', tagInput(c.tags.mixer)],
    inputMaster: ['Input Master (Level)', tagInput(c.tags.inputMaster)],
    inputMeter: ['Input meter (Peak Meter after Input Master)', tagInput(c.tags.inputMeter)],
    noiseGate: ['Noise gate', tagInput(c.tags.noiseGate)],
    aecInput: ['AEC input', tagInput(c.tags.aecInput)],
  };
  const masters = c.outputs.map((o) => [`${o.name} master (Level)`, tagInput(c.tags.masters[o.master] || '')]);
  const masterMeters = c.outputs.map((o) => [`${o.name} master meter`, tagInput((c.tags.masterMeters || [])[o.master] || '')]);
  const save = async () => {
    const t = Object.fromEntries(Object.entries(tags).map(([k, [, i]]) => [k, i.value.trim()]));
    const m = [...c.tags.masters];
    const mm = [...(c.tags.masterMeters || [])];
    c.outputs.forEach((o, i) => { m[o.master] = masters[i][1].value.trim(); mm[o.master] = masterMeters[i][1].value.trim(); });
    t.masters = m;
    t.masterMeters = mm;
    await post('/api/config', { config: { tesira: { host: host.value.trim(), port: Number(port.value) || 23 }, tags: t }, reconnect: true });
    toast('Saved — reconnecting');
  };
  const field = ([label, input]) => h('div', { class: 'field' }, h('label', {}, label), input);
  // Network scan + auto-connect
  const auto = Toggle('Auto-connect', () => S.config.tesira.autoConnect !== false, (v) => {
    S.config.tesira.autoConnect = v;
    post('/api/config', { config: { tesira: { autoConnect: v } } });
  });
  auto.update();
  const scanBtn = h('button', { class: 'btn', onclick: () => { S.scan = { ...S.scan, scanning: true }; drawScan(); post('/api/scan'); } }, 'Scan network');
  const scanBox = h('div', { class: 'scan-box' });
  const useDevice = async (d) => {
    host.value = d.host; port.value = d.port;
    await post('/api/config', { config: { tesira: { host: d.host, port: d.port } }, reconnect: true });
    toast(`Connecting to ${d.name || d.host}`);
  };
  function drawScan() {
    const sc = S.scan || {};
    scanBtn.disabled = !!sc.scanning;
    scanBtn.textContent = sc.scanning ? 'Scanning…' : 'Scan network';
    let kids;
    if (sc.scanning) kids = [h('p', { class: 'hint scan-msg' }, h('span', { class: 'spinner' }), 'Looking for Tesira devices on your network… (a few seconds)')];
    else if (!sc.at) kids = [];
    else if (!sc.devices.length) kids = [h('p', { class: 'hint scan-msg' }, `No Tesira found on ${(sc.subnets || []).join(', ') || 'this network'}. Check it's powered on, on the same network as this PC, and that Telnet is enabled.`)];
    else kids = sc.devices.map((d) => {
      const current = d.host === S.config.tesira.host && Number(d.port) === Number(S.config.tesira.port);
      return h('div', { class: 'list-item' },
        h('span', { class: 'grow' }, h('b', {}, d.name || 'Tesira'), ' ', h('span', { class: 'meta mono' }, `${d.host}:${d.port}`)),
        current && S.status.ready ? h('span', { class: 'meta' }, 'Connected') : h('button', { class: 'btn sm primary', onclick: () => useDevice(d) }, current ? 'Reconnect' : 'Connect'));
    });
    scanBox.replaceChildren(...kids);
  }
  drawScan();
  comps.push({ scan: drawScan, update: () => { auto.update(); drawScan(); } });
  const logBox = h('div', { class: 'console' }, S.log.join('\n'));
  comps.push({ log: (line) => { logBox.textContent += (logBox.textContent ? '\n' : '') + line; logBox.scrollTop = logBox.scrollHeight; } });
  $('#page').append(dl, h('div', { class: 'grid' },
    h('div', { class: 'card' }, h('h2', {}, 'Tesira connection'), h('p', { class: 'hint' }, 'IP address and Telnet port of the Tesira (Telnet is port 23 by default).'),
      h('div', { class: 'row' }, h('div', { class: 'field' }, h('label', {}, 'IP address'), host), h('div', { class: 'field', style: { flex: '0 0 110px' } }, h('label', {}, 'Port'), port)),
      h('div', { class: 'row', style: { marginTop: '16px' } }, h('button', { class: 'btn primary', onclick: save }, 'Save & connect'), h('button', { class: 'btn', onclick: () => post('/api/reconnect') }, 'Reconnect'), scanBtn),
      scanBox,
      h('div', { class: 'row', style: { marginTop: '16px' } }, auto.el),
      h('p', { class: 'hint', style: { marginTop: '6px', marginBottom: 0 } }, 'If the Tesira doesn\'t answer at the saved address, scan the network and connect to the Tesira found there (when there is only one).')),
    h('div', { class: 'card' }, h('h2', {}, 'Instance tags'), h('p', { class: 'hint' }, S.aliases.length ? `Pick from the ${S.aliases.length} tags reported by the Tesira. Amber means the tag isn't on the device.` : 'Connect to the Tesira to pick tags from its list.'),
      ...Object.values(tags).map((t) => h('div', { class: 'row' }, field(t))),
      ...masters.map((t) => h('div', { class: 'row' }, field(t))),
      ...masterMeters.map((t) => h('div', { class: 'row' }, field(t))),
      h('div', { class: 'row', style: { marginTop: '16px' } }, h('button', { class: 'btn primary', onclick: save }, 'Save tags'))),
    h('div', { class: 'card' }, h('h2', {}, 'Demo mode'),
      h('p', { class: 'hint' }, S.demo
        ? 'On: MemeMixer is using a built-in fake Tesira with moving meters, so you can try everything without hardware. Demo settings and scenes are separate; your real ones are kept for when you switch back.'
        : 'Try MemeMixer without a Tesira. It switches to a built-in fake one, with its own settings and scenes. Your real setup is kept.'),
      S.canSwitchDemo
        ? h('div', { class: 'row' }, (() => {
            const t = Toggle('Demo mode', () => S.demo, async (v) => {
              t.el.querySelector('input').disabled = true;
              toast(v ? 'Switching to demo mode…' : 'Switching to your real Tesira…');
              await post('/api/demo', { on: v });
            }, 'warn');
            t.update();
            return t.el;
          })())
        : h('p', { class: 'hint', style: { marginBottom: 0 } }, S.demo ? 'Started with start-demo.bat. Close it and use start.bat for the real Tesira.' : 'Available in the installed app (MemeMixer.exe). From source, run start-demo.bat.')),
    h('div', { class: 'card' }, h('h2', {}, 'Phone & tablet access'),
      S.networkUrls.length
        ? [h('p', { class: 'hint' }, 'On a phone or tablet on the same Wi-Fi / network, scan the QR code with the camera or open this address in the browser:'),
           ...S.networkUrls.map((u) => h('div', { class: 'qr-item' },
             window.QR ? h('div', { class: 'qr', html: QR.svg(u) }) : null,
             h('div', { class: 'list-item' }, h('span', { class: 'grow mono-url' }, u),
               h('button', { class: 'btn sm', onclick: () => { navigator.clipboard?.writeText(u).then(() => toast('Copied'), () => {}); } }, 'Copy')))),
           h('p', { class: 'hint', style: { marginTop: '12px', marginBottom: 0 } }, 'Tip: in the phone browser, use "Add to Home screen" to open it like an app.')]
        : h('p', { class: 'hint' }, 'Only this PC can open the mixer. Set "web": { "host": "0.0.0.0" } in config.json and restart to allow phones on your network.')),
    h('div', { class: 'card wide' }, h('h2', {}, 'Event log'), h('p', { class: 'hint' }, 'Connection events and errors from the Tesira. Channel routing (which mixer inputs and outputs each fader uses) is in config.json.'), logBox)));
}

// ------------------------------------------------------------------ connection UI
function updateBanner() {
  const s = S.status;
  const conn = $('#conn');
  conn.className = `conn ${s.ready ? 'ready' : s.connected ? 'connecting' : ''}`;
  $('.conn-text', conn).textContent = s.ready ? (S.demo ? 'Demo mode' : `${s.host}:${s.port}`) : s.connected ? 'Connecting…' : `Offline · ${s.host}`;
  const b = $('#banner');
  const onSettings = location.hash === '#settings';
  b.hidden = !!s.ready || onSettings;
  b.innerHTML = '';
  if (!s.ready) b.append(`Not connected to the Tesira at ${s.host}:${s.port}. Retrying every few seconds — `, h('a', { href: '#settings' }, 'check Settings'), '.');
  document.body.classList.toggle('disconnected', !s.ready);
}

async function load() {
  const r = await fetch('/api/state').then((x) => x.json());
  S.config = r.config; S.state = r.state; S.status = r.status; S.aliases = r.aliases; S.snapshots = r.snapshots; S.log = r.log; S.networkUrls = r.networkUrls || []; S.scan = r.scan || S.scan; S.version = r.version;
  S.demo = !!r.demo; S.canSwitchDemo = !!r.canSwitchDemo;
  document.body.classList.toggle('demo', S.demo);
  $('#brandSub').textContent = S.demo ? 'Demo mode · fake Tesira' : 'Tesira headphone mix';
  renderPage();
  updateBanner();
}

function connectEvents() {
  const es = new EventSource('/events');
  es.addEventListener('hello', () => load());
  es.addEventListener('patch', (e) => { Object.assign(S.state, JSON.parse(e.data)); scheduleUpdate(); });
  es.addEventListener('reset', () => { S.state = {}; scheduleUpdate(); });
  es.addEventListener('meters', (e) => { const m = JSON.parse(e.data); Object.assign(lastMeters, m); for (const c of comps) c.meters && c.meters(m); });
  es.addEventListener('status', (e) => { S.status = JSON.parse(e.data); updateBanner(); for (const c of comps) c.scan && c.scan(); });
  es.addEventListener('aliases', (e) => { S.aliases = JSON.parse(e.data); if (location.hash === '#settings' && !document.activeElement?.matches('input')) renderPage(); });
  es.addEventListener('config', (e) => {
    S.config = JSON.parse(e.data);
    const active = document.activeElement;
    if (!active || !active.matches('input, select')) renderPage();
    else for (const c of comps) c.presets && c.presets();
  });
  es.addEventListener('restarting', (e) => { const d = JSON.parse(e.data); toast(d.demo ? 'Switching to demo mode…' : 'Switching to your real Tesira…'); });
  es.addEventListener('scan',(e) => { S.scan = JSON.parse(e.data); for (const c of comps) c.scan && c.scan(); });
  es.addEventListener('snapshots',(e) => { S.snapshots = JSON.parse(e.data); for (const c of comps) c.snaps && c.snaps(); });
  es.addEventListener('log', (e) => { const line = JSON.parse(e.data); S.log.push(line); for (const c of comps) c.log && c.log(line); });
  es.onerror = () => { S.status = { ...S.status, ready: false, connected: false }; updateBanner(); };
}

window.addEventListener('hashchange', renderPage);
connectEvents();
