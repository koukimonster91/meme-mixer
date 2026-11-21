// Stream Deck support. The button layout lives in config.streamDeck and is edited on
// the Stream Deck page of the web UI. The plugin only draws what this module describes
// (one "view" per key) and reports key presses, so all logic stays here.
//
// config.streamDeck = { pages: [ { name, keys: [ key | null  x 15 ] } ] }
// key types:
//   { type: 'mute',   target }            target kinds: source, master, allSources, input, allOutputs, sourceEverywhere
//   { type: 'volume', dir: 'up'|'down', step, target }   kinds: source, master, input, gate
//   { type: 'meter',  target }            kinds: source, master, input, gate
//   { type: 'scene',  name }
//   { type: 'page',   to: 'next' | 'prev' | <page index> }
//   { type: 'profile' }                   back to the previous Stream Deck profile (shows an X)
//   { type: 'pagename' }                  just shows the current page's name
//   optional on every key: label (overrides the automatic name)

const KEYS = 15;
const MIN_XP = -100, MAX_XP = 0;

module.exports = function createDeck({ getConfig, getState, applyOps, getMeter, recallScene }) {
  const cfg = () => getConfig();
  const T = () => cfg().tags;
  const st = (tag, attr, idx) => getState(`${tag}|${attr}|${[].concat(idx ?? []).join(',')}`);
  const pairs = (src, out) => {
    const [l, r] = out.mixerOutputs;
    return src.inputs.length === 1 ? [[src.inputs[0], l], [src.inputs[0], r]] : [[src.inputs[0], l], [src.inputs[1], r]];
  };
  const source = (name) => cfg().sources.find((s) => s.name === name);
  const output = (i) => cfg().outputs[Number(i)];
  const masterChs = (out) => out.masterChannels || [1, 2];
  const levelRange = (tag) => [st(tag, 'minLevel', 1) ?? -100, st(tag, 'maxLevel', 1) ?? 12];

  // Everything a key needs to know about the thing it controls.
  function control(t) {
    if (!t) return null;
    const mix = T().mixer;
    switch (t.kind) {
      case 'source': {
        const out = output(t.output), src = source(t.source);
        // A source meter isn't tied to a mix.
        if (src && t.output == null) return { name: src.name, sub: 'Input', meter: { tag: T().inputMeter, channels: src.meter || src.inputs } };
        if (!out || !src) return null;
        const prs = pairs(src, out);
        return {
          name: src.name, sub: out.name, min: MIN_XP, max: MAX_XP,
          level: () => st(mix, 'crosspointLevel', prs[0]),
          levelOps: (v) => prs.map((p) => ({ tag: mix, attr: 'crosspointLevel', idx: p, value: v })),
          muted: () => { const s = st(mix, 'crosspointLevelState', prs[0]); return s == null ? null : !s; },
          muteOps: (m) => prs.map((p) => ({ tag: mix, attr: 'crosspointLevelState', idx: p, value: !m })),
          meter: { tag: T().inputMeter, channels: src.meter || src.inputs },
        };
      }
      case 'master': {
        const out = output(t.output);
        const tag = out && T().masters[out.master];
        if (!tag) return null;
        const chs = masterChs(out);
        const [min, max] = levelRange(tag);
        const mt = (T().masterMeters || [])[out.master];
        return {
          name: out.name, sub: 'Master', min, max,
          level: () => st(tag, 'level', chs[0]),
          levelOps: (v) => chs.map((c) => ({ tag, attr: 'level', idx: [c], value: v })),
          muted: () => st(tag, 'mute', chs[0]) ?? null,
          muteOps: (m) => chs.map((c) => ({ tag, attr: 'mute', idx: [c], value: m })),
          meter: mt ? { tag: mt, channels: out.masterMeterChannels || [1, 2] } : null,
        };
      }
      case 'input': {
        const ch = cfg().inputChannels.find((c) => c.channel === Number(t.channel));
        const tag = T().inputMaster;
        if (!ch) return null;
        const targets = ch.link ? [ch.channel, ch.link] : [ch.channel];
        const [min, max] = levelRange(tag);
        return {
          name: ch.name.replace(/ [LR]$/, ''), sub: 'Input', min, max,
          level: () => st(tag, 'level', ch.channel),
          levelOps: (v) => targets.map((c) => ({ tag, attr: 'level', idx: [c], value: v })),
          muted: () => st(tag, 'mute', ch.channel) ?? null,
          muteOps: (m) => targets.map((c) => ({ tag, attr: 'mute', idx: [c], value: m })),
          meter: { tag: T().inputMeter, channels: ch.link ? [ch.meter || ch.channel, cfg().inputChannels.find((c) => c.channel === ch.link)?.meter || ch.link].sort((a, b) => a - b) : [ch.meter || ch.channel] },
        };
      }
      case 'gate': {
        const tag = T().noiseGate;
        return {
          name: 'Gate', sub: 'Threshold', unit: 'dBu', min: -60, max: 24,
          level: () => st(tag, 'threshold'),
          levelOps: (v) => [{ tag, attr: 'threshold', idx: [], value: v }],
          meter: { tag, channels: (cfg().noiseGateChannels || []).map((_, i) => i + 1), gr: true },
        };
      }
      case 'allSources': {
        const out = output(t.output);
        if (!out) return null;
        const srcs = out.sources.map(source).filter(Boolean);
        return {
          name: out.name, sub: 'All sources',
          muted: () => { const v = srcs.map((s) => st(mix, 'crosspointLevelState', pairs(s, out)[0])); return v.some((x) => x == null) ? null : v.every((x) => x === false); },
          muteOps: (m) => srcs.flatMap((s) => pairs(s, out).map((p) => ({ tag: mix, attr: 'crosspointLevelState', idx: p, value: !m }))),
        };
      }
      case 'allOutputs': {
        const ms = cfg().outputs.map((o) => ({ tag: T().masters[o.master], chs: masterChs(o) })).filter((m) => m.tag);
        return {
          name: 'All outputs', sub: 'Masters',
          muted: () => { const v = ms.map(({ tag, chs }) => st(tag, 'mute', chs[0])); return v.some((x) => x == null) ? null : v.every((x) => x === true); },
          muteOps: (m) => ms.flatMap(({ tag, chs }) => chs.map((c) => ({ tag, attr: 'mute', idx: [c], value: m }))),
        };
      }
      case 'sourceEverywhere': {
        const src = source(t.source);
        if (!src) return null;
        const outs = cfg().outputs.filter((o) => o.sources.includes(src.name));
        return {
          name: src.name, sub: 'Every mix',
          muted: () => { const v = outs.map((o) => st(mix, 'crosspointLevelState', pairs(src, o)[0])); return v.some((x) => x == null) ? null : v.length > 0 && v.every((x) => x === false); },
          muteOps: (m) => outs.flatMap((o) => pairs(src, o).map((p) => ({ tag: mix, attr: 'crosspointLevelState', idx: p, value: !m }))),
        };
      }
    }
    return null;
  }

  function meterValues(m) {
    if (!m || !m.tag) return null;
    const arr = getMeter(m.tag);
    if (!arr) return null;
    return m.channels.map((c) => {
      const v = arr[c - 1];
      return typeof v === 'number' ? Math.round(v) : null;
    });
  }

  const pages = () => {
    const p = cfg().streamDeck && Array.isArray(cfg().streamDeck.pages) ? cfg().streamDeck.pages : [];
    return p.length ? p : [{ name: 'Page 1', keys: [] }];
  };

  // What one key should show right now.
  function view(key, pageIndex, pageCount) {
    if (!key || !key.type) return null;
    const label = key.label || null;
    if (key.type === 'scene') return { type: 'scene', name: label || key.name, sub: 'Scene' };
    // Leaves MemeMixer: the plugin switches back to the previous Stream Deck profile.
    if (key.type === 'profile') return { type: 'profile', name: label || 'Exit' };
    if (key.type === 'pagename') {
      const ps = pages();
      return { type: 'pagename', name: label || ps[pageIndex].name || `Page ${pageIndex + 1}`, index: pageIndex + 1, count: pageCount };
    }
    if (key.type === 'page') {
      const to = key.to === 'next' ? (pageIndex + 1) % pageCount : key.to === 'prev' ? (pageIndex - 1 + pageCount) % pageCount : Math.min(Math.max(0, Number(key.to) || 0), pageCount - 1);
      return { type: 'page', dir: key.to === 'prev' ? 'prev' : key.to === 'next' ? 'next' : 'go', to, name: label || pages()[to].name };
    }
    const c = control(key.target);
    if (!c) return { type: 'invalid', name: label || '?', sub: 'Not found' };
    const base = { name: label || c.name, sub: c.sub };
    if (key.type === 'mute') return { ...base, type: 'mute', muted: c.muted ? c.muted() : null };
    if (key.type === 'volume') {
      const lv = c.level ? c.level() : null;
      return { ...base, type: 'volume', dir: key.dir === 'down' ? 'down' : 'up', level: typeof lv === 'number' ? Math.round(lv * 10) / 10 : null, min: c.min, unit: c.unit || 'dB', muted: c.muted ? c.muted() : null };
    }
    if (key.type === 'meter') {
      return { ...base, type: 'meter', meter: meterValues(c.meter), gr: !!(c.meter && c.meter.gr), muted: c.muted ? c.muted() : null, range: cfg().meter || { min: -60, max: 24, yellow: 0, red: 18 } };
    }
    return null;
  }

  function views(online) {
    const ps = pages();
    return {
      online,
      pages: ps.map((p, i) => ({ name: p.name || `Page ${i + 1}`, keys: Array.from({ length: KEYS }, (_, k) => view((p.keys || [])[k], i, ps.length)) })),
    };
  }

  // A key press. Returns { ok, message }.
  async function press(pageIndex, keyIndex) {
    const key = ((pages()[pageIndex] || {}).keys || [])[keyIndex];
    if (!key) return { ok: false, message: 'empty key' };
    if (key.type === 'scene') return recallScene(key.name);
    // page and profile keys are handled by the plugin; meters and page names do nothing
    if (['page', 'meter', 'profile', 'pagename'].includes(key.type)) return { ok: true };
    const c = control(key.target);
    if (!c) return { ok: false, message: 'target not found' };
    if (key.type === 'mute') {
      if (!c.muteOps) return { ok: false };
      const m = c.muted ? c.muted() : null;
      await applyOps(c.muteOps(m !== true));
      return { ok: true };
    }
    if (key.type === 'volume') {
      if (!c.levelOps) return { ok: false };
      const cur = c.level();
      if (typeof cur !== 'number') return { ok: false, message: 'level unknown' };
      const step = Math.abs(Number(key.step) || 1) * (key.dir === 'down' ? -1 : 1);
      const next = Math.round(Math.min(c.max, Math.max(c.min, cur + step)) * 10) / 10;
      const ops = c.levelOps(next);
      // Same rule as the faders: the bottom mutes, leaving the bottom unmutes.
      if (c.muteOps && c.muted) {
        const m = c.muted();
        if (next <= c.min && m === false) ops.push(...c.muteOps(true));
        else if (next > c.min && cur <= c.min && m === true) ops.push(...c.muteOps(false));
      }
      await applyOps(ops);
      return { ok: true };
    }
    return { ok: false };
  }

  return { views, press, KEYS };
};

// Starting layout: one page per output. Edited on the Stream Deck page of the web UI.
module.exports.defaultLayout = function defaultLayout(config) {
  return {
    pages: config.outputs.map((o, i) => {
      const keys = Array(KEYS).fill(null);
      const srcs = o.sources.slice(0, 6);
      srcs.slice(0, 5).forEach((s, k) => { keys[k] = { type: 'mute', target: { kind: 'source', output: i, source: s } }; });
      if (srcs[5]) keys[5] = { type: 'mute', target: { kind: 'source', output: i, source: srcs[5] } };
      keys[6] = { type: 'meter', target: { kind: 'master', output: i } };
      keys[7] = { type: 'volume', dir: 'down', step: 1, target: { kind: 'master', output: i } };
      keys[8] = { type: 'volume', dir: 'up', step: 1, target: { kind: 'master', output: i } };
      keys[9] = { type: 'mute', target: { kind: 'master', output: i } };
      keys[10] = { type: 'page', to: 'prev' };
      keys[11] = { type: 'mute', target: { kind: 'allSources', output: i } };
      keys[14] = { type: 'page', to: 'next' };
      return { name: o.name, keys };
    }),
  };
};
