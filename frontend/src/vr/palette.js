/**
 * The VR scene's colours. They are read once per scene from the live tokens on <html>,
 * so VR follows the Darkroom or Instrument set and has one accent. Only opaque tokens are
 * read, because three.js colours ignore alpha. A token that is missing or not a plain
 * six-digit colour falls back to the Darkroom value.
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

export default readVrPalette;
