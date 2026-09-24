import { useCallback, useEffect, useRef, useState } from 'react';

const NONE = [];

/**
 * Funscripts that belong to a video: GET /api/funscripts?file=<path>.
 * Returns { funscripts: [{ name, path }], loaded, reload }.
 * Pass a falsy path (pictures) to get an empty list without a request.
 */
export default function useFunscripts(path) {
  const [state, setState] = useState({ path: null, funscripts: NONE, loaded: false });
  const latestPath = useRef(path);
  latestPath.current = path;

  const reload = useCallback(async () => {
    if (!path) {
      setState({ path, funscripts: NONE, loaded: true });
      return;
    }
    let funscripts = NONE;
    try {
      const res = await fetch(`/api/funscripts?file=${encodeURIComponent(path)}`);
      const data = await res.json();
      funscripts = (data.funscripts || []).map((f) => (typeof f === 'string' ? { name: f, path: f } : f));
    } catch (e) {
      funscripts = NONE;
    }
    if (latestPath.current === path) setState({ path, funscripts, loaded: true });
  }, [path]);

  useEffect(() => {
    reload();
  }, [reload]);

  // Never hand out the previous file's scripts while the next file is loading.
  const current = state.path === path;
  return {
    funscripts: current ? state.funscripts : NONE,
    loaded: current && state.loaded,
    reload
  };
}
