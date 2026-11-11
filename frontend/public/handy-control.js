/* handy-control.js: the Handy connection and its settings, shared by faptap-dl (F:\git\faptap-dl\handy-control.js) and ACM
   (F:\git\adult-content-manager\frontend\public\handy-control.js). Keep the two copies the same.

   Needs the Handy SDK (handy.js, window.Handy, API v2) loaded first. Gives:
   - window.HandyControl: the one connection on the page. connect(key), disconnect(), set({min, max, speed, reverse, offset}),
     load(funscript, video) to play a script in sync with a <video> (reverse and the speed limit are applied first, and again
     when they change), unload(), shape(funscript). Fires "change" whenever anything about it changes; .sdk is the SDK instance.
   - <handy-control>: the key, Connect and a gear with the settings, in the host page's colours (ACM's token names:
     --surface, --raised, --overlay, --text, --dim, --muted, --faint, --line, --line-strong, --accent, --accent-quiet,
     --on-accent, --ok, --warn, --bad, --radius, --radius-lg). The attribute "compact" shows just the dot and the gear, with
     the key in the panel.
   Stroke range and sync offset are the Handy's own settings, stored on the device; the speed limit, reverse and the key are
   kept in this page's localStorage. */
(() => {
  if (window.HandyControl) return;

  const STORE = "handy-control";
  const SPEED_OFF = 500;   // the speed slider's far right: no limit
  const MSG = {
    nosdk: "The Handy SDK did not load.",
    nokey: "Enter the key",
    offline: "No Handy online with that key: check it, and that the Handy is on Wi-Fi.",
  };

  // the script as the Handy gets it: reversed (or not), and no faster than the speed limit (units per second): a move that
  // would be faster is cut short where the limit gets it by its time, so strokes keep their timing and get shorter
  function shape(funscript, {reverse = false, speed = SPEED_OFF} = {}) {
    const flip = !!reverse !== !!funscript.inverted;
    const actions = [...(funscript.actions || [])].sort((a, b) => a.at - b.at);
    const out = [];
    let prev = null;
    for (const a of actions) {
      let pos = Math.max(0, Math.min(100, flip ? 100 - a.pos : a.pos));
      if (prev && speed < SPEED_OFF) {
        const most = speed * Math.max(0, a.at - prev.at) / 1000;
        if (Math.abs(pos - prev.pos) > most) pos = prev.pos + Math.sign(pos - prev.pos) * most;
      }
      out.push(prev = {at: Math.round(a.at), pos: Math.round(pos)});
    }
    return {...funscript, inverted: false, actions: out};
  }

  class Controller extends EventTarget {
    constructor() {
      super();
      let saved = {};
      try { saved = JSON.parse(localStorage.getItem(STORE) || "{}"); } catch {}
      let oldKey = "";   // ACM's own key, from before this module
      try { oldKey = localStorage.getItem("handyConnectionCode") || localStorage.getItem("handyCode") || ""; } catch {}
      this.key = saved.key || oldKey;
      this.settings = {min: 0, max: 100, offset: 0, speed: saved.speed ?? SPEED_OFF, reverse: !!saved.reverse};
      this.status = "idle";   // idle, connecting, connected, error
      this.error = "";
      this.script = {status: "none", error: ""};   // none, sending, ready, error
      this.fw = "";
      this.handy = null;
      this.raw = null;
      this.video = null;
      this.timers = {};
      if (saved.auto && this.key) setTimeout(() => this.connect(this.key, true), 0);   // it was connected when the page was left
    }

    get sdk() {
      if (!this.handy && window.Handy) {
        this.handy = window.Handy.init();
        this.handy.on("state", ({state}) => {   // the SDK notices a Handy that went offline
          if (this.status === "connected" && state && state.connected === false && !state.connecting) {
            this.status = "idle";
            this.script = {status: "none", error: ""};
            this.changed();
          }
        });
      }
      return this.handy;
    }
    get connected() { return this.status === "connected"; }
    get changedFromDefaults() {
      const s = this.settings;
      return s.min !== 0 || s.max !== 100 || s.offset !== 0 || s.speed < SPEED_OFF || s.reverse;
    }

    save(auto) {
      try {
        const old = JSON.parse(localStorage.getItem(STORE) || "{}");
        localStorage.setItem(STORE, JSON.stringify({key: this.key, speed: this.settings.speed, reverse: this.settings.reverse,
                                                    auto: auto ?? old.auto ?? false}));
      } catch {}
    }
    changed() { this.dispatchEvent(new Event("change")); }

    async connect(key, quiet) {
      key = (key || "").trim();
      if (this.connected && key === this.key) return true;   // already (a page restoring the connection, and this, both asked)
      if (this.status === "connecting") return false;
      if (!key) { if (!quiet) { this.status = "error"; this.error = MSG.nokey; this.changed(); } return false; }
      if (!this.sdk) { this.status = "error"; this.error = MSG.nosdk; this.changed(); return false; }
      this.key = key;
      this.save();
      this.status = "connecting";
      this.error = "";
      this.changed();
      let ok = false;
      try { ok = (await this.handy.connect(key)) === window.Handy.ConnectResult.CONNECTED; } catch {}
      if (!ok) {
        this.status = quiet ? "idle" : "error";
        this.error = quiet ? "" : MSG.offline;
        this.save(false);
        this.changed();
        return false;
      }
      this.status = "connected";
      this.save(true);
      await this.readDevice();
      this.changed();
      if (this.raw) this.send();   // a script was waiting for the Handy
      return true;
    }

    async disconnect() {
      clearTimeout(this.timers.send);
      try { if (this.handy) await this.handy.disconnect(); } catch {}
      this.status = "idle";
      this.error = "";
      this.script = {status: "none", error: ""};
      this.save(false);
      this.changed();
    }

    // the stroke range and offset the Handy has now (firmware 3 and 3.2 have them)
    async readDevice() {
      const st = () => this.handy.getState() || {};
      this.fw = (st().info && st().info.fwVersion) || "";
      try { await this.handy.getStrokeZone(); } catch {}
      try { await this.handy.getOffset(); } catch {}
      const {slide, hstp} = st();
      if (slide && Number.isFinite(slide.min)) Object.assign(this.settings, {min: Math.round(slide.min), max: Math.round(slide.max)});
      if (hstp && Number.isFinite(hstp.offset)) this.settings.offset = hstp.offset;
    }

    // a change from the panel: the device's settings go to the Handy, the script's make it send the script again
    set(changes) {
      Object.assign(this.settings, changes);
      this.save();
      this.changed();
      if (!this.connected) return;
      const later = (name, ms, fn) => { clearTimeout(this.timers[name]); this.timers[name] = setTimeout(fn, ms); };
      if ("min" in changes || "max" in changes)
        later("zone", 250, () => this.handy.setStrokeZone({min: this.settings.min, max: this.settings.max}).catch(e => this.fail("Stroke range", e)));
      if ("offset" in changes)
        later("offset", 250, () => this.handy.setOffset(this.settings.offset).catch(e => this.fail("Sync offset", e)));
      if (("speed" in changes || "reverse" in changes) && this.raw) later("send", 400, () => this.send());
    }
    fail(what, e) {
      this.error = `${what} was not set on the Handy (${(e && e.message) || e}).`;
      this.changed();
    }

    shape(funscript) { return shape(funscript, this.settings); }

    // play this script in sync with the video (its playing, pausing and seeking drive the Handy); sent now if connected,
    // or as soon as the Handy connects
    async load(funscript, video) {
      this.raw = funscript;
      this.video = video || null;
      return this.connected ? this.send() : false;
    }
    unload() {
      this.raw = null;
      clearTimeout(this.timers.send);
      if (this.handy && this.connected) {
        try { this.handy.setVideoPlayer(null); } catch {}
        this.handy.hsspStop().catch(() => {});
      }
      this.video = null;
      this.script = {status: "none", error: ""};
      this.changed();
    }

    async send() {
      const raw = this.raw, video = this.video;
      this.script = {status: "sending", error: ""};
      this.changed();
      try {
        if (video) this.handy.setVideoPlayer(video);
        await this.handy.setScriptFromData(this.shape(raw));
        if (raw !== this.raw) return false;   // another script came in meanwhile
        if (video && !video.paused) await this.handy.hsspPlay(Math.round(video.currentTime * 1000));
        this.script = {status: "ready", error: ""};
        this.changed();
        return true;
      } catch (e) {
        this.script = {status: "error", error: `The script did not reach the Handy (${(e && e.message) || e}).`};
        this.changed();
        throw e;
      }
    }
  }

  const control = window.HandyControl = new Controller();
  control.shapeScript = shape;
  control.SPEED_OFF = SPEED_OFF;

  // ---------- <handy-control> ----------
  const GEAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';
  const CSS = `
    :host { display: inline-block; position: relative; font: inherit; color: var(--text, #EDEDEF); vertical-align: middle; }
    * { box-sizing: border-box; }
    button, input { font: inherit; }
    .hc { display: inline-flex; align-items: center; gap: 4px; background: var(--surface, #141416); border: 1px solid var(--line, rgba(255,255,255,.08)); border-radius: var(--radius-lg, 10px); padding: 4px 4px 4px 12px; }
    :host([bare]) .hc { background: transparent; border-color: transparent; }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--faint, #4A4A52); flex: none; }
    .connecting .dot { background: var(--warn, #C9922E); animation: pulse 1s ease-in-out infinite; }
    .connected .dot { background: var(--ok, #5FA97B); }
    .error .dot { background: var(--bad, #C9564B); }
    @keyframes pulse { 50% { opacity: .35; } }
    .key { width: 92px; background: transparent; border: none; color: var(--text, #EDEDEF); font-family: inherit; font-variant-numeric: tabular-nums; font-size: 13.5px; padding: 4px 0; outline: none; }
    .key::placeholder { color: var(--muted, #6E6E76); font-family: inherit; }
    .key:disabled { color: var(--dim, #A1A1A6); }
    button { cursor: pointer; border-radius: var(--radius, 6px); }
    .go { background: var(--accent, #F0703A); color: var(--on-accent, #1A0E08); border: 1px solid var(--accent, #F0703A); padding: 6px 10px; min-width: 100px; font-weight: 600; white-space: nowrap; }
    .go:disabled { opacity: .6; cursor: default; }
    .connected .go { background: transparent; color: var(--dim, #A1A1A6); border-color: var(--line-strong, rgba(255,255,255,.14)); font-weight: 500; }
    .connected .go:hover { color: var(--bad, #C9564B); border-color: var(--bad, #C9564B); }
    .gear { position: relative; width: 34px; height: 34px; display: grid; place-items: center; background: transparent; border: 1px solid transparent; color: var(--dim, #A1A1A6); padding: 0; }
    .gear:hover, .gear.on { color: var(--text, #EDEDEF); background: var(--raised, #1C1C1F); border-color: var(--line, rgba(255,255,255,.08)); }
    .gear svg { width: 18px; height: 18px; }
    .mod { position: absolute; right: 5px; top: 5px; width: 7px; height: 7px; border-radius: 50%; background: var(--accent, #F0703A); }
    :host([compact]) .hc .key, :host([compact]) .hc .go { display: none; }
    :host([compact]) .hc { padding-left: 10px; }
    .err { position: absolute; right: 0; top: calc(100% + 6px); z-index: 10; width: max-content; max-width: min(300px, 90vw); background: var(--overlay, #242428); color: var(--bad, #C9564B); border: 1px solid var(--line-strong, rgba(255,255,255,.14)); border-radius: var(--radius, 6px); box-shadow: var(--shadow-md, 0 6px 18px rgba(0,0,0,.45)); padding: 6px 10px; font-size: 12.5px; line-height: 1.4; cursor: pointer; }
    .err.up { top: auto; bottom: calc(100% + 6px); }
    :focus-visible { outline: 2px solid var(--accent, #F0703A); outline-offset: 2px; }

    .hs { position: fixed; inset: auto; margin: 0; width: 360px; max-width: calc(100vw - 16px); max-height: calc(100vh - 16px); overflow: auto; background: var(--overlay, #242428); border: 1px solid var(--line-strong, rgba(255,255,255,.14)); border-radius: var(--radius-lg, 10px); box-shadow: var(--shadow-lg, 0 12px 32px rgba(0,0,0,.55)); color: var(--text, #EDEDEF); padding: 14px 16px 12px; font-size: 14px; }
    .hs header { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
    .hs header b { flex: 1; font-size: 15px; }
    .state { font-size: 12px; color: var(--dim, #A1A1A6); display: flex; align-items: center; gap: 6px; text-align: right; }
    .state .dot { width: 7px; height: 7px; box-shadow: none; }
    .conn { display: none; gap: 6px; margin-bottom: 10px; }
    :host([compact]) .conn { display: flex; }
    .conn .key { flex: 1; width: auto; background: var(--surface, #141416); border: 1px solid var(--line, rgba(255,255,255,.08)); border-radius: var(--radius, 6px); padding: 6px 8px; }
    .row { padding: 10px 0; border-top: 1px solid var(--line, rgba(255,255,255,.08)); }
    .row.off { opacity: .5; }
    .lab { display: flex; align-items: center; gap: 8px; }
    .lab b { font-weight: 600; font-size: 13.5px; flex: 1; }
    .val { font-variant-numeric: tabular-nums; font-size: 13px; background: var(--raised, #1C1C1F); border-radius: var(--radius, 6px); padding: 1px 7px; }
    .val.none { color: var(--muted, #6E6E76); }
    .where { font-size: 12px; color: var(--muted, #6E6E76); border: 1px solid var(--line, rgba(255,255,255,.08)); border-radius: var(--radius-sm, 4px); padding: 0 7px; }
    .hint { font-size: 12px; color: var(--dim, #A1A1A6); margin-top: 3px; }
    input[type=range] { width: 100%; accent-color: var(--accent, #F0703A); margin: 8px 0 0; }
    .dual { position: relative; height: 26px; margin-top: 4px; }
    .dual .track { position: absolute; left: 8px; right: 8px; top: 12px; height: 4px; border-radius: 2px; background: var(--line-strong, rgba(255,255,255,.14)); }
    .dual .fill { position: absolute; top: 12px; height: 4px; border-radius: 2px; background: var(--accent, #F0703A); }
    .dual input { position: absolute; inset: 0; margin: 0; width: 100%; background: none; pointer-events: none; -webkit-appearance: none; appearance: none; }
    .dual input::-webkit-slider-thumb { pointer-events: auto; -webkit-appearance: none; width: 16px; height: 16px; border-radius: 50%; background: var(--text, #EDEDEF); border: 3px solid var(--accent, #F0703A); cursor: pointer; }
    .dual input::-moz-range-thumb { pointer-events: auto; width: 12px; height: 12px; border-radius: 50%; background: var(--text, #EDEDEF); border: 3px solid var(--accent, #F0703A); cursor: pointer; }
    .switch { position: relative; width: 38px; height: 22px; flex: none; }
    .switch input { opacity: 0; position: absolute; inset: 0; cursor: pointer; margin: 0; }
    .switch span { position: absolute; inset: 0; background: var(--line-strong, rgba(255,255,255,.14)); border-radius: 99px; transition: background .15s; pointer-events: none; }
    .switch span::after { content: ""; position: absolute; left: 3px; top: 3px; width: 16px; height: 16px; border-radius: 50%; background: var(--text, #EDEDEF); transition: transform .15s; }
    .switch input:checked + span { background: var(--accent, #F0703A); }
    .switch input:checked + span::after { transform: translateX(16px); background: var(--on-accent, #1A0E08); }
    .step { display: flex; align-items: center; gap: 6px; margin-top: 6px; }
    .step button { width: 28px; height: 26px; padding: 0; background: var(--raised, #1C1C1F); color: var(--text, #EDEDEF); border: 1px solid var(--line, rgba(255,255,255,.08)); }
    .step input { flex: 1; margin: 0; }
    .preview { padding-top: 10px; border-top: 1px solid var(--line, rgba(255,255,255,.08)); }
    .preview .lab { font-size: 12px; color: var(--dim, #A1A1A6); margin-bottom: 4px; gap: 12px; }
    .preview .lab span { display: inline-flex; align-items: center; gap: 5px; }
    .preview .lab span::before { content: ""; width: 14px; height: 2px; background: var(--muted, #6E6E76); }
    .preview .lab span.new::before { background: var(--accent, #F0703A); height: 3px; }
    .preview svg { width: 100%; height: 86px; display: block; background: var(--surface, #141416); border-radius: var(--radius, 6px); }
    .msg { font-size: 12.5px; margin-top: 8px; color: var(--bad, #C9564B); }
    .msg:empty { display: none; }
    footer { display: flex; gap: 8px; align-items: center; margin-top: 12px; }
    footer .note { flex: 1; font-size: 12px; color: var(--muted, #6E6E76); }
    footer button { padding: 5px 12px; background: var(--raised, #1C1C1F); color: var(--text, #EDEDEF); border: 1px solid var(--line, rgba(255,255,255,.08)); }
    footer button.primary { background: var(--accent, #F0703A); color: var(--on-accent, #1A0E08); border-color: var(--accent, #F0703A); font-weight: 600; }
  `;
  const PANEL = `
    <header><b>Handy settings</b><span class="state"><span class="dot"></span><span class="stxt"></span></span></header>
    <div class="conn"><input class="key ckey" placeholder="Handy key" spellcheck="false" autocomplete="off" aria-label="Handy connection key"><button class="go cgo"></button></div>
    <div class="row dev"><div class="lab"><b>Stroke range</b><span class="where">on the Handy</span><span class="val vrange"></span></div>
      <div class="dual"><div class="track"></div><div class="fill"></div>
        <input type="range" class="min" min="0" max="100" aria-label="Stroke range bottom"><input type="range" class="max" min="0" max="100" aria-label="Stroke range top"></div>
      <div class="hint">How much of the stroke the Handy uses: the script's 0 to 100 is fitted into this.</div></div>
    <div class="row"><div class="lab"><b>Speed limit</b><span class="where">in the script</span><span class="val vspeed"></span></div>
      <input type="range" class="speed" min="50" max="${SPEED_OFF}" step="10" aria-label="Speed limit">
      <div class="hint">Faster parts are slowed to this, so strokes there get shorter; far right is off.</div></div>
    <div class="row"><div class="lab"><b>Reverse</b><span class="where">in the script</span><label class="switch"><input type="checkbox" class="rev" aria-label="Reverse"><span></span></label></div>
      <div class="hint">Flips up and down.</div></div>
    <div class="row dev"><div class="lab"><b>Sync offset</b><span class="where">on the Handy</span><span class="val voff"></span></div>
      <div class="step"><button class="offm" aria-label="10 ms earlier">−</button><input type="range" class="off" min="-500" max="500" step="10" aria-label="Sync offset"><button class="offp" aria-label="10 ms later">+</button></div>
      <div class="hint">+ makes the strokes come later, − earlier.</div></div>
    <div class="preview"><div class="lab"><span>script</span><span class="new">what the Handy gets</span></div><svg class="pv" viewBox="0 0 320 86" preserveAspectRatio="none"></svg></div>
    <div class="msg"></div>
    <footer><span class="note"></span><button class="reset">Reset</button><button class="primary done">Done</button></footer>`;

  // a few seconds of the playing script for the preview (or a made-up one: slow strokes, then a fast run)
  function sample() {
    const acts = control.raw && control.raw.actions;
    if (acts && acts.length > 4) {
      const t0 = control.video ? control.video.currentTime * 1000 : acts[0].at;
      let i = Math.max(0, acts.findIndex(a => a.at >= t0) - 1);
      const part = acts.slice(i).filter(a => a.at <= acts[i].at + 9000);
      if (part.length > 4) return {actions: part, inverted: control.raw.inverted};
    }
    const out = [];
    for (let t = 0, i = 0; t <= 8000; i++) { out.push({at: t, pos: i % 2 ? 90 : 10}); t += t < 4200 ? 700 : 170; }
    return {actions: out};
  }

  class HandyControlElement extends HTMLElement {
    connectedCallback() {
      if (!this.shadowRoot) this.build();
      this.onChange = () => this.render();
      control.addEventListener("change", this.onChange);
      this.render();
    }
    disconnectedCallback() { control.removeEventListener("change", this.onChange); }

    build() {
      const root = this.attachShadow({mode: "open"});
      root.innerHTML = `<style>${CSS}</style>
        <div class="hc"><span class="dot"></span><input class="key bkey" placeholder="Handy key" spellcheck="false" autocomplete="off" aria-label="Handy connection key"><button class="go bgo"></button><button class="gear" aria-label="Handy settings" title="Handy settings" aria-haspopup="dialog">${GEAR}<i class="mod" hidden></i></button></div>
        <div class="err" hidden></div>
        <div class="hs" popover>${PANEL}</div>`;
      const $ = s => root.querySelector(s);
      this.$ = $;
      const go = input => () => control.connected ? control.disconnect() : control.connect(input.value);
      $(".bgo").onclick = go($(".bkey"));
      $(".cgo").onclick = go($(".ckey"));
      for (const k of [".bkey", ".ckey"]) $(k).onkeydown = e => { if (e.key === "Enter" && !control.connected) control.connect(e.target.value); };
      const panel = $(".hs");
      $(".gear").onclick = () => panel.togglePopover();
      panel.addEventListener("toggle", e => {
        $(".gear").classList.toggle("on", e.newState === "open");
        if (e.newState === "open") { this.place(); this.render(); }
      });
      addEventListener("resize", () => { if (panel.matches(":popover-open")) this.place(); });
      $(".done").onclick = () => panel.hidePopover();
      $(".err").onclick = () => { $(".err").hidden = true; };
      $(".reset").onclick = () => {
        control.set(control.connected ? {min: 0, max: 100, offset: 0, speed: SPEED_OFF, reverse: false} : {speed: SPEED_OFF, reverse: false});
      };
      $(".min").oninput = e => { const v = Math.min(+e.target.value, control.settings.max - 5); e.target.value = v; control.set({min: v}); };
      $(".max").oninput = e => { const v = Math.max(+e.target.value, control.settings.min + 5); e.target.value = v; control.set({max: v}); };
      $(".speed").oninput = e => control.set({speed: +e.target.value});
      $(".rev").onchange = e => control.set({reverse: e.target.checked});
      $(".off").oninput = e => control.set({offset: +e.target.value});
      $(".offm").onclick = () => control.set({offset: Math.max(-500, control.settings.offset - 10)});
      $(".offp").onclick = () => control.set({offset: Math.min(500, control.settings.offset + 10)});
    }

    // the panel under the gear, kept on screen (it sits in the top layer, so no parent clips it)
    place() {
      const panel = this.$(".hs"), r = this.$(".gear").getBoundingClientRect();
      const w = panel.offsetWidth, h = panel.offsetHeight;
      const left = Math.max(8, Math.min(r.right - w, innerWidth - w - 8));
      const top = r.bottom + 6 + h <= innerHeight - 8 ? r.bottom + 6 : Math.max(8, r.top - 6 - h);
      Object.assign(panel.style, {left: `${left}px`, top: `${top}px`});
    }

    render() {
      const $ = this.$, s = control.settings, st = control.status;
      if (!$) return;
      $(".hc").className = `hc ${st}`;
      for (const [k, g] of [[".bkey", ".bgo"], [".ckey", ".cgo"]]) {
        const key = $(k), btn = $(g);
        if (this.shadowRoot.activeElement !== key) key.value = control.key;
        key.disabled = st === "connected" || st === "connecting";
        btn.textContent = st === "connecting" ? "Connecting…" : st === "connected" ? "Disconnect" : "Connect";
        btn.disabled = st === "connecting";
      }
      $(".conn").className = `conn ${st}`;
      $(".mod").hidden = !control.changedFromDefaults;
      // an error shows as a bubble under the bar (it does not push the page down), until clicked or for 8 seconds; the
      // red dot stays until the next try
      const err = $(".err");
      if (control.error !== this.shownError) {
        this.shownError = control.error;
        clearTimeout(this.errTimer);
        err.hidden = this.hasAttribute("compact") || !control.error;
        err.textContent = control.error;
        err.classList.toggle("up", this.getBoundingClientRect().bottom + 90 > innerHeight);   // no room below (a player's bar)
        if (control.error) this.errTimer = setTimeout(() => { err.hidden = true; }, 8000);
      }
      // the panel
      const panelOpen = $(".hs").matches(":popover-open");
      $(".state .dot").style.background = st === "connected" ? "var(--ok, #5FA97B)" : st === "connecting" ? "var(--warn, #C9922E)" : "var(--faint, #4A4A52)";
      const sc = control.script.status;
      $(".stxt").textContent = st !== "connected" ? (st === "connecting" ? "Connecting…" : "Not connected")
        : sc === "sending" ? "Sending the script…" : sc === "ready" ? "Connected · script ready" : "Connected";
      for (const row of this.shadowRoot.querySelectorAll(".row.dev")) row.classList.toggle("off", st !== "connected");
      for (const i of this.shadowRoot.querySelectorAll(".row.dev input, .row.dev button")) i.disabled = st !== "connected";
      if (this.shadowRoot.activeElement !== $(".min")) $(".min").value = s.min;
      if (this.shadowRoot.activeElement !== $(".max")) $(".max").value = s.max;
      $(".vrange").textContent = `${s.min}% – ${s.max}%`;
      $(".fill").style.left = `calc(8px + (100% - 16px) * ${s.min / 100})`;
      $(".fill").style.width = `calc((100% - 16px) * ${(s.max - s.min) / 100})`;
      if (this.shadowRoot.activeElement !== $(".speed")) $(".speed").value = s.speed;
      $(".vspeed").textContent = s.speed >= SPEED_OFF ? "Off" : `${s.speed} /s`;
      $(".vspeed").className = `val vspeed${s.speed >= SPEED_OFF ? " none" : ""}`;
      $(".rev").checked = s.reverse;
      if (this.shadowRoot.activeElement !== $(".off")) $(".off").value = s.offset;
      $(".voff").textContent = `${s.offset > 0 ? "+" : s.offset < 0 ? "−" : ""}${Math.abs(s.offset)} ms`;
      $(".msg").textContent = control.script.error || control.error || "";
      $(".note").textContent = st === "connected" ? (control.raw ? "Changes apply to what's playing straight away" : "Changes apply to the next script")
        : "Stroke range and offset are set on the Handy, so connect first";
      if (panelOpen) this.preview();
    }

    preview() {
      const raw = sample(), got = control.shape(raw).actions, s = control.settings;
      const t0 = raw.actions[0].at, span = Math.max(1, raw.actions[raw.actions.length - 1].at - t0 + 1000);
      const x = t => 6 + (t - t0 + 500) / span * 308, y = p => 80 - p * 0.74;
      const line = acts => acts.map((a, i) => `${i ? "L" : "M"}${x(a.at).toFixed(1)},${y(a.pos).toFixed(1)}`).join("");
      const css = getComputedStyle(this);
      const v = (name, dflt) => css.getPropertyValue(name).trim() || dflt;
      const fitted = got.map(a => ({at: a.at + s.offset, pos: s.min + (s.max - s.min) * a.pos / 100}));
      this.$(".pv").innerHTML =
        `<rect x="6" y="${y(s.max)}" width="308" height="${(s.max - s.min) * 0.74}" fill="${v("--accent-quiet", "rgba(240,112,58,.14)")}"/>` +
        `<path d="${line(raw.actions)}" fill="none" stroke="${v("--muted", "#6E6E76")}" stroke-width="1.2" vector-effect="non-scaling-stroke"/>` +
        `<path d="${line(fitted)}" fill="none" stroke="${v("--accent", "#F0703A")}" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>`;
    }
  }
  if (!customElements.get("handy-control")) customElements.define("handy-control", HandyControlElement);
})();
