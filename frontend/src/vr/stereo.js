// Video formats for the VR screen: what a file name says (the DeoVR / HereSphere naming conventions), the choice a user
// made for a file (kept per file in localStorage), and the meshes that show one VideoTexture to each eye.
//
// A format is { layout, swap, proj, fov }:
//   layout  'mono' | 'sbs' (side by side) | 'tb' (over-under)       swap  the right eye's half comes first (RL, BT)
//   proj    'flat' (the cinema screen) | '180' | '360' (equirectangular, around you) | 'fisheye' (equidistant, fov deg)
// Per-eye rendering: the left eye's mesh is on layer 1, the right eye's on layer 2 (three.js's WebXR cameras see
// layer 0 plus their own); a mono mesh is on layer 0. Each eye's half of the frame is chosen by its uvs (the
// offset / repeat of that eye baked into its geometry), so both eyes share ONE VideoTexture and one upload per frame.
import * as THREE from 'three';

const DEG = Math.PI / 180;
const STORE = 'vr.formats';
const MAX_SAVED = 400;

/** the format a file name announces, with the tokens that said so. Unknown names are plain 2D on the screen. */
export function detectFormat(name) {
  const base = String(name || '').split(/[\\/]/).pop().replace(/\.[a-z0-9]{2,5}$/i, '').toLowerCase();
  // tokens between separators. A short or plain-number token (180, lr, tb, 3d) counts only next to _ - or . (as in
  // "clip_180_LR"), so "Video (180)" or "Part 3D" are not taken for VR; distinctive ones (vr180, mkx200, 3dh) count anywhere.
  const parts = base.split(/([^a-z0-9]+)/);
  const tokens = [];
  for (let i = 0; i < parts.length; i += 2) {
    const t = parts[i]; if (!t) continue;
    const near = `${parts[i - 1] || ''}${parts[i + 1] || ''}`;
    tokens.push({ t, marked: /[_.-]/.test(near) || parts.length === 1 });
  }
  const DISTINCT = /^(vr180|vr360|180x180|360x180|3dh|3dv|sbs|sidebyside|overunder|mono360|fisheye\d*|mkx\d{3}|vrca\d{3}|rf52)$/;
  const has = (...list) => tokens.find((x) => list.includes(x.t) && (x.marked || DISTINCT.test(x.t)))?.t;
  const why = [];
  let proj = 'flat', fov = 180, layout = null, swap = false;
  const fish = tokens.find((x) => /^(fisheye\d*|mkx\d{3}|vrca\d{3}|rf52)$/.test(x.t) || (x.marked && /^f(180|190|200|210|220)$/.test(x.t)))?.t;
  if (fish) {
    const n = Number((fish.match(/\d{3}/) || [])[0]);
    proj = 'fisheye'; fov = n >= 160 && n <= 240 ? n : fish === 'rf52' ? 190 : 180; why.push(fish);
  } else if (has('360', 'vr360', '360x180', 'mono360')) { proj = '360'; why.push(has('360', 'vr360', '360x180', 'mono360')); }
  else if (has('180', 'vr180', '180x180')) { proj = '180'; why.push(has('180', 'vr180', '180x180')); }
  const lr = has('lr', 'sbs', '3dh', 'sidebyside'), rl = has('rl'), tb = has('tb', 'ou', '3dv', 'overunder'), bt = has('bt', 'uo');
  const mono = has('2d', 'mono', 'mono360');
  if (rl) { layout = 'sbs'; swap = true; why.push(rl); }
  else if (lr) { layout = 'sbs'; why.push(lr); }
  else if (bt) { layout = 'tb'; swap = true; why.push(bt); }
  else if (tb) { layout = 'tb'; why.push(tb); }
  else if (has('3d')) { layout = 'sbs'; why.push('3d'); }
  else if (mono) { layout = 'mono'; why.push(mono); }
  // what the players assume when only the projection is named: 180 and fisheye are side by side, 360 is mono
  if (!layout) layout = proj === '180' || proj === 'fisheye' ? 'sbs' : 'mono';
  return { layout, swap, proj, fov, detected: why.length > 0, why };
}

function readSaved() { try { return JSON.parse(window.localStorage.getItem(STORE)) || {}; } catch { return {}; } }
/** the format a user chose for this file, or null */
export function savedFormat(path) {
  const f = readSaved()[path];
  return f && typeof f === 'object' && f.layout ? { layout: f.layout, swap: !!f.swap, proj: f.proj || 'flat', fov: Number(f.fov) || 180 } : null;
}
/** remember (fmt) or forget (null) the choice for this file */
export function saveFormat(path, fmt) {
  try {
    const all = readSaved();
    delete all[path];
    if (fmt) all[path] = { layout: fmt.layout, swap: !!fmt.swap, proj: fmt.proj, fov: fmt.fov, at: Date.now() };
    const keys = Object.keys(all);
    if (keys.length > MAX_SAVED) keys.sort((a, b) => (all[a].at || 0) - (all[b].at || 0)).slice(0, keys.length - MAX_SAVED).forEach((k) => delete all[k]);
    window.localStorage.setItem(STORE, JSON.stringify(all));
  } catch { /* storage blocked: the choice lasts while it plays */ }
}
/** the format to play a file in: the saved choice, else the name */
export function formatFor(path, name) { return savedFormat(path) || detectFormat(name || path); }

const PROJ_LABEL = { flat: 'Screen', 180: '180°', 360: '360°' };
/** a short label: "2D · Screen", "3D side by side · 180°", "3D over-under, swapped · Fisheye 200" */
export function formatLabel(f) {
  const st = f.layout === 'mono' ? '2D' : `3D ${f.layout === 'sbs' ? 'side by side' : 'over-under'}${f.swap ? ', swapped' : ''}`;
  return `${st} · ${f.proj === 'fisheye' ? `Fisheye ${f.fov}` : PROJ_LABEL[f.proj]}`;
}
export const sameFormat = (a, b) => !!a && !!b && a.layout === b.layout && !!a.swap === !!b.swap && a.proj === b.proj && (a.proj !== 'fisheye' || a.fov === b.fov);

/** the shape of one eye's picture (width / height) from the frame size. Full or half side-by-side / over-under:
 *  a frame whose eye would be narrower than square (sbs) or wider than 2.5 : 1 (tb) is the half kind, stretched back. */
export function eyeAspect(fmt, w, h) {
  const a = w && h ? w / h : 16 / 9;
  if (fmt.layout === 'sbs') { const e = a / 2; return e < 1 ? a : e; }
  if (fmt.layout === 'tb') { const e = a * 2; return e > 2.5 ? a : e; }
  return a;
}

/** the part of the frame an eye sees: [offsetU, offsetV, repeatU, repeatV] (v = 1 is the top of the frame) */
export function eyeRect(fmt, eye) {
  if (fmt.layout === 'mono') return [0, 0, 1, 1];
  const second = (eye === 'right') !== !!fmt.swap; // LR / TB: the right eye has the second half
  if (fmt.layout === 'sbs') return [second ? 0.5 : 0, 0, 0.5, 1];
  return [0, second ? 0 : 0.5, 1, 0.5]; // over-under: the first eye is on top
}

// ---------- geometry: positions on a surface around the origin (the head), uvs 0..1 across one eye's picture ----------
function grid(nu, nv, fn) {
  const pos = [], uv = [], idx = [];
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
    const p = fn(i / nu, j / nv);
    pos.push(p.x, p.y, p.z); uv.push(p.u, p.v);
  }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
    idx.push(a, b, d, a, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** a slightly curved cinema screen: part of a cylinder of radius r around the head, `width` metres along the arc */
export function screenGeometry(width, aspect, r) {
  const ang = width / r, h = width / aspect;
  return grid(48, 2, (s, t) => {
    const a = (s - 0.5) * ang;
    return { x: Math.sin(a) * r, y: (t - 0.5) * h, z: -Math.cos(a) * r, u: s, v: t };
  });
}
/** equirectangular: 180 (the front half) or 360, radius r, the middle of the picture straight ahead */
export function equirectGeometry(full, r) {
  const span = full ? 2 * Math.PI : Math.PI;
  return grid(full ? 96 : 64, 48, (s, t) => {
    const lon = (s - 0.5) * span, lat = (t - 0.5) * Math.PI;
    return { x: Math.cos(lat) * Math.sin(lon) * r, y: Math.sin(lat) * r, z: -Math.cos(lat) * Math.cos(lon) * r, u: s, v: t };
  });
}
/** equidistant fisheye (MKX200, Fisheye 190): the picture is a circle; its radius is fov / 2 from straight ahead */
export function fisheyeGeometry(fovDeg, r) {
  const half = (fovDeg / 2) * DEG;
  return grid(72, 36, (s, t) => {
    const phi = s * 2 * Math.PI, th = t * half, k = 0.5 * (th / half);
    return { x: Math.sin(th) * Math.cos(phi) * r, y: Math.sin(th) * Math.sin(phi) * r, z: -Math.cos(th) * r, u: 0.5 + k * Math.cos(phi), v: 0.5 + k * Math.sin(phi) };
  });
}

/** a copy of geometry g with its uvs moved into one eye's rect of the frame */
function forEye(g, rect) {
  const out = g.clone();
  const uv = out.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, rect[0] + uv.getX(i) * rect[2], rect[1] + uv.getY(i) * rect[3]);
  uv.needsUpdate = true;
  return out;
}

/**
 * The meshes that show `texture` in format `fmt`: one mono mesh on layer 0, or a left-eye mesh on layer 1 and a
 * right-eye mesh on layer 2. o: { width, aspect, dist } for the screen; spheres are `radius` metres out.
 * Returns { group, meshes, dispose() }.
 */
export function buildVideoMeshes(texture, fmt, { width = 3, aspect = 16 / 9, dist = 3.2, radius = 12 } = {}) {
  const base = fmt.proj === 'flat' ? screenGeometry(width, aspect, dist)
    : fmt.proj === 'fisheye' ? fisheyeGeometry(fmt.fov || 190, radius)
      : equirectGeometry(fmt.proj === '360', radius);
  const group = new THREE.Group(); group.name = 'video-meshes';
  const meshes = [];
  const make = (eye, layer) => {
    const m = new THREE.Mesh(forEye(base, eyeRect(fmt, eye)), new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide, transparent: true, depthWrite: false }));
    m.layers.set(layer); m.renderOrder = -5; m.userData.eye = eye;
    group.add(m); meshes.push(m);
  };
  if (fmt.layout === 'mono') make('left', 0);
  else { make('left', 1); make('right', 2); }
  base.dispose();
  return {
    group, meshes,
    setOpacity(o) { for (const m of meshes) m.material.opacity = o; },
    dispose() { for (const m of meshes) { m.geometry.dispose(); m.material.dispose(); } group.parent?.remove(group); },
  };
}
