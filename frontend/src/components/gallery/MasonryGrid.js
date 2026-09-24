import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import MediaTile from './MediaTile';

const GAP = 8;
const CAPTION_H = 28;
const TILE_BORDER = 2;
const TINY_BELOW = 150;
const MIN_RATIO = 0.4;
const MAX_RATIO = 3;

// Ratios learned from loaded thumbnails, keyed by file path. Module-level so
// they survive the trip to the player and back: the restored scroll position
// only lands on the same tile if the tiles have the same heights as before.
const learnedRatios = new Map();

const clamp = (ratio) => Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio));

const ratioOf = (item, isVideo) => {
  const learned = learnedRatios.get(item.path);
  if (learned) return clamp(learned);
  const w = Number(item.width);
  const h = Number(item.height);
  if (w > 0 && h > 0) return clamp(w / h);
  return isVideo ? 9 / 16 : 3 / 4;
};

/**
 * Masonry columns. Every item goes into the currently shortest column, so
 * reading order stays roughly left-to-right.
 *
 * Placement is append-only: when `count` grows, or a thumbnail corrects its
 * ratio, tiles that are already placed keep their column (only the column
 * heights are re-measured). A full re-placement happens when the item list,
 * the column count/width (slider, resize) or the caption visibility changes.
 */
const MasonryGrid = ({ items, tab, size, count, showElo, onNeedMore, onOpen, emptyText }) => {
  const gridRef = useRef(null);
  const sentinelRef = useRef(null);
  const layoutRef = useRef(null);
  const ratioTimer = useRef(null);
  const [width, setWidth] = useState(0);
  const [ratioVersion, setRatioVersion] = useState(0);

  const isVideo = tab !== 0;
  const tiny = size < TINY_BELOW;

  useLayoutEffect(() => {
    const el = gridRef.current;
    if (!el) return undefined;
    const measure = () => {
      const style = window.getComputedStyle(el);
      const inner = el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      setWidth(prev => (Math.abs(prev - inner) < 1 ? prev : inner));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => () => clearTimeout(ratioTimer.current), []);

  const handleNaturalSize = useCallback((item, naturalWidth, naturalHeight) => {
    if (!naturalWidth || !naturalHeight || !item.path) return;
    // /api/files/preview centre-crops every picture to 500x400, so that size
    // says nothing about the picture itself.
    if (item.type === 'image' && naturalWidth === 500 && naturalHeight === 400) return;
    const natural = naturalWidth / naturalHeight;
    const used = ratioOf(item, item.type !== 'image');
    if (Math.abs(natural - used) / used < 0.03) return;
    learnedRatios.set(item.path, natural);
    clearTimeout(ratioTimer.current);
    ratioTimer.current = setTimeout(() => setRatioVersion(v => v + 1), 200);
  }, []);

  const columns = useMemo(() => {
    if (!width || items.length === 0) return null;
    const n = Math.max(1, Math.floor((width + GAP) / (size + GAP)));
    const colWidth = (width - GAP * (n - 1)) / n;
    const captionH = tiny ? 0 : CAPTION_H;
    const heightOf = (item) => (colWidth - TILE_BORDER) / ratioOf(item, isVideo) + TILE_BORDER + captionH + GAP;
    const limit = Math.min(count, items.length);

    const prev = layoutRef.current;
    const canAppend = prev && prev.items === items && prev.n === n && prev.colWidth === colWidth
      && prev.captionH === captionH && prev.placed <= limit;

    let cols;
    let heights;
    let placed;
    if (canAppend) {
      cols = prev.cols.map(col => col.slice());
      heights = prev.ratioVersion === ratioVersion
        ? prev.heights.slice()
        : cols.map(col => col.reduce((sum, index) => sum + heightOf(items[index]), 0));
      placed = prev.placed;
    } else {
      cols = Array.from({ length: n }, () => []);
      heights = new Array(n).fill(0);
      placed = 0;
    }

    for (let i = placed; i < limit; i++) {
      let shortest = 0;
      for (let c = 1; c < n; c++) {
        if (heights[c] < heights[shortest] - 0.5) shortest = c;
      }
      cols[shortest].push(i);
      heights[shortest] += heightOf(items[i]);
    }

    layoutRef.current = { items, n, colWidth, captionH, ratioVersion, cols, heights, placed: limit };
    return cols;
  }, [items, count, width, size, tiny, isVideo, ratioVersion]);

  // A fresh observer per count: if the sentinel is still on screen after a
  // batch was appended, the new observer's initial callback asks for the next.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || count >= items.length) return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some(entry => entry.isIntersecting)) onNeedMore();
    }, { rootMargin: '0px 0px 1500px 0px' });
    observer.observe(el);
    return () => observer.disconnect();
  }, [count, items.length, onNeedMore, columns]);

  return (
    <div ref={gridRef} className={`ug-grid${tiny ? ' ug-tiny' : ''}`}>
      {items.length === 0 && <p className="ug-empty">{emptyText}</p>}
      {columns && (
        <div className="ug-mas">
          {columns.map((col, c) => (
            <div className="ug-mcol" key={c}>
              {col.map(index => {
                const item = items[index];
                return (
                  <MediaTile
                    key={`${index}:${item.path}`}
                    item={item}
                    index={index}
                    tab={tab}
                    ratio={ratioOf(item, isVideo)}
                    showElo={showElo}
                    onOpen={onOpen}
                    onNaturalSize={handleNaturalSize}
                  />
                );
              })}
            </div>
          ))}
        </div>
      )}
      <div ref={sentinelRef} className="ug-sentinel" aria-hidden="true" />
    </div>
  );
};

export default MasonryGrid;
