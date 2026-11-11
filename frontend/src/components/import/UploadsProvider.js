/**
 * Uploads from this browser, app-wide: mounted once in App.js inside the Router (and ShellProvider), so an upload
 * keeps going on every page. One upload runs at a time, oldest first, batch by batch; then it is handed over to the
 * server's import queue and watched until the import ends.
 *
 *   const { uploads, busy, addUpload, retryUpload, cancelUpload, watchJobs } = useUploads();
 *
 * The File objects live in a ref only, so uploads do not survive a reload; while one is waiting, uploading or
 * handing over, leaving the page asks first. watchJobs() also serves the server-folder imports: it polls the
 * import queue every 3 s while anything is watched and shows a toast when they end.
 */
import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { errorText, useAsk, useNotify } from '../ui';
import {
  discardUpload, fmtBytes, handOver, makeBatches, newUploadId, queueStatus, removeImportJob, retryImportJob,
  sendBatch, summaryText, sumText, uploadStatus
} from './importApi';

const POLL_MS = 3000;
const PROGRESS_MS = 250;

const noop = () => {};
const DEFAULT = Object.freeze({
  uploads: Object.freeze([]),
  busy: false,
  addUpload: () => null,
  retryUpload: () => Promise.resolve(),
  cancelUpload: () => Promise.resolve(false),
  watchJobs: noop
});

const UploadsContext = createContext(null);

const isBusy = (u) => u.status === 'waiting' || u.status === 'uploading' || u.status === 'handing-over';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export function UploadsProvider({ basePath, children }) {
  const notify = useNotify();
  const ask = useAsk();
  const navigate = useNavigate();

  const [uploads, setUploads] = useState([]);
  const [kick, setKick] = useState(0);

  // What the functions read; they are made once.
  const live = useRef({});
  live.current = { basePath, notify, ask, navigate };

  const rowsRef = useRef([]);         // the source of truth; `uploads` is its last commit
  const filesRef = useRef({});        // id -> [{ file, rel, size }]
  const batchesRef = useRef({});      // id -> [[index…]…]
  const xhrRef = useRef({});          // id -> { current: xhr | wait }
  const cancelled = useRef(new Set());
  const runningRef = useRef(null);    // the id the runner works on
  const watched = useRef(new Map());  // jobId (string) -> title
  const pollTimer = useRef(null);
  const commitTimer = useRef(null);
  const mounted = useRef(true);

  const api = useRef(null);
  if (!api.current) {
    const commit = () => {
      if (commitTimer.current) { clearTimeout(commitTimer.current); commitTimer.current = null; }
      if (mounted.current) setUploads(rowsRef.current);
    };
    const commitSoon = () => {
      if (commitTimer.current) return;
      commitTimer.current = setTimeout(() => { commitTimer.current = null; if (mounted.current) setUploads(rowsRef.current); }, PROGRESS_MS);
    };
    const getRow = (id) => rowsRef.current.find(u => u.id === id) || null;
    const patch = (id, p, { soon = false } = {}) => {
      let hit = false;
      rowsRef.current = rowsRef.current.map(u => {
        if (u.id !== id) return u;
        hit = true;
        return { ...u, ...(typeof p === 'function' ? p(u) : p) };
      });
      if (!hit) return;
      if (soon) commitSoon(); else commit();
    };
    const dropRow = (id) => {
      rowsRef.current = rowsRef.current.filter(u => u.id !== id);
      delete filesRef.current[id];
      delete batchesRef.current[id];
      delete xhrRef.current[id];
      commit();
    };
    const bp = (row) => (row && row.basePath) || live.current.basePath || undefined;
    const toJobs = () => live.current.navigate('/jobs');

    const batchBytes = (id) => {
      const list = filesRef.current[id] || [];
      return (batchesRef.current[id] || []).map(b => b.reduce((s, i) => s + (list[i] ? list[i].size : 0), 0));
    };
    const bytesOf = (id, indices) => {
      const sizes = batchBytes(id);
      return indices.reduce((s, i) => s + (sizes[i] || 0), 0);
    };

    // ── watching import jobs ─────────────────────────────────
    const schedulePoll = () => {
      if (pollTimer.current || watched.current.size === 0 || !mounted.current) return;
      pollTimer.current = setTimeout(poll, POLL_MS);
    };

    const watchJobs = (list) => {
      (list || []).forEach(j => {
        if (!j || j.jobId === null || j.jobId === undefined) return;
        watched.current.set(String(j.jobId), j.title || 'the import');
      });
      schedulePoll();
    };

    const poll = async () => {
      pollTimer.current = null;
      if (!mounted.current || watched.current.size === 0) return;
      let data;
      try {
        data = await queueStatus();
      } catch (e) {
        schedulePoll(); // a failed poll is tried again on the next tick
        return;
      }
      if (!mounted.current) return;
      const byId = new Map((data && Array.isArray(data.queue) ? data.queue : []).map(j => [String(j.id), j]));
      const finished = [];

      Array.from(watched.current.entries()).forEach(([jobId, title]) => {
        const job = byId.get(jobId);
        const row = rowsRef.current.find(u => u.jobId !== null && u.jobId !== undefined && String(u.jobId) === jobId) || null;
        if (!job) {
          watched.current.delete(jobId);
          if (row) {
            patch(row.id, { status: 'failed', failedAt: 'hand-over', error: 'The server no longer has this import', jobStage: null });
          }
          return;
        }
        if (job.status === 'completed') {
          watched.current.delete(jobId);
          if (row) dropRow(row.id);
          finished.push({ title, report: job.report || null });
          return;
        }
        if (job.status === 'error') {
          // An upload row stays watched while it is failed at import: a Retry from the Jobs page brings it back.
          if (row && row.status === 'failed' && row.failedAt === 'import') return;
          if (!row) watched.current.delete(jobId);
          const error = job.error || 'it did not work';
          // leftOver: the import placed the rest; only these files are still in the server's temp folder
          const leftOver = job.report && job.report.leftIn ? Number(job.report.failed) || 0 : 0;
          if (row) patch(row.id, { status: 'failed', failedAt: 'import', error, jobStage: null, leftOver });
          live.current.notify({
            message: `Import of ${title} failed: ${error}`,
            severity: 'error',
            action: { label: 'Jobs', onClick: toJobs }
          });
          return;
        }
        if (row && row.status === 'failed' && row.failedAt === 'import') {
          // Run again from elsewhere (the Jobs page): follow it as importing.
          patch(row.id, { status: 'importing', failedAt: null, error: null, leftOver: 0, jobDone: 0, jobTotal: row.totalFiles, jobStage: null });
        }
        const cur = row ? getRow(row.id) : null;
        if (cur && cur.status === 'importing') {
          const total = Number(job.totalFiles) || row.totalFiles || 0;
          const progress = Math.max(0, Math.min(100, Number(job.progress) || 0));
          patch(row.id, {
            jobDone: Math.round((progress * total) / 100),
            jobTotal: total,
            jobStage: job.stage || null,
            jobStatus: job.status
          });
        }
      });

      if (finished.length > 0) {
        live.current.notify({
          message: finished.length === 1 ? summaryText(finished[0].title, finished[0].report) : sumText(finished.map(f => f.report)),
          severity: 'success',
          action: { label: 'Details', onClick: toJobs }
        });
      }
      schedulePoll();
    };

    const startImporting = (id, jobId) => {
      const row = getRow(id);
      if (!row) return;
      patch(id, { status: 'importing', failedAt: null, error: null, leftOver: 0, jobId, jobDone: 0, jobTotal: row.totalFiles, jobStage: null, jobStatus: 'queued', currentBatch: null });
      watchJobs([{ jobId, title: row.name }]);
    };

    // ── the runner ───────────────────────────────────────────
    const stopped = (id) => cancelled.current.has(id) || !getRow(id);

    const handOverRow = async (id) => {
      const row = getRow(id);
      patch(id, { status: 'handing-over', currentBatch: null, error: null, failedAt: null });
      try {
        const res = await handOver(bp(row), {
          uploadId: id,
          performerName: row.name,
          totalFiles: row.totalFiles,
          totalBatches: row.totalBatches,
          createHashes: row.createHashes,
          sourceLabel: row.sourceLabel
        });
        if (!res || res.jobId === null || res.jobId === undefined) {
          throw new Error('The server did not take the upload');
        }
        if (stopped(id)) return;
        startImporting(id, res.jobId);
      } catch (err) {
        if (stopped(id)) return;
        if (err.code === 'missing-batches') {
          const missing = Array.isArray(err.body && err.body.missing) ? err.body.missing.map(Number) : [];
          const done = (getRow(id).doneBatches || []).filter(i => !missing.includes(i));
          patch(id, {
            status: 'failed',
            failedAt: 'upload',
            doneBatches: done,
            sentBytes: bytesOf(id, done),
            error: `The server is missing batches ${missing.map(i => i + 1).join(', ')}`
          });
        } else if (err.code === 'count-mismatch') {
          // The batches are there but hold other files than this tab sent: Retry sends every batch again.
          const b = err.body || {};
          patch(id, {
            status: 'failed',
            failedAt: 'upload',
            resendAll: true,
            error: b.have !== undefined && b.want !== undefined
              ? `The server has ${b.have} of ${b.want} files`
              : errorText(err, 'The server has other files than were sent')
          });
        } else {
          patch(id, { status: 'failed', failedAt: 'hand-over', error: errorText(err, 'The hand-over did not work') });
        }
      }
    };

    const run = async (id) => {
      runningRef.current = id;
      try {
        const row = getRow(id);
        const list = filesRef.current[id];
        const batches = batchesRef.current[id];
        if (!row) return;
        if (!list || !batches) {
          patch(id, { status: 'failed', failedAt: 'upload', error: 'The files are no longer in this tab: choose them again' });
          return;
        }
        const sizes = batchBytes(id);
        const done = new Set(row.doneBatches || []);
        const doneBytes = () => Array.from(done).reduce((s, i) => s + (sizes[i] || 0), 0);
        patch(id, { status: 'uploading', failedAt: null, error: null, sentBytes: doneBytes() });

        const ref = { current: null };
        xhrRef.current[id] = ref;
        for (let i = 0; i < batches.length; i += 1) {
          if (done.has(i)) continue;
          if (stopped(id)) return;
          const before = doneBytes();
          patch(id, { currentBatch: i, sentBytes: before });
          try {
            await sendBatch({
              basePath: bp(row),
              uploadId: id,
              batchIndex: i,
              totalBatches: batches.length,
              files: batches[i].map(k => list[k]),
              xhrRef: ref,
              onProgress: (loaded) => {
                if (stopped(id)) return;
                patch(id, { sentBytes: before + Math.min(loaded, sizes[i] || 0) }, { soon: true });
              }
            });
          } catch (err) {
            if (stopped(id) || err.code === 'aborted') return;
            if (err.code === 'handed-over') {
              // The server already has a job for this upload: follow that one.
              try {
                const st = await uploadStatus(bp(row), id);
                if (st && st.job && st.job.id !== null && st.job.id !== undefined) {
                  if (!stopped(id)) startImporting(id, st.job.id);
                  return;
                }
              } catch (e) { /* the failure below says enough */ }
            }
            patch(id, { status: 'failed', failedAt: 'upload', error: errorText(err, 'The upload did not work') });
            return;
          }
          done.add(i);
          patch(id, { doneBatches: Array.from(done).sort((a, b) => a - b), sentBytes: doneBytes() });
        }
        if (stopped(id)) return;
        await handOverRow(id);
      } finally {
        delete xhrRef.current[id];
        runningRef.current = null;
        if (mounted.current) setKick(k => k + 1);
      }
    };

    // ── what the context offers ──────────────────────────────
    const addUpload = ({ name, sourceLabel, files, createHashes } = {}) => {
      const list = (files || [])
        .filter(f => f && f.file)
        .map(f => ({ file: f.file, rel: f.rel || f.file.name, size: Number(f.file.size) || 0 }));
      if (list.length === 0) return null;
      const id = newUploadId();
      const batches = makeBatches(list);
      filesRef.current[id] = list;
      batchesRef.current[id] = batches;
      const totalBytes = list.reduce((s, f) => s + f.size, 0);
      rowsRef.current = [...rowsRef.current, {
        id,
        name: String(name || '').trim(),
        sourceLabel: sourceLabel || '',
        createHashes: createHashes !== false,
        basePath: live.current.basePath || null,
        totalFiles: list.length,
        totalBytes,
        totalBatches: batches.length,
        status: 'waiting',
        failedAt: null,
        sentBytes: 0,
        doneBatches: [],
        currentBatch: null,
        jobId: null,
        jobDone: 0,
        jobTotal: list.length,
        jobStage: null,
        jobStatus: null,
        leftOver: 0,
        resendAll: false,
        error: null,
        createdAt: new Date().toISOString()
      }];
      commit();
      return id;
    };

    const retrying = new Set();
    const retryUpload = async (id) => {
      const row = getRow(id);
      if (!row || row.status !== 'failed' || retrying.has(id)) return;
      retrying.add(id);
      try {
        await retryRow(id, row);
      } finally {
        retrying.delete(id);
      }
    };

    const retryRow = async (id, row) => {

      if (row.failedAt === 'import' && row.jobId !== null && row.jobId !== undefined) {
        try {
          await retryImportJob(row.jobId);
          startImporting(id, row.jobId);
          return;
        } catch (err) {
          if (err.code === 'not-failed') {
            // Run again from elsewhere meanwhile (the Jobs page): follow it; the poll ends it when it is done.
            const data = await queueStatus().catch(() => null);
            const job = data && Array.isArray(data.queue) ? data.queue.find(j => String(j.id) === String(row.jobId)) : null;
            if (job) { startImporting(id, row.jobId); return; }
          }
          if (err.code === 'temp-gone') {
            // The uploaded files are gone from the server: drop that job and send them again.
            await removeImportJob(row.jobId).catch(noop);
            patch(id, { jobId: null, failedAt: 'upload', doneBatches: [], sentBytes: 0 });
          } else if (err.code === 'not-found' || err.code === 'not-failed') {
            // The job is gone (removed, or the server restarted): hand over again, or resend what the server lacks.
            watched.current.delete(String(row.jobId));
            patch(id, { jobId: null, failedAt: 'hand-over' });
          } else {
            throw err;
          }
        }
      }

      if (!filesRef.current[id] || !batchesRef.current[id]) {
        throw new Error('The files are no longer in this tab: choose them again');
      }
      const st = await uploadStatus(bp(row), id);
      if (!getRow(id)) return;
      if (st && st.job && st.job.id !== null && st.job.id !== undefined) {
        if (st.job.status === 'error') await retryImportJob(st.job.id);
        startImporting(id, st.job.id);
        return;
      }
      const total = row.totalBatches;
      const done = !row.resendAll && st && st.exists && Array.isArray(st.batches)
        ? st.batches.map(Number).filter(i => Number.isInteger(i) && i >= 0 && i < total).sort((a, b) => a - b)
        : [];
      cancelled.current.delete(id);
      patch(id, {
        status: 'waiting',
        failedAt: null,
        error: null,
        jobId: null,
        resendAll: false,
        doneBatches: done,
        sentBytes: bytesOf(id, done),
        currentBatch: null
      });
    };

    const cancelUpload = async (id) => {
      const row = getRow(id);
      if (!row) return false;
      if (row.status === 'waiting') {
        cancelled.current.add(id);
        dropRow(id);
        discardUpload(bp(row), id).catch(noop);
        return true;
      }
      if (row.status !== 'uploading' && row.status !== 'failed') return false;

      const atImport = row.status === 'failed' && row.failedAt === 'import';
      const n = row.leftOver || 0;
      const text = atImport && n
        ? `${n === 1 ? '1 file could not be moved and is' : `${n} files could not be moved and are`} kept on the server. Cancelling deletes ${n === 1 ? 'it' : 'them'} there. The rest is imported. The files on this computer are not touched.`
        : atImport
        ? `${fmtBytes(row.totalBytes)} is on the server. Cancelling deletes the uploaded files from the server. Nothing is imported. The files on this computer are not touched.`
        : `${fmtBytes(row.sentBytes)} of ${fmtBytes(row.totalBytes)} is on the server. Cancelling stops the upload and deletes that from the server's temp folder. Nothing is imported. The files on this computer are not touched.`;

      const answer = await live.current.ask({
        title: `Cancel the upload of ${row.name}?`,
        text,
        okLabel: 'Cancel upload',
        cancelLabel: row.status === 'failed' ? 'Keep it' : 'Keep uploading',
        danger: true,
        run: async () => {
          const cur = getRow(id);
          if (!cur) return;
          if (cur.status === 'handing-over' || cur.status === 'importing') {
            throw new Error('The server took it over in the meantime: see Jobs');
          }
          if (cur.status === 'failed' && cur.failedAt === 'import' && cur.jobId !== null && cur.jobId !== undefined) {
            try {
              await removeImportJob(cur.jobId);
            } catch (err) {
              if (err.status !== 404 && err.code !== 'not-found') throw err;
              await discardUpload(bp(cur), id); // the job is gone already: delete what is left of the files
            }
            watched.current.delete(String(cur.jobId));
            cancelled.current.add(id);
            return;
          }
          const wasRunning = cur.status === 'uploading';
          cancelled.current.add(id);
          const ref = xhrRef.current[id];
          if (ref && ref.current) ref.current.abort();
          try {
            if (wasRunning) await sleep(250); // let the server drop the half-sent batch first
            await discardUpload(bp(cur), id);
          } catch (err) {
            // Stopped, but the server keeps its part: the row stays, failed, so it can be cancelled or retried.
            cancelled.current.delete(id);
            if (getRow(id)) {
              patch(id, { status: 'failed', failedAt: 'upload', currentBatch: null, error: `Stopped, but the server still has the uploaded part: ${errorText(err)}` });
            }
            throw err;
          }
        }
      });
      if (answer === true) dropRow(id);
      return answer === true;
    };

    api.current = { addUpload, retryUpload, cancelUpload, watchJobs, run };
  }

  // The runner: one upload at a time, oldest waiting first.
  useEffect(() => {
    if (runningRef.current) return;
    if (uploads.some(u => u.status === 'uploading' || u.status === 'handing-over')) return;
    const next = uploads.find(u => u.status === 'waiting');
    if (next) api.current.run(next.id);
  }, [uploads, kick]);

  const busy = uploads.some(isBusy);

  // Leaving the page while files are still to be sent stops the upload: ask first.
  useEffect(() => {
    if (!busy) return undefined;
    const onLeave = (e) => {
      e.preventDefault();
      e.returnValue = '';
      return '';
    };
    window.addEventListener('beforeunload', onLeave);
    return () => window.removeEventListener('beforeunload', onLeave);
  }, [busy]);

  useEffect(() => {
    mounted.current = true;
    const xhrs = xhrRef.current; // the one map, kept for the life of the provider
    return () => {
      mounted.current = false;
      clearTimeout(pollTimer.current);
      clearTimeout(commitTimer.current);
      pollTimer.current = null;
      commitTimer.current = null;
      Object.values(xhrs).forEach(ref => { if (ref && ref.current) ref.current.abort(); });
    };
  }, []);

  const value = useMemo(() => ({
    uploads,
    busy,
    addUpload: api.current.addUpload,
    retryUpload: api.current.retryUpload,
    cancelUpload: api.current.cancelUpload,
    watchJobs: api.current.watchJobs
  }), [uploads, busy]);

  return <UploadsContext.Provider value={value}>{children}</UploadsContext.Provider>;
}

/** The app's browser uploads; outside a provider, an empty list and functions that do nothing. */
export function useUploads() {
  return useContext(UploadsContext) || DEFAULT;
}

export default UploadsProvider;
