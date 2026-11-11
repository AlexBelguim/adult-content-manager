import { useCallback, useEffect, useRef, useState } from 'react';
import { fileNameOf } from './playerUtils';

const NONE = [];
const LIST_ERROR = 'Could not list the funscripts.';

const sizeOf = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const normalize = (f) => {
  if (typeof f === 'string') return { name: fileNameOf(f), path: f, size: null, axis: '' };
  return { name: f.name || fileNameOf(f.path), path: f.path, size: sizeOf(f.size), axis: f.axis || '' };
};

/**
 * Funscripts that belong to a video: GET /api/funscripts?file=<path>.
 * Returns { funscripts: [{ name, path, size, axis }], loaded, error, reload }.
 * error is 'Could not list the funscripts.' when the server said no or did not answer, else null.
 * Pass a falsy path (pictures) to get an empty list without a request.
 */
export default function useFunscripts(path) {
  const [state, setState] = useState({ path: null, funscripts: NONE, loaded: false, error: null });
  const latestPath = useRef(path);
  latestPath.current = path;

  const reload = useCallback(async () => {
    if (!path) {
      setState({ path, funscripts: NONE, loaded: true, error: null });
      return;
    }
    // A retry after a failed list shows as loading again; reloading a good list keeps it on screen.
    setState((s) => (s.path === path && s.error ? { ...s, loaded: false, error: null } : s));
    let funscripts = NONE;
    let error = null;
    try {
      const res = await fetch(`/api/funscripts?file=${encodeURIComponent(path)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const list = Array.isArray(data?.funscripts) ? data.funscripts : [];
      funscripts = list.filter((f) => typeof f === 'string' || (f && f.path)).map(normalize);
    } catch (e) {
      funscripts = NONE;
      error = LIST_ERROR;
    }
    if (latestPath.current === path) setState({ path, funscripts, loaded: true, error });
  }, [path]);

  useEffect(() => {
    reload();
  }, [reload]);

  // Never hand out the previous file's scripts while the next file is loading.
  const current = state.path === path;
  return {
    funscripts: current ? state.funscripts : NONE,
    loaded: current && state.loaded,
    error: current ? state.error : null,
    reload
  };
}
