import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Box, Typography, IconButton, CircularProgress, Button } from '@mui/material';
import { ArrowBack, Close, PlayCircle, ChevronLeft, ChevronRight } from '@mui/icons-material';

/**
 * MobileGallery — a performer's media on a phone.
 *
 * The desktop unified gallery is a three-pane layout with a sidebar, filter
 * rail and hover-driven controls; none of that survives 390px. This is a
 * three-up square grid plus a fullscreen viewer you swipe through.
 *
 * Props:
 *  - performer: { id, name }
 *  - onExit: () => void
 */

const TABS = [
  { key: 'pics', label: 'Photos' },
  { key: 'vids', label: 'Videos' }
];

const rawUrl = (p) => `/api/files/raw?path=${encodeURIComponent(p)}`;
const previewUrl = (p) => `/api/files/preview?path=${encodeURIComponent(p)}`;

function MobileGallery({ performer, onExit }) {
  const [tab, setTab] = useState('pics');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [viewerIndex, setViewerIndex] = useState(null);
  const startX = useRef(0);

  const isVideo = tab === 'vids';

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setViewerIndex(null);
    const endpoint = isVideo
      ? `/api/performers/${performer.id}/gallery/videos`
      : `/api/performers/${performer.id}/gallery/images`;

    fetch(endpoint)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        setItems(isVideo ? (data.vids || []) : (data.pics || []));
      })
      .catch((err) => {
        console.error('MobileGallery: load failed', err);
        if (!cancelled) setItems([]);
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [performer.id, isVideo]);

  const close = useCallback(() => setViewerIndex(null), []);
  const step = useCallback((delta) => {
    setViewerIndex((i) => {
      if (i === null) return i;
      const next = i + delta;
      return next < 0 || next >= items.length ? i : next;
    });
  }, [items.length]);

  // Arrow keys help when this is open on a tablet with a keyboard attached.
  useEffect(() => {
    if (viewerIndex === null) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') close();
      if (e.key === 'ArrowLeft') step(-1);
      if (e.key === 'ArrowRight') step(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [viewerIndex, close, step]);

  const viewing = viewerIndex !== null ? items[viewerIndex] : null;

  return (
    <Box sx={{
      position: 'fixed', inset: 0, zIndex: 1300,
      bgcolor: 'var(--bg)', color: 'var(--text)',
      display: 'flex', flexDirection: 'column',
      height: '100dvh', overflow: 'hidden',
      paddingBottom: 'env(safe-area-inset-bottom)'
    }}>
      {/* Header */}
      <Box sx={{
        display: 'flex', alignItems: 'center', gap: 0.5, px: 1, py: 0.75, flexShrink: 0,
        paddingTop: 'calc(env(safe-area-inset-top) + 6px)',
        borderBottom: '1px solid var(--line)'
      }}>
        <IconButton onClick={onExit} aria-label="Back to performers" sx={{ color: 'var(--text)' }}>
          <ArrowBack />
        </IconButton>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography noWrap sx={{ fontWeight: 650, fontSize: '0.95rem', lineHeight: 1.2 }}>
            {performer.name}
          </Typography>
          <Typography sx={{ color: 'var(--dim)', fontSize: '0.75rem' }}>
            {loading ? 'Loading…' : `${items.length} ${isVideo ? 'videos' : 'photos'}`}
          </Typography>
        </Box>
      </Box>

      <Box sx={{ display: 'flex', gap: 1, px: 1.5, py: 1, flexShrink: 0 }}>
        {TABS.map((t) => (
          <Button
            key={t.key}
            onClick={() => setTab(t.key)}
            size="small"
            sx={{
              flex: 1, minHeight: 40, textTransform: 'none', fontWeight: 650,
              borderRadius: 'var(--radius, 6px)',
              bgcolor: tab === t.key ? 'var(--accent)' : 'transparent',
              color: tab === t.key ? 'var(--on-accent)' : 'var(--dim)',
              border: '1px solid',
              borderColor: tab === t.key ? 'var(--accent)' : 'var(--line)'
            }}
          >
            {t.label}
          </Button>
        ))}
      </Box>

      {/* Grid */}
      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
        {loading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
            <CircularProgress size={32} />
          </Box>
        )}

        {!loading && items.length === 0 && (
          <Box sx={{ textAlign: 'center', py: 8, px: 3, color: 'var(--dim)' }}>
            <Typography sx={{ fontWeight: 650, mb: 0.5 }}>Nothing here</Typography>
            <Typography sx={{ fontSize: '0.85rem' }}>
              No {isVideo ? 'videos' : 'photos'} for {performer.name}.
            </Typography>
          </Box>
        )}

        {!loading && items.length > 0 && (
          <Box sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: '2px', p: '2px'
          }}>
            {items.map((item, i) => (
              <Box
                key={item.path}
                onClick={() => setViewerIndex(i)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter') setViewerIndex(i); }}
                sx={{
                  position: 'relative', aspectRatio: '1 / 1',
                  bgcolor: 'var(--raised)', overflow: 'hidden', cursor: 'pointer',
                  '&:active': { opacity: 0.7 }
                }}
              >
                {isVideo ? (
                  // preload="metadata" paints the first frame — cheap enough
                  // for a grid and avoids inventing a poster endpoint.
                  <video
                    src={rawUrl(item.path)}
                    preload="metadata"
                    muted
                    playsInline
                    style={{ width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }}
                  />
                ) : (
                  <img
                    src={previewUrl(item.path)}
                    alt={item.name}
                    loading="lazy"
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                )}
                {isVideo && (
                  <PlayCircle sx={{
                    position: 'absolute', right: 4, bottom: 4,
                    fontSize: 20, color: 'rgba(255,255,255,0.9)',
                    filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.6))'
                  }} />
                )}
              </Box>
            ))}
          </Box>
        )}
      </Box>

      {/* Fullscreen viewer */}
      {viewing && (
        <Box
          sx={{
            position: 'fixed', inset: 0, zIndex: 1500,
            bgcolor: '#000', display: 'flex', flexDirection: 'column'
          }}
          onTouchStart={(e) => { startX.current = e.touches[0].clientX; }}
          onTouchEnd={(e) => {
            const dx = e.changedTouches[0].clientX - startX.current;
            if (Math.abs(dx) > 60) step(dx > 0 ? -1 : 1);
          }}
        >
          <Box sx={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            px: 1, py: 0.5, flexShrink: 0,
            paddingTop: 'calc(env(safe-area-inset-top) + 4px)'
          }}>
            <IconButton onClick={close} aria-label="Close viewer" sx={{ color: '#fff' }}>
              <Close />
            </IconButton>
            <Typography sx={{ color: 'rgba(255,255,255,0.75)', fontSize: '0.8rem' }}>
              {viewerIndex + 1} / {items.length}
            </Typography>
            <Box sx={{ width: 40 }} />
          </Box>

          <Box sx={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
            {isVideo ? (
              <video
                key={viewing.path}
                src={rawUrl(viewing.path)}
                controls
                autoPlay
                playsInline
                style={{ maxWidth: '100%', maxHeight: '100%' }}
              />
            ) : (
              <img
                key={viewing.path}
                src={rawUrl(viewing.path)}
                alt={viewing.name}
                style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
              />
            )}

            {/* Tap targets as well as swipe — swiping a <video> is unreliable
                because the native controls claim the gesture. */}
            <IconButton
              onClick={() => step(-1)}
              disabled={viewerIndex === 0}
              aria-label="Previous"
              sx={{ position: 'absolute', left: 4, color: '#fff', bgcolor: 'rgba(0,0,0,0.35)', '&.Mui-disabled': { opacity: 0.25, color: '#fff' } }}
            >
              <ChevronLeft />
            </IconButton>
            <IconButton
              onClick={() => step(1)}
              disabled={viewerIndex >= items.length - 1}
              aria-label="Next"
              sx={{ position: 'absolute', right: 4, color: '#fff', bgcolor: 'rgba(0,0,0,0.35)', '&.Mui-disabled': { opacity: 0.25, color: '#fff' } }}
            >
              <ChevronRight />
            </IconButton>
          </Box>

          <Typography noWrap sx={{
            color: 'rgba(255,255,255,0.6)', fontSize: '0.72rem',
            px: 2, py: 1, flexShrink: 0, textAlign: 'center'
          }}>
            {viewing.name}
          </Typography>
        </Box>
      )}
    </Box>
  );
}

export default MobileGallery;
