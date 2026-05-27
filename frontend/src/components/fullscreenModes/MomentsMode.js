import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box } from '@mui/material';
import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion';
import useGalleryImages, { imageUrlForPath } from './useGalleryImages';

/**
 * "Moments" — motionin.design style guided tour.
 *
 * A custom animated cursor with a soft glow drifts from photo to photo on a
 * cinematic spring. The photo currently under the cursor scales up, brightens
 * and lifts to the front; other photos dim. Auto-advances every few seconds.
 *
 * The user can also move their real mouse — if they move, the cursor follows
 * pointer and the auto-tour pauses briefly.
 */
export default function MomentsMode({ performers, onPhotoClick, active }) {
  const { items } = useGalleryImages(performers, { perPerformerMax: 3, active });
  const containerRef = useRef(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [focusIdx, setFocusIdx] = useState(0);
  const autoTimerRef = useRef(null);
  const userControlRef = useRef({ until: 0 });

  // Spring-driven cursor position
  const cursorX = useMotionValue(0);
  const cursorY = useMotionValue(0);
  const springX = useSpring(cursorX, { stiffness: 60, damping: 18, mass: 1.4 });
  const springY = useSpring(cursorY, { stiffness: 60, damping: 18, mass: 1.4 });
  // Glow intensity grows with the distance the spring still needs to travel
  const glow = useTransform([springX, springY, cursorX, cursorY], ([sx, sy, tx, ty]) => {
    const dx = tx - sx, dy = ty - sy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    return Math.min(40, 18 + dist * 0.04);
  });
  const boxShadow = useTransform(
    glow,
    (v) => `0 0 ${v}px ${v / 2}px rgba(255,255,255,0.45)`
  );

  // Sample a stable sub-pool so the layout doesn't reshuffle on every render
  const pool = useMemo(() => {
    if (!items.length) return [];
    const arr = [...items];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr.slice(0, 28);
  }, [items]);

  // Generate a non-overlapping scattered layout
  const layout = useMemo(() => {
    if (!size.w || !size.h || pool.length === 0) return [];
    const placed = [];
    const margin = 40;
    const minSide = Math.min(size.w, size.h);
    const baseSize = Math.max(140, Math.floor(minSide / 5));
    for (const item of pool) {
      // Random aspect: portrait/landscape/square
      const aspectRoll = Math.random();
      let w, h;
      if (aspectRoll < 0.4) { w = baseSize; h = Math.round(baseSize * 1.35); }
      else if (aspectRoll < 0.75) { w = Math.round(baseSize * 1.25); h = baseSize; }
      else { w = baseSize; h = baseSize; }
      const sizeJitter = 0.75 + Math.random() * 0.55;
      w = Math.round(w * sizeJitter);
      h = Math.round(h * sizeJitter);

      // Try to find non-overlapping position
      let pos = null;
      for (let attempt = 0; attempt < 60; attempt++) {
        const x = margin + Math.random() * (size.w - w - margin * 2);
        const y = margin + Math.random() * (size.h - h - margin * 2);
        const rect = { x, y, w, h };
        let ok = true;
        for (const other of placed) {
          if (x + w + 12 < other.x) continue;
          if (other.x + other.w + 12 < x) continue;
          if (y + h + 12 < other.y) continue;
          if (other.y + other.h + 12 < y) continue;
          ok = false;
          break;
        }
        if (ok) { pos = rect; break; }
      }
      if (!pos) continue;
      placed.push({ ...pos, item });
      if (placed.length >= 14) break;
    }
    return placed;
  }, [pool, size]);

  // Track container size
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      setSize({ w: rect.width, h: rect.height });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Auto-tour: advance focus every ~3.5s
  useEffect(() => {
    if (!active || layout.length === 0) return;
    const tick = () => {
      if (Date.now() > userControlRef.current.until) {
        setFocusIdx((i) => (i + 1) % layout.length);
      }
      autoTimerRef.current = setTimeout(tick, 3500);
    };
    autoTimerRef.current = setTimeout(tick, 2400);
    return () => clearTimeout(autoTimerRef.current);
  }, [active, layout.length]);

  // Move cursor to focused photo
  useEffect(() => {
    if (!layout[focusIdx]) return;
    const p = layout[focusIdx];
    // Aim at a soft offset inside the photo (not dead center, looks more natural)
    const cx = p.x + p.w * (0.4 + Math.random() * 0.2);
    const cy = p.y + p.h * (0.4 + Math.random() * 0.2);
    cursorX.set(cx);
    cursorY.set(cy);
  }, [focusIdx, layout, cursorX, cursorY]);

  // Allow user pointer to drive the cursor too
  const handlePointerMove = (e) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    cursorX.set(x);
    cursorY.set(y);
    userControlRef.current.until = Date.now() + 2200;

    // Find nearest photo under cursor and focus it
    let best = -1, bestD = Infinity;
    for (let i = 0; i < layout.length; i++) {
      const p = layout[i];
      const px = p.x + p.w / 2, py = p.y + p.h / 2;
      const d = (px - x) ** 2 + (py - y) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    }
    if (best !== -1) setFocusIdx(best);
  };

  if (!active) return null;

  return (
    <Box
      ref={containerRef}
      onPointerMove={handlePointerMove}
      sx={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        background: 'radial-gradient(ellipse at center, #14141a 0%, #06060a 80%)',
        cursor: 'none',
      }}
    >
      {layout.map((p, i) => {
        const isFocus = i === focusIdx;
        return (
          <motion.div
            key={`${p.item.performer.id}-${p.item.path}-${i}`}
            onClick={() => onPhotoClick?.(p.item.performer)}
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{
              opacity: isFocus ? 1 : 0.32,
              scale: isFocus ? 1.08 : 0.97,
              filter: isFocus ? 'blur(0px) saturate(1.1)' : 'blur(1.5px) saturate(0.85)',
            }}
            transition={{ duration: 0.7, ease: [0.22, 0.9, 0.3, 1] }}
            style={{
              position: 'absolute',
              left: p.x,
              top: p.y,
              width: p.w,
              height: p.h,
              borderRadius: 6,
              overflow: 'hidden',
              cursor: 'pointer',
              boxShadow: isFocus
                ? '0 30px 80px rgba(0,0,0,0.85), 0 0 0 1px rgba(255,255,255,0.15)'
                : '0 8px 24px rgba(0,0,0,0.55)',
              zIndex: isFocus ? 50 : 1,
              background: '#111',
            }}
          >
            <img
              src={imageUrlForPath(p.item.path)}
              alt={p.item.performer.name}
              loading="lazy"
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                display: 'block',
                pointerEvents: 'none',
              }}
            />
            {isFocus && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.25, duration: 0.5 }}
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  bottom: 0,
                  padding: '14px 16px 12px',
                  background: 'linear-gradient(to top, rgba(0,0,0,0.85), transparent)',
                  color: 'white',
                  fontSize: 15,
                  fontWeight: 500,
                  letterSpacing: 0.3,
                  textShadow: '0 2px 8px rgba(0,0,0,0.6)',
                }}
              >
                {p.item.performer.name}
              </motion.div>
            )}
          </motion.div>
        );
      })}

      {/* Animated cursor: outer glow ring + inner dot */}
      <motion.div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          x: springX,
          y: springY,
          pointerEvents: 'none',
          zIndex: 1000,
          translateX: '-50%',
          translateY: '-50%',
          mixBlendMode: 'screen',
        }}
      >
        <motion.div
          style={{
            width: 48,
            height: 48,
            borderRadius: '50%',
            border: '1.5px solid rgba(255, 255, 255, 0.85)',
            boxShadow,
          }}
          animate={{
            scale: [1, 1.18, 1],
            opacity: [0.9, 1, 0.9],
          }}
          transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
        />
        <Box
          sx={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: 'white',
            boxShadow: '0 0 12px 2px rgba(255,255,255,0.9)',
          }}
        />
      </motion.div>
    </Box>
  );
}
