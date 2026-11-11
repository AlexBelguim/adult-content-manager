import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Box, ButtonBase, Dialog, Tooltip, useMediaQuery } from '@mui/material';
import {
  Close as CloseIcon,
  Collections as PhotoWallIcon,
  AutoAwesome as MomentsIcon,
  GridView as MosaicIcon,
  Slideshow as SpotlightIcon,
  ViewInAr as Cards3DIcon,
} from '@mui/icons-material';

import PhotoWallMode from './PhotoWallMode';
import MomentsMode from './MomentsMode';
import MosaicDriftMode from './MosaicDriftMode';
import SpotlightCarouselMode from './SpotlightCarouselMode';
import FloatingCards3DMode from './FloatingCards3DMode';
import ModeErrorBoundary from './ModeErrorBoundary';

const MODES = [
  { id: 'wall', label: 'Scrapbook wall', icon: PhotoWallIcon, Component: PhotoWallMode },
  { id: 'moments', label: 'Moments', icon: MomentsIcon, Component: MomentsMode },
  { id: 'mosaic', label: 'Mosaic drift', icon: MosaicIcon, Component: MosaicDriftMode },
  { id: 'spotlight', label: 'Spotlight', icon: SpotlightIcon, Component: SpotlightCarouselMode },
  { id: 'cards3d', label: 'Floating cards', icon: Cards3DIcon, Component: FloatingCards3DMode },
];

const STORAGE_KEY = 'galleryFullscreenMode';
const DEFAULT_MODE = 'spotlight';
const IDLE_MS = 3500;
const WAKE_EVENTS = ['mousemove', 'keydown', 'pointerdown', 'touchstart'];

const readStoredMode = () => {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return MODES.some((m) => m.id === v) ? v : DEFAULT_MODE;
  } catch {
    return DEFAULT_MODE;
  }
};

const btnBaseSx = {
  height: 36,
  px: 1.25,
  gap: 0.75,
  display: 'inline-flex',
  alignItems: 'center',
  borderRadius: 'var(--radius, 6px)',
  fontSize: '.8rem',
  fontWeight: 560,
  whiteSpace: 'nowrap',
  flexShrink: 0,
  '&.Mui-focusVisible, &:focus-visible': { outline: '2px solid var(--accent)', outlineOffset: 2 },
};

export default function FullscreenGalleryDialog({ open, onClose, performers, onPhotoClick }) {
  const [modeId, setModeId] = useState(readStoredMode);
  const [idle, setIdle] = useState(false);
  const [labelKey, setLabelKey] = useState(0);
  // The performers are a snapshot taken when the dialog opens, so a live
  // list change (socket reload, rating) never restarts the running view.
  // It is taken during the render that opens the dialog (not in an effect),
  // so the first mounted view already has the list and shows no empty state.
  const [pool, setPool] = useState([]);
  const [snapOpen, setSnapOpen] = useState(false);
  if (open !== snapOpen) {
    setSnapOpen(open);
    if (open) setPool(Array.isArray(performers) ? performers : []);
  }
  const wide = useMediaQuery('(min-width:760px)');

  useEffect(() => {
    if (!open) return;
    try { localStorage.setItem(STORAGE_KEY, modeId); } catch { /* storage blocked */ }
  }, [modeId, open]);

  // Dim the control bar after a while with no input. It stays clickable.
  useEffect(() => {
    if (!open) return undefined;
    let t;
    const wake = () => {
      setIdle(false);
      clearTimeout(t);
      t = setTimeout(() => setIdle(true), IDLE_MS);
    };
    wake();
    WAKE_EVENTS.forEach((ev) => window.addEventListener(ev, wake, { passive: true }));
    return () => {
      clearTimeout(t);
      WAKE_EVENTS.forEach((ev) => window.removeEventListener(ev, wake));
    };
  }, [open]);

  // Browser fullscreen while open. The cleanup runs on close and on unmount (a photo click navigates away while
  // open), so the browser always leaves fullscreen with the dialog. onClose is read through a ref: a new onClose
  // must not leave and re-enter fullscreen.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!open) return undefined;
    if (document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(() => {});
    }
    const onChange = () => {
      if (!document.fullscreenElement) onCloseRef.current?.();
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      if (document.fullscreenElement && document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      }
    };
  }, [open]);

  const handleSetMode = useCallback((id) => {
    setModeId(id);
    setLabelKey((k) => k + 1);
  }, []);

  // Keys: 1-5 pick a view, [ and ] cycle. The arrows belong to Spotlight.
  useEffect(() => {
    if (!open) return undefined;
    const step = (delta) => {
      setModeId((m) => {
        const i = MODES.findIndex((mm) => mm.id === m);
        return MODES[(i + delta + MODES.length) % MODES.length].id;
      });
      setLabelKey((k) => k + 1);
    };
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const n = /^[1-9]$/.test(e.key) ? Number(e.key) : 0;
      if (n >= 1 && n <= MODES.length) {
        handleSetMode(MODES[n - 1].id);
      } else if (e.key === ']') {
        step(1);
      } else if (e.key === '[') {
        step(-1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, handleSetMode]);

  const activeMode = MODES.find((m) => m.id === modeId) || MODES[0];
  const Active = activeMode.Component;

  return (
    <Dialog
      fullScreen
      open={open}
      onClose={onClose}
      sx={{
        '& .MuiDialog-paper': { backgroundColor: 'var(--bg)', overflow: 'hidden' },
      }}
    >
      <Box
        sx={{
          width: '100vw',
          height: '100vh',
          position: 'relative',
          overflow: 'hidden',
          backgroundColor: 'var(--bg)',
        }}
      >
        {/* Only the active view is mounted */}
        <ModeErrorBoundary resetKey={activeMode.id}>
          <Active
            key={activeMode.id}
            active
            performers={pool}
            onPhotoClick={onPhotoClick}
          />
        </ModeErrorBoundary>

        {/* One control bar: the views, then Close */}
        <Box
          role="toolbar"
          aria-label="Slideshow controls"
          sx={{
            position: 'fixed',
            left: '50%',
            transform: 'translateX(-50%)',
            bottom: 'calc(16px + env(safe-area-inset-bottom, 0px))',
            zIndex: 2000,
            display: 'flex',
            alignItems: 'center',
            gap: 0.5,
            p: 0.5,
            maxWidth: 'calc(100vw - 32px)',
            overflowX: 'auto',
            bgcolor: 'var(--scrim-strong)',
            border: '1px solid var(--line-strong)',
            borderRadius: 'var(--radius-lg, 10px)',
            boxShadow: 'var(--shadow-md)',
            backdropFilter: 'blur(8px)',
            opacity: idle ? 0.35 : 1,
            transition: 'opacity .3s ease',
            '&:hover, &:focus-within': { opacity: 1 },
            '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
          }}
        >
          <Box role="radiogroup" aria-label="Slideshow view" sx={{ display: 'flex', gap: 0.5 }}>
            {MODES.map((m, i) => {
              const Icon = m.icon;
              const selected = m.id === activeMode.id;
              return (
                <Tooltip key={m.id} title={wide ? '' : `${m.label} · ${i + 1}`} placement="top">
                  <ButtonBase
                    role="radio"
                    aria-checked={selected}
                    aria-label={m.label}
                    onClick={() => handleSetMode(m.id)}
                    sx={{
                      ...btnBaseSx,
                      border: '1px solid',
                      ...(selected
                        ? { color: 'var(--accent)', bgcolor: 'var(--accent-quiet)', borderColor: 'var(--accent)' }
                        : {
                            color: 'var(--dim)',
                            borderColor: 'transparent',
                            '&:hover': { color: 'var(--text)', bgcolor: 'var(--raised)' },
                          }),
                    }}
                  >
                    <Icon sx={{ fontSize: 18 }} />
                    {wide && <span>{m.label}</span>}
                  </ButtonBase>
                </Tooltip>
              );
            })}
          </Box>

          <Box
            aria-hidden
            sx={{ width: '1px', height: 24, bgcolor: 'var(--line-strong)', flexShrink: 0, mx: 0.25 }}
          />

          <Tooltip title="Close (Esc)" placement="top">
            <ButtonBase
              onClick={onClose}
              aria-label="Close"
              sx={{
                ...btnBaseSx,
                color: 'var(--text)',
                '&:hover': { bgcolor: 'var(--raised)' },
              }}
            >
              <CloseIcon sx={{ fontSize: 18 }} />
              {wide && 'Close'}
            </ButtonBase>
          </Tooltip>
        </Box>

        {/* The view's name, flashed briefly when it changes */}
        <Box
          key={labelKey}
          aria-hidden
          sx={{
            position: 'fixed',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            zIndex: 1999,
            pointerEvents: 'none',
            userSelect: 'none',
            bgcolor: 'var(--scrim-strong)',
            border: '1px solid var(--line-strong)',
            borderRadius: 'var(--radius-lg, 10px)',
            px: 2.5,
            py: 1.25,
            color: 'var(--text)',
            fontSize: '1.5rem',
            fontWeight: 500,
            whiteSpace: 'nowrap',
            animation: 'modeLabelFade 1.6s ease forwards',
            '@keyframes modeLabelFade': {
              '0%': { opacity: 0, transform: 'translate(-50%, -50%) scale(0.92)' },
              '15%': { opacity: 1, transform: 'translate(-50%, -50%) scale(1)' },
              '70%': { opacity: 1, transform: 'translate(-50%, -50%) scale(1)' },
              '100%': { opacity: 0, transform: 'translate(-50%, -50%) scale(1.04)' },
            },
            '@keyframes modeLabelFadeOpacity': {
              '0%': { opacity: 0 },
              '15%': { opacity: 1 },
              '70%': { opacity: 1 },
              '100%': { opacity: 0 },
            },
            '@media (prefers-reduced-motion: reduce)': {
              animationName: 'modeLabelFadeOpacity',
            },
          }}
        >
          {activeMode.label}
        </Box>
      </Box>
    </Dialog>
  );
}
