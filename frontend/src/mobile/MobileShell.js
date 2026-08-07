import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Box, Typography, InputBase, IconButton, CircularProgress,
  Menu, MenuItem, Button
} from '@mui/material';
import { Search, Sort, Refresh } from '@mui/icons-material';
import MobilePerformerList from './MobilePerformerList';
import MobileSorter from './MobileSorter';
import MobileGallery from './MobileGallery';

/**
 * MobileShell — the entire phone UI.
 *
 * Replaces the desktop Toolbar + MainPage on phones rather than restyling
 * them, so none of the desktop chrome (mode segments, folder controls, the
 * seven-icon tool row, the ML switches) is mounted at all.
 *
 * Gallery taps open the unified gallery; Filter taps go straight into
 * fullscreen sorting.
 */

/**
 * The same eighteen orderings the desktop filter offers.
 *
 * In Sort mode these go to the server as `sortBy`, which is what the desktop
 * does — so the two agree, and the completion orderings don't depend on me
 * guessing how "overall %" is derived. The gallery endpoint takes no sort
 * parameter, so those are sorted here instead; the six completion orderings
 * are filter-only because gallery performers carry no filterStats.
 */
const SORTS = [
  { key: 'size-desc', label: 'Size — largest' },
  { key: 'size-asc', label: 'Size — smallest' },
  { key: 'name-asc', label: 'Name — A to Z' },
  { key: 'name-desc', label: 'Name — Z to A' },
  { key: 'date-desc', label: 'Added — newest' },
  { key: 'date-asc', label: 'Added — oldest' },
  { key: 'pics-desc', label: 'Photos — most' },
  { key: 'pics-asc', label: 'Photos — fewest' },
  { key: 'vids-desc', label: 'Videos — most' },
  { key: 'vids-asc', label: 'Videos — fewest' },
  { key: 'funscript-desc', label: 'Funscripts — most' },
  { key: 'funscript-asc', label: 'Funscripts — fewest' },
  { key: 'pics-completion-asc', label: 'Photos % — least done', filterOnly: true },
  { key: 'pics-completion-desc', label: 'Photos % — most done', filterOnly: true },
  { key: 'vids-completion-asc', label: 'Videos % — least done', filterOnly: true },
  { key: 'vids-completion-desc', label: 'Videos % — most done', filterOnly: true },
  { key: 'overall-completion-asc', label: 'Overall % — least done', filterOnly: true },
  { key: 'overall-completion-desc', label: 'Overall % — most done', filterOnly: true }
];

// Gallery-mode comparators, matching the server's fields for the same keys.
const COMPARATORS = {
  'size-desc': (a, b) => (b.total_size_gb || 0) - (a.total_size_gb || 0),
  'size-asc': (a, b) => (a.total_size_gb || 0) - (b.total_size_gb || 0),
  'name-asc': (a, b) => (a.name || '').localeCompare(b.name || ''),
  'name-desc': (a, b) => (b.name || '').localeCompare(a.name || ''),
  'date-desc': (a, b) => new Date(b.import_date || 0) - new Date(a.import_date || 0),
  'date-asc': (a, b) => new Date(a.import_date || 0) - new Date(b.import_date || 0),
  'pics-desc': (a, b) => (b.pics_count || 0) - (a.pics_count || 0),
  'pics-asc': (a, b) => (a.pics_count || 0) - (b.pics_count || 0),
  'vids-desc': (a, b) => (b.vids_count || 0) - (a.vids_count || 0),
  'vids-asc': (a, b) => (a.vids_count || 0) - (b.vids_count || 0),
  'funscript-desc': (a, b) => (b.funscript_vids_count || 0) - (a.funscript_vids_count || 0),
  'funscript-asc': (a, b) => (a.funscript_vids_count || 0) - (b.funscript_vids_count || 0)
};

const MODES = [
  { key: 'gallery', label: 'Gallery' },
  { key: 'filter', label: 'Sort' }
];

function MobileShell() {
  const [mode, setMode] = useState(() => localStorage.getItem('mobileMode') || 'filter');
  const [performers, setPerformers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState(() => localStorage.getItem('mobileSort') || 'size-desc');
  const [sortAnchor, setSortAnchor] = useState(null);
  const [sorting, setSorting] = useState(null); // performer being sorted
  const [viewing, setViewing] = useState(null); // performer being browsed

  useEffect(() => { localStorage.setItem('mobileMode', mode); }, [mode]);
  useEffect(() => { localStorage.setItem('mobileSort', sort); }, [sort]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      if (mode === 'filter') {
        // Always returns { performers, totalCount, … } and defaults to 12 rows,
        // so ask for the full set. Ordering is the server's job here — it owns
        // the completion maths the desktop filter sorts by.
        const res = await fetch(
          `/api/performers/filter?limit=1000&offset=0&sortBy=${encodeURIComponent(sort)}&searchTerm=`
        );
        const data = await res.json();
        setPerformers(Array.isArray(data?.performers) ? data.performers : []);
      } else {
        // The gallery endpoint answers a bare array.
        const res = await fetch('/api/performers/gallery');
        const data = await res.json();
        setPerformers(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.error('MobileShell: failed to load performers', err);
      setError('Could not load performers.');
      setPerformers([]);
    } finally {
      setLoading(false);
    }
  }, [mode, sort]);

  useEffect(() => { load(); }, [load]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    const list = term
      ? performers.filter((p) => (p.name || '').toLowerCase().includes(term))
      : [...performers];

    // Filter mode arrives pre-sorted from the server; re-sorting here would
    // undo the completion orderings it alone can compute.
    if (mode !== 'filter') {
      list.sort(COMPARATORS[sort] || COMPARATORS['size-desc']);
    }
    return list;
  }, [performers, search, sort, mode]);

  const sortOptions = useMemo(
    () => SORTS.filter((s) => mode === 'filter' || !s.filterOnly),
    [mode]
  );

  // Completion orderings mean nothing in the gallery — fall back rather than
  // leaving a selection the list can't honour.
  useEffect(() => {
    if (mode !== 'filter' && !COMPARATORS[sort]) setSort('size-desc');
  }, [mode, sort]);

  const handleSelect = useCallback((performer) => {
    if (mode === 'filter') setSorting(performer);
    else setViewing(performer);
  }, [mode]);

  const handleSorterExit = useCallback(() => {
    setSorting(null);
    load(); // counts and progress will have moved
  }, [load]);

  if (sorting) {
    return <MobileSorter performer={sorting} onExit={handleSorterExit} />;
  }

  if (viewing) {
    return <MobileGallery performer={viewing} onExit={() => setViewing(null)} />;
  }

  return (
    <Box sx={{
      minHeight: '100dvh',
      bgcolor: 'var(--bg)', color: 'var(--text)',
      display: 'flex', flexDirection: 'column',
      paddingBottom: 'env(safe-area-inset-bottom)'
    }}>
      {/* Header */}
      <Box sx={{
        position: 'sticky', top: 0, zIndex: 5,
        bgcolor: 'var(--bg)', borderBottom: '1px solid var(--line)',
        paddingTop: 'calc(env(safe-area-inset-top) + 8px)', px: 1.5, pb: 1
      }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <Box sx={{
            flex: 1, display: 'flex', alignItems: 'center', gap: 0.75,
            bgcolor: 'var(--raised)', border: '1px solid var(--line)',
            borderRadius: 'var(--radius, 6px)', px: 1, minHeight: 40
          }}>
            <Search sx={{ fontSize: 18, color: 'var(--dim)' }} />
            <InputBase
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search performers"
              sx={{ flex: 1, color: 'var(--text)', fontSize: '0.9rem' }}
            />
          </Box>
          <IconButton
            onClick={(e) => setSortAnchor(e.currentTarget)}
            aria-label="Sort"
            sx={{ color: 'var(--dim)', border: '1px solid var(--line)', borderRadius: 'var(--radius, 6px)', width: 40, height: 40 }}
          >
            <Sort />
          </IconButton>
          <IconButton
            onClick={load}
            aria-label="Refresh"
            sx={{ color: 'var(--dim)', border: '1px solid var(--line)', borderRadius: 'var(--radius, 6px)', width: 40, height: 40 }}
          >
            <Refresh />
          </IconButton>
        </Box>

        <Box sx={{ display: 'flex', gap: 1 }}>
          {MODES.map((m) => (
            <Button
              key={m.key}
              onClick={() => setMode(m.key)}
              size="small"
              sx={{
                flex: 1, minHeight: 38, textTransform: 'none', fontWeight: 650,
                borderRadius: 'var(--radius, 6px)',
                bgcolor: mode === m.key ? 'var(--accent)' : 'transparent',
                color: mode === m.key ? 'var(--on-accent)' : 'var(--dim)',
                border: '1px solid',
                borderColor: mode === m.key ? 'var(--accent)' : 'var(--line)'
              }}
            >
              {m.label}
            </Button>
          ))}
        </Box>
      </Box>

      <Menu
        anchorEl={sortAnchor}
        open={!!sortAnchor}
        onClose={() => setSortAnchor(null)}
        slotProps={{ paper: { sx: { maxHeight: '60vh' } } }}
      >
        {sortOptions.map((s) => (
          <MenuItem
            key={s.key}
            selected={sort === s.key}
            onClick={() => { setSort(s.key); setSortAnchor(null); }}
          >
            {s.label}
          </MenuItem>
        ))}
      </Menu>

      <Box sx={{ flex: 1, minHeight: 0 }}>
        {loading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
            <CircularProgress size={32} />
          </Box>
        )}

        {!loading && error && (
          <Box sx={{ textAlign: 'center', py: 8, px: 3 }}>
            <Typography sx={{ color: 'var(--bad, #f44336)', mb: 2 }}>{error}</Typography>
            <Button variant="outlined" onClick={load} sx={{ textTransform: 'none' }}>Try again</Button>
          </Box>
        )}

        {!loading && !error && (
          <MobilePerformerList performers={visible} mode={mode} onSelect={handleSelect} />
        )}
      </Box>
    </Box>
  );
}

export default MobileShell;
