/**
 * useJobs — the one polling loop behind the Jobs page and the toolbar indicator.
 *
 * GET /api/jobs already aggregates every server-side queue (import, funpipe,
 * encode, cleanup, server-tracked hash jobs, training). The only thing the
 * server cannot see is the hash / CLIP queue, which lives in App.js state and
 * localStorage — pass it as `hashQueue` and it is merged in here.
 *
 * Polls fast while anything is queued or running, slowly otherwise, and not at
 * all while the tab is hidden.
 */
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';

export const JOB_TYPES = {
  import: 'Import',
  funpipe: 'Funscripts',
  hash: 'Hashing',
  encode: 'Encoding',
  cleanup: 'Cleanup',
  train: 'Training'
};

const HASH_STATUS = { queued: 'queued', processing: 'running', completed: 'done', error: 'failed' };
const SERVICES_EVERY_MS = 10000;

export const isActive = (j) => j.status === 'running' || j.status === 'queued';

/** 0–100, or null when the source reports no progress. */
export const jobPercent = (j) => (j.progress == null ? null : Math.round(j.progress * 100));

/**
 * App-state hash jobs → the normalised shape. When the server tracks the same
 * job (matched through backendJobId) its numbers win: it is the one doing the work.
 */
function mergeHashQueue(serverJobs, hashQueue) {
  if (!hashQueue || hashQueue.length === 0) return serverJobs;

  const serverHash = new Map(serverJobs.filter(j => j.type === 'hash').map(j => [j.sourceId, j]));
  const claimed = new Set();

  const local = hashQueue.map(q => {
    const s = q.backendJobId ? serverHash.get(q.backendJobId) : null;
    if (s) claimed.add(s.id);

    let status = HASH_STATUS[q.status] || 'queued';
    if (s && (s.status === 'done' || s.status === 'failed')) status = s.status;

    const done = s ? s.done : (q.processed || 0);
    const total = s ? s.total : (q.total || null);
    const isClip = String(q.id).startsWith('clip-');

    return {
      ...(s || {}),
      id: `hash:local:${q.id}`,
      sourceId: q.id,
      type: 'hash',
      local: true,
      title: q.performerName || s?.title || 'Performer',
      subtitle: null,
      status,
      progress: status === 'done' ? 1 : (total ? Math.min(1, done / total) : null),
      done, total, unit: 'files',
      stage: null, currentFile: null, note: null, thumbPath: null, link: null,
      elapsedMs: s ? s.elapsedMs : null,
      startedAt: s ? s.startedAt : null,
      finishedAt: s ? s.finishedAt : null,
      error: q.error || s?.error || null,
      result: status === 'done' ? (s?.result || `Processed ${done} files`) : null,
      chips: [
        isClip ? 'CLIP embeddings' : 'Hash DB',
        q.location === 'before' ? 'Before filter' : q.location === 'after' ? 'After filter' : null,
        q.mode === 'replace' || q.mode === 'rebuild' ? 'rebuild' : 'append'
      ].filter(Boolean),
      raw: { ...q, server: s ? s.raw : null }
    };
  });

  return [...serverJobs.filter(j => !claimed.has(j.id)), ...local];
}

/**
 * @param {object}  [opts]
 * @param {Array}   [opts.hashQueue]      App.js hash / CLIP queue
 * @param {number}  [opts.activeMs=2000]  interval while something is queued / running
 * @param {number}  [opts.idleMs=10000]   interval otherwise
 * @param {boolean} [opts.withServices]   also poll GET /api/jobs/services (every 10 s)
 */
export default function useJobs({ hashQueue, activeMs = 2000, idleMs = 10000, withServices = false } = {}) {
  const [serverJobs, setServerJobs] = useState([]);
  const [services, setServices] = useState(null);
  const [loaded, setLoaded] = useState(false);

  const jobs = useMemo(() => mergeHashQueue(serverJobs, hashQueue), [serverJobs, hashQueue]);

  // The loop reads these through refs so changing data never restarts the timer.
  const activeRef = useRef(false);
  activeRef.current = jobs.some(isActive);
  const servicesAt = useRef(0);
  const timer = useRef(null);
  const alive = useRef(true);

  const load = useCallback(async (fresh = false) => {
    const wantServices = withServices && (fresh || Date.now() - servicesAt.current >= SERVICES_EVERY_MS);
    const q = fresh ? '?fresh=1' : '';
    const json = (url) => fetch(url).then(r => (r.ok ? r.json() : null)).catch(() => null);
    const [list, svc] = await Promise.all([
      json(`/api/jobs${q}`),
      wantServices ? json(`/api/jobs/services${q}`) : Promise.resolve(null)
    ]);
    if (!alive.current) return;
    // A failed poll keeps the last good list — a blip must not empty the page.
    if (Array.isArray(list)) setServerJobs(list);
    if (svc) { setServices(svc); servicesAt.current = Date.now(); }
    setLoaded(true);
  }, [withServices]);

  useEffect(() => {
    alive.current = true;

    const schedule = () => {
      clearTimeout(timer.current);
      if (document.hidden) return;
      timer.current = setTimeout(tick, activeRef.current ? activeMs : idleMs);
    };
    const tick = async () => {
      await load();
      if (alive.current) schedule();
    };
    const onVisibility = () => {
      clearTimeout(timer.current);
      if (!document.hidden) tick();
    };

    tick();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      alive.current = false;
      clearTimeout(timer.current);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [load, activeMs, idleMs]);

  /** Re-read now, bypassing the server's short cache of the AI-server queues. */
  const refresh = useCallback(() => load(true), [load]);

  return { jobs, services, loaded, refresh };
}
