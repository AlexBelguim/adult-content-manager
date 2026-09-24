import React from 'react';
import { fmtTime, sceneColor, sceneEnd, sceneFunscript, sceneStart, validScenes } from './playerUtils';
import './player.css';

/** Same destination as SceneManagerWrapper's `sceneManagerToggle` handler. */
export function openSceneManager(item) {
  const url = new URL(window.location.href);
  url.pathname = '/scene-manager';
  url.search = '';
  url.hash = '';
  if (item.url) url.searchParams.set('videoSrc', item.url);
  if (item.path) url.searchParams.set('filePath', item.path);
  window.open(url.toString(), '_blank', 'noopener');
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
      {list.map((scene, i) => (
        <button type="button" className="pl-li" key={scene.id ?? i} onClick={() => jump(scene)} title={sceneFunscript(scene) ? 'Has its own funscript' : undefined}>
          <span className="pl-dot" style={{ background: sceneColor(i) }} />
          <span className="pl-nm">{sceneFunscript(scene) ? '🤖 ' : ''}{scene.name || `Scene ${i + 1}`}</span>
          <span className="pl-sub">{fmtTime(sceneStart(scene))} – {fmtTime(sceneEnd(scene))}</span>
        </button>
      ))}
      <div style={{ marginTop: 8 }}>
        <button type="button" className="pl-btn sm" onClick={() => openSceneManager(item)} disabled={!item?.path}>
          🎬 Open Scene Manager ↗
        </button>
      </div>
    </section>
  );
}
