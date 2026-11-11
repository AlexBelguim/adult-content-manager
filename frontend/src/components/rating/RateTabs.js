/**
 * The tab row of the Rate section: Smart Compare | Group Rate | Rank pictures.
 *
 *   <RateTabs current="compare" | "list" | "pictures" sx? />
 *
 * Each tab replaces the history entry, so Back never walks through the tabs. A compact segmented control that
 * sits at the left of each page's one control row; it scrolls sideways (no scrollbar) if it ever runs out of room.
 */
import React from 'react';
import { Box } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';

const TABS = [
  { id: 'compare', label: 'Smart Compare', to: '/smart-compare' },
  { id: 'list', label: 'Group Rate', to: '/group-rate' },
  { id: 'pictures', label: 'Rank pictures', to: '/ranking-insight' }
];

const itemSx = {
  display: 'inline-flex',
  alignItems: 'center',
  flex: 'none',
  height: 32,
  px: '10px',
  fontSize: '13px',
  fontWeight: 560,
  lineHeight: 1,
  whiteSpace: 'nowrap',
  textDecoration: 'none',
  color: 'var(--dim)',
  transition: 'color .12s ease, background-color .12s ease',
  '& + &': { borderLeft: '1px solid var(--line)' },
  '&:hover': { color: 'var(--text)', bgcolor: 'var(--surface)' },
  '&:focus-visible': { outline: '2px solid var(--accent)', outlineOffset: '-2px' },
  '&[aria-current="page"]': { bgcolor: 'var(--raised)', color: 'var(--text)' }
};

export default function RateTabs({ current, sx = {} }) {
  return (
    <Box
      component="nav"
      aria-label="Rate pages"
      sx={{
        display: 'inline-flex',
        flex: 'none',
        maxWidth: '100%',
        overflowX: 'auto',
        overflowY: 'hidden',
        scrollbarWidth: 'none',
        '&::-webkit-scrollbar': { display: 'none' },
        border: '1px solid var(--line-strong)',
        borderRadius: 'var(--radius)',
        ...sx
      }}
    >
      {TABS.map(t => (
        <Box
          key={t.id}
          component={RouterLink}
          to={t.to}
          replace
          aria-current={t.id === current ? 'page' : undefined}
          sx={itemSx}
        >
          {t.label}
        </Box>
      ))}
    </Box>
  );
}
