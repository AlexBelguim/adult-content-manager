import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box } from '@mui/material';
import useGalleryImages, { imageUrlForPath } from './useGalleryImages';

/**
 * "Floating Cards 3D" — photos arranged on a slowly rotating cylinder in
 * perspective space. Each card counter-rotates so it always faces the camera,
 * with a gentle vertical bob for extra parallax. Closer cards stay crisp,
 * far-side cards dim and blur slightly via opacity falloff with rotation.
 */
export default function FloatingCards3DMode({ performers, onPhotoClick, active }) {
  const { items } = useGalleryImages(performers, { perPerformerMax: 3, active });
  const containerRef = useRef(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
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
  }, []);

  // Build a stable arrangement on the cylinder
  const cards = useMemo(() => {
    if (!items.length || !size.w) return [];
    // Limit cards on screen so it doesn't get cluttered
    const N = Math.min(items.length, 32);
    const radius = Math.max(420, size.w * 0.42);
    const out = [];
    // Shuffle items so the order around the cylinder is varied
    const pool = [...items];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    for (let i = 0; i < N; i++) {
      const angle = (i / N) * 360;
      // Two rows: half lower, half upper, offset for nice staggering
      const row = i % 2;
      const y = row === 0 ? -90 : 110;
      const yJitter = (Math.random() - 0.5) * 40;
      const w = 220 + (i % 3) * 25;
      const h = Math.round(w * (1.2 + Math.random() * 0.3));
      out.push({
        item: pool[i % pool.length],
        angle,
        y: y + yJitter,
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
        perspective: '1500px',
        perspectiveOrigin: '50% 50%',
      }}
    >
      {/* Soft moving light glow */}
      <Box
        sx={{
          position: 'absolute',
          width: '600px',
          height: '600px',
          left: '50%',
          top: '50%',
          marginLeft: '-300px',
          marginTop: '-300px',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(124,77,255,0.18) 0%, transparent 70%)',
          filter: 'blur(40px)',
          animation: 'lightDrift 18s ease-in-out infinite',
          '@keyframes lightDrift': {
            '0%, 100%': { transform: 'translate(-20%, -10%)' },
            '50%': { transform: 'translate(20%, 10%)' },
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
          animation: 'cylSpin 50s linear infinite',
          '@keyframes cylSpin': {
            '0%': { transform: 'rotateX(-8deg) rotateY(0deg)' },
            '100%': { transform: 'rotateX(-8deg) rotateY(360deg)' },
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
            {/* Counter-rotate the inner so the card faces the camera-ish (billboard) */}
            <Box
              sx={{
                position: 'absolute',
                inset: 0,
                animation: `cardBob 6s ease-in-out infinite`,
                animationDelay: `-${c.bobDelay}s`,
                '@keyframes cardBob': {
                  '0%, 100%': { transform: 'translateY(0px)' },
                  '50%': { transform: 'translateY(-12px)' },
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
                {/* Reflective sheen along bottom edge */}
                <Box
                  sx={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    bottom: 0,
                    height: '40%',
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

      {/* Floor reflection / fog */}
      <Box
        sx={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: '25%',
          background:
            'linear-gradient(to top, rgba(5,5,13,1) 0%, rgba(5,5,13,0) 100%)',
          pointerEvents: 'none',
        }}
      />
    </Box>
  );
}
