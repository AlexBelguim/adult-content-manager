import React from 'react';
import { Box, Typography, Avatar, LinearProgress, Button } from '@mui/material';

/**
 * MobilePerformerList — phone performer rows.
 *
 * Follows the Performer Management card: a small rounded thumbnail on the
 * left, name, then a meta line. Full-bleed hero thumbnails read as a photo
 * feed rather than a list and only fit a couple of performers per screen.
 *
 * Props:
 *  - performers: array
 *  - mode: 'filter' | 'gallery' | 'pairs' — filter rows carry sort progress,
 *    and an outline when the performer also has a folder in After
 *  - search: the search text, for the empty state
 *  - onClearSearch: () => void
 *  - onSelect: (performer) => void
 *  - highlightId: the row just visited, outlined for a moment
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

const EMPTY = {
  filter: 'Nothing left to filter',
  gallery: 'No performers in After yet',
  pairs: 'No performers in After yet'
};

const metaSx = { fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' };
const countSx = { color: 'var(--dim)', fontWeight: 600 };

const barSx = (tone) => ({
  flex: 1, height: 3, borderRadius: 2, bgcolor: 'var(--raised)',
  '& .MuiLinearProgress-bar': { bgcolor: tone }
});

const pct = (v) => Math.max(0, Math.min(100, Math.round(v || 0)));

function MobilePerformerList({ performers, mode, search = '', onClearSearch, onSelect, highlightId = null }) {
  if (!performers || performers.length === 0) {
    const term = search.trim();
    return (
      <Box sx={{ textAlign: 'center', py: 8, px: 3 }}>
        {term ? (
          <>
            <Typography sx={{ fontSize: 14, color: 'var(--dim)', mb: 1.5, overflowWrap: 'anywhere' }}>
              No match for “{term}”
            </Typography>
            {onClearSearch && (
              <Button variant="outlined" onClick={onClearSearch} sx={{ textTransform: 'none', minHeight: 40 }}>
                Clear search
              </Button>
            )}
          </>
        ) : (
          <Typography sx={{ fontSize: 14, color: 'var(--dim)' }}>{EMPTY[mode] || 'No performers'}</Typography>
        )}
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, p: 1 }}>
      {performers.map((p) => {
        const stats = p.filterStats || {};
        const pics = pct(stats.picsCompletion);
        const vids = pct(stats.vidsCompletion);
        // funscriptCompletion reads 100 when there are no scripts at all, so the bar shows only when there are some.
        const hasScripts = (stats.funscriptTotal || 0) > 0;
        const scripts = pct(stats.funscriptCompletion);
        const size = fmtSize(p.total_size_gb);
        const inAfter = mode === 'filter' && !!p.in_after;
        const highlighted = highlightId != null && String(highlightId) === String(p.id);
        const progressLabel = [`Pics ${pics}%`, `Vids ${vids}%`, hasScripts ? `Scripts ${scripts}%` : null]
          .filter(Boolean).join(' · ');

        return (
          <Box
            key={p.id}
            data-performer-id={p.id}
            onClick={() => onSelect(p)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(p); }
            }}
            sx={{
              display: 'flex', alignItems: 'center', gap: 1.25, p: 1,
              bgcolor: 'var(--surface)',
              border: '1px solid',
              borderColor: inAfter ? 'var(--info)' : 'var(--line)',
              boxShadow: inAfter ? 'inset 0 0 0 1px var(--info)' : 'none',
              outline: highlighted ? '2px solid var(--accent)' : 'none',
              outlineOffset: 1,
              borderRadius: 'var(--radius)',
              // .App is a flex column; rows in a nested flex column collapse
              // without this. Same note as the management cards.
              flexShrink: 0,
              cursor: 'pointer',
              '&:active': { borderColor: 'var(--accent)', opacity: 0.85 },
              '&:focus-visible': { outline: '2px solid var(--accent)' }
            }}
          >
            <Avatar
              variant="rounded"
              src={thumbUrl(p)}
              alt=""
              sx={{
                width: 56, height: 56, flexShrink: 0,
                bgcolor: 'var(--raised)', color: 'var(--muted)',
                fontSize: 18, fontWeight: 600,
                borderRadius: 'var(--radius-sm)'
              }}
            >
              {p.name?.[0] || '?'}
            </Avatar>

            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography
                sx={{
                  fontSize: 15, fontWeight: 600, color: 'var(--text)',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
                }}
              >
                {p.name}
              </Typography>

              <Box sx={{ display: 'flex', alignItems: 'center', columnGap: 1.25, mt: 0.25, flexWrap: 'wrap' }}>
                <Typography sx={metaSx}><Box component="span" sx={countSx}>{p.pics_count ?? 0}</Box> pics</Typography>
                <Typography sx={metaSx}><Box component="span" sx={countSx}>{p.vids_count ?? 0}</Box> vids</Typography>
                {size && <Typography sx={metaSx}>{size}</Typography>}
                {inAfter && <Typography sx={{ ...metaSx, color: 'var(--info)', fontWeight: 600 }}>also in After</Typography>}
              </Box>

              {mode === 'filter' && (
                <Box sx={{ mt: 0.75 }}>
                  <Box sx={{ display: 'flex', gap: 0.5 }} aria-hidden="true">
                    <LinearProgress variant="determinate" value={pics} sx={barSx('var(--ok)')} />
                    <LinearProgress variant="determinate" value={vids} sx={barSx('var(--info)')} />
                    {hasScripts && <LinearProgress variant="determinate" value={scripts} sx={barSx('var(--bad)')} />}
                  </Box>
                  <Typography sx={{ ...metaSx, mt: 0.5 }}>{progressLabel}</Typography>
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
