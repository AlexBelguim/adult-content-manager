// Shared, lazily made pieces for one scene: the unit plane, the glow behind portraits, the round play mark, the
// keep / delete / undo icons and the floor disc. One instance per scene; dispose() frees them all.
import * as THREE from 'three';
import { C, rgba } from './palette';

function canvasTexture(px, draw) {
  const cv = document.createElement('canvas'); cv.width = cv.height = px;
  draw(cv.getContext('2d'), px);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

function iconDraw(kind, color) {
  return (x, px) => {
    const c = px / 2;
    x.fillStyle = color; x.globalAlpha = 0.18;
    x.beginPath(); x.arc(c, c, c * 0.96, 0, Math.PI * 2); x.fill();
    x.globalAlpha = 1; x.strokeStyle = color; x.lineWidth = px * 0.035;
    x.beginPath(); x.arc(c, c, c * 0.93, 0, Math.PI * 2); x.stroke();
    x.lineWidth = px * 0.075; x.lineCap = 'round'; x.lineJoin = 'round';
    x.beginPath();
    if (kind === 'check') { x.moveTo(px * 0.3, px * 0.52); x.lineTo(px * 0.44, px * 0.66); x.lineTo(px * 0.71, px * 0.37); }
    else { x.moveTo(px * 0.34, px * 0.34); x.lineTo(px * 0.66, px * 0.66); x.moveTo(px * 0.66, px * 0.34); x.lineTo(px * 0.34, px * 0.66); }
    x.stroke();
  };
}

export function createAssets() {
  const made = new Map();
  const once = (key, fn) => { if (!made.has(key)) made.set(key, fn()); return made.get(key); };
  return {
    unitPlane: new THREE.PlaneGeometry(1, 1),
    glow: () => once('glow', () => canvasTexture(128, (c) => {
      const g = c.createRadialGradient(64, 52, 4, 64, 60, 64);
      g.addColorStop(0, rgba(C.glowCore, 0.5)); g.addColorStop(0.45, rgba(C.glowMid, 0.22)); g.addColorStop(1, rgba(C.accent, 0));
      c.fillStyle = g; c.fillRect(0, 0, 128, 128);
    })),
    /** a dark disc with a light ring and a play triangle */
    playMark: () => once('play', () => canvasTexture(256, (c) => {
      c.fillStyle = rgba(C.bg, 0.55); c.beginPath(); c.arc(128, 128, 120, 0, 7); c.fill();
      c.strokeStyle = rgba(C.text, 0.9); c.lineWidth = 9; c.stroke();
      c.fillStyle = C.text; c.beginPath(); c.moveTo(102, 76); c.lineTo(186, 128); c.lineTo(102, 180); c.closePath(); c.fill();
    })),
    icon: (kind) => once(`icon-${kind}`, () => canvasTexture(256, iconDraw(kind === 'keep' ? 'check' : 'cross', kind === 'keep' ? C.ok : C.bad))),
    /** a soft radial disc for the floor */
    floor: () => once('floor', () => canvasTexture(512, (c) => {
      const g = c.createRadialGradient(256, 256, 0, 256, 256, 256);
      g.addColorStop(0, rgba(C.floorCore, 1)); g.addColorStop(0.55, rgba(C.floorMid, 0.8)); g.addColorStop(0.8, rgba(C.surface, 0.35)); g.addColorStop(1, rgba(C.bg, 0));
      c.fillStyle = g; c.fillRect(0, 0, 512, 512);
      c.strokeStyle = rgba(C.accent, 0.06); c.lineWidth = 2; c.beginPath(); c.arc(256, 256, 158, 0, 7); c.stroke();
    })),
    dispose() {
      for (const t of made.values()) t.dispose();
      made.clear();
      this.unitPlane.dispose();
    },
  };
}
