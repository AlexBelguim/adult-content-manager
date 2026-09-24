import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Box, Typography, Button, Rating, CircularProgress,
  Dialog, DialogTitle, DialogContent, DialogActions,
  Snackbar, Alert, useMediaQuery
} from '@mui/material';
import {
  ArrowBack, ArrowUpward, ArrowDownward, Settings, Psychology, AutoFixNormal,
  Refresh, Undo, SkipNext, DragHandle, Check
} from '@mui/icons-material';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { LoadingState } from '../components/layout';

const CALIBRATION_THRESHOLD = 5; // duels a performer needs before proximity pairing
const ALL_PICS = 51;              // slider max; shown as "All"
const FLASH_MS = 240;
// The swap is instant, so the second tap of an accidental double tap would
// land on a set nobody has looked at yet. Votes this soon are ignored.
const MIN_VIEW_MS = 180;

const previewUrl = (p) => `/api/files/preview?path=${encodeURIComponent(p)}`;

const postJson = async (url, body) => {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `${res.status}`);
  return data;
};

/**
 * Pick `count` performers to compare. Calibrating performers (fewer than
 * CALIBRATION_THRESHOLD duels) are paired against one opponent per rating tier
 * for rapid placement; once everyone is established, a contiguous window of
 * the rating-sorted list is taken so neighbours get compared.
 */
function performSmartSelection(allPerformers, count) {
  const calibrating = allPerformers.filter(p => (p.comparison_count || 0) < CALIBRATION_THRESHOLD);
  const established = allPerformers.filter(p => (p.comparison_count || 0) >= CALIBRATION_THRESHOLD);

  const sortedAll = [...allPerformers].sort((a, b) => (b.performer_rating || 0) - (a.performer_rating || 0));
  const sortedEstablished = [...established].sort((a, b) => (b.performer_rating || 0) - (a.performer_rating || 0));

  if (calibrating.length > 0) {
    const picked = calibrating[Math.floor(Math.random() * calibrating.length)];
    if (sortedAll.length < count) {
      return [...sortedAll].sort(() => 0.5 - Math.random());
    }

    const tiersNeeded = count - 1;
    const tierSize = Math.max(1, Math.floor(sortedAll.length / (tiersNeeded + 1)));
    const opponents = [];
    for (let t = 0; t < tiersNeeded; t++) {
      const tierMembers = sortedAll.slice(t * tierSize, Math.min((t + 1) * tierSize, sortedAll.length))
        .filter(p => p.id !== picked.id);
      if (tierMembers.length > 0) {
        opponents.push(tierMembers[Math.floor(Math.random() * tierMembers.length)]);
      }
    }
    while (opponents.length < tiersNeeded) {
      const remaining = sortedAll.filter(p => p.id !== picked.id && !opponents.find(o => o.id === p.id));
      if (remaining.length === 0) break;
      opponents.push(remaining[Math.floor(Math.random() * remaining.length)]);
    }
    return [picked, ...opponents].sort(() => 0.5 - Math.random());
  }

  if (sortedEstablished.length <= count) {
    return [...sortedEstablished].sort(() => 0.5 - Math.random());
  }
  const maxAnchor = sortedEstablished.length - count;
  const anchorIndex = Math.floor(Math.random() * (maxAnchor + 1));
  return sortedEstablished.slice(anchorIndex, anchorIndex + count).sort(() => 0.5 - Math.random());
}

const chipSx = {
  fontSize: '.74rem', border: '1px solid var(--line-strong)', borderRadius: '99px',
  px: '10px', py: '1px', color: 'var(--dim)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', lineHeight: 1.5
};
const accentChipSx = { ...chipSx, borderColor: 'var(--accent)', color: 'var(--accent)' };
const warnChipSx = { ...chipSx, borderColor: 'var(--warn)', color: 'var(--warn)' };
const aiChipSx = { ...chipSx, borderColor: 'var(--info)', color: 'var(--info)' };

const kbdSx = {
  font: '600 .72rem ui-monospace, monospace', border: '1px solid currentColor',
  borderRadius: '4px', px: '5px', opacity: 0.6
};

const iconBtnSx = (size) => ({
  width: size, height: size, display: 'inline-grid', placeItems: 'center', background: 'none', border: 0,
  borderRadius: '6px', cursor: 'pointer', flex: 'none', color: 'var(--dim)', p: 0,
  '&:hover:not(:disabled)': { bgcolor: 'var(--raised)', color: 'var(--text)' },
  '&:disabled': { opacity: 0.25, cursor: 'default' }
});

/** Shared look of an action; `round` is the phone-landscape middle column. */
const actSx = (tone, round) => ({
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1,
  font: 'inherit', fontWeight: 600, fontSize: '.88rem', whiteSpace: 'nowrap', cursor: 'pointer',
  color: tone === 'ai' ? 'var(--info)' : 'var(--text)',
  bgcolor: 'var(--raised)',
  border: '1px solid', borderColor: tone === 'ai' ? 'var(--info)' : 'var(--line-strong)',
  ...(round
    ? { width: 46, height: 46, borderRadius: '50%', p: 0, flex: 'none' }
    : { height: 46, borderRadius: '8px', minWidth: 0, px: 1 }),
  '&:hover:not(:disabled)': { filter: 'brightness(1.25)' },
  '&:disabled': { opacity: 0.3, cursor: 'default', filter: 'none' }
});

const starsSx = { color: 'var(--warn)', '& .MuiRating-iconEmpty': { color: 'var(--faint)' } };

const Stars = ({ value, compact }) => (
  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
    <Rating value={value || 0} precision={0.1} readOnly size="small" sx={{ ...starsSx, fontSize: compact ? '.8rem' : undefined }} />
    <Typography component="span" sx={{ color: 'var(--muted)', fontSize: '.8rem', fontVariantNumeric: 'tabular-nums' }}>
      {(value || 0).toFixed(2)}
    </Typography>
  </Box>
);

const DuelBadge = ({ count }) => (
  (count || 0) < CALIBRATION_THRESHOLD
    ? <Box component="span" sx={warnChipSx}>calibrating {count || 0}/{CALIBRATION_THRESHOLD}</Box>
    : <Box component="span" sx={chipSx}>{count} duels</Box>
);

const Placeholder = () => (
  <Box sx={{ aspectRatio: '3/4', borderRadius: '5px', bgcolor: 'var(--raised)', display: 'grid', placeItems: 'center' }}>
    <CircularProgress size={18} sx={{ color: 'var(--muted)', opacity: 0.5 }} />
  </Box>
);

/**
 * Smart Compare: two performers side by side with their photo grids, or 3–10
 * in a ranked list. The next set (selection + photos) is prefetched while the
 * current one is on screen, so advancing is instant; votes go out through a
 * serial background queue, which is what lets Undo reverse them in order.
 */
function SmartComparePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const isLandscape = useMediaQuery('(max-height:500px) and (orientation:landscape)');
  const isNarrow = useMediaQuery('(max-width:600px)');
  const isPortraitPhone = isNarrow && !isLandscape;
  const compact = isLandscape || isPortraitPhone;

  const [performers, setPerformers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [randomPics, setRandomPics] = useState({});
  const [compareList, setCompareList] = useState(location.state?.selection || []);
  const [inferenceUrl] = useState(localStorage.getItem('pairwiseInferenceUrl') || 'http://localhost:3344');
  const [aiAnalysis, setAiAnalysis] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzingStatus, setAnalyzingStatus] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [globalModel, setGlobalModel] = useState(null);
  const [calibratedStars, setCalibratedStars] = useState({});
  const [performerCount, setPerformerCount] = useState(parseInt(localStorage.getItem('compare_performerCount')) || 2);
  const [picsPerPerformer, setPicsPerPerformer] = useState(parseInt(localStorage.getItem('compare_picsPerPerformer')) || 10);
  const [autoNext, setAutoNext] = useState(true);
  const [isOrderDirty, setIsOrderDirty] = useState(false);
  const [sessionCount, setSessionCount] = useState(0);
  const [history, setHistory] = useState([]); // [{ list, pics, ai, cal, voted, tokens }]
  const [flash, setFlash] = useState(null);   // { id, index }
  const [toast, setToast] = useState(null);   // { msg, severity }
  const [topOffset, setTopOffset] = useState(64);

  // Values the async paths (prefetch, vote queue) read without going stale.
  const perfsRef = useRef([]);
  const countRef = useRef(performerCount);
  const picsRef = useRef(picsPerPerformer);
  const urlRef = useRef(inferenceUrl);
  const listRef = useRef(compareList);
  const nextRef = useRef(null);      // prefetched { list, pics, promise, done }
  const activeSlot = useRef(null);
  const queueRef = useRef(Promise.resolve());
  const shownAt = useRef(0);
  const flashTimer = useRef(null);
  const flashId = useRef(0);
  const sliderTimer = useRef(null);
  listRef.current = compareList;

  const notify = useCallback((msg, severity = 'info') => setToast({ msg, severity }), []);

  // The app toolbar is a sticky AppBar above this route; the page owns
  // everything under it so the action bar can sit at the real bottom.
  useEffect(() => {
    const el = document.querySelector('header.MuiAppBar-root');
    if (!el) { setTopOffset(0); return undefined; }
    const measure = () => setTopOffset(el.offsetHeight);
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    if (ro) ro.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      if (ro) ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  useEffect(() => () => {
    clearTimeout(flashTimer.current);
    clearTimeout(sliderTimer.current);
  }, []);

  const fetchPerformers = useCallback(async () => {
    try {
      const res = await fetch('/api/performers');
      const data = await res.json();
      // ONLY take performers who have been moved to the after folder
      const activeOnly = data.filter(p => p.moved_to_after === 1);
      perfsRef.current = activeOnly;
      setPerformers(activeOnly);
      return activeOnly;
    } catch (err) {
      notify('Failed to fetch performers: ' + err.message, 'error');
      return perfsRef.current;
    }
  }, [notify]);

  /** Random pics for one performer, as plain data (no state). */
  const fetchPics = useCallback(async (performerId) => {
    try {
      const res = await fetch(`/api/performers/${performerId}/random-pics?count=${picsRef.current}`);
      const data = await res.json();
      return data.pics || [];
    } catch (_) {
      return [];
    }
  }, []);

  const loadPicsFor = useCallback((list) => {
    list.forEach(p => {
      fetchPics(p.id).then(pics => setRandomPics(prev => ({ ...prev, [p.id]: pics })));
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

  useEffect(() => {
    const aiUrl = urlRef.current;
    const init = async () => {
      const all = await fetchPerformers();
      let list = listRef.current;
      if (list.length === 0) {
        list = performSmartSelection(all, countRef.current);
        setCompareList(list);
        listRef.current = list;
      }
      loadPicsFor(list);
      shownAt.current = Date.now();
      prefetchNext();
      setLoading(false);

      // Auto-load Pairwise model for ratings
      try {
        await postJson('/api/filter/load-model', { modelId: 'pairwise_rating.pt', ai_server_url: aiUrl });
      } catch (_) { /* the AI server may be offline; Ask AI reports it */ }

      // Fetch global model (calibration)
      try {
        const res = await fetch('/api/performers/calibration-model');
        const data = await res.json();
        if (data.success) setGlobalModel(data.model);
      } catch (_) { /* "Default prior" is shown instead */ }
    };
    init();

    // UNLOAD on leave to free VRAM
    return () => {
      postJson('/api/filter/unload-model', { ai_server_url: aiUrl }).catch(() => {});
    };
  }, [fetchPerformers, loadPicsFor, prefetchNext]);

  useEffect(() => {
    localStorage.setItem('compare_performerCount', performerCount);
    localStorage.setItem('compare_picsPerPerformer', picsPerPerformer);
  }, [performerCount, picsPerPerformer]);

  /** Serial vote queue; returns the job's own promise. */
  const enqueue = (job) => {
    const p = queueRef.current.then(job);
    queueRef.current = p.catch(() => {});
    return p;
  };

  /** Fold a /compare or /compare-batch response into the local performer list. */
  const applyResults = (results) => {
    if (!Array.isArray(results)) return;
    const byId = new Map(results.map(r => [r.id, r]));
    const patch = (p) => {
      const r = byId.get(p.id);
      return r ? { ...p, performer_rating: r.newRating, manual_star: r.newRating, comparison_count: (p.comparison_count || 0) + 1 } : p;
    };
    perfsRef.current = perfsRef.current.map(patch);
    setPerformers(perfsRef.current);
  };

  const resetAi = () => {
    setAiAnalysis(null);
    setCalibratedStars({});
    setIsOrderDirty(false);
  };

  const showList = (list, pics) => {
    listRef.current = list;
    setCompareList(list);
    setRandomPics(pics);
    shownAt.current = Date.now();
  };

  const advance = (flashIndex) => {
    resetAi();
    const slot = nextRef.current;
    if (slot) {
      activeSlot.current = slot;
      showList(slot.list, { ...slot.pics });
      if (!slot.done) {
        slot.promise.then(() => {
          if (activeSlot.current === slot) setRandomPics(prev => ({ ...prev, ...slot.pics }));
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

  /** Record what Undo restores, then move on (or leave, if auto-advance is off). */
  const finishVote = ({ voted, tokens }, flashIndex) => {
    setHistory(h => [...h, { list: compareList, pics: randomPics, ai: aiAnalysis, cal: calibratedStars, voted, tokens }]);
    if (voted) setSessionCount(n => n + 1);
    if (!autoNext) {
      Promise.resolve(tokens).catch(() => null).then(() => navigate('/group-rate'));
      return;
    }
    advance(flashIndex);
  };

  const handlePick = (winner) => {
    if (Date.now() - shownAt.current < MIN_VIEW_MS) return;
    const list = compareList;
    const losers = list.filter(p => p.id !== winner.id);
    if (losers.length === 0) return;
    const tokens = enqueue(async () => {
      const out = [];
      for (const loser of losers) {
        const r = await postJson('/api/performers/compare', { winnerId: winner.id, loserId: loser.id, draw: false });
        applyResults(r.results);
        if (r.undo) out.push(r.undo);
      }
      fetchPerformers();
      return out;
    });
    tokens.catch(err => notify('Vote failed: ' + err.message, 'error'));
    finishVote({ voted: true, tokens }, list.length === 2 ? list.findIndex(p => p.id === winner.id) : null);
  };

  const handleDraw = () => {
    if (compareList.length !== 2 || Date.now() - shownAt.current < MIN_VIEW_MS) return;
    const [a, b] = compareList;
    const tokens = enqueue(async () => {
      const r = await postJson('/api/performers/compare', { winnerId: a.id, loserId: b.id, draw: true });
      applyResults(r.results);
      fetchPerformers();
      return r.undo ? [r.undo] : [];
    });
    tokens.catch(err => notify('Draw failed: ' + err.message, 'error'));
    finishVote({ voted: true, tokens }, null);
  };

  const handleSkip = () => {
    if (compareList.length === 0) return;
    finishVote({ voted: false, tokens: null }, null);
  };

  const handleSaveRankings = () => {
    if (compareList.length < 3) return;
    const orderedIds = compareList.map(p => p.id);
    const tokens = enqueue(async () => {
      const r = await postJson('/api/performers/compare-batch', { orderedIds });
      applyResults(r.results);
      fetchPerformers();
      return r.undo ? [r.undo] : [];
    });
    tokens.catch(err => notify('Save rankings failed: ' + err.message, 'error'));
    finishVote({ voted: true, tokens }, null);
  };

  const handleUndo = () => {
    const entry = history[history.length - 1];
    if (!entry) return;
    setHistory(h => h.slice(0, -1));
    if (entry.voted) setSessionCount(n => Math.max(0, n - 1));

    // The set on screen becomes "next" again, so Skip brings it straight back.
    nextRef.current = { list: compareList, pics: randomPics, promise: Promise.resolve(), done: true };
    activeSlot.current = null;
    setFlash(null);
    showList(entry.list, entry.pics);
    setAiAnalysis(entry.ai);
    setCalibratedStars(entry.cal);
    setIsOrderDirty(false);

    if (!entry.tokens) return;
    enqueue(async () => {
      let tokens = [];
      try { tokens = await entry.tokens; } catch (_) { return; }
      for (const token of [...tokens].reverse()) {
        try {
          await postJson('/api/performers/compare/undo', { undo: token });
        } catch (err) {
          notify('Could not undo: ' + err.message, 'warning');
          break;
        }
      }
      fetchPerformers();
    });
  };

  const handleInModalMove = (index, direction) => {
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === compareList.length - 1) return;
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    const next = [...compareList];
    [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
    listRef.current = next;
    setCompareList(next);
    setIsOrderDirty(true);
  };

  const updateCalibratedStars = useCallback(async (currentCompareList, currentAiScores) => {
    if (!currentAiScores || Object.keys(currentAiScores).length === 0) return;
    try {
      const manualRatings = {};
      currentCompareList.forEach(p => {
        if (p.manual_star > 0 && !p.is_flagged) manualRatings[p.id] = p.manual_star;
      });
      const data = await postJson('/api/performers/predict-batch', {
        performers: currentCompareList.map(p => ({
          id: p.id, raw_ai_score: p.raw_ai_score, performer_rating: p.performer_rating
        })),
        manual_ratings: manualRatings,
        ranks: currentCompareList.map(p => p.id),
        ai_server_url: urlRef.current
      });
      // Only the displayed prediction stars change — the user's ordering is
      // preserved until they press "Save rankings".
      if (data.success && data.predictions) setCalibratedStars(data.predictions);
    } catch (err) {
      notify('Batch prediction failed: ' + err.message, 'error');
    }
  }, [notify]);

  const handleApplyOrder = () => {
    if (aiAnalysis?.scores) {
      updateCalibratedStars(compareList, aiAnalysis.scores);
      setIsOrderDirty(false);
    }
  };

  const handleRecalibrate = async () => {
    setAnalyzing(true);
    setAnalyzingStatus('Recalibrating…');
    try {
      const data = await postJson('/api/performers/calibrate', {});
      if (data.success) {
        setGlobalModel(data.model);
        notify('Model recalibrated', 'success');
      } else {
        notify('Calibration failed: ' + (data.error || 'No ratings found'), 'error');
      }
    } catch (err) {
      notify('Calibration failed: ' + err.message, 'error');
    } finally {
      setAnalyzing(false);
    }
  };

  const handleResetRankings = async () => {
    if (!window.confirm('Reset ALL performer ratings to 2.5? This cannot be undone.')) return;
    if (!window.confirm('Are you really sure? All comparison history will be lost.')) return;
    try {
      const data = await postJson('/api/performers/reset-rankings', {});
      if (data.success) {
        notify(`Reset ${data.count} performers to rating 2.5`, 'success');
        setHistory([]);
        fetchPerformers();
      } else {
        notify('Reset failed: ' + (data.error || 'Unknown error'), 'error');
      }
    } catch (err) {
      notify('Reset failed: ' + err.message, 'error');
    }
  };

  /** Star resolution: this session's Ranker result, else calibrated, else score/20. */
  const scoreToStars = (score, perfId) => {
    if (aiAnalysis?.rawRankResults && aiAnalysis.rawRankResults[perfId] !== undefined) {
      return aiAnalysis.rawRankResults[perfId].toFixed(2);
    }
    const val = calibratedStars[perfId] ?? (score / 20) ?? 0;
    return (isNaN(val) ? 0 : val).toFixed(2);
  };

  const handleAiAnalyze = async () => {
    if (compareList.length < 2 || analyzing) return;
    const list = compareList;
    setAnalyzing(true);
    setAiAnalysis(null);
    setAnalyzingStatus(`Analyzing ${list.length}…`);
    try {
      const data = await postJson('/api/training/predict-ranks-batch', {
        performerIds: list.map(p => p.id),
        ai_server_url: urlRef.current,
        limit: picsRef.current
      });
      if (!data.success) throw new Error(data.error || 'Prediction failed');
      if (listRef.current !== list) return; // the set changed while the AI was thinking

      const results = data.results; // performerId -> predicted rank (0-5)
      const scoresMap = {};
      let bestScore = -1;
      let winnerId = null;
      list.forEach(performer => {
        const rank = results[performer.id];
        if (rank !== undefined) {
          const score = (rank / 5) * 100;
          scoresMap[performer.id] = score;
          if (score > bestScore) { bestScore = score; winnerId = performer.id; }
        }
      });
      setAiAnalysis({ winnerId, scores: scoresMap, rawRankResults: results });

      // Order the list by the AI's stars, highest first
      const sorted = [...list].sort((a, b) => (results[b.id] ?? -1) - (results[a.id] ?? -1));
      listRef.current = sorted;
      setCompareList(sorted);
      setIsOrderDirty(false);

      // Save scores to DB for calibration
      for (const [id, score] of Object.entries(scoresMap)) {
        postJson(`/api/performers/${id}/ai-score`, { score }).catch(() => {});
      }
      updateCalibratedStars(list, scoresMap);
    } catch (err) {
      notify('AI analysis failed: ' + err.message, 'error');
    } finally {
      setAnalyzing(false);
    }
  };

  const changeCount = (v) => {
    setPerformerCount(v);
    countRef.current = v;
    clearTimeout(sliderTimer.current);
    sliderTimer.current = setTimeout(() => {
      if (perfsRef.current.length < 2) return;
      resetAi();
      const list = performSmartSelection(perfsRef.current, v);
      showList(list, {});
      loadPicsFor(list);
      prefetchNext();
    }, 250);
  };

  const changePics = (v) => {
    setPicsPerPerformer(v);
    picsRef.current = v;
    clearTimeout(sliderTimer.current);
    sliderTimer.current = setTimeout(prefetchNext, 400);
  };

  const refreshPhotos = (performer) => {
    fetchPics(performer.id).then(pics => setRandomPics(prev => ({ ...prev, [performer.id]: pics })));
  };

  const duel = compareList.length === 2;
  const multi = compareList.length > 2;

  // One handler object per render, read through a ref, so the listener is
  // attached once and still sees current state.
  const keyActions = useRef({});
  keyActions.current = {
    left: () => duel && handlePick(compareList[0]),
    right: () => duel && handlePick(compareList[1]),
    draw: handleDraw,
    skip: handleSkip,
    undo: handleUndo,
    ask: handleAiAnalyze,
    save: handleSaveRankings,
    escape: () => setShowSettings(false),
    blocked: showSettings
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
      else if (k === 'x') run = a.draw;
      else if (k === 's') run = a.skip;
      else if (k === 'z') run = a.undo;
      else if (k === 'i') run = a.ask;
      else if (k === 'enter') run = a.save;
      if (!run) return;
      e.preventDefault();
      run();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const actions = [
    { id: 'undo', label: 'Undo', kbd: 'Z', icon: <Undo fontSize="small" />, onClick: handleUndo, disabled: history.length === 0 },
    { id: 'draw', label: 'Draw', kbd: 'X', icon: <DragHandle fontSize="small" />, onClick: handleDraw, disabled: !duel },
    { id: 'skip', label: 'Skip / Next', kbd: 'S', icon: <SkipNext fontSize="small" />, onClick: handleSkip, disabled: compareList.length === 0 },
    {
      id: 'ask', label: analyzing ? analyzingStatus : 'Ask AI', kbd: 'I', tone: 'ai',
      icon: analyzing ? <CircularProgress size={16} color="inherit" /> : <Psychology fontSize="small" />,
      onClick: handleAiAnalyze, disabled: analyzing || compareList.length < 2
    },
    ...(multi ? [{ id: 'save', label: 'Save rankings', kbd: '↵', icon: <Check fontSize="small" />, onClick: handleSaveRankings, disabled: false }] : [])
  ];

  const roundBtn = (a) => (
    <Box component="button" key={a.id} onClick={a.onClick} disabled={a.disabled}
      title={a.label} aria-label={a.label} sx={actSx(a.tone, true)}>
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
    <Box component="img" alt="" src={performer.thumbnail ? previewUrl(performer.thumbnail) : ''}
      sx={{
        width: size, height: size, borderRadius: '50%', objectFit: 'cover', flex: 'none', bgcolor: 'var(--raised)',
        border: '2px solid', borderColor: aiAnalysis?.winnerId === performer.id ? 'var(--info)' : 'transparent'
      }} />
  );

  const aiBadge = (performer) => {
    const aiScore = aiAnalysis?.scores?.[performer.id];
    if (aiScore === undefined) return null;
    return <Box component="span" sx={aiChipSx}>AI {scoreToStars(aiScore, performer.id)}★</Box>;
  };

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
            <Typography noWrap sx={{ fontWeight: 700, fontSize: isLandscape ? '.82rem' : '.98rem' }}>{performer.name}</Typography>
            <Stars value={performer.performer_rating} compact={isLandscape} />
          </Box>
          <DuelBadge count={performer.comparison_count} />
          {aiBadge(performer)}
          <Box component="button" onClick={(e) => { e.stopPropagation(); refreshPhotos(performer); }}
            title="Refresh photos" aria-label="Refresh photos" sx={iconBtnSx(isLandscape ? 30 : 36)}>
            <Refresh sx={{ fontSize: 16 }} />
          </Box>
        </Box>

        <Box sx={{
          flex: '1 1 0', minHeight: 0, overflowY: 'auto', p: isLandscape ? 0.5 : 1,
          display: 'grid', gap: isLandscape ? 0.5 : 0.75, alignContent: 'start',
          gridTemplateColumns: `repeat(auto-fill, minmax(${compact ? 84 : 130}px, 1fr))`
        }}>
          {pics
            ? pics.map((pic, i) => (
              <Box component="img" key={i} loading="lazy" alt="" src={previewUrl(pic.path)}
                sx={{ width: '100%', aspectRatio: '3/4', objectFit: 'cover', borderRadius: '5px', display: 'block', bgcolor: 'var(--raised)' }} />
            ))
            : Array.from({ length: Math.min(picsPerPerformer, 12) }, (_, i) => <Placeholder key={i} />)}
        </Box>

        <Box className="pickhint" sx={{
          position: 'absolute', left: 0, right: 0, bottom: 0, pt: 2.75, pb: 1.25, textAlign: 'center',
          fontWeight: 700, color: 'var(--ok)', pointerEvents: 'none', opacity: 0, transition: 'opacity .12s',
          background: 'linear-gradient(to top, var(--ok-quiet), transparent)'
        }}>
          {index === 0 ? '← Pick' : 'Pick →'}
        </Box>

        {win && (
          <Box key={flash.id} sx={{
            position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 2,
            animation: `duelFlash ${FLASH_MS - 20}ms ease-out forwards`,
            boxShadow: 'inset 0 0 0 3px var(--ok), inset 0 0 70px var(--ok)'
          }} />
        )}
      </Box>
    );
  };

  const multiRow = (performer, index) => {
    const pics = randomPics[performer.id];
    const aiScore = aiAnalysis?.scores?.[performer.id];
    const isWinner = aiAnalysis?.winnerId === performer.id;
    return (
      <motion.div key={performer.id} layout transition={{ duration: 0.2 }}>
        <Box onClick={() => handlePick(performer)} title="Click to pick as the winner" sx={{
          display: 'grid', gap: isLandscape ? 1 : 1.25, alignItems: 'center', cursor: 'pointer',
          gridTemplateColumns: isPortraitPhone ? '40px minmax(0, 1fr)'
            : isLandscape ? '40px 130px minmax(0, 1fr) 70px' : '54px 190px minmax(0, 1fr) 120px',
          bgcolor: 'var(--surface)', border: '1px solid', borderColor: isWinner ? 'var(--info)' : 'var(--line)',
          borderRadius: '8px', p: isLandscape ? 0.5 : 1,
          '&:hover': { borderColor: 'var(--ok)' }
        }}>
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
            <Box component="button" aria-label="Move up" disabled={index === 0}
              onClick={(e) => { e.stopPropagation(); handleInModalMove(index, 'up'); }} sx={iconBtnSx(28)}>
              <ArrowUpward sx={{ fontSize: 16 }} />
            </Box>
            <Typography sx={{ font: '700 1.1rem ui-monospace, monospace' }}>#{index + 1}</Typography>
            <Box component="button" aria-label="Move down" disabled={index === compareList.length - 1}
              onClick={(e) => { e.stopPropagation(); handleInModalMove(index, 'down'); }} sx={iconBtnSx(28)}>
              <ArrowDownward sx={{ fontSize: 16 }} />
            </Box>
          </Box>

          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', minWidth: 0 }}>
            {avatar(performer, isLandscape ? 28 : 44)}
            <Box sx={{ minWidth: 0 }}>
              <Typography noWrap sx={{ fontWeight: 700, fontSize: isLandscape ? '.82rem' : '.98rem' }}>{performer.name}</Typography>
              <Stars value={performer.performer_rating} compact={isLandscape} />
              <Box sx={{ mt: '3px', display: 'flex', gap: 0.5, alignItems: 'center', flexWrap: 'wrap' }}>
                <DuelBadge count={performer.comparison_count} />
                <Box component="button" onClick={(e) => { e.stopPropagation(); refreshPhotos(performer); }}
                  title="Refresh photos" aria-label="Refresh photos" sx={iconBtnSx(24)}>
                  <Refresh sx={{ fontSize: 14 }} />
                </Box>
              </Box>
            </Box>
          </Box>

          <Box sx={{ display: 'flex', gap: '5px', overflowX: 'auto', gridColumn: isPortraitPhone ? '1 / -1' : undefined }}>
            {pics
              ? pics.map((pic, i) => (
                <Box component="img" key={i} loading="lazy" alt="" src={previewUrl(pic.path)}
                  sx={{ width: isLandscape ? 50 : 74, flex: 'none', aspectRatio: '3/4', objectFit: 'cover', borderRadius: '5px', display: 'block', bgcolor: 'var(--raised)' }} />
              ))
              : Array.from({ length: Math.min(picsPerPerformer, 8) }, (_, i) => (
                <Box key={i} sx={{ width: isLandscape ? 50 : 74, flex: 'none' }}><Placeholder /></Box>
              ))}
          </Box>

          {!isPortraitPhone && (
            <Box sx={{
              border: '1px solid var(--line-strong)', borderRadius: '6px', p: 0.75, textAlign: 'center',
              fontSize: '.72rem', color: 'var(--muted)'
            }}>
              AI prediction
              <Typography sx={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--info)' }}>
                {aiScore !== undefined ? `${scoreToStars(aiScore, performer.id)} ★` : '–'}
              </Typography>
            </Box>
          )}
        </Box>
      </motion.div>
    );
  };

  let body;
  if (loading) {
    body = <Box sx={{ m: 'auto' }}><LoadingState label="Loading performers…" /></Box>;
  } else if (compareList.length < 2) {
    body = (
      <Typography sx={{ m: 'auto', p: 3, color: 'var(--muted)', textAlign: 'center' }}>
        {performers.length < 2 ? 'Fewer than two performers are in the after folder — nothing to compare yet.' : 'Nothing to compare.'}
      </Typography>
    );
  } else if (duel) {
    body = (
      <>
        {duelColumn(compareList[0], 0)}
        {isLandscape ? midColumn(
          <>
            {actions.slice(0, 2).map(roundBtn)}
            <Typography sx={{ textAlign: 'center', fontSize: '.62rem', fontWeight: 700, color: 'var(--muted)' }}>VS</Typography>
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
              fontSize: '.68rem', fontWeight: 700, boxShadow: 'var(--shadow-md)'
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

  const sliderStyle = { width: compact ? 60 : 90, accentColor: 'var(--accent)' };
  const ctrlSx = { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '.78rem', color: 'var(--dim)', whiteSpace: 'nowrap' };

  return (
    <Box sx={{
      position: 'fixed', top: topOffset, left: 0, right: 0, bottom: 0,
      bgcolor: 'var(--bg)', color: 'var(--text)', fontSize: 14,
      display: 'flex', flexDirection: 'column', overflow: 'hidden'
    }}>
      {/* header */}
      <Box sx={{
        display: 'flex', alignItems: 'center', gap: 1, flex: 'none', minWidth: 0, flexWrap: isPortraitPhone ? 'wrap' : 'nowrap',
        px: isLandscape ? 1 : '10px', py: isLandscape ? '2px' : '6px',
        bgcolor: 'var(--surface)', borderBottom: '1px solid var(--line)'
      }}>
        <Box component="button" onClick={() => navigate('/group-rate')} aria-label="Back to the ranking list"
          title="Back to the ranking list" sx={{ ...iconBtnSx(isLandscape ? 30 : 36), color: 'var(--text)' }}>
          <ArrowBack fontSize="small" />
        </Box>
        <Typography component="h2" noWrap sx={{ fontSize: isLandscape ? '.84rem' : '.98rem', fontWeight: 640, minWidth: 0 }}>
          Smart Compare
        </Typography>
        {!compact && <Box component="span" sx={chipSx}>{globalModel ? 'Model active' : 'Default prior'}</Box>}
        <Box component="span" sx={accentChipSx}>{sessionCount} this session</Box>
        <Box sx={{ flex: 1 }} />
        {isOrderDirty && (
          <Button variant="contained" size="small" startIcon={<AutoFixNormal />} onClick={handleApplyOrder}>
            Re-ask AI
          </Button>
        )}
        <Box component="label" sx={ctrlSx}>
          Performers: <b>{performerCount}</b>
          <input type="range" min={2} max={10} value={performerCount} aria-label="Performers per set"
            onChange={(e) => changeCount(Number(e.target.value))} style={sliderStyle} />
        </Box>
        {!compact && (
          <Box component="label" sx={ctrlSx}>
            AI photos: <b>{picsPerPerformer === ALL_PICS ? 'All' : picsPerPerformer}</b>
            <input type="range" min={1} max={ALL_PICS} value={picsPerPerformer} aria-label="Photos per performer"
              onChange={(e) => changePics(Number(e.target.value))} style={sliderStyle} />
          </Box>
        )}
        <Box component="button" onClick={() => setShowSettings(true)} title="Comparison settings" aria-label="Comparison settings"
          sx={iconBtnSx(isLandscape ? 30 : 36)}>
          <Settings fontSize="small" />
        </Box>
      </Box>

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
            <Box component="button" key={a.id} onClick={a.onClick} disabled={a.disabled}
              title={a.label} aria-label={a.label} sx={actSx(a.tone, false)}>
              {a.icon}
              {!isPortraitPhone && (
                <>
                  <Box component="b" sx={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.label}</Box>
                  <Box component="kbd" sx={kbdSx}>{a.kbd}</Box>
                </>
              )}
            </Box>
          ))}
        </Box>
      )}

      {/* Settings */}
      <Dialog open={showSettings} onClose={() => setShowSettings(false)}>
        <DialogTitle sx={{ fontWeight: 700 }}>Comparison settings</DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 1, display: 'flex', flexDirection: 'column', gap: 2.5, fontSize: '.86rem' }}>
            <Box>
              <Typography sx={{ fontSize: '.7rem', letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--muted)' }}>AI server</Typography>
              <Typography sx={{ color: 'var(--dim)', fontSize: '.86rem', mt: 0.5 }}>
                <Box component="span" sx={{ fontFamily: 'ui-monospace, monospace', color: 'var(--text)' }}>{inferenceUrl}</Box>
                {' — change it in the '}
                <Box component="span" onClick={() => { setShowSettings(false); navigate('/taste-dashboard'); }}
                  sx={{ color: 'var(--accent)', cursor: 'pointer' }}>Taste Dashboard</Box>
              </Typography>
            </Box>
            <Box component="label" sx={{ display: 'flex', gap: 1.5, alignItems: 'center', cursor: 'pointer' }}>
              <Box sx={{ flex: 1 }}>
                <Typography sx={{ fontWeight: 700, fontSize: '.86rem' }}>Auto-advance (endless mode)</Typography>
                <Typography sx={{ color: 'var(--muted)', fontSize: '.8rem' }}>Off: go back to the ranking list after each vote</Typography>
              </Box>
              <input type="checkbox" checked={autoNext} onChange={(e) => setAutoNext(e.target.checked)}
                style={{ accentColor: 'var(--accent)', width: 18, height: 18 }} />
            </Box>
            <Box>
              <Typography sx={{ fontSize: '.7rem', letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--muted)' }}>Personal calibration</Typography>
              <Typography sx={{ color: 'var(--dim)', fontSize: '.86rem', my: 0.5 }}>
                Current model strength: {globalModel ? (globalModel.n_effective || 0).toFixed(1) : 0} ratings
              </Typography>
              <Button variant="outlined" size="small" startIcon={<AutoFixNormal />} onClick={handleRecalibrate} disabled={analyzing}>
                Recalibrate global model
              </Button>
            </Box>
            <Box>
              <Typography sx={{ fontSize: '.7rem', letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--muted)' }}>Reset rankings</Typography>
              <Typography sx={{ color: 'var(--dim)', fontSize: '.86rem', my: 0.5 }}>
                Every performer goes back to 2.5 (neutral). For corrupted ratings or a fresh start.
              </Typography>
              <Button variant="outlined" size="small" color="error" startIcon={<Refresh />} onClick={handleResetRankings}>
                Reset all rankings to 2.5
              </Button>
            </Box>
          </Box>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setShowSettings(false)} sx={{ color: 'var(--dim)' }}>Close</Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={!!toast} autoHideDuration={4000} onClose={() => setToast(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        {toast ? <Alert severity={toast.severity} onClose={() => setToast(null)}>{toast.msg}</Alert> : undefined}
      </Snackbar>
    </Box>
  );
}

export default SmartComparePage;
