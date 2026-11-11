/**
 * FiltersDrawer: the one right-hand filter panel (Home performers, unified gallery).
 *
 * A MUI temporary Drawer, so the modal gives Esc, the focus trap and the scroll
 * lock. The backdrop is transparent: the grid behind stays visible and updates
 * live as filters change. Children are the groups (components/filters/FilterGroups).
 *
 * TriChip is the tri-state chip used by the chip groups: off -> include -> exclude.
 */
import React, { useId } from 'react';
import { Box, Button, ButtonBase, Drawer, IconButton, Tooltip, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import CheckIcon from '@mui/icons-material/Check';
import { SPACE, iconBtnSx } from '../layout';
import { SmallButton } from '../discover/shared';

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

export default function FiltersDrawer({
  open, onClose, title = 'Filters', countLine, hint, onResetAll, resetAllDisabled = false, children
}) {
  const titleId = useId();
  return (
    <Drawer
      anchor="right"
      open={!!open}
      onClose={onClose}
      slotProps={{
        paper: {
          role: 'dialog',
          'aria-modal': true,
          'aria-labelledby': titleId,
          sx: {
            width: 'min(400px, 100vw)', bgcolor: 'var(--surface)', backgroundImage: 'none',
            borderLeft: '1px solid var(--line-strong)', display: 'flex', flexDirection: 'column',
            overflow: 'hidden', color: 'var(--text)'
          }
        },
        backdrop: { sx: { bgcolor: 'transparent' } }
      }}
    >
      <Box sx={{ flex: 'none', p: '14px 16px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'flex-start', gap: SPACE.sm }}>
        <Box sx={{ flex: '1 1 auto', minWidth: 0 }}>
          <Typography id={titleId} component="h2" sx={{ fontSize: '1.15rem', fontWeight: 640, letterSpacing: '-0.015em', lineHeight: 1.3, m: 0 }}>
            {title}
          </Typography>
          {countLine && (
            <Typography aria-live="polite" sx={{ fontSize: '.8rem', color: 'var(--dim)', fontVariantNumeric: 'tabular-nums', mt: 0.25 }}>
              {countLine}
            </Typography>
          )}
        </Box>
        <Tooltip title="Close (Esc)">
          <IconButton
            aria-label="Close"
            onClick={onClose}
            sx={{ ...iconBtnSx(), width: 32, height: 32, minWidth: 32, '& svg': { width: 18, height: 18 } }}
          >
            <CloseIcon />
          </IconButton>
        </Tooltip>
      </Box>

      {hint && (
        <Typography sx={{ flex: 'none', fontSize: '.75rem', color: 'var(--muted)', px: 2, pt: 1.25 }}>
          {hint}
        </Typography>
      )}

      <Box sx={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain', px: 2, pb: 1 }}>
        {children}
      </Box>

      <Box sx={{
        flex: 'none', borderTop: '1px solid var(--line)', p: '12px 16px', pb: 'calc(12px + env(safe-area-inset-bottom))',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: SPACE.sm
      }}>
        {onResetAll ? (
          <SmallButton disabled={resetAllDisabled} onClick={onResetAll}>Reset all</SmallButton>
        ) : <span />}
        <Button variant="contained" size="small" onClick={onClose} sx={{ textTransform: 'none', minWidth: 88 }}>
          Done
        </Button>
      </Box>
    </Drawer>
  );
}
