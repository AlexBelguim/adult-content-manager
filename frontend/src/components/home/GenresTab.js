/**
 * The Gallery home's Genres view: the genre folders under content, as cards or as a table. Its Show group (search,
 * sort, Grid or List) and the genre totals sit in the sidebar. Search and sort are in the URL (gq, gsort); the view
 * is remembered in localStorage. The cards fill the width: as many 300px columns as fit, then grown to meet both
 * edges, each card keeping the proportions it has at 300px.
 */
import React, { useMemo, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box, Typography } from '@mui/material';
import FilterListIcon from '@mui/icons-material/FilterList';
import CategoryOutlinedIcon from '@mui/icons-material/CategoryOutlined';
import {
  Panel, EmptyState, FillGrid, SideGroup, SideSearch, SideSelect, SideSegment, SideFacts, SideNote, ContentLine, SIDE
} from '../layout';
import { SmallButton } from '../discover/shared';
import { errorText } from '../ui';
import { useOpen } from '../../nav';
import { GENRE_SORTS, sortGenres, genreTotals, lowerFirst } from './filterModel';
import { formatGb } from './homeData';
import GenreCard, { GenrePipeline, genreUrl, formatCount, formatSize, GENRE_CARD_W, GENRE_CARD_H } from './GenreCard';

const VIEW_KEY = 'galleryContentViewMode';
const SORT_OPTIONS = GENRE_SORTS.map(s => ({ value: s.id, label: s.label }));
const VIEW_OPTIONS = [{ id: 'grid', label: 'Grid' }, { id: 'list', label: 'List' }];

function readView() {
  try { return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid'; } catch { return 'grid'; }
}

const thSx = {
  fontSize: '.75rem', fontWeight: 600, color: 'var(--muted)', py: 1, px: 1.25, whiteSpace: 'nowrap',
  borderBottom: '1px solid var(--line-strong)'
};
const tdSx = { py: 1, px: 1.25, color: 'var(--text)' };

function Count({ n, tagged }) {
  return (
    <>
      {formatCount(n)}
      {tagged > 0 && <Box component="span" sx={{ color: 'var(--muted)' }}>{` + ${formatCount(tagged)}`}</Box>}
    </>
  );
}

function GenreTable({ list, basePath }) {
  const open = useOpen();
  const cols = [['pics', 'Pictures'], ['vids', 'Videos'], ['funscripts', 'Funscripts'], ['total', 'Total']];
  return (
    <Box sx={{ overflowX: 'auto' }}>
      <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', fontSize: '.84rem', fontVariantNumeric: 'tabular-nums' }}>
        <thead>
          <tr>
            <Box component="th" scope="col" sx={{ ...thSx, textAlign: 'left' }}>Genre</Box>
            {cols.map(([k, label]) => <Box key={k} component="th" scope="col" sx={{ ...thSx, textAlign: 'right' }}>{label}</Box>)}
            <Box component="th" scope="col" sx={{ ...thSx, textAlign: 'right' }}>Size</Box>
            <Box component="th" scope="col" sx={thSx}><Box component="span" sx={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Labels and funscripts</Box></Box>
          </tr>
        </thead>
        <tbody>
          {list.map((genre) => {
            const url = genreUrl(genre, basePath);
            const t = genreTotals(genre);
            const onRow = (e) => {
              if (e.target instanceof Element && e.target.closest('a')) return;   // the link handles its own clicks
              open(url, e);
            };
            return (
              <Box key={genre.name} component="tr" onClick={onRow}
                onAuxClick={(e) => { if (e.button === 1 && !(e.target instanceof Element && e.target.closest('a'))) { e.preventDefault(); open(url, e); } }}
                sx={{ borderBottom: '1px solid var(--line)', cursor: 'pointer', '&:hover': { bgcolor: 'var(--raised)' } }}>
                <Box component="td" sx={{ ...tdSx, maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  <Box component={RouterLink} to={url} title={genre.name} sx={{
                    color: 'var(--text)', textDecoration: 'none', fontWeight: 560,
                    '&:hover': { textDecoration: 'underline' }, '&:focus-visible': { outline: '2px solid var(--accent)', outlineOffset: 2 }
                  }}>
                    {genre.name}
                  </Box>
                </Box>
                {cols.map(([k]) => (
                  <Box key={k} component="td" sx={{ ...tdSx, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <Count n={t[k]} tagged={t.tagged[k] || 0} />
                  </Box>
                ))}
                <Box component="td" sx={{ ...tdSx, textAlign: 'right', whiteSpace: 'nowrap', color: 'var(--dim)' }}>{formatSize(t.sizeGb)}</Box>
                <Box component="td" sx={{ ...tdSx, py: 0.25, textAlign: 'right', width: 44 }} onClick={(e) => e.stopPropagation()}
                  onAuxClick={(e) => e.stopPropagation()}>
                  <GenrePipeline genre={genre} />
                </Box>
              </Box>
            );
          })}
        </tbody>
      </Box>
    </Box>
  );
}

/** The genre totals as sidebar facts: every genre's folder counts, and the files tagged with one elsewhere. */
function genreFacts(genres) {
  const sum = { pics: 0, vids: 0, funscripts: 0, tagged: 0, gb: 0 };
  for (const g of genres) {
    const t = genreTotals(g);
    sum.pics += t.pics;
    sum.vids += t.vids;
    sum.funscripts += t.funscripts;
    sum.tagged += t.tagged.total;
    sum.gb += t.sizeGb;
  }
  return [
    { label: 'Genres', value: formatCount(genres.length) },
    { label: 'Pictures', value: formatCount(sum.pics) },
    { label: 'Videos', value: formatCount(sum.vids) },
    { label: 'Funscripts', value: formatCount(sum.funscripts) },
    sum.tagged > 0 ? { label: 'Tagged elsewhere', value: formatCount(sum.tagged) } : null,
    { label: 'Size', value: formatGb(sum.gb) }
  ];
}

function Skeleton() {
  return (
    <FillGrid base={GENRE_CARD_W} gap={24} fit="stretch" aria-hidden>
      {Array.from({ length: 8 }, (_, i) => (
        <Box key={i} sx={{
          height: GENRE_CARD_H,
          bgcolor: 'var(--raised)', borderRadius: 'var(--radius-lg, 10px)',
          animation: 'homeGenrePulse 1.6s ease-in-out infinite',
          '@keyframes homeGenrePulse': { '0%': { opacity: 1 }, '50%': { opacity: 0.55 }, '100%': { opacity: 1 } },
          '@media (prefers-reduced-motion: reduce)': { animation: 'none' }
        }} />
      ))}
    </FillGrid>
  );
}

export default function GenresTab({ genres, error, reload, gq, gsort, onQuery, basePath }) {
  const [view, setViewState] = useState(readView);
  const setView = (v) => {
    setViewState(v);
    try { localStorage.setItem(VIEW_KEY, v); } catch { /* storage off */ }
  };

  const needle = String(gq || '').trim();
  const list = useMemo(() => {
    const lower = needle.toLowerCase();
    const rows = (genres || []).filter(g => !lower || String(g.name || '').toLowerCase().includes(lower));
    return sortGenres(rows, gsort);
  }, [genres, needle, gsort]);
  const facts = useMemo(() => (genres ? genreFacts(genres) : []), [genres]);

  let content;
  if (genres == null && error) {
    content = (
      <Panel role="alert" sx={{ borderColor: 'var(--bad)', display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
        <Typography sx={{ fontWeight: 600, color: 'var(--text)' }}>Could not load genres</Typography>
        <Typography variant="body2" sx={{ color: 'var(--text)' }}>{typeof error === 'string' ? error : errorText(error, 'The list did not load')}</Typography>
        <SmallButton onClick={reload}>Retry</SmallButton>
      </Panel>
    );
  } else if (genres == null) {
    content = <Skeleton />;
  } else if (genres.length === 0) {
    content = <EmptyState title="No genres yet" description="Genres are the folders under content in your library." />;
  } else if (list.length === 0) {
    content = (
      <EmptyState title={`No genres match "${needle}"`}
        action={<SmallButton onClick={() => onQuery({ gq: '' })}>Clear search</SmallButton>} />
    );
  } else if (view === 'list') {
    content = <GenreTable list={list} basePath={basePath} />;
  } else {
    // natural height: the cards are text, so a taller cell would only add empty space; a row's cards stretch to one height
    content = (
      <FillGrid base={GENRE_CARD_W} gap={24} fit="stretch">
        {list.map(genre => <GenreCard key={genre.name} genre={genre} basePath={basePath} />)}
      </FillGrid>
    );
  }

  const sortLabel = lowerFirst(GENRE_SORTS.find(x => x.id === gsort)?.label || '');
  const meta = genres == null ? null : [
    needle ? `${formatCount(list.length)} of ${formatCount(genres.length)}` : formatCount(genres.length),
    sortLabel
  ].filter(Boolean).join(' · ');

  return (
    <>
      <SideGroup
        id="show"
        title="Show"
        icon={<FilterListIcon />}
        badge={needle ? 1 : 0}
        summary={needle ? 'search on' : 'nothing on'}
        order={SIDE.show}
      >
        <SideSearch value={gq} onChange={(v) => onQuery({ gq: v })} placeholder="Search genres" />
        <SideSelect label="Sort genres" value={gsort} onChange={(v) => onQuery({ gsort: v })} options={SORT_OPTIONS} />
        <SideSegment label="Genre view" value={view} onChange={setView} options={VIEW_OPTIONS} />
      </SideGroup>
      <SideGroup
        id="genres"
        title="Genres"
        icon={<CategoryOutlinedIcon />}
        summary={genres ? `${formatCount(genres.length)} genres` : 'loading'}
        order={SIDE.page + 1}
      >
        <SideFacts rows={facts} />
        <SideNote>Counts are files in the genre folder, plus files tagged with the genre elsewhere (+ tagged).</SideNote>
      </SideGroup>

      <ContentLine title="Genres" meta={meta} />
      {content}
    </>
  );
}
