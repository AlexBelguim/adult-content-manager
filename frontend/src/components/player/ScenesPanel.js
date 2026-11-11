import React from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { fmtTime, sceneColor, sceneEnd, sceneFunscript, sceneStart, validScenes } from './playerUtils';
import LabelButtons from './LabelButtons';
import './player.css';

/** The scene editor's one URL; App redirects the old /scene-manager?filePath=&videoSrc= here. */
export function sceneEditorUrl(item) {
  return `/scene-editor?video=${encodeURIComponent(item?.path || '')}`;
}

/**
 * Scene list of the current video. Click = jump. Colours match the segments
 * MediaStage draws on the seek bar (same order, same palette).
 */
export default function ScenesPanel({ item, scenes, videoRef, onJump }) {
  const list = validScenes(scenes);

  const jump = (scene) => {
    const t = sceneStart(scene);
    if (onJump) onJump(t, scene);
    else if (videoRef?.current) videoRef.current.currentTime = t;
  };

  return (
    <section className="pl-pn" data-panel="scenes">
      <h4>Scenes</h4>
      {list.length === 0 && <p className="pl-hint">No scenes yet.</p>}
      <LabelButtons path={item?.path} labelled={false} />
      {list.map((scene, i) => (
        <button type="button" className="pl-li" key={scene.id ?? i} onClick={() => jump(scene)} title={sceneFunscript(scene) ? 'Has its own funscript' : undefined}>
          <span className="pl-dot" style={{ background: sceneColor(i) }} />
          <span className="pl-nm">{sceneFunscript(scene) ? '🤖 ' : ''}{scene.name || `Scene ${i + 1}`}</span>
          <span className="pl-sub">{fmtTime(sceneStart(scene))} – {fmtTime(sceneEnd(scene))}</span>
        </button>
      ))}
      <div style={{ marginTop: 8 }}>
        {item?.path ? (
          <RouterLink className="pl-btn sm" to={sceneEditorUrl(item)}>🎬 Open in scene editor</RouterLink>
        ) : (
          <button type="button" className="pl-btn sm" disabled>🎬 Open in scene editor</button>
        )}
      </div>
    </section>
  );
}
