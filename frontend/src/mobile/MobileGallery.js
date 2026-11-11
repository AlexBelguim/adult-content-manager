import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Box, Typography, IconButton, CircularProgress, Button, Portal } from '@mui/material';
import { ArrowBack, Close, PlayArrow, ChevronLeft, ChevronRight } from '@mui/icons-material';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useBack, canPop } from '../nav';

/**
 * MobileGallery — a performer's media on a phone, at /p/:performerId.
 *
 * The desktop unified gallery is a three-pane layout with a sidebar, filter
 * rail and hover-driven controls; none of that survives 390px. This is a
 * three-up square grid plus a fullscreen viewer you swipe through.
 *
 * The URL holds the state: ?tab=vids picks Videos (replace), ?view=<index>
 * is the viewer (a pushed entry marked { viewer: true }, so Back closes it).
 * PhoneLibrary places this in a layer above the list; it fills that layer.
 *
 * Props:
 *  - performerId: string from the route
 *  - performer: { id, name } when the list has it; fetched otherwise
 */

const TABS = [
  { key: 'pics', label: 'Photos' },
  { key: 'vids', label: 'Videos' }
];

const rawUrl = (p) => `/api/files/raw?path=${encodeURIComponent(p)}`;
const previewUrl = (p) => `/api/files/preview?path=${encodeURIComponent(p)}`;

async function readError(res) {
  try {
    const data = await res.json();
    if (data && data.error) return String(data.error);
  } catch (e) { /* not JSON */ }
  return `HTTP ${res.status}`;
}

const roundBtnSx = {
  width: 44, height: 44,
  bgcolor: 'var(--scrim-strong)', color: 'var(--text)', border: '1px solid var(--line-strong)',
  '&:hover': { bgcolor: 'var(--scrim-strong)' },
  '&.Mui-disabled': { opacity: 0.35, color: 'var(--text)', bgcolor: 'var(--scrim-strong)' }
};

function MobileGallery({ performerId, performer: given }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const back = useBack('/');

  const id = String(performerId ?? given?.id ?? '');
  const tab = searchParams.get('tab') === 'vids' ? 'vids' : 'pics';
  const isVideo = tab === 'vids';
  const viewParam = searchParams.get('view');
  const viewerIndex = viewParam != null && /^\d+$/.test(viewParam) ? Number(viewParam) : null;

  // The performer: from the list when it has one, else from the server.
  const [fetched, setFetched] = useState(null); // { id, data } | { id, error }
  const performer = given && String(given.id) === id ? given : (fetched?.id === id ? fetched.data : null);
  const performerError = !performer && fetched?.id === id ? fetched.error : null;
  const name = performer?.name || '';

  useEffect(() => {
    if (!id || (given && String(given.id) === id)) return undefined;
    const ctrl = new AbortController();
    fetch(`/api/performers/${encodeURIComponent(id)}`, { signal: ctrl.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(await readError(res));
        return res.json();
      })
      .then((data) => setFetched({ id, data }))
      .catch((err) => { if (err.name !== 'AbortError') setFetched({ id, error: err.message }); });
    return () => ctrl.abort();
  }, [id, given]);

  // The media of the open tab.
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!id) return undefined;
    const ctrl = new AbortController();
    setLoading(true);
    setLoadError('');
    const endpoint = `/api/performers/${encodeURIComponent(id)}/gallery/${isVideo ? 'videos' : 'images'}`;
    fetch(endpoint, { signal: ctrl.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(await readError(res));
        return res.json();
      })
      .then((data) => {
        setItems(isVideo ? (data?.vids || []) : (data?.pics || []));
        setLoading(false);
      })
      .catch((err) => {
        if (err.name === 'AbortError') return;
        setItems([]);
        setLoadError(err instanceof TypeError ? "Can't reach the server. Check Tailscale is connected." : err.message);
        setLoading(false);
      });
    return () => ctrl.abort();
  }, [id, isVideo, attempt]);

  /* ── URL state ── */
  const paramsWith = useCallback((changes) => {
    const next = new URLSearchParams(searchParams);
    Object.entries(changes).forEach(([k, v]) => {
      if (v == null) next.delete(k); else next.set(k, String(v));
    });
    return next;
  }, [searchParams]);

  const setTab = (key) => {
    if (key === tab) return;
    setSearchParams(paramsWith({ tab: key === 'vids' ? 'vids' : null, view: null }), { replace: true });
  };

  const open = (i) => {
    setSearchParams(paramsWith({ view: i }), { state: { ...(location.state || {}), viewer: true } });
  };

  // Pops when the viewer's own entry is the current one, else replaces without ?view.
  const close = useCallback(() => {
    const state = location.state || {};
    if (state.viewer && canPop(location)) { navigate(-1); return; }
    const { viewer, ...rest } = state;
    setSearchParams(paramsWith({ view: null }), { replace: true, state: Object.keys(rest).length ? rest : null });
  }, [location, navigate, paramsWith, setSearchParams]);

  const step = useCallback((delta) => {
    if (viewerIndex == null) return;
    const next = viewerIndex + delta;
    if (next < 0 || next >= items.length) return;
    setSearchParams(paramsWith({ view: next }), { replace: true, state: location.state });
  }, [viewerIndex, items.length, paramsWith, setSearchParams, location.state]);

  // An index the list cannot honour (a stale link, files moved): clamp it, or close when there is nothing.
  useEffect(() => {
    if (loading || viewParam == null) return;
    if (viewerIndex == null || items.length === 0) { close(); return; }
    if (viewerIndex >= items.length) {
      setSearchParams(paramsWith({ view: items.length - 1 }), { replace: true, state: location.state });
    }
  }, [loading, viewParam, viewerIndex, items.length, close, paramsWith, setSearchParams, location.state]);

  const viewing = viewerIndex != null && !loading ? items[viewerIndex] : null;

  // Arrow keys help when this is open on a tablet with a keyboard attached.
  useEffect(() => {
    if (!viewing) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') close();
      if (e.key === 'ArrowLeft') step(-1);
      if (e.key === 'ArrowRight') step(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [viewing, close, step]);

  const startX = useRef(0);
  const noun = isVideo ? 'videos' : 'photos';

  return (
    <Box sx={{
      height: '100%', bgcolor: 'var(--bg)', color: 'var(--text)',
      display: 'flex', flexDirection: 'column', overflow: 'hidden'
    }}>
      {/* Header */}
      <Box sx={{
        display: 'flex', alignItems: 'center', gap: 0.5, px: 0.5, flexShrink: 0,
        paddingTop: 'env(safe-area-inset-top)', minHeight: 48,
        borderBottom: '1px solid var(--line)'
      }}>
        <IconButton onClick={back} aria-label="Back" sx={{ width: 40, height: 40, color: 'var(--text)' }}>
          <ArrowBack sx={{ fontSize: 20 }} />
        </IconButton>
        <Box sx={{ minWidth: 0, flex: 1, py: 0.5 }}>
          <Typography component="h1" noWrap sx={{ fontWeight: 600, fontSize: 15, lineHeight: 1.2 }}>
            {name || (performerError ? 'Performer' : ' ')}
          </Typography>
          <Typography sx={{ color: 'var(--dim)', fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
            {loading ? 'Loading…' : loadError ? ' ' : `${items.length} ${noun}`}
          </Typography>
        </Box>
      </Box>

      <Box sx={{ display: 'flex', gap: 1, px: 1.5, py: 1, flexShrink: 0 }} role="tablist" aria-label="Media">
        {TABS.map((t) => (
          <Button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            size="small"
            sx={{
              flex: 1, minHeight: 40, textTransform: 'none', fontWeight: 600, fontSize: 14,
              borderRadius: 'var(--radius)',
              bgcolor: tab === t.key ? 'var(--accent)' : 'transparent',
              color: tab === t.key ? 'var(--on-accent)' : 'var(--dim)',
              border: '1px solid',
              borderColor: tab === t.key ? 'var(--accent)' : 'var(--line)',
              '&:hover': { bgcolor: tab === t.key ? 'var(--accent)' : 'var(--raised)' }
            }}
          >
            {t.label}
          </Button>
        ))}
      </Box>

      {/* Grid */}
      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain' }}>
        {loading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
            <CircularProgress size={32} />
          </Box>
        )}

        {!loading && loadError && (
          <Box sx={{ textAlign: 'center', py: 8, px: 3 }}>
            <Typography sx={{ fontSize: 14, color: 'var(--bad)', mb: 0.5 }}>
              {name ? `Could not load ${name}'s ${noun}` : `Could not load the ${noun}`}
            </Typography>
            <Typography sx={{ fontSize: 12, color: 'var(--dim)', mb: 2, overflowWrap: 'anywhere' }}>{loadError}</Typography>
            <Button variant="outlined" onClick={() => setAttempt((n) => n + 1)} sx={{ textTransform: 'none', minHeight: 40 }}>
              Try again
            </Button>
          </Box>
        )}

        {!loading && !loadError && items.length === 0 && (
          <Box sx={{ textAlign: 'center', py: 8, px: 3 }}>
            <Typography sx={{ fontSize: 14, color: 'var(--dim)' }}>
              No {noun}{name ? ` for ${name}` : ''}
            </Typography>
          </Box>
        )}

        {!loading && !loadError && items.length > 0 && (
          <Box sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
            gap: '2px', p: '2px'
          }}>
            {items.map((item, i) => (
              <Box
                key={item.path}
                onClick={() => open(i)}
                role="button"
                tabIndex={0}
                aria-label={item.name}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(i); }
                }}
                sx={{
                  position: 'relative', aspectRatio: '1 / 1',
                  bgcolor: 'var(--raised)', overflow: 'hidden', cursor: 'pointer',
                  '&:active': { opacity: 0.7 },
                  '&:focus-visible': { outline: '2px solid var(--accent)', outlineOffset: -2 }
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
                    alt=""
                    loading="lazy"
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                )}
                {isVideo && (
                  <Box sx={{
                    position: 'absolute', right: 4, bottom: 4,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    width: 22, height: 22, borderRadius: 'var(--radius-sm)',
                    bgcolor: 'var(--scrim-strong)', color: 'var(--text)'
                  }}>
                    <PlayArrow sx={{ fontSize: 16 }} />
                  </Box>
                )}
              </Box>
            ))}
          </Box>
        )}
      </Box>

      {/* Fullscreen viewer. In a portal: this gallery sits in a layer below the bottom navigation, and the
          viewer has to cover everything. */}
      {viewing && (
        <Portal>
          <Box
            role="dialog"
            aria-modal="true"
            aria-label={viewing.name}
            sx={{
              position: 'fixed', inset: 0, zIndex: 1200,
              bgcolor: 'var(--bg)', color: 'var(--text)', display: 'flex', flexDirection: 'column',
              paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)'
            }}
            onTouchStart={(e) => { startX.current = e.touches[0].clientX; }}
            onTouchEnd={(e) => {
              const dx = e.changedTouches[0].clientX - startX.current;
              if (Math.abs(dx) > 60) step(dx > 0 ? -1 : 1);
            }}
          >
            <Box sx={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              px: 1, py: 0.5, flexShrink: 0
            }}>
              <IconButton onClick={close} aria-label="Close" sx={roundBtnSx}>
                <Close sx={{ fontSize: 20 }} />
              </IconButton>
              <Typography sx={{ color: 'var(--dim)', fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
                {viewerIndex + 1} / {items.length}
              </Typography>
              <Box sx={{ width: 44 }} />
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
                sx={{ ...roundBtnSx, position: 'absolute', left: 8 }}
              >
                <ChevronLeft />
              </IconButton>
              <IconButton
                onClick={() => step(1)}
                disabled={viewerIndex >= items.length - 1}
                aria-label="Next"
                sx={{ ...roundBtnSx, position: 'absolute', right: 8 }}
              >
                <ChevronRight />
              </IconButton>
            </Box>

            <Typography noWrap sx={{
              color: 'var(--dim)', fontSize: 12,
              px: 2, py: 1, flexShrink: 0, textAlign: 'center'
            }}>
              {viewing.name}
            </Typography>
          </Box>
        </Portal>
      )}
    </Box>
  );
}

export default MobileGallery;
