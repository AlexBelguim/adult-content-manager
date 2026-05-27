import React, { useEffect, useRef, useState } from 'react';
import { Box } from '@mui/material';
import {
  generatePhotoWallLayout,
  generateCameraKeyframes,
  getCameraAnimationCSS,
  PHOTO_WALL_CONFIG
} from '../../utils/photoWallGenerator';

/**
 * "Scrapbook Wall" — improved version of the original photo wall.
 *
 * Improvements over the original:
 *   - Subtle breathing/zoom layered on top of the slow camera pan
 *   - Tape, frame, and hero styling preserved
 *   - Smooth fade-in instead of pop-in
 *   - Pointer-hover still pops a photo to the front
 */
export default function PhotoWallMode({ performers, onPhotoClick, active }) {
  const [layout, setLayout] = useState([]);
  const [ready, setReady] = useState(false);
  const bagsRef = useRef({});

  useEffect(() => {
    if (!active || !performers || performers.length === 0) return;
    let cancelled = false;
    setReady(false);
    (async () => {
      const { layout: items } = await generatePhotoWallLayout(performers, bagsRef.current);
      if (cancelled) return;
      setLayout(items);
      // Stagger the reveal slightly so it feels alive
      requestAnimationFrame(() => setReady(true));
    })();
    return () => {
      cancelled = true;
    };
  }, [performers, active]);

  if (!active) return null;

  return (
    <Box
      sx={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        background: 'radial-gradient(ellipse at center, #1f1a17 0%, #0c0a09 80%)',
      }}
    >
      <Box
        sx={{
          position: 'relative',
          width: `${PHOTO_WALL_CONFIG.screenMultiplier * 100}%`,
          height: `${PHOTO_WALL_CONFIG.screenMultiplier * 100}%`,
          animation: getCameraAnimationCSS(),
          '@keyframes cameraMove': generateCameraKeyframes(),
          '@keyframes wallBreathe': {
            '0%, 100%': { filter: 'brightness(1) saturate(1)' },
            '50%': { filter: 'brightness(1.08) saturate(1.08)' },
          },
          filter: 'brightness(1) saturate(1)',
          animationName: `cameraMove, wallBreathe`,
          animationDuration: `${30 * PHOTO_WALL_CONFIG.screenMultiplier}s, 18s`,
          animationTimingFunction: 'ease-in-out, ease-in-out',
          animationIterationCount: 'infinite, infinite',
          opacity: ready ? 1 : 0,
          transition: 'opacity 800ms ease-out',
        }}
      >
        {layout.map((item, index) => {
          if (!item.selectedThumbnail) return null;
          const imageUrl = `/api/files/raw?path=${encodeURIComponent(item.selectedThumbnail)}`;
          const isHero = item.isHero === true;
          const isFramed = item.isFramed === true;

          return (
            <Box
              key={`${item.performer.id}-${index}`}
              onClick={() => onPhotoClick?.(item.performer)}
              sx={{
                position: 'absolute',
                left: `${item.x}px`,
                top: `${item.y}px`,
                width: `${item.width}px`,
                height: `${item.height}px`,
                transform: `rotate(${item.rotation}deg)`,
                cursor: 'pointer',
                zIndex: item.zIndex,
                transition: 'transform 0.35s cubic-bezier(0.2, 0.9, 0.3, 1.2), box-shadow 0.35s ease',
                boxShadow: isHero
                  ? '0 12px 60px rgba(0, 0, 0, 0.85)'
                  : isFramed
                    ? '0 8px 28px rgba(0, 0, 0, 0.65)'
                    : '0 5px 22px rgba(0, 0, 0, 0.55)',
                overflow: 'hidden',
                backgroundColor: '#222',
                border: isFramed
                  ? `${8 + (index % 6)}px solid ${
                      ['#8B7355', '#654321', '#D4AF37', '#C0C0C0', '#1a1a1a', '#f5f5dc'][index % 6]
                    }`
                  : isHero
                    ? '8px solid rgba(255, 255, 255, 0.12)'
                    : 'none',
                borderRadius: isFramed && item.frameShape === 'oval' ? '50%' : 0,
                '&:hover': {
                  transform: `rotate(0deg) scale(${isHero ? 1.04 : 1.08})`,
                  boxShadow: '0 18px 70px rgba(0, 0, 0, 0.95)',
                  zIndex: 200,
                },
              }}
            >
              <img
                src={imageUrl}
                alt={item.performer.name}
                onError={(e) => { e.target.style.display = 'none'; }}
                loading="lazy"
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  objectPosition: 'center',
                  display: 'block',
                }}
              />
              {!isFramed && (
                <Box
                  sx={{
                    position: 'absolute',
                    top: -10,
                    left: '20%',
                    width: '60px',
                    height: '25px',
                    backgroundColor: 'rgba(200, 180, 140, 0.6)',
                    transform: 'rotate(-2deg)',
                    boxShadow: '0 2px 4px rgba(0, 0, 0, 0.3)',
                  }}
                />
              )}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
