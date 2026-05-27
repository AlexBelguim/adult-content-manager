import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box } from '@mui/material';
import useGalleryImages, { imageUrlForPath } from './useGalleryImages';

/**
 * "Mosaic Drift" — packed masonry that slowly drifts diagonally upward,
 * with each tile breathing in/out (Ken Burns zoom). When a tile leaves
 * the top of the viewport, a new row spawns at the bottom.
 *
 * The whole grid translates with a CSS transform; tiles never reposition,
 * so it stays cheap even with many photos.
 */
export default function MosaicDriftMode({ performers, onPhotoClick, active }) {
  const { items } = useGalleryImages(performers, { perPerformerMax: 4, active });
  const containerRef = useRef(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  // Build a dense grid layout (multiple columns of varying-height tiles)
  const grid = useMemo(() => {
    if (!size.w || !size.h || items.length === 0) return { tiles: [], totalHeight: 0, columnHeight: 0 };

    const targetCols = size.w < 900 ? 4 : size.w < 1500 ? 6 : 8;
    const gap = 10;
    const colWidth = (size.w - gap * (targetCols + 1)) / targetCols;
    // Build enough tiles to fill ~3x viewport height for seamless looping
    const targetHeight = size.h * 3;
    const colHeights = Array.from({ length: targetCols }, () => 0);
    const tiles = [];

    // Pseudo-shuffle items so consecutive tiles aren't from the same performer
    const order = [...items];
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    let idx = 0;
    while (Math.min(...colHeights) < targetHeight && idx < order.length * 6) {
      const item = order[idx % order.length];
      idx++;
      // Pick shortest column
      let col = 0;
      for (let c = 1; c < targetCols; c++) {
        if (colHeights[c] < colHeights[col]) col = c;
      }
      // Random tile aspect: 1:1, 4:5, 3:4, 4:3
      const aspects = [1, 1.25, 1.33, 0.75, 1.5];
      const aspect = aspects[Math.floor(Math.random() * aspects.length)];
      const tileH = Math.round(colWidth * aspect);
      const x = gap + col * (colWidth + gap);
      const y = colHeights[col] + gap;
      tiles.push({
        x, y,
        w: colWidth,
        h: tileH,
        item,
        // Stagger zoom phases so tiles don't all breathe in sync
        zoomDelay: Math.random() * 8,
        zoomDir: Math.random() < 0.5 ? 1 : -1,
      });
      colHeights[col] += tileH + gap;
    }
    return {
      tiles,
      totalHeight: Math.max(...colHeights),
      columnHeight: Math.max(...colHeights),
    };
  }, [items, size]);

  // Track size
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

  if (!active) return null;

  const driftDuration = Math.max(40, grid.totalHeight / 25); // px/s ish

  return (
    <Box
      ref={containerRef}
      sx={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        background: '#070707',
      }}
    >
      <Box
        sx={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: '100%',
          height: `${grid.totalHeight}px`,
          animation: grid.totalHeight ? `mosaicDrift ${driftDuration}s linear infinite` : 'none',
          '@keyframes mosaicDrift': {
            '0%': { transform: `translate3d(-2%, 0, 0)` },
            '100%': { transform: `translate3d(-2%, -${grid.totalHeight - size.h}px, 0)` },
          },
        }}
      >
        {grid.tiles.map((t, i) => (
          <Box
            key={`${t.item.performer.id}-${t.item.path}-${i}`}
            onClick={() => onPhotoClick?.(t.item.performer)}
            sx={{
              position: 'absolute',
              left: `${t.x}px`,
              top: `${t.y}px`,
              width: `${t.w}px`,
              height: `${t.h}px`,
              overflow: 'hidden',
              borderRadius: '4px',
              cursor: 'pointer',
              boxShadow: '0 4px 18px rgba(0,0,0,0.45)',
              background: '#111',
              transition: 'transform 0.3s ease, box-shadow 0.3s ease',
              '&:hover': {
                transform: 'scale(1.03)',
                boxShadow: '0 10px 30px rgba(0,0,0,0.7), 0 0 0 2px rgba(255,255,255,0.2)',
                zIndex: 50,
              },
            }}
          >
            <Box
              component="img"
              src={imageUrlForPath(t.item.path)}
              alt={t.item.performer.name}
              loading="lazy"
              sx={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                display: 'block',
                animation: `kenBurns${t.zoomDir > 0 ? 'In' : 'Out'} 14s ease-in-out infinite alternate`,
                animationDelay: `-${t.zoomDelay}s`,
                '@keyframes kenBurnsIn': {
                  '0%': { transform: 'scale(1) translate(0, 0)' },
                  '100%': { transform: 'scale(1.12) translate(-2%, -2%)' },
                },
                '@keyframes kenBurnsOut': {
                  '0%': { transform: 'scale(1.12) translate(2%, 2%)' },
                  '100%': { transform: 'scale(1) translate(0, 0)' },
                },
              }}
              onError={(e) => { e.target.style.display = 'none'; }}
            />
          </Box>
        ))}
      </Box>
    </Box>
  );
}
