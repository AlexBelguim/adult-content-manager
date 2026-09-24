import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Box, Typography, Button, useMediaQuery } from '@mui/material';
import { ArrowBack, ThumbDown, Undo, SkipNext, EmojiEvents, ScreenRotation } from '@mui/icons-material';
import { EmptyState, LoadingState, SPACE } from '../components/layout';

const STAY_PORTRAIT_KEY = 'pairwiseRank:stayPortrait';
const FLASH_MS = 240;
// The swap is instant, so the second tap of an accidental double tap would
// land on a pair nobody has looked at yet. Votes this soon are ignored.
const MIN_VIEW_MS = 180;

const pairKey = (p) => (p ? [p.left, p.right].sort().join('|') : '');
const previewUrl = (imgPath) => `/api/files/preview?path=${encodeURIComponent(imgPath)}`;

const readStay = () => {
  try { return sessionStorage.getItem(STAY_PORTRAIT_KEY) === '1'; } catch (_) { return false; }
};

const chipSx = {
  fontSize: '.74rem', border: '1px solid var(--line-strong)', borderRadius: '99px',
  px: '10px', py: '1px', color: 'var(--dim)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums'
};
const accentChipSx = { ...chipSx, borderColor: 'var(--accent)', color: 'var(--accent)' };

const kbdSx = {
  font: '600 .72rem ui-monospace, monospace', border: '1px solid currentColor',
  borderRadius: '4px', px: '5px', opacity: 0.6
};

/** Shared look of an action; `round` is the phone-landscape middle column. */
const actSx = (tone, round) => ({
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1,
  font: 'inherit', fontWeight: 600, fontSize: '.88rem', whiteSpace: 'nowrap', cursor: 'pointer',
  color: tone === 'bad' ? 'var(--bad)' : 'var(--text)',
  bgcolor: tone === 'bad' ? 'var(--bad-quiet)' : 'var(--raised)',
  border: '1px solid', borderColor: tone === 'bad' ? 'var(--bad)' : 'var(--line-strong)',
  ...(round
    ? { width: 46, height: 46, borderRadius: '50%', p: 0, flex: 'none' }
    : { height: 46, borderRadius: '8px', minWidth: 0, px: 1 }),
  '&:hover:not(:disabled)': { filter: 'brightness(1.25)' },
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
        position: 'absolute', bottom: 0, left: 0, right: 0,
        px: 1.5, pt: compact ? 2 : 3, pb: compact ? 0.75 : 1.25,
        display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap',
        background: 'linear-gradient(to top, var(--scrim-strong), transparent)',
        opacity: touch ? 1 : 0, transition: 'opacity .12s', fontSize: '.8rem'
      }}>
        <Typography sx={{ color: 'var(--text)', fontWeight: 700, fontSize: 'inherit' }}>{label}</Typography>
        <Box sx={{ flex: 1 }} />
        {showInfo && info && (
          <>
            <Box component="span" sx={chipSx}>score {Number(info.score).toFixed(1)}</Box>
            <Box component="span" sx={chipSx}>{info.comparisons} compared</Box>
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
              ? { boxShadow: 'inset 0 0 0 4px var(--ok), inset 0 0 80px var(--ok)' }
              : { bgcolor: 'var(--scrim)' })
          }}
        />
      )}
    </Box>
  );
}

/**
 * Pairwise image ranking: two pictures of one performer, tap the better one.
 * Opens from "Rank Images" in the unified gallery, chrome-free and full-bleed.
 *
 * The next pair is fetched and its images decoded while the current pair is on
 * screen, so a pick swaps in the same tick; votes go out in the background
 * through a serial queue (so an Undo always lands after the vote it reverses).
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
  // Touch devices never fire :hover, so the label has to be always visible.
  const isTouch = useMediaQuery('(hover: none)');
  const performerId = searchParams.get('performerId');
  const performerName = searchParams.get('performerName') || 'Unknown';
  const basePath = searchParams.get('basePath') || '';

  const [pair, setPair] = useState(null); // { left, right, leftScore, rightScore }
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState(null);
  const [pairCount, setPairCount] = useState(0);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);
  const [history, setHistory] = useState([]); // [{ pair, voted }]
  const [flash, setFlash] = useState(null); // { id, side }
  const [showInfo, setShowInfo] = useState(false);
  const [liveScores, setLiveScores] = useState({});
  const [stayPortrait, setStayPortrait] = useState(readStay);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [rankings, setRankings] = useState(null);
  const [rankingsError, setRankingsError] = useState(null);

  const pairRef = useRef(null);
  const nextRef = useRef({ ready: null, promise: null });
  const queueRef = useRef(Promise.resolve());
  const flashTimer = useRef(null);
  const flashId = useRef(0);
  const preloaded = useRef([]);
  const loadGen = useRef(0);
  const shownAt = useRef(0);

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

  /** One pair from the server, never the pair identified by `avoidKey`. */
  const fetchPair = useCallback(async (avoidKey) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch(`/api/pairwise/next-pair?performer_id=${performerId}&type=intra`);
      const data = await res.json();
      if (data.error || data.done) return { done: true, error: data.error || null };
      if (pairKey(data) !== avoidKey) {
        preload(data);
        return { pair: data };
      }
    }
    // Only the on-screen pair is left unseen: decide again once it is voted on.
    return null;
  }, [performerId, preload]);

  const prefetchNext = useCallback((avoidKey) => {
    const slot = { ready: null, promise: null };
    slot.promise = fetchPair(avoidKey)
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
      setStats(await res.json());
    } catch (_) { /* counters are cosmetic */ }
  }, [performerId]);

  /** Slow path: nothing prefetched (first load, Try again, or the prefetch lost). */
  const loadFresh = useCallback(async (avoidKey) => {
    const gen = ++loadGen.current;
    setLoading(true);
    setError(null);
    try {
      await queueRef.current;
      const r = await fetchPair(avoidKey);
      if (gen !== loadGen.current) return; // an Undo restored a pair meanwhile
      if (r && r.pair) {
        setDone(false);
        showPair(r.pair);
        prefetchNext(pairKey(r.pair));
      } else {
        showPair(null);
        setDone(true);
        setError(r ? r.error : null);
      }
    } catch (err) {
      if (gen !== loadGen.current) return;
      showPair(null);
      setError('Failed to load pair: ' + err.message);
    }
    setLoading(false);
  }, [fetchPair, prefetchNext, showPair]);

  useEffect(() => {
    if (!performerId) {
      setLoading(false);
      setError('No performer selected');
      return;
    }
    loadFresh('');
    fetchStats();
  }, [performerId, loadFresh, fetchStats]);

  useEffect(() => () => clearTimeout(flashTimer.current), []);

  const enqueue = (job) => {
    queueRef.current = queueRef.current.then(job).catch(() => {});
    return queueRef.current;
  };

  /** Show the prefetched pair now; `entry` is what Undo will restore. */
  const advance = (entry, flashSide) => {
    const current = pairRef.current;
    const slot = nextRef.current;
    if (entry) setHistory((h) => [...h, entry]);

    if (slot.ready && slot.ready.pair) {
      showPair(slot.ready.pair);
      prefetchNext(pairKey(slot.ready.pair));
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
      const avoidKey = entry && entry.voted ? '' : pairKey(current);
      showPair(null);
      setLoading(true);
      (slot.promise || Promise.resolve(null)).then((r) => {
        if (nextRef.current !== slot) return; // an Undo took over meanwhile
        if (r && r.pair) {
          setLoading(false);
          showPair(r.pair);
          prefetchNext(pairKey(r.pair));
        } else {
          loadFresh(avoidKey);
        }
      });
    }
  };

  const handleChoice = (side) => {
    const p = pairRef.current;
    if (!p || Date.now() - shownAt.current < MIN_VIEW_MS) return;
    const winner = side === 'left' ? p.left : p.right;
    const loser = side === 'left' ? p.right : p.left;
    enqueue(async () => {
      const res = await fetch('/api/pairwise/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ winner, loser, performer_id: parseInt(performerId), type: 'intra' })
      });
      const data = await res.json();
      if (data.winnerScore && data.loserScore) {
        setLiveScores((s) => ({ ...s, [winner]: data.winnerScore, [loser]: data.loserScore }));
      }
      fetchStats();
    });
    setPairCount((n) => n + 1);
    advance({ pair: p, voted: true }, side);
  };

  const handleBothBad = () => {
    const p = pairRef.current;
    if (!p || Date.now() - shownAt.current < MIN_VIEW_MS) return;
    enqueue(async () => {
      await fetch('/api/pairwise/both-bad', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ left: p.left, right: p.right, performer_id: parseInt(performerId) })
      });
      setLiveScores((s) => {
        const next = { ...s };
        delete next[p.left];
        delete next[p.right];
        return next;
      });
      fetchStats();
    });
    setPairCount((n) => n + 1);
    advance({ pair: p, voted: true }, null);
  };

  const handleSkip = () => {
    const p = pairRef.current;
    if (!p) return;
    advance({ pair: p, voted: false }, null);
  };

  const handleUndo = () => {
    const entry = history[history.length - 1];
    if (!entry) return;
    setHistory((h) => h.slice(0, -1));

    if (entry.voted) {
      enqueue(async () => {
        await fetch('/api/pairwise/undo', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ performer_id: parseInt(performerId) })
        });
        fetchStats();
      });
      setPairCount((n) => Math.max(0, n - 1));
      setLiveScores((s) => {
        const next = { ...s };
        delete next[entry.pair.left];
        delete next[entry.pair.right];
        return next;
      });
    }

    // The pair that was on screen becomes "next" again, so nothing is refetched.
    const current = pairRef.current;
    if (current) {
      const r = { pair: current };
      nextRef.current = { ready: r, promise: Promise.resolve(r) };
    } else {
      prefetchNext(pairKey(entry.pair));
    }
    loadGen.current += 1;
    setLoading(false);
    setDone(false);
    setError(null);
    setFlash(null);
    showPair(entry.pair);
  };

  const openRankings = useCallback(async () => {
    setDrawerOpen(true);
    setRankingsError(null);
    try {
      await queueRef.current;
      const res = await fetch(`/api/pairwise/image-rankings?performer_id=${performerId}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      const images = [...(data.images || [])].sort((a, b) => (a.bothBad ? 1 : 0) - (b.bothBad ? 1 : 0) || b.score - a.score);
      setRankings({ ...data, images });
    } catch (err) {
      setRankingsError('Failed to load rankings: ' + err.message);
    }
  }, [performerId]);

  const toggleRankings = () => {
    if (drawerOpen) setDrawerOpen(false);
    else openRankings();
  };

  /**
   * Leave the ranker. The gallery opens this page with window.open(..., '_blank'),
   * so the tab starts with a single history entry and history.back() alone does
   * nothing: close the tab when a script opened it, otherwise navigate.
   */
  const handleBack = () => {
    if (window.opener && !window.opener.closed) {
      window.close();
      return;
    }
    if (window.history.length > 1) {
      window.history.back();
      return;
    }
    window.location.href = (performerName && performerName !== 'Unknown' && basePath)
      ? `/unified-gallery?performer=${encodeURIComponent(performerName)}&basePath=${encodeURIComponent(basePath)}`
      : '/';
  };

  const continueInPortrait = () => {
    try { sessionStorage.setItem(STAY_PORTRAIT_KEY, '1'); } catch (_) { /* private mode */ }
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
    escape: () => (drawerOpen ? setDrawerOpen(false) : handleBack()),
    blocked: showRotate
  };

  useEffect(() => {
    const onKey = (e) => {
      const t = e.target;
      const typing = t && (t.isContentEditable || /^(TEXTAREA|SELECT)$/.test(t.tagName)
        || (t.tagName === 'INPUT' && t.type !== 'checkbox'));
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      const a = keyActions.current;
      let run = null;
      if (k === 'escape') run = a.escape;
      else if (a.blocked) return;
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

  const actions = [
    { id: 'undo', label: 'Undo', kbd: 'Z', icon: <Undo fontSize="small" />, onClick: handleUndo, disabled: history.length === 0 },
    { id: 'bad', label: 'Both bad', kbd: 'B', icon: <ThumbDown fontSize="small" />, onClick: handleBothBad, disabled: !pair, tone: 'bad' },
    { id: 'skip', label: 'Skip', kbd: 'S', icon: <SkipNext fontSize="small" />, onClick: handleSkip, disabled: !pair },
    { id: 'rankings', label: 'Rankings', kbd: 'R', icon: <EmojiEvents fontSize="small" />, onClick: toggleRankings, disabled: !performerId }
  ];

  const roundBtn = (a) => (
    <Box component="button" key={a.id} onClick={a.onClick} disabled={a.disabled}
      title={a.label} aria-label={a.label} sx={actSx(a.tone, true)}>
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
          description={pairCount > 0
            ? `You ranked ${pairCount} pairs this session.`
            : 'Try adding more images to this performer.'}
          action={
            <Box sx={{ display: 'flex', gap: SPACE.sm }}>
              <Button variant="contained" onClick={() => loadFresh('')} disabled={!performerId}>Try again</Button>
              <Button variant="outlined" onClick={handleBack}>Close</Button>
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
            <Typography sx={{ textAlign: 'center', fontSize: '.62rem', fontWeight: 700, color: 'var(--muted)' }}>VS</Typography>
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
              bgcolor: 'var(--bg)', border: '1px solid var(--line-strong)', borderRadius: '6px',
              fontSize: '.68rem', fontWeight: 700, px: '7px', py: '3px', color: 'var(--dim)'
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

  return (
    <Box sx={{
      height: ['100vh', '100dvh'], bgcolor: 'var(--bg)', color: 'var(--text)', fontSize: 14,
      display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative'
    }}>
      {/* header */}
      <Box sx={{
        display: 'flex', alignItems: 'center', gap: 1, flex: 'none', minWidth: 0,
        px: isLandscape ? 1 : '10px', py: isLandscape ? '2px' : '6px',
        bgcolor: 'var(--surface)', borderBottom: '1px solid var(--line)'
      }}>
        <Box component="button" onClick={handleBack} aria-label="Back" title="Back" sx={{
          width: isLandscape ? 30 : 36, height: isLandscape ? 30 : 36, display: 'inline-grid', placeItems: 'center',
          background: 'none', border: 0, borderRadius: '6px', cursor: 'pointer', flex: 'none', color: 'var(--text)',
          '&:hover': { bgcolor: 'var(--raised)' }
        }}>
          <ArrowBack fontSize="small" />
        </Box>
        <Typography component="h2" noWrap sx={{ fontSize: isLandscape ? '.84rem' : '.98rem', fontWeight: 640, minWidth: 0 }}>
          Rank — {performerName}
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Box component="span" sx={accentChipSx}>{pairCount} this session</Box>
        {!isLandscape && !isPortraitPhone && (
          <>
            <Box component="span" sx={chipSx}>{totalLabel === null ? '–' : totalLabel} total</Box>
            <Box component="span" sx={chipSx}>{scoredLabel === null ? '–' : scoredLabel} scored</Box>
            <Box component="label" title="Show score and comparison count on the picture label"
              sx={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '.78rem', color: 'var(--dim)', whiteSpace: 'nowrap', cursor: 'pointer' }}>
              <input type="checkbox" checked={showInfo} onChange={(e) => setShowInfo(e.target.checked)}
                style={{ accentColor: 'var(--accent)' }} />
              scores
            </Box>
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
              <Typography sx={{ color: 'var(--muted)', fontSize: '.8rem' }}>
                Two pictures side by side need the wide side.
              </Typography>
              <Button variant="outlined" size="small" onClick={continueInPortrait} sx={{ mt: 1.75 }}>
                Continue in portrait
              </Button>
            </Box>
          </Box>
        )}

        {drawerOpen && (
          <Box component="aside" sx={{
            position: 'absolute', top: 0, right: 0, bottom: 0, width: 'min(430px, 100%)', zIndex: 15,
            bgcolor: 'var(--surface)', borderLeft: '1px solid var(--line-strong)', boxShadow: 'var(--shadow-lg)',
            display: 'flex', flexDirection: 'column'
          }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: '10px', py: '6px', borderBottom: '1px solid var(--line)', flex: 'none' }}>
              <Typography component="h2" noWrap sx={{ fontSize: '.98rem', fontWeight: 640, minWidth: 0 }}>
                Rankings — {performerName}
              </Typography>
              <Box sx={{ flex: 1 }} />
              {rankings && <Box component="span" sx={chipSx}>{rankings.totalComparisons} compared</Box>}
              <Button size="small" variant="outlined" onClick={() => setDrawerOpen(false)}>Close</Button>
            </Box>
            {rankingsError && <Typography sx={{ p: 2, color: 'var(--bad)', fontSize: '.84rem' }}>{rankingsError}</Typography>}
            {!rankings && !rankingsError && <LoadingState label="Loading rankings…" />}
            {rankings && rankings.images.length === 0 && (
              <Typography sx={{ p: 2, color: 'var(--muted)', fontSize: '.84rem' }}>No scored images yet.</Typography>
            )}
            {rankings && rankings.images.length > 0 && (
              <Box sx={{
                overflowY: 'auto', p: '10px', display: 'grid', gap: 1, alignContent: 'start',
                gridTemplateColumns: 'repeat(auto-fill, minmax(88px, 1fr))'
              }}>
                {rankings.images.map((img, n) => (
                  <Box key={img.path} title={`${img.comparisons} comparisons`} sx={{
                    position: 'relative', aspectRatio: '3/4', borderRadius: '6px', overflow: 'hidden',
                    bgcolor: 'var(--raised)', opacity: img.bothBad ? 0.45 : 1
                  }}>
                    <img loading="lazy" alt="" src={previewUrl(img.path)}
                      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                    <Box component="em" sx={rankTagSx({ left: 3, top: 3 })}>#{n + 1}</Box>
                    <Box component="span" sx={rankTagSx({ right: 3, bottom: 3, color: img.bothBad ? 'var(--bad)' : 'var(--warn)' })}>
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
            <Box component="button" key={a.id} onClick={a.onClick} disabled={a.disabled}
              title={a.label} aria-label={a.label} sx={actSx(a.tone, false)}>
              {a.icon}
              {!isPortraitPhone && (
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

const rankTagSx = (pos) => ({
  position: 'absolute', fontStyle: 'normal', fontSize: 10, fontWeight: 700, lineHeight: '16px',
  bgcolor: 'var(--scrim-strong)', borderRadius: '3px', px: '5px', ...pos
});

export default PairwiseRankPage;
