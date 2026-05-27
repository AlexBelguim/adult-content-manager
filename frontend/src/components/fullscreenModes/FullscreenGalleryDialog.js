import React, { useCallback, useEffect, useState } from 'react';
import { Box, Dialog, IconButton, Tooltip, Typography } from '@mui/material';
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

const MODES = [
  { id: 'wall', label: 'Scrapbook Wall', icon: PhotoWallIcon, Component: PhotoWallMode },
  { id: 'moments', label: 'Moments', icon: MomentsIcon, Component: MomentsMode },
  { id: 'mosaic', label: 'Mosaic Drift', icon: MosaicIcon, Component: MosaicDriftMode },
  { id: 'spotlight', label: 'Spotlight', icon: SpotlightIcon, Component: SpotlightCarouselMode },
  { id: 'cards3d', label: 'Floating Cards', icon: Cards3DIcon, Component: FloatingCards3DMode },
];

const STORAGE_KEY = 'galleryFullscreenMode';

export default function FullscreenGalleryDialog({ open, onClose, performers, onPhotoClick }) {
  const [modeId, setModeId] = useState(() => {
    return localStorage.getItem(STORAGE_KEY) || 'wall';
  });
  const [chromeVisible, setChromeVisible] = useState(true);
  const [labelKey, setLabelKey] = useState(0);

  useEffect(() => {
    if (open) localStorage.setItem(STORAGE_KEY, modeId);
  }, [modeId, open]);

  // Auto-hide the toolbar after inactivity so it doesn't distract
  useEffect(() => {
    if (!open) return;
    let t;
    const reveal = () => {
      setChromeVisible(true);
      clearTimeout(t);
      t = setTimeout(() => setChromeVisible(false), 3500);
    };
    reveal();
    window.addEventListener('mousemove', reveal);
    window.addEventListener('keydown', reveal);
    return () => {
      clearTimeout(t);
      window.removeEventListener('mousemove', reveal);
      window.removeEventListener('keydown', reveal);
    };
  }, [open]);

  // Browser fullscreen handling
  useEffect(() => {
    if (!open) {
      if (document.fullscreenElement && document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      }
      return;
    }
    if (document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(() => {});
    }
    const onChange = () => {
      if (!document.fullscreenElement) onClose?.();
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, [open, onClose]);

  // Keyboard shortcuts: 1-5 to switch modes, arrow keys to cycle
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= MODES.length) {
        setModeId(MODES[n - 1].id);
        setLabelKey((k) => k + 1);
      } else if (e.key === 'ArrowRight' || e.key === ']') {
        setModeId((m) => {
          const i = MODES.findIndex((mm) => mm.id === m);
          return MODES[(i + 1) % MODES.length].id;
        });
        setLabelKey((k) => k + 1);
      } else if (e.key === 'ArrowLeft' || e.key === '[') {
        setModeId((m) => {
          const i = MODES.findIndex((mm) => mm.id === m);
          return MODES[(i - 1 + MODES.length) % MODES.length].id;
        });
        setLabelKey((k) => k + 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const handleSetMode = useCallback((id) => {
    setModeId(id);
    setLabelKey((k) => k + 1);
  }, []);

  const activeMode = MODES.find((m) => m.id === modeId) || MODES[0];

  return (
    <Dialog
      fullScreen
      open={open}
      onClose={onClose}
      sx={{
        '& .MuiDialog-paper': { backgroundColor: '#0a0a0a', overflow: 'hidden' },
      }}
    >
      <Box
        sx={{
          width: '100vw',
          height: '100vh',
          position: 'relative',
          overflow: 'hidden',
          backgroundColor: '#000',
        }}
      >
        {/* Render only the active mode (mounted = animations running) */}
        {MODES.map((m) => (
          <m.Component
            key={m.id}
            active={m.id === modeId}
            performers={performers}
            onPhotoClick={onPhotoClick}
          />
        ))}

        {/* Top-right controls */}
        <Box
          sx={{
            position: 'fixed',
            top: 16,
            right: 16,
            display: 'flex',
            gap: 1,
            zIndex: 2000,
            opacity: chromeVisible ? 1 : 0,
            transition: 'opacity 0.45s ease',
            pointerEvents: chromeVisible ? 'auto' : 'none',
          }}
        >
          <IconButton
            onClick={onClose}
            sx={{
              color: 'white',
              backgroundColor: 'rgba(0,0,0,0.55)',
              backdropFilter: 'blur(8px)',
              '&:hover': { backgroundColor: 'rgba(0,0,0,0.75)' },
            }}
          >
            <CloseIcon />
          </IconButton>
        </Box>

        {/* Bottom-center mode switcher */}
        <Box
          sx={{
            position: 'fixed',
            bottom: 28,
            left: '50%',
            transform: chromeVisible ? 'translateX(-50%) translateY(0)' : 'translateX(-50%) translateY(20px)',
            display: 'flex',
            gap: '6px',
            padding: '8px 10px',
            borderRadius: '999px',
            backgroundColor: 'rgba(20, 20, 22, 0.7)',
            backdropFilter: 'blur(14px)',
            boxShadow: '0 12px 40px rgba(0,0,0,0.65), 0 0 0 1px rgba(255,255,255,0.06)',
            zIndex: 2000,
            opacity: chromeVisible ? 1 : 0,
            transition: 'opacity 0.45s ease, transform 0.45s ease',
            pointerEvents: chromeVisible ? 'auto' : 'none',
          }}
        >
          {MODES.map((m, i) => {
            const Icon = m.icon;
            const selected = m.id === modeId;
            return (
              <Tooltip
                key={m.id}
                title={`${m.label}  ·  ${i + 1}`}
                placement="top"
                arrow
              >
                <IconButton
                  onClick={() => handleSetMode(m.id)}
                  sx={{
                    color: selected ? '#fff' : 'rgba(255,255,255,0.6)',
                    background: selected
                      ? 'linear-gradient(135deg, rgba(124,77,255,0.85) 0%, rgba(0,229,255,0.85) 100%)'
                      : 'transparent',
                    boxShadow: selected ? '0 4px 16px rgba(124,77,255,0.45)' : 'none',
                    width: 42,
                    height: 42,
                    transition: 'all 0.25s ease',
                    '&:hover': {
                      color: '#fff',
                      backgroundColor: selected ? undefined : 'rgba(255,255,255,0.1)',
                    },
                  }}
                >
                  <Icon fontSize="small" />
                </IconButton>
              </Tooltip>
            );
          })}
        </Box>

        {/* Floating label for the active mode (briefly visible when switching) */}
        <Box
          key={labelKey}
          sx={{
            position: 'fixed',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            zIndex: 1999,
            pointerEvents: 'none',
            animation: 'modeLabelFade 1.6s ease forwards',
            '@keyframes modeLabelFade': {
              '0%': { opacity: 0, transform: 'translate(-50%, -50%) scale(0.92)' },
              '15%': { opacity: 1, transform: 'translate(-50%, -50%) scale(1)' },
              '70%': { opacity: 1, transform: 'translate(-50%, -50%) scale(1)' },
              '100%': { opacity: 0, transform: 'translate(-50%, -50%) scale(1.04)' },
            },
          }}
        >
          <Typography
            sx={{
              color: 'white',
              fontSize: 38,
              fontWeight: 300,
              letterSpacing: 2,
              textShadow: '0 4px 30px rgba(0,0,0,0.85)',
              userSelect: 'none',
            }}
          >
            {activeMode.label}
          </Typography>
        </Box>
      </Box>
    </Dialog>
  );
}
