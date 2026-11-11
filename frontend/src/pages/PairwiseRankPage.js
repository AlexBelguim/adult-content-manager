import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Box, Typography, Button, Switch, CircularProgress, useMediaQuery } from '@mui/material';
import { ArrowBack, ThumbDown, Undo, SkipNext, EmojiEvents, ScreenRotation } from '@mui/icons-material';
import { EmptyState, LoadingState, SPACE, overlayChipSx } from '../components/layout';
import { useNotify, plural } from '../components/ui';
import { useVoteQueue, useSafeLeave, SaveChip } from '../components/rating/voteQueue';
import { useBack } from '../nav';

const STAY_PORTRAIT_KEY = 'pairwiseRank:stayPortrait';
const FLASH_MS = 240;
// The swap is instant, so the second tap of an accidental double tap would
// land on a pair nobody has looked at yet. Votes this soon are ignored.
const MIN_VIEW_MS = 180;
const STATS_EVERY_MS = 3000;
const RANKINGS_AFTER_MS = 1000;

const pairKey = (p) => (p ? [p.left, p.right].sort().join('|') : '');
const previewUrl = (imgPath) => `/api/files/preview?path=${encodeURIComponent(imgPath)}`;

/** 'Continue in portrait' is remembered on this device (it used to last one session only). */
const readStay = () => {
  try {
    if (localStorage.getItem(STAY_PORTRAIT_KEY) === '1') return true;
  } catch (_) { /* private mode */ }
  try { return sessionStorage.getItem(STAY_PORTRAIT_KEY) === '1'; } catch (_) { return false; }
};

const TYPING_TYPES = new Set(['text', 'search', 'number', 'email', 'url', 'password', 'tel']);
const isTyping = (t) => !!t && (t.isContentEditable || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT'
  || (t.tagName === 'INPUT' && TYPING_TYPES.has(String(t.type || 'text').toLowerCase())));

const chipSx = {
  display: 'inline-flex', alignItems: 'center', flex: 'none', height: 22, boxSizing: 'border-box',
  fontSize: 12, lineHeight: 1, border: '1px solid var(--line-strong)', borderRadius: 'var(--radius-lg)',
  px: '8px', color: 'var(--dim)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums'
};
const accentChipSx = { ...chipSx, borderColor: 'var(--accent)', color: 'var(--accent)' };

/** A chip on a picture: the shared overlay chip, at 12px. */
const picChipSx = (tone, pos) => ({
  ...overlayChipSx(tone), fontSize: 12, fontWeight: 640, px: '6px', py: '4px', boxShadow: 'none', whiteSpace: 'nowrap',
  ...(pos ? { position: 'absolute', ...pos } : {})
});

const kbdSx = {
  fontFamily: 'inherit', fontSize: 12, fontWeight: 600, lineHeight: '16px', fontVariantNumeric: 'tabular-nums',
  border: '1px solid currentColor', borderRadius: 'var(--radius-sm)', px: '5px', opacity: 0.6
};

/** Shared look of an action; `round` is the phone-landscape middle column, `stackedLabel` the phone portrait bar. */
const actSx = (tone, round, stackedLabel) => ({
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: stackedLabel ? '2px' : 1,
  flexDirection: stackedLabel ? 'column' : 'row',
  font: 'inherit', fontWeight: 600, fontSize: 14, whiteSpace: 'nowrap', cursor: 'pointer',
  color: tone === 'bad' ? 'var(--bad)' : 'var(--text)',
  bgcolor: tone === 'bad' ? 'var(--bad-quiet)' : 'var(--raised)',
  border: '1px solid', borderColor: tone === 'bad' ? 'var(--bad)' : 'var(--line-strong)',
  ...(round
    ? { width: 46, height: 46, borderRadius: '50%', p: 0, flex: 'none' }
    : { height: stackedLabel ? 50 : 46, borderRadius: 'var(--radius-lg)', minWidth: 0, px: 1 }),
  '&:hover:not(:disabled)': { bgcolor: 'var(--overlay)' },
  '&:disabled': { opacity: 0.3, cursor: 'default' }
});

const flashKeyframes = { '@keyframes pairFlash': { from: { opacity: 1 }, to: { opacity: 0 } } };

/** One side of the comparison. Defined at module level so a re-render of the
 *  page never remounts it (a remount re-requests the image). */
function Side({ side, path, src, stacked, touch, compact, showInfo, info, flash, onPick }) {
  const [loadedPath, setLoadedPath] = useState(null);
  const label = stacked
    ? (side === 'left' ? '↑ Pick this' : 'Pick this ↓')
    : (side === 'left' ? '← Pick this' : 'Pick this →');

  return (
    <Box
      onClick={onPick}
      sx={{
        flex: '1 1 0', minWidth: 0, minHeight: 0, cursor: 'pointer', position: 'relative',
        overflow: 'hidden', bgcolor: 'var(--bg)',
        '&:hover .pick-label': { opacity: 1 },
        ...flashKeyframes
      }}
    >
      <img
        src={src}
        alt={side === 'left' ? 'Left option' : 'Right option'}
        draggable={false}
        onLoad={() => setLoadedPath(path)}
        style={{
          position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain',
          // The cheap thumbnail paints at once; it is dropped on load because it
          // is a 5:4 crop and would stick out behind a taller full image.
          backgroundImage: loadedPath === path ? 'none' : `url("${previewUrl(path)}")`,
          backgroundPosition: 'center', backgroundSize: 'contain', backgroundRepeat: 'no-repeat'
        }}
      />
      <Box className="pick-label" sx={{
        position: 'absolute', bottom: 0, left: 0, right: 0, pointerEvents: 'none',
        px: compact ? 1 : 1.5, pb: compact ? 0.75 : 1.25,
        display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap',
        opacity: touch ? 1 : 0, transition: 'opacity .12s'
      }}>
        <Box component="span" sx={picChipSx('var(--text)')}>{label}</Box>
        <Box sx={{ flex: 1 }} />
        {showInfo && info && (
          <>
            <Box component="span" sx={picChipSx('var(--dim)')}>score {Number(info.score).toFixed(1)}</Box>
            <Box component="span" sx={picChipSx('var(--dim)')}>{info.comparisons} compared</Box>
          </>
        )}
      </Box>
      {flash && (
        <Box
          key={flash.id}
          sx={{
            position: 'absolute', inset: 0, pointerEvents: 'none',
            animation: `pairFlash ${FLASH_MS - 20}ms ease-out forwards`,
            ...(flash.win
              ? { boxShadow: 'inset 0 0 0 4px var(--ok)' }
              : { bgcolor: 'var(--scrim)' })
          }}
        />
      )}
    </Box>
  );
}

/** The Scores switch: score and comparison count on the picture labels. */
function ScoresSwitch({ checked, onChange }) {
  return (
    <Box component="label" title="Show score and comparison count on the pictures"
      sx={{ display: 'inline-flex', alignItems: 'center', flex: 'none', fontSize: 12, color: 'var(--dim)', whiteSpace: 'nowrap', cursor: 'pointer' }}>
      <Switch size="small" checked={checked} onChange={(e) => onChange(e.target.checked)}
        inputProps={{ 'aria-label': 'Scores' }} />
      Scores
    </Box>
  );
}

/**
 * Pairwise image ranking: two pictures of one performer, tap the better one.
 * Opens from Rank pictures, the gallery's 'Rank images' and the phone Pairs list, chrome-free and full-bleed.
 *
 * The next pair is fetched and its images decoded while the current pair is on
 * screen, so a pick swaps in the same tick; votes go out in the background
 * through the vote queue (serial, so an Undo always lands after the vote it reverses;
 * failed sends are retried, and leaving waits for them or asks).
 */
function PairwiseRankPage() {
  const [searchParams] = useSearchParams();
  // Fold 6 cover screen turned sideways is 880x360, so it lands here.
  const isLandscape = useMediaQuery('(max-height:500px) and (orientation:landscape)');
  // Keyed on width rather than `orientation:portrait`: width is what decides
  // whether two panes fit, and the orientation feature is unreliable in
  // emulated viewports.
  const isNarrow = useMediaQuery('(max-width:600px)');
  const isPortraitPhone = isNarrow && !isLandscape;
  const isPhone = isPortraitPhone || isLandscape;
  // Touch devices never fire :hover, so the label has to be always visible.
  const isTouch = useMediaQuery('(hover: none)');
  const performerId = searchParams.get('performerId');
  const performerName = searchParams.get('performerName') || 'Unknown';
  const basePath = searchParams.get('basePath') || '';

  const notify = useNotify();
  const { queue, counts } = useVoteQueue();

  const [pair, setPair] = useState(null); // { left, right, leftScore, rightScore }
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState(null);
  const [sessionSaved, setSessionSaved] = useState(0); // votes the server confirmed, minus confirmed undos
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);
  const [historyLen, setHistoryLen] = useState(0);
  const [flash, setFlash] = useState(null); // { id, side }
  const [showInfo, setShowInfo] = useState(false);
  const [liveScores, setLiveScores] = useState({});
  const [stayPortrait, setStayPortrait] = useState(readStay);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [rankings, setRankings] = useState(null);
  const [rankingsError, setRankingsError] = useState(null);

  const pairRef = useRef(null);
  const historyRef = useRef([]); // [{ pair, voted, entry }], the Undo stack
  const nextRef = useRef({ ready: null, promise: null });
  const flashTimer = useRef(null);
  const flashId = useRef(0);
  const preloaded = useRef([]);
  const loadGen = useRef(0);
  const shownAt = useRef(0);
  const alive = useRef(true);
  const drawerOpenRef = useRef(false);
  drawerOpenRef.current = drawerOpen;
  const statsTimer = useRef(null);
  const statsAt = useRef(0);
  const rankingsTimer = useRef(null);
  const rankingsGen = useRef(0);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      clearTimeout(flashTimer.current);
      clearTimeout(statsTimer.current);
      clearTimeout(rankingsTimer.current);
    };
  }, []);

  const pushHistory = (h) => {
    historyRef.current = [...historyRef.current, h];
    setHistoryLen(historyRef.current.length);
  };
  const popHistory = () => {
    const h = historyRef.current[historyRef.current.length - 1];
    if (!h) return null;
    historyRef.current = historyRef.current.slice(0, -1);
    setHistoryLen(historyRef.current.length);
    return h;
  };
  /** The pairs a fetched pair must not be: the one on screen and every one in the Undo stack (their votes may
   *  not have reached the server yet). */
  const avoidKeys = () => {
    const s = new Set(historyRef.current.map((h) => pairKey(h.pair)));
    if (pairRef.current) s.add(pairKey(pairRef.current));
    return s;
  };

  const getImageUrl = useCallback((imgPath) => {
    if (!imgPath) return '';
    // /api/files/cached-image hard-requires basePath — it 400s without one.
    // basePath only reaches this page as a query param, so any entry point that
    // omits it (a bookmark, a reopened tab) falls back to /preview, which needs
    // nothing but the path; the only thing lost is the on-disk cache.
    if (!basePath) return previewUrl(imgPath);
    const folderType = imgPath.includes('before filter performer') ? 'before' : 'after';
    return `/api/files/cached-image?path=${encodeURIComponent(imgPath)}&basePath=${encodeURIComponent(basePath)}&folderType=${folderType}`;
  }, [basePath]);

  const preload = useCallback((p) => {
    preloaded.current = [p.left, p.right].map((imgPath) => {
      const img = new Image();
      img.src = getImageUrl(imgPath);
      if (img.decode) img.decode().catch(() => {});
      return img;
    });
  }, [getImageUrl]);

  /** One pair from the server, never one whose key is in `avoid` (a Set). */
  const fetchPair = useCallback(async (avoid) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch(`/api/pairwise/next-pair?performer_id=${performerId}&type=intra`);
      const data = await res.json().catch(() => null);
      if (!data) throw new Error(`HTTP ${res.status}`);
      if (data.error || data.done) return { done: true, error: data.error || null };
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (!avoid || !avoid.has(pairKey(data))) {
        preload(data);
        return { pair: data };
      }
    }
    // Only pairs still on their way to the server are left: decide again once they landed.
    return null;
  }, [performerId, preload]);

  const prefetchNext = useCallback((avoid) => {
    const slot = { ready: null, promise: null };
    slot.promise = fetchPair(avoid)
      .then((r) => { slot.ready = r; return r; })
      .catch(() => null);
    nextRef.current = slot;
  }, [fetchPair]);

  const showPair = useCallback((p) => {
    pairRef.current = p;
    shownAt.current = Date.now();
    setPair(p);
  }, []);

  const fetchStats = useCallback(async () => {
    if (!performerId) return;
    try {
      const res = await fetch(`/api/pairwise/stats?performer_id=${performerId}`);
      if (!res.ok) return;
      const data = await res.json();
      if (alive.current) setStats(data);
    } catch (_) { /* counters are cosmetic */ }
  }, [performerId]);
  const fetchStatsRef = useRef(fetchStats);
  fetchStatsRef.current = fetchStats;

  /** Stats after saved votes: at most once per 3 s, and always once after the last one. */
  const statsSoon = () => {
    if (statsTimer.current) return;
    const wait = Math.max(0, STATS_EVERY_MS - (Date.now() - statsAt.current));
    statsTimer.current = setTimeout(() => {
      statsTimer.current = null;
      statsAt.current = Date.now();
      fetchStatsRef.current();
    }, wait);
  };

  /** Slow path: nothing prefetched (first load, Try again, or the prefetch lost). */
  const loadFresh = useCallback(async () => {
    const gen = ++loadGen.current;
    setLoading(true);
    setError(null);
    try {
      // Let the votes land first, so the server does not hand back a pair just voted on.
      await queue.drain(4000);
      const r = await fetchPair(avoidKeys());
      if (gen !== loadGen.current || !alive.current) return; // an Undo restored a pair meanwhile
      if (r && r.pair) {
        setDone(false);
        showPair(r.pair);
        prefetchNext(avoidKeys());
      } else {
        showPair(null);
        setDone(true);
        setError(r ? r.error : null);
      }
    } catch (err) {
      if (gen !== loadGen.current || !alive.current) return;
      showPair(null);
      setError('Failed to load pair: ' + err.message);
    }
    setLoading(false);
  // avoidKeys reads refs only
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchPair, prefetchNext, showPair, queue]);

  useEffect(() => {
    if (!performerId) {
      setLoading(false);
      setError('No performer selected');
      return;
    }
    loadFresh();
    fetchStats();
  }, [performerId, loadFresh, fetchStats]);

  /** The rankings list, kept on screen while it refreshes. */
  const loadRankings = useCallback(async () => {
    const gen = ++rankingsGen.current;
    setRankingsError(null);
    try {
      await queue.drain(4000);
      const res = await fetch(`/api/pairwise/image-rankings?performer_id=${performerId}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
      if (gen !== rankingsGen.current || !alive.current) return;
      const images = [...(data.images || [])].sort((a, b) => (a.bothBad ? 1 : 0) - (b.bothBad ? 1 : 0) || b.score - a.score);
      setRankings({ ...data, images });
    } catch (err) {
      if (gen !== rankingsGen.current || !alive.current) return;
      setRankingsError('Failed to load rankings: ' + err.message);
    }
  }, [performerId, queue]);
  const loadRankingsRef = useRef(loadRankings);
  loadRankingsRef.current = loadRankings;

  /** While the drawer is open, refresh it 1 s after the last saved vote. */
  const rankingsSoon = () => {
    if (!drawerOpenRef.current) return;
    clearTimeout(rankingsTimer.current);
    rankingsTimer.current = setTimeout(() => {
      if (drawerOpenRef.current) loadRankingsRef.current();
    }, RANKINGS_AFTER_MS);
  };

  /** What happens once the server answered a vote. */
  const watchVote = (entry, onSaved) => {
    queue.whenSettled(entry).then((e) => {
      if (!alive.current) return;
      if (e.status === 'saved') {
        const r = e.result || {};
        // A duplicate here is a vote resent after its answer was lost (next-pair never offers a stored pair):
        // it is this person's vote, so it counts, and its pairId names the row for Undo.
        setSessionSaved((n) => n + 1);
        if (onSaved) onSaved(r);
        statsSoon();
        rankingsSoon();
      } else if (e.status === 'rejected') {
        notify({ message: 'Not saved: ' + e.error, severity: 'error' });
      }
    });
  };

  /** Show the prefetched pair now; `h` is what Undo will restore. */
  const advance = (h, flashSide) => {
    const slot = nextRef.current;
    if (h) pushHistory(h);

    if (slot.ready && slot.ready.pair && !avoidKeys().has(pairKey(slot.ready.pair))) {
      showPair(slot.ready.pair);
      prefetchNext(avoidKeys());
      if (flashSide) {
        flashId.current += 1;
        setFlash({ id: flashId.current, side: flashSide });
        clearTimeout(flashTimer.current);
        flashTimer.current = setTimeout(() => setFlash(null), FLASH_MS);
      }
    } else if (slot.ready && slot.ready.done) {
      showPair(null);
      setDone(true);
      setError(slot.ready.error);
    } else {
      // Picked faster than the prefetch: wait for the request already in flight.
      showPair(null);
      setLoading(true);
      (slot.promise || Promise.resolve(null)).then((r) => {
        if (nextRef.current !== slot || !alive.current) return; // an Undo took over meanwhile
        if (r && r.pair && !avoidKeys().has(pairKey(r.pair))) {
          setLoading(false);
          showPair(r.pair);
          prefetchNext(avoidKeys());
        } else {
          loadFresh();
        }
      });
    }
  };

  const handleChoice = (side) => {
    const p = pairRef.current;
    if (!p || Date.now() - shownAt.current < MIN_VIEW_MS) return;
    const winner = side === 'left' ? p.left : p.right;
    const loser = side === 'left' ? p.right : p.left;
    const entry = queue.push({
      kind: 'vote',
      url: '/api/pairwise/submit',
      body: { winner, loser, performer_id: Number(performerId), type: 'intra' }
    });
    watchVote(entry, (r) => {
      if (r.winnerScore && r.loserScore) {
        setLiveScores((s) => ({ ...s, [winner]: r.winnerScore, [loser]: r.loserScore }));
      }
    });
    advance({ pair: p, voted: true, entry }, side);
  };

  const handleBothBad = () => {
    const p = pairRef.current;
    if (!p || Date.now() - shownAt.current < MIN_VIEW_MS) return;
    const entry = queue.push({
      kind: 'bad',
      url: '/api/pairwise/both-bad',
      body: { left: p.left, right: p.right, performer_id: Number(performerId) }
    });
    watchVote(entry, () => {
      setLiveScores((s) => {
        const next = { ...s };
        delete next[p.left];
        delete next[p.right];
        return next;
      });
    });
    advance({ pair: p, voted: true, entry }, null);
  };

  const handleSkip = () => {
    const p = pairRef.current;
    if (!p || Date.now() - shownAt.current < MIN_VIEW_MS) return;
    // The server keeps a skipped pair as seen until it restarts, so it is not offered again.
    const entry = queue.push({ kind: 'skip', url: '/api/pairwise/skip', body: { left: p.left, right: p.right } });
    advance({ pair: p, voted: false, entry }, null);
  };

  const handleUndo = () => {
    const h = popHistory();
    if (!h) return;

    if (h.voted) {
      const vote = h.entry;
      // Not sent yet: it never will be. Sent: take back exactly that stored row, once its answer names it.
      if (!queue.cancel(vote)) {
        const undo = queue.push({
          kind: 'undo',
          url: '/api/pairwise/undo',
          body: () => (vote.status === 'saved' && vote.result && vote.result.pairId
            ? { performer_id: Number(performerId), pair_id: vote.result.pairId }
            : null),
          // leaving before the vote has an answer: the vote is not sent again
          reverses: vote
        });
        queue.whenSettled(undo).then((e) => {
          if (!alive.current) return;
          if (e.status === 'saved') {
            setSessionSaved((n) => Math.max(0, n - 1));
            statsSoon();
            rankingsSoon();
          } else if (e.status === 'rejected') {
            notify({ message: 'Could not undo: ' + e.error, severity: 'warning' });
          } else if (e.status === 'skipped' && vote.status === 'saved') {
            notify({ message: 'Could not undo: the server did not say which vote it stored', severity: 'warning' });
          }
        });
      }
      setLiveScores((s) => {
        const next = { ...s };
        delete next[h.pair.left];
        delete next[h.pair.right];
        return next;
      });
    }

    // The pair that was on screen becomes "next" again, so nothing is refetched.
    const current = pairRef.current;
    if (current) {
      const r = { pair: current };
      nextRef.current = { ready: r, promise: Promise.resolve(r) };
    } else {
      const avoid = avoidKeys();
      avoid.add(pairKey(h.pair));
      prefetchNext(avoid);
    }
    loadGen.current += 1;
    setLoading(false);
    setDone(false);
    setError(null);
    setFlash(null);
    showPair(h.pair);
  };

  const openRankings = () => {
    setDrawerOpen(true);
    drawerOpenRef.current = true;
    loadRankings();
  };

  const closeRankings = () => {
    setDrawerOpen(false);
    drawerOpenRef.current = false;
    clearTimeout(rankingsTimer.current);
  };

  const toggleRankings = () => {
    if (drawerOpenRef.current) closeRankings();
    else openRankings();
  };

  /** Leave the ranker: the back rule, with the route table's parent (the performer's gallery, else Rank pictures).
   *  Unsent votes are waited for first, then asked about. */
  const handleBack = useBack();
  const { leave, leaving } = useSafeLeave({ queue, counts, onLeave: handleBack });

  const continueInPortrait = () => {
    try { localStorage.setItem(STAY_PORTRAIT_KEY, '1'); } catch (_) { /* private mode */ }
    setStayPortrait(true);
  };

  const showRotate = isPortraitPhone && !stayPortrait;

  // One handler object per render, read through a ref, so the listener is
  // attached once and still sees current state.
  const keyActions = useRef({});
  keyActions.current = {
    left: () => handleChoice('left'),
    right: () => handleChoice('right'),
    skip: handleSkip,
    bad: handleBothBad,
    undo: handleUndo,
    rankings: toggleRankings,
    escape: () => (drawerOpenRef.current ? closeRankings() : leave()),
    rotate: showRotate,
    drawer: drawerOpen
  };

  useEffect(() => {
    const onKey = (e) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTyping(e.target)) return;
      if (document.querySelector('[role="dialog"]')) return; // a question is open: its keys are its own
      const k = (e.key || '').toLowerCase();
      const a = keyActions.current;
      let run = null;
      if (k === 'escape') run = a.escape;
      else if (a.rotate) return;
      else if (a.drawer) { if (k === 'r') run = a.rankings; }
      else if (k === 'arrowleft' || k === 'a') run = a.left;
      else if (k === 'arrowright' || k === 'd') run = a.right;
      else if (k === 's') run = a.skip;
      else if (k === 'b') run = a.bad;
      else if (k === 'z') run = a.undo;
      else if (k === 'r') run = a.rankings;
      if (!run) return;
      e.preventDefault();
      run();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const scoreOf = (imgPath, fallback) => liveScores[imgPath] || fallback;
  const stacked = isPortraitPhone;
  const totalLabel = stats && stats.performerPairs !== undefined ? stats.performerPairs : null;
  const scoredLabel = stats && stats.performerScoredImages !== undefined ? stats.performerScoredImages : null;
  const countChips = (
    <>
      <Box component="span" sx={chipSx}>{totalLabel === null ? '–' : totalLabel} pairs</Box>
      <Box component="span" sx={chipSx}>{scoredLabel === null ? '–' : scoredLabel} scored</Box>
    </>
  );

  // While the rotate prompt shows, every action stays in place but does nothing; behind the drawer only Rankings acts.
  const locked = showRotate;
  const actions = [
    { id: 'undo', label: 'Undo', kbd: 'Z', icon: <Undo fontSize="small" />, onClick: handleUndo, disabled: locked || drawerOpen || historyLen === 0 },
    { id: 'bad', label: 'Both bad', kbd: 'B', icon: <ThumbDown fontSize="small" />, onClick: handleBothBad, disabled: locked || drawerOpen || !pair, tone: 'bad' },
    { id: 'skip', label: 'Skip', kbd: 'S', icon: <SkipNext fontSize="small" />, onClick: handleSkip, disabled: locked || drawerOpen || !pair },
    { id: 'rankings', label: 'Rankings', kbd: 'R', icon: <EmojiEvents fontSize="small" />, onClick: toggleRankings, disabled: locked || !performerId }
  ];

  const roundBtn = (a) => (
    <Box component="button" type="button" key={a.id} onClick={a.onClick} disabled={a.disabled}
      title={a.label} aria-label={a.label} sx={actSx(a.tone, true, false)}>
      {a.icon}
    </Box>
  );

  let body;
  if (loading && !pair) {
    body = <Box sx={{ m: 'auto' }}><LoadingState label="Loading next pair…" /></Box>;
  } else if (!pair) {
    body = (
      <Box sx={{ m: 'auto', p: SPACE.lg }}>
        <EmptyState
          icon={<EmojiEvents />}
          title={error || (done ? 'All pairs compared' : 'Nothing to compare')}
          description={error
            ? (performerId ? 'The server did not give a pair. Try again in a moment.' : "Open the ranker from Rank pictures or a performer's gallery.")
            : sessionSaved > 0
              ? `You ranked ${plural(sessionSaved, 'pair')} this session.`
              : 'Try adding more images to this performer.'}
          action={
            <Box sx={{ display: 'flex', gap: SPACE.sm }}>
              <Button variant="contained" onClick={() => loadFresh()} disabled={!performerId}>Try again</Button>
              <Button variant="outlined" onClick={leave} disabled={leaving}>Back</Button>
            </Box>
          }
          sx={{ maxWidth: 460 }}
        />
      </Box>
    );
  } else {
    const sideProps = { stacked, touch: isTouch, compact: isLandscape, showInfo };
    body = (
      <>
        <Side {...sideProps} side="left" path={pair.left} src={getImageUrl(pair.left)}
          info={scoreOf(pair.left, pair.leftScore)}
          flash={flash ? { id: flash.id, win: flash.side === 'left' } : null}
          onPick={() => handleChoice('left')} />

        {isLandscape ? (
          <Box sx={{
            display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 1, px: '6px',
            bgcolor: 'var(--surface)', borderLeft: '1px solid var(--line)', borderRight: '1px solid var(--line)',
            flex: 'none', zIndex: 3
          }}>
            {actions.slice(0, 2).map(roundBtn)}
            <Typography sx={{ textAlign: 'center', fontSize: 12, fontWeight: 700, color: 'var(--muted)' }}>VS</Typography>
            {actions.slice(2).map(roundBtn)}
          </Box>
        ) : (
          <Box sx={{
            // '1px', NOT 1 — MUI's sx treats a unitless 0..1 as a FRACTION.
            width: stacked ? '100%' : '1px', height: stacked ? '1px' : 'auto',
            flex: 'none', zIndex: 2, bgcolor: 'var(--line-strong)', position: 'relative'
          }}>
            <Box sx={{
              position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
              bgcolor: 'var(--bg)', border: '1px solid var(--line-strong)', borderRadius: 'var(--radius)',
              fontSize: 12, fontWeight: 700, lineHeight: 1, px: '7px', py: '4px', color: 'var(--dim)'
            }}>
              VS
            </Box>
          </Box>
        )}

        <Side {...sideProps} side="right" path={pair.right} src={getImageUrl(pair.right)}
          info={scoreOf(pair.right, pair.rightScore)}
          flash={flash ? { id: flash.id, win: flash.side === 'right' } : null}
          onPick={() => handleChoice('right')} />
      </>
    );
  }

  const backSize = isLandscape ? 30 : 36;

  return (
    <Box sx={{
      height: ['100vh', '100dvh'], bgcolor: 'var(--bg)', color: 'var(--text)', fontSize: 14,
      display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative'
    }}>
      {/* header: one row */}
      <Box sx={{
        display: 'flex', alignItems: 'center', gap: 1, flex: 'none', minWidth: 0,
        px: isLandscape ? 1 : '10px', py: isLandscape ? '2px' : '6px',
        bgcolor: 'var(--surface)', borderBottom: '1px solid var(--line)'
      }}>
        <Box component="button" type="button" onClick={leave} aria-label={leaving ? 'Saving votes' : 'Back'}
          title={leaving ? 'Saving votes' : 'Back'} sx={{
            width: backSize, height: backSize, display: 'inline-grid', placeItems: 'center',
            background: 'none', border: 0, borderRadius: 'var(--radius)', cursor: 'pointer', flex: 'none', color: 'var(--text)',
            '&:hover': { bgcolor: 'var(--raised)' }
          }}>
          {leaving ? <CircularProgress size={16} sx={{ color: 'var(--dim)' }} /> : <ArrowBack fontSize="small" />}
        </Box>
        <Typography component="h1" noWrap sx={{ fontSize: isLandscape ? 13 : 15, fontWeight: 640, minWidth: 0 }}>
          {`Rank pictures: ${performerName}`}
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Box component="span" sx={accentChipSx}>{`${sessionSaved} this session`}</Box>
        <SaveChip counts={counts} onRetry={queue.retry} />
        {!isPhone && (
          <>
            {countChips}
            <ScoresSwitch checked={showInfo} onChange={setShowInfo} />
          </>
        )}
      </Box>

      {/* the two panes */}
      <Box sx={{
        flex: '1 1 0', minHeight: 0, display: 'flex', position: 'relative', touchAction: 'manipulation',
        flexDirection: stacked ? 'column' : 'row'
      }}>
        {body}

        {showRotate && (
          <Box sx={{
            position: 'absolute', inset: 0, zIndex: 20, bgcolor: 'var(--bg)',
            display: 'grid', placeItems: 'center', textAlign: 'center', p: 3
          }}>
            <Box>
              <ScreenRotation sx={{ fontSize: 56, color: 'var(--accent)' }} />
              <Typography component="h2" sx={{ fontSize: '1.1rem', fontWeight: 640, mt: 1.25, mb: 0.5 }}>
                Rotate your phone
              </Typography>
              <Typography sx={{ color: 'var(--muted)', fontSize: 13 }}>
                Two pictures side by side need the wide side.
              </Typography>
              <Button variant="outlined" size="small" onClick={continueInPortrait} sx={{ mt: 1.75 }}>
                Continue in portrait
              </Button>
            </Box>
          </Box>
        )}

        {drawerOpen && (
          <Box onClick={closeRankings} aria-hidden="true"
            sx={{ position: 'absolute', inset: 0, zIndex: 14, bgcolor: 'var(--scrim)', cursor: 'pointer' }} />
        )}

        {drawerOpen && (
          <Box component="aside" aria-label="Rankings" sx={{
            position: 'absolute', top: 0, right: 0, bottom: 0, width: 'min(430px, 100%)', zIndex: 15,
            bgcolor: 'var(--surface)', borderLeft: '1px solid var(--line-strong)', boxShadow: 'var(--shadow-lg)',
            display: 'flex', flexDirection: 'column'
          }}>
            <Box sx={{
              display: 'flex', alignItems: 'center', flexWrap: 'wrap', columnGap: 1, rowGap: '4px', px: '10px', py: '6px', minWidth: 0,
              borderBottom: '1px solid var(--line)', flex: 'none'
            }}>
              <Typography component="h2" noWrap sx={{ fontSize: 15, fontWeight: 640, minWidth: 0, flex: '1 1 0' }}>
                {`Rankings: ${performerName}`}
              </Typography>
              <Button size="small" variant="text" onClick={closeRankings}
                sx={{ flex: 'none', minWidth: 0, color: 'var(--dim)', '&:hover': { color: 'var(--text)', bgcolor: 'var(--raised)' } }}>
                Close
              </Button>
              {isPhone && (
                <>
                  {/* phones: the counts and the switch get their own line, so the name keeps the first */}
                  <Box sx={{ flexBasis: '100%', height: 0 }} />
                  {countChips}
                  <Box sx={{ flex: 1 }} />
                  <ScoresSwitch checked={showInfo} onChange={setShowInfo} />
                </>
              )}
            </Box>
            {rankingsError && <Typography sx={{ p: 2, color: 'var(--bad)', fontSize: 13 }}>{rankingsError}</Typography>}
            {!rankings && !rankingsError && <LoadingState label="Loading rankings…" />}
            {rankings && rankings.images.length === 0 && (
              <Typography sx={{ p: 2, color: 'var(--muted)', fontSize: 13 }}>No scored images yet.</Typography>
            )}
            {rankings && rankings.images.length > 0 && (
              <Box sx={{
                overflowY: 'auto', p: '10px', display: 'grid', gap: 1, alignContent: 'start',
                gridTemplateColumns: 'repeat(auto-fill, minmax(88px, 1fr))'
              }}>
                {rankings.images.map((img, n) => (
                  <Box key={img.path} title={`${img.comparisons} comparisons`} sx={{
                    position: 'relative', aspectRatio: '3/4', borderRadius: 'var(--radius)', overflow: 'hidden',
                    bgcolor: 'var(--raised)', opacity: img.bothBad ? 0.45 : 1
                  }}>
                    <img loading="lazy" alt="" src={previewUrl(img.path)}
                      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                    <Box component="span" sx={picChipSx('var(--text)', { left: 3, top: 3 })}>#{n + 1}</Box>
                    <Box component="span" sx={picChipSx(img.bothBad ? 'var(--bad)' : 'var(--warn)', { right: 3, bottom: 3 })}>
                      {img.bothBad ? 'bad' : Math.round(img.score)}
                    </Box>
                  </Box>
                ))}
              </Box>
            )}
          </Box>
        )}
      </Box>

      {/* the bar that never moves; phone landscape uses the middle column instead */}
      {!isLandscape && (
        <Box sx={{
          display: 'grid', gridAutoFlow: 'column', gridAutoColumns: '1fr', flex: 'none',
          gap: isPortraitPhone ? 0.5 : 1, px: isPortraitPhone ? '6px' : '10px', pt: isPortraitPhone ? '6px' : 1,
          // Keeps the row off the gesture bar / rounded corners on a phone.
          pb: `calc(${isPortraitPhone ? '6px' : '8px'} + env(safe-area-inset-bottom, 0px))`,
          bgcolor: 'var(--surface)', borderTop: '1px solid var(--line)'
        }}>
          {actions.map((a) => (
            <Box component="button" type="button" key={a.id} onClick={a.onClick} disabled={a.disabled}
              title={a.label} aria-label={a.label} sx={actSx(a.tone, false, isPortraitPhone)}>
              {a.icon}
              {isPortraitPhone ? (
                <Box component="span" sx={{ fontSize: 12, fontWeight: 600, lineHeight: 1.2 }}>{a.label}</Box>
              ) : (
                <>
                  <Box component="b" sx={{ fontWeight: 600 }}>{a.label}</Box>
                  <Box component="kbd" sx={kbdSx}>{a.kbd}</Box>
                </>
              )}
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}

export default PairwiseRankPage;
