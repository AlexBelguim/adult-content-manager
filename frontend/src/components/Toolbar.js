/**
 * Toolbar — the desktop app bar. Phones never see it (they get PhoneBar and
 * the bottom navigation). No props: everything comes from the route and the
 * shell context.
 *
 * Left: logo (home), Library (at every width), then the other section links
 * from lg up; below lg those fold into More's Pages group. The library's
 * Gallery | Filter switch is the Library page's View list, not the bar.
 * Right: Jobs, the Handy gear and More, in one style (barGhostSx): no border,
 * no box, a hover background, icon and label.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link as RouterLink, useLocation } from 'react-router-dom';
import { AppBar, Toolbar as MuiToolbar, Button, IconButton, Box, Divider, useMediaQuery } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { MoreHoriz } from '@mui/icons-material';
import JobsIndicator, { barGhostSx } from './JobsIndicator';
import Logo from './Logo';
import AppMoreMenu, { navIcon } from './AppMoreMenu';
import { SECTIONS, sectionOf } from '../nav';

/** A text link in the bar: full height, so the active underline sits on the bar's edge. */
const barLinkSx = (active) => ({
  alignSelf: 'stretch',
  minWidth: 0,
  px: 1.25,
  fontSize: 13,
  textTransform: 'none',
  whiteSpace: 'nowrap',
  flexShrink: 0,
  borderRadius: 0,
  fontWeight: active ? 600 : 500,
  color: active ? 'var(--text)' : 'var(--dim)',
  boxShadow: active ? 'inset 0 -2px 0 var(--accent)' : 'none',
  '& .MuiButton-startIcon': { mr: 0.75 },
  '& .MuiButton-startIcon svg': { fontSize: 15 },
  '&:hover': { color: 'var(--text)', bgcolor: 'var(--raised)' },
});

/**
 * Styles the shared Handy element's own chrome away, so the bar item draws the hover (public/handy-control.js stays
 * as is). The compact rule is matched again because ':host([compact]) .hc' outranks '.hc'; the gear takes the item's
 * colour (--bar-fg, set on the item), and the changed-settings dot moves to the smaller gear's corner.
 */
const HANDY_BAR_CSS = '.hc{padding:0;gap:6px;background:transparent;border-color:transparent} .gear{width:24px;height:24px;border:0} '
  + '.gear:hover,.gear.on{background:transparent;border-color:transparent} '
  + ':host([compact]) .hc{padding:0} .gear{color:var(--bar-fg,var(--dim))} .mod{right:0;top:0}';

/**
 * The Handy control in the bar's style: <handy-control compact bare> (its connection dot and gear, with the gear's
 * changed-settings dot), then the label "Handy". A click on the label or around the element opens its settings, like the gear.
 */
function HandyBarItem() {
  const ref = useRef(null);
  const closedAt = useRef(0);

  useEffect(() => {
    let alive = true;
    let tries = 0;
    let frame = 0;
    let panel = null;
    const onToggle = (e) => { if (e.newState === 'closed') closedAt.current = performance.now(); };
    const style = () => {
      if (!alive) return;
      const root = ref.current?.shadowRoot;
      if (!root) {
        tries += 1;
        if (tries < 60) frame = requestAnimationFrame(style);
        return;
      }
      if (!root.querySelector('style[data-acm-bar]')) {
        const el = document.createElement('style');
        el.setAttribute('data-acm-bar', '');
        el.textContent = HANDY_BAR_CSS;
        root.appendChild(el);
      }
      panel = root.querySelector('.hs');
      panel?.addEventListener('toggle', onToggle);
    };
    if (window.customElements?.whenDefined) {
      window.customElements.whenDefined('handy-control').then(style).catch(() => {});
    }
    return () => {
      alive = false;
      if (frame) cancelAnimationFrame(frame);
      panel?.removeEventListener('toggle', onToggle);
    };
  }, []);

  const openPanel = useCallback((e) => {
    const host = ref.current;
    if (!host) return;
    // A click on the element itself is the gear's (or its dot's) own.
    if (e.target === host || host.contains(e.target)) return;
    // The click that light-dismissed the open panel should not open it again.
    if (performance.now() - closedAt.current < 300) return;
    host.shadowRoot?.querySelector('.gear')?.click();
  }, []);

  return (
    <Box
      onClick={openPanel}
      sx={{ ...barGhostSx(false), '--bar-fg': 'var(--dim)', '&:hover': { bgcolor: 'var(--raised)', color: 'var(--text)', '--bar-fg': 'var(--text)' } }}
    >
      {/* Shared with faptap-dl (public/handy-control.js). Compact: the key field lives in its panel. */}
      <handy-control ref={ref} compact="" bare="" />
      <Box component="span" aria-hidden>Handy</Box>
    </Box>
  );
}

export default function Toolbar() {
  const location = useLocation();
  const { pathname } = location;
  const theme = useTheme();
  const belowLg = useMediaQuery(theme.breakpoints.down('lg'));
  const [moreAnchor, setMoreAnchor] = useState(null);

  // Any route change closes the menu.
  useEffect(() => {
    setMoreAnchor(null);
  }, [pathname, location.search]);

  const section = sectionOf(pathname);
  const moreActive =
    section === 'tools' || section === 'system' || section === null || (belowLg && section !== 'library');

  return (
    <AppBar
      position="sticky"
      data-app-bar=""
      elevation={0}
      sx={{
        background: 'var(--surface)',
        bgcolor: 'var(--surface)',
        backgroundImage: 'none',
        color: 'var(--text)',
        borderBottom: '1px solid var(--line)',
        boxShadow: 'none',
      }}
    >
      <MuiToolbar
        disableGutters
        sx={{ minHeight: { xs: 56, sm: 56 }, height: 56, px: 2, gap: 1, flexWrap: 'nowrap', alignItems: 'center' }}
      >
        <IconButton
          component={RouterLink}
          to="/"
          aria-label="Home"
          sx={{
            p: 0.75,
            flexShrink: 0,
            borderRadius: 'var(--radius, 6px)',
            border: '1px solid transparent',
            '&:hover': { bgcolor: 'var(--raised)', borderColor: 'var(--line)' },
          }}
        >
          <Logo size={26} />
        </IconButton>

        <Divider orientation="vertical" flexItem sx={{ mx: 0.25, my: 1.25, borderColor: 'var(--line)' }} />

        {SECTIONS.map((s) => {
          const active = section === s.id;
          return (
            <Button
              key={s.id}
              component={RouterLink}
              to={s.to}
              startIcon={navIcon(s.icon, 15)}
              aria-current={active ? 'page' : undefined}
              sx={{ ...barLinkSx(active), display: s.id === 'library' ? 'inline-flex' : { xs: 'none', lg: 'inline-flex' } }}
            >
              {s.label}
            </Button>
          );
        })}

        <Box sx={{ flex: 1, minWidth: 0 }} />

        <Box sx={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
          <JobsIndicator />
          <HandyBarItem />
          <Button
            id="app-more-button"
            onClick={(e) => setMoreAnchor(e.currentTarget)}
            startIcon={<MoreHoriz />}
            aria-haspopup="true"
            aria-expanded={moreAnchor ? 'true' : 'false'}
            aria-controls={moreAnchor ? 'app-more-menu' : undefined}
            disableRipple
            sx={barGhostSx(moreActive || !!moreAnchor)}
          >
            More
          </Button>
        </Box>
      </MuiToolbar>

      <AppMoreMenu anchorEl={moreAnchor} open={!!moreAnchor} onClose={() => setMoreAnchor(null)} />
    </AppBar>
  );
}
