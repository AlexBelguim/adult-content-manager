import React from 'react';
import { fmtSize, fmtTime } from '../player';
import { ACTION_BADGE } from './filterUtils';

/**
 * "This file": name, KEPT / DELETED / MOVED badge, size, resolution, duration,
 * and the Tags / Scenes toggles that open the panels underneath.
 */
export default function FileCard({ item, file, info, isVideo, tagsOpen, scenesOpen, onToggleTags, onToggleScenes }) {
  const width = info?.width || item.width;
  const height = info?.height || item.height;
  const seconds = info?.duration || item.duration;
  const rows = [
    ['Size', fmtSize(item)],
    ['Resolution', width && height ? `${width} × ${height}` : ''],
    ['Duration', isVideo && seconds ? fmtTime(seconds) : '']
  ].filter(([, value]) => value);

  return (
    <section className="pl-pn" data-panel="file">
      <h4>This file</h4>
      <div className="fv-name">{item.name}</div>
      {file.filtered && (
        <div className="fv-badges">
          <span className={`fv-badge ${file.filtered}`}>{ACTION_BADGE[file.filtered] || String(file.filtered).toUpperCase()}</span>
        </div>
      )}
      {rows.length > 0 && (
        <dl className="pl-kv fv-card-kv">
          {rows.map(([label, value]) => (
            <React.Fragment key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </React.Fragment>
          ))}
        </dl>
      )}
      <div className="fv-row fv-card-row">
        <button type="button" className={`pl-btn sm${tagsOpen ? ' is-on' : ''}`} onClick={onToggleTags} aria-pressed={tagsOpen}>
          🏷️ Tags
        </button>
        {isVideo && (
          <button type="button" className={`pl-btn sm${scenesOpen ? ' is-on' : ''}`} onClick={onToggleScenes} aria-pressed={scenesOpen}>
            🎬 Scenes
          </button>
        )}
      </div>
    </section>
  );
}
