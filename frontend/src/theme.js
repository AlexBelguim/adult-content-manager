import { createTheme } from '@mui/material/styles';
import { darkroom, instrument } from './styles/tokens';

// ─── Shared base overrides ──────────────────────────────────────
const baseComponents = (palette, shape) => ({
  MuiPaper: { styleOverrides: { root: { backgroundImage: 'none' } } },
  // The one dialog paper (components/ui/AppDialog). No caller sets its own colours.
  MuiDialog: { styleOverrides: { paper: { padding: '8px', borderRadius: 'var(--radius-lg, 10px)', border: '1px solid var(--line-strong)', backgroundColor: 'var(--surface)', boxShadow: 'var(--shadow-lg)' } } },
});

/**
 * Build an MUI theme from a token set (see styles/tokens.js).
 *
 * Tokens are the source of truth; this only translates them into the shape
 * MUI wants, so a colour is never defined in two places. The same tokens are
 * published as CSS variables by applyTokens(), which is what reaches the
 * `sx`, inline-style and .css call sites MUI's palette cannot see.
 */
const themeFromTokens = (t) => createTheme({
  palette: {
    mode: t.mode,
    primary: { main: t.accent, light: t.accentHover, dark: t.accent, contrastText: t.onAccent },
    // Deliberately identical to primary: this identity has ONE accent. A
    // distinct secondary is what let six palettes drift apart in the first place.
    secondary: { main: t.accent, light: t.accentHover, dark: t.accent, contrastText: t.onAccent },
    background: { default: t.bg, paper: t.surface },
    error: { main: t.bad },
    warning: { main: t.warn },
    info: { main: t.info },
    success: { main: t.ok },
    text: { primary: t.text, secondary: t.dim, disabled: t.muted },
    divider: t.line,
  },
  typography: {
    fontFamily: '"Inter","Roboto","Helvetica","Arial",sans-serif',
    button: { textTransform: 'none', fontWeight: 600 },
    h4: { fontWeight: 640 }, h5: { fontWeight: 600 }, h6: { fontWeight: 600 },
    // This app is full of counts, scores and percentages; tabular figures stop
    // them jittering as values update.
    caption: { fontVariantNumeric: 'tabular-nums' },
  },
  shape: { borderRadius: parseInt(t.radius, 10) },
  components: {
    ...baseComponents({ mode: t.mode }, { borderRadius: parseInt(t.radius, 10) }),
    MuiButton: {
      styleOverrides: {
        root: { borderRadius: t.radius, padding: '7px 14px', boxShadow: 'none' },
        // Flat fills, no gradients — the gradients are a large part of why the
        // old themes read as generic.
        containedPrimary: { background: t.accent, color: t.onAccent, '&:hover': { background: t.accentHover } },
        containedSecondary: { background: t.accent, color: t.onAccent, '&:hover': { background: t.accentHover } },
        outlined: { borderColor: t.lineStrong },
      }
    },
    MuiCard: {
      styleOverrides: {
        root: {
          backgroundImage: 'none', backgroundColor: t.surface,
          borderRadius: t.radiusLg, border: `1px solid ${t.line}`, boxShadow: 'none',
          transition: 'border-color .16s ease, background-color .16s ease',
          '&:hover': { borderColor: t.lineStrong, backgroundColor: t.raised },
        }
      }
    },
    MuiChip: { styleOverrides: { root: { borderRadius: t.radiusSm, fontWeight: 600 } } },
    MuiTextField: {
      styleOverrides: {
        root: {
          '& .MuiOutlinedInput-root': {
            borderRadius: t.radius, backgroundColor: t.bg,
            '& fieldset': { borderColor: t.line },
            '&:hover fieldset': { borderColor: t.lineStrong },
            '&.Mui-focused fieldset': { borderColor: t.accent, borderWidth: '1px' },
          }
        }
      }
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          background: t.surface, backdropFilter: 'blur(12px)',
          borderBottom: `1px solid ${t.line}`, boxShadow: 'none',
        }
      }
    },
    MuiTooltip: {
      styleOverrides: {
        tooltip: { background: t.overlay, color: t.text, border: `1px solid ${t.lineStrong}`, fontSize: '.75rem' }
      }
    },
    // MUI's own default for the dropdown arrow is pure white, which is the
    // only remaining hard white in the app once the source literals are gone.
    MuiSelect: { styleOverrides: { icon: { color: t.dim } } },
    // Alerts derive their own tints from the palette (lightening the main
    // colour), which produces shades that exist nowhere else in the system.
    // Pinned to the quiet tokens so they match every other status surface.
    MuiAlert: {
      styleOverrides: {
        root: { borderRadius: t.radius, border: '1px solid' },
        standardSuccess: { backgroundColor: t.okQuiet, color: t.ok, borderColor: t.ok },
        standardWarning: { backgroundColor: t.warnQuiet, color: t.warn, borderColor: t.warn },
        standardError: { backgroundColor: t.badQuiet, color: t.bad, borderColor: t.bad },
        standardInfo: { backgroundColor: t.infoQuiet, color: t.info, borderColor: t.info },
        icon: { color: 'inherit' }
      }
    },
    MuiMenu: {
      styleOverrides: {
        paper: { backgroundColor: t.surface, border: `1px solid ${t.line}`, backgroundImage: 'none' }
      }
    },
    MuiToggleButton: {
      styleOverrides: {
        root: {
          color: t.dim, borderColor: t.line, textTransform: 'none', fontWeight: 550,
          '&.Mui-selected': {
            color: t.onAccent, backgroundColor: t.accent,
            '&:hover': { backgroundColor: t.accentHover }
          }
        }
      }
    },
  },
});

const darkroomTheme = themeFromTokens(darkroom);
const instrumentTheme = themeFromTokens(instrument);

// ─── Theme registry ─────────────────────────────────────────────
// Both are token-driven: they restyle the whole app because every page reads the same CSS variables.
// The six legacy palettes (default, gamerEdge, gamer, tokyoNight, cinematic, cleanSplit) are retired; a stored
// legacy id becomes 'darkroom' the first time it is read.
export const themes = {
  darkroom:   { label: 'Darkroom',   desc: 'Neutral shell, one ember accent', theme: darkroomTheme,   tokens: darkroom },
  instrument: { label: 'Instrument', desc: 'Cool slate, cyan signal',         theme: instrumentTheme, tokens: instrument },
};

const STORAGE_KEY = 'appTheme';
const DEFAULT_ID = 'darkroom';
const known = (id) => typeof id === 'string' && Object.prototype.hasOwnProperty.call(themes, id);

export const getThemeById = (id) => themes[id]?.theme || darkroomTheme;

/** Token set for a theme id. An unknown id falls back to Darkroom's tokens so
 *  the CSS variables always resolve to something coherent. */
export const getTokensById = (id) => themes[id]?.tokens || darkroom;

/** The theme kept in this browser. A stored unknown or legacy id is replaced by 'darkroom' once. */
export const getStoredThemeId = () => {
  let stored = null;
  try {
    stored = localStorage.getItem(STORAGE_KEY);
  } catch {
    return DEFAULT_ID;
  }
  if (known(stored)) return stored;
  if (stored != null) {
    try { localStorage.setItem(STORAGE_KEY, DEFAULT_ID); } catch { /* storage blocked */ }
  }
  return DEFAULT_ID;
};

export const setStoredThemeId = (id) => {
  try { localStorage.setItem(STORAGE_KEY, known(id) ? id : DEFAULT_ID); } catch { /* storage blocked */ }
};
