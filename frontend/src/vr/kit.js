// VR building blocks: maths and easing, the app's font on canvases, canvas planes with text drawn in metres, rounded
// panels, text labels and buttons with hover / active states. Colours come from palette.js (C), read at scene start.
import * as THREE from 'three';
import { C } from './palette';

export const DEG = Math.PI / 180;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const easeOut = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
export const easeInOut = (t) => { t = clamp(t, 0, 1); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
export const fileName = (s) => String(s || '').split(/[\\/]/).pop();
export const fmtTime = (s) => {
  if (!Number.isFinite(s) || s < 0) return '0:00';
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = Math.floor(s % 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${m}:${String(ss).padStart(2, '0')}`;
};

// ---------- the app's font (index.html loads it; the theme names it) ----------
const FALLBACK_FONT = '"Inter","Roboto","Helvetica","Arial",sans-serif';
let FONT = FALLBACK_FONT;
/** read the app's font family from <body> and wait until its weights are ready (at most 2.5 s), so canvas text
 *  is drawn in it and not in a fallback */
export async function loadFonts() {
  try {
    const fam = window.getComputedStyle(document.body).fontFamily;
    if (fam) FONT = fam;
  } catch { /* keep the fallback */ }
  const loads = [400, 500, 600, 700].map((w) => (document.fonts?.load ? document.fonts.load(`${w} 24px ${FONT}`).catch(() => null) : null));
  const ready = Promise.all(loads).then(() => document.fonts?.ready);
  await Promise.race([ready, new Promise((r) => setTimeout(r, 2500))]);
}
const font = (weight, px) => `${weight} ${px}px ${FONT}`;

// ---------- canvas planes ----------
/** a plane with a canvas texture at `density` px per metre; mesh.draw((ctx, s, w, h) => ...) repaints (s = px per metre) */
export function canvasPlane(w, h, { density = 1600, depthWrite = false } = {}) {
  const cw = Math.max(4, Math.round(w * density)), ch = Math.max(4, Math.round(h * density));
  const canvas = document.createElement('canvas');
  canvas.width = cw; canvas.height = ch;
  const ctx = canvas.getContext('2d');
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite }));
  mesh.draw = (fn) => { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cw, ch); fn(ctx, density, w, h); t.needsUpdate = true; return mesh; };
  mesh.userData.canvasTex = t;
  mesh.userData.w = w; mesh.userData.h = h;
  return mesh;
}

/** text in metres (x, y from the canvas's top left; y is the middle of the line); shrinks to minSize, then ellipsis */
export function text(ctx, s, str, { x = 0, y = 0, size = 0.02, weight = 500, color = C.text, align = 'left', maxW = null, minSize = null } = {}) {
  let px = size * s;
  const min = (minSize ?? size) * s;
  ctx.font = font(weight, px);
  let t = String(str ?? '');
  if (maxW) {
    const mw = maxW * s;
    while (px > min && ctx.measureText(t).width > mw) { px = Math.max(min, px * 0.95); ctx.font = font(weight, px); }
    while (t.length > 1 && ctx.measureText(t).width > mw) t = `${t.slice(0, -2).trimEnd()}…`;
  }
  ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'middle';
  ctx.fillText(t, x * s, y * s);
  return ctx.measureText(t).width / s;
}
let mctx = null;
export function measure(str, { size = 0.02, weight = 500 } = {}) {
  if (!mctx) mctx = document.createElement('canvas').getContext('2d');
  mctx.font = font(weight, size * 1000);
  return mctx.measureText(String(str)).width / 1000;
}
export function rrect(ctx, s, x, y, w, h, r, fill, stroke = null, lw = 0.002) {
  ctx.beginPath(); ctx.roundRect(x * s, y * s, w * s, h * s, Array.isArray(r) ? r.map((v) => v * s) : r * s);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw * s; ctx.stroke(); }
}
/** a small picture glyph (frame + hill) of height h at x, centred on y; returns its width */
export function picGlyph(ctx, s, x, y, h, color) {
  const w = h * 1.2;
  ctx.save(); ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = h * 0.13 * s; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.roundRect(x * s, (y - h / 2) * s, w * s, h * s, h * 0.18 * s); ctx.stroke();
  ctx.beginPath(); ctx.moveTo((x + w * 0.15) * s, (y + h * 0.32) * s); ctx.lineTo((x + w * 0.42) * s, (y - h * 0.05) * s);
  ctx.lineTo((x + w * 0.62) * s, (y + h * 0.18) * s); ctx.lineTo((x + w * 0.85) * s, (y + h * 0.32) * s); ctx.closePath(); ctx.fill();
  ctx.restore();
  return w;
}
/** a play triangle of height h; returns its width */
export function playGlyph(ctx, s, x, y, h, color) {
  ctx.save(); ctx.fillStyle = color; ctx.beginPath();
  ctx.moveTo(x * s, (y - h / 2) * s); ctx.lineTo((x + h * 0.9) * s, y * s); ctx.lineTo(x * s, (y + h / 2) * s); ctx.closePath(); ctx.fill();
  ctx.restore();
  return h * 0.9;
}

// ---------- rounded panels, labels, buttons ----------
function roundedShape(w, h, r) {
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  r = Math.min(r, w / 2, h / 2);
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}
/** a rounded rectangle geometry with uvs 0..1 across it (so an image can fill it) */
export function roundedGeometry(w, h, r = 0.02) {
  const g = new THREE.ShapeGeometry(roundedShape(w, h, r), 6);
  const uv = g.attributes.uv, pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / w + 0.5, pos.getY(i) / h + 0.5);
  return g;
}

/** a rounded panel */
export function panel(w, h, { r = 0.02, color = C.surface, opacity = 1 } = {}) {
  return new THREE.Mesh(roundedGeometry(w, h, r), new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: opacity >= 1 }));
}

/**
 * text on a transparent plane. size = font size in metres. res = canvas pixels per metre.
 * mesh.setText(str, color) or mesh.setText([{ t, c, w }...]) for coloured runs.
 */
export function makeText(str, o = {}) {
  const { w = 0.6, h = 0.06, size = 0.03, color = C.text, weight = 500, align = 'left', res = 2000, pad = 0.004 } = o;
  const cw = Math.max(8, Math.round(w * res)), ch = Math.max(8, Math.round(h * res));
  const canvas = document.createElement('canvas');
  canvas.width = cw; canvas.height = ch;
  const ctx = canvas.getContext('2d');
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false }));
  mesh.userData.canvasTex = t;
  let last = null;
  const px = Math.round(size * res);
  mesh.setText = (s, c = color) => {
    const runs = Array.isArray(s) ? s.map((r) => ({ ...r })) : [{ t: String(s ?? ''), c }];
    const key = JSON.stringify(runs);
    if (key === last) return;
    last = key;
    ctx.clearRect(0, 0, cw, ch);
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    const maxW = cw - 2 * pad * res;
    if (runs.length === 1) { // truncate a single run that overflows
      ctx.font = font(runs[0].w || weight, px);
      let out = runs[0].t;
      if (ctx.measureText(out).width > maxW) { while (out.length > 1 && ctx.measureText(`${out}…`).width > maxW) out = out.slice(0, -1); out += '…'; }
      runs[0].t = out;
    }
    let total = 0;
    for (const r of runs) { ctx.font = font(r.w || weight, px); r.mw = ctx.measureText(r.t).width; total += r.mw; }
    let x = align === 'center' ? (cw - total) / 2 : align === 'right' ? cw - pad * res - total : pad * res;
    const y = ch / 2 + px * 0.06;
    for (const r of runs) { ctx.font = font(r.w || weight, px); ctx.fillStyle = r.c || color; ctx.fillText(r.t, x, y); x += r.mw; }
    t.needsUpdate = true;
  };
  mesh.setText(str);
  return mesh;
}

/** a button with hover and active (selected) states. Register it with app.pointer.add(btn, { onClick }). */
export function makeButton(label0, o = {}) {
  const {
    w = 0.1, h = 0.036, size = 0.013, res = 3200, align = 'center', r, weight = 600,
    base = C.raised, hover = C.hover, active = C.accent, activeHover = C.accentHover, textColor = C.text, activeText = C.onAccent,
  } = o;
  const m = new THREE.Mesh(roundedGeometry(w, h, r ?? Math.min(0.01, h / 3)), new THREE.MeshBasicMaterial({ color: base }));
  const l = makeText(label0, { w, h, size, align, res, weight, color: textColor, pad: align === 'center' ? 0.004 : 0.012 });
  l.position.z = 0.0006;
  m.add(l);
  let hov = false, act = false, label = label0;
  const paint = () => {
    m.material.color.set(act ? (hov ? activeHover : active) : hov ? hover : base);
    l.setText(label, act ? activeText : textColor);
  };
  m.userData.hover = (on) => { hov = on; paint(); m.scale.setScalar(on ? 1.025 : 1); };
  m.setActive = (on) => { act = !!on; paint(); };
  m.setLabel = (s) => { label = s; paint(); };
  m.label = l;
  m.userData.w = w;
  return m;
}

/** dispose every geometry, material and canvas texture under obj (shared ones listed in `keep` are left alone) */
export function disposeTree(obj, keep = null) {
  obj.traverse((o) => {
    if (o.userData?.canvasTex) o.userData.canvasTex.dispose();
    if (o.geometry && !(keep && keep.has(o.geometry))) o.geometry.dispose();
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) m.dispose();
    }
  });
}
