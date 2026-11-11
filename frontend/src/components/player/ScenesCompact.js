import React from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { fmtTime } from './playerUtils';
import { sceneEditorUrl } from './ScenesPanel';
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
        {item?.path ? (
          <RouterLink className="pl-btn sm" to={sceneEditorUrl(item)}>🎬 Open in scene editor</RouterLink>
        ) : (
          <button type="button" className="pl-btn sm" disabled>🎬 Open in scene editor</button>
        )}
      </div>
    </section>
  );
}
