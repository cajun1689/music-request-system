(function () {
  const bridge = window.bridge;
  const el = (id) => document.getElementById(id);
  if (!bridge || !bridge.getLightingStatus) return;
  let state = null;
  let pending = false;
  let revision = 0;
  let actionError = null;
  function update(s) {
    if (!s) return;
    state = s;
    el('lighting-enabled').checked = s.enabled;
    const names = { off: 'Off', searching: 'Finding MA', standby: 'Other DJ controls', ready: 'Connected', migration: 'Setup needed', error: 'Needs attention' };
    el('lighting-state').textContent = names[s.state] || s.state;
    el('lighting-state').className = 'status-badge ' + (s.state === 'ready' ? 'connected' : 'idle');
    const lines = [];
    if (!s.enabled) lines.push('Off. No lighting connectors running.');
    if (s.address) lines.push('MA: ' + s.address);
    if (s.state === 'standby') lines.push('Controlled by ' + (s.owner || 'another DJ') + '. Waiting for handoff.');
    if (s.state === 'migration') lines.push('Standalone helpers found. Use Bridge connectors after the booth setup is verified; backups are kept.');
    if (s.state === 'ready') {
      lines.push(s.bpm ? s.bpm.toFixed(1) + ' BPM · ' + s.tempoSource : 'Waiting for fresh A9 / CDJ tempo');
      if (s.opening) lines.push('30-second opening: movers only, white phased pulses and wide slow movement. Normal club automation follows.');
      lines.push('Track colors: ' + (s.colors ? 'On' : 'Manual') + ' · Rotation: ' + (s.timer ? 'On' : 'Off'));
      if (s.lastTrack) lines.push('Last track change: ' + s.lastTrack);
    }
    if (!lines.length) lines.push(s.enabled ? 'Waiting for the booth MA. No club look has been started.' : 'Off. No lighting connectors running.');
    el('lighting-detail').textContent = lines.join('\n');
    el('lighting-remote').disabled = pending || !s.address;
    el('lighting-start').disabled = pending || (s.enabled && s.state !== 'ready');
    el('lighting-stop').disabled = s.enabled && s.state === 'standby';
    el('lighting-white').disabled = pending || (s.enabled && !['ready', 'migration'].includes(s.state));
    el('lighting-enabled').disabled = pending;
    el('lighting-find').disabled = pending;
    el('lighting-migrate').disabled = pending;
    el('lighting-normal').disabled = pending;
    el('lighting-normal').style.display = s.opening && s.state === 'ready' ? 'inline-flex' : 'none';
    el('lighting-migrate').style.display = s.state === 'migration' ? 'inline-flex' : 'none';
    const error = actionError || s.error;
    el('lighting-error').textContent = error || '';
    el('lighting-error').style.display = error ? 'block' : 'none';
  }
  async function action(fn, interrupt = false) {
    if (pending && !interrupt) return;
    const mine = ++revision;
    actionError = null;
    pending = true; if (state) update(state);
    let failure = null;
    try { const result = await fn(); if (result && mine === revision) state = result; }
    catch (error) { failure = error.message || String(error); }
    finally {
      if (mine !== revision) return;
      actionError = failure;
      pending = false; if (state) update(state);
      if (failure) { el('lighting-error').textContent = failure; el('lighting-error').style.display = 'block'; }
    }
  }
  bridge.onLightingStatus(update);
  bridge.getLightingStatus().then(update);
  el('lighting-enabled').addEventListener('change', function () { const enabled = this.checked; action(() => bridge.setLightingEnabled(enabled)); });
  el('lighting-find').addEventListener('click', () => action(() => bridge.findLighting(el('lighting-address').value)));
  el('lighting-start').addEventListener('click', () => action(() => bridge.startClubNight()));
  el('lighting-stop').addEventListener('click', () => action(() => bridge.stopClubShow(), true));
  el('lighting-white').addEventListener('click', () => action(() => bridge.whiteOnly()));
  el('lighting-remote').addEventListener('click', () => action(() => bridge.openLightingRemote()));
  el('lighting-normal').addEventListener('click', () => action(() => bridge.finishLightingOpening()));
  el('lighting-migrate').addEventListener('click', () => action(() => bridge.migrateLighting()));
})();
