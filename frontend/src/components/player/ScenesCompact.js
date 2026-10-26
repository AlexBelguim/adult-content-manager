import React from 'react';
import { fmtTime } from './playerUtils';
import { openSceneManager } from './ScenesPanel';
import LabelButtons from './LabelButtons';
import { GROUP_COLOR, sceneAt, sceneName, useVideoTime } from './videoLabels';
import './videoLabels.css';

/** labelmaster's scenes as a plain list, the current one highlighted; click = jump. */
export default function ScenesCompact({ data, videoEl, item }) {
  const now = useVideoTime(videoEl);
  const cur = sceneAt(data.scenes, now);
  const jump = (i) => {
    if (videoEl) videoEl.currentTime = data.scenes[i].start;
  };

  return (
    <section className="pl-pn sm-pn" data-panel="scenes">
      <h4>
        Scenes <span className="pl-h-note">{data.scenes.length} · labelmaster</span>
      </h4>
      {data.scenes.map((x, i) => (
        <button type="button" key={x.start} className={`pl-li${i === cur ? ' is-cur' : ''}`} onClick={() => jump(i)}>
          <span className="pl-dot" style={{ background: GROUP_COLOR[x.group] || GROUP_COLOR.other }} />
          <span className="pl-nm">{sceneName(x)}</span>
          <span className="pl-sub">{fmtTime(x.start)}</span>
        </button>
      ))}
      <LabelButtons path={item?.path} labelled />
      <div className="sm-foot">
        <button type="button" className="pl-btn sm" onClick={() => openSceneManager(item)} disabled={!item?.path}>🎬 Open Scene Manager ↗</button>
      </div>
    </section>
  );
}
