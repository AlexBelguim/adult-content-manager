import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box } from '@mui/material';
import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion';
import useGalleryImages, { imageUrlForPath } from './useGalleryImages';

/**
 * "Moments" — motionin.design-style cinematic exploration.
 *
 * Photos are scattered across a canvas LARGER than the viewport (~1.8× in
 * each direction). A "camera" smoothly pans around the canvas via spring
 * physics, drifting from photo to photo as if we're touring a gallery wall.
 * An animated cursor (white ring + dot, with a soft glow) lands on whatever
 * photo the camera is currently visiting, and that photo scales up + brightens
 * with a "Moment / <name>" caption.
 *
 * Every ~4.5s a new photo is chosen — we prefer one that's distant from the
 * current focus so each camera move has real travel. Move your real mouse and
 * you take over for ~2.4s before the tour resumes.
 */
export default function MomentsMode({ performers, onPhotoClick, active }) {
  const { items } = useGalleryImages(performers, { perPerformerMax: 6, active });
  const containerRef = useRef(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [featuredIdx, setFeaturedIdx] = useState(0);
  const userControlRef = useRef({ until: 0 });

  // --- Camera: stored in canvas pixels (top-left of viewport within canvas) ---
  const cameraX = useMotionValue(0);
  const cameraY = useMotionValue(0);
  const cameraSpringX = useSpring(cameraX, { stiffness: 22, damping: 24, mass: 1.7 });
  const cameraSpringY = useSpring(cameraY, { stiffness: 22, damping: 24, mass: 1.7 });
  // Canvas div translates by -camera so contents at (camX,camY) appear at (0,0)
  const canvasOffsetX = useTransform(cameraSpringX, (v) => -v);
  const canvasOffsetY = useTransform(cameraSpringY, (v) => -v);

  // --- Cursor: stored in SCREEN pixels (viewport-relative) ---
  const cursorTargetX = useMotionValue(0);
  const cursorTargetY = useMotionValue(0);
  const cursorSpringX = useSpring(cursorTargetX, { stiffness: 55, damping: 18, mass: 1.2 });
  const cursorSpringY = useSpring(cursorTargetY, { stiffness: 55, damping: 18, mass: 1.2 });

  // Track viewport size. Crucially: re-run when active flips, otherwise the
  // ResizeObserver never attaches because the ref is null on first mount when
  // the mode was inactive (this is what caused "have to close & reopen").
  useEffect(() => {
    if (!active) return;
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      setSize({ w: r.width, h: r.height });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [active]);

  // Canvas dimensions — bigger than viewport so we have room to pan
  const CANVAS_MULT = 1.8;
  const canvasW = size.w * CANVAS_MULT;
  const canvasH = size.h * CANVAS_MULT;

  // Scatter photos across the canvas with non-overlapping placement
  const layout = useMemo(() => {
    if (!canvasW || !canvasH || items.length === 0) return [];
    const baseSide = Math.max(190, Math.min(size.w, size.h) / 4.2);
    const margin = 90;
    const spacing = 50;
    const placed = [];
    const pool = [...items];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    for (const item of pool) {
      // Random aspect ratio: portrait, landscape, or square
      const aspectRoll = Math.random();
      let w, h;
      if (aspectRoll < 0.35) { w = baseSide; h = Math.round(baseSide * 1.35); }
      else if (aspectRoll < 0.7) { w = Math.round(baseSide * 1.3); h = baseSide; }
      else { w = baseSide; h = baseSide; }
      const jit = 0.85 + Math.random() * 0.5;
      w = Math.round(w * jit);
      h = Math.round(h * jit);

      let pos = null;
      for (let attempt = 0; attempt < 90; attempt++) {
        const x = margin + Math.random() * (canvasW - w - margin * 2);
        const y = margin + Math.random() * (canvasH - h - margin * 2);
        let ok = true;
        for (const o of placed) {
          if (x + w + spacing < o.x) continue;
          if (o.x + o.w + spacing < x) continue;
          if (y + h + spacing < o.y) continue;
          if (o.y + o.h + spacing < y) continue;
          ok = false; break;
        }
        if (ok) { pos = { x, y, w, h, item }; break; }
      }
      if (pos) placed.push(pos);
      if (placed.length >= 38) break;
    }
    return placed;
  }, [canvasW, canvasH, items, size.w, size.h]);

  // Auto-tour: pick a new focus every 4.5s, preferring a distant photo so
  // each camera move is dramatic.
  useEffect(() => {
    if (!active || layout.length === 0) return;
    const tick = () => {
      if (Date.now() < userControlRef.current.until) return;
      setFeaturedIdx((prev) => {
        if (layout.length <= 1) return prev;
        const cur = layout[prev];
        const curCx = cur.x + cur.w / 2;
        const curCy = cur.y + cur.h / 2;
        // Prefer candidates at least ~30% of canvas diag away
        const minDist = Math.min(canvasW, canvasH) * 0.3;
        const far = [];
        for (let i = 0; i < layout.length; i++) {
          if (i === prev) continue;
          const p = layout[i];
          const dx = (p.x + p.w / 2) - curCx;
          const dy = (p.y + p.h / 2) - curCy;
          if (Math.hypot(dx, dy) > minDist) far.push(i);
        }
        if (far.length > 0) return far[Math.floor(Math.random() * far.length)];
        // Fallback: any different photo
        let next = prev;
        while (next === prev) next = Math.floor(Math.random() * layout.length);
        return next;
      });
    };
    const t = setInterval(tick, 4500);
    const init = setTimeout(tick, 1800); // first move ~1.8s after mount
    return () => {
      clearInterval(t);
      clearTimeout(init);
    };
  }, [active, layout.length, canvasW, canvasH]);

  // When the featured photo changes, retarget camera + cursor
  useEffect(() => {
    if (!layout[featuredIdx] || !size.w) return;
    const p = layout[featuredIdx];
    const photoCenterX = p.x + p.w / 2;
    const photoCenterY = p.y + p.h / 2;
    // Camera: center the photo in the viewport, clamped to canvas bounds
    const camX = Math.max(0, Math.min(canvasW - size.w, photoCenterX - size.w / 2));
    const camY = Math.max(0, Math.min(canvasH - size.h, photoCenterY - size.h / 2));
    cameraX.set(camX);
    cameraY.set(camY);
    // Cursor: photo's eventual screen position + small jitter inside the photo
    const csx = photoCenterX - camX;
    const csy = photoCenterY - camY;
    const jx = (Math.random() - 0.5) * Math.min(80, p.w * 0.3);
    const jy = (Math.random() - 0.5) * Math.min(80, p.h * 0.3);
    cursorTargetX.set(csx + jx);
    cursorTargetY.set(csy + jy);
  }, [featuredIdx, layout, canvasW, canvasH, size.w, size.h, cameraX, cameraY, cursorTargetX, cursorTargetY]);

  // Real-mouse override: cursor follows pointer, auto-tour pauses briefly
  const handlePointerMove = (e) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    cursorTargetX.set(e.clientX - rect.left);
    cursorTargetY.set(e.clientY - rect.top);
    userControlRef.current.until = Date.now() + 2400;
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
        background: 'radial-gradient(ellipse at center, #0c0c12 0%, #050507 80%)',
        cursor: 'none',
      }}
    >
      {/* The big pannable canvas */}
      <motion.div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: canvasW,
          height: canvasH,
          x: canvasOffsetX,
          y: canvasOffsetY,
          willChange: 'transform',
        }}
      >
        {layout.map((p, i) => {
          const isFeatured = i === featuredIdx;
          return (
            <motion.div
              key={`${p.item.performer.id}-${p.item.path}-${i}`}
              onClick={() => onPhotoClick?.(p.item.performer)}
              animate={{
                scale: isFeatured ? 1.4 : 1,
                opacity: isFeatured ? 1 : 0.72,
                filter: isFeatured ? 'blur(0px) saturate(1.05)' : 'blur(0.4px) saturate(0.9)',
              }}
              transition={{ duration: 1.0, ease: [0.22, 0.9, 0.3, 1] }}
              style={{
                position: 'absolute',
                left: p.x,
                top: p.y,
                width: p.w,
                height: p.h,
                borderRadius: 6,
                overflow: 'hidden',
                cursor: 'pointer',
                background: '#111',
                boxShadow: isFeatured
                  ? '0 30px 80px rgba(0,0,0,0.85), 0 0 0 1px rgba(255,255,255,0.15)'
                  : '0 6px 22px rgba(0,0,0,0.5)',
                zIndex: isFeatured ? 50 : 1,
                transformOrigin: 'center center',
              }}
            >
              <img
                src={imageUrlForPath(p.item.path)}
                alt={p.item.performer.name}
                loading="lazy"
                draggable={false}
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  display: 'block',
                  pointerEvents: 'none',
                }}
                onError={(e) => { e.target.style.display = 'none'; }}
              />
              {isFeatured && (
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.45, duration: 0.5 }}
                  style={{
                    position: 'absolute',
                    bottom: 0,
                    left: 0,
                    right: 0,
                    padding: '22px 22px 18px',
                    background: 'linear-gradient(to top, rgba(0,0,0,0.88) 0%, transparent 100%)',
                    color: 'white',
                    pointerEvents: 'none',
                  }}
                >
                  <div style={{
                    fontSize: 10,
                    letterSpacing: 3,
                    textTransform: 'uppercase',
                    opacity: 0.65,
                    marginBottom: 5,
                  }}>
                    Moment
                  </div>
                  <div style={{ fontSize: 19, fontWeight: 500, lineHeight: 1.2 }}>
                    {p.item.performer.name}
                  </div>
                </motion.div>
              )}
            </motion.div>
          );
        })}
      </motion.div>

      {/* Animated cursor (overlaid in viewport space) */}
      <motion.div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          x: cursorSpringX,
          y: cursorSpringY,
          pointerEvents: 'none',
          zIndex: 1000,
          translateX: '-50%',
          translateY: '-50%',
          mixBlendMode: 'screen',
        }}
      >
        <motion.div
          style={{
            width: 52,
            height: 52,
            borderRadius: '50%',
            border: '1.5px solid rgba(255, 255, 255, 0.9)',
            boxShadow: '0 0 30px 10px rgba(255,255,255,0.35)',
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
