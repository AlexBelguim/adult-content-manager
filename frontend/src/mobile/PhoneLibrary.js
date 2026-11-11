import React, { useState, useEffect, useLayoutEffect, useMemo, useCallback, useRef } from 'react';
import {
  Box, Typography, InputBase, IconButton, CircularProgress, Menu, MenuItem, Button
} from '@mui/material';
import { Search, Sort, Refresh, Close, ArrowBack } from '@mui/icons-material';
import { Link as RouterLink, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import MobilePerformerList from './MobilePerformerList';
// The shared filter view carries its own phone layout (swipe, round buttons,
// bottom sheet), so the phone shell no longer needs a separate sorter.
import PerformerFilterView from '../components/PerformerFilterView';
import MobileGallery from './MobileGallery';
import BottomNav from './BottomNav';
import MoreSheet from './MoreSheet';
import { PhoneJobsProvider, JobsChip } from './PhoneJobs';
import {
  libraryState, listPath, rememberLibraryMode, libraryHomePath, useShell
} from '../nav';
import useFilterViewHistory from '../components/filter/filterHistory';

/**
 * PhoneLibrary — the phone's library: the Filter, Gallery and Pairs lists and their sub-views.
 *
 * Rendered by the library layout route, so it stays mounted across '/', '/filter', '/filter/:performerId',
 * '/pairs' and '/p/:performerId'. Everything lives in the URL:
 *   /filter            Filter list           /filter/:id   the filter view of one performer (a layer over the list)
 *   /                  Gallery list          /p/:id        that performer's photos and videos (a layer)
 *   /pairs             Pairs list            /p/:id?view=n the photo viewer (covers everything)
 * The list stays mounted under the layers (inert), so its scroll and search survive a visit.
 *
 * It replaces the desktop Toolbar + MainPage on phones rather than restyling them, so none of the desktop
 * chrome is mounted at all. It draws its own header; the bottom navigation and the More sheet are the app's.
 */

/**
 * The same orderings the desktop filter offers.
 *
 * In Filter mode these go to the server as `sortBy`, which is what the desktop
 * does — so the two agree, and the completion orderings don't depend on me
 * guessing how "overall %" is derived. The gallery endpoint takes no sort
 * parameter, so those are sorted here instead; the completion orderings
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
  { key: 'overall-completion-desc', label: 'Overall % — most done', filterOnly: true },
  { key: 'in-after-first', label: 'Also in After — first', filterOnly: true }
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
  { key: 'filter', label: 'Filter' },
  { key: 'gallery', label: 'Gallery' },
  { key: 'pairs', label: 'Pairs' }
];

const DEFAULT_ORDER = 'size-desc';
const NO_PERFORMERS = [];
const LIFT_PAD = 'calc(56px + env(safe-area-inset-bottom))';
const orderKey = (mode) => `acm.phone.order.${mode}`;
const validOrder = (mode, key) =>
  !!key && SORTS.some((s) => s.key === key) && (mode === 'filter' || !!COMPARATORS[key]);

/** The saved order of a list (per mode); the old single 'mobileSort' key is the fallback. */
function readOrder(mode) {
  let saved = null;
  let legacy = null;
  try {
    saved = localStorage.getItem(orderKey(mode));
    legacy = localStorage.getItem('mobileSort');
  } catch (e) { /* storage blocked */ }
  if (validOrder(mode, saved)) return saved;
  if (validOrder(mode, legacy)) return legacy;
  return DEFAULT_ORDER;
}

function saveOrder(mode, key) {
  try { localStorage.setItem(orderKey(mode), key); } catch (e) { /* storage blocked */ }
}

/** fetch() rejects with TypeError only when it never got a response. */
function loadErrorText(err) {
  // Worth distinguishing, because in the installed PWA the shell loads from
  // the service worker cache and only the /api/ calls fail. The app looks
  // healthy right up until this point, so "could not load" reads like a
  // server bug when it's usually the tailnet being down.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return "You're offline. Reconnect to load your library.";
  }
  if (err instanceof TypeError) return "Can't reach the server. Check Tailscale is connected.";
  return `Could not load performers (${err.message}).`;
}

const headerBtnSx = { width: 40, height: 40, flexShrink: 0, color: 'var(--dim)' };

export default function PhoneLibrary() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { pathname } = location;
  const { handy } = useShell();

  const lib = libraryState(pathname) || { list: 'gallery', performerId: null, galleryId: null };
  const mode = lib.list;
  const sorterId = lib.performerId != null ? String(lib.performerId) : null;
  const galleryId = lib.galleryId != null ? String(lib.galleryId) : null;
  const viewerOpen = !!galleryId && searchParams.has('view');
  const layerOpen = !!sorterId || !!galleryId;

  /* ── start: a fresh start at '/' opens the list mode used last ── */
  const bootRef = useRef(undefined);
  if (bootRef.current === undefined) {
    const home = location.key === 'default' && pathname === '/' ? libraryHomePath() : '/';
    bootRef.current = home !== '/' ? home : null;
  }
  const booting = !!bootRef.current && pathname === '/';
  useEffect(() => {
    if (booting) navigate(bootRef.current, { replace: true });
    else bootRef.current = null;
  }, [booting, navigate]);

  useEffect(() => {
    if (!booting) rememberLibraryMode(mode);
  }, [mode, booting]);
  // The mode used to live in 'mobileMode'; the URL holds it now.
  useEffect(() => {
    try { localStorage.removeItem('mobileMode'); } catch (e) { /* storage blocked */ }
  }, []);

  /* ── order, per mode ── */
  const [orders, setOrders] = useState({});
  const order = orders[mode] || readOrder(mode);
  const setOrder = (key) => {
    saveOrder(mode, key);
    setOrders((o) => ({ ...o, [mode]: key }));
  };
  const sortOptions = useMemo(() => SORTS.filter((s) => mode === 'filter' || !s.filterOnly), [mode]);
  const [orderAnchor, setOrderAnchor] = useState(null);

  /* ── search ── */
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const closeSearch = useCallback(() => { setSearch(''); setSearchOpen(false); }, []);

  /* ── data ──
     Filter mode asks the server for its order (it owns the completion maths); Gallery and Pairs share the
     gallery endpoint and order on the client, so changing their order or switching between them does not
     refetch. */
  const source = mode === 'filter' ? 'filter' : 'gallery';
  const serverOrder = mode === 'filter' ? order : null;
  const [data, setData] = useState({ source: null, list: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const abortRef = useRef(null);

  const load = useCallback(async ({ quiet = false } = {}) => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    if (!quiet) { setLoading(true); setError(''); }
    try {
      let list;
      if (source === 'filter') {
        // Always returns { performers, totalCount, … } and defaults to 12 rows, so ask for the full set.
        const res = await fetch(
          `/api/performers/filter?limit=1000&offset=0&sortBy=${encodeURIComponent(serverOrder)}&searchTerm=`,
          { signal: ctrl.signal }
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = await res.json();
        list = Array.isArray(body?.performers) ? body.performers : [];
      } else {
        // The gallery endpoint answers a bare array. Pairs uses it too: the labeler compares a performer's
        // own photos, so it wants the same after-folder performers the gallery shows.
        const res = await fetch('/api/performers/gallery', { signal: ctrl.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = await res.json();
        list = Array.isArray(body) ? body : [];
      }
      if (ctrl.signal.aborted) return;
      setData({ source, list });
      setError('');
    } catch (err) {
      if (err.name === 'AbortError' || ctrl.signal.aborted) return;
      // A quiet refresh that fails keeps the list on screen; the next full load reports it.
      if (quiet) return;
      console.error('PhoneLibrary: failed to load performers', err);
      setError(loadErrorText(err));
      setData({ source, list: [] });
    } finally {
      if (abortRef.current === ctrl) {
        abortRef.current = null;
        setLoading(false);
      }
    }
  }, [source, serverOrder]);

  useEffect(() => {
    if (!booting) load();
  }, [load, booting]);
  useEffect(() => () => abortRef.current?.abort(), []);

  // Coming back online after a failure should just work. Read the error from a ref so the listener does
  // not restart on every change.
  const errorRef = useRef('');
  errorRef.current = error;
  useEffect(() => {
    const onOnline = () => { if (errorRef.current) load(); };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [load]);

  const performers = data.source === source ? data.list : NO_PERFORMERS;

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    const list = term
      ? performers.filter((p) => (p.name || '').toLowerCase().includes(term))
      : [...performers];
    // Filter mode arrives sorted by the server; sorting here would undo the orderings only it can compute.
    if (mode !== 'filter') list.sort(COMPARATORS[order] || COMPARATORS[DEFAULT_ORDER]);
    return list;
  }, [performers, search, order, mode]);

  /* ── taps ── */
  const handleSelect = useCallback((p) => {
    if (mode === 'filter') navigate(`/filter/${p.id}`);
    else if (mode === 'pairs') {
      const params = new URLSearchParams({
        performerId: p.id,
        performerName: p.name || '',
        basePath: p.folder_path || ''
      });
      navigate(`/pairwise-rank?${params.toString()}`);
    } else navigate(`/p/${p.id}`);
  }, [mode, navigate]);

  /* ── the filter view of one performer ── */
  const { leave: leaveSorter, goTo: goToSorter } = useFilterViewHistory('/filter');
  const sorterFromList = sorterId ? performers.find((p) => String(p.id) === sorterId) : null;
  const [sorterFetched, setSorterFetched] = useState(null); // { id, data } | { id, error }
  useEffect(() => {
    if (!sorterId || sorterFromList) return undefined;
    const ctrl = new AbortController();
    fetch(`/api/performers/${encodeURIComponent(sorterId)}`, { signal: ctrl.signal })
      .then(async (res) => {
        if (!res.ok) {
          let msg = `HTTP ${res.status}`;
          try { const b = await res.json(); if (b?.error) msg = b.error; } catch (e) { /* not JSON */ }
          throw new Error(msg);
        }
        return res.json();
      })
      .then((body) => setSorterFetched({ id: sorterId, data: body }))
      .catch((err) => { if (err.name !== 'AbortError') setSorterFetched({ id: sorterId, error: err.message }); });
    return () => ctrl.abort();
  }, [sorterId, sorterFromList]);
  const sorterPerformer = sorterFromList
    || (sorterFetched?.id === sorterId && sorterFetched.data ? sorterFetched.data : null);
  const sorterError = !sorterPerformer && sorterFetched?.id === sorterId ? sorterFetched.error : null;

  const handleSorterBack = useCallback((next) => {
    if (next && next.id != null) goToSorter(next.id);
    else leaveSorter();
  }, [goToSorter, leaveSorter]);

  // "Next performer" follows the list as it is shown, search and order included.
  const handleSorterNext = useCallback((currentId) => {
    const i = visible.findIndex((p) => String(p.id) === String(currentId));
    const next = i >= 0 ? visible[i + 1] : null;
    if (next) goToSorter(next.id);
    else leaveSorter();
  }, [visible, goToSorter, leaveSorter]);

  const galleryFromList = galleryId ? performers.find((p) => String(p.id) === galleryId) : undefined;

  /* ── leaving a layer: refresh in place, outline the row just visited ── */
  const lastOpenRef = useRef(null);
  const loadRef = useRef(load);
  loadRef.current = load;
  const [highlightId, setHighlightId] = useState(null);
  const openId = sorterId || galleryId;
  useEffect(() => {
    if (openId) { lastOpenRef.current = openId; return undefined; }
    const visited = lastOpenRef.current;
    if (!visited) return undefined;
    lastOpenRef.current = null;
    loadRef.current({ quiet: true }); // counts and progress will have moved
    setHighlightId(visited);
    const frame = requestAnimationFrame(() => {
      const el = document.querySelector(`[data-performer-id="${CSS.escape(visited)}"]`);
      if (!el) return;
      const r = el.getBoundingClientRect();
      const header = document.getElementById('phone-library-header');
      const top = header ? header.getBoundingClientRect().bottom : 0;
      const bottom = window.innerHeight - 64;
      if (r.top < top || r.bottom > bottom) el.scrollIntoView({ block: 'center' });
    });
    const timer = setTimeout(() => setHighlightId(null), 2000);
    return () => { cancelAnimationFrame(frame); clearTimeout(timer); };
  }, [openId]);

  // The list under a layer must not scroll with it.
  useLayoutEffect(() => {
    if (!layerOpen) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [layerOpen]);

  // The search field takes focus when it opens; Esc or Close clears and closes it.
  const searchInputRef = useRef(null);
  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);

  const chromeShows = !sorterId && !viewerOpen;
  const modeSwitch = !!location.state?.modeSwitch;
  const listInert = layerOpen ? { inert: '', 'aria-hidden': true } : {};

  return (
    <PhoneJobsProvider active>
      <Box sx={{ minHeight: '100dvh', bgcolor: 'var(--bg)', color: 'var(--text)', display: 'flex', flexDirection: 'column' }}>
        <Box {...listInert} sx={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
          {/* Header */}
          <Box
            component="header"
            id="phone-library-header"
            sx={{
              position: 'sticky', top: 0, zIndex: 10,
              bgcolor: 'var(--bg)', borderBottom: '1px solid var(--line)',
              paddingTop: 'env(safe-area-inset-top)', px: 1, pb: 1
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minHeight: 48 }}>
              {searchOpen ? (
                <Box sx={{
                  flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 0.5,
                  bgcolor: 'var(--raised)', border: '1px solid var(--line)',
                  borderRadius: 'var(--radius)', pl: 1, minHeight: 40
                }}>
                  <Search sx={{ fontSize: 18, color: 'var(--dim)', flexShrink: 0 }} />
                  <InputBase
                    inputRef={searchInputRef}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Escape') closeSearch(); }}
                    placeholder="Search performers"
                    inputProps={{ 'aria-label': 'Search performers', enterKeyHint: 'search' }}
                    sx={{ flex: 1, minWidth: 0, color: 'var(--text)', fontSize: 16 }}
                  />
                  <IconButton aria-label="Close search" onClick={closeSearch} sx={headerBtnSx}>
                    <Close sx={{ fontSize: 20 }} />
                  </IconButton>
                </Box>
              ) : (
                <>
                  <Typography component="h1" sx={{ flex: 1, minWidth: 0, pl: 0.5, fontSize: 17, fontWeight: 600 }}>
                    Library
                  </Typography>
                  <IconButton aria-label="Search" onClick={() => setSearchOpen(true)} sx={headerBtnSx}>
                    <Search sx={{ fontSize: 22 }} />
                  </IconButton>
                  <IconButton
                    aria-label="Order"
                    aria-haspopup="menu"
                    onClick={(e) => setOrderAnchor(e.currentTarget)}
                    sx={headerBtnSx}
                  >
                    <Sort sx={{ fontSize: 22 }} />
                  </IconButton>
                  <IconButton aria-label="Refresh" onClick={() => load()} sx={headerBtnSx}>
                    <Refresh sx={{ fontSize: 22 }} />
                  </IconButton>
                  <JobsChip />
                </>
              )}
            </Box>

            <Box component="nav" aria-label="Library lists" sx={{ display: 'flex', gap: 1 }}>
              {MODES.map((m) => {
                const selected = mode === m.key;
                return (
                  <Button
                    key={m.key}
                    component={RouterLink}
                    to={listPath(m.key)}
                    replace={modeSwitch}
                    state={{ modeSwitch: true }}
                    aria-current={selected ? 'page' : undefined}
                    size="small"
                    sx={{
                      flex: 1, minHeight: 38, textTransform: 'none', fontWeight: 600, fontSize: 14,
                      borderRadius: 'var(--radius)',
                      bgcolor: selected ? 'var(--accent)' : 'transparent',
                      color: selected ? 'var(--on-accent)' : 'var(--dim)',
                      border: '1px solid',
                      borderColor: selected ? 'var(--accent)' : 'var(--line)',
                      '&:hover': { bgcolor: selected ? 'var(--accent)' : 'var(--raised)' }
                    }}
                  >
                    {m.label}
                  </Button>
                );
              })}
            </Box>
          </Box>

          <Menu
            anchorEl={orderAnchor}
            open={!!orderAnchor}
            onClose={() => setOrderAnchor(null)}
            slotProps={{ paper: { sx: { maxHeight: '60vh' } } }}
          >
            {sortOptions.map((s) => (
              <MenuItem
                key={s.key}
                selected={order === s.key}
                onClick={() => { setOrder(s.key); setOrderAnchor(null); }}
                sx={{ fontSize: 14, minHeight: 44 }}
              >
                {s.label}
              </MenuItem>
            ))}
          </Menu>

          <Box sx={{ flex: 1, minHeight: 0, pb: LIFT_PAD }}>
            {loading && (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
                <CircularProgress size={32} />
              </Box>
            )}

            {!loading && error && (
              <Box sx={{ textAlign: 'center', py: 8, px: 3 }}>
                <Typography sx={{ fontSize: 14, color: 'var(--bad)', mb: 2 }}>{error}</Typography>
                <Button variant="outlined" onClick={() => load()} sx={{ textTransform: 'none', minHeight: 40 }}>Try again</Button>
              </Box>
            )}

            {!loading && !error && (
              <MobilePerformerList
                performers={visible}
                mode={mode}
                search={search}
                onClearSearch={closeSearch}
                onSelect={handleSelect}
                highlightId={highlightId}
              />
            )}
          </Box>
        </Box>

        {/* The gallery of one performer: above the list, below the bottom navigation. */}
        {galleryId && (
          <Box sx={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: LIFT_PAD,
            zIndex: 1050, bgcolor: 'var(--bg)'
          }}>
            <MobileGallery key={galleryId} performerId={galleryId} performer={galleryFromList} />
          </Box>
        )}

        {/* The filter view of one performer: full screen, no bottom navigation. */}
        {sorterId && (
          <Box sx={{
            position: 'fixed', inset: 0, zIndex: 1150,
            bgcolor: 'var(--bg)', color: 'var(--text)', overflowY: 'auto', overscrollBehavior: 'contain'
          }}>
            {sorterPerformer ? (
              <PerformerFilterView
                key={sorterPerformer.id}
                performer={sorterPerformer}
                onBack={handleSorterBack}
                onNext={handleSorterNext}
                handyIntegration={handy?.integration || null}
                handyConnected={!!handy?.connected}
              />
            ) : (
              <Box sx={{ paddingTop: 'env(safe-area-inset-top)' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', minHeight: 48, px: 0.5 }}>
                  <IconButton aria-label="Back" onClick={leaveSorter} sx={{ width: 40, height: 40, color: 'var(--text)' }}>
                    <ArrowBack sx={{ fontSize: 20 }} />
                  </IconButton>
                  <Typography sx={{ fontSize: 15, fontWeight: 600 }}>Filter</Typography>
                </Box>
                {sorterError ? (
                  <Box sx={{ textAlign: 'center', py: 8, px: 3 }}>
                    <Typography sx={{ fontSize: 14, color: 'var(--bad)', mb: 0.5 }}>Could not open this performer</Typography>
                    <Typography sx={{ fontSize: 12, color: 'var(--dim)' }}>{sorterError}</Typography>
                  </Box>
                ) : (
                  <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
                    <CircularProgress size={32} />
                  </Box>
                )}
              </Box>
            )}
          </Box>
        )}

        {chromeShows ? <BottomNav /> : null}
        {chromeShows ? <MoreSheet /> : null}
      </Box>
    </PhoneJobsProvider>
  );
}
