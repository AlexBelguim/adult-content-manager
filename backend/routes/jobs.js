/**
 * Jobs routes — one normalised view over every kind of background work.
 *
 * Nothing here OWNS a queue. Each source keeps its own state and its own action
 * endpoints (/api/upload-queue, /api/funpipe/queue/*, /api/encode/jobs, …);
 * this file only reads them and maps them onto one shape so the Jobs page and
 * the toolbar indicator can poll a single URL.
 *
 * Endpoints:
 * - GET  /api/jobs            — normalised array, all sources
 * - GET  /api/jobs/services   — health of the things jobs depend on
 * - POST /api/jobs/dismiss    — hide finished hash / cleanup rows (those two
 *                               sources have no remove endpoint of their own)
 *
 * Job shape:
 *   { id, sourceId, type: 'import'|'funpipe'|'hash'|'encode'|'cleanup'|'train',
 *     title, subtitle, status: 'queued'|'running'|'done'|'failed',
 *     progress (0-1|null), done, total, unit, stage, currentFile, note,
 *     elapsedMs, startedAt, finishedAt, error, result, chips: [], thumbPath,
 *     link, raw }
 */
const express = require('express');
const router = express.Router();
const path = require('path');
const axios = require('axios');
const db = require('../db');
const { getQueueStatus } = require('../services/uploadQueue');
const funpipeService = require('../services/funpipeService');
const encodeService = require('../services/encodeService');
const hashService = require('../services/hashService');
const { getAiServerUrl } = require('../utils/aiUrl');

// In-memory sources are never pruned by their owners, so "recent" needs a bound.
const RECENT_MS = 6 * 60 * 60 * 1000;
const ENCODE_LIMIT = 200;

// Finished hash / cleanup rows the user cleared. The source maps stay untouched
// so the per-id pollers in FilterView / GalleryView never see a 404.
const dismissed = new Set();

// ── remote sources (AI server) ───────────────────────────────
// The GPU box is often off. Without a cache every 2 s poll would wait out an
// 8 s timeout, so an offline answer is remembered for longer than a live one.
const REMOTE_TTL_OK = 1500;
const REMOTE_TTL_FAIL = 15000;
const remoteCache = new Map();

async function remote(key, fetcher, isOk, fresh) {
  const hit = remoteCache.get(key);
  const now = Date.now();
  if (hit && !fresh && now - hit.time < (hit.ok ? REMOTE_TTL_OK : REMOTE_TTL_FAIL)) return hit.value;
  if (hit && hit.pending) return hit.pending;

  const pending = fetcher().then(value => {
    remoteCache.set(key, { value, ok: isOk(value), time: Date.now() });
    return value;
  });
  remoteCache.set(key, { ...(hit || { value: null, ok: false, time: 0 }), pending });
  return pending;
}

const getFunpipeQueue = (fresh) => remote('funpipe', () => funpipeService.getQueue(), v => v.ok !== false, fresh);
const getFunpipeHealth = (fresh) => remote('funpipeHealth', () => funpipeService.health(), v => v.ok !== false, fresh);

const getTraining = (fresh) => remote('training', async () => {
  try {
    const base = String(getAiServerUrl()).replace(/\/+$/, '');
    const res = await axios.get(`${base}/training_status`, { timeout: 5000 });
    return { ok: true, ...res.data };
  } catch (_) {
    return { ok: false };
  }
}, v => v.ok, fresh);

// ── helpers ──────────────────────────────────────────────────
const toMs = (v) => {
  if (v == null) return null;
  if (typeof v === 'number') return v < 1e12 ? Math.round(v * 1000) : v; // unix seconds vs ms
  // SQLite CURRENT_TIMESTAMP is UTC without a zone marker
  const s = /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(v) ? v.replace(' ', 'T') + 'Z' : v;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
};

const elapsed = (startedAt, finishedAt) =>
  startedAt ? Math.max(0, (finishedAt || Date.now()) - startedAt) : null;

const clamp01 = (n) => (typeof n === 'number' && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : null);

/** Performer name from a library path: …/<before|after> filter performer/<name>/… */
function performerFromPath(p) {
  const parts = String(p || '').split(/[\\/]+/);
  const i = parts.findIndex(s => /^(before|after) filter performer$/i.test(s));
  return i >= 0 && parts[i + 1] ? parts[i + 1] : null;
}

const job = (fields) => ({
  subtitle: null, progress: null, done: null, total: null, unit: null, stage: null,
  currentFile: null, note: null, elapsedMs: null, startedAt: null, finishedAt: null,
  error: null, result: null, chips: [], thumbPath: null, link: null,
  ...fields,
  id: `${fields.type}:${fields.sourceId}`
});

const isRecent = (finishedAt) => !finishedAt || Date.now() - finishedAt < RECENT_MS;

// ── sources ──────────────────────────────────────────────────
const IMPORT_STATUS = { pending: 'queued', uploading: 'queued', queued: 'queued', processing: 'running', completed: 'done', error: 'failed' };

function importJobs() {
  return getQueueStatus().queue.map(j => {
    const status = IMPORT_STATUS[j.status] || 'queued';
    const startedAt = toMs(j.startedAt);
    const finishedAt = toMs(j.completedAt);
    const progress = status === 'done' ? 1 : clamp01((j.progress || 0) / 100);
    const total = j.totalFiles || null;
    return job({
      type: 'import', sourceId: j.id, title: j.performerName, status,
      progress, total, unit: 'files',
      done: total ? Math.round(progress * total) : null,
      currentFile: status === 'running' ? j.currentFile : null,
      startedAt, finishedAt, elapsedMs: elapsed(startedAt, finishedAt),
      error: j.error || null,
      chips: [j.isLocalImport ? 'local' : 'upload', ...(j.createHashes ? ['create hashes'] : [])],
      raw: j
    });
  });
}

async function funpipeJobs(fresh) {
  const queue = await getFunpipeQueue(fresh);
  return (queue.jobs || []).map(j => {
    const status = ['running', 'queued', 'done', 'failed'].includes(j.status) ? j.status : 'queued';
    const total = j.total_windows > 0 ? j.total_windows : null;
    const done = total ? (j.windows_done || 0) : null;
    const src = j.src || j.video || null;
    // `elapsed` only exists once the job ended; while it runs there is `started`
    // (unix seconds on the GPU box, so a skewed clock can make this a little off).
    const startedAt = toMs(j.started);
    const elapsedMs = j.elapsed > 0 ? Math.round(j.elapsed * 1000)
      : (status === 'running' ? elapsed(startedAt, null) : null);
    return job({
      type: 'funpipe', sourceId: j.id, title: j.name || path.basename(String(src || j.id)),
      subtitle: performerFromPath(src), status,
      progress: status === 'done' ? 1 : clamp01(j.progress),
      done, total, unit: 'windows', stage: j.stage || null,
      elapsedMs, startedAt,
      error: status === 'failed' ? (j.error || 'funpipe job failed — see the log') : null,
      result: status === 'done' ? 'Funscript written — needs review' : null,
      thumbPath: j.src || null,
      raw: j
    });
  });
}

const ENCODE_STATUS = { pending: 'queued', processing: 'running', completed: 'done', failed: 'failed' };

function encodeJobs() {
  // 'cancelled' is how the encode queue spells "the user removed it" — the row
  // stays in the table until POST /api/encode/clear, but it is not a job any more.
  return encodeService.getJobs(null, ENCODE_LIMIT).filter(j => j.status !== 'cancelled').map(j => {
    const status = ENCODE_STATUS[j.status] || 'queued';
    const startedAt = toMs(j.started_at);
    const finishedAt = toMs(j.completed_at);
    const isVideo = j.target_format === 'h265';
    const saved = j.actual_size_bytes != null && j.original_size_bytes
      ? j.original_size_bytes - j.actual_size_bytes : null;
    return job({
      type: 'encode', sourceId: j.id, title: path.basename(j.source_path),
      subtitle: j.performer_name || performerFromPath(j.source_path), status,
      progress: status === 'done' ? 1 : null,
      currentFile: status === 'running' ? path.basename(j.source_path) : null,
      startedAt, finishedAt, elapsedMs: elapsed(startedAt, finishedAt),
      error: j.error_message || null,
      result: status === 'done' && saved != null
        ? `${encodeService.formatBytes(Math.max(0, saved))} saved` : null,
      note: j.original_size_bytes ? encodeService.formatBytes(j.original_size_bytes) : null,
      chips: [isVideo ? 'video → H.265' : 'image → WebP'],
      thumbPath: isVideo ? j.source_path : null,
      raw: j
    });
  });
}

const CLEANUP_TITLE = {
  'trash-cleanup': 'Cleaning up trash',
  'move-to-after': 'Move to after folder',
  'refresh-stats': 'Refresh stats'
};

function cleanupResult(t) {
  const r = t.result;
  if (!r) return null;
  if (typeof r === 'string') return r;
  if (t.type === 'trash-cleanup') {
    const savedN = r.savedForTrainingCount || 0;
    const deletedN = (r.deletedCount || 0) - savedN;
    return savedN > 0 ? `Saved ${savedN} files for training, deleted ${deletedN}` : `Deleted ${r.deletedCount || 0} files`;
  }
  if (t.type === 'refresh-stats') return `Stats updated · ${r.picsCount ?? 0} pics, ${r.vidsCount ?? 0} videos`;
  return null;
}

function cleanupJobs() {
  // Required lazily: performers.js is the biggest route file and already loaded
  // by index.js; this only reads the task map it exposes.
  const performersRouter = require('./performers');
  const tasks = typeof performersRouter.getBackgroundTasks === 'function' ? performersRouter.getBackgroundTasks() : [];
  return tasks
    .filter(t => !dismissed.has(`cleanup:${t.id}`) && isRecent(t.endTime))
    .map(t => {
      const status = t.status === 'completed' ? 'done' : t.status === 'error' ? 'failed' : t.status === 'queued' ? 'queued' : 'running';
      // result carries whole stat objects — keep the payload small
      const { result, ...raw } = t;
      return job({
        type: 'cleanup', sourceId: t.id, title: CLEANUP_TITLE[t.type] || t.type,
        subtitle: t.performerName || null, status,
        progress: status === 'done' ? 1 : clamp01((t.progress || 0) / 100),
        stage: status === 'running' ? (t.progressText || null) : null,
        startedAt: t.startTime || null, finishedAt: t.endTime || null,
        elapsedMs: elapsed(t.startTime, t.endTime),
        error: t.error || null, result: cleanupResult(t),
        chips: t.merge ? ['merge'] : [],
        raw
      });
    });
}

function hashJobs() {
  const jobs = hashService.listJobs().filter(j => !dismissed.has(`hash:${j.jobId}`) && isRecent(j.endTime));
  if (jobs.length === 0) return [];
  const performer = db.prepare('SELECT name, moved_to_after FROM performers WHERE id = ?');
  return jobs.map(j => {
    let p = null;
    try { p = performer.get(j.performerId); } catch (_) { /* name is cosmetic */ }
    const status = j.status === 'completed' ? 'done' : j.status === 'failed' ? 'failed' : 'running';
    const total = j.total || null;
    const location = p ? (p.moved_to_after === 1 ? 'after' : 'before') : null;
    return job({
      type: 'hash', sourceId: j.jobId, title: p?.name || `Performer ${j.performerId}`, status,
      progress: status === 'done' ? 1 : (total ? clamp01(j.processed / total) : null),
      done: j.processed || 0, total, unit: 'files',
      startedAt: j.startTime || null, finishedAt: j.endTime || null,
      elapsedMs: elapsed(j.startTime, j.endTime),
      error: j.error || null,
      result: status === 'done' ? `Processed ${j.hashCount ?? j.processed ?? 0} files` : null,
      chips: ['Hash DB', ...(location ? [location === 'after' ? 'After filter' : 'Before filter'] : []),
        j.mode === 'replace' ? 'rebuild' : 'append'],
      raw: { jobId: j.jobId, performerId: j.performerId, mode: j.mode, status: j.status, location }
    });
  });
}

const TRAIN_TITLE = {
  binary: 'Keep / delete classifier', context_binary: 'Context classifier',
  pairwise: 'Pairwise ranker', siamese: 'Siamese performer ranker'
};

async function trainJobs(fresh) {
  const t = await getTraining(fresh);
  // Only a live run is a job. Offline or idle is simply "no row" — never an error.
  if (!t.ok || !t.active) return [];
  const totalEpochs = t.total_epochs || 0;
  const batchFrac = t.total_batches > 0 ? (t.batch || 0) / t.total_batches : 0;
  const startedAt = toMs(t.started_at);
  const pct = (n) => `${(n * 100).toFixed(1)}%`;
  return [job({
    type: 'train', sourceId: 'current', title: TRAIN_TITLE[t.type] || `Training — ${t.type || 'model'}`,
    status: 'running',
    progress: totalEpochs > 0 ? clamp01((Math.max(0, (t.epoch || 1) - 1) + batchFrac) / totalEpochs) : null,
    done: t.epoch || 0, total: totalEpochs || null, unit: 'epochs',
    stage: t.phase && t.phase !== 'idle' ? t.phase : null,
    note: t.val_acc ? `val acc ${pct(t.val_acc)}${t.best_val_acc ? ` · best ${pct(t.best_val_acc)}` : ''}` : (t.message || null),
    startedAt, elapsedMs: elapsed(startedAt, null),
    link: '/training-hub',
    raw: { type: t.type, phase: t.phase, epoch: t.epoch, total_epochs: t.total_epochs, batch: t.batch, total_batches: t.total_batches, val_acc: t.val_acc, best_val_acc: t.best_val_acc }
  })];
}

// ── routes ───────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const fresh = req.query.fresh === '1';
  const sources = [
    ['import', () => importJobs()],
    ['funpipe', () => funpipeJobs(fresh)],
    ['hash', () => hashJobs()],
    ['encode', () => encodeJobs()],
    ['cleanup', () => cleanupJobs()],
    ['train', () => trainJobs(fresh)]
  ];
  // One broken source must not blank the whole page.
  const settled = await Promise.all(sources.map(async ([name, read]) => {
    try { return await read(); } catch (err) {
      console.warn(`[jobs] ${name} source failed: ${err.message}`);
      return [];
    }
  }));
  res.json(settled.flat());
});

router.get('/services', async (req, res) => {
  const fresh = req.query.fresh === '1';
  const [queue, health, training] = await Promise.all([
    getFunpipeQueue(fresh), getFunpipeHealth(fresh), getTraining(fresh)
  ]);
  res.json({
    funpipe: { online: queue.ok !== false, workerRunning: !!queue.running, url: queue.url },
    gpu: { warning: health.ok !== false ? (health.gpu_warning || null) : null },
    ffmpeg: { available: !!encodeService.ffmpegAvailable, ffprobe: !!encodeService.ffprobeAvailable },
    ai: { online: training.ok || queue.ok !== false, url: getAiServerUrl(), trainingActive: !!(training.ok && training.active) }
  });
});

router.post('/dismiss', (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
  const finished = new Set([...hashJobs(), ...cleanupJobs()]
    .filter(j => j.status === 'done' || j.status === 'failed').map(j => j.id));
  let count = 0;
  for (const id of ids) {
    if (finished.has(id)) { dismissed.add(id); count++; }
  }
  res.json({ success: true, dismissed: count });
});

module.exports = router;
