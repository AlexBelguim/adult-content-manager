/**
 * The app's own pictures full size: one at a time, prev / next (buttons and the arrow keys), Esc or Back closes.
 * pictures: [{ image, score, tone, name, link }]; the index is clamped to the pictures there are.
 */
import React, { useState } from 'react';
import { Box, Dialog, IconButton, Tooltip } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { ExternalLink } from './shared';
import { TileChip } from './Tile';

const btnSx = {
  width: 40, height: 40, flexShrink: 0, color: 'var(--text)', bgcolor: 'var(--scrim-strong)', border: '1px solid var(--line-strong)',
  borderRadius: 'var(--radius, 6px)', '&:hover': { bgcolor: 'var(--raised)' }, '&.Mui-disabled': { opacity: 0.35, color: 'var(--text)' },
  '&:focus-visible': { outline: '2px solid var(--accent)', outlineOffset: 2 }
};

export default function Lightbox({ open, pictures = [], index = 0, onIndex, onClose }) {
  const n = pictures.length;
  const i = n ? Math.min(n - 1, Math.max(0, Math.floor(Number(index)) || 0)) : 0;
  const p = n ? pictures[i] : null;
  const [failed, setFailed] = useState(null);

  const go = (step) => {
    const next = i + step;
    if (next >= 0 && next < n && onIndex) onIndex(next);
  };
  const onKeyDown = (e) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
  };

  return (
    <Dialog fullScreen open={!!open && n > 0} onClose={onClose} onKeyDown={onKeyDown} aria-label="Picture"
      slotProps={{ paper: { sx: { bgcolor: 'var(--scrim-strong)', backgroundImage: 'none', display: 'flex', flexDirection: 'column', color: 'var(--text)' } } }}>
      {p && (
        <>
          <Box sx={{
            display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, flex: 'none', p: '8px 8px 8px 16px',
            pt: 'calc(8px + env(safe-area-inset-top))', bgcolor: 'var(--surface)', borderBottom: '1px solid var(--line-strong)', fontSize: '.85rem'
          }}>
            <Box component="span" sx={{ flex: 'none', color: 'var(--dim)', fontVariantNumeric: 'tabular-nums' }}>{i + 1} / {n}</Box>
            {p.score != null && <Box sx={{ flex: 'none', display: 'flex' }}><TileChip tone={p.tone}>{p.score}</TileChip></Box>}
            <Box component="span" title={p.name} sx={{ flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {p.name}
            </Box>
            {p.link && <ExternalLink href={p.link} sx={{ flex: 'none', fontSize: '.8rem', whiteSpace: 'nowrap' }}>Open original</ExternalLink>}
            <Tooltip title="Close (Esc)">
              <IconButton onClick={onClose} aria-label="Close" sx={btnSx}><CloseIcon sx={{ fontSize: 20 }} /></IconButton>
            </Tooltip>
          </Box>
          <Box onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }} sx={{
            position: 'relative', flex: '1 1 auto', minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            p: { xs: 1, sm: 2 }, px: { xs: 1, sm: 8 }, pb: { xs: 'calc(8px + env(safe-area-inset-bottom))', sm: 2 }
          }}>
            {failed === p.image
              ? <Box sx={{ color: 'var(--muted)', fontSize: '.85rem' }}>This picture could not be opened.</Box>
              : <Box component="img" key={p.image} src={p.image} alt={p.name || ''} onError={() => setFailed(p.image)}
                  sx={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', display: 'block', borderRadius: 'var(--radius-sm, 4px)' }} />}
            {n > 1 && (
              <>
                <IconButton aria-label="Previous picture" disabled={i === 0} onClick={() => go(-1)}
                  sx={{ ...btnSx, position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)' }}>
                  <ChevronLeftIcon />
                </IconButton>
                <IconButton aria-label="Next picture" disabled={i === n - 1} onClick={() => go(1)}
                  sx={{ ...btnSx, position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)' }}>
                  <ChevronRightIcon />
                </IconButton>
              </>
            )}
          </Box>
        </>
      )}
    </Dialog>
  );
}
