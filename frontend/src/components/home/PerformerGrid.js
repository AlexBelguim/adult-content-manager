/**
 * The Gallery home's performer grid: the column count nearest to 280x520 cards, then every cell grows or shrinks a little so a row meets both
 * edges with the fixed 24px gap; each card keeps its exact look, scaled with a transform. Only the
 * rows within one viewport above and below the window are mounted, so a big library does not load every card's
 * picture and stats at once. Every cell is placed absolutely and keyed by its item, so a filter or sort change
 * moves a card instead of mounting it again.
 */
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Box, Typography } from '@mui/material';
import { useFill } from '../layout';

export const CARD_W = 280;
export const CARD_H = 520;
export const GAP = 24;
export const DIVIDER_H = 44;

/** The scaled card: a 280x520 box grown to the cell with a transform, so the card keeps its exact look. */
const cardBoxSx = (scale) => ({
  position: 'absolute', top: 0, left: 0, width: CARD_W, height: CARD_H,
  transform: scale === 1 ? 'none' : `scale(${scale})`, transformOrigin: '0 0'
});

/**
 * sections: [{ key, label?, items }]; a section with a label starts with a divider line.
 * renderItem(item) -> the card; itemKey(item) -> a stable key; onAuxOpen(item, event): a middle click on a cell
 * (it fires no click event, so the card's onClick never sees it).
 */
export default function PerformerGrid({ sections, renderItem, itemKey, onAuxOpen }) {
  const ref = useRef(null);
  const { width, cols, cellW, scale } = useFill(ref, { base: CARD_W, gap: GAP });
  const rowH = CARD_H * scale;

  const layout = useMemo(() => {
    const rows = [];
    let offset = 0;
    for (const section of sections || []) {
      const items = section.items || [];
      if (!items.length) continue;
      if (section.label) {
        rows.push({ kind: 'divider', key: `divider:${section.key}`, label: section.label, top: offset, height: DIVIDER_H });
        offset += DIVIDER_H + GAP;
      }
      for (let i = 0; i < items.length; i += cols) {
        rows.push({ kind: 'cards', items: items.slice(i, i + cols), top: offset, height: rowH });
        offset += rowH + GAP;
      }
    }
    return { rows, height: rows.length ? offset - GAP : 0 };
  }, [sections, cols, rowH]);

  const [range, setRange] = useState({ first: 0, last: -1 });
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const { rows } = layoutRef.current;
    const containerTop = el.getBoundingClientRect().top + window.scrollY;
    const vh = window.innerHeight || 800;
    const from = window.scrollY - vh - containerTop;
    const to = window.scrollY + 2 * vh - containerTop;
    let first = -1;
    let last = -1;
    for (let i = 0; i < rows.length; i += 1) {
      const r = rows[i];
      if (r.top + r.height < from) continue;
      if (r.top > to) break;
      if (first === -1) first = i;
      last = i;
    }
    if (first === -1) { first = 0; last = -1; }
    setRange(prev => (prev.first === first && prev.last === last ? prev : { first, last }));
  }, []);

  // Before paint, so a restored scroll position or a new layout never shows an empty frame.
  useLayoutEffect(() => { update(); }, [layout, update]);

  useEffect(() => {
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => { frame = 0; update(); });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [update]);

  const nodes = [];
  for (let i = range.first; i <= range.last && i < layout.rows.length; i += 1) {
    const row = layout.rows[i];
    if (row.kind === 'divider') {
      nodes.push(
        <Box key={row.key} sx={{
          position: 'absolute', top: row.top, left: 0, width, maxWidth: '100%', height: DIVIDER_H,
          display: 'flex', alignItems: 'center', gap: 1.5
        }}>
          <Typography component="h3" sx={{ fontSize: '.8rem', fontWeight: 600, color: 'var(--dim)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
            {row.label}
          </Typography>
          <Box aria-hidden sx={{ flex: 1, height: '1px', bgcolor: 'var(--line)' }} />
        </Box>
      );
      continue;
    }
    row.items.forEach((item, c) => {
      nodes.push(
        <Box
          key={itemKey(item)}
          onAuxClick={(e) => { if (isCardAux(e)) { e.preventDefault(); onAuxOpen?.(item, e); } }}
          sx={{ position: 'absolute', top: row.top, left: c * (cellW + GAP), width: cellW, height: rowH }}
        >
          <Box sx={cardBoxSx(scale)}>{renderItem(item)}</Box>
        </Box>
      );
    });
  }

  return (
    <Box ref={ref} sx={{ position: 'relative', width: '100%', height: layout.height }}>
      {nodes}
    </Box>
  );
}

/**
 * A middle click on the card itself, not on one of its controls and not in one of its dialogs or popovers (React
 * events bubble out of portals, so those reach the cell too).
 */
function isCardAux(e) {
  if (e.button !== 1) return false;
  const t = e.target;
  if (!(t instanceof Element) || !e.currentTarget.contains(t)) return false;
  return !t.closest('button, a, input, textarea, select, [role="button"], [role="slider"], [role="menuitem"], .rating-badge');
}

const hiddenSx = {
  position: 'absolute', width: 1, height: 1, p: 0, m: '-1px', overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0
};

/** Two rows of card-sized boxes while the list loads for the first time. */
export function GridSkeleton() {
  const ref = useRef(null);
  const { cols, cellW, scale } = useFill(ref, { base: CARD_W, gap: GAP });
  return (
    <Box ref={ref} sx={{ position: 'relative', width: '100%' }}>
      <Box role="status" sx={hiddenSx}>Loading performers…</Box>
      <Box aria-hidden sx={{
        display: 'grid', gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: `${GAP}px`
      }}>
        {Array.from({ length: cols * 2 }, (_, i) => (
          <Box key={i} sx={{
            width: cellW, maxWidth: '100%', height: CARD_H * scale, bgcolor: 'var(--raised)', borderRadius: '8px',
            animation: 'homeGridPulse 1.6s ease-in-out infinite',
            '@keyframes homeGridPulse': { '0%': { opacity: 1 }, '50%': { opacity: 0.55 }, '100%': { opacity: 1 } },
            '@media (prefers-reduced-motion: reduce)': { animation: 'none' }
          }} />
        ))}
      </Box>
    </Box>
  );
}
