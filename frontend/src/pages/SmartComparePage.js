import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Box, Typography, Button, Rating, Slider, IconButton, CircularProgress, useMediaQuery
} from '@mui/material';
import {
  ArrowBack, ArrowUpward, ArrowDownward, Refresh, Undo, SkipNext, DragHandle, Check, TuneOutlined, InsightsOutlined
} from '@mui/icons-material';
import { Link as RouterLink } from 'react-router-dom';
import { useBack, useChrome } from '../nav';
import { motion, AnimatePresence } from 'framer-motion';
import {
  SidebarPage, SideGroup, SideField, SideFacts, SideButtons, SideButton, SideNote, ContentLine, SIDE,
  useSidebarMode, useSidebarSheet, visuallyHiddenSx, LoadingState, EmptyState, iconBtnSx
} from '../components/layout';
import { useNotify, useToastLift, errorText } from '../components/ui';
import { RATE_VIEWS } from '../components/rating/RateTabs';
import { useVoteQueue, useSafeLeave } from '../components/rating/voteQueue';
import { useRatingReset } from '../components/rating/RatingReset';

const CALIBRATION_THRESHOLD = 5; // duels a performer needs before proximity pairing
const MAX_PICS = 50;
const FLASH_MS = 240;
// The swap is instant, so the second tap of an accidental double tap would
// land on a set nobody has looked at yet. Picks this soon are ignored.
const MIN_VIEW_MS = 180;
// Draw, Skip and Save this order need a little longer: they act on the whole set.
const SET_GUARD_MS = 600;
// Save this order without any reordering only once the set was on screen this long.
const LOOK_MS = 2000;

const previewUrl = (p) => `/api/files/preview?path=${encodeURIComponent(p)}`;

/** POST JSON; trusts the answer only when res.ok, else throws the server's error or the status text. */
const postJson = async (url, body) => {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && data.error) || res.statusText || `HTTP ${res.status}`);
  if (!data) throw new Error('The server sent no answer');
  return data;
};

/** Fisher-Yates, on a copy. */
function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const pickOne = (list) => list[Math.floor(Math.random() * list.length)];
const byRating = (a, b) => (b.performer_rating || 0) - (a.performer_rating || 0);

/**
 * Pick `count` performers to compare. A calibrating performer (fewer than
 * CALIBRATION_THRESHOLD duels) meets one opponent from each of count - 1 equal
 * slices of the rating-sorted list, so a duel draws its opponent from the whole
 * range; once everyone is established, a contiguous window of the sorted list is
 * taken so neighbours get compared.
 */
function performSmartSelection(allPerformers, count) {
  const sorted = [...allPerformers].sort(byRating);
  const calibrating = allPerformers.filter(p => (p.comparison_count || 0) < CALIBRATION_THRESHOLD);

  if (calibrating.length > 0) {
    const picked = pickOne(calibrating);
    const pool = sorted.filter(p => p.id !== picked.id);
    if (pool.length < count - 1) return shuffle([picked, ...pool]);
    const k = count - 1;
    const opponents = [];
    for (let t = 0; t < k; t++) {
      const slice = pool.slice(Math.floor(t * pool.length / k), Math.floor((t + 1) * pool.length / k));
      opponents.push(pickOne(slice));
    }
    return shuffle([picked, ...opponents]);
  }

  if (sorted.length <= count) return shuffle(sorted);
  const anchor = Math.floor(Math.random() * (sorted.length - count + 1));
  return shuffle(sorted.slice(anchor, anchor + count));
}

const readStored = (key, fallback, min, max) => {
  let v = NaN;
  try { v = parseInt(localStorage.getItem(key), 10); } catch (_) { /* no storage */ }
  if (!Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, v));
};
const writeStored = (key, value) => {
  try { localStorage.setItem(key, String(value)); } catch (_) { /* no storage */ }
};

const chipSx = {
  display: 'inline-flex', alignItems: 'center', height: 22, px: '8px', flex: 'none',
  fontSize: '12px', lineHeight: 1, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums',
  border: '1px solid var(--line-strong)', borderRadius: 'var(--radius-lg)', color: 'var(--dim)'
};
const warnChipSx = { ...chipSx, borderColor: 'var(--warn)', color: 'var(--warn)' };

const kbdSx = {
  fontFamily: 'inherit', fontSize: '12px', fontWeight: 600, lineHeight: 1.4, fontVariantNumeric: 'tabular-nums',
  border: '1px solid currentColor', borderRadius: 'var(--radius-sm)', px: '5px', opacity: 0.7
};

const btnSx = (size) => ({ ...iconBtnSx(), width: size, height: size, minWidth: size, '&.Mui-disabled': { color: 'var(--faint)' } });

/** Shared look of an action; `round` is the phone-landscape middle column, `stacked` the phone-portrait bar. */
const actSx = (round, stacked) => ({
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  flexDirection: stacked ? 'column' : 'row', gap: stacked ? '2px' : 1,
  font: 'inherit', fontWeight: 600, fontSize: stacked ? '12px' : '14px', whiteSpace: 'nowrap', cursor: 'pointer',
  color: 'var(--text)', bgcolor: 'var(--raised)',
  border: '1px solid var(--line-strong)',
  transition: 'background-color .12s ease',
  ...(round
    ? { width: 46, height: 46, borderRadius: '50%', p: 0, flex: 'none' }
    : { height: stacked ? 52 : 46, borderRadius: 'var(--radius)', minWidth: 0, px: 1 }),
  '&:hover:not(:disabled)': { bgcolor: 'var(--overlay)' },
  '&:focus-visible': { outline: '2px solid var(--accent)', outlineOffset: '1px' },
  '&:disabled': { opacity: 0.35, cursor: 'default' }
});

const starsSx = { color: 'var(--warn)', '& .MuiRating-iconEmpty': { color: 'var(--faint)' } };

const Stars = ({ value, compact }) => (
  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
    <Rating value={value || 0} precision={0.1} readOnly size="small" sx={{ ...starsSx, fontSize: compact ? '.85rem' : undefined }} />
    <Typography component="span" sx={{ color: 'var(--muted)', fontSize: '13px', fontVariantNumeric: 'tabular-nums' }}>
      {(value || 0).toFixed(2)}
    </Typography>
  </Box>
);

const DuelBadge = ({ count }) => (
  (count || 0) < CALIBRATION_THRESHOLD
    ? <Box component="span" sx={warnChipSx}>calibrating {count || 0}/{CALIBRATION_THRESHOLD}</Box>
    : <Box component="span" sx={chipSx}>{count} duels</Box>
);

const Placeholder = ({ sx = {} }) => (
  <Box sx={{ aspectRatio: '3/4', borderRadius: 'var(--radius-sm)', bgcolor: 'var(--raised)', ...sx }} />
);

const NoPics = ({ sx = {} }) => (
  <Typography sx={{ color: 'var(--muted)', fontSize: '13px', alignSelf: 'center', ...sx }}>
    No pictures in the pics folder
  </Typography>
);

const sliderSx = {
  color: 'var(--accent)', py: '10px',
  '& .MuiSlider-thumb': { width: 14, height: 14, boxShadow: 'none' },
  '& .MuiSlider-thumb:hover, & .MuiSlider-thumb.Mui-focusVisible': { boxShadow: 'none', outline: '2px solid var(--accent)', outlineOffset: '2px' },
  '& .MuiSlider-rail': { bgcolor: 'var(--line-strong)', opacity: 1 }
};

/** A slider just used keeps no focus, so the arrow keys go back to picking. */
const blurActive = () => {
  const el = document.activeElement;
  if (el && typeof el.blur === 'function') el.blur();
};

const TEXT_INPUTS = new Set(['text', 'search', 'number', 'email', 'url', 'password', 'tel']);
const isTyping = (t) => !!t && (t.isContentEditable || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT'
  || (t.tagName === 'INPUT' && TEXT_INPUTS.has((t.type || 'text').toLowerCase())));
const inSlider = (t) => !!t && !!t.closest && !!(t.closest('[role="slider"]') || t.closest('.MuiSlider-root'));
// A dialog, the rail's flyout or the phone sheet is open: it handles its own keys, Esc included.
const overlayOpen = () => !!document.querySelector('[role="dialog"], .MuiModal-root:not(.MuiModal-hidden)');

const valueSx = { color: 'var(--text)', fontWeight: 600, fontVariantNumeric: 'tabular-nums', minWidth: '2ch', textAlign: 'right' };

/** "Saved" / "Saving 2" / "2 not saved": the vote queue in words. */
const saveWords = (c) => (c.failed > 0 ? `${c.failed} not saved` : c.unsent > 0 ? `Saving ${c.unsent}` : 'Saved');

/**
 * The one line over the compare area. Phone: a Filters button opens the sheet (the page draws its own, so the
 * frame's search row stays off). Phone held sideways (bare): the page's own Back comes first.
 */
function CompareLine({ meta, bare, onBack, leaving }) {
  const mode = useSidebarMode();
  const sheet = useSidebarSheet();
  const phone = mode === 'phone';
  let filters = null;
  if (phone && bare) {
    filters = (
      <IconButton onClick={sheet.open} aria-label="Filters" title="Filters" aria-haspopup="dialog"
        sx={{ ...btnSx(30), color: 'var(--text)' }}>
        <TuneOutlined />
      </IconButton>
    );
  } else if (phone) {
    filters = (
      <Button variant="outlined" size="small" onClick={sheet.open} aria-haspopup="dialog"
        startIcon={<TuneOutlined />}
        sx={{ height: 32, fontSize: 13, color: 'var(--text)', borderColor: 'var(--line-strong)', textTransform: 'none' }}>
        Filters
      </Button>
    );
  }
  const line = (
    <ContentLine
      title="Smart Compare"
      meta={meta}
      actions={filters}
      sx={bare
        ? { mb: 0, height: 'auto', minHeight: 34 }
        : phone
          ? { mb: 0, px: '12px', py: '6px', minHeight: 44 }
          : { mb: 0, height: 48, px: '24px', borderBottom: '1px solid var(--line)' }}
    />
  );
  if (!bare) return line;
  return (
    <Box sx={{
      display: 'flex', alignItems: 'center', gap: 1, flex: 'none', minWidth: 0,
      px: 1, py: '2px', bgcolor: 'var(--surface)', borderBottom: '1px solid var(--line)'
    }}>
      {phone ? <Typography component="h1" sx={visuallyHiddenSx}>Smart Compare</Typography> : null}
      <IconButton onClick={onBack} disabled={leaving} aria-label="Back" title={leaving ? 'Saving…' : 'Back'}
        sx={{ ...btnSx(30), color: 'var(--text)' }}>
        {leaving ? <CircularProgress size={16} sx={{ color: 'var(--dim)' }} /> : <ArrowBack />}
      </IconButton>
      <Box sx={{ flex: 1, minWidth: 0 }}>{line}</Box>
    </Box>
  );
}

/**
 * Smart Compare: two performers side by side with their photo grids, or 3–10
 * in a ranked list. The next set (selection + photos) is prefetched while the
 * current one is on screen, so advancing is instant; votes go out through the
 * shared serial vote queue, which retries failed sends and lets Undo cancel a
 * vote that was never sent or reverse one that was.
 */
function SmartComparePage() {
  const back = useBack('/');
  const chrome = useChrome();
  const toast = useNotify();
  const isLandscape = useMediaQuery('(max-height:500px) and (orientation:landscape)');
  const isNarrow = useMediaQuery('(max-width:600px)');
  const isTouch = useMediaQuery('(hover: none)');
  const isPortraitPhone = isNarrow && !isLandscape;
  const compact = isLandscape || isPortraitPhone;

  const { queue, counts } = useVoteQueue();
  const { leave, leaving } = useSafeLeave({ queue, counts, onLeave: back });

  const [performers, setPerformers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [randomPics, setRandomPics] = useState({});
  const [compareList, setCompareList] = useState([]);
  const [recalibrating, setRecalibrating] = useState(false);
  const [globalModel, setGlobalModel] = useState(null); // the model params, with n_effective
  const [performerCount, setPerformerCount] = useState(() => readStored('compare_performerCount', 2, 2, 10));
  const [picsPerPerformer, setPicsPerPerformer] = useState(() => readStored('compare_picsPerPerformer', 10, 1, MAX_PICS));
  const [sessionCount, setSessionCount] = useState(0); // confirmed votes only
  const [history, setHistory] = useState([]); // [{ list, pics, voted, entry }]
  const [flash, setFlash] = useState(null);   // { id, index }
  const [orderChanged, setOrderChanged] = useState(false);
  const [lookedLong, setLookedLong] = useState(false);

  // Values the async paths (prefetch, vote results) read without going stale.
  const perfsRef = useRef([]);
  const countRef = useRef(performerCount);
  const picsRef = useRef(picsPerPerformer);
  const listRef = useRef(compareList);
  const nextRef = useRef(null);      // prefetched { list, pics, promise, done }
  const activeSlot = useRef(null);
  const shownAt = useRef(0);
  const flashTimer = useRef(null);
  const flashId = useRef(0);
  const sliderTimer = useRef(null);
  const lookTimer = useRef(null);
  const mounted = useRef(true);
  listRef.current = compareList;

  const notify = useCallback((msg, severity = 'info') => toast({ message: msg, severity }), [toast]);

  // Toasts sit above the action bar (phone landscape has none: its actions are in the middle column).
  useToastLift(isLandscape ? null : 'calc(76px + var(--nav-bottom, env(safe-area-inset-bottom, 0px)))');

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimeout(flashTimer.current);
      clearTimeout(sliderTimer.current);
      clearTimeout(lookTimer.current);
    };
  }, []);

  /** The after-folder performers; null when the list could not be loaded. */
  const fetchPerformers = useCallback(async () => {
    try {
      const res = await fetch('/api/performers');
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error((data && data.error) || res.statusText || `HTTP ${res.status}`);
      if (!Array.isArray(data)) throw new Error('The server sent no list');
      const activeOnly = data.filter(p => p.moved_to_after === 1);
      perfsRef.current = activeOnly;
      if (mounted.current) {
        setPerformers(activeOnly);
        setLoadError(null);
      }
      return activeOnly;
    } catch (err) {
      const msg = errorText(err, 'No answer from the server');
      if (mounted.current) {
        if (perfsRef.current.length === 0) setLoadError(msg);
        else notify('Could not load the performers: ' + msg, 'error');
      }
      return null;
    }
  }, [notify]);

  /** Random pics for one performer, as plain data (no state). null when they could not be loaded. */
  const fetchPics = useCallback(async (performerId) => {
    try {
      const res = await fetch(`/api/performers/${performerId}/random-pics?count=${picsRef.current}`);
      if (!res.ok) return [];
      const data = await res.json().catch(() => null);
      return (data && Array.isArray(data.pics)) ? data.pics : [];
    } catch (_) {
      return [];
    }
  }, []);

  const loadPicsFor = useCallback((list) => {
    list.forEach(p => {
      fetchPics(p.id).then(pics => {
        if (mounted.current) setRandomPics(prev => ({ ...prev, [p.id]: pics }));
      });
    });
  }, [fetchPics]);

  /** Choose the next set and warm its photos while the current one is shown. */
  const prefetchNext = useCallback(() => {
    const all = perfsRef.current;
    if (all.length < 2) { nextRef.current = null; return; }
    const currentIds = listRef.current.map(p => p.id).sort().join(',');
    let list = performSmartSelection(all, countRef.current);
    for (let t = 0; t < 3 && list.map(p => p.id).sort().join(',') === currentIds && all.length > list.length; t++) {
      list = performSmartSelection(all, countRef.current);
    }
    const slot = { list, pics: {}, promise: null, done: false };
    slot.promise = Promise.all(list.map(p => fetchPics(p.id).then(pics => {
      slot.pics[p.id] = pics;
      pics.forEach(pic => { const img = new Image(); img.src = previewUrl(pic.path); });
    }))).then(() => { slot.done = true; return slot; });
    nextRef.current = slot;
  }, [fetchPics]);

  /** Put a set on screen; the guards start counting from now. */
  const showList = useCallback((list, pics) => {
    listRef.current = list;
    setCompareList(list);
    setRandomPics(pics);
    shownAt.current = Date.now();
    setOrderChanged(false);
    setLookedLong(false);
    clearTimeout(lookTimer.current);
    lookTimer.current = setTimeout(() => { if (mounted.current) setLookedLong(true); }, LOOK_MS);
  }, []);

  const start = useCallback(async () => {
    setLoading(true);
    const all = await fetchPerformers();
    if (!mounted.current) return;
    if (all) {
      const list = all.length >= 2 ? performSmartSelection(all, countRef.current) : [];
      showList(list, {});
      loadPicsFor(list);
      prefetchNext();
    }
    setLoading(false);
  }, [fetchPerformers, showList, loadPicsFor, prefetchNext]);

  useEffect(() => {
    start();
    (async () => {
      try {
        const res = await fetch('/api/performers/calibration-model');
        if (!res.ok) return;
        const data = await res.json().catch(() => null);
        if (data && data.success && data.model && mounted.current) {
          setGlobalModel({ ...data.model, n_effective: data.model.n_effective ?? data.n_effective });
        }
      } catch (_) { /* "Default prior" is shown instead */ }
    })();
  }, [start]);

  /** Fold a /compare or /compare-batch answer into the local performer list. */
  const applyResults = (results) => {
    if (!Array.isArray(results)) return;
    const byId = new Map(results.map(r => [r.id, r]));
    const patch = (p) => {
      const r = byId.get(p.id);
      return r ? { ...p, performer_rating: r.newRating, manual_star: r.newRating, comparison_count: (p.comparison_count || 0) + 1 } : p;
    };
    perfsRef.current = perfsRef.current.map(patch);
    if (!mounted.current) return;
    setPerformers(perfsRef.current);
    setCompareList(list => list.map(patch));
    listRef.current = listRef.current.map(patch);
  };

  /** Queue a vote; its answer updates the ratings and the session count once the server confirms it. */
  const sendVote = (url, body, failText) => {
    // The queue sends a vote id with it: a resend after a lost answer is not counted twice.
    const entry = queue.push({ kind: 'vote', url, body });
    queue.whenSettled(entry).then(e => {
      if (e.status === 'saved') {
        applyResults(e.result && e.result.results);
        if (mounted.current) setSessionCount(n => n + 1);
      } else if (e.status === 'rejected' && mounted.current) {
        toast({ message: `${failText}: ${e.error}`, severity: 'error' });
      }
    });
    return entry;
  };

  const advance = (flashIndex) => {
    const slot = nextRef.current;
    if (slot) {
      activeSlot.current = slot;
      showList(slot.list, { ...slot.pics });
      if (!slot.done) {
        slot.promise.then(() => {
          if (mounted.current && activeSlot.current === slot) setRandomPics(prev => ({ ...prev, ...slot.pics }));
        });
      }
    } else {
      const list = performSmartSelection(perfsRef.current, countRef.current);
      showList(list, {});
      loadPicsFor(list);
    }
    if (flashIndex !== null && flashIndex !== undefined) {
      flashId.current += 1;
      setFlash({ id: flashId.current, index: flashIndex });
      clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setFlash(null), FLASH_MS);
    }
    prefetchNext();
  };

  /** Record what Undo restores, then move on. */
  const finishVote = ({ voted, entry }, flashIndex) => {
    setHistory(h => [...h, { list: compareList, pics: randomPics, voted, entry }]);
    advance(flashIndex);
  };

  const sinceShown = () => Date.now() - shownAt.current;
  const duel = compareList.length === 2;
  const multi = compareList.length > 2;
  const saveReady = multi && (orderChanged || lookedLong);

  const handlePick = (winner) => {
    if (!duel || sinceShown() < MIN_VIEW_MS) return;
    const loser = compareList.find(p => p.id !== winner.id);
    if (!loser) return;
    const entry = sendVote('/api/performers/compare', { winnerId: winner.id, loserId: loser.id, draw: false }, 'Not saved');
    finishVote({ voted: true, entry }, compareList.findIndex(p => p.id === winner.id));
  };

  const handleDraw = () => {
    if (!duel || sinceShown() < SET_GUARD_MS) return;
    const [a, b] = compareList;
    const entry = sendVote('/api/performers/compare', { winnerId: a.id, loserId: b.id, draw: true }, 'Not saved');
    finishVote({ voted: true, entry }, null);
  };

  const handleSkip = () => {
    if (compareList.length === 0 || sinceShown() < SET_GUARD_MS) return;
    finishVote({ voted: false, entry: null }, null);
  };

  const handleSaveOrder = () => {
    if (!saveReady || sinceShown() < SET_GUARD_MS) return;
    const orderedIds = compareList.map(p => p.id);
    const entry = sendVote('/api/performers/compare-batch', { orderedIds }, 'Not saved');
    finishVote({ voted: true, entry }, null);
  };

  const handleUndo = () => {
    const last = history[history.length - 1];
    if (!last) return;
    setHistory(h => h.slice(0, -1));

    // The set on screen becomes "next" again, so Skip brings it straight back.
    nextRef.current = { list: compareList, pics: randomPics, promise: Promise.resolve(), done: true };
    activeSlot.current = null;
    setFlash(null);
    showList(last.list, last.pics);

    const vote = last.entry;
    if (!last.voted || !vote) return;
    if (queue.cancel(vote)) return; // never sent: nothing to reverse
    // Sent (even without an answer yet): the queue sends it until it is answered, then the undo reverses it
    // with the token from that answer, read just before the undo goes out.
    const undo = queue.push({
      kind: 'undo',
      url: '/api/performers/compare/undo',
      body: () => (vote.status === 'saved' && vote.result && vote.result.undo ? { undo: vote.result.undo } : null),
      // leaving before the vote has an answer: the undo names it by its id, and the server keeps neither
      reverses: vote,
      cancelBody: (v) => ({ cancelVoteId: v.voteId })
    });
    queue.whenSettled(undo).then(e => {
      if (!mounted.current) return;
      if (e.status === 'saved') {
        setSessionCount(n => Math.max(0, n - 1));
        fetchPerformers();
      } else if (e.status === 'rejected') {
        toast({ message: 'Could not undo: ' + e.error, severity: 'warning' });
      }
    });
  };

  const handleMove = (index, direction) => {
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === compareList.length - 1) return;
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    const next = [...compareList];
    [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
    listRef.current = next;
    setCompareList(next);
    setOrderChanged(true);
  };

  const strength = ((globalModel && globalModel.n_effective) || 0).toFixed(1);

  const handleRecalibrate = useCallback(async () => {
    setRecalibrating(true);
    try {
      const data = await postJson('/api/performers/calibrate', {});
      if (!data.success || !data.model) throw new Error(data.error || 'No ratings to calibrate from');
      if (!mounted.current) return;
      setGlobalModel(data.model);
      toast({ message: `Model recalibrated · strength ${(data.model.n_effective || 0).toFixed(1)}`, severity: 'success' });
    } catch (err) {
      toast({ message: 'Could not recalibrate: ' + errorText(err), severity: 'error' });
    } finally {
      if (mounted.current) setRecalibrating(false);
    }
  }, [toast]);

  // A reset, or its Undo, changes every rating: the undo history is dropped and the list read again.
  const resetAll = useRatingReset({
    onChange: () => {
      if (!mounted.current) return;
      setHistory([]);
      fetchPerformers();
    }
  });
  const handleReset = useCallback(() => { resetAll(); }, [resetAll]);

  const changeCount = (v) => {
    setPerformerCount(v);
    countRef.current = v;
    writeStored('compare_performerCount', v);
    clearTimeout(sliderTimer.current);
    sliderTimer.current = setTimeout(() => {
      if (perfsRef.current.length < 2) return;
      const list = performSmartSelection(perfsRef.current, v);
      showList(list, {});
      loadPicsFor(list);
      prefetchNext();
    }, 250);
  };

  const changePics = (v) => {
    setPicsPerPerformer(v);
    picsRef.current = v;
    writeStored('compare_picsPerPerformer', v);
    clearTimeout(sliderTimer.current);
    sliderTimer.current = setTimeout(prefetchNext, 400);
  };

  const refreshPhotos = (performer) => {
    fetchPics(performer.id).then(pics => {
      if (mounted.current) setRandomPics(prev => ({ ...prev, [performer.id]: pics }));
    });
  };

  // One handler object per render, read through a ref, so the listener is
  // attached once and still sees current state.
  const keyActions = useRef({});
  keyActions.current = {
    left: () => duel && handlePick(compareList[0]),
    right: () => duel && handlePick(compareList[1]),
    draw: handleDraw,
    skip: handleSkip,
    undo: handleUndo,
    save: handleSaveOrder
  };

  useEffect(() => {
    const onKey = (e) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      if (isTyping(t)) return;
      const a = keyActions.current;
      if (overlayOpen()) return;
      const k = (e.key || '').toLowerCase();
      // The arrows move a focused slider; the letters still act.
      if ((k === 'arrowleft' || k === 'arrowright') && inSlider(t)) return;
      // Enter on a focused link, button or control activates that, not 'Save this order'.
      if (k === 'enter' && t && t.closest && t.closest('a[href], button, [role="button"], input, select, [role="slider"]')) return;
      let run = null;
      if (k === 'arrowleft' || k === 'a') run = a.left;
      else if (k === 'arrowright' || k === 'd') run = a.right;
      else if (k === 'x') run = a.draw;
      else if (k === 's') run = a.skip;
      else if (k === 'z') run = a.undo;
      else if (k === 'enter') run = a.save;
      if (!run) return;
      e.preventDefault();
      run();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const saveTitle = compareList.length < 3 ? 'Only for 3 or more'
    : !saveReady ? 'Reorder first, or look a moment longer' : 'Save this order';
  const actions = [
    { id: 'undo', label: 'Undo', short: 'Undo', kbd: 'Z', icon: <Undo fontSize="small" />, onClick: handleUndo,
      disabled: history.length === 0, title: history.length === 0 ? 'Nothing to undo' : 'Undo' },
    { id: 'draw', label: 'Draw', short: 'Draw', kbd: 'X', icon: <DragHandle fontSize="small" />, onClick: handleDraw,
      disabled: !duel, title: duel ? 'Draw' : 'Only for two performers' },
    { id: 'skip', label: 'Skip', short: 'Skip', kbd: 'S', icon: <SkipNext fontSize="small" />, onClick: handleSkip,
      disabled: compareList.length === 0, title: 'Skip' },
    { id: 'save', label: 'Save this order', short: 'Save', kbd: 'Enter', icon: <Check fontSize="small" />, onClick: handleSaveOrder,
      disabled: !saveReady, title: saveTitle }
  ];

  const roundBtn = (a) => (
    <Box component="button" type="button" key={a.id} onClick={a.onClick} disabled={a.disabled}
      title={a.title} aria-label={a.label} sx={actSx(true, false)}>
      {a.icon}
    </Box>
  );

  const midColumn = (items) => (
    <Box sx={{
      display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 1, px: '6px',
      bgcolor: 'var(--surface)', borderLeft: '1px solid var(--line)', borderRight: '1px solid var(--line)',
      flex: 'none', zIndex: 3, overflowY: 'auto'
    }}>
      {items}
    </Box>
  );

  const avatar = (performer, size) => (
    performer.thumbnail
      ? (
        <Box component="img" alt="" src={previewUrl(performer.thumbnail)}
          sx={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flex: 'none', bgcolor: 'var(--raised)' }} />
      ) : (
        <Box aria-hidden sx={{
          width: size, height: size, borderRadius: '50%', flex: 'none', bgcolor: 'var(--raised)',
          display: 'grid', placeItems: 'center', color: 'var(--dim)', fontSize: '13px', fontWeight: 600
        }}>
          {(performer.name || '?').charAt(0).toUpperCase()}
        </Box>
      )
  );

  const refreshBtn = (performer, size) => (
    <IconButton onClick={(e) => { e.stopPropagation(); refreshPhotos(performer); }}
      title="New pictures" aria-label={`New pictures of ${performer.name}`} sx={btnSx(size)}>
      <Refresh />
    </IconButton>
  );

  const duelColumn = (performer, index) => {
    const pics = randomPics[performer.id];
    const win = flash && flash.index === index;
    return (
      <Box key={performer.id} onClick={() => handlePick(performer)} sx={{
        flex: '1 1 0', minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column',
        cursor: 'pointer', position: 'relative',
        '&:hover': { bgcolor: 'var(--surface)' },
        '&:hover .pickhint': { opacity: 1 },
        '@keyframes duelFlash': { from: { opacity: 1 }, to: { opacity: 0 } }
      }}>
        <Box sx={{
          display: 'flex', alignItems: 'center', gap: isLandscape ? 0.75 : 1.25, flexWrap: 'wrap',
          px: isLandscape ? 1 : 1.5, py: isLandscape ? '3px' : 1, borderBottom: '1px solid var(--line)'
        }}>
          {avatar(performer, isLandscape ? 28 : 44)}
          <Box sx={{ flex: '1 1 0', minWidth: 0 }}>
            <Typography noWrap sx={{ fontWeight: 700, fontSize: isLandscape ? '13px' : '15px' }}>{performer.name}</Typography>
            <Stars value={performer.performer_rating} compact={isLandscape} />
          </Box>
          <DuelBadge count={performer.comparison_count} />
          {refreshBtn(performer, isLandscape ? 30 : 32)}
        </Box>

        <Box sx={{
          flex: '1 1 0', minHeight: 0, overflowY: 'auto', p: isLandscape ? 0.5 : 1,
          // room under the last row for the pick strip
          pb: isLandscape ? 4 : 5,
          display: 'grid', gap: isLandscape ? 0.5 : 0.75, alignContent: 'start',
          gridTemplateColumns: `repeat(auto-fill, minmax(${compact ? 84 : 130}px, 1fr))`
        }}>
          {!pics && Array.from({ length: Math.min(picsPerPerformer, 12) }, (_, i) => <Placeholder key={i} />)}
          {pics && pics.length === 0 && <NoPics sx={{ gridColumn: '1 / -1', py: 2, textAlign: 'center' }} />}
          {pics && pics.map((pic, i) => (
            <Box component="img" key={i} loading="lazy" alt="" src={previewUrl(pic.path)}
              sx={{ width: '100%', aspectRatio: '3/4', objectFit: 'cover', borderRadius: 'var(--radius-sm)', display: 'block', bgcolor: 'var(--raised)' }} />
          ))}
        </Box>

        <Box className="pickhint" aria-hidden sx={{
          position: 'absolute', left: 0, right: 0, bottom: 0, py: isLandscape ? '4px' : '7px', textAlign: 'center',
          fontSize: '13px', fontWeight: 700, color: 'var(--ok)', bgcolor: 'var(--ok-quiet)',
          borderTop: '1px solid var(--line)',
          pointerEvents: 'none', opacity: isTouch ? 1 : 0, transition: 'opacity .12s'
        }}>
          {isTouch ? 'Tap to pick' : (index === 0 ? '← Pick' : 'Pick →')}
        </Box>

        {win && (
          <Box key={flash.id} sx={{
            position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 2,
            animation: `duelFlash ${FLASH_MS - 20}ms ease-out forwards`,
            boxShadow: 'inset 0 0 0 3px var(--ok)'
          }} />
        )}
      </Box>
    );
  };

  const stripW = isLandscape ? 50 : 74;
  const stripH = Math.round(stripW * 4 / 3);

  const multiRow = (performer, index) => {
    const pics = randomPics[performer.id];
    return (
      <motion.div key={performer.id} layout transition={{ duration: 0.2 }}>
        <Box sx={{
          display: 'grid', gap: isLandscape ? 1 : 1.25, alignItems: 'center',
          gridTemplateColumns: isPortraitPhone ? '40px minmax(0, 1fr)'
            : isLandscape ? '40px 150px minmax(0, 1fr)' : '54px 210px minmax(0, 1fr)',
          bgcolor: 'var(--surface)', border: '1px solid var(--line)',
          borderRadius: 'var(--radius-lg)', p: isLandscape ? 0.5 : 1
        }}>
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px', gridRow: isPortraitPhone ? 'span 2' : undefined }}>
            <IconButton aria-label="Move up" disabled={index === 0}
              onClick={() => handleMove(index, 'up')} sx={btnSx(28)}>
              <ArrowUpward />
            </IconButton>
            <Typography sx={{ fontSize: '16px', fontWeight: 700, fontVariantNumeric: 'tabular-nums', lineHeight: 1.2 }}>#{index + 1}</Typography>
            <IconButton aria-label="Move down" disabled={index === compareList.length - 1}
              onClick={() => handleMove(index, 'down')} sx={btnSx(28)}>
              <ArrowDownward />
            </IconButton>
          </Box>

          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', minWidth: 0 }}>
            {avatar(performer, isLandscape ? 28 : 44)}
            <Box sx={{ minWidth: 0, flex: '1 1 auto' }}>
              <Typography noWrap sx={{ fontWeight: 700, fontSize: isLandscape ? '13px' : '15px' }}>{performer.name}</Typography>
              <Stars value={performer.performer_rating} compact={isLandscape} />
              <Box sx={{ mt: '3px', display: 'flex', gap: 0.5, alignItems: 'center', flexWrap: 'nowrap' }}>
                <DuelBadge count={performer.comparison_count} />
                {refreshBtn(performer, 24)}
              </Box>
            </Box>
          </Box>

          <Box sx={{ display: 'flex', gap: '5px', overflowX: 'auto', height: stripH, minWidth: 0 }}>
            {!pics && Array.from({ length: Math.min(picsPerPerformer, 8) }, (_, i) => (
              <Placeholder key={i} sx={{ width: stripW, flex: 'none' }} />
            ))}
            {pics && pics.length === 0 && <NoPics />}
            {pics && pics.map((pic, i) => (
              <Box component="img" key={i} loading="lazy" alt="" src={previewUrl(pic.path)}
                sx={{ width: stripW, height: stripH, flex: 'none', objectFit: 'cover', borderRadius: 'var(--radius-sm)', display: 'block', bgcolor: 'var(--raised)' }} />
            ))}
          </Box>
        </Box>
      </motion.div>
    );
  };

  let body;
  if (loading) {
    body = <Box sx={{ m: 'auto' }}><LoadingState label="Loading performers…" /></Box>;
  } else if (loadError) {
    body = (
      <Box sx={{ m: 'auto', p: 2, width: '100%', maxWidth: 520 }}>
        <EmptyState title="Could not load performers" description={loadError}
          action={<Button variant="outlined" onClick={start}>Retry</Button>} />
      </Box>
    );
  } else if (compareList.length < 2) {
    body = (
      <Box sx={{ m: 'auto', p: 2, width: '100%', maxWidth: 520 }}>
        <EmptyState
          title={performers.length < 2 ? 'Fewer than two performers in the after folder' : 'Nothing to compare'}
          description={performers.length < 2 ? 'Performers show up here once Filter has moved them to the after folder.' : undefined}
          action={performers.length < 2 ? <Button variant="outlined" component={RouterLink} to="/filter">Open Filter</Button> : undefined}
        />
      </Box>
    );
  } else if (duel) {
    body = (
      <>
        {duelColumn(compareList[0], 0)}
        {isLandscape ? midColumn(
          <>
            {actions.slice(0, 2).map(roundBtn)}
            <Typography sx={{ textAlign: 'center', fontSize: '12px', fontWeight: 700, color: 'var(--muted)' }}>VS</Typography>
            {actions.slice(2).map(roundBtn)}
          </>
        ) : (
          <Box sx={{
            width: isPortraitPhone ? '100%' : '3px', height: isPortraitPhone ? '3px' : 'auto',
            flex: 'none', zIndex: 2, bgcolor: 'var(--line-strong)', position: 'relative'
          }}>
            <Box sx={{
              position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
              width: 38, height: 38, borderRadius: '50%', display: 'grid', placeItems: 'center',
              bgcolor: 'var(--bg)', border: '1px solid var(--accent)', color: 'var(--accent)',
              fontSize: '12px', fontWeight: 700
            }}>
              VS
            </Box>
          </Box>
        )}
        {duelColumn(compareList[1], 1)}
      </>
    );
  } else {
    body = (
      <>
        <Box sx={{ flex: '1 1 0', minWidth: 0, overflowY: 'auto', p: isLandscape ? 0.75 : 1.25, display: 'flex', flexDirection: 'column', gap: 1 }}>
          <AnimatePresence initial={false}>
            {compareList.map(multiRow)}
          </AnimatePresence>
        </Box>
        {isLandscape && midColumn(actions.map(roundBtn))}
      </>
    );
  }

  const bare = chrome === 'bare';
  const saveFailed = counts.failed > 0;
  const slider = (label, min, max, value, onChange) => (
    <>
      <Slider size="small" min={min} max={max} step={1} value={value}
        aria-label={label}
        onChange={(_, v) => onChange(Array.isArray(v) ? v[0] : v)}
        onChangeCommitted={blurActive}
        sx={{ ...sliderSx, width: 120 }} />
      <Box component="span" sx={valueSx}>{value}</Box>
    </>
  );

  return (
    <SidebarPage
      title="Smart Compare"
      views={RATE_VIEWS}
      view="compare"
      fill
      onBack={leave}
      phoneTabs={!bare}
      phoneRow={false}
      sx={{
        bgcolor: 'var(--bg)', color: 'var(--text)', fontSize: 14,
        // the compare area keeps the whole width and height: no content padding on this page
        p: 0,
        '& > [data-sidebar-content]': { p: 0 },
        // phone: the tab row runs edge to edge, so it needs none of the padding it would undo
        '& > nav': { m: 0 }
      }}
    >
      <SideGroup id="show" title="Show" icon={<TuneOutlined />} order={SIDE.show}
        summary={`${performerCount} performers · ${picsPerPerformer} photos`}>
        <SideField label="Performers">{slider('Performers', 2, 10, performerCount, changeCount)}</SideField>
        <SideField label="Photos">{slider('Photos per performer', 1, MAX_PICS, picsPerPerformer, changePics)}</SideField>
      </SideGroup>

      <SideGroup id="session" title="Session" icon={<InsightsOutlined />} dot={saveFailed ? 'bad' : null}
        summary={`${sessionCount} this session · ${saveWords(counts)}`}>
        <SideFacts rows={[
          { label: 'This session', value: sessionCount.toLocaleString(), tone: 'accent' },
          { label: 'Model', value: globalModel ? 'active' : 'default prior' },
          {
            label: 'Saving', value: saveWords(counts), tone: saveFailed ? 'bad' : undefined,
            title: saveFailed ? 'They are tried again on their own. Retry sends them now.' : undefined
          }
        ]} />
        <SideButtons>
          {saveFailed ? <SideButton onClick={() => queue.retry()}>Retry</SideButton> : null}
          <SideButton onClick={handleRecalibrate} disabled={recalibrating}>
            {recalibrating ? 'Recalibrating…' : 'Recalibrate model'}
          </SideButton>
        </SideButtons>
        <SideNote>{`Fits the AI score to your ratings · strength ${strength}`}</SideNote>
        <SideButtons>
          <SideButton danger plain onClick={handleReset}>Reset all ratings…</SideButton>
        </SideButtons>
      </SideGroup>

      <CompareLine
        meta={compareList.length >= 2 ? `${compareList.length} performers · ${picsPerPerformer} photos each` : null}
        bare={bare}
        onBack={leave}
        leaving={leaving}
      />

      {/* body */}
      <Box sx={{
        flex: '1 1 0', minHeight: 0, display: 'flex', position: 'relative', touchAction: 'manipulation',
        flexDirection: isPortraitPhone && duel ? 'column' : 'row'
      }}>
        {body}
      </Box>

      {/* the bar that never moves; phone landscape uses the middle column instead */}
      {!isLandscape && (
        <Box sx={{
          display: 'grid', gridAutoFlow: 'column', gridAutoColumns: '1fr', flex: 'none',
          gap: isPortraitPhone ? 0.5 : 1, px: isPortraitPhone ? '6px' : '10px', pt: isPortraitPhone ? '6px' : 1,
          pb: `calc(${isPortraitPhone ? '6px' : '8px'} + env(safe-area-inset-bottom, 0px))`,
          bgcolor: 'var(--surface)', borderTop: '1px solid var(--line)'
        }}>
          {actions.map((a) => (
            <Box component="button" type="button" key={a.id} onClick={a.onClick} disabled={a.disabled}
              title={a.title} aria-label={a.label} sx={actSx(false, isPortraitPhone)}>
              {a.icon}
              {isPortraitPhone
                ? <Box component="span" sx={{ fontSize: '12px', fontWeight: 600, lineHeight: 1.2 }}>{a.short}</Box>
                : (
                  <>
                    <Box component="span" sx={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.label}</Box>
                    <Box component="kbd" sx={kbdSx}>{a.kbd}</Box>
                  </>
                )}
            </Box>
          ))}
        </Box>
      )}
    </SidebarPage>
  );
}

export default SmartComparePage;
