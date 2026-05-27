import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Typography } from '@mui/material';
import { AnimatePresence, motion } from 'framer-motion';
import useGalleryImages, { imageUrlForPath } from './useGalleryImages';

/**
 * "Spotlight Carousel" — one big hero image cross-dissolving every few seconds.
 * Background is a heavily blurred, scaled-up copy of the same image for an
 * ambient cinematic feel. Side rail shows next/prev thumbnails.
 */
export default function SpotlightCarouselMode({ performers, onPhotoClick, active }) {
  const { items } = useGalleryImages(performers, { perPerformerMax: 5, active });
  const [idx, setIdx] = useState(0);
  const timerRef = useRef(null);
  const userInteractedRef = useRef(0);

  // Shuffle for a varied sequence
  const ordered = useMemo(() => {
    if (!items.length) return [];
    const arr = [...items];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }, [items]);

  useEffect(() => {
    if (!active || ordered.length === 0) return;
    const tick = () => {
      if (Date.now() > userInteractedRef.current) {
        setIdx((i) => (i + 1) % ordered.length);
      }
      timerRef.current = setTimeout(tick, 5200);
    };
    timerRef.current = setTimeout(tick, 4000);
    return () => clearTimeout(timerRef.current);
  }, [active, ordered.length]);

  if (!active || ordered.length === 0) {
    return (
      <Box sx={{ position: 'absolute', inset: 0, bgcolor: '#000' }} />
    );
  }

  const current = ordered[idx];
  const prev = ordered[(idx - 1 + ordered.length) % ordered.length];
  const next = ordered[(idx + 1) % ordered.length];

  const advance = (delta) => {
    userInteractedRef.current = Date.now() + 8000;
    setIdx((i) => (i + delta + ordered.length) % ordered.length);
  };

  return (
    <Box sx={{ position: 'absolute', inset: 0, overflow: 'hidden', background: '#000' }}>
      {/* Ambient blurred background (same image, blown up + blurred) */}
      <AnimatePresence>
        <motion.div
          key={`bg-${idx}`}
          initial={{ opacity: 0, scale: 1.08 }}
          animate={{ opacity: 0.6, scale: 1.15 }}
          exit={{ opacity: 0, scale: 1.2 }}
          transition={{ duration: 1.8, ease: 'easeInOut' }}
          style={{
            position: 'absolute',
            inset: '-8%',
            backgroundImage: `url(${imageUrlForPath(current.path)})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            filter: 'blur(50px) saturate(1.3) brightness(0.55)',
          }}
        />
      </AnimatePresence>

      {/* Dark vignette */}
      <Box
        sx={{
          position: 'absolute',
          inset: 0,
          background:
            'radial-gradient(ellipse at center, transparent 30%, rgba(0,0,0,0.55) 90%)',
        }}
      />

      {/* Hero image */}
      <Box
        sx={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <AnimatePresence mode="popLayout">
          <motion.div
            key={`hero-${idx}`}
            initial={{ opacity: 0, scale: 0.96, filter: 'blur(8px)' }}
            animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
            exit={{ opacity: 0, scale: 1.04, filter: 'blur(6px)' }}
            transition={{ duration: 1.2, ease: [0.22, 0.9, 0.3, 1] }}
            style={{
              position: 'relative',
              maxWidth: '70vw',
              maxHeight: '78vh',
              boxShadow: '0 30px 90px rgba(0,0,0,0.85), 0 0 0 1px rgba(255,255,255,0.08)',
              borderRadius: 6,
              overflow: 'hidden',
              cursor: 'pointer',
            }}
            onClick={() => onPhotoClick?.(current.performer)}
          >
            <motion.img
              src={imageUrlForPath(current.path)}
              alt={current.performer.name}
              draggable={false}
              initial={{ scale: 1.02 }}
              animate={{ scale: 1.08 }}
              transition={{ duration: 5.4, ease: 'linear' }}
              style={{
                display: 'block',
                maxWidth: '70vw',
                maxHeight: '78vh',
                objectFit: 'contain',
              }}
            />
            <Box
              sx={{
                position: 'absolute',
                bottom: 0,
                left: 0,
                right: 0,
                p: '24px 28px 22px',
                background: 'linear-gradient(to top, rgba(0,0,0,0.92) 0%, transparent 100%)',
                color: 'white',
              }}
            >
              <Typography sx={{ fontSize: 22, fontWeight: 600, letterSpacing: 0.4 }}>
                {current.performer.name}
              </Typography>
            </Box>
          </motion.div>
        </AnimatePresence>
      </Box>

      {/* Prev / Next previews */}
      <Box
        onClick={() => advance(-1)}
        sx={{
          position: 'absolute',
          left: 24,
          top: '50%',
          transform: 'translateY(-50%)',
          width: 110,
          height: 150,
          borderRadius: 1,
          overflow: 'hidden',
          opacity: 0.45,
          cursor: 'pointer',
          transition: 'opacity 0.25s, transform 0.25s',
          boxShadow: '0 8px 30px rgba(0,0,0,0.7)',
          '&:hover': { opacity: 0.85, transform: 'translateY(-50%) scale(1.04)' },
        }}
      >
        <img
          src={imageUrlForPath(prev.path)}
          alt=""
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      </Box>
      <Box
        onClick={() => advance(1)}
        sx={{
          position: 'absolute',
          right: 24,
          top: '50%',
          transform: 'translateY(-50%)',
          width: 110,
          height: 150,
          borderRadius: 1,
          overflow: 'hidden',
          opacity: 0.45,
          cursor: 'pointer',
          transition: 'opacity 0.25s, transform 0.25s',
          boxShadow: '0 8px 30px rgba(0,0,0,0.7)',
          '&:hover': { opacity: 0.85, transform: 'translateY(-50%) scale(1.04)' },
        }}
      >
        <img
          src={imageUrlForPath(next.path)}
          alt=""
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      </Box>

      {/* Progress dots */}
      <Box
        sx={{
          position: 'absolute',
          bottom: 18,
          left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex',
          gap: '6px',
          zIndex: 5,
        }}
      >
        {Array.from({ length: Math.min(ordered.length, 18) }).map((_, i) => (
          <Box
            key={i}
            sx={{
              width: i === idx % 18 ? 22 : 6,
              height: 6,
              borderRadius: 3,
              background:
                i === idx % 18 ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.3)',
              transition: 'width 0.4s, background 0.4s',
            }}
          />
        ))}
      </Box>
    </Box>
  );
}
