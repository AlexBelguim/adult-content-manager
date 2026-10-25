import React, { useMemo, useState } from 'react';
import { mediaItemFor } from './filterUtils';
import { kZone } from './useKeepScores';

const ZONES = [
  ['keep', 'Keep', '60% and up'],
  ['unsure', 'Uncertain', '41–59%'],
  ['delete', 'Delete', '40% and below']
];
const OTHER = { keep: 'delete', delete: 'keep' };

/**
 * The rest of a performer's pictures sorted by K into Keep / Uncertain / Delete, as on the taste
 * preview page. A click flips a picture in Keep or Delete to the other side, right-click (long press)
 * shows it large; a zone's button applies it, Uncertain goes back to one by one, most unsure first.
 */
export default function KSortView({ files, scores, learned, progress, busy, onApply, onOneByOne, onClose }) {
  const [flipped, setFlipped] = useState(() => new Set());
  const [big, setBig] = useState(null);

  const zones = useMemo(() => {
    const scored = files.filter((f) => scores[f.path] != null).sort((a, b) => scores[b.path] - scores[a.path]);
    return ZONES.map(([key, label, rule]) => [key, label, rule, scored.filter((f) => kZone(scores[f.path]) === key)]);
  }, [files, scores]);

  const flip = (path) => setFlipped((s) => {
    const next = new Set(s);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    return next;
  });

  const apply = (key, list) => {
    const results = list.map((f) => ({ path: f.path, decision: flipped.has(f.path) ? OTHER[key] : key }));
    const corrections = list.filter((f) => flipped.has(f.path)).map((f) => ({
      path: f.path, original_label: key, corrected_label: OTHER[key], model_type: 'clip_keepdelete', model_name: 'K'
    }));
    onApply(results, corrections);
  };

  return (
    <div className="fv-ksort">
      <div className="fv-ksort-head">
        <div className="fv-grow">
          <h2>Sorted by K</h2>
          <span className="fv-sub">
            {progress ? `Scoring ${progress.done} of ${progress.total}…` : `${files.length} pictures left · K learned from ${learned} of hers`}
            {' · click flips, right-click shows large'}
          </span>
        </div>
        <button type="button" className="pl-btn sm" onClick={onClose}>Back to one by one</button>
      </div>
      {zones.map(([key, label, rule, list]) => list.length > 0 && (
        <section key={key} className={`fv-kzone ${key}`}>
          <div className="fv-kzone-h">
            <b>{label}</b>
            <span className="fv-sub">{list.length} · {rule}</span>
            <span className="fv-grow" />
            {key === 'unsure' ? (
              <button type="button" className="pl-btn sm" onClick={() => onOneByOne(list)}>Filter these one by one</button>
            ) : (
              <button type="button" className={`pl-btn sm ${key}`} disabled={busy} onClick={() => apply(key, list)}>
                {key === 'keep' ? 'Keep' : 'Delete'} {list.filter((f) => !flipped.has(f.path)).length}
                {list.some((f) => flipped.has(f.path)) ? `, ${key === 'keep' ? 'delete' : 'keep'} ${list.filter((f) => flipped.has(f.path)).length} flipped` : ''}
              </button>
            )}
          </div>
          <div className="fv-kgrid">
            {list.map((f) => (
              <button
                type="button"
                key={f.path}
                className={`fv-th${flipped.has(f.path) ? ' is-flip' : ''}`}
                title={f.name}
                onClick={() => (key === 'unsure' ? setBig(f) : flip(f.path))}
                onContextMenu={(e) => { e.preventDefault(); setBig(f); }}
              >
                <img loading="lazy" alt="" src={mediaItemFor(f, 'pics').thumbnail} onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />
                <i className={`fv-k ${kZone(scores[f.path])}`}>{Math.round(scores[f.path])}%</i>
                {flipped.has(f.path) && <em className="flip">{OTHER[key] === 'keep' ? 'KEEP' : 'DELETE'}</em>}
              </button>
            ))}
          </div>
        </section>
      ))}
      {big && (
        <button type="button" className="fv-kbig" onClick={() => setBig(null)} aria-label="Close">
          <img alt="" src={mediaItemFor(big, 'pics').url} />
        </button>
      )}
    </div>
  );
}
