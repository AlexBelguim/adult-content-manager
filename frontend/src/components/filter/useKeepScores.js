import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage } from './filterUtils';

const AHEAD = 30; // pictures scored ahead of the current one
const CHUNK = 50; // pictures per request: the AI server holds a request's pictures in memory
const REFIT_EVERY = 10; // decisions after which the scores are stale: K has refit on her
export const K_READY = 20; // her sorted pictures before the sorted view is offered

export const kZone = (score) => (score >= 60 ? 'keep' : score <= 40 ? 'delete' : 'unsure');

/**
 * K's keep % for the performer's pictures while filtering (the AI toggle). The AI server refits K on
 * her sorted pictures for every request, so the pictures ahead are scored again every REFIT_EVERY
 * decisions; scoreAll scores the rest for the sorted view. One request at a time: the server has one
 * model slot and refits once per change of her sorted pictures.
 */
export default function useKeepScores({ performerId, enabled, files, currentIndex, decisions }) {
  const [scores, setScores] = useState({});
  const [learned, setLearned] = useState(0);
  const [error, setError] = useState(null);
  const queue = useRef(Promise.resolve());
  const pending = useRef(new Set());
  const scoresRef = useRef(scores);
  scoresRef.current = scores;

  const request = useCallback((paths) => {
    paths.forEach((p) => pending.current.add(p));
    const run = queue.current.then(async () => {
      try {
        const res = await fetch('/api/filter/keep-scores', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ performerId, paths })
        });
        if (!res.ok) throw new Error(await errorMessage(res));
        const data = await res.json();
        setLearned(data.learned);
        setScores((s) => ({ ...s, ...data.scores }));
        setError(null);
        return data.scores;
      } finally {
        paths.forEach((p) => pending.current.delete(p));
      }
    });
    queue.current = run.catch(() => {});
    return run;
  }, [performerId]);

  useEffect(() => {
    setScores({});
    setLearned(0);
    setError(null);
  }, [performerId]);

  const round = Math.floor(decisions / REFIT_EVERY);
  useEffect(() => setScores({}), [round]);

  useEffect(() => {
    if (!enabled) return;
    const todo = files.slice(currentIndex, currentIndex + AHEAD).map((f) => f.path)
      .filter((p) => !(p in scores) && !pending.current.has(p));
    if (todo.length) request(todo).catch((err) => setError(err.message));
  }, [enabled, files, currentIndex, scores, request]);

  const scoreAll = useCallback(async (paths, onProgress) => {
    for (let i = 0; i < paths.length; i += CHUNK) {
      const part = paths.slice(i, i + CHUNK).filter((p) => !(p in scoresRef.current));
      if (part.length) await request(part);
      onProgress(Math.min(paths.length, i + CHUNK));
    }
  }, [request]);

  return { scores, learned, error, scoreAll };
}
