/**
 * Toolbar — the desktop app bar. Phones never see it (they get PhoneBar and
 * the bottom navigation). No props: everything comes from the route and the
 * shell context.
 *
 * Left: logo (home), the Library item (a Gallery | Filter segment on the
 * library lists, a text link elsewhere), then the section links from lg up.
 * Right: jobs, the Handy control and More. Below lg the sections fold into
 * More's Pages group.
 */
import React, { useEffect, useState } from 'react';
import { Link as RouterLink, useLocation } from 'react-router-dom';
import { AppBar, Toolbar as MuiToolbar, Button, IconButton, Box, Divider, useMediaQuery } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { Image, FilterList, MoreHoriz } from '@mui/icons-material';
import JobsIndicator from './JobsIndicator';
import Logo from './Logo';
import AppMoreMenu, { navIcon } from './AppMoreMenu';
import { SECTIONS, sectionOf, libraryState } from '../nav';

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

const segmentSx = (on) => ({
  fontSize: 13,
  px: 1.75,
  minWidth: 0,
  textTransform: 'none',
  whiteSpace: 'nowrap',
  borderRadius: 'var(--radius-sm, 4px)',
  fontWeight: on ? 600 : 500,
  color: on ? 'var(--on-accent)' : 'var(--dim)',
  bgcolor: on ? 'var(--accent)' : 'transparent',
  '&:hover': {
    bgcolor: on ? 'var(--accent-hover)' : 'var(--raised)',
    color: on ? 'var(--on-accent)' : 'var(--text)',
  },
});

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
  const lib = libraryState(pathname);
  const showSegment = !!lib && (lib.list === 'gallery' || lib.list === 'filter') && !lib.galleryId;
  const libraryItem = SECTIONS[0];
  const moreActive =
    section === 'tools' || section === 'system' || section === null || (belowLg && section !== 'library');
  // Mode-switch rule: history holds at most one mode switch.
  const replaceSwitch = !!location.state?.modeSwitch;

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

        {showSegment ? (
          <Box
            role="group"
            aria-label="Library view"
            sx={{
              display: 'flex',
              flexShrink: 0,
              gap: '2px',
              p: '2px',
              bgcolor: 'var(--bg)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--radius, 6px)',
            }}
          >
            {[
              ['gallery', 'Gallery', '/', <Image key="g" />],
              ['filter', 'Filter', '/filter', <FilterList key="f" />],
            ].map(([key, label, to, icon]) => {
              const on = lib.list === key;
              return (
                <Button
                  key={key}
                  component={RouterLink}
                  to={to}
                  replace={replaceSwitch}
                  state={{ modeSwitch: true }}
                  aria-current={on ? 'page' : undefined}
                  startIcon={icon}
                  size="small"
                  disableElevation
                  sx={segmentSx(on)}
                >
                  {label}
                </Button>
              );
            })}
          </Box>
        ) : (
          <Button
            component={RouterLink}
            to={libraryItem.to}
            startIcon={navIcon(libraryItem.icon, 15)}
            aria-current={section === 'library' ? 'page' : undefined}
            sx={barLinkSx(section === 'library')}
          >
            {libraryItem.label}
          </Button>
        )}

        {SECTIONS.filter((s) => s.id !== 'library').map((s) => {
          const active = section === s.id;
          return (
            <Button
              key={s.id}
              component={RouterLink}
              to={s.to}
              startIcon={navIcon(s.icon, 15)}
              aria-current={active ? 'page' : undefined}
              sx={{ ...barLinkSx(active), display: { xs: 'none', lg: 'inline-flex' } }}
            >
              {s.label}
            </Button>
          );
        })}

        <Box sx={{ flex: 1, minWidth: 0 }} />

        <JobsIndicator />

        {/* Shared with faptap-dl (public/handy-control.js). Compact at every width: the key field lives in its panel. */}
        <Box sx={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
          <handy-control compact="" />
        </Box>

        <Button
          id="app-more-button"
          onClick={(e) => setMoreAnchor(e.currentTarget)}
          startIcon={<MoreHoriz />}
          aria-haspopup="true"
          aria-expanded={moreAnchor ? 'true' : 'false'}
          aria-controls={moreAnchor ? 'app-more-menu' : undefined}
          sx={barLinkSx(moreActive)}
        >
          More
        </Button>
      </MuiToolbar>

      <AppMoreMenu anchorEl={moreAnchor} open={!!moreAnchor} onClose={() => setMoreAnchor(null)} />
    </AppBar>
  );
}
