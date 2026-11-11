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
 *   - Pointer-hover still pops a photo to the front
 *   - Renders progressively as soon as the first layout is ready (instead of
 *     holding the wall invisible behind opacity:0 for the entire fetch)
 */
export default function PhotoWallMode({ performers, onPhotoClick, active }) {
  const [layout, setLayout] = useState([]);
  // Starts as loading when there is work, so 'No pictures' never flashes first
  const [loading, setLoading] = useState(() => Boolean(active && performers && performers.length));
  const bagsRef = useRef({});

  useEffect(() => {
    if (!active || !performers || performers.length === 0) return;
    const controller = new AbortController();
    setLoading(true);
    (async () => {
      try {
        const { layout: items } = await generatePhotoWallLayout(
          performers,
          bagsRef.current,
          { signal: controller.signal }
        );
        if (controller.signal.aborted) return;
        setLayout(items);
      } catch (e) {
        if (controller.signal.aborted || e?.name === 'AbortError') return;
        setLayout([]);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => {
      controller.abort();
    };
  }, [performers, active]);

  if (!active) return null;

  return (
    <Box
      sx={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        background: 'var(--bg)',
      }}
    >
      {/* Loading hint while the first batch of images is being collected */}
      {loading && layout.length === 0 && (
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--dim)',
            fontSize: 14,
            letterSpacing: 2,
            textTransform: 'uppercase',
            pointerEvents: 'none',
            zIndex: 5,
          }}
        >
          Building the wall…
        </Box>
      )}
      {!loading && layout.length === 0 && (
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--dim)',
            fontSize: 14,
            letterSpacing: 2,
            textTransform: 'uppercase',
            pointerEvents: 'none',
            zIndex: 5,
          }}
        >
          No pictures to show
        </Box>
      )}
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
                  ? 'var(--shadow-md), 0 0 0 1px var(--line-strong)'
                  : 'var(--shadow-md)',
                overflow: 'hidden',
                backgroundColor: 'var(--raised)',
                border: isFramed
                  ? `${8 + (index % 6)}px solid ${
                      ['var(--surface)', 'var(--raised)', 'var(--overlay)', 'var(--line-strong)', 'var(--dim)', 'var(--text)'][index % 6]
                    }`
                  : isHero
                    ? '8px solid var(--line-strong)'
                    : 'none',
                borderRadius: isFramed && item.frameShape === 'oval' ? '50%' : 0,
                '&:hover': {
                  transform: `rotate(0deg) scale(${isHero ? 1.04 : 1.08})`,
                  boxShadow: 'var(--shadow-md), 0 0 0 1px var(--line-strong)',
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
                    backgroundColor: 'var(--line-strong)',
                    opacity: 0.8,
                    transform: 'rotate(-2deg)',
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
