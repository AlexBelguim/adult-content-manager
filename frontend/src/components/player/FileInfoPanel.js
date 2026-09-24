import React from 'react';
import { fmtSize, fmtTime, isVideoItem } from './playerUtils';
import './player.css';

function fmtDate(value) {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString();
}

/**
 * Size, resolution, duration, modified date, path. `dimensions` / `duration`
 * override the item's own values (the page passes what the media element reported).
 */
export default function FileInfoPanel({ item, dimensions, duration }) {
  const width = dimensions?.width || item?.width;
  const height = dimensions?.height || item?.height;
  const seconds = duration || item?.duration;

  const rows = [
    ['Size', fmtSize(item)],
    ['Resolution', width && height ? `${width} × ${height}` : ''],
    ['Duration', isVideoItem(item) && seconds ? fmtTime(seconds) : ''],
    ['Modified', fmtDate(item?.modified)],
    ['Path', item?.path || '']
  ].filter(([, value]) => value);

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
    </section>
  );
}
