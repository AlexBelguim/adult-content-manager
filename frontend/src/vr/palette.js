/**
 * The VR screen's colours. They are read from the live tokens on <html> when the scene starts (refreshColors), so VR
 * follows the Darkroom or Instrument set and has one accent. Only opaque tokens are read (three.js colours ignore
 * alpha); a token that is missing or not a plain six-digit colour falls back to the Darkroom value. Every other shade
 * the scene needs (button hovers, frames, the keep / delete tints, canvas rgba) is mixed from those tokens: there are
 * no colour literals in the VR modules.
 */
import { darkroom } from '../styles/tokens';

const KEYS = {
  bg: '--bg',
  surface: '--surface',
  raised: '--raised',
  overlay: '--overlay',
  text: '--text',
  dim: '--dim',
  muted: '--muted',
  faint: '--faint',
  accent: '--accent',
  accentHover: '--accent-hover',
  onAccent: '--on-accent',
  ok: '--ok',
  warn: '--warn',
  bad: '--bad',
  info: '--info',
};

export function readVrPalette() {
  const cs = typeof window !== 'undefined' && window.getComputedStyle
    ? window.getComputedStyle(document.documentElement)
    : null;
  const out = {};
  for (const k of Object.keys(KEYS)) {
    const v = cs ? cs.getPropertyValue(KEYS[k]).trim() : '';
    out[k] = /^#[0-9a-fA-F]{6}$/.test(v) ? v : darkroom[k];
  }
  return out;
}

const rgbOf = (hex) => { const n = parseInt(String(hex).slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
/** a colour t of the way from a to b (hex strings, mixed as they look: in sRGB), as a hex string */
export function mix(a, b, t) {
  const x = rgbOf(a), y = rgbOf(b);
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
}
/** a hex colour as a css rgba() string with alpha a (for canvas drawing) */
export function rgba(hex, a) {
  const [r, g, b] = rgbOf(hex);
  return `rgba(${r},${g},${b},${a})`;
}

/** The scene's colours: filled by refreshColors() when a scene starts. */
export const C = {};

export function refreshColors() {
  const p = readVrPalette();
  Object.assign(C, p, {
    line: mix(p.surface, p.text, 0.1),
    hover: mix(p.raised, p.text, 0.07),
    handle: mix(p.surface, p.text, 0.07),
    handleHover: mix(mix(p.surface, p.text, 0.07), p.accent, 0.16),
    action: mix(p.raised, p.accent, 0.05),
    actionHover: mix(p.raised, p.accent, 0.14),
    keep: mix(p.surface, p.ok, 0.16),
    keepHover: mix(p.surface, p.ok, 0.28),
    keepText: mix(p.ok, p.text, 0.45),
    del: mix(p.surface, p.bad, 0.16),
    delHover: mix(p.surface, p.bad, 0.28),
    delText: mix(p.bad, p.text, 0.45),
    frame: mix(p.bg, p.surface, 0.6),
    rim: mix(mix(p.raised, p.text, 0.12), p.accent, 0.07),
    tileTop: mix(p.raised, p.text, 0.03),
    tileBottom: mix(p.surface, p.bg, 0.3),
    glowCore: mix(p.accent, p.text, 0.6),
    glowMid: mix(p.accent, p.text, 0.3),
    floorCore: mix(p.surface, p.text, 0.08),
    floorMid: mix(p.surface, p.text, 0.04),
  });
  return C;
}

export default readVrPalette;
