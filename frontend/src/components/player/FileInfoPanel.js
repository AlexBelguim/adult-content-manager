import React, { useState } from 'react';
import { fmtSize, fmtTime, isVideoItem } from './playerUtils';
import { useNotify } from '../ui';
import './player.css';

function fmtDate(value) {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString();
}

/** in a funscript folder already: <...>/funscript/<name>/<file> */
const IN_FUNSCRIPT = /[\\/]funscript[\\/][^\\/]+[\\/][^\\/]+$/i;

/**
 * Size, resolution, duration, modified date, path. `dimensions` / `duration`
 * override the item's own values (the page passes what the media element reported).
 * A video not in a funscript folder gets "Move to funscript folder" (POST /api/scenes/video/move-to-funscript:
 * <its folder>/funscript/<name>/, its scripts, sidecars, labels, tags and ratings along); onMoved({ from, to }) then
 * tells the page its new path.
 */
export default function FileInfoPanel({ item, dimensions, duration, onMoved }) {
  const notify = useNotify();
  const [moving, setMoving] = useState(false);
  const width = dimensions?.width || item?.width;
  const height = dimensions?.height || item?.height;
  const seconds = duration || item?.duration;
  const canMove = isVideoItem(item) && item?.path && !IN_FUNSCRIPT.test(item.path);

  const rows = [
    ['Size', fmtSize(item)],
    ['Resolution', width && height ? `${width} × ${height}` : ''],
    ['Duration', isVideoItem(item) && seconds ? fmtTime(seconds) : ''],
    ['Modified', fmtDate(item?.modified)],
    ['Path', item?.path || '']
  ].filter(([, value]) => value);

  const move = async () => {
    const from = item.path;
    setMoving(true);
    try {
      const r = await fetch('/api/scenes/video/move-to-funscript', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ videoPath: from })
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.success) throw new Error(d.error || `The server answered ${r.status}`);
      notify('Moved to the funscript folder');
      onMoved?.({ from, to: d.newVideoPath });
    } catch (err) {
      notify({ severity: 'error', message: `Not moved: ${err.message}` });
    } finally {
      setMoving(false);
    }
  };

  return (
    <section className="pl-pn" data-panel="info">
      <h4>File</h4>
      <dl className="pl-kv">
        {rows.map(([label, value]) => (
          <React.Fragment key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </React.Fragment>
        ))}
      </dl>
      {canMove && (
        <button type="button" className="pl-btn sm" onClick={move} disabled={moving}
          title="Into this folder's funscript folder (funscript/<name>/), with its scripts, labels, tags and ratings">
          {moving ? 'Moving…' : 'Move to funscript folder'}
        </button>
      )}
    </section>
  );
}
