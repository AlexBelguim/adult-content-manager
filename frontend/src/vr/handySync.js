// The Handy in VR: the same path as the app's player (components/player/FunscriptPanel.js). The video's funscript is
// found with GET /api/funscripts?file=, read with /api/files/raw and put on the Handy with window.HandyControl.load(json,
// video) (public/handy-control.js, shared with faptap-dl: not edited, and its settings and key are never changed here).
// The SDK then follows the video it was given: "playing" plays the script from video.currentTime, "pause" stops it.
// Connecting stays in the app; VR only reads the connection.
//
// What it is given is a stand-in for the VR player's <video> (like the player's scene proxy): it reports the file's own
// time (a converted stream starts at its ?start= offset), minus VR's own sync offset (+ = the strokes come later; kept in
// localStorage, not on the Handy), and it passes on only the events that should move the Handy:
//   playing, and seeked while playing      -> playing (play from here)
//   pause, waiting (buffering), rate != 1  -> pause   (stop)
//   the offset changed while playing       -> playing again
//   "Pause the Handy" on                   -> pause, and nothing more until it is off again (then playing)
// No imports, so it can be checked with a mock outside the browser (notes/test/p9vr/handy-sync.test.mjs).

const SEND_TIMEOUT_MS = 10000;
const OFFSET_KEY = 'vr.handyOffset';
export const OFFSET_STEP = 25;
const OFFSET_MAX = 1000;

function readOffset() {
  try { const n = Number(window.localStorage.getItem(OFFSET_KEY)); return Number.isFinite(n) ? Math.max(-OFFSET_MAX, Math.min(OFFSET_MAX, n)) : 0; } catch { return 0; }
}
function writeOffset(n) { try { window.localStorage.setItem(OFFSET_KEY, String(n)); } catch { /* storage blocked */ } }

const nameOf = (p) => String(p || '').split(/[\\/]/).pop();

/** the main script of a video: the one without an axis, else the first (the server lists the main one first) */
export function pickScript(list) {
  const l = (list || []).filter((s) => s && s.path);
  return l.find((s) => !s.axis) || l[0] || null;
}

/**
 * A stand-in <video> for the Handy SDK. real: the element; time(): the file's time in s; offsetMs(); held(): the Handy
 * is paused by the user. It passes the SDK's `instanceof HTMLVideoElement` check; its events are its own.
 */
export function makeVideoProxy(real, { time, offsetMs, held }) {
  const Base = typeof HTMLVideoElement !== 'undefined' ? HTMLVideoElement : null;
  const proxy = Object.create(Base ? Base.prototype : Object.prototype);
  const events = new EventTarget();
  Object.defineProperties(proxy, {
    currentTime: { get: () => Math.max(0, time() - offsetMs() / 1000), set: () => {}, configurable: true, enumerable: true },
    duration: { get: () => real.duration, configurable: true },
    paused: { get: () => real.paused || held(), configurable: true },
    playbackRate: { get: () => real.playbackRate, configurable: true },
    readyState: { get: () => real.readyState, configurable: true },
    style: { value: {}, configurable: true },
    offsetHeight: { value: 0, configurable: true },
    offsetWidth: { value: 0, configurable: true },
    addEventListener: { value: (...a) => events.addEventListener(...a), configurable: true },
    removeEventListener: { value: (...a) => events.removeEventListener(...a), configurable: true },
    dispatchEvent: { value: (e) => events.dispatchEvent(e), configurable: true },
    play: { value: () => real.play(), configurable: true },
    pause: { value: () => real.pause(), configurable: true },
  });
  return proxy;
}

/**
 * createHandySync({ control, listScripts, readScript, onChange })
 *   control()          the HandyControl (window.HandyControl, or a mock for ?handy=mock), or null when it did not load
 *   listScripts(path)  -> [{ name, path, axis }]        readScript(script) -> the funscript's JSON
 *   onChange()         something on the Handy line changed
 * attach(item, player) when a video opens (player: { element, time, paused }); detach() when it goes.
 */
export function createHandySync({ control, listScripts, readScript, onChange } = {}) {
  let cur = null;           // { item, player, proxy, real, script, json, phase, error, off: [] }
  let offset = readOffset();
  let held = false;         // "Pause the Handy" (the video keeps playing)
  let seq = 0;
  let watched = null;       // the control we listen to for 'change'
  const changed = () => { try { onChange?.(); } catch { /* the line repaints next time */ } };
  const ctl = () => { try { return control?.() || null; } catch { return null; } };

  const fire = (type) => { if (cur?.proxy) cur.proxy.dispatchEvent(new Event(type)); };
  const live = () => !!cur && !!cur.json && !!ctl() && ctl().raw === cur.json;
  const rateOK = () => !cur?.real || !Number.isFinite(cur.real.playbackRate) || cur.real.playbackRate === 1;
  /** the Handy should play now */
  const shouldPlay = () => live() && !held && !cur.real.paused && rateOK();

  function onControlChange() {
    const c = ctl();
    if (!cur) { changed(); return; }
    if (c && c.connected && cur.json) {
      // the control sent it again by itself (after a reconnect, or a change of its settings)
      if (c.raw === cur.json && c.script?.status === 'ready') cur.phase = 'ready';
      // connected after the video opened: send the script (a moment later, once the control has finished connecting)
      else if (c.raw !== cur.json && cur.phase === 'waiting') {
        const my = cur;
        setTimeout(() => { const c2 = ctl(); if (cur === my && my.phase === 'waiting' && c2?.connected && c2.raw !== my.json) send(); }, 0);
      }
    }
    if (c && !c.connected && cur.phase === 'ready') cur.phase = 'waiting';
    changed();
  }
  function watch() {
    const c = ctl();
    if (c === watched) return;
    if (watched) watched.removeEventListener?.('change', onControlChange);
    watched = c;
    if (c) c.addEventListener?.('change', onControlChange);
  }

  async function send() {
    const c = ctl(), my = cur;
    if (!my || !c || !c.connected || !my.json) return;
    const s = seq;
    my.phase = 'sending'; my.error = '';
    changed();
    let timer;
    try {
      const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('the Handy did not answer within 10 s')), SEND_TIMEOUT_MS); });
      const ok = await Promise.race([c.load(my.json, my.proxy), timeout]);
      if (s !== seq || cur !== my) return;
      if (ok === false) throw new Error(c.raw === my.json ? 'the Handy is not connected' : 'another script came in');
      my.phase = 'ready';
      if (held) fire('pause');
    } catch (e) {
      if (s !== seq || cur !== my) return;
      my.phase = 'error'; my.error = String(e?.message || e || 'it did not work').replace(/[.\s]+$/, '');
    } finally { clearTimeout(timer); }
    changed();
  }

  function attach(item, player) {
    detach();
    watch();
    const s = ++seq;
    const real = player.element;
    if (!real) return;
    const my = { item, player, real, script: null, json: null, phase: 'looking', error: '', off: [] };
    my.proxy = makeVideoProxy(real, { time: () => player.time, offsetMs: () => offset, held: () => held });
    const on = (type, fn) => { real.addEventListener(type, fn); my.off.push(() => real.removeEventListener(type, fn)); };
    on('playing', () => { if (shouldPlay()) fire('playing'); changed(); });
    on('seeked', () => { if (shouldPlay()) fire('playing'); });
    on('pause', () => { fire('pause'); changed(); });
    on('waiting', () => fire('pause'));
    on('ratechange', () => { if (!rateOK()) fire('pause'); else if (shouldPlay()) fire('playing'); });
    cur = my;
    changed();
    (async () => {
      try {
        const list = await listScripts(item.path);
        if (s !== seq) return;
        my.script = pickScript(list);
        if (!my.script) { my.phase = 'none'; changed(); return; }
        my.json = await readScript(my.script);
        if (s !== seq) return;
        if (!my.json || !Array.isArray(my.json.actions)) throw new Error(`${my.script.name || 'the script'} is not a valid funscript`);
        my.phase = 'waiting';
        const c = ctl();
        if (c && c.connected) await send(); else changed();
      } catch (e) {
        if (s !== seq) return;
        my.phase = 'error'; my.error = String(e?.message || e || 'it did not load').replace(/[.\s]+$/, '');
        changed();
      }
    })();
  }

  function detach() {
    seq++;
    const my = cur;
    cur = null;
    if (!my) return;
    my.off.forEach((fn) => fn());
    const c = ctl();
    if (c && my.json && c.raw === my.json) { try { c.unload(); } catch { /* the device is optional */ } }
    changed();
  }

  return {
    attach, detach,
    /** VR's own sync offset in ms (+ = the strokes come later) */
    get offset() { return offset; },
    setOffset(ms) {
      offset = Math.max(-OFFSET_MAX, Math.min(OFFSET_MAX, Math.round(ms)));
      writeOffset(offset);
      if (shouldPlay()) fire('playing');
      changed();
    },
    nudge(d) { this.setOffset(offset + d * OFFSET_STEP); },
    /** pause the Handy without pausing the video (and back) */
    get held() { return held; },
    setHeld(on) {
      held = !!on;
      if (held) fire('pause'); else if (shouldPlay()) fire('playing');
      changed();
    },
    toggleHeld() { this.setHeld(!held); },
    /** { key, text, tone } for the Handy line: key is one of unavailable, idle, connecting, error, looking, none,
     *  waiting, sending, loaded, syncing */
    status() {
      const c = ctl();
      const name = cur?.script ? (cur.script.name || nameOf(cur.script.path)) : '';
      if (!c) return { key: 'unavailable', text: 'The Handy control did not load', tone: 'dim' };
      if (c.status === 'connecting') return { key: 'connecting', text: 'Connecting…', tone: 'dim' };
      if (!c.connected) {
        return { key: 'idle', text: `${cur?.script ? 'Script found · ' : ''}Not connected · Connect it in the app first`, tone: 'dim' };
      }
      if (!cur) return { key: 'idle', text: 'Connected', tone: 'dim' };
      if (cur.phase === 'error') return { key: 'error', text: `Connected · ${cur.error}`, tone: 'bad' };
      if (cur.phase === 'looking') return { key: 'looking', text: 'Connected · looking for a script…', tone: 'dim' };
      if (cur.phase === 'none') return { key: 'none', text: 'Connected · no script', tone: 'dim' };
      if (cur.phase === 'sending' || cur.phase === 'waiting' || c.script?.status === 'sending') return { key: 'sending', text: `Sending ${name}…`, tone: 'dim' };
      if (c.script?.status === 'error') return { key: 'error', text: c.script.error || 'The script did not reach the Handy', tone: 'bad' };
      if (!live()) return { key: 'none', text: 'Connected · another script is on the Handy', tone: 'dim' };
      if (held) return { key: 'loaded', text: `Script loaded · ${name} · Handy paused`, tone: 'warn' };
      if (shouldPlay()) return { key: 'syncing', text: `Syncing · ${name}`, tone: 'ok' };
      return { key: 'loaded', text: `Script loaded · ${name}`, tone: 'text' };
    },
    get active() { return !!cur; },
    dispose() { detach(); if (watched) watched.removeEventListener?.('change', onControlChange); watched = null; },
  };
}

/**
 * A stand-in HandyControl for ?handy=mock screenshots: connected, never on the network (no SDK). It behaves like the
 * SDK's video player hook (playing -> play from currentTime, pause -> stop) and logs what the Handy would have done.
 */
export function createMockHandyControl() {
  const c = new EventTarget();
  const log = [];
  let video = null, onPlaying = null, onPause = null;
  const changed = () => c.dispatchEvent(new Event('change'));
  Object.assign(c, {
    mock: true, status: 'connected', error: '', key: 'mock', settings: { min: 0, max: 100, offset: 0 },
    script: { status: 'none', error: '' }, raw: null, log,
    async load(json, v) {
      c.raw = json; c.script = { status: 'sending', error: '' }; changed();
      await new Promise((r) => setTimeout(r, 200));
      if (c.raw !== json) return false;
      if (video) { video.removeEventListener('playing', onPlaying); video.removeEventListener('pause', onPause); }
      video = v || null;
      if (video) {
        onPlaying = () => log.push({ at: Date.now(), cmd: 'play', ms: Math.round(video.currentTime * 1000) });
        onPause = () => log.push({ at: Date.now(), cmd: 'stop' });
        video.addEventListener('playing', onPlaying); video.addEventListener('pause', onPause);
      }
      log.push({ at: Date.now(), cmd: 'script', actions: json.actions.length });
      if (video && !video.paused) log.push({ at: Date.now(), cmd: 'play', ms: Math.round(video.currentTime * 1000) });
      c.script = { status: 'ready', error: '' }; changed();
      return true;
    },
    unload() {
      if (video) { video.removeEventListener('playing', onPlaying); video.removeEventListener('pause', onPause); }
      video = null; c.raw = null; c.script = { status: 'none', error: '' };
      log.push({ at: Date.now(), cmd: 'unload' }); changed();
    },
  });
  Object.defineProperty(c, 'connected', { get: () => c.status === 'connected' });
  return c;
}
