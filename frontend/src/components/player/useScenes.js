import { useEffect, useState } from 'react';

const NONE = [];

/**
 * Scenes of a video: GET /api/scenes/video?path=.
 * Refreshes on the `scenesUpdated` window event and when the tab becomes visible
 * again (the Scene Manager lives in its own tab, whose events never reach this one).
 * Pass a falsy path (pictures) to get an empty list without a request.
 */
export default function useScenes(path) {
  const [state, setState] = useState({ path: null, scenes: NONE });

  useEffect(() => {
    if (!path) return undefined;

    let cancelled = false;
    const load = async () => {
      let next = NONE;
      try {
        const res = await fetch(`/api/scenes/video?path=${encodeURIComponent(path)}`);
        if (!res.ok) return;
        const data = await res.json();
        if (Array.isArray(data.scenes)) next = data.scenes;
      } catch (e) {
        next = NONE;
      }
      if (cancelled) return;
      // keep the old array when nothing changed so consumers' effects don't re-run
      setState((prev) => (
        prev.path === path && JSON.stringify(prev.scenes) === JSON.stringify(next) ? prev : { path, scenes: next }
      ));
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') load();
    };

    load();
    window.addEventListener('scenesUpdated', load);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      window.removeEventListener('scenesUpdated', load);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [path]);

  // Never hand out the previous file's scenes while the next file is loading.
  return path && state.path === path ? state.scenes : NONE;
}
