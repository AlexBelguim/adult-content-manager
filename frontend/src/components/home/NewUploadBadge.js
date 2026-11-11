/**
 * "New upload · 3 Nov" on a gallery performer card: Leakhaven has an upload she has not been checked off for.
 * A click opens her Leakhaven page in a new tab and never opens her gallery. It does not acknowledge: that stays in
 * Performer Management, and the badge goes on the next gallery load after it.
 */
import React from 'react';
import { Box } from '@mui/material';
import { overlayChipSx } from '../layout';
import { hasNewUpload, newUploadDate, shortDate, longDate } from './performerFacts';

const stop = (e) => e.stopPropagation();

export default function NewUploadBadge({ performer }) {
  if (!performer || !hasNewUpload(performer)) return null;
  const date = newUploadDate(performer);
  const t = date
    ? `New upload on Leakhaven, ${longDate(date)}. Open her Leakhaven page`
    : 'New upload on Leakhaven. Open her Leakhaven page';
  return (
    <Box
      component="a"
      href={performer.leakshaven_url}
      target="_blank"
      rel="noreferrer"
      title={t}
      aria-label={t}
      onClick={stop}
      onMouseDown={stop}
      onAuxClick={stop}
      sx={{
        ...overlayChipSx('var(--accent)'),
        alignSelf: 'flex-start',
        mx: '10px',
        mb: '8px',
        borderColor: 'var(--accent)',
        fontSize: '.75rem',
        fontWeight: 650,
        px: '8px',
        py: '5px',
        gap: 0.5,
        textDecoration: 'none',
        cursor: 'pointer',
        position: 'relative',
        '&:hover': { bgcolor: 'var(--accent-quiet)' },
        '&:focus-visible': { outline: '2px solid var(--accent)', outlineOffset: 2 }
      }}
    >
      New upload
      {date && <Box component="span" sx={{ color: 'var(--dim)', fontWeight: 500 }}>· {shortDate(date)}</Box>}
    </Box>
  );
}
