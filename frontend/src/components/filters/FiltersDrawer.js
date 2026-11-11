/**
 * TriChip: the tri-state chip of the filter chip groups (off -> include -> exclude). The right-hand filter drawer
 * that used to live here is gone: the filter groups are drawn inline in the sidebar's Show group now (Gallery home
 * performers, unified gallery).
 */
import React from 'react';
import { Box, ButtonBase } from '@mui/material';
import CheckIcon from '@mui/icons-material/Check';

const STATE_WORD = { off: 'off', include: 'included', exclude: 'excluded' };

const CHIP_TONE = {
  off: {
    borderColor: 'var(--line)', color: 'var(--dim)', bgcolor: 'var(--raised)',
    '&:hover': { borderColor: 'var(--line-strong)', color: 'var(--text)' }
  },
  include: { borderColor: 'var(--accent)', color: 'var(--accent)', bgcolor: 'var(--accent-quiet)' },
  exclude: { borderColor: 'var(--bad)', color: 'var(--bad)', bgcolor: 'var(--bad-quiet)' }
};

export function TriChip({ label, count, state = 'off', onClick }) {
  const tone = CHIP_TONE[state] || CHIP_TONE.off;
  const word = STATE_WORD[state] || 'off';
  return (
    <ButtonBase
      onClick={onClick}
      aria-label={`${label}${count != null ? `, ${count}` : ''}: ${word}`}
      sx={{
        display: 'inline-flex', alignItems: 'center', gap: 0.5,
        height: 28, '@media (pointer: coarse)': { height: 36 },
        px: 1.25, borderRadius: 'var(--radius-sm, 4px)', border: '1px solid',
        fontSize: '.76rem', fontWeight: 550, whiteSpace: 'nowrap', fontFamily: 'inherit', maxWidth: '100%',
        opacity: count === 0 ? 0.6 : 1,
        '&.Mui-focusVisible, &:focus-visible': { outline: '2px solid var(--accent)', outlineOffset: 2 },
        ...tone
      }}
    >
      {state === 'include' && <CheckIcon sx={{ fontSize: 14, flex: 'none' }} aria-hidden />}
      <Box component="span" sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', textDecoration: state === 'exclude' ? 'line-through' : 'none' }}>
        {label}
      </Box>
      {count != null && (
        <Box component="span" aria-hidden sx={{ flex: 'none', ml: 0.75, color: 'var(--muted)', fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>
          {count}
        </Box>
      )}
    </ButtonBase>
  );
}

export default TriChip;
