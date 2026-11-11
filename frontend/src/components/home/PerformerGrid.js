/**
 * The Gallery home's performer grid: fixed 280x520 cells, 24px gaps, as many columns as fit, centred. Only the
 * rows within one viewport above and below the window are mounted, so a big library does not load every card's
 * picture and stats at once. Every cell is placed absolutely and keyed by its item, so a filter or sort change
 * moves a card instead of mounting it again.
 */
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Box, Typography } from '@mui/material';

export const CARD_W = 280;
export const CARD_H = 520;
export const GAP = 24;
export const DIVIDER_H = 44;

const colsFor = (width) => Math.max(1, Math.floor((width + GAP) / (CARD_W + GAP)));
const rowWidth = (cols) => cols * CARD_W + (cols - 1) * GAP;

/** The container's width, measured before paint and on every resize. */
function useWidth(ref) {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => {
      const w = el.getBoundingClientRect().width;
      setWidth(prev => (Math.abs(prev - w) < 0.5 ? prev : w));
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

/**
 * sections: [{ key, label?, items }]; a section with a label starts with a divider line.
 * renderItem(item) -> the card; itemKey(item) -> a stable key; onAuxOpen(item, event): a middle click on a cell
 * (it fires no click event, so the card's onClick never sees it).
 */
export default function PerformerGrid({ sections, renderItem, itemKey, onAuxOpen }) {
  const ref = useRef(null);
  const width = useWidth(ref);
  const cols = colsFor(width);
  const left0 = Math.max(0, (width - rowWidth(cols)) / 2);

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
        rows.push({ kind: 'cards', items: items.slice(i, i + cols), top: offset, height: CARD_H });
        offset += CARD_H + GAP;
      }
    }
    return { rows, height: rows.length ? offset - GAP : 0 };
  }, [sections, cols]);

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
          position: 'absolute', top: row.top, left: left0, width: rowWidth(cols), maxWidth: '100%', height: DIVIDER_H,
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
          sx={{ position: 'absolute', top: row.top, left: left0 + c * (CARD_W + GAP), width: CARD_W, height: CARD_H }}
        >
          {renderItem(item)}
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
  const width = useWidth(ref);
  const cols = colsFor(width);
  return (
    <Box ref={ref} sx={{ position: 'relative', width: '100%' }}>
      <Box role="status" sx={hiddenSx}>Loading performers…</Box>
      <Box aria-hidden sx={{
        display: 'grid', gridTemplateColumns: `repeat(${cols}, ${CARD_W}px)`, gap: `${GAP}px`, justifyContent: 'center'
      }}>
        {Array.from({ length: cols * 2 }, (_, i) => (
          <Box key={i} sx={{
            width: CARD_W, height: CARD_H, bgcolor: 'var(--raised)', borderRadius: '8px',
            animation: 'homeGridPulse 1.6s ease-in-out infinite',
            '@keyframes homeGridPulse': { '0%': { opacity: 1 }, '50%': { opacity: 0.55 }, '100%': { opacity: 1 } },
            '@media (prefers-reduced-motion: reduce)': { animation: 'none' }
          }} />
        ))}
      </Box>
    </Box>
  );
}
