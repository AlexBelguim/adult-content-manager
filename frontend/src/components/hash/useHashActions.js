import React, { useState } from 'react';
import CheckHashModal from '../CheckHashModal';
import HashResultsModal from '../HashResultsModal';

/**
 * A performer's hash-database actions, for Performer Management's rows and duplicate pairs (they were the
 * separate Hash Management page). Building goes through App.js's hash queue, so it keeps running when the
 * page is left; a check opens its results in a new tab (/hash-results/:runId); "compare" without a target
 * asks for one in CheckHashModal. Render `modals` once on the page.
 */
const LOADING = (what) => `<html><head><title>Loading...</title><style>body{background:#141416;color:#ededef;display:flex;align-items:center;`
  + `justify-content:center;height:100vh;font-family:sans-serif;}@keyframes spin{to{transform:rotate(360deg)}}</style></head><body>`
  + `<div style="text-align:center"><div style="width:40px;height:40px;border:4px solid #444;border-top-color:#f0703a;border-radius:50%;`
  + `animation:spin 1s linear infinite;margin:0 auto 16px;"></div>${what}</div></body></html>`;

export default function useHashActions({ basePath, hashQueue = [], setHashQueue, onChanged, onError }) {
  const [busy, setBusy] = useState(() => new Set());
  const [pickFor, setPickFor] = useState(null);   // a performer id: CheckHashModal asks whom to compare her with
  const [runId, setRunId] = useState(null);

  const queued = (id) => hashQueue.some(j => j.performerId === id && (j.status === 'queued' || j.status === 'processing'));

  /** Queue building her hash DB: a rebuild ('replace') when she has one. */
  const build = (performer) => {
    if (!basePath) return onError('Base path is not configured. Set it in settings first.');
    if (!setHashQueue || queued(performer.id)) return undefined;
    setHashQueue(prev => [...prev, {
      id: `job-${Date.now()}-${performer.id}`,
      performerId: performer.id,
      performerName: performer.name,
      location: performer.location,
      mode: performer.hasHashDB ? 'replace' : 'append',
      status: 'queued',
      processed: 0,
      total: 0,
      progress: 0
    }]);
    return undefined;
  };

  const remove = async (performer) => {
    if (!window.confirm(`Delete ${performer.name}'s hash database? This cannot be undone.`)) return;
    const res = await fetch(`/api/hashes/performer/${performer.id}`, { method: 'DELETE' });
    if (res.ok) onChanged?.();
    else onError(`Failed to delete the hash DB: ${res.statusText}`);
  };

  const run = async (sourceId, targetId) => {
    const key = `${sourceId}-${targetId}`;
    if (busy.has(key)) return;
    setBusy(prev => new Set(prev).add(key));
    const tab = window.open('about:blank', '_blank');
    tab?.document.write(LOADING(sourceId === targetId ? 'Checking…' : 'Comparing…'));
    try {
      const res = await fetch('/api/hashes/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_performer_id: sourceId, target_performer_id: targetId })
      });
      const data = await res.json();
      if (!data.success || !data.runId) throw new Error(data.error || 'The check failed');
      if (tab) tab.location.href = `/hash-results/${data.runId}`;
    } catch (err) {
      onError(err.message);
      tab?.close();
    } finally {
      setBusy(prev => { const next = new Set(prev); next.delete(key); return next; });
    }
  };

  /** Duplicates inside her own files. */
  const checkOwn = (id) => run(id, id);
  /** Her files against another performer's; without a target, ask for one. */
  const compare = (sourceId, targetId) => (targetId ? run(sourceId, targetId) : setPickFor(sourceId));
  const isBusy = (sourceId, targetId = sourceId) => busy.has(`${sourceId}-${targetId}`);

  const modals = (
    <>
      <CheckHashModal
        open={!!pickFor}
        onClose={() => setPickFor(null)}
        basePath={basePath}
        performerId={pickFor}
        onRunCreated={(id) => { setPickFor(null); setRunId(id); }}
      />
      <HashResultsModal open={!!runId} onClose={() => { setRunId(null); onChanged?.(); }} runId={runId} />
    </>
  );

  return { queued, build, remove, checkOwn, compare, isBusy, modals };
}
