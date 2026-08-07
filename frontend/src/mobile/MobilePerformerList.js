import React from 'react';
import { Box, Typography, Avatar, LinearProgress } from '@mui/material';

/**
 * MobilePerformerList — phone performer rows.
 *
 * Follows the Performer Management card: a small rounded thumbnail on the
 * left, name, then a meta line. Full-bleed hero thumbnails read as a photo
 * feed rather than a list and only fit a couple of performers per screen.
 *
 * Props:
 *  - performers: array
 *  - mode: 'filter' | 'gallery' — filter rows carry sort progress
 *  - onSelect: (performer) => void
 */

// /api/files/preview serves a downscaled copy; /raw would ship the full-size
// original for every row in the list.
const thumbUrl = (p) =>
  p?.thumbnail ? `/api/files/preview?path=${encodeURIComponent(p.thumbnail)}` : undefined;

// The API reports size as total_size_gb, already in gigabytes.
const fmtSize = (gb) => {
  if (!gb) return null;
  if (gb < 1) return `${Math.round(gb * 1024)} MB`;
  return `${gb.toFixed(1)} GB`;
};

const metaSx = { fontSize: '0.78rem', color: 'var(--muted)', whiteSpace: 'nowrap' };

function MobilePerformerList({ performers, mode, onSelect }) {
  if (!performers || performers.length === 0) {
    return (
      <Box sx={{ textAlign: 'center', py: 8, px: 3, color: 'var(--dim)' }}>
        <Typography sx={{ fontWeight: 650, mb: 0.5 }}>No performers</Typography>
        <Typography sx={{ fontSize: '0.85rem' }}>Nothing matches this search.</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, p: 1 }}>
      {performers.map((p) => {
        const stats = p.filterStats || {};
        const pics = Math.round(stats.picsCompletion || 0);
        const vids = Math.round(stats.vidsCompletion || 0);
        const size = fmtSize(p.total_size_gb);

        return (
          <Box
            key={p.id}
            onClick={() => onSelect(p)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter') onSelect(p); }}
            sx={{
              display: 'flex', alignItems: 'center', gap: 1.25, p: 1,
              bgcolor: 'var(--surface)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--radius, 6px)',
              // .App is a flex column; rows in a nested flex column collapse
              // without this. Same note as the management cards.
              flexShrink: 0,
              cursor: 'pointer',
              '&:active': { borderColor: 'var(--accent)', opacity: 0.85 }
            }}
          >
            <Avatar
              variant="rounded"
              src={thumbUrl(p)}
              sx={{
                width: 56, height: 56, flexShrink: 0,
                bgcolor: 'var(--raised)', color: 'var(--muted)',
                fontSize: '1.1rem', fontWeight: 600,
                borderRadius: 'var(--radius-sm, 4px)'
              }}
            >
              {p.name?.[0] || '?'}
            </Avatar>

            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography
                sx={{
                  fontSize: '0.92rem', fontWeight: 620, color: 'var(--text)',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
                }}
              >
                {p.name}
              </Typography>

              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, mt: 0.25, flexWrap: 'wrap' }}>
                <Typography sx={metaSx}><b>{p.pics_count ?? 0}</b> pics</Typography>
                <Typography sx={metaSx}><b>{p.vids_count ?? 0}</b> vids</Typography>
                {size && <Typography sx={metaSx}>{size}</Typography>}
              </Box>

              {mode === 'filter' && (
                <Box sx={{ display: 'flex', gap: 0.5, mt: 0.75 }}>
                  <LinearProgress
                    variant="determinate"
                    value={Math.min(100, pics)}
                    sx={{
                      flex: 1, height: 3, borderRadius: 2, bgcolor: 'var(--raised)',
                      '& .MuiLinearProgress-bar': { bgcolor: 'var(--accent)' }
                    }}
                  />
                  <LinearProgress
                    variant="determinate"
                    value={Math.min(100, vids)}
                    sx={{
                      flex: 1, height: 3, borderRadius: 2, bgcolor: 'var(--raised)',
                      '& .MuiLinearProgress-bar': { bgcolor: 'var(--ok, #4caf50)' }
                    }}
                  />
                </Box>
              )}
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}

export default MobilePerformerList;
