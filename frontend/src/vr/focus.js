// Her pictures as a half circle around you with ONE in focus: big, straight ahead, close.
// The others hang along the arc, smaller, farther and dimmer toward the sides; off-centre they stack in columns of
// 2 and 3 (salon style, true aspect). Moving the focus slides the arc (280 ms). Two uses:
//   decide: true   triage: Keep / Delete / Undo buttons and throw hints; a decided picture flies up (keep) or down
//   decide: false  the plain viewer: ‹ Close ›
// A video in focus plays on the focus plane (ctx.player), with a control strip: play / pause, a scrub bar you point
// at, the time and a sound toggle.
import * as THREE from 'three';
import { C, rgba } from './palette';
import { DEG, clamp, lerp, easeOut, easeInOut, canvasPlane, text, rrect, makeButton, makeText, panel, fmtTime, disposeTree } from './kit';

export const FOCUS = { dist: 1.45, h: 1.1, maxW: 1.55, pitch: -3 * DEG };
// columns outward from the focus, per side: k = pieces stacked, h = each piece's height, dist = distance
const SLOTS = [
  { k: 1, h: 0.66, dist: 1.85 }, { k: 1, h: 0.56, dist: 2.0 },
  { k: 2, h: 0.36, dist: 2.15 }, { k: 2, h: 0.33, dist: 2.25 },
  { k: 3, h: 0.24, dist: 2.35 },
];
const GAP = 0.02, EDGE = 96 * DEG, MOVE_MS = 280;
const SMALL = 384, BIG = 1536;

/** target poses for every item that hangs on the arc when list[f] is in focus */
export function arcLayout(list, f) {
  const out = new Map();
  const it = list[f];
  if (!it) return out;
  const asp = (x) => x.aspect || 0.75;
  let h = FOCUS.h, w = h * asp(it);
  if (w > FOCUS.maxW) { w = FOCUS.maxW; h = w / asp(it); }
  out.set(it, { yaw: 0, pitch: FOCUS.pitch, dist: FOCUS.dist, w, h, b: 1, op: 1, focus: true, rel: 0 });
  const half0 = Math.atan2(w / 2, FOCUS.dist);
  for (const side of [1, -1]) {
    let ang = half0 + 1.6 * DEG, i = f + side, si = 0;
    while (i >= 0 && i < list.length && ang < EDGE) {
      const slot = SLOTS[Math.min(si, SLOTS.length - 1)]; si++;
      const group = [];
      for (let j = 0; j < slot.k && i >= 0 && i < list.length; j++) { group.push(list[i]); i += side; }
      const ws = group.map((g) => Math.min(slot.h * asp(g), slot.h * 1.6));
      const hs = group.map((g, j) => ws[j] / asp(g));
      const colW = Math.max(...ws), total = hs.reduce((a, b) => a + b, 0) + GAP * (hs.length - 1);
      const aw = 2 * Math.atan2(colW / 2, slot.dist);
      const yaw = side * (ang + aw / 2);
      const centreY = slot.dist * Math.tan(FOCUS.pitch);
      let top = centreY + total / 2;
      group.forEach((g, j) => {
        const vc = top - hs[j] / 2;
        const ay = Math.abs(yaw);
        out.set(g, {
          yaw, pitch: Math.atan2(vc, slot.dist), dist: slot.dist, w: ws[j], h: hs[j],
          b: clamp(0.82 - 0.46 * (ay / (90 * DEG)), 0.3, 0.82), op: clamp((EDGE + 4 * DEG - ay) / (14 * DEG), 0, 1), rel: list.indexOf(g) - f,
        });
        top -= hs[j] + GAP;
      });
      ang += aw + GAP / slot.dist;
    }
  }
  return out;
}

const lerpPose = (a, b, t) => ({ yaw: lerp(a.yaw, b.yaw, t), pitch: lerp(a.pitch, b.pitch, t), dist: lerp(a.dist, b.dist, t), w: lerp(a.w, b.w, t), h: lerp(a.h, b.h, t), b: lerp(a.b, b.b, t), op: lerp(a.op, b.op, t) });

export class FocusView {
  /** ctx: { app, tex, assets, player }. decide: true = triage; false = the plain viewer */
  constructor(ctx, parent, { title, onPick, onAction, decide = true }) {
    this.ctx = ctx; this.app = ctx.app; this.player = ctx.player; this.unit = ctx.assets.unitPlane;
    this.decide = decide; this.onPick = onPick; this.onAction = onAction;
    this.root = new THREE.Group(); this.root.name = 'focus-view';
    parent.add(this.root);
    this.nodes = new Map();
    this.list = []; this.f = 0;
    this.fade = 0; this.depth = 1.14; this.grabY = 0;
    this.outline = new THREE.Mesh(this.unit, new THREE.MeshBasicMaterial({ color: C.accent, transparent: true, opacity: 0, depthWrite: false }));
    // her name above the focus, status and buttons below it
    this.title = canvasPlane(1.2, 0.07, { density: 1400 });
    this.place(this.title, 25.5 * DEG, 1.5);
    this.setTitle(title);
    this.status = canvasPlane(1.1, 0.06, { density: 1400 });
    this.place(this.status, -26.2 * DEG, 1.42);
    this.bar = new THREE.Group();
    this.place(this.bar, -30.6 * DEG, 1.4);
    const B = (label, w, o = {}) => makeButton(label, { w, h: 0.07, size: 0.026, res: 1800, r: 0.016, ...o });
    this.btn = decide ? {
      prev: B('‹', 0.08, { size: 0.044 }),
      keep: B('Keep   A', 0.19, { base: C.keep, hover: C.keepHover, textColor: C.keepText }),
      del: B('Delete   B', 0.19, { base: C.del, hover: C.delHover, textColor: C.delText }),
      undo: B('Undo   X', 0.16),
      next: B('›', 0.08, { size: 0.044 }),
    } : { prev: B('‹', 0.1, { size: 0.044 }), close: B('Close   B', 0.2), next: B('›', 0.1, { size: 0.044 }) };
    let x = -0.39;
    for (const [k, b] of Object.entries(this.btn)) {
      const bw = b.userData.w;
      b.position.x = x + bw / 2; x += bw + 0.016; this.bar.add(b);
      this.app.pointer.add(b, { onClick: () => { if (!this.dead) this.onAction?.(k); } });
    }
    this.bar.children.forEach((b) => { b.position.x -= (x - 0.016 - 0.39) / 2; });
    // grab hints: above = keep, below = delete
    const hint = (label, tone, fg) => {
      const m = canvasPlane(0.5, 0.08, { density: 1400 });
      m.draw((c, s, w, h) => { rrect(c, s, 0, 0, w, h, 0.03, rgba(tone, 0.22)); text(c, s, label, { x: w / 2, y: h / 2, size: 0.032, weight: 600, align: 'center', color: fg }); });
      return m;
    };
    this.keepHint = hint('Throw up: keep', C.ok, C.keepText);
    this.delHint = hint('Throw down: delete', C.bad, C.delText);
    this.place(this.keepHint, 23 * DEG, 1.42); this.place(this.delHint, -27 * DEG, 1.4);
    this.keepHint.position.z += 0.05; this.delHint.position.z += 0.05;
    this.keepHint.material.opacity = this.delHint.material.opacity = 0;
    this.strip = null; this.videoItem = null; this.videoAt = 0;
  }

  place(obj, pitch, dist) {
    obj.position.set(0, Math.sin(pitch) * dist, -Math.cos(pitch) * dist);
    obj.rotation.set(pitch, 0, 0);
    this.root.add(obj);
  }

  get current() { return this.list[this.f] || null; }

  setTitle(str) {
    this.title.draw((c, s, w, h) => { text(c, s, str, { x: w / 2, y: h / 2, size: 0.042, weight: 600, align: 'center', color: C.dim, maxW: w }); });
  }

  /** a new list (after a filter, a sort or a decision); keep `keepItem` in focus if it is still there */
  setList(list, keepItem = null, { instant = false } = {}) {
    this.list = list;
    const k = keepItem ? list.indexOf(keepItem) : -1;
    this.f = clamp(k >= 0 ? k : this.f, 0, Math.max(0, list.length - 1));
    this.relayout(instant);
  }
  setFocus(f, { instant = false } = {}) {
    f = clamp(f, 0, this.list.length - 1);
    if (f === this.f && !instant) return false;
    this.f = f; this.relayout(instant); return true;
  }
  step(d) { return this.setFocus(this.f + d); }

  relayout(instant) {
    const target = arcLayout(this.list, this.f);
    const now = performance.now();
    for (const [it, pose] of target) {
      let n = this.nodes.get(it);
      if (!n) {
        n = this.makeNode(it);
        const out = Math.sign(pose.yaw || 1) * 10 * DEG;
        n.cur = { ...pose, yaw: pose.yaw + out, op: 0 };
      }
      n.from = n.cur; n.to = pose; n.t0 = instant ? now - MOVE_MS : now; n.leaving = false; n.ms = MOVE_MS;
      n.focus = !!pose.focus;
    }
    for (const [it, n] of this.nodes) {
      if (target.has(it) || n.leaving) continue;
      // leaving: decided ones fly up (keep) or down (delete); the rest slide out to the side
      const d = it.decision;
      const to = d === 'delete' ? { ...n.cur, pitch: n.cur.pitch - 22 * DEG, op: 0 }
        : d === 'keep' && Math.abs(n.cur.yaw) < 0.3 ? { ...n.cur, pitch: n.cur.pitch + 22 * DEG, op: 0 }
          : { ...n.cur, yaw: n.cur.yaw + Math.sign(n.cur.yaw || 1) * 10 * DEG, op: 0 };
      n.from = n.cur; n.to = to; n.t0 = instant ? now - 1000 : now; n.leaving = true; n.focus = false; n.ms = d ? 420 : MOVE_MS;
    }
    this.loadTextures();
    this.syncVideo(instant);
  }

  makeNode(it) {
    const g = new THREE.Group();
    this.root.add(g);
    const pic = new THREE.Mesh(this.unit, new THREE.MeshBasicMaterial({ color: C.raised, transparent: true }));
    g.add(pic);
    const n = { item: it, group: g, pic, hov: 0, on: false, loaded: false };
    if (it.video) {
      n.play = new THREE.Mesh(this.unit, new THREE.MeshBasicMaterial({ map: this.ctx.assets.playMark(), transparent: true, depthWrite: false }));
      n.play.position.z = 0.004; n.play.renderOrder = 2; g.add(n.play);
    }
    n.mark = new THREE.Mesh(this.unit, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }));
    n.mark.position.z = 0.006; n.mark.visible = false; n.mark.renderOrder = 3; g.add(n.mark);
    this.app.pointer.add(pic, {
      onHover: (on) => { n.on = on; },
      onClick: () => { if (this.dead || n.leaving) return; const i = this.list.indexOf(it); if (i >= 0) this.onPick?.(i, n.focus); },
    });
    this.nodes.set(it, n);
    return n;
  }

  // ---------- textures: small ones along the arc, a big one for the focus ----------
  loadTextures() {
    const tex = this.ctx.tex;
    for (const [it, n] of this.nodes) {
      if (!it.src) continue;
      const rel = Math.abs(this.list.indexOf(it) - this.f);
      const inList = this.list.includes(it);
      if (!n.small && !n.leaving && inList) {
        n.small = true;
        tex.acquire(it.src, SMALL).then((t) => {
          if (this.dead || !n.small) return;
          n.smallTex = t;
          // a video's poster tells its true shape (filter lists do not)
          if (it.video && !it.aspectKnown && t.userData.aspect) this.fixAspect(it, t.userData.aspect);
          if (!n.bigTex && !n.videoOn) this.setMap(n, t);
        }).catch(() => {});
      }
      const wantBig = n.focus && !it.video;
      if (wantBig && !n.big) {
        n.big = true;
        tex.acquire(it.src, BIG).then((t) => { if (this.dead || !n.big) return; n.bigTex = t; this.setMap(n, t); }).catch(() => {});
      } else if (!n.focus && n.big && rel > 1) {
        n.big = false; n.bigTex = null;
        tex.release(it.src, BIG);
        if (n.smallTex) this.setMap(n, n.smallTex);
      }
      if ((!inList || rel > 70) && !n.leaving) this.dropNode(it, n);
    }
  }
  setMap(n, t) { n.pic.material.map = t; n.pic.material.needsUpdate = true; n.loaded = true; }
  dropNode(it, n) {
    if (this.videoItem === it) this.stopVideo();
    this.app.pointer.remove(n.pic);
    if (n.small && it.src) this.ctx.tex.release(it.src, SMALL);
    if (n.big && it.src) this.ctx.tex.release(it.src, BIG);
    n.small = n.big = false;
    n.pic.material.dispose(); n.mark.material.dispose(); n.play?.material.dispose();
    this.root.remove(n.group);
    this.nodes.delete(it);
  }
  /** an item's true aspect became known: lay the arc out again */
  fixAspect(it, a) {
    it.aspectKnown = true;
    if (Math.abs(a - (it.aspect || 0.75)) / a < 0.03) return;
    it.aspect = a;
    if (this.nodes.has(it) && !this.dead) this.relayout(false);
  }

  // ---------- the video in focus ----------
  /** after the focus settles on a video, play it there; leaving it stops it */
  syncVideo(instant) {
    const it = this.current;
    const want = it && it.video ? it : null;
    if (this.videoItem && this.videoItem !== want) this.stopVideo();
    if (want && this.videoItem !== want) { this.videoItem = want; this.videoAt = performance.now() + (instant ? 0 : MOVE_MS); this.videoOpened = false; }
  }
  stopVideo() {
    const it = this.videoItem;
    this.videoItem = null; this.videoOpened = false;
    if (this.player.item === it) this.player.close();
    const n = it && this.nodes.get(it);
    if (n) { n.videoOn = false; if (n.smallTex) this.setMap(n, n.smallTex); else { n.pic.material.map = null; n.pic.material.needsUpdate = true; n.loaded = false; } }
    this.removeStrip();
  }
  togglePlay() { if (this.videoItem && this.videoOpened) this.player.toggle(); }

  buildStrip(n, w) {
    this.removeStrip();
    const W = clamp(w - 0.04, 0.5, 1.0), H = 0.088;
    const g = new THREE.Group();
    const bg = panel(W, H, { r: 0.014, color: C.bg, opacity: 0.74 });
    g.add(bg);
    const reg = [];
    const btn = (label, bw, onClick) => {
      const b = makeButton(label, { w: bw, h: 0.064, size: 0.023, res: 2200, r: 0.014 });
      b.position.z = 0.002; g.add(b);
      this.app.pointer.add(b, { onClick: () => { if (!this.dead) onClick(); } }); reg.push(b);
      return b;
    };
    const play = btn('Pause', 0.12, () => this.player.toggle());
    const mute = btn('Sound on', 0.15, () => this.player.setMuted(!this.player.muted));
    const time = makeText('0:00', { w: 0.19, h: 0.06, size: 0.021, color: C.text, align: 'center', res: 2200 });
    time.position.z = 0.002; g.add(time);
    const pad = 0.012, gap = 0.012;
    const TW = W - 2 * pad - 0.12 - 0.15 - 0.19 - 3 * gap;
    let x = -W / 2 + pad;
    play.position.x = x + 0.06; x += 0.12 + gap;
    const tx = x + TW / 2; x += TW + gap;
    time.position.x = x + 0.095; x += 0.19 + gap;
    mute.position.x = x + 0.075;
    // the scrub bar: a wide invisible target, a thin rail, the played part, a knob and a hover marker
    const hitM = new THREE.Mesh(this.unit, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
    hitM.scale.set(TW, 0.07, 1); hitM.position.set(tx, 0, 0.003);
    const rail = new THREE.Mesh(this.unit, new THREE.MeshBasicMaterial({ color: C.line, transparent: true }));
    rail.scale.set(TW, 0.01, 1); rail.position.set(tx, 0, 0.002);
    const fill = new THREE.Mesh(this.unit, new THREE.MeshBasicMaterial({ color: C.accent, transparent: true }));
    fill.position.set(tx, 0, 0.0025);
    const knob = new THREE.Mesh(new THREE.CircleGeometry(0.013, 20), new THREE.MeshBasicMaterial({ color: C.text, transparent: true }));
    knob.position.z = 0.003;
    const ghost = new THREE.Mesh(this.unit, new THREE.MeshBasicMaterial({ color: C.accentHover, transparent: true }));
    ghost.scale.set(0.004, 0.03, 1); ghost.position.z = 0.0028; ghost.visible = false;
    g.add(hitM, rail, fill, knob, ghost);
    const moveGhost = (hit) => { if (hit?.uv) { ghost.visible = true; ghost.position.x = tx - TW / 2 + hit.uv.x * TW; } };
    this.app.pointer.add(hitM, {
      onClick: (hit) => { if (!this.dead && hit?.uv) this.player.seek(clamp(hit.uv.x, 0, 1)); },
      onHover: (on, hit) => { if (on) moveGhost(hit); else ghost.visible = false; },
      onMove: moveGhost,
    });
    reg.push(hitM);
    g.renderOrder = 5; g.traverse((o) => { o.renderOrder = 5; });
    n.group.add(g);
    this.strip = { g, n, w, H, TW, tx, play, mute, time, fill, knob, reg };
  }
  removeStrip() {
    const s = this.strip;
    if (!s) return;
    this.strip = null;
    for (const m of s.reg) this.app.pointer.remove(m);
    s.g.parent?.remove(s.g);
    disposeTree(s.g, new Set([this.unit]));
  }
  updateVideo(op) {
    const it = this.videoItem;
    if (!it) return;
    const n = this.nodes.get(it);
    if (!n) return;
    if (!this.videoOpened && performance.now() >= this.videoAt && n.focus && !this.dead) {
      this.videoOpened = true;
      this.player.open(it);
      this.buildStrip(n, n.to.w);
    }
    if (!this.videoOpened) return;
    const p = this.player;
    if (p.ready && !n.videoOn && p.texture) { n.videoOn = true; this.setMap(n, p.texture); }
    if (n.play) n.play.visible = !(n.videoOn && !p.paused);
    if (this.strip && Math.abs(this.strip.w - n.to.w) > 0.02) this.buildStrip(n, n.to.w); // its true shape came in
    const s = this.strip;
    if (!s) return;
    s.g.position.set(0, -n.cur.h / 2 + s.H / 2 + 0.018, 0.008);
    const frac = p.duration ? clamp(p.time / p.duration, 0, 1) : 0;
    s.fill.scale.set(Math.max(0.0001, s.TW * frac), 0.01, 1);
    s.fill.position.x = s.tx - s.TW / 2 + (s.TW * frac) / 2;
    s.knob.position.x = s.tx - s.TW / 2 + s.TW * frac;
    s.play.setLabel(p.paused ? 'Play' : 'Pause');
    s.mute.setLabel(p.muted ? 'Muted' : 'Sound on');
    s.time.setText(p.duration ? `${fmtTime(p.time)} / ${fmtTime(p.duration)}` : fmtTime(p.time));
    s.g.traverse((o) => { if (o.material) { o.material.transparent = true; if (o.material.userData.op0 == null) o.material.userData.op0 = o.material.opacity; o.material.opacity = o.material.userData.op0 * op; } });
  }

  enter(ms = 320) { this.fade = 0; this.depth = 1.14; this.tw = { t0: performance.now(), ms, f0: 0, f1: 1, d0: 1.14, d1: 1 }; }
  leave(ms = 300) {
    this.dead = true;
    this.stopVideo();
    this.tw = { t0: performance.now(), ms, f0: this.fade, f1: 0, d0: this.depth, d1: 1.22, done: () => this.dispose() };
  }

  update(dt, { hoverOK = true, fadeMul = 1 } = {}) {
    if (this.disposed) return;
    const now = performance.now();
    if (this.tw) {
      const t = clamp((now - this.tw.t0) / this.tw.ms, 0, 1), e = easeInOut(t);
      this.fade = lerp(this.tw.f0, this.tw.f1, e); this.depth = lerp(this.tw.d0, this.tw.d1, easeOut(t));
      if (t >= 1) { const d = this.tw.done; this.tw = null; if (d) { d(); return; } }
    }
    const k = 1 - Math.exp(-dt * 14);
    let best = null;
    const tmp = new THREE.Euler(0, 0, 0, 'YXZ');
    for (const [it, n] of this.nodes) {
      const t = clamp((now - n.t0) / n.ms, 0, 1);
      n.cur = lerpPose(n.from, n.to, n.leaving ? easeInOut(t) : easeOut(t));
      if (n.leaving && t >= 1) { n.group.visible = false; if (!this.list.includes(it)) this.dropNode(it, n); continue; }
      const p = n.cur;
      n.hov += ((hoverOK && n.on && !n.leaving && !this.dead ? 1 : 0) - n.hov) * k;
      const lift = n.focus ? 0 : 0.07 * n.hov;
      const d = p.dist * this.depth - lift;
      const g = n.group;
      g.position.set(Math.sin(p.yaw) * Math.cos(p.pitch) * d, Math.sin(p.pitch) * d, -Math.cos(p.yaw) * Math.cos(p.pitch) * d);
      if (n.focus) g.position.y += this.grabY;
      tmp.set(p.pitch, -p.yaw, 0); g.quaternion.setFromEuler(tmp);
      n.pic.scale.set(p.w, p.h, 1);
      const op = p.op * this.fade * fadeMul;
      g.visible = op > 0.004;
      n.pic.material.opacity = op;
      const bright = Math.min(1, p.b + (n.focus ? 0 : 0.18 * n.hov)) * (it.decision === 'delete' ? 0.5 : 1);
      if (n.loaded) n.pic.material.color.setScalar(n.videoOn ? 1 : bright); else n.pic.material.color.set(C.raised);
      if (n.play) { const s = Math.min(0.22, 0.34 * Math.min(p.w, p.h)); n.play.scale.set(s, s, 1); n.play.material.opacity = op; }
      const dec = it.decision;
      n.mark.visible = !!dec;
      if (dec) {
        if (n.mark.userData.kind !== dec) { n.mark.material.map = this.ctx.assets.icon(dec); n.mark.material.needsUpdate = true; n.mark.userData.kind = dec; }
        const ms = clamp(0.2 * Math.min(p.w, p.h), 0.05, 0.13);
        n.mark.scale.set(ms, ms, 1); n.mark.position.set(p.w / 2 - ms * 0.62, p.h / 2 - ms * 0.62, 0.006);
        n.mark.material.opacity = op * (it.pending ? 0.5 : 1);
      }
      if (!n.focus && n.hov > 0.02 && (!best || n.hov > best.hov)) best = n;
    }
    if (best) {
      if (this.outline.parent !== best.group) best.group.add(this.outline);
      this.outline.scale.set(best.cur.w + 0.014, best.cur.h + 0.014, 1); this.outline.position.z = -0.003;
      this.outline.material.opacity = best.hov * best.cur.op * this.fade;
    } else if (this.outline.parent) this.outline.parent.remove(this.outline);
    this.updateVideo(this.fade * fadeMul);
    for (const m of [this.title, this.status]) m.material.opacity = this.fade * fadeMul;
    this.bar.visible = this.fade > 0.05;
    this.bar.traverse((o) => { if (o.material) { o.material.transparent = true; o.material.opacity = this.fade * fadeMul; } });
    const gy = this.grabY;
    this.keepHint.material.opacity = this.fade * clamp(gy / 0.12, 0, 1);
    this.delHint.material.opacity = this.fade * clamp(-gy / 0.12, 0, 1);
  }

  setStatus(str) {
    this.status.draw((c, s, w, h) => { text(c, s, str, { x: w / 2, y: h / 2, size: 0.032, weight: 500, align: 'center', color: C.dim, maxW: w }); });
  }

  dispose() {
    if (this.disposed) return;
    this.dead = true; this.disposed = true;
    this.stopVideo();
    for (const [it, n] of [...this.nodes]) this.dropNode(it, n);
    for (const b of Object.values(this.btn)) this.app.pointer.remove(b);
    this.outline.parent?.remove(this.outline);
    this.outline.material.dispose();
    disposeTree(this.root, new Set([this.unit]));
    this.root.parent?.remove(this.root);
  }
}
