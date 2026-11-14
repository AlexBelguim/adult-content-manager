// The cinema: one video big, in its own format (stereo.js).
//   Screen      a large, slightly curved screen (part of a cylinder around the head: 3.2 m away, S 2.2 / M 3 / L 4.2 m
//               wide along the arc), with the controls bar under it. Flat 2D, or 3D side by side / over-under.
//   180 / 360   an equirectangular half or whole sphere centred on the head; Fisheye 190 / 200 (MKX200 style)
//   / Fisheye   likewise. The controls bar comes up on a trigger or any button and fades after a few seconds.
// It hangs in the stage, so Recentre puts it where the head looks (yaw and pitch, lying down too); the player never
// moves. The salon hides the band and the panel while it is open.
//
// The controls bar: play / pause, -10 s, +10 s, a seek bar you point at (click, or hold the trigger and drag along it),
// the time; sound on / off and a volume bar; the format menu (2D / side by side / over-under / swap eyes, and Screen /
// 180 / 360 / Fisheye: remembered per file); the screen size; Exit. Under it the Handy line: what the Handy does,
// VR's sync offset (-25 / +25 ms) and Pause the Handy (the video keeps playing).
import * as THREE from 'three';
import { C } from './palette';
import { DEG, clamp, makeButton, makeText, panel, fmtTime, fileName, disposeTree } from './kit';
import { buildVideoMeshes, screenGeometry, eyeAspect, formatFor, detectFormat, saveFormat, formatLabel, sameFormat } from './stereo';

const DIST = 3.2, SPHERE_R = 12;
export const SCREEN_SIZES = { s: 2.2, m: 3.0, l: 4.2 };
const SIZE_KEY = 'vr.screenSize';
const BW = 1.2, ROW = 0.062, BTN = { h: 0.058, size: 0.021, res: 2400, r: 0.012 };
const WAKE_MS = 4000;

function readSize() { try { const s = window.localStorage.getItem(SIZE_KEY); return SCREEN_SIZES[s] ? s : 'm'; } catch { return 'm'; } }
function writeSize(s) { try { window.localStorage.setItem(SIZE_KEY, s); } catch { /* storage blocked */ } }

const TONE = (t) => ({ ok: C.ok, warn: C.warn, bad: C.bad, text: C.text }[t] || C.dim);

export class Cinema {
  /**
   * ctx: { app, assets, player }. handy: the Handy sync (handySync.js). onExit(): Exit, B or Y.
   */
  constructor(ctx, stage, { handy, onExit }) {
    this.ctx = ctx; this.app = ctx.app; this.player = ctx.player; this.unit = ctx.assets.unitPlane;
    this.handy = handy; this.onExit = onExit;
    this.root = new THREE.Group(); this.root.name = 'cinema'; this.root.visible = false;
    stage.add(this.root);
    this.item = null; this.fmt = null; this.size = readSize();
    this.vid = null; this.vidKey = '';
    this.regs = [];
    this.wakeUntil = 0; this.barFade = 0; this.hovered = new Set();
    this.drag = null; this.lastLiveSeek = 0;
    this.menuOpen = false; this.menu = null;
    this.active = false;
    this.buildScreenParts();
    this.buildBar();
    // the trigger wakes the bar; letting go ends a drag on the seek / volume bar
    this.app.on('select', () => { if (this.active) this.wake(); });
    this.app.controllers.forEach((e) => this.app.listen(e.controller, 'selectend', () => { if (this.drag?.src === e) this.endDrag(); }));
    // the mouse: drag along the seek / volume bar (on a screen; the runtime would turn the drag into looking around)
    const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
    this.mouseRay = () => { ray.setFromCamera(ndc, this.app.camera); return ray.ray; };
    this.app.listen(window, 'pointerdown', (ev) => {
      if (!this.active || this.app.isXR() || !this.app.isActive() || ev.target !== this.app.canvas) return;
      this.app.toNDC(ev, ndc);
      const r = this.mouseRay();
      ray.set(r.origin, r.direction);
      for (const kind of ['seek', 'volume']) {
        const m = this.hits[kind];
        if (this.root.visible && this.bar.visible && ray.intersectObject(m, false).length) {
          ev.stopPropagation();
          this.startDrag(kind, 'mouse');
          return;
        }
      }
    }, { capture: true });
    this.app.listen(window, 'pointermove', (ev) => { if (this.drag?.src === 'mouse') { this.app.toNDC(ev, ndc); ev.stopPropagation(); } }, { capture: true });
    this.app.listen(window, 'pointerup', (ev) => { if (this.drag?.src === 'mouse') { ev.stopPropagation(); this.endDrag(); } }, { capture: true });
  }

  /** a pointer target; one on the bar (inBar) keeps the bar up while it is pointed at */
  reg(m, h, inBar = true) {
    this.app.pointer.add(m, inBar ? { ...h, onHover: (on, hit) => { if (on) this.hovered.add(m); else this.hovered.delete(m); h.onHover?.(on, hit); } } : h);
    this.regs.push(m);
    return m;
  }

  // ---------- the screen's fixed parts: an invisible hit surface (layer 0), the backdrop catcher ----------
  buildScreenParts() {
    this.screenHit = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide }));
    this.root.add(this.screenHit);
    this.reg(this.screenHit, { onClick: () => { if (this.fmt?.proj === 'flat') this.player.toggle(); else this.toggleBar(); this.wake(); } }, false);
    // around you (180 / 360): a click anywhere brings the bar up or puts it away
    this.backdrop = new THREE.Mesh(new THREE.SphereGeometry(20, 16, 8), new THREE.MeshBasicMaterial({ visible: false, side: THREE.BackSide }));
    this.backdrop.visible = false;
    this.root.add(this.backdrop);
    this.reg(this.backdrop, { onClick: () => this.toggleBar() }, false);
    this.frame = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: C.frame, side: THREE.DoubleSide, transparent: true, opacity: 0.9, depthWrite: false }));
    this.frame.renderOrder = -6;
    this.root.add(this.frame);
    this.loading = makeText('', { w: 1.2, h: 0.12, size: 0.06, align: 'center', color: C.dim, res: 1400 });
    this.loading.renderOrder = 3;
    this.root.add(this.loading);
  }

  // ---------- the controls bar ----------
  buildBar() {
    const g = new THREE.Group(); g.name = 'cinema-bar';
    this.bar = g; this.root.add(g);
    this.hits = {};
    const btn = (label, w, onClick, o = {}) => {
      const b = makeButton(label, { w, ...BTN, ...o });
      b.position.z = 0.003; g.add(b);
      this.reg(b, { onClick: () => { if (this.active) { this.wake(); onClick(); } } });
      return b;
    };
    const label = (w, o = {}) => { const t = makeText('', { w, h: ROW, size: o.size || 0.02, color: o.color || C.text, align: o.align || 'left', res: 2400, pad: 0.004, weight: o.weight || 500 }); t.position.z = 0.003; g.add(t); return t; };
    const pad = 0.018, gap = 0.01;
    const yT = 0.142, y1 = 0.072, y2 = 0, y3 = -0.08;
    const H = 0.36;
    const bg = panel(BW, H, { r: 0.02, color: C.bg, opacity: 0.88 });
    bg.position.set(0, 0.03, 0);
    g.add(bg);
    this.reg(bg, { onClick: () => this.wake() });
    const sep = new THREE.Mesh(this.unit, new THREE.MeshBasicMaterial({ color: C.line, transparent: true }));
    sep.scale.set(BW - 2 * pad, 0.002, 1); sep.position.set(0, -0.042, 0.002); g.add(sep);
    // title: the file and its format
    this.title = label(BW - 2 * pad, { size: 0.019, color: C.dim, weight: 600 });
    this.title.position.set(0, yT, 0.003);
    // row 1: play, -10, +10, seek bar, time
    let x = -BW / 2 + pad;
    const place = (o, w, y) => { o.position.x = x + w / 2; o.position.y = y; x += w + gap; };
    this.bPlay = btn('Pause', 0.12, () => this.player.toggle()); place(this.bPlay, 0.12, y1);
    const back = btn('−10 s', 0.1, () => this.player.seekBy(-10)); place(back, 0.1, y1);
    const fwd = btn('+10 s', 0.1, () => this.player.seekBy(10)); place(fwd, 0.1, y1);
    const timeW = 0.2, TW = BW / 2 - pad - timeW - gap - x;
    this.track = this.makeTrack('seek', x, y1, TW); x += TW + gap;
    this.time = label(timeW, { align: 'right', size: 0.02 }); place(this.time, timeW, y1);
    // row 2: sound, volume, format, size, exit
    x = -BW / 2 + pad;
    this.bMute = btn('Sound on', 0.14, () => this.player.setMuted(!this.player.muted)); place(this.bMute, 0.14, y2);
    this.vol = this.makeTrack('volume', x, y2, 0.15); x += 0.15 + gap;
    this.bFormat = btn('Format', 0.44, () => this.setMenu(!this.menuOpen), { align: 'left' }); place(this.bFormat, 0.44, y2);
    this.sizeLabel = label(0.05, { size: 0.017, color: C.muted, weight: 600 }); place(this.sizeLabel, 0.05, y2);
    this.sizeLabel.setText('Size');
    this.bSize = {};
    for (const s of ['s', 'm', 'l']) { const b = btn(s.toUpperCase(), 0.052, () => this.setSize(s)); place(b, 0.052, y2); this.bSize[s] = b; }
    const exitW = BW / 2 - pad - x;
    const exit = btn('Exit', exitW, () => this.onExit?.(), { base: C.action, hover: C.actionHover }); place(exit, exitW, y2);
    // row 3: the Handy
    x = -BW / 2 + pad;
    const hl = label(0.08, { size: 0.019, color: C.muted, weight: 600 }); place(hl, 0.08, y3); hl.setText('Handy');
    const rightW = 0.07 + 0.1 + 0.07 + 0.16 + 3 * gap;
    const lineW = BW - 2 * pad - 0.08 - gap - rightW - gap;
    this.handyLine = label(lineW, { size: 0.019 }); place(this.handyLine, lineW, y3);
    const m = btn('−25', 0.07, () => this.handy?.nudge(-1), { size: 0.019 }); place(m, 0.07, y3);
    this.offText = label(0.1, { align: 'center', size: 0.019 }); place(this.offText, 0.1, y3);
    const p = btn('+25', 0.07, () => this.handy?.nudge(1), { size: 0.019 }); place(p, 0.07, y3);
    this.bHold = btn('Pause Handy', 0.16, () => this.handy?.toggleHeld(), { size: 0.019 }); place(this.bHold, 0.16, y3);
    g.traverse((o) => { if (o.isMesh) o.renderOrder = Math.max(o.renderOrder, 30); });
    bg.renderOrder = 29;
  }

  /** a bar you point at: a wide invisible target, a rail, the filled part and a knob */
  makeTrack(kind, x0, y, w) {
    const g = this.bar, cx = x0 + w / 2;
    const hit = new THREE.Mesh(this.unit, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
    hit.scale.set(w, 0.06, 1); hit.position.set(cx, y, 0.004);
    const rail = new THREE.Mesh(this.unit, new THREE.MeshBasicMaterial({ color: C.line, transparent: true }));
    rail.scale.set(w, 0.01, 1); rail.position.set(cx, y, 0.003);
    const fill = new THREE.Mesh(this.unit, new THREE.MeshBasicMaterial({ color: C.accent, transparent: true }));
    fill.position.set(cx, y, 0.0035);
    const knob = new THREE.Mesh(new THREE.CircleGeometry(0.013, 20), new THREE.MeshBasicMaterial({ color: C.text, transparent: true }));
    knob.position.set(cx, y, 0.0038);
    const ghost = new THREE.Mesh(this.unit, new THREE.MeshBasicMaterial({ color: C.accentHover, transparent: true }));
    ghost.scale.set(0.004, 0.032, 1); ghost.position.set(cx, y, 0.0037); ghost.visible = false;
    g.add(hit, rail, fill, knob, ghost);
    const t = { kind, hit, fill, knob, ghost, x0, w, y };
    this.hits[kind] = hit;
    const moveGhost = (h) => { if (h?.uv && !this.drag) { ghost.visible = true; ghost.position.x = x0 + h.uv.x * w; } };
    this.reg(hit, {
      onClick: (h, src) => {
        if (!this.active) return;
        this.wake();
        if (src && !src.mouse && src.controller) { this.startDrag(kind, src); return; }
        if (h?.uv) this.applyTrack(kind, clamp(h.uv.x, 0, 1), true);
      },
      onHover: (on, h) => { if (on) moveGhost(h); else ghost.visible = false; },
      onMove: moveGhost,
    });
    return t;
  }
  setTrack(t, frac) {
    frac = clamp(frac, 0, 1);
    t.fill.scale.set(Math.max(0.0001, t.w * frac), 0.01, 1);
    t.fill.position.x = t.x0 + (t.w * frac) / 2;
    t.knob.position.x = t.x0 + t.w * frac;
  }
  applyTrack(kind, frac, final) {
    if (kind === 'volume') { this.player.setVolume(frac); return; }
    if (!this.player.duration) return;
    const now = performance.now();
    // a file as it is seeks live while you drag; a converted stream only where you let go (each seek restarts it)
    if (final || (this.player.item && /\.(mp4|webm|m4v)$/i.test(this.player.item.path) && now - this.lastLiveSeek > 200)) {
      this.lastLiveSeek = now; this.player.seek(frac);
    }
  }

  // ---------- dragging along a bar: the pointing ray against the bar's plane ----------
  startDrag(kind, src) { this.drag = { kind, src, frac: null }; this.wake(); }
  dragFrac() {
    const d = this.drag, m = this.hits[d.kind];
    let origin, dir;
    if (d.src === 'mouse') { const r = this.mouseRay(); origin = r.origin; dir = r.direction; }
    else {
      origin = d.src.controller.getWorldPosition(new THREE.Vector3());
      dir = new THREE.Vector3(0, 0, -1).applyQuaternion(d.src.controller.getWorldQuaternion(new THREE.Quaternion()));
    }
    m.updateMatrixWorld();
    const n = new THREE.Vector3(0, 0, 1).transformDirection(m.matrixWorld);
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, m.getWorldPosition(new THREE.Vector3()));
    const p = new THREE.Ray(origin, dir).intersectPlane(plane, new THREE.Vector3());
    if (!p) return d.frac;
    return clamp(m.worldToLocal(p).x + 0.5, 0, 1);
  }
  endDrag() {
    const d = this.drag; this.drag = null;
    if (!d) return;
    const f = d.frac ?? this.dragFrac();
    if (f != null) this.applyTrack(d.kind, f, true);
  }

  // ---------- the format menu ----------
  setMenu(on) {
    this.menuOpen = !!on;
    if (this.menu) { for (const m of this.menu.regs) this.app.pointer.remove(m); disposeTree(this.menu.g); this.menu.g.parent?.remove(this.menu.g); this.menu = null; }
    if (!this.menuOpen || !this.fmt) return;
    const g = new THREE.Group(); g.name = 'format-menu';
    const regs = [];
    const f = this.fmt, auto = detectFormat(this.item?.name || this.item?.path);
    const W = 0.86, pad = 0.018, gap = 0.008, LW = 0.12;
    let y = -pad;
    const rows = [
      ['Stereo', [['2D', { layout: 'mono', swap: false }], ['Side by side', { layout: 'sbs' }], ['Over-under', { layout: 'tb' }], ['Swap eyes', { swap: !f.swap }, f.swap]]],
      ['View', [['Screen', { proj: 'flat' }], ['180°', { proj: '180' }], ['360°', { proj: '360' }], ['Fisheye 190', { proj: 'fisheye', fov: 190 }], ['Fisheye 200', { proj: 'fisheye', fov: 200 }]]],
    ];
    for (const [rl, opts] of rows) {
      const lab = makeText(rl, { w: LW, h: 0.056, size: 0.019, color: C.muted, weight: 600, res: 2400, pad: 0 });
      lab.position.set(-W / 2 + pad + LW / 2, y - 0.028, 0.003); g.add(lab);
      const avail = W - 2 * pad - LW, n = opts.length, bw = (avail - gap * (n - 1)) / n, rowY = y - 0.029;
      opts.forEach(([text, patch, act], i) => {
        const active = act ?? Object.entries(patch).every(([k, v]) => (k === 'swap' ? !!f.swap === v : f[k] === v));
        const b = makeButton(text, { w: bw, ...BTN, size: 0.019 });
        b.setActive(rl === 'Stereo' && text === 'Swap eyes' ? f.swap : active);
        b.position.set(-W / 2 + pad + LW + bw / 2 + i * (bw + gap), rowY, 0.003);
        g.add(b);
        const disabled = text === 'Swap eyes' && f.layout === 'mono';
        if (disabled) b.label.material.opacity = 0.4;
        this.app.pointer.add(b, { onClick: () => { if (!disabled) this.setFormat(patch); } }); regs.push(b);
      });
      y -= 0.058 + gap;
    }
    const note = makeText('', { w: W - 2 * pad - 0.3, h: 0.05, size: 0.017, color: C.dim, res: 2400, pad: 0 });
    note.setText(auto.detected ? `From the name (${auto.why.join(', ')}): ${formatLabel(auto)}` : 'Nothing in the name: 2D on the screen');
    note.position.set(-W / 2 + pad + (W - 2 * pad - 0.3) / 2, y - 0.03, 0.003); g.add(note);
    const reset = makeButton('Use the name', { w: 0.17, ...BTN, size: 0.017 });
    reset.position.set(W / 2 - pad - 0.17 / 2 - 0.12 - gap, y - 0.03, 0.003); g.add(reset);
    this.app.pointer.add(reset, { onClick: () => { saveFormat(this.item.path, null); this.applyFormat(auto); this.setMenu(true); } }); regs.push(reset);
    const done = makeButton('Done', { w: 0.12, ...BTN, size: 0.018, base: C.action, hover: C.actionHover });
    done.position.set(W / 2 - pad - 0.06, y - 0.03, 0.003); g.add(done);
    this.app.pointer.add(done, { onClick: () => this.setMenu(false) }); regs.push(done);
    y -= 0.058 + pad;
    const H = -y;
    const bg = panel(W, H, { r: 0.02, color: C.surface, opacity: 0.97 });
    bg.position.set(0, -H / 2, 0); g.add(bg);
    this.app.pointer.add(bg, { onClick: () => this.wake() }); regs.push(bg);
    g.children.forEach((o) => { o.position.y += H; });
    g.traverse((o) => { if (o.isMesh) o.renderOrder = Math.max(o.renderOrder, 34); });
    bg.renderOrder = 33;
    g.position.set(0, 0.03 + 0.18 + 0.02, 0.01); // just above the bar
    this.bar.add(g);
    this.menu = { g, regs };
  }
  /** change the format (a patch of it) and remember it for this file */
  setFormat(patch) {
    const f = { ...this.fmt, ...patch };
    if (f.layout === 'mono') f.swap = false;
    if (f.proj !== 'fisheye') f.fov = 180;
    saveFormat(this.item.path, sameFormat(f, detectFormat(this.item.name || this.item.path)) ? null : f);
    this.applyFormat(f);
    this.setMenu(true);
  }
  applyFormat(f) { this.fmt = f; this.vidKey = ''; this.placeBar(); }

  setSize(s) { if (!SCREEN_SIZES[s] || s === this.size) return; this.size = s; writeSize(s); this.vidKey = ''; this.placeBar(); }

  // ---------- open / close ----------
  /** play `item` here. The player may already play it (from the viewer): then it simply carries on. */
  open(item, { format = null } = {}) {
    this.item = item;
    this.fmt = format || formatFor(item.path, item.name);
    this.active = true; this.root.visible = true;
    if (this.player.item !== item) this.player.open(item);
    this.vidKey = '';
    this.wake();
    this.placeBar();
  }
  close() {
    this.active = false; this.root.visible = false;
    this.setMenu(false);
    this.drag = null; this.hovered.clear();
    if (this.vid) { this.vid.dispose(); this.vid = null; }
    this.vidKey = ''; this.item = null;
  }
  get around() { return !!this.fmt && this.fmt.proj !== 'flat'; }

  wake() { this.wakeUntil = performance.now() + WAKE_MS; }
  toggleBar() { if (this.barFade > 0.5 && this.around) this.wakeUntil = 0; else this.wake(); }

  /** where the bar hangs: under the screen, or low in front when you are inside the picture */
  placeBar() {
    if (!this.fmt) return;
    let pitch = -26 * DEG;
    if (!this.around) {
      const { h } = this.screenDims();
      // its top just under the screen's lower edge (the bar is close, so it would cover the picture otherwise)
      pitch = clamp(-Math.atan2(h / 2, DIST) - 11 * DEG, -38 * DEG, -22 * DEG);
    }
    const d = 1.25;
    this.bar.position.set(0, Math.sin(pitch) * d, -Math.cos(pitch) * d);
    this.bar.rotation.set(pitch, 0, 0);
    this.loading.position.set(0, 0, -(this.around ? 3 : DIST - 0.05));
  }
  aspect() { return eyeAspect(this.fmt, this.player.width, this.player.height); }
  /** the screen's width (along the arc) and height: the size's width, or less for a tall picture (at most 2/3 as high) */
  screenDims() {
    const a = this.aspect(), W = SCREEN_SIZES[this.size], maxH = W * 0.66;
    const h = Math.min(W / a, maxH);
    return { w: h * a, h };
  }

  /** rebuild the picture's meshes when the format, the size or the video's shape changed */
  syncMeshes() {
    const tex = this.player.texture;
    const key = tex ? `${this.fmt.layout}|${this.fmt.swap}|${this.fmt.proj}|${this.fmt.fov}|${this.size}|${this.player.width}x${this.player.height}` : '';
    if (key === this.vidKey && (this.vid?.tex === tex)) return;
    this.vidKey = key;
    if (this.vid) { this.vid.dispose(); this.vid = null; }
    const flat = this.fmt.proj === 'flat';
    this.backdrop.visible = !flat;
    if (!tex) { this.screenHit.visible = false; this.frame.visible = false; return; }
    const { w } = this.screenDims(), a = this.aspect();
    this.vid = buildVideoMeshes(tex, this.fmt, { width: w, aspect: a, dist: DIST, radius: SPHERE_R });
    this.vid.tex = tex;
    this.root.add(this.vid.group);
    this.screenHit.geometry.dispose(); this.frame.geometry.dispose();
    if (flat) {
      this.screenHit.geometry = screenGeometry(w, a, DIST);
      const fw = w + 0.06, fh = w / a + 0.06;
      this.frame.geometry = screenGeometry(fw, fw / fh, DIST + 0.03);
    } else {
      this.screenHit.geometry = new THREE.BufferGeometry();
      this.frame.geometry = new THREE.BufferGeometry();
    }
    this.screenHit.visible = flat; this.frame.visible = flat;
    this.placeBar();
  }

  /** the right stick in the headset: -10 / +10 s steps */
  stick(x, t) {
    if (Math.abs(x) > 0.65) {
      if (!this.held) { this.held = Math.sign(x); this.nextAt = t + 0.5; this.player.seekBy(10 * this.held); this.wake(); }
      else if (t > this.nextAt) { this.nextAt = t + 0.35; this.player.seekBy(10 * this.held); this.wake(); }
    } else if (Math.abs(x) < 0.3) this.held = 0;
  }

  update(dt) {
    if (!this.active) return;
    const p = this.player;
    this.syncMeshes();
    const now = performance.now();
    // the bar: always under a screen; around you it shows on a trigger or a button and fades after a few seconds
    if (this.hovered.size || this.drag || this.menuOpen || this.pinned) this.wake();
    const want = !this.around || now < this.wakeUntil ? 1 : 0;
    this.barFade += (want - this.barFade) * (1 - Math.exp(-dt * (want ? 12 : 5)));
    if (Math.abs(want - this.barFade) < 0.01) this.barFade = want;
    this.bar.visible = this.barFade > 0.02;
    if (this.bar.visible) {
      const op = this.barFade;
      this.bar.traverse((o) => { if (o.material && !o.material.userData.keepOpacity) { if (o.material.userData.op0 == null) o.material.userData.op0 = o.material.opacity; o.material.opacity = o.material.userData.op0 * op; o.material.transparent = true; } });
    }
    // the picture
    const loading = !p.ready && !p.failed;
    this.loading.visible = loading || p.failed;
    this.loading.setText(p.failed ? 'This video did not play' : 'Loading…', p.failed ? C.bad : C.dim);
    // the bar's contents
    const name = this.item?.name || fileName(this.item?.path);
    this.title.setText([{ t: name, c: C.text, w: 600 }, { t: `   ${formatLabel(this.fmt)}`, c: C.dim }]);
    this.bPlay.setLabel(p.paused ? 'Play' : 'Pause');
    this.bMute.setLabel(p.muted ? 'Muted' : 'Sound on');
    if (this.drag) {
      const f = this.dragFrac();
      if (f != null) { this.drag.frac = f; this.applyTrack(this.drag.kind, f, false); }
    }
    if (this.drag) { this.track.ghost.visible = false; this.vol.ghost.visible = false; }
    const dragSeek = this.drag?.kind === 'seek' ? this.drag.frac : null;
    const frac = dragSeek ?? (p.duration ? p.time / p.duration : 0);
    this.setTrack(this.track, frac);
    this.setTrack(this.vol, this.drag?.kind === 'volume' && this.drag.frac != null ? this.drag.frac : p.muted ? 0 : p.volume);
    const shownT = dragSeek != null ? dragSeek * p.duration : p.time;
    this.time.setText(p.duration ? `${fmtTime(shownT)} / ${fmtTime(p.duration)}` : fmtTime(shownT));
    this.bFormat.setLabel(`Format   ${formatLabel(this.fmt)}`);
    this.bFormat.setActive(this.menuOpen);
    for (const [s, b] of Object.entries(this.bSize)) b.setActive(s === this.size);
    const sizeVis = !this.around;
    for (const b of Object.values(this.bSize)) b.visible = sizeVis;
    this.sizeLabel.visible = sizeVis;
    // the Handy
    const h = this.handy?.status() || { text: 'The Handy control did not load', tone: 'dim' };
    this.handyLine.setText(h.text, TONE(h.tone));
    const off = this.handy?.offset || 0;
    this.offText.setText(`${off > 0 ? '+' : off < 0 ? '−' : ''}${Math.abs(off)} ms`, off ? C.text : C.dim);
    this.bHold.setLabel(this.handy?.held ? 'Handy paused' : 'Pause Handy');
    this.bHold.setActive(!!this.handy?.held);
  }

  dispose() {
    this.close();
    for (const m of this.regs) this.app.pointer.remove(m);
    disposeTree(this.root, new Set([this.unit]));
    this.root.parent?.remove(this.root);
  }
}
