/**
 * ACM VR scene, built imperatively (A-Frame fights React's reconciler).
 *
 * Views: GALLERY (performer ring) -> DETAIL (a performer's photos+videos ring) -> PLAYER.
 * The cards live on a CYLINDER around the user, scrolled continuously with the right thumbstick
 * (no pages — it wraps, so it's effectively infinite). Only a window of columns is rendered
 * (virtualized) so any list size works. The floating, grabbable bar swaps controls per view.
 *
 * INPUT (Quest 3) — driven by low-level sources A-Frame's events are unreliable for:
 *   - TRIGGER -> WebXR `select` -> fresh raycast (A-Frame's own ray) -> click.
 *   - THUMBSTICK X (tilt) -> scroll the ring (gallery/detail) / prev-next media (player).
 *   - THUMBSTICK Y (tilt) -> scrub the video (player).
 *   - THUMBSTICK press -> recenter. GRIP -> grab the bar (if aimed at it) else recenter.
 *
 * Returns { sceneEl, destroy }.
 */

// ---- Shared palette (one surface language everywhere — matches the main app's
// ContentCard / PerformerCard styling, so the VR cards read as the same product) ----
const ACCENT = '#007acc';
const ACCENT_WARM = '#ffd54f';   // cinematic content-card accent (folder avatar)
const SURFACE = '#14161b';       // panels / bar
const CARD_BG = '#15151a';       // card body (performer + content)
const CARD_BG_ALT = '#1c1d22';   // inner strips / badges
const CHIP_BG = 'rgba(255,255,255,0.06)'; // idle icon/text chip background
const BORDER_SUBTLE = 'rgba(255,255,255,0.06)';
const BORDER_ACCENT = 'rgba(0,122,204,0.18)';
const TEXT = '#e8e6df';
const TEXT_MUTED = '#9bb8d4';
const TEXT_DIM = '#7d889a';
// Stat-chip signature colors (verbatim from frontend/src/styles/ContentCard.styles.js)
const C_PICS = '#90caf9';
const C_VIDS = '#ef9a9a';
const C_FUN = '#a5d6a7';
const C_TOTAL = '#ffffff';

// ---- Ring geometry ----
const R_RING = 4.6;       // cylinder radius (performer + content share this cylinder)
const STEP_DEG = 15;      // angular spacing per column
const STEP_RAD = (STEP_DEG * Math.PI) / 180;
const VIS_HALF = 6;       // columns rendered each side of front (virtualization window)
const CENTER_Y = 1.6;     // HUD / masonry / status text vertical centre
const PERF_Y = 2.2;       // performer ring vertical centre (raised to leave room for the content band)
const ROWS = 2;
const CARD_W = 1.0;
const CARD_H = 1.25;      // performer cards — two rows now, so a touch shorter
const ROW_SPACING = CARD_H + 0.16;
const SCROLL_SPEED = 2.6; // columns per second at full stick
// Detail MASONRY (variable-width tiles, justified rows, finite horizontal scroll).
const M_ROWS = 3;
const M_ROW_H = 0.95;
const M_ROW_GAP = 0.12;
const M_TILE_GAP = 0.08;
const M_VIS = 1.25;       // visible half-arc (radians) each side
const M_SCROLL = 1.0;     // radians/sec at full stick
const M_DEFAULT_AR = 0.7; // fallback aspect before dims arrive
// Content/genre ring — its OWN ring on the SAME cylinder, as a clean band below the
// performer rows. Radius equals R_RING so it sits at the same depth as the main app's
// "same grid, different section" layout. Rotation logic unchanged.
const GENRE_Y = 0.1;      // low, clearly below the performer band
const GENRE_R = R_RING;   // same depth as performers
const GENRE_W = 1.8;      // wider so the stat chips + labels breathe
const GENRE_H = 1.5;      // taller: generous avatar + name + chip grid + size
const GENRE_ROT = 0.16;   // radians the genre ring spins per scroll unit
// Floating control bar.
const BAR_W = 4.1;
const BAR_H = 0.52;
const BAR_H_PLAYER = 0.94; // taller: grab handle + controls row + scrub row, no overlap
const BAR_Z = 2.5;
const BAR_Y = 0.7;
const TRACK_W = BAR_W - 0.4; // scrub track width

// Performer sort cycle (uses only fields the gallery API returns).
const SORTS = [
  { key: 'name', dir: 1, label: 'Name A–Z' },
  { key: 'performer_rating', dir: -1, label: 'Rating ↓' },
  { key: 'total_size_gb', dir: -1, label: 'Size ↓' },
  { key: 'pics_count', dir: -1, label: 'Pics ↓' },
  { key: 'vids_count', dir: -1, label: 'Vids ↓' },
];
function fmtTime(s) {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60), ss = Math.floor(s % 60);
  return `${m}:${ss < 10 ? '0' : ''}${ss}`;
}
// Player.
const PLAYER_Y = 1.6;
const PLAYER_Z = 4.0;
const SCREEN_W = 3.6;
const SCREEN_H = 2.1;
const SCRUB_RATE = 28;    // seconds per second of full Y tilt

const VIDEO_RE = /\.(mp4|mkv|avi|wmv|flv|webm|m4v|mov|ts)$/i;
const RAW_VIDEO_RE = /\.(mp4|webm|m4v)$/i;

function makeEl(tag, attrs, parent) {
  const el = document.createElement(tag);
  if (attrs) for (const k in attrs) el.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(el);
  return el;
}
function faceUser(el, x, y, z) {
  el.setAttribute('position', `${x} ${y} ${z}`);
  el.setAttribute('rotation', `0 ${(Math.atan2(-x, -z) * 180) / Math.PI} 0`);
}
function fmtRating(v) {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return null;
  const n = Number(v);
  return n === Math.floor(n) ? String(n) : n.toFixed(1);
}
function popScale(el) {
  if (!el || !el.object3D) return;
  const o = el.object3D;
  o.scale.set(1.06, 1.06, 1.06);
  setTimeout(() => { if (el.object3D) el.object3D.scale.set(1, 1, 1); }, 140);
}
function videoUrl(path) {
  return (RAW_VIDEO_RE.test(path) ? '/api/files/raw?path=' : '/api/files/stream-video?path=') + encodeURIComponent(path);
}
function mod(n, m) { return ((n % m) + m) % m; }

// ---- Canvas icons ----
function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function drawPill(ctx, cw, ch, color, alpha) {
  ctx.clearRect(0, 0, cw, ch);
  const m = Math.min(cw, ch) * 0.06;
  roundRectPath(ctx, m, m, cw - 2 * m, ch - 2 * m, Math.min(cw, ch) * 0.24);
  ctx.globalAlpha = alpha; ctx.fillStyle = color; ctx.fill(); ctx.globalAlpha = 1;
}
// Every tappable bar/panel icon sits on a consistent chip surface — idle gets a subtle
// translucent background (no more bare "floating ghost glyph"), active gets the accent fill.
// This is the single biggest lever for the "professional" button feel.
function drawIconChip(ctx, cw, ch, { active = false, color } = {}) {
  ctx.clearRect(0, 0, cw, ch);
  const m = Math.min(cw, ch) * 0.05;
  roundRectPath(ctx, m, m, cw - 2 * m, ch - 2 * m, Math.min(cw, ch) * 0.22);
  if (active) { ctx.globalAlpha = 0.95; ctx.fillStyle = ACCENT; }
  else { ctx.globalAlpha = 0.5; ctx.fillStyle = '#ffffff'; }
  ctx.fill(); ctx.globalAlpha = 1;
  // icon colour: white on active, else the supplied idle colour (or muted)
  return active ? '#ffffff' : (color || TEXT_DIM);
}
function drawIcon(ctx, name, cw, ch, color) {
  const cx = cw / 2, cy = ch / 2, s = Math.min(cw, ch);
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const lw = 0.08 * s;
  if (name === 'performers') {
    ctx.beginPath(); ctx.arc(cx, cy - 0.14 * s, 0.13 * s, 0, 7); ctx.fill();
    ctx.lineWidth = 0.11 * s;
    ctx.beginPath(); ctx.arc(cx, cy + 0.34 * s, 0.22 * s, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
  } else if (name === 'content') {
    const q = 0.16 * s, g = 0.07 * s, r = 0.035 * s;
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sy]) => { roundRectPath(ctx, cx + (sx < 0 ? -q - g / 2 : g / 2), cy + (sy < 0 ? -q - g / 2 : g / 2), q, q, r); ctx.fill(); });
  } else if (name === 'folder') {
    // folder silhouette (matches Material Folder used by ContentCard's avatar)
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.moveTo(cx - 0.28 * s, cy - 0.16 * s); ctx.lineTo(cx - 0.06 * s, cy - 0.16 * s);
    ctx.lineTo(cx + 0.02 * s, cy - 0.08 * s); ctx.lineTo(cx + 0.28 * s, cy - 0.08 * s);
    ctx.lineTo(cx + 0.28 * s, cy + 0.18 * s); ctx.lineTo(cx - 0.28 * s, cy + 0.18 * s);
    ctx.closePath(); ctx.fill();
  } else if (name === 'storage') {
    // database/disk stack (matches Material Storage)
    ctx.lineWidth = lw * 0.9;
    [-0.16, 0, 0.16].forEach((dy) => {
      ctx.beginPath(); ctx.ellipse(cx, cy + dy * s, 0.24 * s, 0.07 * s, 0, 0, 7); ctx.stroke();
    });
  } else if (name === 'photo') {
    // small image icon (matches Material PhotoLibrary)
    ctx.lineWidth = lw;
    roundRectPath(ctx, cx - 0.24 * s, cy - 0.18 * s, 0.48 * s, 0.36 * s, 0.04 * s); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx - 0.1 * s, cy - 0.04 * s, 0.05 * s, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.moveTo(cx - 0.2 * s, cy + 0.14 * s); ctx.lineTo(cx - 0.02 * s, cy - 0.02 * s); ctx.lineTo(cx + 0.1 * s, cy + 0.08 * s); ctx.lineTo(cx + 0.2 * s, cy - 0.02 * s); ctx.lineTo(cx + 0.24 * s, cy + 0.14 * s); ctx.stroke();
  } else if (name === 'video') {
    // small video icon (matches Material VideoLibrary)
    ctx.lineWidth = lw;
    roundRectPath(ctx, cx - 0.24 * s, cy - 0.16 * s, 0.48 * s, 0.32 * s, 0.04 * s); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - 0.04 * s, cy - 0.08 * s); ctx.lineTo(cx - 0.04 * s, cy + 0.08 * s); ctx.lineTo(cx + 0.14 * s, cy); ctx.closePath(); ctx.fill();
  } else if (name === 'playcircle') {
    // play in a ring (matches Material PlayCircle — funscripts)
    ctx.lineWidth = lw;
    ctx.beginPath(); ctx.arc(cx, cy, 0.26 * s, 0, 7); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - 0.07 * s, cy - 0.1 * s); ctx.lineTo(cx - 0.07 * s, cy + 0.1 * s); ctx.lineTo(cx + 0.13 * s, cy); ctx.closePath(); ctx.fill();
  } else if (name === 'status') {
    ctx.lineWidth = lw; ctx.beginPath();
    ctx.moveTo(cx - 0.32 * s, cy); ctx.lineTo(cx - 0.13 * s, cy); ctx.lineTo(cx - 0.02 * s, cy - 0.22 * s);
    ctx.lineTo(cx + 0.08 * s, cy + 0.22 * s); ctx.lineTo(cx + 0.16 * s, cy); ctx.lineTo(cx + 0.32 * s, cy); ctx.stroke();
  } else if (name === 'device') {
    ctx.lineWidth = lw;
    roundRectPath(ctx, cx - 0.32 * s, cy - 0.15 * s, 0.30 * s, 0.30 * s, 0.1 * s); ctx.stroke();
    roundRectPath(ctx, cx + 0.02 * s, cy - 0.15 * s, 0.30 * s, 0.30 * s, 0.1 * s); ctx.stroke();
  } else if (name === 'search') {
    ctx.lineWidth = lw;
    ctx.beginPath(); ctx.arc(cx - 0.05 * s, cy - 0.05 * s, 0.17 * s, 0, 7); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx + 0.09 * s, cy + 0.09 * s); ctx.lineTo(cx + 0.26 * s, cy + 0.26 * s); ctx.stroke();
  } else if (name === 'all') {
    ctx.lineWidth = lw;
    ctx.beginPath(); ctx.moveTo(cx - 0.26 * s, cy - 0.18 * s); ctx.lineTo(cx + 0.26 * s, cy - 0.18 * s); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - 0.26 * s, cy); ctx.lineTo(cx + 0.26 * s, cy); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - 0.26 * s, cy + 0.18 * s); ctx.lineTo(cx + 0.26 * s, cy + 0.18 * s); ctx.stroke();
  } else if (name === 'filter') {
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.moveTo(cx - 0.26 * s, cy - 0.2 * s); ctx.lineTo(cx + 0.26 * s, cy - 0.2 * s);
    ctx.lineTo(cx + 0.08 * s, cy + 0.04 * s); ctx.lineTo(cx + 0.08 * s, cy + 0.24 * s);
    ctx.lineTo(cx - 0.08 * s, cy + 0.14 * s); ctx.lineTo(cx - 0.08 * s, cy + 0.04 * s);
    ctx.closePath(); ctx.stroke();
  } else if (name === 'triage') {
    // check (keep) + cross (delete)
    ctx.lineWidth = lw;
    ctx.beginPath(); ctx.moveTo(cx - 0.3 * s, cy - 0.02 * s); ctx.lineTo(cx - 0.2 * s, cy + 0.12 * s); ctx.lineTo(cx - 0.02 * s, cy - 0.16 * s); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx + 0.1 * s, cy - 0.13 * s); ctx.lineTo(cx + 0.28 * s, cy + 0.13 * s); ctx.moveTo(cx + 0.28 * s, cy - 0.13 * s); ctx.lineTo(cx + 0.1 * s, cy + 0.13 * s); ctx.stroke();
  } else if (name === 'undo') {
    // clean U-turn arrow (back): a near-full circle with an arrowhead at the top-left
    ctx.lineWidth = lw * 1.1;
    ctx.beginPath(); ctx.arc(cx + 0.03 * s, cy, 0.2 * s, Math.PI * 0.45, Math.PI * 2.05); ctx.stroke();
    const hx = cx - 0.12 * s, hy = cy - 0.18 * s;
    ctx.beginPath(); ctx.moveTo(hx, hy - 0.09 * s); ctx.lineTo(hx - 0.02 * s, hy + 0.02 * s); ctx.lineTo(hx + 0.1 * s, hy + 0.0 * s); ctx.stroke();
  } else if (name === 'trash') {
    ctx.lineWidth = lw;
    ctx.beginPath(); ctx.moveTo(cx - 0.22 * s, cy - 0.14 * s); ctx.lineTo(cx + 0.22 * s, cy - 0.14 * s); ctx.stroke();
    roundRectPath(ctx, cx - 0.17 * s, cy - 0.14 * s, 0.34 * s, 0.4 * s, 0.04 * s); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - 0.07 * s, cy - 0.24 * s); ctx.lineTo(cx + 0.07 * s, cy - 0.24 * s); ctx.stroke();
  } else if (name === 'keep') {
    ctx.lineWidth = lw * 1.1;
    ctx.beginPath(); ctx.moveTo(cx - 0.24 * s, cy + 0.02 * s); ctx.lineTo(cx - 0.08 * s, cy + 0.2 * s); ctx.lineTo(cx + 0.26 * s, cy - 0.2 * s); ctx.stroke();
  } else if (name === 'sort') {
    // descending bars (sort)
    ctx.lineWidth = lw;
    ctx.beginPath(); ctx.moveTo(cx - 0.26 * s, cy - 0.2 * s); ctx.lineTo(cx + 0.24 * s, cy - 0.2 * s); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - 0.26 * s, cy); ctx.lineTo(cx + 0.08 * s, cy); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - 0.26 * s, cy + 0.2 * s); ctx.lineTo(cx - 0.06 * s, cy + 0.2 * s); ctx.stroke();
  } else if (name === 'film') {
    ctx.lineWidth = lw;
    roundRectPath(ctx, cx - 0.3 * s, cy - 0.22 * s, 0.6 * s, 0.44 * s, 0.05 * s); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - 0.08 * s, cy - 0.13 * s); ctx.lineTo(cx - 0.08 * s, cy + 0.13 * s); ctx.lineTo(cx + 0.15 * s, cy); ctx.closePath(); ctx.fill();
  } else if (name === 'funscript') {
    // a little waveform
    ctx.lineWidth = lw * 0.9;
    const xs = [-0.3, -0.18, -0.06, 0.06, 0.18, 0.3], hs = [0.1, 0.24, 0.14, 0.26, 0.12, 0.2];
    xs.forEach((xx, i) => { ctx.beginPath(); ctx.moveTo(cx + xx * s, cy - hs[i] * s); ctx.lineTo(cx + xx * s, cy + hs[i] * s); ctx.stroke(); });
  } else if (name === 'image') {
    ctx.lineWidth = lw;
    roundRectPath(ctx, cx - 0.28 * s, cy - 0.22 * s, 0.56 * s, 0.44 * s, 0.05 * s); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx - 0.1 * s, cy - 0.08 * s, 0.06 * s, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.moveTo(cx - 0.24 * s, cy + 0.16 * s); ctx.lineTo(cx - 0.05 * s, cy - 0.04 * s); ctx.lineTo(cx + 0.07 * s, cy + 0.07 * s); ctx.lineTo(cx + 0.17 * s, cy - 0.04 * s); ctx.lineTo(cx + 0.26 * s, cy + 0.16 * s); ctx.stroke();
  } else if (name === 'back') {
    ctx.lineWidth = lw;
    ctx.beginPath(); ctx.moveTo(cx + 0.26 * s, cy); ctx.lineTo(cx - 0.22 * s, cy); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - 0.04 * s, cy - 0.18 * s); ctx.lineTo(cx - 0.26 * s, cy); ctx.lineTo(cx - 0.04 * s, cy + 0.18 * s); ctx.stroke();
  } else if (name === 'play') {
    ctx.beginPath(); ctx.moveTo(cx - 0.16 * s, cy - 0.23 * s); ctx.lineTo(cx - 0.16 * s, cy + 0.23 * s); ctx.lineTo(cx + 0.25 * s, cy); ctx.closePath(); ctx.fill();
  } else if (name === 'pause') {
    roundRectPath(ctx, cx - 0.19 * s, cy - 0.22 * s, 0.13 * s, 0.44 * s, 0.03 * s); ctx.fill();
    roundRectPath(ctx, cx + 0.06 * s, cy - 0.22 * s, 0.13 * s, 0.44 * s, 0.03 * s); ctx.fill();
  } else if (name === 'plus' || name === 'minus') {
    ctx.lineWidth = lw;
    ctx.beginPath(); ctx.moveTo(cx - 0.2 * s, cy); ctx.lineTo(cx + 0.2 * s, cy); ctx.stroke();
    if (name === 'plus') { ctx.beginPath(); ctx.moveTo(cx, cy - 0.2 * s); ctx.lineTo(cx, cy + 0.2 * s); ctx.stroke(); }
  } else if (name === 'arrowLeft' || name === 'arrowRight') {
    const d = name === 'arrowLeft' ? 1 : -1;
    ctx.lineWidth = 0.09 * s;
    ctx.beginPath(); ctx.moveTo(cx + d * 0.1 * s, cy - 0.2 * s); ctx.lineTo(cx - d * 0.14 * s, cy); ctx.lineTo(cx + d * 0.1 * s, cy + 0.2 * s); ctx.stroke();
  } else if (name === 'vr') {
    // VR goggles silhouette — two lenses in a rounded frame
    ctx.lineWidth = lw;
    roundRectPath(ctx, cx - 0.3 * s, cy - 0.14 * s, 0.6 * s, 0.28 * s, 0.07 * s); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx - 0.12 * s, cy, 0.07 * s, 0, 7); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx + 0.12 * s, cy, 0.07 * s, 0, 7); ctx.stroke();
  }
}

export async function buildGallery(AFRAME, container, opts = {}) {
  const { onEnterVR, onExitVR } = opts;
  const THREE = AFRAME.THREE;

  function canvasPlane(parent, { w, h, x = 0, y = 0, clickable = false, name, onClick, draw }) {
    const cw = Math.max(96, Math.round(w * 512)), ch = Math.max(96, Math.round(h * 512));
    const c = document.createElement('canvas'); c.width = cw; c.height = ch;
    draw(c.getContext('2d'), cw, ch);
    const tex = new THREE.CanvasTexture(c);
    tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false;
    if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.01, side: THREE.DoubleSide }));
    const attrs = { position: `${x} ${y} 0.012` };
    if (clickable) { attrs.class = 'clickable'; attrs['data-name'] = name || ''; }
    const el = makeEl('a-entity', attrs, parent);
    el.setObject3D('mesh', mesh);
    if (onClick) el.addEventListener('click', onClick);
    return el;
  }

  // Load an image/video-thumbnail and place it CONTAIN-fit (keeps aspect ratio) within maxW×maxH.
  function containImage(targetEl, url, maxW, maxH) {
    new THREE.TextureLoader().load(url, (tex) => {
      if (destroyed || !targetEl.parentNode) return;
      if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
      const ar = (tex.image.width / tex.image.height) || 1;
      let w = maxW, h = maxW / ar;
      if (h > maxH) { h = maxH; w = maxH * ar; }
      targetEl.setObject3D('mesh', new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex })));
    }, undefined, () => { /* leave dark slot */ });
  }

  // ---- Scene + rig + lasers ----
  const scene = makeEl('a-scene', { background: 'color: #07090d', renderer: 'antialias: true; colorManagement: true', 'vr-mode-ui': 'enabled: false', 'system-recenter': '', 'vr-tick': '' });
  makeEl('a-sky', { color: '#07090d' }, scene);
  makeEl('a-light', { type: 'ambient', color: '#33405a', intensity: '1.6' }, scene);
  makeEl('a-light', { type: 'directional', color: '#88aaff', intensity: '0.4', position: '0 4 -4' }, scene);
  const rig = makeEl('a-entity', { id: 'rig', position: '0 0 0', recenter: `anchorY: ${CENTER_Y}` }, scene);
  makeEl('a-entity', { id: 'head', camera: '', 'look-controls': '', 'wasd-controls': '', position: '0 1.6 0' }, rig);
  // No showLine here — force-laser turns the line ON only once the controller actually connects,
  // so an unused hand (e.g. only one controller held) doesn't project a stray laser.
  const RAY = 'objects: .clickable; far: 40; lineColor: #007acc; lineOpacity: 0.9';
  // NOTE: no `cursor` component on the hands. A-Frame's cursor fires its OWN click on
  // triggerdown/triggerup, which double-fired alongside our manual `select` handler and made
  // every toggle flip on then straight back off ("does nothing"). Clicks come solely from the
  // WebXR `select` event in attachXRInput -> clickFromHand. The raycaster stays for the laser line.
  const leftHand = makeEl('a-entity', { id: 'leftHand', 'laser-controls': 'hand: left', 'force-laser': '', raycaster: RAY }, rig);
  const rightHand = makeEl('a-entity', { id: 'rightHand', 'laser-controls': 'hand: right', 'force-laser': '', raycaster: RAY }, rig);
  const world = makeEl('a-entity', { id: 'world' }, scene);
  container.appendChild(scene);

  // ---- State ----
  let view = 'gallery';
  let performers = [];
  let media = [];          // full detail media
  let mediaFilter = 'all'; // all | video | image
  let currentPerf = null;
  let playerIndex = 0;
  let offset = 0;          // ring scroll position (in columns)
  let activeTab = 'Performers';
  let sortIndex = 0;
  let videoEl = null;
  let vrTexCache = null;   // cached THREE.VideoTexture of the currently-loaded video (for in-place mesh swaps)
  let vrVideoMode = false;  // when true, the current video renders as SBS 180° (one eye = half the frame)
  let scrubFillEl = null, scrubTimeEl = null; // player scrub-bar refs (updated each frame)
  let playerScale = 1; // player content resize
  let mediaDims = {};      // path -> [w,h] for masonry
  let scrollAngle = 0;     // detail masonry scroll (radians)
  let masonryTiles = [], masonryMaxAngle = 0;
  const cols = new Map();  // col index -> column entity (gallery, virtualized)
  const tiles = new Map(); // media idx -> tile entity (detail masonry, virtualized)
  let showFilters = false;
  const perfFilter = { ratingMin: 0, hasVideos: false, hasPics: false, ratedOnly: false };
  // Keep/Delete FILTER mode (the 'before' folder triage)
  let filterPerformers = [];   // performers still needing filtering (moved_to_after = 0)
  let filteringPerf = null;    // performer currently being triaged
  let filterFiles = [];        // their files, fetched in batches
  let filterIndex = 0;         // current file
  let filterTotal = 0;
  let filterBusy = false;      // guard against double actions
  let filterListSort = 'size-desc';        // performers-to-filter list ordering
  let fileType = 'all';                     // filtering: all | pics | vids
  let fileSort = 'name';                    // filtering file sort: name | size
  let fileOrder = 'asc';                    // asc | desc
  let lastFilterAction = null;              // 'keep'|'delete'|'move_to_funscript' — shown as a brief flash + label
  let lastActionAt = 0;                     // timestamp of the last triage action (for fade-out)
  // Content/genre ring (second ring under the performers)
  let genres = [];
  let basePath = null;
  let genresLoading = false;
  // Search-by-name (gallery) and Handy device panels — Phase 5
  let showSearch = false;
  let showDevice = false;
  let searchQuery = '';
  let handyCode = (typeof localStorage !== 'undefined' && localStorage.getItem('handyCode')) || '';

  const bar = makeEl('a-entity', {}, world);
  const ring = makeEl('a-entity', {}, world);
  const genreRing = makeEl('a-entity', { visible: 'false' }, world);
  const filterPanel = makeEl('a-entity', { visible: 'false' }, world);
  const searchPanel = makeEl('a-entity', { visible: 'false' }, world);
  const devicePanel = makeEl('a-entity', { visible: 'false' }, world);
  const playerRoot = makeEl('a-entity', { visible: 'false' }, world);
  const statusText = makeEl('a-text', { value: 'Loading performers…', align: 'center', color: TEXT_MUTED, width: '3', 'wrap-count': '40', font: 'roboto' }, world);
  faceUser(statusText, 0, CENTER_Y, -DIST_FRONT());
  const debug = makeEl('a-text', { value: 'debug', align: 'center', color: '#9fd0ff', width: '1.8', 'wrap-count': '40', font: 'roboto' }, world);
  faceUser(debug, 0, BAR_Y + 0.42, -BAR_Z);
  const setDebug = (s) => debug.setAttribute('value', s);

  function DIST_FRONT() { return R_RING; }
  function passesFilter(p) {
    if (searchQuery && !String(p.name || '').toLowerCase().includes(searchQuery.toLowerCase())) return false;
    if (perfFilter.ratingMin > 0 && !(Number(p.performer_rating) >= perfFilter.ratingMin)) return false;
    if (perfFilter.hasVideos && !(p.vids_count > 0)) return false;
    if (perfFilter.hasPics && !(p.pics_count > 0)) return false;
    if (perfFilter.ratedOnly && (p.performer_rating === null || p.performer_rating === undefined)) return false;
    return true;
  }
  function displayList() {
    // gallery shows performers (filtered); detail AND player operate on the (filtered) media list
    if (view === 'gallery') return performers.filter(passesFilter);
    if (view === 'filterList') return filterPerformers;
    if (mediaFilter === 'all') return media;
    if (mediaFilter === 'funscript') return media.filter((m) => m.fun);
    return media.filter((m) => m.type === mediaFilter);
  }

  // ---- Control bar ----
  function buildBar() {
    bar.innerHTML = '';
    scrubFillEl = null; scrubTimeEl = null;
    if (!bar.__placed) { faceUser(bar, 0, BAR_Y, -BAR_Z); bar.__placed = true; }
    const half = BAR_W / 2;
    // filtering view gets the TALL (2-row) bar too, so there's room for actions + a scrub row
    const tall = view === 'player' || view === 'filtering';
    const bh = tall ? BAR_H_PLAYER : BAR_H;
    makeEl('a-entity', { rounded: `width: ${BAR_W}; height: ${bh}; radius: 0.13; color: ${SURFACE}; opacity: 0.92` }, bar);
    if (!tall) makeEl('a-entity', { rounded: `width: ${BAR_W - 0.4}; height: 0.016; radius: 0.008; color: ${ACCENT}; opacity: 0.5`, position: `0 ${-bh / 2 + 0.04} 0.011` }, bar);
    makeEl('a-entity', { rounded: `width: 0.5; height: 0.03; radius: 0.015; color: #39414f; opacity: 0.85`, position: `0 ${bh / 2 - 0.07} 0.011` }, bar);
    if (view === 'player') buildPlayerControls(half, bh);
    else if (view === 'filtering') buildFilteringControls(half, bh);
    else if (view === 'detail') buildDetailControls(half);
    else if (view === 'filterList') buildFilterListControls(half);
    else buildGalleryControls();
  }

  function buildFilterListControls(half) {
    const y = -0.02, isz = 0.34;
    canvasPlane(bar, { w: isz, h: isz, x: -half + 0.3, y, clickable: true, name: 'back', onClick: function () { popScale(this); Promise.resolve().then(showGallery); }, draw: (ctx, cw, ch) => { const c = drawIconChip(ctx, cw, ch, { active: false, color: TEXT }); drawIcon(ctx, 'back', cw, ch, c); } });
    canvasPlane(bar, { w: isz, h: isz, x: -half + 0.72, y, clickable: true, name: 'filter', onClick: function () { popScale(this); Promise.resolve().then(toggleFilters); }, draw: (ctx, cw, ch) => { const c = drawIconChip(ctx, cw, ch, { active: showFilters, color: TEXT_MUTED }); drawIcon(ctx, 'filter', cw, ch, c); } });
    makeEl('a-text', { value: `Filter — ${filterPerformers.length} performers left`, align: 'right', color: ACCENT_WARM, position: `${half - 0.2} ${y} 0.011`, width: '1.7', 'wrap-count': '34', font: 'roboto' }, bar);
  }

  function buildFilteringControls(half, bh) {
    const isz = 0.3;
    const y1 = bh / 2 - 0.31;     // top row: triage actions
    const y2 = -bh / 2 + 0.17;    // bottom row: transport + scrub (video only)
    const item = filterFiles[filterIndex];
    const isVid = item && item.type === 'video';
    // row 1: back · KEEP · DELETE · FUNSCRIPT · UNDO · zoom -/+ · filter · count
    canvasPlane(bar, { w: isz, h: isz, x: -half + 0.26, y: y1, clickable: true, name: 'back', onClick: function () { popScale(this); Promise.resolve().then(closeFiltering); }, draw: (ctx, cw, ch) => { const c = drawIconChip(ctx, cw, ch, { active: false, color: TEXT }); drawIcon(ctx, 'back', cw, ch, c); } });
    canvasPlane(bar, { w: 0.42, h: 0.36, x: -half + 0.74, y: y1, clickable: true, name: 'keepFile', onClick: function () { popScale(this); Promise.resolve().then(() => doFilterAction('keep')); }, draw: (ctx, cw, ch) => { drawPill(ctx, cw, ch, '#2e7d4f', 0.95); drawIcon(ctx, 'keep', cw, ch, '#fff'); } });
    canvasPlane(bar, { w: 0.42, h: 0.36, x: -half + 1.22, y: y1, clickable: true, name: 'deleteFile', onClick: function () { popScale(this); Promise.resolve().then(() => doFilterAction('delete')); }, draw: (ctx, cw, ch) => { drawPill(ctx, cw, ch, '#b3402f', 0.95); drawIcon(ctx, 'trash', cw, ch, '#fff'); } });
    canvasPlane(bar, { w: isz, h: isz, x: -half + 1.68, y: y1, clickable: true, name: 'funscript', onClick: function () { popScale(this); Promise.resolve().then(() => doFilterAction('move_to_funscript')); }, draw: (ctx, cw, ch) => { const c = drawIconChip(ctx, cw, ch, { active: false, color: C_FUN }); drawIcon(ctx, 'funscript', cw, ch, c); } });
    canvasPlane(bar, { w: isz, h: isz, x: -half + 2.12, y: y1, clickable: true, name: 'undoFile', onClick: function () { popScale(this); Promise.resolve().then(undoFilter); }, draw: (ctx, cw, ch) => { const c = drawIconChip(ctx, cw, ch, { active: false, color: TEXT }); drawIcon(ctx, 'undo', cw, ch, c); } });
    canvasPlane(bar, { w: isz, h: isz, x: half - 1.4, y: y1, clickable: true, name: 'zoomout', onClick: function () { popScale(this); zoomPlayer(0.85); }, draw: (ctx, cw, ch) => { const c = drawIconChip(ctx, cw, ch, { active: false, color: TEXT }); drawIcon(ctx, 'minus', cw, ch, c); } });
    canvasPlane(bar, { w: isz, h: isz, x: half - 1.0, y: y1, clickable: true, name: 'zoomin', onClick: function () { popScale(this); zoomPlayer(1.18); }, draw: (ctx, cw, ch) => { const c = drawIconChip(ctx, cw, ch, { active: false, color: TEXT }); drawIcon(ctx, 'plus', cw, ch, c); } });
    canvasPlane(bar, { w: isz, h: isz, x: half - 0.6, y: y1, clickable: true, name: 'filter', onClick: function () { popScale(this); Promise.resolve().then(toggleFilters); }, draw: (ctx, cw, ch) => { const c = drawIconChip(ctx, cw, ch, { active: showFilters, color: TEXT_MUTED }); drawIcon(ctx, 'filter', cw, ch, c); } });
    makeEl('a-text', { value: filterTotal ? `${Math.min(filterIndex + 1, filterTotal)}/${filterTotal}` : '', align: 'right', color: TEXT_MUTED, position: `${half - 0.2} ${y1} 0.011`, width: '0.5', 'wrap-count': '10', font: 'roboto' }, bar);
    // row 2: transport + scrub (only when a video is loaded) — mirrors the player controls
    if (isVid) {
      const trackW = BAR_W - 1.5;
      const trackCenterX = 0.35; // track sits right of the play button, centered in remaining space
      canvasPlane(bar, { w: isz, h: isz, x: -half + 0.26, y: y2, clickable: true, name: 'playpause', onClick: function () { popScale(this); togglePlay(); }, draw: (ctx, cw, ch) => { drawPill(ctx, cw, ch, ACCENT, 0.95); drawIcon(ctx, (!videoEl || videoEl.paused) ? 'play' : 'pause', cw, ch, '#fff'); } });
      const track = makeEl('a-entity', { class: 'clickable', 'data-name': 'scrub', position: `${trackCenterX} ${y2} 0.011` }, bar);
      makeEl('a-entity', { rounded: `width: ${trackW}; height: 0.05; radius: 0.025; color: #2a2f3a` }, track);
      track.__trackW = trackW;
      track.__seek = (frac) => { if (videoEl && videoEl.duration) videoEl.currentTime = Math.max(0, Math.min(videoEl.duration - 0.2, frac * videoEl.duration)); };
      wireScrubSeek(track, trackW);
      const fill = makeEl('a-entity', { position: `${trackCenterX} ${y2} 0.013` }, bar);
      makeEl('a-entity', { rounded: `width: ${trackW}; height: 0.05; radius: 0.025; color: ${ACCENT}` }, fill);
      scrubFillEl = fill;
      scrubFillEl.__trackW = trackW;
      scrubFillEl.__baseX = trackCenterX;
      scrubTimeEl = makeEl('a-text', { value: '0:00 / 0:00', align: 'center', color: TEXT, position: `${trackCenterX} ${y2 + 0.12} 0.012`, width: '0.9', 'wrap-count': '16', font: 'roboto' }, bar);
      updateScrubUI();
    }
  }

  function buildGalleryControls() {
    const y = -0.02, isz = 0.34;
    // Status removed (placeholder). Search + Device implemented in Phase 5.
    const items = [
      { name: 'tab:Performers', icon: 'performers', active: activeTab === 'Performers', on: showGallery },
      { name: 'filter', icon: 'filter', active: showFilters, on: toggleFilters },     // sort & filter overlay, next to Performers
      { name: 'search', icon: 'search', active: showSearch, on: toggleSearch },       // search by name
      { name: 'tab:Device', icon: 'device', active: showDevice, on: toggleDevice },   // Handy device
      { name: 'triage', icon: 'triage', active: false, on: enterFilterList },          // keep/delete filter mode
    ];
    const pitch = 0.4, start = -((items.length - 1) / 2) * pitch;
    items.forEach((it, i) => {
      canvasPlane(bar, { w: isz, h: isz, x: start + i * pitch, y, clickable: true, name: it.name,
        // Defer the action: toggle*() calls buildBar(), which wipes the bar (and this button) mid-click.
        // Running it on the next microtask lets the click event finish cleanly before the DOM changes.
        onClick: function () { popScale(this); const fn = it.on; Promise.resolve().then(fn); },
        draw: (ctx, cw, ch) => { const c = drawIconChip(ctx, cw, ch, { active: it.active, color: TEXT_MUTED }); drawIcon(ctx, it.icon, cw, ch, c); } });
    });
  }

  function applySort() {
    const s = SORTS[sortIndex];
    performers.sort((a, b) => {
      if (s.key === 'name') return s.dir * String(a.name || '').localeCompare(String(b.name || ''));
      const av = a[s.key] == null ? -Infinity : a[s.key];
      const bv = b[s.key] == null ? -Infinity : b[s.key];
      return s.dir * (av - bv);
    });
  }

  // ---- Performer filter panel (floating, gallery only) ----
  // Uses canvasPlane (the SAME proven clickable path as bar buttons) so overlay buttons are
  // always raycast-hittable — earlier the manual entity+rounded construction sometimes failed
  // to resolve through rootClickable, leaving the overlay "showing but unclickable".
  function textButton(parent, { x, y, w, h, label, active, onClick }) {
    const el = canvasPlane(parent, {
      w, h, x, y: y, clickable: true, name: 'f:' + label,
      onClick: function () { popScale(this); if (onClick) onClick(); },
      draw: (ctx, cw, ch) => {
        const m = Math.min(cw, ch) * 0.08;
        roundRectPath(ctx, m, m, cw - 2 * m, ch - 2 * m, Math.min(cw, ch) * 0.18);
        ctx.globalAlpha = active ? 0.95 : 0.9; ctx.fillStyle = active ? ACCENT : '#262a33'; ctx.fill(); ctx.globalAlpha = 1;
        ctx.fillStyle = active ? '#ffffff' : TEXT;
        ctx.font = `${Math.round(ch * 0.42)}px roboto, sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(label, cw / 2, ch / 2);
      },
    });
    return el;
  }
  // Toggle guard: a single Quest trigger pull throws 2-4 'select' events that each queue a
  // deferred toggle call. Debouncing at the click level kept leaking through (echoes spread
  // past the window). So each toggle takes a per-toggle lock for 400ms — the FIRST call flips
  // the state and renders; every echo within 400ms returns immediately. Net = exactly one flip.
  const _toggleLock = {};
  function _guarded(key, fn) {
    const now = performance.now();
    if (_toggleLock[key] && now - _toggleLock[key] < 400) return; // echo of this pull — ignore
    _toggleLock[key] = now;
    fn();
  }
  function toggleFilters() { _guarded('filters', () => { showFilters = !showFilters; setDebug(`toggleFilters -> ${showFilters} (view=${view})`); renderFilterPanel(); buildBar(); }); }
  function toggleSearch() { _guarded('search', () => { showSearch = !showSearch; setDebug(`toggleSearch -> ${showSearch}`); renderSearchPanel(); buildBar(); }); }
  function toggleDevice() { _guarded('device', () => { showDevice = !showDevice; setDebug(`toggleDevice -> ${showDevice}`); renderDevicePanel(); buildBar(); }); }
  function panelBg(W, H, title, sub) {
    makeEl('a-entity', { rounded: `width: ${W}; height: ${H}; radius: 0.09; color: ${SURFACE}; opacity: 0.96` }, filterPanel);
    makeEl('a-text', { value: title, align: 'center', color: '#ffffff', position: `0 ${H / 2 - 0.16} 0.01`, width: `${W * 0.85}`, font: 'roboto' }, filterPanel);
    if (sub) makeEl('a-text', { value: sub, align: 'center', color: TEXT_MUTED, position: `0 ${H / 2 - 0.33} 0.01`, width: `${W * 0.82}`, 'wrap-count': '26', font: 'roboto' }, filterPanel);
    return (txt, y) => makeEl('a-text', { value: txt, align: 'left', color: TEXT_DIM, position: `${-W / 2 + 0.16} ${y} 0.01`, width: '1.1', 'wrap-count': '18', font: 'roboto' }, filterPanel);
  }
  function renderFilterPanel() {
    filterPanel.innerHTML = '';
    const open = showFilters && (view === 'gallery' || view === 'filterList' || view === 'filtering');
    filterPanel.setAttribute('visible', open ? 'true' : 'false');
    if (!open) return;
    // Dead-centre, just below eye level, close enough to read and impossible to miss.
    faceUser(filterPanel, 0, CENTER_Y - 0.1, -2.2);
    if (view === 'gallery') renderGalleryPanel();
    else if (view === 'filterList') renderFilterListPanel();
    else renderFilteringPanel();
    setDebug(`filterPanel open: ${filterPanel.children.length} children, vis=${filterPanel.getAttribute('visible')}`);
  }
  function renderGalleryPanel() {
    const W = 1.7, H = 2.95;
    const lbl = panelBg(W, H, 'SORT & FILTER', `${displayList().length} performers`);
    const apply = () => { offset = 0; rebuildRing(); renderFilterPanel(); };
    lbl('Sort by', 0.98);
    ['Name', 'Rating', 'Size', 'Pics', 'Vids'].forEach((s, i) => {
      const row = i < 3 ? 0 : 1, col = i < 3 ? i : i - 3;
      const xs = row === 0 ? [-0.52, 0, 0.52] : [-0.26, 0.26];
      textButton(filterPanel, { x: xs[col], y: row === 0 ? 0.74 : 0.5, w: 0.48, h: 0.2, label: s, active: sortIndex === i, onClick: () => { sortIndex = i; applySort(); apply(); } });
    });
    lbl('Min rating', 0.26);
    [['Any', 0], ['3+', 3], ['4+', 4]].forEach(([t, val], i) => textButton(filterPanel, { x: -0.46 + i * 0.46, y: 0.04, w: 0.42, h: 0.2, label: t, active: perfFilter.ratingMin === val, onClick: () => { perfFilter.ratingMin = val; apply(); } }));
    textButton(filterPanel, { x: 0, y: -0.26, w: 1.4, h: 0.22, label: 'Has Videos', active: perfFilter.hasVideos, onClick: () => { perfFilter.hasVideos = !perfFilter.hasVideos; apply(); } });
    textButton(filterPanel, { x: 0, y: -0.54, w: 1.4, h: 0.22, label: 'Has Pics', active: perfFilter.hasPics, onClick: () => { perfFilter.hasPics = !perfFilter.hasPics; apply(); } });
    textButton(filterPanel, { x: 0, y: -0.82, w: 1.4, h: 0.22, label: 'Rated only', active: perfFilter.ratedOnly, onClick: () => { perfFilter.ratedOnly = !perfFilter.ratedOnly; apply(); } });
    textButton(filterPanel, { x: 0, y: -1.2, w: 1.0, h: 0.22, label: 'Clear', active: false, onClick: () => { perfFilter.ratingMin = 0; perfFilter.hasVideos = false; perfFilter.hasPics = false; perfFilter.ratedOnly = false; apply(); } });
  }
  function renderFilterListPanel() {
    const W = 1.7, H = 1.7;
    const lbl = panelBg(W, H, 'SORT', `${filterPerformers.length} to filter`);
    const by = filterListSort.split('-')[0], order = filterListSort.split('-')[1];
    const set = (b, o) => { filterListSort = `${b}-${o}`; enterFilterList(); };
    lbl('Sort by', 0.42);
    textButton(filterPanel, { x: -0.42, y: 0.18, w: 0.5, h: 0.22, label: 'Name', active: by === 'name', onClick: () => set('name', order) });
    textButton(filterPanel, { x: 0.42, y: 0.18, w: 0.5, h: 0.22, label: 'Size', active: by === 'size', onClick: () => set('size', order) });
    lbl('Order', -0.14);
    textButton(filterPanel, { x: -0.42, y: -0.38, w: 0.5, h: 0.22, label: 'Asc', active: order === 'asc', onClick: () => set(by, 'asc') });
    textButton(filterPanel, { x: 0.42, y: -0.38, w: 0.5, h: 0.22, label: 'Desc', active: order === 'desc', onClick: () => set(by, 'desc') });
  }
  function renderFilteringPanel() {
    const W = 1.7, H = 2.2;
    const lbl = panelBg(W, H, 'FILTER FILES', filteringPerf ? filteringPerf.name : '');
    const reload = () => { renderFilterPanel(); reloadFilteringFiles(); };
    lbl('Type', 0.62);
    [['all', 'All'], ['pics', 'Pics'], ['vids', 'Vids']].forEach(([v, t], i) => textButton(filterPanel, { x: -0.46 + i * 0.46, y: 0.4, w: 0.42, h: 0.22, label: t, active: fileType === v, onClick: () => { fileType = v; reload(); } }));
    lbl('Sort by', 0.1);
    textButton(filterPanel, { x: -0.42, y: -0.14, w: 0.5, h: 0.22, label: 'Name', active: fileSort === 'name', onClick: () => { fileSort = 'name'; reload(); } });
    textButton(filterPanel, { x: 0.42, y: -0.14, w: 0.5, h: 0.22, label: 'Size', active: fileSort === 'size', onClick: () => { fileSort = 'size'; reload(); } });
    lbl('Order', -0.46);
    textButton(filterPanel, { x: -0.42, y: -0.7, w: 0.5, h: 0.22, label: 'Asc', active: fileOrder === 'asc', onClick: () => { fileOrder = 'asc'; reload(); } });
    textButton(filterPanel, { x: 0.42, y: -0.7, w: 0.5, h: 0.22, label: 'Desc', active: fileOrder === 'desc', onClick: () => { fileOrder = 'desc'; reload(); } });
  }

  function buildDetailControls(half) {
    const y = -0.02, isz = 0.34;
    canvasPlane(bar, { w: isz, h: isz, x: -half + 0.3, y, clickable: true, name: 'back', onClick: function () { popScale(this); showGallery(); }, draw: (ctx, cw, ch) => { const c = drawIconChip(ctx, cw, ch, { active: false, color: TEXT }); drawIcon(ctx, 'back', cw, ch, c); } });
    // All / Vids / Pics / Funscripts filter
    const filters = [['all', 'all'], ['video', 'film'], ['image', 'image'], ['funscript', 'funscript']];
    const pitch = 0.42, center = -0.15;
    filters.forEach(([f, icon], i) => {
      const active = mediaFilter === f;
      canvasPlane(bar, { w: isz, h: isz, x: center + (i - 1.5) * pitch, y, clickable: true, name: 'filter:' + f,
        onClick: function () { popScale(this); if (mediaFilter !== f) { mediaFilter = f; scrollAngle = 0; rebuildRing(); buildBar(); } },
        draw: (ctx, cw, ch) => { const c = drawIconChip(ctx, cw, ch, { active, color: TEXT_MUTED }); drawIcon(ctx, icon, cw, ch, c); } });
    });
    makeEl('a-text', { id: 'focusName', value: currentPerf ? currentPerf.name : '', align: 'right', color: TEXT, position: `${half - 0.2} ${y} 0.011`, width: '1.5', 'wrap-count': '30', font: 'roboto' }, bar);
  }

  function buildPlayerControls(half, bh) {
    const isz = 0.3, y1 = bh / 2 - 0.31, y2 = -bh / 2 + 0.17;
    const item = displayList()[playerIndex];
    const isVid = item && item.type === 'video';
    // row 1: transport + zoom (resize) controls
    canvasPlane(bar, { w: isz, h: isz, x: -half + 0.28, y: y1, clickable: true, name: 'back', onClick: function () { popScale(this); closePlayer(); }, draw: (ctx, cw, ch) => drawIcon(ctx, 'back', cw, ch, '#cfe3f5') });
    canvasPlane(bar, { w: isz, h: isz, x: -0.75, y: y1, clickable: true, name: 'prevMedia', onClick: function () { popScale(this); stepMedia(-1); }, draw: (ctx, cw, ch) => drawIcon(ctx, 'arrowLeft', cw, ch, playerIndex > 0 ? '#fff' : '#454d5b') });
    if (isVid) canvasPlane(bar, { w: isz, h: isz, x: -0.4, y: y1, clickable: true, name: 'playpause', onClick: function () { popScale(this); togglePlay(); }, draw: (ctx, cw, ch) => { drawPill(ctx, cw, ch, ACCENT, 0.95); drawIcon(ctx, (!videoEl || videoEl.paused) ? 'play' : 'pause', cw, ch, '#fff'); } });
    canvasPlane(bar, { w: isz, h: isz, x: -0.05, y: y1, clickable: true, name: 'nextMedia', onClick: function () { popScale(this); stepMedia(1); }, draw: (ctx, cw, ch) => drawIcon(ctx, 'arrowRight', cw, ch, playerIndex < displayList().length - 1 ? '#fff' : '#454d5b') });
    canvasPlane(bar, { w: isz, h: isz, x: 0.45, y: y1, clickable: true, name: 'zoomout', onClick: function () { popScale(this); zoomPlayer(0.8); }, draw: (ctx, cw, ch) => drawIcon(ctx, 'minus', cw, ch, '#cfe3f5') });
    canvasPlane(bar, { w: isz, h: isz, x: 0.83, y: y1, clickable: true, name: 'zoomin', onClick: function () { popScale(this); zoomPlayer(1.25); }, draw: (ctx, cw, ch) => drawIcon(ctx, 'plus', cw, ch, '#cfe3f5') });
    // VR toggle: render the video as side-by-side 180° (each eye = one half of the frame)
    if (isVid) canvasPlane(bar, { w: isz, h: isz, x: half - 0.3, y: y1, clickable: true, name: 'vrMode', onClick: function () { popScale(this); toggleVRVideo(); }, draw: (ctx, cw, ch) => { if (vrVideoMode) drawPill(ctx, cw, ch, ACCENT, 0.95); drawIcon(ctx, 'vr', cw, ch, vrVideoMode ? '#fff' : '#cfe3f5'); } });
    // row 2: scrub bar (video only) — clickable track + accent fill + time text
    if (isVid) {
      const track = makeEl('a-entity', { class: 'clickable', 'data-name': 'scrub', position: `0 ${y2} 0.011` }, bar);
      makeEl('a-entity', { rounded: `width: ${TRACK_W}; height: 0.05; radius: 0.025; color: #2a2f3a` }, track);
      track.__trackW = TRACK_W;
      track.__seek = (frac) => { if (videoEl && videoEl.duration) videoEl.currentTime = Math.max(0, Math.min(videoEl.duration - 0.2, frac * videoEl.duration)); };
      wireScrubSeek(track, TRACK_W);
      const fill = makeEl('a-entity', { position: `0 ${y2} 0.013` }, bar);
      makeEl('a-entity', { rounded: `width: ${TRACK_W}; height: 0.05; radius: 0.025; color: ${ACCENT}` }, fill);
      scrubFillEl = fill;
      scrubFillEl.__trackW = TRACK_W;
      scrubFillEl.__baseX = 0;
      scrubTimeEl = makeEl('a-text', { value: '0:00 / 0:00', align: 'center', color: '#cdd6e4', position: `0 ${y2 + 0.12} 0.012`, width: '0.9', 'wrap-count': '16', font: 'roboto' }, bar);
      updateScrubUI();
    }
  }

  function updateScrubUI() {
    if (!scrubFillEl || !videoEl) return;
    const d = videoEl.duration || 0, c = videoEl.currentTime || 0;
    const p = d ? Math.max(0, Math.min(1, c / d)) : 0;
    const tw = scrubFillEl.__trackW || TRACK_W;
    const baseX = scrubFillEl.__baseX || 0;
    scrubFillEl.object3D.scale.x = Math.max(0.0001, p);
    scrubFillEl.object3D.position.x = baseX - tw / 2 + (tw * p) / 2;
    if (scrubTimeEl) scrubTimeEl.setAttribute('value', `${fmtTime(c)} / ${fmtTime(d)}`);
  }
  // Wire click-to-seek on a scrub track. A-Frame's cursor click carries intersection.point in
  // world space; map it to the track's local x → a 0..1 fraction and seek the video.
  function wireScrubSeek(trackEl, trackW) {
    if (!trackEl) return;
    trackEl.addEventListener('click', (evt) => {
      if (!videoEl || !videoEl.duration) return;
      const point = evt && evt.detail && evt.detail.intersection && evt.detail.intersection.point;
      if (!point) return;
      const local = trackEl.object3D.worldToLocal(point.clone());
      const frac = Math.max(0, Math.min(1, local.x / trackW + 0.5));
      videoEl.currentTime = Math.max(0, Math.min(videoEl.duration - 0.2, frac * videoEl.duration));
      setDebug(`scrub ${Math.round(frac * 100)}%`);
    });
  }

  // ---- Ring cards (virtualized) ----
  function disposeObj3D(o) {
    if (!o) return;
    o.traverse((n) => {
      if (n.geometry) n.geometry.dispose();
      if (n.material) { if (n.material.map) n.material.map.dispose(); n.material.dispose(); }
    });
  }

  function buildColumn(col) {
    const items = displayList(), N = items.length;
    const colEl = makeEl('a-entity', {}, ring);
    for (let row = 0; row < ROWS; row++) {
      const idx = mod(col * ROWS + row, N);
      const item = items[idx];
      const y = ((ROWS - 1) / 2 - row) * ROW_SPACING;
      const card = makeEl('a-entity', { class: 'clickable', 'data-name': view === 'detail' ? (item.name || item.type) : (item.name || 'Unknown'), position: `0 ${y} 0` }, colEl);
      card.setAttribute('data-index', String(idx));
      makeEl('a-entity', { rounded: `width: ${CARD_W}; height: ${CARD_H}; radius: 0.05; color: ${CARD_BG}` }, card);
      const thumb = makeEl('a-entity', { position: '0 0 0.01' }, card);
      if (view === 'detail') {
        const url = item.type === 'video' ? `/api/files/video-thumbnail?path=${encodeURIComponent(item.path)}` : `/api/files/raw?path=${encodeURIComponent(item.path)}`;
        containImage(thumb, url, CARD_W - 0.04, CARD_H - 0.04);
        if (item.type === 'video') canvasPlane(card, { w: 0.3, h: 0.3, x: 0, y: 0, draw: (ctx, cw, ch) => { drawPill(ctx, cw, ch, '#000', 0.45); drawIcon(ctx, 'play', cw, ch, '#fff'); } });
        card.addEventListener('click', () => { popScale(card); openPlayer(idx); });
      } else {
        // performer card: cover thumbnail + name + rating
        if (item.thumbnail) makeEl('a-entity', { position: '0 0 0.001', rounded: `width: ${CARD_W}; height: ${CARD_H}; radius: 0.05; color: ${CARD_BG}`, 'cover-thumb': `src: /api/files/raw?path=${encodeURIComponent(item.thumbnail)}; ratio: ${CARD_W / CARD_H}` }, card);
        const sh = 0.3, strip = makeEl('a-entity', { position: `0 ${-CARD_H / 2 + sh / 2 + 0.03} 0.02` }, card);
        makeEl('a-entity', { rounded: `width: ${CARD_W - 0.06}; height: ${sh}; radius: 0.04; color: ${CARD_BG_ALT}; opacity: 0.94` }, strip);
        makeEl('a-text', { value: item.name || 'Unknown', align: 'center', color: TEXT, position: `0 ${sh / 2 - 0.08} 0.01`, width: `${CARD_W * 0.92}`, 'wrap-count': '16', font: 'roboto' }, strip);
        const pics = item.pics_count || 0, vids = item.vids_count || 0;
        if (view === 'filterList') {
          // show how much is left to filter (state), and a progress badge
          const uPics = Math.max(0, pics - (item.pics_filtered || 0)), uVids = Math.max(0, vids - (item.vids_filtered || 0));
          makeEl('a-text', { value: `${uPics} pics · ${uVids} vids to filter`, align: 'center', color: ACCENT_WARM, position: `0 ${-sh / 2 + 0.07} 0.01`, width: `${CARD_W * 0.92}`, 'wrap-count': '26', font: 'roboto' }, strip);
          const done = pics + vids - uPics - uVids, total = pics + vids;
          const badge = makeEl('a-entity', { position: `${-CARD_W / 2 + 0.24} ${CARD_H / 2 - 0.13} 0.02` }, card);
          makeEl('a-entity', { rounded: 'width: 0.5; height: 0.18; radius: 0.07; color: #000; opacity: 0.7' }, badge);
          makeEl('a-text', { value: `${total ? Math.round((done / total) * 100) : 0}% done`, align: 'center', color: '#9be08b', position: '0 0 0.01', width: '0.52', 'wrap-count': '10', font: 'roboto' }, badge);
        } else {
          const fun = item.funscript_vids_count || 0;
          makeEl('a-text', { value: `${pics} pics · ${vids} vids · ${fun} fun`, align: 'center', color: TEXT_MUTED, position: `0 ${-sh / 2 + 0.07} 0.01`, width: `${CARD_W * 0.94}`, 'wrap-count': '30', font: 'roboto' }, strip);
          const rating = fmtRating(item.performer_rating);
          const badge = makeEl('a-entity', { position: `${-CARD_W / 2 + 0.2} ${CARD_H / 2 - 0.13} 0.02` }, card);
          makeEl('a-entity', { rounded: 'width: 0.36; height: 0.18; radius: 0.07; color: #000; opacity: 0.7' }, badge);
          makeEl('a-text', { value: rating ? `★ ${rating}` : '★ Rate', align: 'center', color: '#ffeb3b', position: '0 0 0.01', width: '0.36', 'wrap-count': '6', font: 'roboto' }, badge);
        }
        card.addEventListener('click', () => { popScale(card); if (view === 'filterList') enterFiltering(item); else showDetail(item); });
      }
    }
    cols.set(col, colEl);
    return colEl;
  }

  function positionColumn(colEl, col) {
    const a = (col - offset) * STEP_RAD;
    // performer ring sits on its own band (PERF_Y); its cards carry per-row offsets
    const y = view === 'detail' ? CENTER_Y : PERF_Y;
    faceUser(colEl, R_RING * Math.sin(a), y, -R_RING * Math.cos(a));
  }

  function updateRing() {
    const N = displayList().length;
    if (!N) { ring.innerHTML = ''; cols.clear(); return; }
    const lo = Math.floor(offset) - VIS_HALF, hi = Math.floor(offset) + VIS_HALF;
    for (const [col, el] of cols) if (col < lo || col > hi) { disposeObj3D(el.object3D); if (el.parentNode) el.parentNode.removeChild(el); cols.delete(col); }
    for (let col = lo; col <= hi; col++) {
      let el = cols.get(col);
      if (!el) el = buildColumn(col);
      positionColumn(el, col);
    }
    const fn = bar.querySelector('#focusName');
    if (fn && view === 'detail') {
      const items = displayList();
      const it = items[mod(Math.round(offset) * ROWS + 1, items.length)];
      fn.setAttribute('value', it ? (it.name || '') : '');
    }
  }

  function rebuildRing() {
    ring.innerHTML = ''; cols.clear(); tiles.clear();
    if (view === 'detail') { buildMasonryLayout(); updateMasonry(); }
    else updateRing();
  }

  // ---- Detail masonry (variable-width tiles, justified rows) ----
  async function fetchDims(paths) {
    try {
      const r = await fetch('/api/files/dimensions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paths }) });
      const j = await r.json();
      mediaDims = (j && j.dims) || {};
    } catch (e) { console.error('[VR] dims fetch failed', e); mediaDims = {}; }
  }
  function buildMasonryLayout() {
    const items = displayList();
    masonryTiles = [];
    const rowAngle = new Array(M_ROWS).fill(0);
    items.forEach((it, idx) => {
      const d = mediaDims[it.path];
      const ar = d && d[1] ? d[0] / d[1] : M_DEFAULT_AR;
      const tileW = Math.max(0.5, Math.min(2.4, M_ROW_H * ar));
      const row = idx % M_ROWS;
      const angW = (tileW + M_TILE_GAP) / R_RING;
      masonryTiles.push({ idx, item: it, row, tileW, centerAngle: rowAngle[row] + angW / 2 });
      rowAngle[row] += angW;
    });
    masonryMaxAngle = rowAngle.length ? Math.max.apply(null, rowAngle) : 0;
  }
  function buildTile(t) {
    const tile = makeEl('a-entity', { class: 'clickable', 'data-name': t.item.name || t.item.type }, ring);
    makeEl('a-entity', { rounded: `width: ${t.tileW}; height: ${M_ROW_H}; radius: 0.04; color: ${CARD_BG}` }, tile);
    const url = t.item.type === 'video' ? `/api/files/video-thumbnail?path=${encodeURIComponent(t.item.path)}` : `/api/files/raw?path=${encodeURIComponent(t.item.path)}`;
    // slot aspect == image aspect, so cover-fit shows the whole image with no crop
    makeEl('a-entity', { position: '0 0 0.001', rounded: `width: ${t.tileW}; height: ${M_ROW_H}; radius: 0.04; color: ${CARD_BG}`, 'cover-thumb': `src: ${url}; ratio: ${t.tileW / M_ROW_H}` }, tile);
    if (t.item.type === 'video') canvasPlane(tile, { w: 0.26, h: 0.26, x: 0, y: 0, draw: (ctx, cw, ch) => { drawPill(ctx, cw, ch, '#000', 0.45); drawIcon(ctx, 'play', cw, ch, '#fff'); } });
    tile.addEventListener('click', () => { popScale(tile); openPlayer(t.idx); });
    return tile;
  }
  function updateMasonry() {
    if (!masonryTiles.length) { ring.innerHTML = ''; tiles.clear(); return; }
    // If the whole strip fits in view, CENTRE it (so a few items aren't stuck on the left and
    // unreachable). Otherwise anchor at the left and let scroll reveal the rest.
    const shift = masonryMaxAngle <= 2 * M_VIS ? masonryMaxAngle / 2 : M_VIS;
    const front = scrollAngle + shift; // the centerAngle currently straight ahead (a = 0)
    const lo = front - M_VIS - 0.3, hi = front + M_VIS + 0.3;
    const needed = new Set();
    masonryTiles.forEach((t) => { if (t.centerAngle >= lo && t.centerAngle <= hi) needed.add(t.idx); });
    for (const [idx, el] of tiles) if (!needed.has(idx)) { disposeObj3D(el.object3D); el.parentNode && el.parentNode.removeChild(el); tiles.delete(idx); }
    let nearest = null, nd = 1e9;
    masonryTiles.forEach((t) => {
      if (t.centerAngle < lo || t.centerAngle > hi) return;
      let el = tiles.get(t.idx);
      if (!el) { el = buildTile(t); tiles.set(t.idx, el); }
      const a = t.centerAngle - front;
      const y = CENTER_Y + ((M_ROWS - 1) / 2 - t.row) * (M_ROW_H + M_ROW_GAP);
      faceUser(el, R_RING * Math.sin(a), y, -R_RING * Math.cos(a));
      if (Math.abs(a) < nd) { nd = Math.abs(a); nearest = t; }
    });
    const fn = bar.querySelector('#focusName');
    if (fn) fn.setAttribute('value', nearest ? (nearest.item.name || '') : (currentPerf ? currentPerf.name : ''));
  }

  // ---- View transitions ----
  // Shared VR character grid. Renders into `parent`: the live query string on top, then
  // rows of letter/digit keys + ⌫ + Clear. Each key calls onChange with the new string.
  // Reused by both the search panel and the device (Handy code) panel.
  const KB_ROWS = [
    'ABCDEFGHIJ'.split(''),
    'KLMNOPQRST'.split(''),
    ['⌫', ...'UVWXYZ'.split(''), 'Clr'],
  ];
  const KB_NUMS = '0123456789'.split('');
  function vrKeyboard(parent, { query, onChange, nums = false, W }) {
    const kw = 0.16, kh = 0.16, gap = 0.04;
    const colsPerRow = 10;
    const gridW = colsPerRow * kw + (colsPerRow - 1) * gap;
    const startX = -gridW / 2 + kw / 2;
    const rows = nums ? [...KB_ROWS, KB_NUMS] : KB_ROWS;
    // live query readout
    makeEl('a-text', { value: query || (nums ? 'Tap digits…' : 'Tap letters…'), align: 'center', color: TEXT, position: `0 ${(rows.length / 2) * (kh + gap) + 0.04} 0.02`, width: `${W * 0.9}`, 'wrap-count': '30', font: 'roboto' }, parent);
    rows.forEach((row, ri) => {
      const y = (rows.length / 2 - 0.5 - ri) * (kh + gap);
      // centre each row's keys (rows can be shorter than 10)
      const rowStartX = startX + (colsPerRow - row.length) * (kw + gap) / 2;
      row.forEach((k, ci) => {
        const x = rowStartX + ci * (kw + gap);
        const isBack = k === '⌫', isClr = k === 'Clr';
        const b = makeEl('a-entity', { class: 'clickable', position: `${x} ${y} 0.02`, 'data-name': 'kb:' + k }, parent);
        makeEl('a-entity', { rounded: `width: ${kw}; height: ${kh}; radius: 0.03; color: ${isBack || isClr ? CARD_BG_ALT : '#262a33'}` }, b);
        makeEl('a-text', { value: k, align: 'center', color: isBack || isClr ? ACCENT_WARM : TEXT, position: '0 0 0.01', width: `${kw * 0.9}`, 'wrap-count': '4', font: 'roboto' }, b);
        b.addEventListener('click', () => {
          popScale(b);
          let next = query;
          if (isBack) next = next.slice(0, -1);
          else if (isClr) next = '';
          else next += k;
          onChange(next);
        });
      });
    });
  }

  function renderSearchPanel() {
    searchPanel.innerHTML = '';
    const open = showSearch && view === 'gallery';
    searchPanel.setAttribute('visible', open ? 'true' : 'false');
    if (!open) return;
    const W = 2.0, H = 2.4;
    faceUser(searchPanel, 0, CENTER_Y + 0.3, -2.6);
    makeEl('a-entity', { rounded: `width: ${W}; height: ${H}; radius: 0.09; color: ${SURFACE}; opacity: 0.97` }, searchPanel);
    makeEl('a-text', { value: 'SEARCH', align: 'center', color: '#ffffff', position: `0 ${H / 2 - 0.16} 0.01`, width: `${W * 0.85}`, font: 'roboto' }, searchPanel);
    makeEl('a-text', { value: `${displayList().length} matches`, align: 'center', color: TEXT_MUTED, position: `0 ${H / 2 - 0.33} 0.01`, width: `${W * 0.82}`, 'wrap-count': '26', font: 'roboto' }, searchPanel);
    vrKeyboard(searchPanel, { query: searchQuery, onChange: (q) => { searchQuery = q; renderSearchPanel(); buildBar(); offset = 0; rebuildRing(); }, W });
  }

  function renderDevicePanel() {
    devicePanel.innerHTML = '';
    const open = showDevice;
    devicePanel.setAttribute('visible', open ? 'true' : 'false');
    if (!open) return;
    const W = 2.0, H = 2.6;
    faceUser(devicePanel, 0, CENTER_Y + 0.3, -2.6);
    makeEl('a-entity', { rounded: `width: ${W}; height: ${H}; radius: 0.09; color: ${SURFACE}; opacity: 0.97` }, devicePanel);
    makeEl('a-text', { value: 'HANDY DEVICE', align: 'center', color: '#ffffff', position: `0 ${H / 2 - 0.16} 0.01`, width: `${W * 0.85}`, font: 'roboto' }, devicePanel);
    const connected = !!(window.appHandyConnected);
    const sdkOk = !!(window.Handy && window.appHandyIntegration);
    const statusTxt = sdkOk ? (connected ? 'Connected ✓' : 'Enter connection code') : 'Handy SDK not loaded (best-effort on headset)';
    makeEl('a-text', { value: statusTxt, align: 'center', color: sdkOk ? (connected ? C_FUN : TEXT_MUTED) : ACCENT_WARM, position: `0 ${H / 2 - 0.33} 0.01`, width: `${W * 0.85}`, 'wrap-count': '30', font: 'roboto' }, devicePanel);
    vrKeyboard(devicePanel, { query: handyCode, nums: true, onChange: (q) => { handyCode = q; localStorage.setItem('handyCode', q); renderDevicePanel(); }, W });
    // Connect / Disconnect button
    const connectBtn = makeEl('a-entity', { class: 'clickable', position: `0 ${-H / 2 + 0.2} 0.02`, 'data-name': 'handyConnect' }, devicePanel);
    makeEl('a-entity', { rounded: `width: 1.0; height: 0.22; radius: 0.05; color: ${connected ? '#b3402f' : ACCENT}` }, connectBtn);
    makeEl('a-text', { value: connected ? 'Disconnect' : 'Connect', align: 'center', color: '#ffffff', position: '0 0 0.01', width: '0.9', 'wrap-count': '12', font: 'roboto' }, connectBtn);
    connectBtn.addEventListener('click', () => {
      popScale(connectBtn);
      const integ = window.appHandyIntegration;
      if (!integ) { setDebug('Handy SDK not available'); return; }
      if (window.appHandyConnected) { integ.disconnect && integ.disconnect(); }
      else { integ.connect && integ.connect(handyCode); }
      setDebug('handy: ' + (window.appHandyConnected ? 'connected' : 'connect requested'));
    });
  }

  function showGallery() {
    view = 'gallery'; currentPerf = null; offset = 0; mediaFilter = 'all';
    closePlayerMedia(); playerRoot.setAttribute('visible', 'false'); playerRoot.innerHTML = '';
    ring.setAttribute('visible', 'true');
    statusText.setAttribute('value', performers.length ? '' : 'No performers found.');
    buildBar(); rebuildRing(); renderFilterPanel(); renderSearchPanel(); renderDevicePanel();
    buildGenreRing(); loadGenres();
  }

  // ---- Content genre ring (second ring under the performers) ----
  async function getBasePath() {
    if (basePath) return basePath;
    try { const f = await (await fetch('/api/folders')).json(); basePath = (Array.isArray(f) && f[0] && f[0].path) || null; } catch (e) { basePath = null; }
    return basePath;
  }
  async function loadGenres() {
    if (genresLoading || genres.length) { buildGenreRing(); return; }
    genresLoading = true;
    buildGenreRing(); // show the "Loading content by genre…" hint right away
    try {
      const bp = await getBasePath();
      if (!bp) return;
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 40000); // /content/genres does a recursive FS scan (~20s uncached, then cached)
      const r = await fetch(`/api/content/genres?basePath=${encodeURIComponent(bp)}&fast=true`, { signal: ctrl.signal });
      clearTimeout(to);
      const data = await r.json();
      genres = Array.isArray(data) ? data : [];
    } catch (e) { console.error('[VR] genres failed', e); }
    finally { genresLoading = false; if (!destroyed && view === 'gallery') buildGenreRing(); }
  }
  function applyGenreRotation() { if (genreRing.object3D) genreRing.object3D.rotation.y = -offset * GENRE_ROT; }
  function hideGenreRing() { genreRing.setAttribute('visible', 'false'); }
  // collapse all overlay panels (filter/search/device) on view transitions
  function hidePanels() { showFilters = false; showSearch = false; showDevice = false; filterPanel.setAttribute('visible', 'false'); searchPanel.setAttribute('visible', 'false'); devicePanel.setAttribute('visible', 'false'); }
  function buildGenreRing() {
    genreRing.innerHTML = '';
    if (view !== 'gallery') { genreRing.setAttribute('visible', 'false'); return; }
    genreRing.setAttribute('visible', 'true');
    if (!genres.length) {
      // genres take ~20s to scan the first time — show a hint so the ring area isn't just empty
      if (genresLoading) { const h = makeEl('a-text', { value: 'Loading content by genre…', align: 'center', color: '#7d889a', width: '2', 'wrap-count': '30', font: 'roboto' }, genreRing); faceUser(h, 0, GENRE_Y, -GENRE_R); }
      return;
    }
    const N = genres.length;
    // vertical layout inside the card (top -> bottom): avatar, name, chip grid, size.
    // Generous spacing now the cards are wider/taller — nothing should feel squeezed.
    const topY = GENRE_H / 2 - 0.2;        // 0.45
    const avatarR = 0.16;
    const nameY = topY - avatarR - 0.22;   // ~0.07
    const rowH = 0.22, rowGap = 0.06;
    const gridTopY = nameY - 0.16 - rowH / 2;   // top row centre
    const sizeY = -GENRE_H / 2 + 0.16;     // ~-0.49
    const chipW = (GENRE_W - 0.34) / 2, chipH = rowH;
    genres.forEach((g, i) => {
      const ang = (i / N) * Math.PI * 2;
      const x = GENRE_R * Math.sin(ang), z = -GENRE_R * Math.cos(ang);
      const card = makeEl('a-entity', { class: 'clickable', 'data-name': 'genre:' + g.name }, genreRing);
      faceUser(card, x, GENRE_Y, z); // faces the user; spins around them as the ring rotates
      const pics = g.pics || 0, vids = g.vids || 0, fun = g.funscripts || 0, total = pics + vids + fun;
      // body + subtle accent border (matches cinematic content-card spec)
      makeEl('a-entity', { rounded: `width: ${GENRE_W}; height: ${GENRE_H}; radius: 0.07; color: ${CARD_BG}` }, card);
      makeEl('a-entity', { rounded: `width: ${GENRE_W}; height: ${GENRE_H}; radius: 0.07; color: ${ACCENT}; opacity: 0.06` }, card);
      // folder avatar (warm gold circle, like ContentCard's genre-avatar)
      const av = makeEl('a-entity', { position: `0 ${topY - avatarR} 0.01` }, card);
      makeEl('a-entity', { rounded: `width: ${avatarR * 2}; height: ${avatarR * 2}; radius: ${avatarR}; color: ${ACCENT_WARM}` }, av);
      canvasPlane(av, { w: avatarR * 1.1, h: avatarR * 1.1, y: 0.012, draw: (ctx, cw, ch) => drawIcon(ctx, 'folder', cw, ch, '#1a1a1a') });
      // genre name (bold-ish, centered)
      makeEl('a-text', { value: g.name, align: 'center', color: TEXT, position: `0 ${nameY} 0.01`, width: `${GENRE_W * 0.92}`, 'wrap-count': '24', font: 'roboto' }, card);
      // 2x2 stat chip grid: Pics / Vids / Funscripts / Total — color-coded like ContentCard.styles.js
      const chips = [
        { label: 'Pics', val: pics, color: C_PICS, icon: 'photo', r: 0, c: 0 },
        { label: 'Vids', val: vids, color: C_VIDS, icon: 'video', r: 0, c: 1 },
        { label: 'Fun', val: fun, color: C_FUN, icon: 'playcircle', r: 1, c: 0 },
        { label: 'All', val: total, color: C_TOTAL, icon: 'storage', r: 1, c: 1 },
      ];
      chips.forEach((ch) => {
        const cxp = (ch.c === 0 ? -1 : 1) * (chipW / 2 + 0.06);
        const cyp = gridTopY - ch.r * (rowH + rowGap); // gridTopY is the top-row centre
        const chip = makeEl('a-entity', { position: `${cxp} ${cyp} 0.01` }, card);
        makeEl('a-entity', { rounded: `width: ${chipW}; height: ${chipH}; radius: 0.04; color: #22242b; opacity: 0.92` }, chip);
        canvasPlane(chip, { w: 0.1, h: 0.1, x: -chipW / 2 + 0.12, draw: (ctx, cw, chh) => drawIcon(ctx, ch.icon, cw, chh, ch.color) });
        makeEl('a-text', { value: `${ch.label} ${ch.val}`, align: 'left', color: ch.color, position: `${-chipW / 2 + 0.22} 0 0.01`, width: `${chipW}`, 'wrap-count': '12', font: 'roboto' }, chip);
      });
      // size row
      const sizeRow = makeEl('a-entity', { position: `0 ${sizeY} 0.01` }, card);
      canvasPlane(sizeRow, { w: 0.09, h: 0.09, x: -0.18, draw: (ctx, cw, chh) => drawIcon(ctx, 'storage', cw, chh, TEXT_DIM) });
      makeEl('a-text', { value: `${g.size || 0} GB`, align: 'center', color: TEXT_DIM, position: '0.08 0 0.01', width: '1.0', 'wrap-count': '14', font: 'roboto' }, sizeRow);
      card.addEventListener('click', () => { popScale(card); showGenre(g); });
    });
    applyGenreRotation();
  }
  async function showGenre(g) {
    view = 'detail'; currentPerf = { name: g.name, id: null }; media = []; mediaFilter = 'all';
    scrollAngle = 0; mediaDims = {};
    hidePanels(); hideGenreRing();
    closePlayerMedia(); playerRoot.setAttribute('visible', 'false'); playerRoot.innerHTML = '';
    ring.setAttribute('visible', 'true'); ring.innerHTML = ''; cols.clear(); tiles.clear();
    statusText.setAttribute('value', `Loading ${g.name}…`); buildBar();
    const ref = currentPerf;
    try {
      const bp = await getBasePath();
      const r = await fetch(`/api/content/genre/${encodeURIComponent(g.name)}?basePath=${encodeURIComponent(bp)}`);
      const j = await r.json();
      if (destroyed || view !== 'detail' || currentPerf !== ref) return;
      const ext = (u) => decodeURIComponent((u || '').split('path=')[1] || '');
      media = [
        ...(j.vids || []).map((v) => ({ type: 'video', path: ext(v.url), name: v.name, fun: false })),
        ...(j.pics || []).map((p) => ({ type: 'image', path: ext(p.url), name: p.name, fun: false })),
      ].filter((m) => m.path);
      buildBar();
      if (!media.length) { statusText.setAttribute('value', 'No content found.'); return; }
      statusText.setAttribute('value', '');
      rebuildRing(); // show immediately (progressive)
      fetchDims(media.map((m) => m.path)).then(() => { if (!destroyed && view === 'detail' && currentPerf === ref) rebuildRing(); });
    } catch (e) { console.error('[VR] genre load failed', e); if (!destroyed) statusText.setAttribute('value', 'Failed to load genre.'); }
  }

  async function showDetail(perf) {
    view = 'detail'; currentPerf = perf; media = []; mediaFilter = 'all';
    scrollAngle = 0; mediaDims = {};
    hidePanels(); hideGenreRing();
    closePlayerMedia(); playerRoot.setAttribute('visible', 'false'); playerRoot.innerHTML = '';
    ring.setAttribute('visible', 'true'); ring.innerHTML = ''; cols.clear(); tiles.clear();
    statusText.setAttribute('value', `Loading ${perf.name || ''}…`);
    buildBar();
    try {
      const [imgRes, vidRes] = await Promise.all([
        fetch(`/api/performers/${perf.id}/gallery/images?fast=true`),
        fetch(`/api/performers/${perf.id}/gallery/videos?fast=true`),
      ]);
      const imgs = (await imgRes.json()).pics || [];
      // include funscript videos (in a /funscript/ folder) and tag them so they show in Vids AND a Funscripts filter
      const vids = ((await vidRes.json()).vids || []).filter((v) => VIDEO_RE.test(v.path));
      if (destroyed || view !== 'detail' || currentPerf !== perf) return;
      media = [
        ...vids.map((v) => ({ type: 'video', path: v.path, name: v.name, fun: /funscript/i.test(v.path) })),
        ...imgs.map((p) => ({ type: 'image', path: p.path, name: p.name, fun: false })),
      ];
      buildBar();
      if (!media.length) { statusText.setAttribute('value', 'No media found.'); return; }
      statusText.setAttribute('value', '');
      rebuildRing(); // show immediately with default aspect (progressive)
      // refine layout in the background once real dimensions arrive
      fetchDims(media.map((m) => m.path)).then(() => { if (!destroyed && view === 'detail' && currentPerf === perf) rebuildRing(); });
    } catch (e) { console.error('[VR] detail load failed', e); if (!destroyed) statusText.setAttribute('value', 'Failed to load media.'); }
  }

  function openPlayer(index) {
    view = 'player'; playerIndex = index; playerScale = 1;
    ring.setAttribute('visible', 'false'); statusText.setAttribute('value', '');
    buildBar(); renderPlayer();
  }
  function closePlayer() {
    view = 'detail'; vrVideoMode = false; closePlayerMedia();
    playerRoot.setAttribute('visible', 'false'); playerRoot.innerHTML = '';
    ring.setAttribute('visible', 'true');
    buildBar();
  }

  // ---- Keep/Delete FILTER mode ----
  async function enterFilterList() {
    view = 'filterList'; offset = 0; filteringPerf = null; showFilters = false;
    hidePanels(); hideGenreRing();
    closePlayerMedia(); playerRoot.setAttribute('visible', 'false'); playerRoot.innerHTML = '';
    ring.setAttribute('visible', 'true'); ring.innerHTML = ''; cols.clear();
    statusText.setAttribute('value', 'Loading performers to filter…');
    buildBar(); renderFilterPanel();
    try {
      const r = await fetch(`/api/performers/filter?limit=1000&offset=0&sortBy=${encodeURIComponent(filterListSort)}`);
      const j = await r.json();
      const list = (j && j.performers) || (Array.isArray(j) ? j : []);
      if (destroyed || view !== 'filterList') return;
      // only those with something left to filter
      filterPerformers = list.filter((p) => ((p.pics_count || 0) - (p.pics_filtered || 0)) + ((p.vids_count || 0) - (p.vids_filtered || 0)) > 0);
      statusText.setAttribute('value', filterPerformers.length ? '' : 'Nothing left to filter 🎉');
      rebuildRing(); buildBar(); renderFilterPanel(); // rebuild so the count reflects the loaded list
    } catch (e) { console.error('[VR] filter list failed', e); if (!destroyed) statusText.setAttribute('value', 'Failed to load.'); }
  }

  // Stream-first filtering load (mirrors PerformerFilterView.js): fetch 1 file first so
  // triaging starts the instant the first item is ready, then backfill the rest in batches.
  // Cancellation is handled by view/performer-identity guards in fetchFilterBatch + streamFiltering
  // (changing performer sets filteringPerf=null, which makes both bail on the next iteration).
  let filterStreaming = false;
  async function fetchFilterBatch(off, limit = 30) {
    const perf = filteringPerf;
    if (!perf) return;
    const r = await fetch(`/api/filter/files/${perf.id}?type=${fileType}&sortBy=${fileSort}&sortOrder=${fileOrder}&hideKept=true&limit=${limit}&offset=${off}`);
    const j = await r.json();
    if (destroyed || view !== 'filtering' || filteringPerf !== perf) return;
    filterTotal = j.total || (j.files || []).length;
    filterFiles = filterFiles.concat((j.files || []).map((f) => ({ type: f.type === 'video' ? 'video' : 'image', path: f.path, name: f.name })));
  }
  // Background refill — adaptive batch (small while few loaded, then larger), like the main app.
  async function streamFiltering(fromOffset) {
    const perf = filteringPerf;
    if (filterStreaming || !perf) return;
    filterStreaming = true;
    try {
      let off = fromOffset;
      while (!destroyed && view === 'filtering' && filteringPerf === perf && filterFiles.length < filterTotal) {
        const batch = filterFiles.length < 5 ? 5 : 30;
        await fetchFilterBatch(off, batch);
        off += batch;
        // re-render the current frame so newly-needed prefetch/near-end logic stays fresh
        if (view === 'filtering' && filteringPerf === perf) renderFiltering();
        if (filterFiles.length === 0) break; // avoid tight loop on empty result
      }
    } finally { filterStreaming = false; }
  }
  async function enterFiltering(perf) {
    view = 'filtering'; filteringPerf = perf; filterFiles = []; filterIndex = 0; filterTotal = 0; filterBusy = false; filterStreaming = false; playerScale = 1;
    hidePanels();
    ring.setAttribute('visible', 'false'); statusText.setAttribute('value', `Loading ${perf.name}…`);
    buildBar();
    try {
      // FIRST file only — start triaging immediately, then stream the rest in the background
      await fetchFilterBatch(0, 1);
      if (destroyed || view !== 'filtering' || filteringPerf !== perf) return;
      statusText.setAttribute('value', filterFiles.length ? '' : 'Nothing to filter.');
      if (!filterFiles.length) { buildBar(); return; }
      renderFiltering();
      streamFiltering(filterFiles.length); // fire-and-forget backfill
    } catch (e) { console.error('[VR] enterFiltering failed', e); if (!destroyed) statusText.setAttribute('value', 'Failed to load files.'); }
  }
  // re-fetch the current performer's files when the type/sort changes in the overlay
  async function reloadFilteringFiles() {
    if (!filteringPerf) return;
    filterFiles = []; filterIndex = 0; filterTotal = 0; filterStreaming = false;
    statusText.setAttribute('value', 'Loading…');
    try {
      await fetchFilterBatch(0, 1);
      if (destroyed || view !== 'filtering') return;
      statusText.setAttribute('value', filterFiles.length ? '' : 'Nothing to filter (try another type).');
      if (filterFiles.length) { renderFiltering(); streamFiltering(filterFiles.length); }
      else { closePlayerMedia(); playerRoot.setAttribute('visible', 'false'); playerRoot.innerHTML = ''; buildBar(); }
    } catch (e) { console.error('[VR] reload files failed', e); }
  }
  function renderFiltering() {
    const item = filterFiles[filterIndex];
    buildBar();
    renderScreen(item, { isActive: () => filterFiles[filterIndex] === item, onTap: () => { } });
    // prefetch more when near the end of what we have (in addition to the background stream)
    if (filterIndex >= filterFiles.length - 5 && filterFiles.length < filterTotal && !filterStreaming) {
      streamFiltering(filterFiles.length).catch(() => { });
    }
  }
  async function doFilterAction(action) {
    if (filterBusy || !filteringPerf) { setDebug(`${action}: busy=${filterBusy}`); return; }
    const item = filterFiles[filterIndex];
    if (!item) { setDebug(`${action}: no item at ${filterIndex}`); return; }
    filterBusy = true;
    // Flash the screen with the action colour so the user sees WHAT just happened
    flashFilterAction(action);
    try {
      const res = await fetch('/api/filter/action', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ performerId: filteringPerf.id, performerName: filteringPerf.name, basePath: filteringPerf.folder_path, filePath: item.path, action }),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      setDebug(`${action}: ${item.name}`);
      lastFilterAction = action; lastActionAt = performance.now();
      // advance to next remaining file (kept/deleted/moved are hidden)
      filterIndex += 1;
      if (filterIndex >= filterFiles.length) {
        if (filterFiles.length < filterTotal) { await fetchFilterBatch(filterFiles.length); }
      }
      if (filterIndex >= filterFiles.length) {
        // done with this performer
        closePlayerMedia(); playerRoot.setAttribute('visible', 'false'); playerRoot.innerHTML = '';
        statusText.setAttribute('value', `Done filtering ${filteringPerf.name} 🎉`);
        view = 'filterList'; buildBar();
        enterFilterList();
      } else { renderFiltering(); }
    } catch (e) { console.error('[VR] filter action failed', e); setDebug('action failed'); }
    finally { filterBusy = false; }
  }
  // Brief coloured border flash around the screen on keep (green) / delete (red) / funscript (purple).
  function flashFilterAction(action) {
    const colors = { keep: '#2e7d4f', delete: '#b3402f', move_to_funscript: '#7e57c2' };
    const c = colors[action]; if (!c) return;
    const flash = makeEl('a-entity', { rounded: `width: ${SCREEN_W + 0.28}; height: ${SCREEN_H + 0.28}; radius: 0.08; color: ${c}`, position: '0 0 -0.015' }, playerRoot);
    flash.object3D.scale.set(1.02, 1.02, 1.02);
    let t = 0;
    const fade = () => {
      t += 1;
      if (t > 24 || !flash.parentNode) { if (flash.parentNode) flash.parentNode.removeChild(flash); return; }
      flash.getObject3D('mesh').material.opacity = Math.max(0, 0.9 - t / 24);
      requestAnimationFrame(fade);
    };
    setTimeout(fade, 30);
  }
  async function undoFilter() {
    if (filterBusy) return;
    filterBusy = true;
    try {
      const res = await fetch('/api/filter/undo', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
      const j = await res.json().catch(() => ({}));
      if (res.ok) {
        // step back to the undone file (clamped to 0); re-render reloads its media fresh
        filterIndex = Math.max(0, filterIndex - 1);
        setDebug('undo: ' + (j && j.action ? j.action.action : ''));
        lastFilterAction = 'undo'; lastActionAt = performance.now();
        renderFiltering();
      } else { setDebug('undo failed: ' + res.status); }
    } catch (e) { console.error('[VR] undo failed', e); setDebug('undo error'); }
    finally { filterBusy = false; }
  }
  function closeFiltering() {
    closePlayerMedia(); playerRoot.setAttribute('visible', 'false'); playerRoot.innerHTML = '';
    enterFilterList();
  }
  function stepMedia(d) {
    const N = displayList().length;
    const ni = playerIndex + d;
    if (ni < 0 || ni >= N) return;
    playerIndex = ni; buildBar(); renderPlayer();
  }
  function togglePlay() {
    if (!videoEl) return;
    _guarded('playpause', () => {
      // play()/pause() are ASYNC — rebuild the bar only after the state actually settles,
      // otherwise buildBar() reads a stale videoEl.paused and the icon flips right back.
      if (videoEl.paused) {
        videoEl.play().then(() => buildBar()).catch(() => buildBar());
      } else {
        videoEl.pause();
        setTimeout(buildBar, 30);
      }
    });
  }
  function applyPlayerScale() { if (playerRoot.object3D) playerRoot.object3D.scale.setScalar(playerScale); }
  function zoomPlayer(f) { playerScale = Math.max(0.5, Math.min(3, playerScale * f)); applyPlayerScale(); }
  // Toggle VR (side-by-side 180°) viewing for the current video. In VR mode the flat plane is
  // replaced by a large inward-facing sphere segment centered on the viewer so the frame wraps
  // the field of view; the video texture is mapped to fill it (each eye naturally sees its half
  // because the headset renders the sphere from two viewpoints).
  function toggleVRVideo() {
    _guarded('vrvideo', () => {
      vrVideoMode = !vrVideoMode;
      setDebug('VR video mode: ' + (vrVideoMode ? 'ON' : 'off'));
      // Swap the mesh IN PLACE if the video is already loaded (avoid a full reload that restarts it).
      const screen = playerRoot.querySelector('[data-name="screen"]');
      if (screen && videoEl && vrTexCache) {
        if (vrVideoMode) {
          screen.setObject3D('mesh', buildVRSphereMesh(vrTexCache, THREE));
          playerRoot.setAttribute('position', '0 0 0'); playerRoot.setAttribute('rotation', '0 0 0');
          playerScale = 1; applyPlayerScale();
        } else {
          const { w, h } = fitVideo(videoEl.videoWidth, videoEl.videoHeight);
          screen.setObject3D('mesh', new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: vrTexCache })));
          faceUser(playerRoot, 0, PLAYER_Y, -PLAYER_Z);
          applyPlayerScale();
        }
        buildBar();
      } else {
        // no loaded video yet — re-render so it builds with the right mode once metadata arrives
        if (view === 'player') renderPlayer();
        else if (view === 'filtering') renderFiltering();
        else buildBar();
      }
    });
  }
  function closePlayerMedia() {
    if (videoEl) {
      try { videoEl.pause(); } catch (_) { /* ignore */ }
      videoEl.removeAttribute('src'); videoEl.load();
      if (videoEl.parentNode) videoEl.parentNode.removeChild(videoEl);
      videoEl = null;
    }
    vrTexCache = null;
  }
  // Shared flat screen renderer (used by the player AND the keep/delete filter viewer).
  // fit + VR-sphere are module-level so toggleVRVideo can swap meshes without a full reload.
  function fitVideo(iw, ih) { const ar = iw / ih || 16 / 9; let w = SCREEN_W, h = SCREEN_W / ar; if (h > SCREEN_H) { h = SCREEN_H; w = SCREEN_H * ar; } return { w, h }; }
  function buildVRSphereMesh(tex, THREE) {
    const geo = new THREE.SphereGeometry(20, 64, 64, 0, Math.PI, 0, Math.PI);
    const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.scale.x = -1; // un-mirror so text reads correctly
    return mesh;
  }
  function renderScreen(item, { isActive, onTap }) {
    closePlayerMedia(); vrTexCache = null; playerRoot.innerHTML = ''; playerRoot.setAttribute('visible', 'true');
    // In VR-video mode the sphere is centered ON the viewer (not in front), so the frame wraps the FOV.
    if (vrVideoMode && item && item.type === 'video') {
      playerRoot.setAttribute('position', '0 0 0'); playerRoot.setAttribute('rotation', '0 0 0');
    } else {
      faceUser(playerRoot, 0, PLAYER_Y, -PLAYER_Z);
    }
    applyPlayerScale();
    if (!item) return;
    if (!vrVideoMode) makeEl('a-entity', { rounded: `width: ${SCREEN_W + 0.2}; height: ${SCREEN_H + 0.2}; radius: 0.06; color: #000; opacity: 0.95`, position: '0 0 -0.02' }, playerRoot);
    const screen = makeEl('a-entity', { class: 'clickable', 'data-name': 'screen' }, playerRoot);
    const note = makeEl('a-text', { value: 'Loading…', align: 'center', color: TEXT_MUTED, position: '0 0 0.01', width: '1.6', 'wrap-count': '24', font: 'roboto' }, playerRoot);
    const clearNote = () => { if (note.parentNode) note.parentNode.removeChild(note); };
    const fail = (t) => { if (destroyed || !isActive()) return; note.setAttribute('color', '#ff8a8a'); note.setAttribute('value', t); };
    if (item.type === 'image') {
      vrVideoMode = false; // images can't be VR; reset
      new THREE.TextureLoader().load(`/api/files/raw?path=${encodeURIComponent(item.path)}`, (tex) => {
        if (destroyed || !isActive()) return; clearNote();
        if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
        const { w, h } = fitVideo(tex.image.width, tex.image.height);
        screen.setObject3D('mesh', new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex })));
      }, undefined, () => fail("Couldn't load image\n(file missing)"));
      screen.addEventListener('click', () => onTap('image'));
    } else {
      const v = document.createElement('video');
      // muted autoplay is allowed without a gesture in most browsers (incl. Quest); unmuted needs one.
      v.src = videoUrl(item.path); v.muted = true; v.playsInline = true;
      v.setAttribute('playsinline', 'true'); v.setAttribute('webkit-playsinline', 'true');
      v.loop = false; v.preload = 'auto';
      // must be in the DOM & visible enough to decode (2px off-screen keeps it invisible but live)
      v.style.cssText = 'position:absolute;width:2px;height:2px;top:-10px;left:-10px;opacity:0.01;pointer-events:none;';
      document.body.appendChild(v); videoEl = v;
      v.addEventListener('loadedmetadata', () => {
        if (destroyed || videoEl !== v) return; clearNote();
        const vidTex = new THREE.VideoTexture(v);
        vidTex.minFilter = THREE.LinearFilter; vidTex.generateMipmaps = false;
        if (THREE.SRGBColorSpace) vidTex.colorSpace = THREE.SRGBColorSpace;
        vrTexCache = vidTex; // cache so toggleVRVideo can swap the mesh without reloading
        if (vrVideoMode) {
          screen.setObject3D('mesh', buildVRSphereMesh(vidTex, THREE));
        } else {
          const { w, h } = fitVideo(v.videoWidth, v.videoHeight);
          screen.setObject3D('mesh', new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: vidTex })));
        }
      });
      v.addEventListener('error', () => fail("Couldn't load video"));
      v.addEventListener('ended', () => buildBar());
      // Mark the texture dirty each frame while in VR — three.js's VideoTexture auto-updates via a
      // requestAnimationFrame internally, but in an immersive session the page's rAF is PAUSED, so we
      // piggyback on the scene's tick to keep the video frame flowing into the texture.
      if (!window.__vrVideoTick) {
        window.__vrVideoTick = () => { if (vrTexCache && videoEl && videoEl.readyState >= 2) vrTexCache.needsUpdate = true; };
      }
      const tryPlay = () => {
        v.play().then(() => { if (v.muted) { v.muted = false; v.play().catch(() => {}); } buildBar(); })
          .catch(() => {
            // Autoplay blocked (needs a gesture) — prompt the user; tapping the screen retries.
            if (!destroyed && videoEl === v) { note.setAttribute('color', ACCENT_WARM); note.setAttribute('value', 'Tap to play'); }
            buildBar();
          });
      };
      tryPlay();
      // Clicking the video screen always toggles play/pause (the universal expectation).
      screen.addEventListener('click', () => { if (videoEl === v) { popScale(screen); togglePlay(); } });
    }
  }
  function renderPlayer() {
    const item = displayList()[playerIndex];
    renderScreen(item, { isActive: () => displayList()[playerIndex] === item, onTap: (t) => (t === 'image' ? stepMedia(1) : togglePlay()) });
  }

  function showError(msg) {
    statusText.setAttribute('value', ''); ring.innerHTML = ''; cols.clear();
    const panel = makeEl('a-entity', { class: 'clickable' }, world);
    faceUser(panel, 0, CENTER_Y, -R_RING);
    makeEl('a-entity', { rounded: `width: 1.8; height: 0.9; radius: 0.06; color: #14161b; opacity: 0.96` }, panel);
    makeEl('a-text', { value: msg, align: 'center', color: '#ff8a8a', position: '0 0.18 0.01', width: '1.7', 'wrap-count': '34', font: 'roboto' }, panel);
    const retry = makeEl('a-entity', { class: 'clickable', position: '0 -0.18 0.01', 'data-name': 'retry' }, panel);
    makeEl('a-entity', { rounded: `width: 0.5; height: 0.18; radius: 0.05; color: ${ACCENT}` }, retry);
    makeEl('a-text', { value: 'Retry', align: 'center', color: '#fff', position: '0 0 0.01', width: '0.4', 'wrap-count': '8', font: 'roboto' }, retry);
    retry.addEventListener('click', () => { popScale(retry); panel.parentNode && panel.parentNode.removeChild(panel); statusText.setAttribute('value', 'Loading performers…'); loadData(); });
  }

  async function loadData() {
    try {
      const res = await fetch('/api/performers/gallery');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      performers = Array.isArray(data) ? data : [];
      if (destroyed) return;
      applySort();
      setDebug(`${performers.length} performers · push the stick to scroll`);
      showGallery();
    } catch (e) { console.error('[VR] failed to load performers', e); if (!destroyed) showError('Could not load performers.\nIs the backend running on :4069?'); }
  }

  // ---- Raycast (use A-Frame's own ray so hits match the visible laser) ----
  const _o = new THREE.Vector3(), _q = new THREE.Quaternion(), _dir = new THREE.Vector3();
  const raycaster = new THREE.Raycaster(); raycaster.far = 40;
  function rayFromHand(hand) {
    const rcComp = hand.components && hand.components.raycaster;
    const aRay = rcComp && rcComp.raycaster && rcComp.raycaster.ray;
    if (aRay && aRay.direction && (aRay.direction.x || aRay.direction.y || aRay.direction.z)) raycaster.set(aRay.origin, aRay.direction);
    else { const o3 = hand.object3D; o3.getWorldPosition(_o); o3.getWorldQuaternion(_q); _dir.set(0, 0, -1).applyQuaternion(_q).normalize(); raycaster.set(_o, _dir); }
    raycaster.far = 40;
  }
  function rootClickable(obj) { while (obj) { if (obj.el && obj.el.classList && obj.el.classList.contains('clickable')) return obj.el; obj = obj.parent; } return null; }
  // Debounce: a single trigger pull can register as two WebXR 'select' events within ~50-100ms.
  // Key on the stable `data-name` string (NOT the entity reference) — toggle*() calls buildBar(),
  // which recreates the clicked button between the two events, so an identity check misses the
  // duplicate and the toggle flips on then straight back off. 150ms swallows one trigger pull but
  // leaves deliberate repeated clicks (triage keep/delete, paging — >200ms apart) intact.
  let lastClickName = null, lastClickTime = 0;
  function clickFromHand(hand, label) {
    rayFromHand(hand);
    const objs = Array.from(document.querySelectorAll('.clickable')).map((e) => e.object3D);
    const hits = raycaster.intersectObjects(objs, true);
    if (!hits.length) { setDebug(`select(${label}) -> no target`); return; }
    const target = rootClickable(hits[0].object);
    if (!target) { setDebug(`select(${label}) -> no target`); return; }
    const tName = target.getAttribute('data-name') || '';
    const now = performance.now();
    const delta = lastClickTime ? (now - lastClickTime) : 0;
    // Suppress repeat hits on the SAME control within 280ms — a single Quest trigger pull can
    // throw 2-4 'select' events spread across ~200ms (selectstart/selectend + runtime echoes).
    // Toggles (filter/search/device/vrMode/playpause/back) must collapse to ONE or they flip
    // true→false→true and net to "nothing happened". Action buttons meant for deliberate rapid
    // repeats (triage keep/delete/undo, prev/next media) are exempt.
    const isRepeatable = /keepFile|deleteFile|undoFile|nextMedia|prevMedia|scrub/.test(tName);
    if (tName && tName === lastClickName && !isRepeatable && delta < 280) {
      lastClickTime = now; // extend the window so a 3rd/4th echo is also swallowed
      setDebug(`${tName} echo @${Math.round(delta)}ms (swallowed)`);
      return;
    }
    lastClickName = tName; lastClickTime = now;
    // click-to-seek: a scrub track maps the hit's local x to a fraction
    if (target.__seek && hits[0].point) {
      const local = target.object3D.worldToLocal(hits[0].point.clone());
      const frac = Math.max(0, Math.min(1, local.x / (target.__trackW || 1) + 0.5));
      setDebug(`scrub ${Math.round(frac * 100)}%`);
      target.__seek(frac);
      return;
    }
    setDebug(`select(${label}) -> ${target.getAttribute('data-name') || 'hit'}`);
    target.emit('click');
  }
  function rayHitsBar(hand) { rayFromHand(hand); return raycaster.intersectObject(bar.object3D, true).length > 0; }

  // ---- Input ----
  let destroyed = false;
  let grabbingHand = null, xrSession = null;
  let onSel = null, onSqStart = null, onSqEnd = null;
  const thumbPressed = { left: false, right: false };
  let stepLatch = false;
  let scrubbing = false, wasPlaying = false, scrubTarget = 0;
  const abLatch = { a: false, b: false }; // A/X=keep, B/Y=delete during filtering

  let xrInputAttached = false; // guard against double-binding if enter-vr fires more than once
  function attachXRInput() {
    if (xrInputAttached) detachXRInput(); // clean any previous binding first
    const xr = scene.renderer && scene.renderer.xr;
    xrSession = xr && xr.getSession && xr.getSession();
    if (!xrSession) return;
    // WebXR 'select' (trigger pull) is our ONLY reliable click source — the A-Frame cursor
    // component's click on these entities is unreliable in practice. We raycast ourselves.
    onSel = (e) => { const hand = e.inputSource && e.inputSource.handedness === 'left' ? leftHand : rightHand; clickFromHand(hand, (e.inputSource && e.inputSource.handedness) || '?'); };
    onSqStart = (e) => { const hand = e.inputSource && e.inputSource.handedness === 'left' ? leftHand : rightHand; if (rayHitsBar(hand)) { grabbingHand = hand; hand.object3D.attach(bar.object3D); setDebug('grab bar'); } else { if (window.__recenter) window.__recenter(); setDebug('recenter (grip)'); } };
    onSqEnd = () => { if (grabbingHand) { world.object3D.attach(bar.object3D); grabbingHand = null; setDebug('drop bar'); } };
    xrSession.addEventListener('select', onSel);
    xrSession.addEventListener('squeezestart', onSqStart);
    xrSession.addEventListener('squeezeend', onSqEnd);
    xrInputAttached = true;
  }
  function detachXRInput() {
    if (xrSession) { if (onSel) xrSession.removeEventListener('select', onSel); if (onSqStart) xrSession.removeEventListener('squeezestart', onSqStart); if (onSqEnd) xrSession.removeEventListener('squeezeend', onSqEnd); }
    xrSession = null; onSel = onSqStart = onSqEnd = null; xrInputAttached = false;
  }

  // Read a controller's thumbstick (xr-standard: axes[2]=X, axes[3]=Y; fallback [0],[1]).
  function readStick(gp) {
    if (!gp || !gp.axes) return [0, 0];
    const x = gp.axes.length >= 4 ? gp.axes[2] : gp.axes[0] || 0;
    const y = gp.axes.length >= 4 ? gp.axes[3] : gp.axes[1] || 0;
    const dz = (v) => (Math.abs(v) < 0.18 ? 0 : v);
    return [dz(x), dz(y)];
  }

  window.__vrTick = function (t, dt) {
    const sec = Math.min(0.05, (dt || 16) / 1000);
    if ((view === 'player' || view === 'filtering') && videoEl) updateScrubUI(); // keep the scrub bar live
    // keep the video texture fed during an immersive session (page rAF is paused there)
    if (window.__vrVideoTick) window.__vrVideoTick();
    // keep the video texture fed during an immersive session (page rAF is paused there)
    if (window.__vrVideoTick) window.__vrVideoTick();
    if (!xrSession) return;
    let sx = 0, sy = 0, aDown = false, bDown = false;
    for (const src of xrSession.inputSources) {
      const gp = src.gamepad; if (!gp || !gp.buttons) continue;
      const hand = src.handedness === 'left' ? 'left' : 'right';
      // thumbstick press -> recenter (edge)
      const pr = !!(gp.buttons[3] && gp.buttons[3].pressed);
      if (pr && !thumbPressed[hand]) { thumbPressed[hand] = true; if (window.__recenter) window.__recenter(); setDebug('recenter'); }
      else if (!pr && thumbPressed[hand]) thumbPressed[hand] = false;
      if (gp.buttons[4] && gp.buttons[4].pressed) aDown = true; // A / X
      if (gp.buttons[5] && gp.buttons[5].pressed) bDown = true; // B / Y
      const [ax, ay] = readStick(gp);
      if (Math.abs(ax) > Math.abs(sx)) sx = ax;
      if (Math.abs(ay) > Math.abs(sy)) sy = ay;
    }
    if (view === 'filtering') {
      // A/X = keep, B/Y = delete (edge-triggered)
      if (aDown && !abLatch.a) { abLatch.a = true; doFilterAction('keep'); } else if (!aDown) abLatch.a = false;
      if (bDown && !abLatch.b) { abLatch.b = true; doFilterAction('delete'); } else if (!bDown) abLatch.b = false;
      // Y -> scrub the triage video (same throttled seek as the player, so seeks don't stall)
      if (videoEl && videoEl.duration && Math.abs(sy) > 0.05) {
        if (!scrubbing) { scrubbing = true; wasPlaying = !videoEl.paused; try { videoEl.pause(); } catch (_) { /* ignore */ } scrubTarget = videoEl.currentTime; }
        scrubTarget = Math.max(0, Math.min(videoEl.duration - 0.3, scrubTarget - sy * SCRUB_RATE * sec));
        if (!videoEl.seeking) videoEl.currentTime = scrubTarget;
      } else if (scrubbing) {
        scrubbing = false;
        if (wasPlaying && videoEl) videoEl.play().catch(() => {});
        buildBar();
      }
    }
    if (view === 'player') {
      // X -> prev/next (edge), Y -> scrub
      if (sx > 0.6 && !stepLatch) { stepLatch = true; stepMedia(1); }
      else if (sx < -0.6 && !stepLatch) { stepLatch = true; stepMedia(-1); }
      else if (Math.abs(sx) < 0.3) stepLatch = false;
      // Scrub: pause while scrubbing, seek THROTTLED (only when not already seeking) so seeks don't
      // pile up and stall the decoder (the "video stops working" bug); clamp short of the end.
      if (videoEl && videoEl.duration && Math.abs(sy) > 0.05) {
        if (!scrubbing) { scrubbing = true; wasPlaying = !videoEl.paused; try { videoEl.pause(); } catch (_) { /* ignore */ } scrubTarget = videoEl.currentTime; }
        scrubTarget = Math.max(0, Math.min(videoEl.duration - 0.3, scrubTarget - sy * SCRUB_RATE * sec));
        if (!videoEl.seeking) videoEl.currentTime = scrubTarget;
      } else if (scrubbing) {
        scrubbing = false;
        if (wasPlaying && videoEl) videoEl.play().catch(() => {});
        buildBar();
      }
    } else if (view !== 'filtering' && sx !== 0) {
      if (view === 'detail') {
        const maxScroll = Math.max(0, masonryMaxAngle - 2 * M_VIS);
        scrollAngle = Math.max(0, Math.min(maxScroll, scrollAngle + sx * M_SCROLL * sec));
        updateMasonry();
      } else {
        offset += sx * SCROLL_SPEED * sec;
        updateRing();
        if (view === 'gallery') applyGenreRotation(); // spin the genre ring with the same stick
      }
    }
  };

  // desktop verification hook (no controllers there)
  window.__vrTestScroll = (d) => {
    if (view === 'detail') { scrollAngle = Math.max(0, Math.min(Math.max(0, masonryMaxAngle - 2 * M_VIS), scrollAngle + d)); updateMasonry(); }
    else { offset += d; updateRing(); }
  };

  const onKeyDown = (e) => { if ((e.key === 'r' || e.key === 'R') && window.__recenter) window.__recenter(); };
  const onEnter = () => { attachXRInput(); onEnterVR && onEnterVR(); /* re-assert overlay visibility so it never gets stuck hidden across the XR transition */ renderFilterPanel(); renderSearchPanel(); renderDevicePanel(); };
  const onExit = () => { detachXRInput(); onExitVR && onExitVR(); };
  scene.addEventListener('enter-vr', onEnter);
  scene.addEventListener('exit-vr', onExit);
  leftHand.addEventListener('thumbstickdown', () => { if (window.__recenter) window.__recenter(); });
  rightHand.addEventListener('thumbstickdown', () => { if (window.__recenter) window.__recenter(); });
  window.addEventListener('keydown', onKeyDown);

  const start = () => loadData();
  if (scene.hasLoaded) start(); else scene.addEventListener('loaded', start, { once: true });

  function destroy() {
    destroyed = true; closePlayerMedia();
    window.removeEventListener('keydown', onKeyDown);
    scene.removeEventListener('enter-vr', onEnter);
    scene.removeEventListener('exit-vr', onExit);
    detachXRInput();
    if (window.__vrTick) delete window.__vrTick;
    if (window.__vrTestScroll) delete window.__vrTestScroll;
    if (window.__vrVideoTick) delete window.__vrVideoTick;
    try { if (scene.is && scene.is('vr-mode') && scene.exitVR) scene.exitVR(); } catch (_) { /* ignore */ }
    if (scene.parentNode) scene.parentNode.removeChild(scene);
    if (window.__recenter) delete window.__recenter;
  }

  return { sceneEl: scene, destroy };
}
