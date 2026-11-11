/**
 * useHashQueue — the server's hash-build queue, read from the shared jobs store (useJobs).
 *
 * jobs: the hash rows of /api/jobs. jobFor(performerId): her queued or running build in the shape
 * components/performers/model.js expects ({ jobId, performerId, status: 'queued'|'processing',
 * progress 0-100, processed, total }), or null; a build queued past the list's 100-row cap is found
 * in the capped entry's rest. enqueue(items): POST /api/hashes/queue with
 * [{ performerId, mode: 'append'|'replace' }], then a fresh read of the list; it answers the server's
 * { queued, skipped } and throws on an HTTP error.
 */
import { useCallback, useMemo } from 'react';
import useJobs from './useJobs';
import { hashPost } from '../components/hash/hashApi';

export default function useHashQueue() {
  const { jobs, capped, loaded, refresh } = useJobs();

  const hashJobs = useMemo(() => (jobs || []).filter(j => j.type === 'hash'), [jobs]);
  const rest = useMemo(() => {
    const m = new Map();
    for (const c of capped || []) {
      if (c.kind !== 'hash' || !Array.isArray(c.rest)) continue;
      for (const r of c.rest) m.set(Number(r.performerId), String(r.jobId));
    }
    return m;
  }, [capped]);

  const jobFor = useCallback((performerId) => {
    const id = Number(performerId);
    const j = hashJobs.find(r => (r.status === 'queued' || r.status === 'running') && r.raw?.performerId === id);
    if (!j) {
      const jobId = rest.get(id);
      return jobId ? { jobId, performerId: id, status: 'queued', progress: 0, processed: 0, total: 0 } : null;
    }
    return {
      jobId: j.sourceId,
      performerId: id,
      status: j.status === 'running' ? 'processing' : 'queued',
      progress: Math.min(100, Math.max(0, Math.round((j.progress ?? 0) * 100))),
      processed: j.done ?? 0,
      total: j.total ?? 0
    };
  }, [hashJobs, rest]);

  const enqueue = useCallback(async (items) => {
    const answer = await hashPost('/queue', { items });
    // The build is queued whatever the read does; a failed read only waits for the next poll.
    try { await refresh?.(); } catch { /* the store shows its own error */ }
    return answer;
  }, [refresh]);

  return { jobs: hashJobs, jobFor, enqueue, refresh, loaded };
}
