import { createTheme } from '@mui/material/styles';

// ─── Shared base overrides ──────────────────────────────────────
const baseComponents = (palette, shape) => ({
  MuiPaper: { styleOverrides: { root: { backgroundImage: 'none' } } },
  MuiDialog: { styleOverrides: { paper: { borderRadius: shape.borderRadius * 1.3, padding: '8px' } } },
});

// ══════════════════════════════════════════════════════════════════
//  1. DEFAULT  –  Deep Purple / Teal
// ══════════════════════════════════════════════════════════════════
const defaultTheme = createTheme({
  palette: {
    mode: 'dark',
    primary:    { main: '#7e57c2', light: '#b085f5', dark: '#4d2c91', contrastText: '#fff' },
    secondary:  { main: '#03dac6', light: '#66fff9', dark: '#00a896', contrastText: '#000' },
    background: { default: '#121212', paper: '#1e1e1e' },
    error:   { main: '#cf6679' },
    warning: { main: '#ffb74d' },
    info:    { main: '#29b6f6' },
    success: { main: '#66bb6a' },
    text:    { primary: 'rgba(255,255,255,0.87)', secondary: 'rgba(255,255,255,0.60)' },
    divider: 'rgba(255,255,255,0.12)',
  },
  typography: {
    fontFamily: '"Inter","Roboto","Helvetica","Arial",sans-serif',
    button: { textTransform: 'none', fontWeight: 600 },
    h4: { fontWeight: 600 }, h5: { fontWeight: 500 }, h6: { fontWeight: 500 },
  },
  shape: { borderRadius: 12 },
  components: {
    ...baseComponents({ mode: 'dark' }, { borderRadius: 12 }),
    MuiButton: { styleOverrides: {
      root: { borderRadius: 8, padding: '8px 16px', boxShadow: 'none', transition: 'all 0.2s ease-in-out',
        '&:hover': { boxShadow: '0 4px 12px rgba(0,0,0,0.2)', transform: 'translateY(-1px)' } },
      containedPrimary: { background: 'linear-gradient(135deg, #7e57c2 0%, #5e35b1 100%)',
        '&:hover': { background: 'linear-gradient(135deg, #8e67d2 0%, #6e45c1 100%)' } },
      containedSecondary: { background: 'linear-gradient(135deg, #03dac6 0%, #00b3a6 100%)',
        '&:hover': { background: 'linear-gradient(135deg, #33eac6 0%, #00c3b6 100%)' } },
    }},
    MuiCard: { styleOverrides: { root: {
      backgroundImage: 'none', borderRadius: 16,
      boxShadow: '0 8px 24px rgba(0,0,0,0.12)', border: '1px solid rgba(255,255,255,0.05)',
      transition: 'transform 0.2s, box-shadow 0.2s',
      '&:hover': { transform: 'translateY(-2px)', boxShadow: '0 12px 28px rgba(0,0,0,0.2)' },
    }}},
    MuiTextField: { styleOverrides: { root: { '& .MuiOutlinedInput-root': { borderRadius: 8, transition: 'all 0.2s',
      '&:hover fieldset': { borderColor: 'rgba(255,255,255,0.3)' },
      '&.Mui-focused fieldset': { borderWidth: '2px' } } } }},
    MuiAppBar: { styleOverrides: { root: {
      background: 'rgba(18,18,18,0.8)', backdropFilter: 'blur(12px)',
      borderBottom: '1px solid rgba(255,255,255,0.08)', boxShadow: 'none',
    }}},
  },
});

// ══════════════════════════════════════════════════════════════════
//  2. GAMER EDGE  –  Red / Cyan, sharp, angular
// ══════════════════════════════════════════════════════════════════
const gamerEdgeTheme = createTheme({
  palette: {
    mode: 'dark',
    primary:    { main: '#ff1744', light: '#ff616f', dark: '#c4001d', contrastText: '#fff' },
    secondary:  { main: '#00e5ff', light: '#6effff', dark: '#00b2cc', contrastText: '#000' },
    background: { default: '#0a0a0f', paper: '#12121a' },
    error:   { main: '#ff1744' },
    warning: { main: '#ff9100' },
    info:    { main: '#00e5ff' },
    success: { main: '#00e676' },
    text:    { primary: '#e0e0e0', secondary: 'rgba(255,255,255,0.5)' },
    divider: 'rgba(255,23,68,0.15)',
  },
  typography: {
    fontFamily: '"Rajdhani","Orbitron","Inter",sans-serif',
    button: { textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.08em' },
    h4: { fontWeight: 700, letterSpacing: '0.04em' },
    h5: { fontWeight: 600 }, h6: { fontWeight: 600 },
  },
  shape: { borderRadius: 4 },
  components: {
    ...baseComponents({ mode: 'dark' }, { borderRadius: 4 }),
    MuiButton: { styleOverrides: {
      root: { borderRadius: 2, padding: '8px 20px', boxShadow: 'none',
        clipPath: 'polygon(8px 0, 100% 0, calc(100% - 8px) 100%, 0 100%)',
        transition: 'all 0.15s ease',
        '&:hover': { boxShadow: '0 0 20px rgba(255,23,68,0.4)', transform: 'scale(1.02)' } },
      containedPrimary: { background: 'linear-gradient(135deg, #ff1744 0%, #d50000 100%)',
        '&:hover': { background: 'linear-gradient(135deg, #ff4569 0%, #ff1744 100%)' } },
      containedSecondary: { background: 'linear-gradient(135deg, #00e5ff 0%, #00b8d4 100%)',
        '&:hover': { background: 'linear-gradient(135deg, #18ffff 0%, #00e5ff 100%)' } },
    }},
    MuiCard: { styleOverrides: { root: {
      backgroundImage: 'none', borderRadius: 2, background: '#12121a',
      boxShadow: '0 0 1px rgba(255,23,68,0.3)', border: '1px solid rgba(255,23,68,0.12)',
      transition: 'all 0.2s',
      '&:hover': { border: '1px solid rgba(255,23,68,0.4)', boxShadow: '0 0 20px rgba(255,23,68,0.15)' },
    }}},
    MuiTextField: { styleOverrides: { root: { '& .MuiOutlinedInput-root': { borderRadius: 2,
      '&:hover fieldset': { borderColor: '#ff1744' },
      '&.Mui-focused fieldset': { borderColor: '#00e5ff', borderWidth: '2px' } } } }},
    MuiAppBar: { styleOverrides: { root: {
      background: 'linear-gradient(90deg, rgba(10,10,15,0.95) 0%, rgba(18,18,26,0.95) 100%)',
      backdropFilter: 'blur(12px)',
      borderBottom: '2px solid rgba(255,23,68,0.3)', boxShadow: 'none',
    }}},
    MuiChip: { styleOverrides: { root: { borderRadius: 2 } } },
    MuiDialog: { styleOverrides: { paper: { borderRadius: 4, border: '1px solid rgba(255,23,68,0.2)' } } },
  },
});

// ══════════════════════════════════════════════════════════════════
//  2b. GAMER  –  Orange / green, flat, heavy
// ══════════════════════════════════════════════════════════════════
const gamerTheme = createTheme({
  palette: {
    mode: 'dark',
    primary:    { main: '#f97316', light: '#fb923c', dark: '#ea580c', contrastText: '#fff' },
    secondary:  { main: '#22c55e', light: '#4ade80', dark: '#16a34a', contrastText: '#fff' },
    background: { default: '#0a0a0a', paper: '#111111' },
    error:   { main: '#ef4444' },
    warning: { main: '#f97316' },
    info:    { main: '#38bdf8' },
    success: { main: '#22c55e' },
    text:    { primary: '#e5e5e5', secondary: 'rgba(255,255,255,0.5)' },
    divider: 'rgba(249,115,22,0.15)',
  },
  typography: {
    fontFamily: '"Inter","Roboto","Helvetica",sans-serif',
    button: { textTransform: 'uppercase', fontWeight: 800, letterSpacing: '0.06em' },
    h4: { fontWeight: 900, letterSpacing: '0.03em' },
    h5: { fontWeight: 700 }, h6: { fontWeight: 700 },
  },
  shape: { borderRadius: 2 },
  components: {
    ...baseComponents({ mode: 'dark' }, { borderRadius: 2 }),
    MuiButton: { styleOverrides: {
      root: { borderRadius: 0, padding: '8px 20px', boxShadow: 'none',
        transition: 'all 0.15s ease',
        '&:hover': { boxShadow: '0 0 16px rgba(249,115,22,0.3)', transform: 'scale(1.02)' } },
      containedPrimary: { background: 'linear-gradient(135deg, #f97316 0%, #ea580c 100%)',
        '&:hover': { background: 'linear-gradient(135deg, #fb923c 0%, #f97316 100%)' } },
      containedSecondary: { background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
        '&:hover': { background: 'linear-gradient(135deg, #4ade80 0%, #22c55e 100%)' } },
    }},
    MuiCard: { styleOverrides: { root: {
      backgroundImage: 'none', borderRadius: 0, background: '#111',
      boxShadow: 'none', border: '1px solid #333',
      transition: 'all 0.2s',
      '&:hover': { border: '1px solid #f97316', boxShadow: '0 0 20px rgba(249,115,22,0.15)' },
    }}},
    MuiTextField: { styleOverrides: { root: { '& .MuiOutlinedInput-root': { borderRadius: 0,
      '&:hover fieldset': { borderColor: '#f97316' },
      '&.Mui-focused fieldset': { borderColor: '#22c55e', borderWidth: '2px' } } } }},
    MuiAppBar: { styleOverrides: { root: {
      background: 'rgba(10,10,10,0.95)', backdropFilter: 'blur(12px)',
      borderBottom: '2px solid #f97316', boxShadow: 'none',
    }}},
    MuiChip: { styleOverrides: { root: { borderRadius: 0 } } },
    MuiDialog: { styleOverrides: { paper: { borderRadius: 2, border: '1px solid #333', background: '#111' } } },
  },
});

// ══════════════════════════════════════════════════════════════════
//  3. TOKYO NIGHT  –  Soft blue / purple neon
// ══════════════════════════════════════════════════════════════════
const tokyoNightTheme = createTheme({
  palette: {
    mode: 'dark',
    primary:    { main: '#7aa2f7', light: '#a9c7ff', dark: '#5d7dc4', contrastText: '#1a1b26' },
    secondary:  { main: '#bb9af7', light: '#d4bfff', dark: '#8c6fc4', contrastText: '#1a1b26' },
    background: { default: '#1a1b26', paper: '#24283b' },
    error:   { main: '#f7768e' },
    warning: { main: '#e0af68' },
    info:    { main: '#7dcfff' },
    success: { main: '#9ece6a' },
    text:    { primary: '#c0caf5', secondary: '#565f89' },
    divider: 'rgba(122,162,247,0.1)',
  },
  typography: {
    fontFamily: '"JetBrains Mono","Fira Code","Inter",monospace',
    button: { textTransform: 'none', fontWeight: 600, letterSpacing: '0.02em' },
    h4: { fontWeight: 600 }, h5: { fontWeight: 500 }, h6: { fontWeight: 500 },
  },
  shape: { borderRadius: 8 },
  components: {
    ...baseComponents({ mode: 'dark' }, { borderRadius: 8 }),
    MuiButton: { styleOverrides: {
      root: { borderRadius: 6, padding: '8px 16px', boxShadow: 'none', transition: 'all 0.2s',
        '&:hover': { boxShadow: '0 0 16px rgba(122,162,247,0.25)', transform: 'translateY(-1px)' } },
      containedPrimary: { background: 'linear-gradient(135deg, #7aa2f7 0%, #5d7dc4 100%)',
        '&:hover': { background: 'linear-gradient(135deg, #a9c7ff 0%, #7aa2f7 100%)' } },
      containedSecondary: { background: 'linear-gradient(135deg, #bb9af7 0%, #8c6fc4 100%)',
        '&:hover': { background: 'linear-gradient(135deg, #d4bfff 0%, #bb9af7 100%)' } },
    }},
    MuiCard: { styleOverrides: { root: {
      backgroundImage: 'none', borderRadius: 10, background: '#24283b',
      boxShadow: '0 4px 16px rgba(0,0,0,0.3)', border: '1px solid rgba(122,162,247,0.08)',
      transition: 'all 0.25s ease',
      '&:hover': { border: '1px solid rgba(122,162,247,0.2)', boxShadow: '0 0 24px rgba(122,162,247,0.1)' },
    }}},
    MuiTextField: { styleOverrides: { root: { '& .MuiOutlinedInput-root': { borderRadius: 6,
      '&:hover fieldset': { borderColor: '#7aa2f7' },
      '&.Mui-focused fieldset': { borderColor: '#bb9af7', borderWidth: '2px',
        boxShadow: '0 0 8px rgba(187,154,247,0.2)' } } } }},
    MuiAppBar: { styleOverrides: { root: {
      background: 'rgba(26,27,38,0.85)', backdropFilter: 'blur(16px)',
      borderBottom: '1px solid rgba(122,162,247,0.1)', boxShadow: 'none',
    }}},
    MuiDialog: { styleOverrides: { paper: { borderRadius: 12, border: '1px solid rgba(122,162,247,0.1)',
      background: '#24283b' } } },
  },
});

// ══════════════════════════════════════════════════════════════════
//  4. CINEMATIC  –  Warm gold / burgundy, luxurious
// ══════════════════════════════════════════════════════════════════
const cinematicTheme = createTheme({
  palette: {
    mode: 'dark',
    primary:    { main: '#ffd54f', light: '#ffff81', dark: '#c8a415', contrastText: '#1a1a1a' },
    secondary:  { main: '#ef5350', light: '#ff867c', dark: '#b61827', contrastText: '#fff' },
    background: { default: '#0d0d0d', paper: '#1a1514' },
    error:   { main: '#ef5350' },
    warning: { main: '#ffa726' },
    info:    { main: '#42a5f5' },
    success: { main: '#66bb6a' },
    text:    { primary: '#f5e6d3', secondary: 'rgba(245,230,211,0.5)' },
    divider: 'rgba(255,213,79,0.1)',
  },
  typography: {
    fontFamily: '"Playfair Display","Georgia","Inter",serif',
    button: { textTransform: 'none', fontWeight: 600, fontFamily: '"Inter","Roboto",sans-serif' },
    h4: { fontWeight: 700, letterSpacing: '-0.01em' },
    h5: { fontWeight: 600 }, h6: { fontWeight: 600 },
  },
  shape: { borderRadius: 8 },
  components: {
    ...baseComponents({ mode: 'dark' }, { borderRadius: 8 }),
    MuiButton: { styleOverrides: {
      root: { borderRadius: 6, padding: '8px 20px', boxShadow: 'none', transition: 'all 0.3s ease',
        '&:hover': { boxShadow: '0 4px 20px rgba(255,213,79,0.2)', transform: 'translateY(-1px)' } },
      containedPrimary: { background: 'linear-gradient(135deg, #ffd54f 0%, #c8a415 100%)', color: '#1a1a1a',
        '&:hover': { background: 'linear-gradient(135deg, #ffff81 0%, #ffd54f 100%)' } },
      containedSecondary: { background: 'linear-gradient(135deg, #ef5350 0%, #b61827 100%)',
        '&:hover': { background: 'linear-gradient(135deg, #ff867c 0%, #ef5350 100%)' } },
    }},
    MuiCard: { styleOverrides: { root: {
      backgroundImage: 'none', borderRadius: 8, background: '#1a1514',
      boxShadow: '0 8px 32px rgba(0,0,0,0.4)', border: '1px solid rgba(255,213,79,0.08)',
      transition: 'all 0.3s ease',
      '&:hover': { border: '1px solid rgba(255,213,79,0.2)', boxShadow: '0 12px 40px rgba(255,213,79,0.08)' },
    }}},
    MuiTextField: { styleOverrides: { root: { '& .MuiOutlinedInput-root': { borderRadius: 6,
      '&:hover fieldset': { borderColor: '#ffd54f' },
      '&.Mui-focused fieldset': { borderColor: '#ffd54f', borderWidth: '2px' } } } }},
    MuiAppBar: { styleOverrides: { root: {
      background: 'linear-gradient(180deg, rgba(13,13,13,0.95) 0%, rgba(26,21,20,0.9) 100%)',
      backdropFilter: 'blur(12px)',
      borderBottom: '1px solid rgba(255,213,79,0.12)', boxShadow: 'none',
    }}},
    MuiDialog: { styleOverrides: { paper: { borderRadius: 10,
      border: '1px solid rgba(255,213,79,0.1)', background: '#1a1514' } } },
  },
});

// ══════════════════════════════════════════════════════════════════
//  5. CLEAN SPLIT  –  Mint / minimal, modern
// ══════════════════════════════════════════════════════════════════
const cleanSplitTheme = createTheme({
  palette: {
    mode: 'dark',
    primary:    { main: '#26a69a', light: '#64d8cb', dark: '#00766c', contrastText: '#fff' },
    secondary:  { main: '#78909c', light: '#a7c0cd', dark: '#4b636e', contrastText: '#fff' },
    background: { default: '#101418', paper: '#181c22' },
    error:   { main: '#e57373' },
    warning: { main: '#ffb74d' },
    info:    { main: '#4fc3f7' },
    success: { main: '#81c784' },
    text:    { primary: '#e8eaed', secondary: 'rgba(232,234,237,0.5)' },
    divider: 'rgba(38,166,154,0.1)',
  },
  typography: {
    fontFamily: '"Inter","Roboto","Helvetica",sans-serif',
    button: { textTransform: 'none', fontWeight: 500 },
    h4: { fontWeight: 600 }, h5: { fontWeight: 500 }, h6: { fontWeight: 500 },
  },
  shape: { borderRadius: 16 },
  components: {
    ...baseComponents({ mode: 'dark' }, { borderRadius: 16 }),
    MuiButton: { styleOverrides: {
      root: { borderRadius: 20, padding: '8px 20px', boxShadow: 'none', transition: 'all 0.2s',
        '&:hover': { boxShadow: '0 2px 8px rgba(38,166,154,0.2)', transform: 'translateY(-1px)' } },
      containedPrimary: { background: '#26a69a',
        '&:hover': { background: '#2bbbad' } },
      containedSecondary: { background: '#78909c',
        '&:hover': { background: '#90a4ae' } },
    }},
    MuiCard: { styleOverrides: { root: {
      backgroundImage: 'none', borderRadius: 16, background: '#181c22',
      boxShadow: '0 2px 8px rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.06)',
      transition: 'all 0.2s ease',
      '&:hover': { boxShadow: '0 4px 16px rgba(38,166,154,0.1)', border: '1px solid rgba(38,166,154,0.15)' },
    }}},
    MuiTextField: { styleOverrides: { root: { '& .MuiOutlinedInput-root': { borderRadius: 12,
      '&:hover fieldset': { borderColor: '#26a69a' },
      '&.Mui-focused fieldset': { borderColor: '#26a69a', borderWidth: '2px' } } } }},
    MuiAppBar: { styleOverrides: { root: {
      background: 'rgba(16,20,24,0.9)', backdropFilter: 'blur(12px)',
      borderBottom: '1px solid rgba(38,166,154,0.08)', boxShadow: 'none',
    }}},
    MuiChip: { styleOverrides: { root: { borderRadius: 20 } } },
    MuiDialog: { styleOverrides: { paper: { borderRadius: 20,
      border: '1px solid rgba(255,255,255,0.06)', background: '#181c22' } } },
  },
});

// ─── Theme registry ─────────────────────────────────────────────
export const themes = {
  default:    { label: 'Default',     emoji: '💜', theme: defaultTheme,    desc: 'Deep purple & teal' },
  gamerEdge:  { label: 'Gamer Edge',  emoji: '🎮', theme: gamerEdgeTheme,  desc: 'Red & cyan, sharp angles' },
  gamer:      { label: 'Gamer',       emoji: '🕹️', theme: gamerTheme,      desc: 'Orange & green, flat' },
  tokyoNight: { label: 'Tokyo Night', emoji: '🌃', theme: tokyoNightTheme, desc: 'Blue & purple neon' },
  cinematic:  { label: 'Cinematic',   emoji: '🎬', theme: cinematicTheme,  desc: 'Warm gold & burgundy' },
  cleanSplit: { label: 'Clean Split', emoji: '✨', theme: cleanSplitTheme, desc: 'Mint & minimal' },
};

export const getThemeById = (id) => themes[id]?.theme || defaultTheme;
export const getStoredThemeId = () => localStorage.getItem('appTheme') || 'default';
export const setStoredThemeId = (id) => localStorage.setItem('appTheme', id);

export default defaultTheme;
