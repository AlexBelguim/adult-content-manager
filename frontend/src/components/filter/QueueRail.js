import React, { useEffect, useRef } from 'react';
import { fmtTime } from '../player';
import { ACTION_BADGE, mediaItemFor } from './filterUtils';

const HISTORY_SHOWN = 4;

/**
 * Right column: "Recent decisions" (newest first, Undo on the newest) and
 * "Up next" — a two-column grid of tall thumbnails (three on a phone), the
 * current one highlighted and kept in view; click = jump.
 */
export default function QueueRail({ history, onUndo, undoBusy, files, currentTab, currentIndex, onPick }) {
  const boxRef = useRef(null);
  const isVideo = currentTab !== 'pics';

  // Centre the current thumbnail inside the list without scrolling the page.
  useEffect(() => {
    const box = boxRef.current;
    const cur = box?.querySelector('.is-cur');
    if (!box || !cur || box.scrollHeight <= box.clientHeight) return;
    const a = cur.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    box.scrollTop += a.top - b.top - box.clientHeight / 2 + a.height / 2;
  }, [currentIndex, files]);

  return (
    <aside className="fv-right">
      <section className="pl-pn" data-panel="history" style={{ padding: 10 }}>
        <h4>Recent decisions</h4>
        {history.length === 0 && <p className="pl-hint">Nothing yet.</p>}
        {history.slice(0, HISTORY_SHOWN).map((h, i) => (
          <div className="fv-hist" key={h.id}>
            <span className={`fv-badge ${h.action}`}>{ACTION_BADGE[h.action]}</span>
            <span className="fv-nm" title={h.file.name}>{h.file.name}</span>
            {i === 0 && (
              <button type="button" className="pl-btn sm" onClick={onUndo} disabled={undoBusy}>Undo</button>
            )}
          </div>
        ))}
      </section>
      <div className="fv-qhead">
        Up next <span className="fv-sub">{files.length} left</span>
      </div>
      <div className="fv-qlist" ref={boxRef}>
        <div className="fv-qgrid">
          {files.map((f, i) => (
            <button
              type="button"
              key={f.path}
              className={`fv-th${i === currentIndex ? ' is-cur' : ''}`}
              title={f.name}
              aria-current={i === currentIndex ? 'true' : undefined}
              onClick={() => onPick(i)}
            >
              <img loading="lazy" alt="" src={mediaItemFor(f, currentTab).thumbnail} onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />
              {f.filtered === 'keep' && <em>KEPT</em>}
              {isVideo && f.duration ? <span>{fmtTime(f.duration)}</span> : null}
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
}
