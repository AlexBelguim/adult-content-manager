/**
 * useJobs — one shared store behind the Jobs page, the app-bar chip, the phone chrome and the pages that show
 * their own jobs. Every caller reads the same list from one poll of GET /api/jobs?v=2.
 *
 *   const { jobs, capped, services, loaded, error, updatedAt, refresh } = useJobs({ activeMs, idleMs, withServices });
 *
 * - One timer for all callers. Its interval is the smallest over the callers of (anything running ? activeMs :
 *   idleMs); queued alone counts as idle. No polling while the tab is hidden; a poll at once when it shows again.
 * - GET /api/jobs/services every 10 s while any caller passes withServices.
 * - Every request has a sequence number: an answer older than the newest one applied is dropped.
 * - A failed poll keeps the last list and sets `error`; `loaded` turns true after the first good answer.
 * - Browser uploads (Import > From this computer) are merged in per caller from UploadsProvider, with their own
 *   `actions`, until the server has the job.
 * - The first start in a document moves a hash queue left in localStorage by the old browser queue to the server.
 */
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { useUploads } from '../components/import/UploadsProvider';
import { KIND_LABEL, jobPercent as percent } from '../components/jobs/kinds';

export const JOB_TYPES = KIND_LABEL;
export const jobPercent = percent;
export const isActive = (j) => j.status === 'running' || j.status === 'queued';

const SERVICES_EVERY_MS = 10000;
const NO_UPLOADS = [];
const NO_ROWS = Object.freeze([]);
const OFFLINE = "Can't reach the server";

// ── the store ────────────────────────────────────────────────
let snap = Object.freeze({
  jobs: NO_ROWS, capped: NO_ROWS, services: null, loaded: false, error: null, updatedAt: null
});
const listeners = new Set();
const set = (patch) => {
  snap = Object.freeze({ ...snap, ...patch });
  listeners.forEach(l => l());
};
const subscribeStore = (l) => { listeners.add(l); return () => { listeners.delete(l); }; };
const getSnap = () => snap;

// callers: key -> { activeMs, idleMs, withServices, localRunning }
const callers = new Map();

let timer = null;
let servicesTimer = null;
let lastLoadAt = 0;
let jobsSeq = 0;
let jobsApplied = 0;
let servicesSeq = 0;
let servicesApplied = 0;
let visibilityOn = false;

const hidden = () => typeof document !== 'undefined' && document.hidden;
const wantsServices = () => [...callers.values()].some(c => c.withServices);

function intervalMs() {
  // While the server does not answer, the slow interval: the rows that look running may not be.
  const running = !snap.error && snap.jobs.some(j => j.status === 'running');
  let ms = Infinity;
  callers.forEach(c => {
    const own = running || (c.localRunning && !snap.error) ? c.activeMs : c.idleMs;
    if (own < ms) ms = own;
  });
  return ms;
}

function schedule() {
  clearTimeout(timer);
  timer = null;
  if (callers.size === 0 || hidden()) return;
  const ms = intervalMs();
  if (!Number.isFinite(ms)) return;
  const wait = Math.max(0, lastLoadAt + ms - Date.now());
  timer = setTimeout(() => { timer = null; loadJobs(false); }, wait);
}

function scheduleServices() {
  clearTimeout(servicesTimer);
  servicesTimer = null;
  if (!wantsServices() || hidden()) return;
  servicesTimer = setTimeout(() => { servicesTimer = null; loadServices(false); }, SERVICES_EVERY_MS);
}

async function loadJobs(fresh) {
  const my = ++jobsSeq;
  lastLoadAt = Date.now();
  let patch;
  try {
    const res = await fetch(`/api/jobs?v=2${fresh ? '&fresh=1' : ''}`);
    if (!res.ok) {
      patch = { error: `The server answered ${res.status}` };
    } else {
      const data = await res.json();
      // An older server answers the bare array.
      const list = Array.isArray(data) ? data : (data && Array.isArray(data.jobs) ? data.jobs : null);
      if (!list) patch = { error: 'The server sent an answer this page cannot read' };
      else {
        patch = {
          jobs: list,
          capped: (!Array.isArray(data) && Array.isArray(data.capped)) ? data.capped : NO_ROWS,
          loaded: true, error: null, updatedAt: Date.now()
        };
      }
    }
  } catch {
    patch = { error: OFFLINE };
  }
  if (my > jobsApplied) {
    jobsApplied = my;
    set(patch);
  }
  if (callers.size) schedule();
}

async function loadServices(fresh) {
  const my = ++servicesSeq;
  let svc = null;
  try {
    const res = await fetch(`/api/jobs/services${fresh ? '?fresh=1' : ''}`);
    if (res.ok) svc = await res.json();
  } catch { /* the jobs poll says when the server is gone */ }
  if (svc && my > servicesApplied) {
    servicesApplied = my;
    set({ services: svc });
  }
  scheduleServices();
}

function onVisibility() {
  if (hidden()) {
    clearTimeout(timer);
    clearTimeout(servicesTimer);
    timer = null;
    servicesTimer = null;
    return;
  }
  loadJobs(false);
  if (wantsServices()) loadServices(false);
}

/** Load now, bypassing the server's caches. Resolves when the answer is applied (or dropped as stale). */
function refreshAll() {
  const work = [loadJobs(true)];
  if (wantsServices()) work.push(loadServices(true));
  return Promise.all(work).then(() => undefined);
}

// ── the legacy browser hash queue ────────────────────────────
let adopted = false;
async function adoptLegacyHashQueue() {
  if (adopted) return;
  adopted = true;
  let list = null;
  try {
    const raw = window.localStorage.getItem('hashQueue');
    if (raw == null) return;
    list = JSON.parse(raw);
  } catch {
    list = null;
  }
  const items = (Array.isArray(list) ? list : [])
    .filter(q => q && (q.status === 'queued' || (q.status === 'processing' && !q.backendJobId))
      && !String(q.id ?? '').startsWith('clip-') && q.performerId != null)
    .map(q => ({ performerId: q.performerId, mode: (q.mode === 'replace' || q.mode === 'rebuild') ? 'replace' : 'append' }));
  const drop = () => { try { window.localStorage.removeItem('hashQueue'); } catch { /* nothing to drop */ } };
  if (items.length === 0) { drop(); return; }
  try {
    await fetch('/api/hashes/queue', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items })
    });
  } catch {
    return;   // the server did not answer: keep the list for the next visit
  }
  drop();     // any answer: the server has them, or said why not
  if (callers.size) loadJobs(true);
}

// ── callers ──────────────────────────────────────────────────
function addCaller(key, opts) {
  const first = callers.size === 0;
  const servicesBefore = wantsServices();
  callers.set(key, { localRunning: false, ...opts });
  if (first) {
    if (!visibilityOn && typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibility);
      visibilityOn = true;
    }
    adoptLegacyHashQueue();
    if (!hidden()) loadJobs(false);
  } else {
    schedule();
  }
  if (!servicesBefore && opts.withServices && !hidden()) loadServices(false);
}

function removeCaller(key) {
  callers.delete(key);
  if (callers.size === 0) {
    clearTimeout(timer);
    timer = null;
    if (visibilityOn) {
      document.removeEventListener('visibilitychange', onVisibility);
      visibilityOn = false;
    }
  } else {
    schedule();
  }
  if (!wantsServices()) {
    clearTimeout(servicesTimer);
    servicesTimer = null;
  }
}

// ── browser uploads ──────────────────────────────────────────
const UPLOAD_STATUS = { waiting: 'queued', uploading: 'running', 'handing-over': 'running', failed: 'failed' };

const slot = (on, why, extra) => ({ on: !!on, why: on ? null : why, ...extra });

function uploadActions(status) {
  const waiting = status === 'waiting';
  const uploading = status === 'uploading';
  const handing = status === 'handing-over';
  const failed = status === 'failed';
  return {
    pause: slot(false, "Uploads can't pause", { act: 'pause', label: 'Pause' }),
    front: slot(false, 'Uploads go one at a time in the order added', { label: 'Run next' }),
    retry: slot(failed, 'Only a failed upload can run again', { label: 'Retry' }),
    cancel: slot(uploading,
      waiting ? 'Not sending yet: Remove takes it out'
        : handing ? 'Wait a moment: handing over to the server'
          : 'It is not sending', { label: 'Cancel', ask: null }),
    remove: slot(waiting || failed,
      uploading ? 'Sending: Cancel stops it' : 'Wait a moment: handing over to the server', { label: 'Remove', ask: null }),
    open: slot(true, null, { label: 'Open Import', to: '/local-import?from=computer' })
  };
}

/**
 * Browser uploads as job rows: only the part the server does not know yet (waiting, uploading, handing over, or
 * failed before the server had the job). An upload that is importing, or failed at import, is the server's row.
 */
function mergeUploads(jobs, uploads) {
  if (!uploads || uploads.length === 0) return jobs;
  const local = uploads
    .filter(u => UPLOAD_STATUS[u.status] && !(u.status === 'failed' && u.failedAt === 'import'))
    .map(u => {
      const total = u.totalBatches ?? null;
      const sent = (u.doneBatches || []).length;
      return {
        id: `import:local:${u.id}`,
        sourceId: u.id,
        type: 'import',
        local: true,
        title: u.name,
        subtitle: 'uploading from this browser',
        status: UPLOAD_STATUS[u.status],
        progress: u.totalBytes ? Math.min(1, Math.max(0, u.sentBytes / u.totalBytes)) : null,
        done: total != null ? Math.min(sent, total) : sent,
        total,
        unit: 'batches',
        stage: u.status === 'handing-over' ? 'handing over' : u.status === 'uploading' ? 'uploading' : null,
        currentFile: null, note: null, elapsedMs: null, startedAt: null, finishedAt: null,
        error: u.status === 'failed' ? u.error : null,
        result: null,
        chips: ['upload', ...(u.createHashes ? ['create hashes'] : [])],
        thumbPath: null,
        link: '/local-import?from=computer',
        linkLabel: 'Open Import',
        actions: uploadActions(u.status),
        raw: u
      };
    });
  return local.length ? [...jobs, ...local] : jobs;
}

// ── the hook ─────────────────────────────────────────────────
/**
 * @param {object}  [opts]
 * @param {number}  [opts.activeMs=2000]  interval while something runs
 * @param {number}  [opts.idleMs=10000]   interval otherwise
 * @param {boolean} [opts.withServices]   also poll GET /api/jobs/services (every 10 s)
 */
export default function useJobs({ activeMs = 2000, idleMs = 10000, withServices = false } = {}) {
  const state = useSyncExternalStore(subscribeStore, getSnap, getSnap);
  const uploads = useUploads().uploads || NO_UPLOADS;

  const jobs = useMemo(() => mergeUploads(state.jobs, uploads), [state.jobs, uploads]);
  const localRunning = jobs.some(j => j.local && j.status === 'running');

  const keyRef = useRef(null);
  if (!keyRef.current) keyRef.current = Symbol('jobs');

  useEffect(() => {
    const key = keyRef.current;
    addCaller(key, { activeMs, idleMs, withServices });
    return () => removeCaller(key);
  }, [activeMs, idleMs, withServices]);

  useEffect(() => {
    const c = callers.get(keyRef.current);
    if (!c || c.localRunning === localRunning) return;
    c.localRunning = localRunning;
    schedule();
  }, [localRunning, activeMs, idleMs, withServices]);

  const refresh = useCallback(() => refreshAll(), []);

  return {
    jobs,
    capped: state.capped,
    services: state.services,
    loaded: state.loaded,
    error: state.error,
    updatedAt: state.updatedAt,
    refresh
  };
}
