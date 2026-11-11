import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Box, Typography, Button, IconButton, CircularProgress, Rating, Tooltip, useMediaQuery
} from '@mui/material';
import { Refresh, ArrowUpward, ArrowDownward } from '@mui/icons-material';
import { Link as RouterLink } from 'react-router-dom';
import { PageShell, PageHeader, Panel, LoadingState, EmptyState, SPACE, iconBtnSx } from '../components/layout';
import { useNotify, plural, errorText } from '../components/ui';
import RateTabs from '../components/rating/RateTabs';
import { newVoteId } from '../components/rating/voteQueue';

const CALIBRATION_THRESHOLD = 5;
const PICS_PER_ROW = 10;
const HIGHLIGHT_MS = 1500;

const previewUrl = (p) => `/api/files/preview?path=${encodeURIComponent(p)}`;
const ratingOf = (p) => p.performer_rating || 0;
const sortByRating = (list) => [...list].sort((a, b) => ratingOf(b) - ratingOf(a));

/** Reads a JSON answer; throws the server's error, or the status, when it is not ok. */
async function readJson(res) {
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && data.error) || res.statusText || `HTTP ${res.status}`);
  if (data == null) throw new Error('The server sent no answer');
  return data;
}

// Waits before each resend of a vote that got no answer (or a 5xx). The body carries a vote id, so the server
// counts a resent vote once and answers it with the first answer.
const RESEND_MS = [1000, 2000, 4000, 8000];

/** A 4xx is the server saying no for good (nothing was stored); 408 and 429 are worth another try. */
const isFinalRefusal = (status) => status >= 400 && status <= 499 && status !== 408 && status !== 429;

/**
 * POSTs one vote (its body has a voteId) and resends it while it gets no usable answer and stillWanted() holds.
 * Throws with err.refused when the server said no, with err.lost when no answer came.
 */
async function postVote(url, body, stillWanted) {
  let last = null;
  for (let attempt = 0; attempt <= RESEND_MS.length; attempt += 1) {
    if (attempt > 0) {
      await new Promise(resolve => setTimeout(resolve, RESEND_MS[attempt - 1]));
      if (!stillWanted()) break;
    }
    let res;
    try {
      res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    } catch (_) {
      last = null; // never reached the server, or the answer was lost
      continue;
    }
    const data = await res.json().catch(() => null);
    if (res.ok && data) return data;
    if (isFinalRefusal(res.status)) {
      const err = new Error((data && data.error) || `The server refused it (${res.status})`);
      err.refused = true;
      throw err;
    }
    last = (data && data.error) || `HTTP ${res.status}`;
  }
  const err = new Error(last || 'No answer from the server');
  err.lost = true;
  throw err;
}

const btnSx = { ...iconBtnSx(), '&.Mui-disabled': { color: 'var(--faint)' } };

const moveBtnSx = (phone) => ({
  textTransform: 'none', justifyContent: 'flex-start', whiteSpace: 'nowrap', width: '100%',
  height: 30, minWidth: 0, px: phone ? '8px' : '10px', fontSize: '13px', fontWeight: 560,
  color: 'var(--text)', borderColor: 'var(--line-strong)', borderRadius: 'var(--radius)',
  '& .MuiButton-startIcon': { mr: phone ? '4px' : '6px', ml: 0, '& svg': { fontSize: 16 } },
  '&:hover': { borderColor: 'var(--line-strong)', bgcolor: 'var(--raised)' },
  '&.Mui-disabled': { color: 'var(--faint)', borderColor: 'var(--line)' }
});

const chipSx = {
  display: 'inline-flex', alignItems: 'center', height: 22, px: '8px', alignSelf: 'flex-start',
  fontSize: '12px', lineHeight: 1, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums',
  border: '1px solid var(--line-strong)', borderRadius: 'var(--radius-lg)', color: 'var(--dim)'
};

/** Group Rate: every after-folder performer, best first; each button records one duel with the neighbour. */
function GroupRatePage() {
  const notify = useNotify();
  const isPhone = useMediaQuery('(max-width:599.95px)');
  const isShort = useMediaQuery('(max-height:500px)');
  const smallStrip = isPhone || isShort;
  const stripW = smallStrip ? 64 : 90;
  const stripH = smallStrip ? 86 : 120;

  const [performers, setPerformers] = useState([]);
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [loadError, setLoadError] = useState(null);
  const [reloading, setReloading] = useState(false);
  const [pics, setPics] = useState({});             // id -> { pics, failed? }
  const [busy, setBusy] = useState(null);           // { id, dir } while one duel saves
  const [highlight, setHighlight] = useState(null); // { id, n }

  const performersRef = useRef([]);
  const busyRef = useRef(false);
  const mounted = useRef(true);
  const requested = useRef(new Set());
  const rowEls = useRef(new Map());
  const rowRefFns = useRef(new Map());
  const observer = useRef(null);
  const highlightN = useRef(0);
  const unanswered = useRef(new Map()); // voteId -> body of a duel without an answer yet
  const moveRef = useRef(null);
  const duelRef = useRef(null);
  performersRef.current = performers;


  // ── the list ──
  const fetchList = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setReloading(true);
    try {
      const res = await fetch('/api/performers');
      const data = await readJson(res);
      if (!Array.isArray(data)) throw new Error('The server sent no list');
      if (!mounted.current) return;
      const next = sortByRating(data.filter(p => p.moved_to_after === 1));
      performersRef.current = next;
      setPerformers(next);
      setStatus('ready');
      setLoadError(null);
    } catch (err) {
      if (!mounted.current) return;
      const msg = errorText(err, 'No answer from the server');
      if (performersRef.current.length > 0) notify({ message: 'Could not reload the performers: ' + msg, severity: 'error' });
      else { setLoadError(msg); setStatus('error'); }
    } finally {
      if (mounted.current && !silent) setReloading(false);
    }
  }, [notify]);

  useEffect(() => { fetchList(); }, [fetchList]);

  // ── photos: each row fetches its pictures once, when it nears the viewport ──
  const loadPics = useCallback(async (id) => {
    requested.current.add(id);
    try {
      const res = await fetch(`/api/performers/${id}/random-pics?count=${PICS_PER_ROW}`);
      const data = await readJson(res);
      if (mounted.current) setPics(prev => ({ ...prev, [id]: { pics: Array.isArray(data.pics) ? data.pics : [] } }));
    } catch (_) {
      if (mounted.current) setPics(prev => ({ ...prev, [id]: { pics: [], failed: true } }));
    }
  }, []);

  // id per observed element, so the observer never has to parse it back from the DOM
  const idOfEl = useRef(new WeakMap());

  const getObserver = useCallback(() => {
    if (observer.current || typeof IntersectionObserver === 'undefined') return observer.current;
    observer.current = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const id = idOfEl.current.get(entry.target);
        if (observer.current) observer.current.unobserve(entry.target);
        if (id !== undefined && !requested.current.has(id)) loadPics(id);
      });
    }, { rootMargin: '400px' });
    return observer.current;
  }, [loadPics]);

  /** A stable ref callback per row: observes the row until its pictures are asked for. */
  const rowRef = (id) => {
    let fn = rowRefFns.current.get(id);
    if (fn) return fn;
    fn = (el) => {
      const old = rowEls.current.get(id);
      const obs = getObserver();
      if (old && old !== el && obs) obs.unobserve(old);
      if (el) {
        rowEls.current.set(id, el);
        idOfEl.current.set(el, id);
        if (requested.current.has(id)) return;
        if (obs) obs.observe(el);
        else loadPics(id);
      } else {
        rowEls.current.delete(id);
      }
    };
    rowRefFns.current.set(id, fn);
    return fn;
  };

  // Rows that were drawn before the effect ran (or survived a remount) get observed here.
  useEffect(() => {
    mounted.current = true;
    const obs = getObserver();
    rowEls.current.forEach((el, id) => {
      if (requested.current.has(id)) return;
      if (obs) obs.observe(el);
      else loadPics(id);
    });
    return () => {
      mounted.current = false;
      if (observer.current) observer.current.disconnect();
      observer.current = null;
    };
  }, [getObserver, loadPics]);

  // ── the moved row: scroll it into view and mark it for a moment ──
  useEffect(() => {
    if (!highlight) return undefined;
    const el = rowEls.current.get(highlight.id);
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' });
    const t = setTimeout(() => {
      if (mounted.current) setHighlight(h => (h && h.n === highlight.n ? null : h));
    }, HIGHLIGHT_MS);
    return () => clearTimeout(t);
  }, [highlight]);

  // ── one duel with the neighbour ──
  // Votes still without an answer (voteId -> body): sent once more, with keepalive, when the page goes away.
  useEffect(() => {
    const flush = () => {
      unanswered.current.forEach((body) => {
        try {
          fetch('/api/performers/compare', {
            method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
          }).catch(() => {});
        } catch (_) { /* the page is going away */ }
      });
      unanswered.current.clear();
    };
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, []);

  const undoMove = useCallback(async (token) => {
    try {
      await postVote('/api/performers/compare/undo', { undo: token, voteId: newVoteId() }, () => mounted.current);
      await fetchList({ silent: true });
      notify({ message: 'Undone', severity: 'success' });
    } catch (err) {
      notify({ message: 'Could not undo: ' + errorText(err), severity: 'error' });
    }
  }, [fetchList, notify]);

  /** Sends one duel (resent with the same vote id until it is answered) and folds the answer into the list. */
  const duel = useCallback(async (performerId, dir, winner, loser, voteId) => {
    if (busyRef.current) return;
    const performer = winner.id === performerId ? winner : loser;
    const body = { winnerId: winner.id, loserId: loser.id, draw: false, voteId };

    busyRef.current = true;
    setBusy({ id: performerId, dir });
    unanswered.current.set(voteId, body);
    try {
      const data = await postVote('/api/performers/compare', body, () => mounted.current);
      unanswered.current.delete(voteId);
      if (!data.success || !Array.isArray(data.results)) {
        const err = new Error(data.error || 'The server did not record it');
        err.refused = true;
        throw err;
      }
      if (!mounted.current) return;

      const newRatings = new Map(data.results.map(r => [r.id, r.newRating]));
      const current = performersRef.current;
      const oldRank = current.findIndex(p => p.id === performerId) + 1;
      const mine = data.results.find(r => r.id === performerId);
      const oldRating = data.repeated && mine ? (mine.oldRating || 0) : ratingOf(current.find(p => p.id === performerId) || performer);
      // a repeat answer carries the ratings of the first send: the list may hold them already
      const next = sortByRating(current.map(p => (newRatings.has(p.id) && !(data.repeated && ratingOf(p) === newRatings.get(p.id))
        ? { ...p, performer_rating: newRatings.get(p.id), comparison_count: (p.comparison_count || 0) + 1 }
        : p)));
      performersRef.current = next;
      setPerformers(next);
      const newRank = next.findIndex(p => p.id === performerId) + 1;
      const newRating = newRatings.has(performerId) ? (newRatings.get(performerId) || 0) : oldRating;
      highlightN.current += 1;
      setHighlight({ id: performerId, n: highlightN.current });

      const place = newRank === oldRank ? `still #${newRank}` : `now #${newRank}, was #${oldRank}`;
      notify({
        message: `${performer.name} ${oldRating.toFixed(2)} → ${newRating.toFixed(2)} · ${place}`,
        severity: 'success',
        action: data.undo ? { label: 'Undo', onClick: () => undoMove(data.undo) } : undefined
      });
    } catch (err) {
      if (err.refused) unanswered.current.delete(voteId);
      if (!mounted.current) return;
      if (err.refused) {
        notify({
          message: `Could not record ${winner.name} over ${loser.name}: ${errorText(err)}. Ratings unchanged.`,
          severity: 'error',
          action: { label: 'Retry', onClick: () => moveRef.current(performerId, dir) }
        });
      } else {
        // No answer after the resends: the server may or may not have it. Retry sends the same vote (same id),
        // which the server counts once; leaving the page sends it once more.
        notify({
          message: `No answer for ${winner.name} over ${loser.name}. Retry sends it again; it counts once.`,
          severity: 'warning',
          action: { label: 'Retry', onClick: () => duelRef.current(performerId, dir, winner, loser, voteId) }
        });
        fetchList({ silent: true });
      }
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(null);
    }
  }, [notify, undoMove, fetchList]);

  const move = useCallback((performerId, dir) => {
    if (busyRef.current) return;
    const list = performersRef.current;
    const idx = list.findIndex(p => p.id === performerId);
    if (idx < 0) return;
    const performer = list[idx];
    const neighbour = dir === 'up' ? list[idx - 1] : list[idx + 1];
    if (!neighbour) return;
    const winner = dir === 'up' ? performer : neighbour;
    const loser = dir === 'up' ? neighbour : performer;
    duel(performerId, dir, winner, loser, newVoteId());
  }, [duel]);
  moveRef.current = move;
  duelRef.current = duel;

  // ── drawing ──
  const avatar = (p, size) => (
    p.thumbnail
      ? (
        <Box component="img" alt="" loading="lazy" src={previewUrl(p.thumbnail)}
          sx={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flex: 'none', bgcolor: 'var(--raised)' }} />
      ) : (
        <Box aria-hidden sx={{
          width: size, height: size, borderRadius: '50%', flex: 'none', bgcolor: 'var(--raised)',
          display: 'grid', placeItems: 'center', color: 'var(--dim)', fontSize: '14px', fontWeight: 600
        }}>
          {(p.name || '?').charAt(0).toUpperCase()}
        </Box>
      )
  );

  const duelChip = (p) => {
    const n = p.comparison_count || 0;
    return n < CALIBRATION_THRESHOLD
      ? <Box component="span" sx={{ ...chipSx, borderColor: 'var(--warn)', color: 'var(--warn)' }}>calibrating {n}/{CALIBRATION_THRESHOLD}</Box>
      : <Box component="span" sx={chipSx}>{plural(n, 'duel')}</Box>;
  };

  const stars = (p) => (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
      <Rating value={ratingOf(p)} precision={0.1} readOnly size="small"
        sx={{ color: 'var(--warn)', fontSize: isPhone ? '14px' : '16px', '& .MuiRating-iconEmpty': { color: 'var(--faint)' } }} />
      <Typography component="span" sx={{ color: 'var(--muted)', fontSize: '13px', fontVariantNumeric: 'tabular-nums' }}>
        {ratingOf(p).toFixed(2)}
      </Typography>
    </Box>
  );

  const strip = (p) => {
    const got = pics[p.id];
    return (
      <Box sx={{ display: 'flex', gap: '6px', overflowX: 'auto', overflowY: 'hidden', height: stripH, minWidth: 0, scrollbarWidth: 'thin' }}>
        {!got && Array.from({ length: PICS_PER_ROW }, (_, i) => (
          <Box key={i} sx={{ width: stripW, height: stripH, flex: 'none', borderRadius: 'var(--radius-sm)', bgcolor: 'var(--raised)' }} />
        ))}
        {got && got.pics.length === 0 && (
          <Typography sx={{ alignSelf: 'center', color: 'var(--muted)', fontSize: '13px' }}>
            {got.failed ? 'Could not load the pictures' : 'No pictures in the pics folder'}
          </Typography>
        )}
        {got && got.pics.map((pic, i) => (
          <Box key={pic.path || i} component="img" alt="" loading="lazy" src={previewUrl(pic.path)}
            sx={{ width: stripW, height: stripH, flex: 'none', objectFit: 'cover', borderRadius: 'var(--radius-sm)', bgcolor: 'var(--raised)', display: 'block' }} />
        ))}
      </Box>
    );
  };

  const moveButton = (p, index, dir) => {
    const up = dir === 'up';
    const atEnd = up ? index === 0 : index === performers.length - 1;
    const saving = !!busy && busy.id === p.id && busy.dir === dir;
    const full = up ? 'Better than above' : 'Worse than below';
    const label = saving ? 'Saving…' : (isPhone ? (up ? 'Better' : 'Worse') : full);
    return (
      <Tooltip title={atEnd ? (up ? 'Already at the top' : 'Already at the bottom') : ''}>
        <Box component="span" sx={{ display: 'flex' }}>
          <Button variant="outlined" size="small" aria-label={full}
            startIcon={up ? <ArrowUpward /> : <ArrowDownward />}
            disabled={atEnd || !!busy}
            onClick={() => move(p.id, dir)}
            sx={moveBtnSx(isPhone)}>
            {label}
          </Button>
        </Box>
      </Tooltip>
    );
  };

  const newPicsButton = (p) => (
    <Tooltip title="New pictures">
      <Box component="span" sx={{ display: 'inline-flex' }}>
        <IconButton aria-label={`New pictures of ${p.name}`} disabled={!!busy} onClick={() => loadPics(p.id)} sx={btnSx}>
          <Refresh />
        </IconButton>
      </Box>
    </Tooltip>
  );

  // the height a row has before it is drawn (content-visibility), so the scroll bar does not jump
  const rowHeight = isPhone ? 64 + 8 + stripH + 16 + 2 : Math.max(stripH, 64) + 24 + 2;

  const row = (p, index) => {
    const lit = !!highlight && highlight.id === p.id;
    const rank = (
      <Typography sx={{ fontSize: '16px', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'var(--text)', textAlign: 'center' }}>
        #{index + 1}
      </Typography>
    );
    const buttons = (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flex: 'none' }}>
        <Box sx={{ display: 'grid', gap: 0.5, width: isPhone ? 90 : 160 }}>
          {moveButton(p, index, 'up')}
          {moveButton(p, index, 'down')}
        </Box>
        {newPicsButton(p)}
      </Box>
    );
    const nameBlock = (
      <Box sx={{ minWidth: 0, flex: '1 1 auto', display: 'flex', flexDirection: 'column', gap: '2px' }}>
        <Typography noWrap sx={{ fontWeight: 640, fontSize: '14px', color: 'var(--text)' }}>{p.name}</Typography>
        {stars(p)}
        {duelChip(p)}
      </Box>
    );

    return (
      <Box
        key={p.id}
        ref={rowRef(p.id)}
        sx={{ contentVisibility: 'auto', containIntrinsicSize: `auto ${rowHeight}px` }}
      >
        <Panel
          padded={false}
          sx={{
            p: isPhone ? SPACE.sm : 1.5,
            outline: '2px solid',
            outlineColor: lit ? 'var(--accent)' : 'transparent',
            outlineOffset: '-1px',
            transition: 'outline-color .2s ease',
            ...(isPhone
              ? { display: 'flex', flexDirection: 'column', gap: SPACE.sm }
              : { display: 'grid', gridTemplateColumns: '40px 200px minmax(0, 1fr) auto', alignItems: 'center', columnGap: 1.5 })
          }}
        >
          {isPhone ? (
            <>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: SPACE.sm, minWidth: 0, minHeight: 64 }}>
                <Box sx={{ width: 28, flex: 'none' }}>{rank}</Box>
                {avatar(p, 36)}
                {nameBlock}
                {buttons}
              </Box>
              {strip(p)}
            </>
          ) : (
            <>
              {rank}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: SPACE.sm, minWidth: 0 }}>
                {avatar(p, 48)}
                {nameBlock}
              </Box>
              {strip(p)}
              {buttons}
            </>
          )}
        </Panel>
      </Box>
    );
  };

  let content;
  if (status === 'loading') {
    content = <LoadingState label="Loading performers…" />;
  } else if (status === 'error') {
    content = (
      <EmptyState title="Could not load performers" description={loadError || 'No answer from the server'}
        action={<Button variant="outlined" onClick={() => fetchList()} disabled={reloading}>{reloading ? 'Loading…' : 'Retry'}</Button>} />
    );
  } else if (performers.length === 0) {
    content = (
      <EmptyState title="No performers in the after folder"
        description="Performers show up here once Filter has moved them to the after folder."
        action={<Button variant="outlined" component={RouterLink} to="/filter">Open Filter</Button>} />
    );
  } else {
    content = (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: SPACE.sm }}>
        {performers.map(row)}
      </Box>
    );
  }

  return (
    <PageShell full>
      <PageHeader title="Group Rate" />

      <Box sx={{ display: 'flex', alignItems: 'center', gap: SPACE.sm, flexWrap: 'wrap', mb: SPACE.md, minWidth: 0 }}>
        <RateTabs current="list" />
        {status === 'ready' && performers.length > 0 && (
          <Typography sx={{ color: 'var(--dim)', fontSize: '13px', minWidth: 0, flex: '1 1 220px', fontVariantNumeric: 'tabular-nums' }}>
            {plural(performers.length, 'performer')}, best first · each button records one duel with the neighbour
          </Typography>
        )}
        <Tooltip title="Reload">
          <Box component="span" sx={{ display: 'inline-flex', ml: 'auto' }}>
            <IconButton aria-label="Reload" onClick={() => fetchList()} disabled={reloading} sx={btnSx}>
              {reloading ? <CircularProgress size={16} sx={{ color: 'var(--dim)' }} /> : <Refresh />}
            </IconButton>
          </Box>
        </Tooltip>
      </Box>

      {content}
    </PageShell>
  );
}

export default GroupRatePage;
