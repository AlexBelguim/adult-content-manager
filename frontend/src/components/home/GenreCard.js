/**
 * One genre of the Gallery home's Genres view: a flat card that is a link to the genre in the unified gallery,
 * with the folder counts, the "+N tagged" counts and the Labels & funscripts control. It fills the height its grid
 * cell gives it (the size row sits at the bottom).
 */
import React from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box, IconButton, Tooltip, Typography } from '@mui/material';
import ViewTimelineIcon from '@mui/icons-material/ViewTimeline';
import PipelineQuickButton from '../PipelineQuickButton';
import { Panel } from '../layout';
import { genreTotals } from './filterModel';

export const genreUrl = (genre, basePath) => (
  `/unified-gallery?genre=${encodeURIComponent(genre.name)}&basePath=${encodeURIComponent(basePath || '')}`
);

/** The card's base width: GenresTab's grid fits as many as fit at it and stretches them to fill the row. */
export const GENRE_CARD_W = 300;
/** The card's natural height (name, counts, size row), for the loading skeleton. */
export const GENRE_CARD_H = 136;

export const formatCount = (n) => Number(n || 0).toLocaleString('en-US');
export const formatSize = (gb) => `${(Number(gb) || 0).toFixed(1)} GB`;

/** Labels & funscripts for the videos in the genre's folder (the job reads that folder only); disabled when it has none. */
export function GenrePipeline({ genre }) {
  const vids = genreTotals(genre).vids;
  if (vids > 0) {
    return (
      <PipelineQuickButton target={{ folders: [genre.name] }} hint={`${formatCount(vids)} videos in ${genre.name}`}
        sx={{ color: 'var(--dim)' }} />
    );
  }
  return (
    <Tooltip title="No videos in this genre">
      <span>
        <IconButton size="small" disabled aria-label="Labels and funscripts">
          <ViewTimelineIcon fontSize="small" />
        </IconButton>
      </span>
    </Tooltip>
  );
}

const COLUMNS = [
  ['pics', 'Pictures'],
  ['vids', 'Videos'],
  ['funscripts', 'Funscripts'],
  ['total', 'Total']
];

export default function GenreCard({ genre, basePath }) {
  const t = genreTotals(genre);
  return (
    <Panel sx={{
      position: 'relative', display: 'flex', flexDirection: 'column', gap: 1.25, p: 1.75, minWidth: 0, containerType: 'inline-size',
      '&:hover': { borderColor: 'var(--line-strong)', bgcolor: 'var(--raised)' },
      '&:focus-within': { outline: '2px solid var(--accent)', outlineOffset: 2 }
    }}>
      <Typography
        component={RouterLink}
        to={genreUrl(genre, basePath)}
        title={genre.name}
        sx={{
          fontSize: '1rem', fontWeight: 620, color: 'var(--text)', textDecoration: 'none',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', outline: 'none',
          '&::after': { content: '""', position: 'absolute', inset: 0, borderRadius: 'inherit' }
        }}
      >
        {genre.name}
      </Typography>

      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 1 }}>
        {COLUMNS.map(([key, label]) => {
          const tagged = t.tagged[key] || 0;
          return (
            <Box key={key} sx={{ minWidth: 0 }}>
              <Typography sx={{ fontSize: '1.05rem', fontWeight: 640, lineHeight: 1.25, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>
                {formatCount(t[key])}
              </Typography>
              <Typography sx={{ fontSize: '.75rem', color: 'var(--dim)' }}>{label}</Typography>
              <Typography sx={{ fontSize: '.75rem', color: 'var(--muted)', minHeight: '1.2em', lineHeight: 1.2, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {tagged > 0 && (
                  <span title={`${formatCount(tagged)} tagged with this genre elsewhere`}>
                    +{formatCount(tagged)}
                    {/* the word only where the column has room for it; the caption says what + means */}
                    <Box component="span" sx={{ '@container (max-width: 359px)': { display: 'none' } }}> tagged</Box>
                  </span>
                )}
              </Typography>
            </Box>
          );
        })}
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'center', minHeight: 30, mt: 'auto' }}>
        <Typography sx={{ fontSize: '.8rem', color: 'var(--dim)', fontVariantNumeric: 'tabular-nums' }}>{formatSize(t.sizeGb)}</Typography>
        <Box sx={{ flex: 1 }} />
        <Box sx={{ position: 'relative', zIndex: 1 }}>
          <GenrePipeline genre={genre} />
        </Box>
      </Box>
    </Panel>
  );
}
