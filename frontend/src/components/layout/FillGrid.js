/**
 * Grids that meet both edges: the column count nearest to the base width, then every cell grows or shrinks a little
 * so a row fills the width with the fixed gap.
 *
 *   useElementWidth(ref) -> the element's width, measured before paint (ResizeObserver; window resize as a fallback)
 *   useFill(ref, { base, gap }) -> { width, cols, cellW, scale }
 *     cols = max(1, round((width + gap) / (base + gap))); cellW = (width - (cols - 1) * gap) / cols; scale = cellW / base
 *   <FillGrid base={280} height={520} gap={24} fit="scale" | "stretch" ratio?>{cells}</FillGrid>
 *     fit="scale": each child is a fixed-size card (base x height). The cell is cellW x height*scale and holds a
 *       base x height box scaled with a transform (origin 0 0), so the card keeps its exact look and only changes size.
 *     fit="stretch": the child fills the cell width; with `height` the cell is height*scale tall and the child fills
 *       it; with `ratio` (w/h) the cell keeps that aspect ratio; otherwise the height is natural.
 *   Each child's key is kept on its cell.
 */
import React, { useLayoutEffect, useRef, useState } from 'react';
import { Box } from '@mui/material';

export function useElementWidth(ref) {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => {
      const w = el.getBoundingClientRect().width;
      setWidth((prev) => (Math.abs(prev - w) < 0.5 ? prev : w));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}

export function fillOf(width, base, gap) {
  // the nearest column count, so cells stay close to the base size (within about 15%) instead of only growing
  const cols = Math.max(1, Math.round((width + gap) / (base + gap)));
  const cellW = width > 0 ? Math.max(0, (width - (cols - 1) * gap) / cols) : base;
  return { width, cols, cellW, scale: base > 0 ? cellW / base : 1 };
}

export function useFill(ref, { base, gap = 24 } = {}) {
  const width = useElementWidth(ref);
  return fillOf(width, base, gap);
}

export function FillGrid({ base = 280, height, gap = 24, fit = 'stretch', ratio, children, className, sx, ...rest }) {
  const ref = useRef(null);
  const { cols, scale } = useFill(ref, { base, gap });
  const cells = React.Children.toArray(children);

  return (
    <Box
      ref={ref}
      className={className}
      sx={{
        display: 'grid', gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: `${gap}px`, width: '100%',
        minWidth: 0, ...sx
      }}
      {...rest}
    >
      {cells.map((child) => {
        if (fit === 'scale') {
          const h = (height || base) * scale;
          return (
            <Box key={child.key} sx={{ position: 'relative', height: h, minWidth: 0 }}>
              <Box sx={{
                position: 'absolute', top: 0, left: 0, width: base, height: height || base,
                transform: scale === 1 ? 'none' : `scale(${scale})`, transformOrigin: '0 0'
              }}>
                {child}
              </Box>
            </Box>
          );
        }
        const sized = height ? { height: height * scale } : ratio ? { aspectRatio: String(ratio) } : null;
        return (
          <Box key={child.key} sx={{
            minWidth: 0, display: 'flex', flexDirection: 'column',
            ...sized,
            // the child fills its cell: with a size, that size; without, the row's height (so a row's cards are one height)
            '& > *': { width: '100%', minWidth: 0, flex: '1 1 auto', ...(sized ? { minHeight: 0 } : null) }
          }}>
            {child}
          </Box>
        );
      })}
    </Box>
  );
}

export default FillGrid;
