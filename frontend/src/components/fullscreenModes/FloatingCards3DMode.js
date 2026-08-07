import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box } from '@mui/material';
import useGalleryImages, { imageUrlForPath } from './useGalleryImages';

/**
 * "Floating Cards 3D" — photos arranged on a slowly rotating cylinder seen in
 * perspective. Three vertical rows; cards counter-bob on individual phases.
 * Perspective is intentionally far (2200px) so the front cards don't balloon,
 * giving every card around the cylinder a roughly comparable on-screen size.
 */
export default function FloatingCards3DMode({ performers, onPhotoClick, active }) {
  const { items } = useGalleryImages(performers, { perPerformerMax: 4, active });
  const containerRef = useRef(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  // Re-run when active flips so the ResizeObserver attaches on activation
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

  const cards = useMemo(() => {
    if (!items.length || !size.w) return [];
    // More cards, in 3 stacked rows, for density
    const N = Math.min(items.length * 2, 60);
    const radius = Math.min(720, Math.max(520, size.w * 0.36));
    const pool = [...items];
    // Shuffle so adjacent cards aren't the same performer
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const out = [];
    const rowYs = [-220, 0, 220];
    for (let i = 0; i < N; i++) {
      const angle = (i / N) * 360;
      const row = i % 3;
      const baseY = rowYs[row];
      const yJitter = (Math.random() - 0.5) * 60;
      const w = 175 + (i % 4) * 12;     // 175..211
      const h = Math.round(w * (1.18 + Math.random() * 0.22));
      out.push({
        item: pool[i % pool.length],
        angle,
        y: baseY + yJitter,
        w,
        h,
        radius,
        bobDelay: Math.random() * 6,
      });
    }
    return out;
  }, [items, size.w]);

  if (!active) return null;

  return (
    <Box
      ref={containerRef}
      sx={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        background: 'radial-gradient(ellipse at center, #1a1830 0%, #05050d 80%)',
        // Far perspective keeps front cards from blowing up
        perspective: '2200px',
        perspectiveOrigin: '50% 50%',
      }}
    >
      {/* Soft drifting glow */}
      <Box
        sx={{
          position: 'absolute',
          width: '700px',
          height: '700px',
          left: '50%',
          top: '50%',
          marginLeft: '-350px',
          marginTop: '-350px',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(124,77,255,0.22) 0%, transparent 70%)',
          filter: 'blur(50px)',
          animation: 'lightDrift 22s ease-in-out infinite',
          '@keyframes lightDrift': {
            '0%, 100%': { transform: 'translate(-22%, -12%)' },
            '50%': { transform: 'translate(22%, 12%)' },
          },
          pointerEvents: 'none',
        }}
      />

      {/* Cylinder world */}
      <Box
        sx={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          width: 0,
          height: 0,
          transformStyle: 'preserve-3d',
          // Slow, slightly tilted spin
          animation: 'cylSpin 72s linear infinite',
          '@keyframes cylSpin': {
            '0%':   { transform: 'rotateX(-6deg) rotateY(0deg)' },
            '100%': { transform: 'rotateX(-6deg) rotateY(360deg)' },
          },
        }}
      >
        {cards.map((c, i) => (
          <Box
            key={`${c.item.performer.id}-${c.item.path}-${i}`}
            onClick={() => onPhotoClick?.(c.item.performer)}
            sx={{
              position: 'absolute',
              left: -c.w / 2,
              top: -c.h / 2,
              width: c.w,
              height: c.h,
              transformStyle: 'preserve-3d',
              transform: `rotateY(${c.angle}deg) translateZ(${c.radius}px) translateY(${c.y}px)`,
              cursor: 'pointer',
            }}
          >
            <Box
              sx={{
                position: 'absolute',
                inset: 0,
                animation: 'cardBob 7s ease-in-out infinite',
                animationDelay: `-${c.bobDelay}s`,
                '@keyframes cardBob': {
                  '0%, 100%': { transform: 'translateY(0px)' },
                  '50%':      { transform: 'translateY(-14px)' },
                },
              }}
            >
              <Box
                sx={{
                  position: 'absolute',
                  inset: 0,
                  borderRadius: '6px',
                  overflow: 'hidden',
                  boxShadow:
                    '0 30px 60px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.08)',
                  background: '#111',
                  backfaceVisibility: 'hidden',
                  transition: 'transform 0.3s ease, box-shadow 0.3s ease',
                  '&:hover': {
                    transform: 'scale(1.06)',
                    boxShadow:
                      '0 40px 80px rgba(0,0,0,0.9), 0 0 0 1px rgba(124,77,255,0.5)',
                  },
                }}
              >
                <img
                  src={imageUrlForPath(c.item.path)}
                  alt={c.item.performer.name}
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
                <Box
                  sx={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    bottom: 0,
                    height: '38%',
                    background:
                      'linear-gradient(to top, rgba(0,0,0,0.55) 0%, transparent 100%)',
                    pointerEvents: 'none',
                  }}
                />
              </Box>
            </Box>
          </Box>
        ))}
      </Box>

      {/* Floor fog */}
      <Box
        sx={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: '22%',
          background:
            'linear-gradient(to top, rgba(5,5,13,1) 0%, rgba(5,5,13,0) 100%)',
          pointerEvents: 'none',
        }}
      />
    </Box>
  );
}
