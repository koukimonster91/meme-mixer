// MemeMixer pairing page: a device that isn't paired yet enters the code shown on the PC.
(function () {
  const $ = (id) => document.getElementById(id);
  const code = $('code'), msg = $('msg'), go = $('go');
  const say = (t, bad) => { msg.textContent = t; msg.className = 'pair-msg' + (bad ? ' bad' : ' ok'); };

  code.addEventListener('input', () => {
    const v = code.value.replace(/\D/g, '').slice(0, 6);
    if (code.value !== v) code.value = v;
    if (v.length === 6 && !go.disabled) submit();
  });
  $('pairForm').addEventListener('submit', (e) => { e.preventDefault(); submit(); });

  async function submit() {
    const v = code.value.replace(/\D/g, '');
    if (v.length !== 6) return say('The code has 6 digits.', true);
    go.disabled = true;
    say('Checking…');
    try {
      const r = await fetch('/api/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: v, name: $('name').value }) });
      const d = await r.json().catch(() => ({}));
      if (d.ok) { say('Connected. Opening MemeMixer…'); location.replace('/'); return; }
      code.value = '';
      say({
        wrong: 'That code is wrong or has changed. Type the code showing on the PC now.',
        closed: 'Nobody is showing a code right now. On the MemeMixer PC, open Settings → Phone & tablet access, then type the code.',
        locked: `Too many wrong codes. Try again in ${Math.ceil((d.wait || 300) / 60)} min.`,
        paused: `Too many wrong codes from this network. Connecting is paused for ${Math.ceil((d.wait || 600) / 60)} min.`,
        off: 'Phone & tablet access is switched off on the MemeMixer PC.',
      }[d.error] || 'Could not connect. Try again.', true);
    } catch { say('MemeMixer isn\'t reachable. Check you\'re on the same network as the PC.', true); }
    go.disabled = false;
    code.focus();
  }
})();
