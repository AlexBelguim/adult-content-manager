import React, { useRef, useState } from 'react';
import { fmtTime } from './playerUtils';
import { CAST, DRESS_COLOR, GROUP_COLOR, dressAt, dressChanges, sceneAt, sceneName, useVideoTime } from './videoLabels';
import './videoLabels.css';

/**
 * The thin scene timeline above the seek bar, with a diamond where her dress state changes.
 * Hover = tooltip, click = jump (to the scene's start, or to the change under a diamond).
 */
export default function SceneStrip({ data, videoEl }) {
  const ref = useRef(null);
  const [hover, setHover] = useState(null);
  const now = useVideoTime(videoEl);
  const total = (videoEl && Number.isFinite(videoEl.duration) && videoEl.duration) || data.seconds;
  const pct = (t) => `${(100 * t) / total}%`;
  const cur = sceneAt(data.scenes, now);
  const changes = dressChanges(data.exposure);

  const at = (e) => {
    const r = ref.current.getBoundingClientRect();
    const x = Math.min(r.width, Math.max(0, e.clientX - r.left));
    return { x, t: (x / r.width) * total, w: r.width };
  };
  const onMove = (e) => {
    const { x, t, w } = at(e);
    setHover({ x, t, i: sceneAt(data.scenes, t), mark: changes.find(([a]) => Math.abs((a / total) * w - x) <= 7) });
  };
  const onClick = (e) => {
    if (!videoEl) return;
    const { t } = at(e);
    const i = sceneAt(data.scenes, t);
    videoEl.currentTime = hover?.mark ? hover.mark[0] : i >= 0 ? data.scenes[i].start : t;
  };

  const s = hover && hover.i >= 0 ? data.scenes[hover.i] : null;
  const dress = hover ? dressAt(data.exposure, hover.t) : null;

  return (
    <div className="sm-strip" ref={ref} onPointerMove={onMove} onPointerLeave={() => setHover(null)} onClick={onClick}>
      <div className="sm-marks">
        {changes.map(([a, e]) => (
          <i key={a} style={{ left: pct(a), background: DRESS_COLOR[e] }} className={hover?.mark?.[0] === a ? 'is-hot' : undefined} />
        ))}
      </div>
      <div className="sm-row">
        {data.scenes.map((x, i) => (
          <span
            key={x.start}
            className={`sm-blk${i === cur ? ' is-cur' : ''}${hover?.i === i && !hover.mark ? ' is-hot' : ''}`}
            style={{ left: pct(x.start), width: `calc(${pct(x.end - x.start)} - 2px)`, background: GROUP_COLOR[x.group] || GROUP_COLOR.other }}
          />
        ))}
      </div>
      {hover && (s || hover.mark) && (
        <div className="sm-tip" style={{ left: Math.min(Math.max(hover.x, 90), (ref.current?.clientWidth || 0) - 90) }}>
          {hover.mark ? (
            <>
              <b>{hover.mark[1][0].toUpperCase() + hover.mark[1].slice(1)}</b> from {fmtTime(hover.mark[0])}
              {s && <div className="sm-tip-sub">during {sceneName(s)}</div>}
            </>
          ) : (
            <>
              <b>{sceneName(s)}</b>
              <div className="sm-tip-sub">{[CAST[s.cast], dress].filter(Boolean).join(' · ')}</div>
              <div className="sm-tip-sub">{fmtTime(s.start)} – {fmtTime(s.end)} · {fmtTime(s.end - s.start)}</div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** The current scene as chips on the video, top left. */
export function SceneChips({ data, videoEl }) {
  const now = useVideoTime(videoEl);
  const i = sceneAt(data.scenes, now);
  if (i < 0) return null;
  const s = data.scenes[i];
  const dress = dressAt(data.exposure, now);
  return (
    <div className="sm-chips">
      <span className="sm-chip"><i style={{ background: GROUP_COLOR[s.group] || GROUP_COLOR.other }} />{sceneName(s)}</span>
      <span className="sm-chip">{CAST[s.cast] || s.cast}</span>
      {dress && <span className="sm-chip">{dress}</span>}
    </div>
  );
}
