// The band: one continuous strip of three equal rows that wraps around you (pitch -20..+20 deg at 2.6 m).
// Used for the library (framed performer portraits, genre tiles) and for her pictures (a gallery).
// It moves, the player never does: grab it and pull sideways (1:1 with the hand's angle), let go with a flick for
// momentum, or scroll with the stick; the ends spring back. Only pieces near the view are built and textured, and
// textures far behind you are released again, so a long library costs no more than what is around you.
import * as THREE from 'three';
import { C, rgba } from './palette';
import { DEG, clamp, easeInOut, easeOut, canvasPlane, text, measure, rrect, picGlyph, playGlyph, plural } from './kit';
import { R, SHAPES, mapPiece } from './layout';

export const BAND = { p0: -20 * DEG, p1: 20 * DEG, rows: 3 };
const SHOW = 112 * DEG, EDGE_IN = 84 * DEG;   // pieces fade out between these yaws
const LOAD = 150 * DEG, DROP = 240 * DEG;     // textures load inside LOAD, are released beyond DROP
const LIFT = 0.08;

/** rows (nominal v ranges) for a shape: three rows of equal angular height */
export function bandRows(shape, gap) {
  const S = SHAPES[shape], out = [];
  for (let k = 0; k < BAND.rows; k++) {
    const a = BAND.p1 - ((BAND.p1 - BAND.p0) * k) / BAND.rows, b = BAND.p1 - ((BAND.p1 - BAND.p0) * (k + 1)) / BAND.rows;
    out.push({ v1: S.vOf(a) - (k ? gap / 2 : 0), v0: S.vOf(b) + (k < BAND.rows - 1 ? gap / 2 : 0) });
  }
  return out;
}

/** place items along the band: each goes to the row that is shortest so far (true aspect, one height per row) */
export function packBand(items, { shape, gap, maxAspect = 1.9 }) {
  const rows = bandRows(shape, gap), cursor = rows.map(() => 0), out = [];
  items.forEach((it, index) => {
    let r = 0; for (let k = 1; k < rows.length; k++) if (cursor[k] < cursor[r] - 0.001) r = k;
    const row = rows[r], h = row.v1 - row.v0, a = Math.min(it.aspect || 0.75, maxAspect);
    const w = h * a;
    out.push({ item: it, index, row: r, u: cursor[r] + w / 2, v: (row.v0 + row.v1) / 2, w, h, vTop: row.v1, vBot: row.v0 });
    cursor[r] += w + gap;
  });
  return { pieces: out, length: Math.max(0, ...cursor) - gap };
}

export class Band {
  /**
   * ctx: { app, tex, assets }. kind: 'performers' | 'genres' | 'pictures';
   * items: [{ aspect, src?: { kind, path }, perf?, genre?, video?, sub? }].
   * onPick(piece) is called for a tap (trigger pressed and released without dragging).
   */
  constructor(ctx, parent, { kind, items, shape = 'dome', onPick, startIndex = 0 }) {
    this.ctx = ctx; this.app = ctx.app; this.kind = kind; this.items = items; this.shape = shape; this.onPick = onPick;
    this.unit = ctx.assets.unitPlane;
    this.gap = kind === 'pictures' ? 0.022 : 0.06;
    const { pieces, length } = packBand(items, { shape, gap: this.gap, maxAspect: kind === 'genres' ? 1.4 : 1.9 });
    this.length = length;
    this.pieces = pieces.map((pc) => ({ ...pc, hov: 0, on: false, built: false }));
    this.root = new THREE.Group(); this.root.name = `band-${kind}`;
    this.strip = new THREE.Group(); this.root.add(this.strip);
    parent.add(this.root);
    this.fade = 0; this.depth = 1.14;
    // scroll range: the band starts 50 deg to the left; a short band is simply centred
    const lead = 50 * DEG * R;
    if (length < 2 * lead) { this.min = this.max = length / 2; } else { this.min = lead; this.max = length - lead; }
    const at = this.pieces[clamp(startIndex, 0, this.pieces.length - 1)];
    this.scroll = clamp(at ? at.u : this.min, this.min, this.max);
    this.vel = 0; this.drag = null; this.samples = [];
    this.outline = new THREE.Mesh(this.unit, new THREE.MeshBasicMaterial({ color: C.accent, transparent: true, opacity: 0, depthWrite: false }));
    this.outline.renderOrder = 1;
    // the slim position bar under the band (not scrolled)
    this.bar = canvasPlane(0.7, 0.05, { density: 1400 });
    this.bar.renderOrder = 4;
    const bp = -24.5 * DEG, bd = 2.2;
    this.bar.position.set(0, Math.sin(bp) * bd, -Math.cos(bp) * bd); this.bar.rotation.set(bp, 0, 0);
    this.root.add(this.bar);
    this.barKey = '';
  }

  get count() { return this.items.length; }
  get scrollable() { return this.max > this.min; }
  /** 0..1 through the band */
  get progress() { return this.scrollable ? clamp((this.scroll - this.min) / (this.max - this.min), 0, 1) : 0; }
  pickables() { return this.pieces.filter((p) => p.built && p.group.visible).map((p) => p.pic); }

  // ---------- building pieces lazily, when they come near the view ----------
  build(pc) {
    const m = mapPiece(pc, this.shape);
    const g = new THREE.Group();
    const dir = new THREE.Vector3(Math.sin(m.yaw) * Math.cos(m.pitch), Math.sin(m.pitch), -Math.cos(m.yaw) * Math.cos(m.pitch));
    g.quaternion.setFromEuler(new THREE.Euler(m.pitch, -m.yaw, 0, 'YXZ'));
    this.strip.add(g);
    Object.assign(pc, { group: g, dir, dist: m.dist, yaw: m.yaw, pw: m.w, ph: m.h, built: true, loaded: false });
    const it = pc.item;
    let pic;
    if (it.genre) {
      pic = canvasPlane(m.w, m.h, { density: 900, depthWrite: true });
      pic.draw((c, s, w, h) => {
        const gr = c.createLinearGradient(0, 0, w * s, h * s);
        gr.addColorStop(0, C.tileTop); gr.addColorStop(1, C.tileBottom);
        c.fillStyle = gr; c.fillRect(0, 0, w * s, h * s);
        c.fillStyle = C.accent; c.fillRect(0.045 * s, (h / 2 - 0.125) * s, 0.06 * s, 0.006 * s);
        text(c, s, it.genre.name, { x: 0.045, y: h / 2 - 0.045, size: 0.08, weight: 600, maxW: w - 0.09, minSize: 0.06 });
        text(c, s, `${plural(it.genre.pics || 0, 'picture')} · ${plural(it.genre.vids || 0, 'video')}`, { x: 0.045, y: h / 2 + 0.05, size: 0.055, color: C.dim, maxW: w - 0.09 });
      });
      pc.loaded = true; pc.canvas = true;
    } else {
      pic = new THREE.Mesh(this.unit, new THREE.MeshBasicMaterial({ color: C.raised, transparent: true }));
      pic.scale.set(m.w, m.h, 1);
    }
    g.add(pic); pc.pic = pic;
    if (it.perf) { // framed portrait: soft glow behind, dark frame with a warm rim, name plaque on the frame
      const b = 0.014;
      const glow = new THREE.Mesh(this.unit, new THREE.MeshBasicMaterial({ map: this.ctx.assets.glow(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      glow.scale.set(m.w * 1.5 + 0.3, m.h * 1.3 + 0.3, 1); glow.position.set(0, m.h * 0.06, -0.03); glow.renderOrder = -2;
      const frame = new THREE.Mesh(this.unit, new THREE.MeshBasicMaterial({ color: C.frame, transparent: true }));
      frame.scale.set(m.w + 2 * b, m.h + 2 * b, 1); frame.position.z = -0.006;
      const rim = new THREE.Mesh(this.unit, new THREE.MeshBasicMaterial({ color: C.rim, transparent: true }));
      rim.scale.set(m.w + 2 * b + 0.006, m.h + 2 * b + 0.006, 1); rim.position.z = -0.008;
      g.add(glow, frame, rim); Object.assign(pc, { glow, frame, rim });
      const pad = 0.026, line2 = it.sub || 'counts';
      const nameW = measure(it.perf.name, { size: 0.06, weight: 600 });
      const countsW = line2 === 'counts' ? 0.034 * 1.2 * 2 + 0.024 + 0.03 + measure(`${it.perf.pics_count || 0}${it.perf.vids_count || 0}`, { size: 0.055 }) : measure(line2, { size: 0.055 });
      const pw = Math.min(m.w - 0.03, Math.max(nameW, countsW) + 2 * pad), ph = 0.15;
      const cap = canvasPlane(pw, ph, { density: 1100 });
      cap.draw((c, s, w, h) => {
        rrect(c, s, 0.002, 0.002, w - 0.004, h - 0.004, 0.012, rgba(C.bg, 0.9), rgba(C.text, 0.08), 0.002);
        text(c, s, it.perf.name, { x: pad, y: h / 2 - 0.03, size: 0.06, weight: 600, maxW: w - 2 * pad, minSize: 0.055 });
        const y = h / 2 + 0.034;
        if (line2 === 'counts') {
          let x = pad; const gl = 0.032;
          x += picGlyph(c, s, x, y, gl, C.dim) + 0.012;
          x += text(c, s, String(it.perf.pics_count || 0), { x, y, size: 0.055, color: C.dim }) + 0.03;
          x += playGlyph(c, s, x, y, gl, C.dim) + 0.012;
          text(c, s, String(it.perf.vids_count || 0), { x, y, size: 0.055, color: C.dim });
        } else text(c, s, line2, { x: pad, y, size: 0.055, color: C.accent, maxW: w - 2 * pad });
      });
      cap.geometry.translate(0, ph / 2, 0); // anchored at its bottom centre, so it can grow on hover
      cap.position.set(0, -m.h / 2 + 0.018, 0.004);
      cap.renderOrder = 2; g.add(cap); pc.cap = cap;
    }
    if (it.video) {
      const s = Math.min(0.18, 0.34 * Math.min(m.w, m.h));
      const pm = new THREE.Mesh(this.unit, new THREE.MeshBasicMaterial({ map: this.ctx.assets.playMark(), transparent: true, depthWrite: false }));
      pm.scale.set(s, s, 1); pm.position.z = 0.004; pm.renderOrder = 2; g.add(pm); pc.play = pm;
    }
    pic.userData.bandPiece = pc;
    this.app.pointer.add(pic, {
      onHover: (on) => { pc.on = on; },
      onClick: (hit, src) => { if (!this.dead) this.onPress?.(pc, src); },
    });
  }

  // ---------- textures ----------
  texMax(pc) { return pc.ph > 0.5 ? 512 : 384; }
  loadPiece(pc) {
    pc.want = { src: pc.item.src, max: this.texMax(pc) };
    const want = pc.want;
    this.ctx.tex.acquire(want.src, want.max).then((t) => {
      if (this.dead || pc.want !== want) return;
      let map = t;
      const a = t.userData.aspect, b = pc.pw / pc.ph;
      if (Math.abs(a - b) / b > 0.03) { // the aspect was a guess or capped: crop to the slot
        map = t.clone(); map.userData = { ...t.userData };
        map.wrapS = map.wrapT = THREE.ClampToEdgeWrapping;
        if (a > b) { map.repeat.set(b / a, 1); map.offset.set((1 - b / a) / 2, 0); } else { map.repeat.set(1, a / b); map.offset.set(0, (1 - a / b) / 2); }
        map.needsUpdate = true; pc.ownMap = map;
      }
      pc.pic.material.map = map; pc.pic.material.needsUpdate = true; pc.loaded = true;
    }).catch(() => {});
  }
  unloadPiece(pc) {
    const want = pc.want;
    pc.want = null; pc.loaded = false;
    pc.pic.material.map = null; pc.pic.material.needsUpdate = true;
    if (pc.ownMap) { pc.ownMap.dispose(); pc.ownMap = null; }
    if (want) this.ctx.tex.release(want.src, want.max);
  }

  // ---------- moving it ----------
  /** start a grab at the hand's yaw (radians, in the stage's frame) */
  beginDrag(yaw) { this.drag = { y0: yaw, s0: this.scroll, last: yaw }; this.vel = 0; this.samples = [{ t: performance.now(), s: this.scroll }]; }
  dragTo(yaw) {
    if (!this.drag) return;
    let d = yaw - this.drag.last; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
    this.drag.last += d;
    let s = this.drag.s0 - (this.drag.last - this.drag.y0) * R; // 1:1 with the hand's angle at the band
    if (s < this.min) s = this.min - (this.min - s) * 0.35; else if (s > this.max) s = this.max + (s - this.max) * 0.35; // resist past the ends
    this.scroll = s;
    const now = performance.now();
    this.samples.push({ t: now, s }); while (this.samples.length > 2 && now - this.samples[0].t > 120) this.samples.shift();
  }
  /** let go: the flick speed carries on and eases out */
  endDrag() {
    if (!this.drag) return;
    const s = this.samples, a = s[0], b = s[s.length - 1];
    this.vel = s.length > 1 && b.t - a.t > 10 ? clamp((b.s - a.s) / ((b.t - a.t) / 1000), -12, 12) : 0;
    this.drag = null;
  }
  get dragged() { return this.drag ? Math.abs(this.drag.last - this.drag.y0) : 0; }
  /** the stick: smooth scrolling (x in -1..1) */
  stick(dt, x) {
    if (!x || this.drag) return;
    this.vel = 0;
    this.scroll = clamp(this.scroll + x * Math.abs(x) * 40 * DEG * R * dt, this.min - 0.15, this.max + 0.15);
  }
  pieceOf(index) { return this.pieces[index] || null; }
  /** the item nearest the middle of the view */
  nearestIndex() { let best = 0, d = Infinity; for (const pc of this.pieces) { const x = Math.abs(pc.u - this.scroll); if (x < d) { d = x; best = pc.index; } } return best; }

  // ---------- coming and going ----------
  enter(ms = 320) { this.tw = { t0: performance.now(), ms, f0: 0, f1: 1, d0: 1.14, d1: 1 }; this.fade = 0; this.depth = 1.14; }
  leave(ms = 300) { this.dead = true; this.tw = { t0: performance.now(), ms, f0: this.fade, f1: 0, d0: this.depth, d1: 1.22, done: () => this.dispose() }; }

  update(dt, { hoverOK = true, fadeMul = 1 } = {}) {
    if (this.disposed) return;
    if (this.tw) {
      const t = clamp((performance.now() - this.tw.t0) / this.tw.ms, 0, 1);
      this.fade = this.tw.f0 + (this.tw.f1 - this.tw.f0) * easeInOut(t);
      this.depth = this.tw.d0 + (this.tw.d1 - this.tw.d0) * easeOut(t);
      if (t >= 1) { const d = this.tw.done; this.tw = null; if (d) { d(); return; } }
    }
    // momentum and the springy ends
    if (!this.drag) {
      if (this.vel) { this.scroll += this.vel * dt; this.vel *= Math.exp(-dt * 3.2); if (Math.abs(this.vel) < 0.02) this.vel = 0; }
      const lim = clamp(this.scroll, this.min, this.max);
      if (lim !== this.scroll) { this.vel *= Math.exp(-dt * 12); this.scroll += (lim - this.scroll) * (1 - Math.exp(-dt * 9)); }
    }
    const off = -this.scroll / R;
    this.strip.rotation.y = -off;
    const k = 1 - Math.exp(-dt * 14);
    let best = null;
    for (const pc of this.pieces) {
      const wy = pc.u / R + off, ay = Math.abs(wy);
      if (ay < LOAD && !pc.built && !this.dead) this.build(pc);
      if (!pc.built) continue;
      if (pc.item.src && !pc.canvas) {
        if (ay < LOAD && !pc.want && !this.dead) this.loadPiece(pc);
        else if (ay > DROP && pc.want) this.unloadPiece(pc);
      }
      const op = this.fade * fadeMul * clamp((SHOW - ay) / (SHOW - EDGE_IN), 0, 1);
      pc.group.visible = op > 0.004;
      if (!pc.group.visible) { pc.hov = 0; continue; }
      const want = hoverOK && !this.drag && !this.dead && pc.on ? 1 : 0;
      pc.hov += (want - pc.hov) * k; if (pc.hov < 0.001) pc.hov = 0;
      pc.group.position.copy(pc.dir).multiplyScalar(pc.dist * this.depth - LIFT * pc.hov);
      const mat = pc.pic.material;
      mat.opacity = op;
      if (pc.loaded) mat.color.setScalar(0.86 + 0.14 * pc.hov); else mat.color.set(C.raised);
      if (pc.frame) { pc.frame.material.opacity = op; pc.rim.material.opacity = op; pc.glow.material.opacity = op * (0.24 + 0.5 * pc.hov); }
      if (pc.cap) { pc.cap.material.opacity = op; const s = 1 + 0.16 * pc.hov; pc.cap.scale.set(s, s, 1); }
      if (pc.play) pc.play.material.opacity = op;
      if (pc.hov > 0.02 && (!best || pc.hov > best.hov)) best = pc;
    }
    if (best) {
      if (this.outline.parent !== best.group) best.group.add(this.outline);
      const e = best.frame ? 0.02 : 0.007;
      this.outline.scale.set(best.pw + 2 * e, best.ph + 2 * e, 1); this.outline.position.z = best.frame ? -0.007 : -0.003;
      this.outline.material.opacity = best.hov * best.pic.material.opacity;
    } else if (this.outline.parent) this.outline.parent.remove(this.outline);
    this.updateBar();
  }

  updateBar() {
    this.bar.visible = this.scrollable && this.fade > 0.01;
    this.bar.material.opacity = this.fade;
    if (!this.bar.visible) return;
    const key = this.progress.toFixed(3);
    if (key === this.barKey) return;
    this.barKey = key;
    const span = (2 * EDGE_IN * R) / Math.max(this.length, 2 * EDGE_IN * R); // share of the band in view
    this.bar.draw((c, s, w, h) => {
      const x0 = 0.03, bw = w - 0.06, by = h / 2 - 0.004;
      rrect(c, s, x0, by, bw, 0.008, 0.004, rgba(C.line, 0.9));
      const seg = clamp(span, 0.06, 1) * bw;
      rrect(c, s, x0 + this.progress * (bw - seg), by, seg, 0.008, 0.004, C.accent);
    });
  }

  dispose() {
    if (this.disposed) return;
    this.dead = true; this.disposed = true;
    for (const pc of this.pieces) {
      if (!pc.built) continue;
      this.app.pointer.remove(pc.pic);
      if (pc.want) this.unloadPiece(pc);
      for (const o of [pc.pic, pc.cap, pc.frame, pc.rim, pc.glow, pc.play]) {
        if (!o) continue;
        if (o.userData.canvasTex) o.userData.canvasTex.dispose();
        if (o.geometry !== this.unit) o.geometry.dispose();
        o.material.dispose();
      }
    }
    this.bar.userData.canvasTex.dispose(); this.bar.material.dispose(); this.bar.geometry.dispose();
    this.outline.material.dispose();
    this.root.parent?.remove(this.root);
  }
}
