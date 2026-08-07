import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Box, Typography, IconButton, CircularProgress, Button, Slider, Menu, MenuItem } from '@mui/material';
import {
  ArrowBack, Undo, VolumeUp, VolumeOff,
  CheckCircle, Delete, PlayArrow, Pause, Sort
} from '@mui/icons-material';

/**
 * MobileSorter — fullscreen swipe sorting for one performer, pictures OR videos.
 *
 * Self-contained on purpose: it loads its own files, performs its own keep /
 * delete / undo calls, and runs the trash cleanup on the way out. Nothing from
 * the desktop filter view is mounted behind it, so there is no PC chrome to
 * fall back into.
 *
 * Props:
 *  - performer: { id, name }
 *  - onExit: () => void — called after cleanup has been kicked off
 */

const TYPES = [
  { key: 'pics', label: 'Photos' },
  { key: 'vids', label: 'Videos' }
];

// sortBy/sortOrder go straight to /api/filter/files, which supports all three
// fields once the service hydrates size and modified off disk.
const FILE_SORTS = [
  { key: 'name:asc', label: 'Name — A to Z' },
  { key: 'name:desc', label: 'Name — Z to A' },
  { key: 'size:desc', label: 'Size — largest' },
  { key: 'size:asc', label: 'Size — smallest' },
  { key: 'date:desc', label: 'Date — newest' },
  { key: 'date:asc', label: 'Date — oldest' }
];

const SWIPE_THRESHOLD = 80;
const VELOCITY_THRESHOLD = 0.35; // px/ms

const rawUrl = (path) => `/api/files/raw?path=${encodeURIComponent(path)}`;

const fmtTime = (s) => {
  if (!Number.isFinite(s) || s < 0) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
};

function MobileSorter({ performer, onExit }) {
  const [contentType, setContentType] = useState('pics');
  const [fileSort, setFileSort] = useState(() => localStorage.getItem('mobileSorterFileSort') || 'name:asc');
  const [sortAnchor, setSortAnchor] = useState(null);
  const [files, setFiles] = useState([]);
  const [total, setTotal] = useState(0);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [undoStack, setUndoStack] = useState([]);
  const [muted, setMuted] = useState(true);

  // Video transport. Kept in React rather than leaning on the native controls:
  // the native scrub bar sits on top of the card and eats horizontal drags, so
  // a video card could not be swiped at all.
  const [playing, setPlaying] = useState(true);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);

  // Drag state. The offset lives in state (it drives the transform) but the
  // start point and the "mid-animation" latch are refs — reading them from a
  // stale closure inside a touch handler would drop swipes.
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [exiting, setExiting] = useState(null); // 'left' | 'right' | null
  const startRef = useRef({ x: 0, y: 0, t: 0 });
  const lockRef = useRef(false);
  const videoRef = useRef(null);

  const current = files[index];
  const isVideo = contentType === 'vids';

  const loadFiles = useCallback(async () => {
    setLoading(true);
    setIndex(0);
    setUndoStack([]);
    try {
      const [sortBy, sortOrder] = fileSort.split(':');
      const res = await fetch(
        `/api/filter/files/${performer.id}?type=${contentType}` +
        `&sortBy=${encodeURIComponent(sortBy)}&sortOrder=${encodeURIComponent(sortOrder)}` +
        `&hideKept=true&limit=500&offset=0`
      );
      const data = await res.json();
      setFiles(Array.isArray(data.files) ? data.files : []);
      setTotal(data.total ?? 0);
    } catch (err) {
      console.error('MobileSorter: failed to load files', err);
      setFiles([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [performer.id, contentType, fileSort]);

  useEffect(() => { loadFiles(); }, [loadFiles]);
  useEffect(() => { localStorage.setItem('mobileSorterFileSort', fileSort); }, [fileSort]);

  // Preload the next few images so a swipe doesn't land on a blank card.
  useEffect(() => {
    if (isVideo) return;
    files.slice(index + 1, index + 5).forEach((f) => {
      const img = new Image();
      img.src = rawUrl(f.path);
    });
  }, [files, index, isVideo]);

  // `muted` as a JSX prop is unreliable on <video>; set it on the element.
  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = muted;
  }, [muted, current]);

  // Mirror the element's transport state into React so the custom controls
  // stay truthful (autoplay may be refused, the clip loops, the user seeks).
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !isVideo) return;
    setPosition(0);
    setDuration(0);
    const onTime = () => setPosition(v.currentTime || 0);
    const onMeta = () => setDuration(v.duration || 0);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    v.addEventListener('timeupdate', onTime);
    v.addEventListener('loadedmetadata', onMeta);
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    return () => {
      v.removeEventListener('timeupdate', onTime);
      v.removeEventListener('loadedmetadata', onMeta);
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
    };
  }, [isVideo, current]);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {}); else v.pause();
  }, []);

  const seek = useCallback((value) => {
    const v = videoRef.current;
    if (!v || !Number.isFinite(v.duration)) return;
    v.currentTime = value;
    setPosition(value);
  }, []);

  const cleanup = useCallback(async () => {
    try {
      await fetch(`/api/performers/${performer.id}/cleanup-trash-async`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'training' })
      });
    } catch (err) {
      console.error('MobileSorter: cleanup failed', err);
    }
  }, [performer.id]);

  const handleExit = useCallback(async () => {
    await cleanup();
    onExit();
  }, [cleanup, onExit]);

  // Optimistic: advance immediately, fire the request without waiting.
  const act = useCallback((action) => {
    const file = files[index];
    if (!file) return;

    setUndoStack((prev) => [...prev, { file, index, action }]);
    setIndex((prev) => prev + 1);

    fetch('/api/filter/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ performerId: performer.id, filePath: file.path, action })
    }).catch((err) => console.error('MobileSorter: action failed', err));
  }, [files, index, performer.id]);

  const commit = useCallback((direction) => {
    if (lockRef.current) return;
    lockRef.current = true;
    setExiting(direction);
    setOffset(0);
    act(direction === 'right' ? 'keep' : 'delete');
    // One frame is enough for React to flush the index bump; the next card
    // then mounts at rest instead of inheriting the exit transform.
    requestAnimationFrame(() => {
      setExiting(null);
      lockRef.current = false;
    });
  }, [act]);

  const handleUndo = useCallback(async () => {
    if (undoStack.length === 0) return;
    const last = undoStack[undoStack.length - 1];
    try {
      const res = await fetch('/api/filter/undo', { method: 'POST' });
      if (!res.ok) return;
      setUndoStack((prev) => prev.slice(0, -1));
      setFiles((prev) => {
        const next = [...prev];
        if (!next.some((f) => f.path === last.file.path)) {
          next.splice(last.index, 0, last.file);
        }
        return next;
      });
      setIndex(last.index);
    } catch (err) {
      console.error('MobileSorter: undo failed', err);
    }
  }, [undoStack]);

  const onTouchStart = (e) => {
    if (lockRef.current) return;
    const t = e.touches[0];
    startRef.current = { x: t.clientX, y: t.clientY, t: Date.now() };
    setDragging(true);
  };

  const onTouchMove = (e) => {
    if (!dragging || lockRef.current) return;
    const t = e.touches[0];
    setOffset(t.clientX - startRef.current.x);
  };

  const onTouchEnd = () => {
    if (!dragging) return;
    setDragging(false);
    const elapsed = Math.max(1, Date.now() - startRef.current.t);
    const velocity = Math.abs(offset) / elapsed;
    if (Math.abs(offset) > SWIPE_THRESHOLD || velocity > VELOCITY_THRESHOLD) {
      commit(offset > 0 ? 'right' : 'left');
    } else {
      setOffset(0);
    }
  };

  const transform = exiting
    ? `translateX(${exiting === 'right' ? 120 : -120}vw) rotate(${exiting === 'right' ? 18 : -18}deg)`
    : `translateX(${offset}px) rotate(${offset * 0.04}deg)`;

  const decision = Math.abs(offset) > SWIPE_THRESHOLD ? (offset > 0 ? 'keep' : 'delete') : null;
  const done = !loading && (files.length === 0 || index >= files.length);

  return (
    <Box sx={{
      position: 'fixed', inset: 0, zIndex: 1400,
      bgcolor: 'var(--bg)', color: 'var(--text)',
      display: 'flex', flexDirection: 'column',
      // dvh, not vh — vh sits under the mobile URL bar and buries the buttons.
      height: '100dvh',
      paddingBottom: 'env(safe-area-inset-bottom)',
      touchAction: 'none', overflow: 'hidden'
    }}>
      {/* Header */}
      <Box sx={{
        display: 'flex', alignItems: 'center', gap: 0.5,
        px: 1, py: 0.75, flexShrink: 0,
        paddingTop: 'calc(env(safe-area-inset-top) + 6px)',
        borderBottom: '1px solid var(--line)'
      }}>
        <IconButton onClick={handleExit} aria-label="Back to performers" sx={{ color: 'var(--text)' }}>
          <ArrowBack />
        </IconButton>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography noWrap sx={{ fontWeight: 650, fontSize: '0.95rem', lineHeight: 1.2 }}>
            {performer.name}
          </Typography>
          <Typography sx={{ color: 'var(--dim)', fontSize: '0.75rem' }}>
            {done ? `${total} sorted` : `${Math.min(index + 1, files.length)} of ${files.length}`}
          </Typography>
        </Box>
        {isVideo && !done && (
          <IconButton
            onClick={() => setMuted((m) => !m)}
            aria-label={muted ? 'Unmute' : 'Mute'}
            sx={{ color: 'var(--text)' }}
          >
            {muted ? <VolumeOff /> : <VolumeUp />}
          </IconButton>
        )}
        <IconButton
          onClick={handleUndo}
          disabled={undoStack.length === 0}
          aria-label="Undo"
          sx={{ color: 'var(--text)', '&.Mui-disabled': { color: 'var(--faint)' } }}
        >
          <Undo />
        </IconButton>
      </Box>

      {/* Photos / Videos, plus the file ordering */}
      <Box sx={{ display: 'flex', gap: 1, px: 1.5, py: 1, flexShrink: 0 }}>
        {TYPES.map((t) => (
          <Button
            key={t.key}
            onClick={() => setContentType(t.key)}
            size="small"
            sx={{
              flex: 1, textTransform: 'none', fontWeight: 650, borderRadius: 'var(--radius, 6px)',
              minHeight: 40,
              bgcolor: contentType === t.key ? 'var(--accent)' : 'transparent',
              color: contentType === t.key ? 'var(--on-accent)' : 'var(--dim)',
              border: '1px solid',
              borderColor: contentType === t.key ? 'var(--accent)' : 'var(--line)'
            }}
          >
            {t.label}
          </Button>
        ))}
        <IconButton
          onClick={(e) => setSortAnchor(e.currentTarget)}
          aria-label="Sort files"
          sx={{
            color: 'var(--dim)', border: '1px solid var(--line)',
            borderRadius: 'var(--radius, 6px)', width: 40, height: 40, flexShrink: 0
          }}
        >
          <Sort />
        </IconButton>
      </Box>

      <Menu anchorEl={sortAnchor} open={!!sortAnchor} onClose={() => setSortAnchor(null)}>
        {FILE_SORTS.map((s) => (
          <MenuItem
            key={s.key}
            selected={fileSort === s.key}
            onClick={() => { setFileSort(s.key); setSortAnchor(null); }}
          >
            {s.label}
          </MenuItem>
        ))}
      </Menu>

      {/* Card */}
      <Box
        sx={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', p: 1, position: 'relative' }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {loading && <CircularProgress />}

        {!loading && done && (
          <Box sx={{ textAlign: 'center', px: 3 }}>
            <Typography sx={{ fontWeight: 650, mb: 1 }}>Nothing left to sort</Typography>
            <Typography sx={{ color: 'var(--dim)', fontSize: '0.85rem', mb: 3 }}>
              No unsorted {isVideo ? 'videos' : 'photos'} for {performer.name}.
            </Typography>
            <Button variant="contained" onClick={handleExit} sx={{ textTransform: 'none' }}>
              Back to performers
            </Button>
          </Box>
        )}

        {!loading && !done && current && (
          <Box sx={{
            width: '100%', height: '100%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transform,
            transition: dragging ? 'none' : 'transform 0.18s cubic-bezier(0.2,0.8,0.3,1.1)',
            willChange: 'transform', position: 'relative'
          }}>
            {isVideo ? (
              <video
                key={current.path}
                ref={videoRef}
                src={rawUrl(current.path)}
                autoPlay
                loop
                playsInline
                // No `controls`: the native scrub bar swallows horizontal drags,
                // which is what made video cards impossible to swipe.
                style={{
                  maxWidth: '100%', maxHeight: '100%', objectFit: 'contain',
                  borderRadius: 8, pointerEvents: 'none'
                }}
              />
            ) : (
              <img
                key={current.path}
                src={rawUrl(current.path)}
                alt={current.name}
                draggable={false}
                style={{
                  maxWidth: '100%', maxHeight: '100%', objectFit: 'contain',
                  borderRadius: 8, pointerEvents: 'none', userSelect: 'none'
                }}
              />
            )}

            {decision && (
              <Box sx={{
                position: 'absolute', top: 16,
                [decision === 'keep' ? 'left' : 'right']: 16,
                px: 1.5, py: 0.5, borderRadius: 'var(--radius, 6px)',
                border: '2px solid',
                borderColor: decision === 'keep' ? 'var(--ok, #4caf50)' : 'var(--bad, #f44336)',
                color: decision === 'keep' ? 'var(--ok, #4caf50)' : 'var(--bad, #f44336)',
                fontWeight: 800, letterSpacing: '.08em', fontSize: '1.1rem',
                transform: `rotate(${decision === 'keep' ? -12 : 12}deg)`,
                pointerEvents: 'none'
              }}>
                {decision === 'keep' ? 'KEEP' : 'DELETE'}
              </Box>
            )}
          </Box>
        )}
      </Box>

      {/* Video transport. Outside the swipe area on purpose — this row owns
          its own touches, the card above still owns horizontal drags. */}
      {isVideo && !done && current && (
        <Box sx={{
          display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 0.5,
          flexShrink: 0, touchAction: 'auto'
        }}>
          <IconButton
            onClick={togglePlay}
            aria-label={playing ? 'Pause' : 'Play'}
            sx={{ color: 'var(--text)', flexShrink: 0 }}
          >
            {playing ? <Pause /> : <PlayArrow />}
          </IconButton>
          <Slider
            size="small"
            min={0}
            max={duration || 0}
            value={Math.min(position, duration || 0)}
            onChange={(_, v) => seek(Array.isArray(v) ? v[0] : v)}
            aria-label="Seek"
            sx={{ color: 'var(--accent)', mx: 0.5 }}
          />
          <Typography sx={{ color: 'var(--dim)', fontSize: '0.72rem', minWidth: 74, textAlign: 'right' }}>
            {fmtTime(position)} / {fmtTime(duration)}
          </Typography>
        </Box>
      )}

      {/* Actions — big targets, always visible on touch */}
      {!done && (
        <Box sx={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
          py: 1.5, flexShrink: 0, borderTop: '1px solid var(--line)'
        }}>
          <IconButton
            onClick={() => commit('left')}
            aria-label="Delete"
            sx={{ width: 64, height: 64, border: '2px solid var(--bad, #f44336)', color: 'var(--bad, #f44336)' }}
          >
            <Delete sx={{ fontSize: 30 }} />
          </IconButton>
          <IconButton
            onClick={() => commit('right')}
            aria-label="Keep"
            sx={{ width: 64, height: 64, border: '2px solid var(--ok, #4caf50)', color: 'var(--ok, #4caf50)' }}
          >
            <CheckCircle sx={{ fontSize: 30 }} />
          </IconButton>
        </Box>
      )}
    </Box>
  );
}

export default MobileSorter;
