/**
 * Design tokens — single source of truth for colour in this app.
 *
 * ── Why CSS variables and not MUI palette paths ──────────────────
 * Styling here happens three different ways: MUI `sx={{}}`, inline
 * `style={{}}`, and plain `.css` files. A theme-palette path (`'text.secondary'`)
 * only resolves in the first. A CSS variable resolves in all three, so the
 * token layer is published as variables on <html> (see applyTokens below) and
 * every call site references `var(--…)`.
 *
 * ── The rule that keeps this coherent ────────────────────────────
 * Pages must NOT invent colours. Before adding a literal, find the token that
 * means what you want. If none exists, add it HERE so every theme gets it.
 * The audit that produced this file found 503 distinct literals across 3,071
 * declarations; that is what happens without this rule.
 */

/* ════════════════════════════════════════════════════════════════
   DARKROOM — the default.

   Content-first: half this app is a wall of thumbnails, and every
   saturated pixel of chrome competes with them. The shell is a pure
   neutral ramp; exactly ONE accent marks what is actionable.
   ════════════════════════════════════════════════════════════════ */
export const darkroom = {
  id: 'darkroom',
  label: 'Darkroom',
  desc: 'Neutral shell, one ember accent — media carries the colour',
  mode: 'dark',

  // Surfaces, back to front
  bg: '#0B0B0C',
  surface: '#141416',
  raised: '#1C1C1F',
  overlay: '#242428',

  // Text ramp
  text: '#EDEDEF',
  dim: '#A1A1A6',
  muted: '#6E6E76',
  faint: '#4A4A52',

  // Hairlines
  line: 'rgba(255,255,255,0.08)',
  lineStrong: 'rgba(255,255,255,0.14)',

  // Translucent surfaces that sit OVER media (card info bars, overlays).
  // These have to keep their alpha so the thumbnail shows through — an
  // opaque surface token would hide the image behind them.
  scrim: 'rgba(16,16,18,0.72)',
  scrimStrong: 'rgba(16,16,18,0.88)',

  // The single accent
  accent: '#F0703A',
  accentHover: '#FF8552',
  accentQuiet: 'rgba(240,112,58,0.14)',
  onAccent: '#1A0E08',

  // Status — deliberately desaturated so the accent stays the loudest thing
  ok: '#5FA97B',
  okQuiet: 'rgba(95,169,123,0.15)',
  warn: '#C9922E',
  warnQuiet: 'rgba(201,146,46,0.15)',
  bad: '#C9564B',
  badQuiet: 'rgba(201,86,75,0.15)',
  info: '#6E8CA8',
  infoQuiet: 'rgba(110,140,168,0.15)',

  // Shadows
  shadowSm: '0 1px 2px rgba(0,0,0,0.45)',
  shadowMd: '0 4px 12px rgba(0,0,0,0.55)',
  shadowLg: '0 14px 36px rgba(0,0,0,0.65)',

  // Chart series — ordered for categorical use, accent first.
  // Distinguishable in greyscale as well as colour.
  chart: ['#F0703A', '#7A8CA3', '#5FA97B', '#C9922E', '#9B7FA6', '#5E9AA8', '#C9564B', '#8A8F98'],

  // Geometry
  radius: '6px',
  radiusSm: '4px',
  radiusLg: '10px'
};

/* ════════════════════════════════════════════════════════════════
   INSTRUMENT — the alternate. Cooler, denser, for the ML screens.
   Kept so the theme switcher has something real to switch to.
   ════════════════════════════════════════════════════════════════ */
export const instrument = {
  id: 'instrument',
  label: 'Instrument',
  desc: 'Cool slate, cyan signal — built for dense numeric screens',
  mode: 'dark',

  bg: '#0E1116',
  surface: '#151A21',
  raised: '#1D242E',
  overlay: '#252E3A',

  text: '#E6EAF0',
  dim: '#98A2B3',
  muted: '#667085',
  faint: '#475467',

  line: 'rgba(255,255,255,0.07)',
  lineStrong: 'rgba(255,255,255,0.13)',

  scrim: 'rgba(12,15,20,0.74)',
  scrimStrong: 'rgba(12,15,20,0.9)',

  accent: '#5CC8FF',
  accentHover: '#7FD6FF',
  accentQuiet: 'rgba(92,200,255,0.14)',
  onAccent: '#04121C',

  ok: '#3DBE8B',
  okQuiet: 'rgba(61,190,139,0.15)',
  warn: '#D8A13A',
  warnQuiet: 'rgba(216,161,58,0.15)',
  bad: '#E56A6A',
  badQuiet: 'rgba(229,106,106,0.15)',
  info: '#7C93B8',
  infoQuiet: 'rgba(124,147,184,0.15)',

  shadowSm: '0 1px 2px rgba(0,0,0,0.5)',
  shadowMd: '0 4px 12px rgba(0,0,0,0.6)',
  shadowLg: '0 14px 36px rgba(0,0,0,0.7)',

  chart: ['#5CC8FF', '#8B93A7', '#3DBE8B', '#D8A13A', '#A98BD1', '#4E8FA8', '#E56A6A', '#7A8494'],

  radius: '3px',
  radiusSm: '2px',
  radiusLg: '6px'
};

export const TOKEN_SETS = { darkroom, instrument };

/**
 * camelCase token key -> --kebab-case CSS variable name.
 * `accentHover` becomes `--accent-hover`.
 */
const toVar = (k) => '--' + k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());

/**
 * Publish a token set as CSS custom properties on <html>.
 *
 * Call sites reference these directly (`color: 'var(--dim)'`), which is what
 * lets a single switch restyle MUI sx, inline styles and .css files at once.
 */
export function applyTokens(tokens) {
  const root = document.documentElement;

  Object.entries(tokens).forEach(([key, value]) => {
    if (key === 'chart') {
      // --chart-0 … --chart-n, plus the raw list for JS consumers (recharts)
      value.forEach((c, i) => root.style.setProperty(`--chart-${i}`, c));
      root.style.setProperty('--chart-count', String(value.length));
      return;
    }
    if (typeof value !== 'string') return;
    if (['id', 'label', 'desc', 'mode'].includes(key)) return;
    root.style.setProperty(toVar(key), value);
  });

  root.setAttribute('data-tokens', tokens.id);
}

/** Chart series array, for recharts and anything else that needs real values. */
export const chartSeries = (tokens = darkroom) => tokens.chart;

export default { darkroom, instrument, TOKEN_SETS, applyTokens, chartSeries };
