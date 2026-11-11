/**
 * Jobs routes — one normalised list over every kind of background work, with the actions each row allows.
 *
 * Nothing here OWNS a queue. Each source keeps its own state and its own endpoints (/api/upload-queue,
 * /api/funpipe/queue/*, /api/encode/jobs, /api/hashes/queue, …); this file reads them, maps them onto one shape,
 * and acts on a row through the source's own functions, so the Jobs page, the app-bar chip and the phone's Jobs
 * sheet poll and act through one URL.
 *
 * Endpoints:
 * - GET  /api/jobs                 — the rows as a bare array (discovery.test.js and outside readers read it that way)
 * - GET  /api/jobs?v=2             — { jobs, capped: [{ kind, status, shown, total, rest? }], serverTime } (rest: hash only, [{ jobId, performerId }] past the cap)
 *                                    Either form is assembled once per second for every caller (a module cache);
 *                                    fresh=1 skips that cache and the remote sources' caches.
 * - POST /api/jobs/act             — { id, action: pause|resume|front|retry|cancel|remove } on one row: the row is
 *                                    looked up in a fresh list (404), its slot must be on (409 with its `why`),
 *                                    then the source does it. Answers { success, undo } (undo: a removed queued
 *                                    hash build can be put back with that request).
 * - POST /api/jobs/clear-finished  — { kind? } every done or cancelled row whose Remove is on. Failed rows stay.
 *                                    Answers { success, cleared, errors: [{ kind, error }] }.
 * - POST /api/jobs/retry-failed    — { kind? } Retry on every failed row whose Retry is on, one after another.
 *                                    Answers { success, retried, errors: [{ id, title, error }] }.
 * - POST /api/jobs/dismiss         — { ids } hide ended cleanup, Discover and library-scan rows (sources without
 *                                    a remove of their own); kept for old callers.
 * - GET  /api/jobs/services        — health of the things jobs depend on
 * - GET  /api/jobs/workers         — Settings → Workers
 *
 * Job shape:
 *   { id: '<type>:<sourceId>', sourceId,
 *     type: 'import'|'funpipe'|'pipeline'|'hash'|'encode'|'cleanup'|'train'|'discover'|'probe',
 *     title, subtitle, status: 'queued'|'running'|'done'|'failed'|'cancelled',
 *     progress (0-1|null), done (<= total), total, unit, stage, currentFile, note,
 *     elapsedMs, startedAt, finishedAt (ms), error, result, chips: [], thumbPath,
 *     link, linkLabel (= actions.open unless the source says otherwise), actions, raw }
 *
 * actions: six fixed slots, always present, in this order:
 *   { pause:  { on, why, act: 'pause'|'resume', label: 'Pause'|'Resume' },
 *     front:  { on, why, label: 'Run next' },
 *     retry:  { on, why, label: 'Retry' },
 *     cancel: { on, why, label: 'Cancel', ask: { title, text, okLabel }|null },
 *     remove: { on, why, label: 'Remove', ask: {…}|null },
 *     open:   { on, why, label, to } }
 *   why is null when on, else one short sentence that says why not. A slot with ask is asked (danger) first.
 *
 * Progress units differ per source (funpipe, training and encode send 0-1, import and cleanup 0-100); every one
 * ends in clamp01, and done is clamped to total (funpipe's windows can overshoot).
 */
const express = require('express');
const router = express.Router();
const path = require('path');
const axios = require('axios');
const db = require('../db');
const uploadQueue = require('../services/uploadQueue');
const funpipeService = require('../services/funpipeService');
const funpipeQueue = require('../services/funpipeQueue');
const encodeQueue = require('../services/encodeQueue');
const trainingQueue = require('../services/trainingQueue');
const scenetestService = require('../services/scenetestService');
const { getAiServerUrl } = require('../utils/aiUrl');
const discoverRunner = require('../services/discover/runner');
const { WATCHERS } = require('../services/discover/watchers');

// In-memory sources are never pruned by their owners, so "recent" needs a bound.
const RECENT_MS = 6 * 60 * 60 * 1000;
// A long queue shows its head; the rest are counted in `capped`.
const QUEUED_SHOWN = 100;
const FUNPIPE_STALE_MS = funpipeQueue.STALE_MS || 10 * 60 * 1000;

const KINDS = ['import', 'hash', 'encode', 'funpipe', 'pipeline', 'train', 'cleanup', 'discover', 'probe'];
const ACTIONS = ['pause', 'resume', 'front', 'retry', 'cancel', 'remove'];

// Ended cleanup, Discover and library-scan rows the user removed (those sources have no remove of their own).
// The source maps stay untouched so the per-id pollers elsewhere never see a 404.
const dismissed = new Set();

const httpError = (status, message) => Object.assign(new Error(message), { status });

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
  }, err => {
    // a fetcher that throws is a failed answer, remembered like one (not a pending entry for ever)
    const value = { ok: false, error: err && err.message ? err.message : String(err) };
    remoteCache.set(key, { value, ok: false, time: Date.now() });
    return value;
  });
  remoteCache.set(key, { ...(hit || { value: null, ok: false, time: 0 }), pending });
  return pending;
}

const getFunpipeQueue = (fresh) => remote('funpipe', () => funpipeService.getQueue(), v => v.ok !== false, fresh);
const getFunpipeHealth = (fresh) => remote('funpipeHealth', () => funpipeService.health(), v => v.ok !== false, fresh);
const getScenetest = (fresh) => remote('scenetest', () => scenetestService.getState(), v => v.ok !== false, fresh);

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

const fmtN = (n) => Number(n || 0).toLocaleString('en-US');
const hhmm = (ms) => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const playerLink = (p) => (p ? `/player?path=${encodeURIComponent(p)}` : null);
const performerLink = (id) => (id != null ? `/performer-management?performer=${encodeURIComponent(id)}` : null);

/** Performer name from a library path: …/<before|after> filter performer/<name>/… */
function performerFromPath(p) {
  const parts = String(p || '').split(/[\\/]+/);
  const i = parts.findIndex(s => /^(before|after) filter performer$/i.test(s));
  return i >= 0 && parts[i + 1] ? parts[i + 1] : null;
}

/** A content genre from a library path: …/content/<genre>/… */
function genreFromPath(p) {
  const parts = String(p || '').split(/[\\/]+/);
  const i = parts.lastIndexOf('content');
  return i >= 0 && parts[i + 2] ? parts[i + 1] : null;
}

const job = (fields) => {
  const j = {
    subtitle: null, progress: null, done: null, total: null, unit: null, stage: null,
    currentFile: null, note: null, elapsedMs: null, startedAt: null, finishedAt: null,
    error: null, result: null, chips: [], thumbPath: null, link: null, linkLabel: null, actions: null,
    ...fields,
    id: `${fields.type}:${fields.sourceId}`
  };
  j.progress = clamp01(j.progress);
  j.done = (j.done != null && j.total != null) ? Math.min(j.done, j.total) : j.done;
  const open = j.actions && j.actions.open;
  if (open) {
    if (j.link == null) j.link = open.to;
    if (j.linkLabel == null) j.linkLabel = open.label;
  }
  return j;
};

const isRecent = (finishedAt) => !finishedAt || Date.now() - finishedAt < RECENT_MS;

// ── action slots ─────────────────────────────────────────────
const SLOTS = ['pause', 'front', 'retry', 'cancel', 'remove', 'open'];

const slot = (on, why, extra = {}) => ({ on: !!on, why: on ? null : (why || 'Not possible now'), ...extra });

const ENDED = 'It has ended';
const NOT_STARTED = 'Not started yet: Remove takes it out of the queue';
const IS_RUNNING = 'It is running: Cancel stops it';
const ONLY_FAILED = 'Only a failed job can run again';
const ONLY_FAILED_OR_CANCELLED = 'Only a failed or cancelled job can run again';

const isEnded = (status) => status === 'done' || status === 'failed' || status === 'cancelled';

/** Run next: only a queued row */
const frontRule = (status) => [status === 'queued', status === 'running' ? 'It is running already' : ENDED];
/** Cancel: only a running row */
const cancelRule = (status) => [status === 'running', status === 'queued' ? NOT_STARTED : ENDED];
/** Remove: anything not running */
const removeRule = (status) => [status !== 'running', IS_RUNNING];

/**
 * The six slots from [on, why] pairs: { pause, pauseAct, front, retry, cancel, cancelAsk, remove, removeAsk, open: { to, label } }.
 * An ask only goes with a slot that is on.
 */
function actionsOf({ pause, pauseAct = 'pause', front, retry, cancel, cancelAsk = null, remove, removeAsk = null, open = {} }) {
  return {
    pause: { ...slot(pause[0], pause[1]), act: pauseAct, label: pauseAct === 'resume' ? 'Resume' : 'Pause' },
    front: { ...slot(front[0], front[1]), label: 'Run next' },
    retry: { ...slot(retry[0], retry[1]), label: 'Retry' },
    cancel: { ...slot(cancel[0], cancel[1]), label: 'Cancel', ask: cancel[0] ? cancelAsk : null },
    remove: { ...slot(remove[0], remove[1]), label: 'Remove', ask: remove[0] ? removeAsk : null },
    open: { ...slot(!!open.to, 'Nothing to open'), label: open.label || 'Open', to: open.to || null }
  };
}

/** Every slot but Open off, with one reason (a row that is stopping, or whose source is offline). */
function allOff(actions, why) {
  for (const k of SLOTS) {
    if (k === 'open') continue;
    actions[k].on = false;
    actions[k].why = why;
    if ('ask' in actions[k]) actions[k].ask = null;
  }
  return actions;
}

/** All off with one reason, except Remove and Open as given. */
const fixed = (why, remove, open) => actionsOf({ pause: [false, why], front: [false, why], retry: [false, why], cancel: [false, why], remove, open });

// ── sources ──────────────────────────────────────────────────
const IMPORT_STATUS = { pending: 'queued', uploading: 'queued', queued: 'queued', processing: 'running', completed: 'done', error: 'failed' };

const num = (n) => (Number.isFinite(Number(n)) ? Number(n) : 0);

// '142 files imported · 3 identical skipped · 2 renamed · 1 not imported · hashing failed': each part when it applies
function importSummary(r) {
  if (!r) return null;
  const imported = num(r.imported);
  const parts = [`${imported} ${imported === 1 ? 'file' : 'files'} imported`];
  if (num(r.identical) > 0) parts.push(`${num(r.identical)} identical skipped`);
  if (num(r.renamed) > 0) parts.push(`${num(r.renamed)} renamed`);
  const notImported = num(r.unsupported) + num(r.failed);
  if (notImported > 0) parts.push(`${notImported} not imported`);
  if (r.hashing === 'failed') parts.push('hashing failed');
  return parts.join(' · ');
}

function importSubtitle(j) {
  if (j.folderName && j.folderName !== j.performerName) return `from folder "${j.folderName}"`;
  if (j.kind === 'upload' && j.sourceLabel && j.sourceLabel !== j.performerName) return `uploaded from "${j.sourceLabel}"`;
  return null;
}

/** An upload job holds the only server copy of its files (its temp folder goes with it): Remove asks first. */
function uploadRemoveAsk(j, title) {
  if (j.kind !== 'upload') return null;
  const r = j.report || null;
  const leftOver = !!(r && r.leftIn && r.failed);   // the files that could not be moved
  if (j.status === 'completed' && !leftOver) return null;
  const failed = leftOver ? (r.failed || 0) : 0;
  return leftOver
    ? {
      title: `Delete what is left of ${title}?`,
      text: `${failed === 1 ? '1 file could not be moved and is' : `${failed} files could not be moved and are`} kept in the server's temp folder. Removing this job deletes them. The files on the computer or phone they came from are not touched.`,
      okLabel: 'Delete them', cancelLabel: 'Keep it'
    }
    : {
      title: `Cancel the upload of ${title}?`,
      text: 'The uploaded files are on the server and are not imported yet. Removing this job deletes them from the server\'s temp folder. The files on the computer or phone they came from are not touched.',
      okLabel: 'Cancel upload', cancelLabel: 'Keep it'
    };
}

function importJobs() {
  return uploadQueue.getQueueStatus().queue.map(j => {
    const status = IMPORT_STATUS[j.status] || 'queued';
    const startedAt = toMs(j.startedAt);
    const finishedAt = toMs(j.completedAt);
    const progress = status === 'done' ? 1 : clamp01((j.progress || 0) / 100);
    const total = j.totalFiles || null;
    const r = j.report || null;
    const failedFiles = r ? num(r.failed) : 0;
    const kind = j.kind || (j.isLocalImport ? 'local' : 'upload');
    const title = j.performerName;
    const performerId = j.performerId != null ? j.performerId : null;
    return job({
      type: 'import', sourceId: j.id, title, status,
      subtitle: importSubtitle({ ...j, kind }),
      stage: status === 'running' ? (j.stage || null) : null,
      progress, total, unit: 'files',
      done: total ? Math.round(progress * total) : null,
      currentFile: status === 'running' ? j.currentFile : null,
      startedAt, finishedAt, elapsedMs: elapsed(startedAt, finishedAt),
      error: j.error || (failedFiles > 0 ? `${failedFiles} ${failedFiles === 1 ? 'file' : 'files'} could not be moved` : null),
      result: status === 'done' ? importSummary(r) : null,
      chips: [
        kind,
        ...(j.createHashes ? ['create hashes'] : []),
        ...(r && (r.isUpdate || r.matched) ? ['added to existing'] : [])
      ],
      actions: actionsOf({
        pause: [false, 'Imports can\'t pause'],
        front: [false, 'Imports run one at a time in the order added'],
        retry: [j.status === 'error', 'Only a failed import can run again'],
        cancel: [false, status === 'running' ? 'An import can\'t be stopped once it is moving files' : status === 'queued' ? NOT_STARTED : ENDED],
        remove: [j.status !== 'processing', 'Wait until it ends'],
        removeAsk: uploadRemoveAsk({ ...j, kind }, title),
        open: performerId != null
          ? { to: performerLink(performerId), label: 'Open performer' }
          : { to: '/local-import', label: 'Open Import' }
      }),
      raw: { ...j, kind, performerId }
    });
  });
}

async function funpipeJobs(fresh) {
  const queue = await getFunpipeQueue(fresh);
  const now = Date.now();
  return (queue.jobs || []).map(j => {
    // a cancelled job whose worker is still reporting: it stops at the worker's next report
    const stopping = j.status === 'cancelled' && j.phase != null && j.heartbeat && now - j.heartbeat < FUNPIPE_STALE_MS;
    const status = stopping ? 'running'
      : j.status === 'cancelled' ? 'cancelled'
        : ['running', 'queued', 'done', 'failed'].includes(j.status) ? j.status : 'queued';
    const total = j.total_windows > 0 ? j.total_windows : null;
    const done = total ? (j.windows_done || 0) : null;
    const src = j.src || j.video || null;
    const title = j.name || path.basename(String(src || j.id));
    // `elapsed` only exists once the job ended; while it runs there is `started`
    // (unix seconds on the GPU box, so a skewed clock can make this a little off).
    const startedAt = toMs(j.started);
    const elapsedMs = j.elapsed > 0 ? Math.round(j.elapsed * 1000)
      : (status === 'running' ? elapsed(startedAt, null) : null);
    const actions = actionsOf({
      pause: [false, 'Funpipe pauses as a queue: Stop in the Funscript (funpipe) bar'],
      front: [false, 'Funpipe runs videos in the order queued'],
      retry: [(status === 'failed' || status === 'cancelled') && !!src, ONLY_FAILED_OR_CANCELLED],
      cancel: cancelRule(status),
      cancelAsk: {
        title: `Stop the funscript for ${title}?`,
        text: 'It stops at the worker\'s next report. Finished stages are kept, so Retry goes on from there.',
        okLabel: 'Stop'
      },
      remove: removeRule(status),
      open: status === 'done' ? { to: playerLink(src), label: 'Play' } : { to: '/funpipe', label: 'Open Funscripts' }
    });
    if (stopping) allOff(actions, 'Stopping: it ends at the worker\'s next report');
    return job({
      type: 'funpipe', sourceId: j.id, title,
      subtitle: performerFromPath(src), status,
      progress: status === 'done' ? 1 : clamp01(j.progress),
      done, total, unit: 'windows', stage: stopping ? 'stopping' : (status === 'running' ? j.stage || null : null),
      elapsedMs, startedAt, finishedAt: isEnded(status) ? (j.finished || null) : null,
      error: status === 'failed' ? (j.error || 'funpipe job failed — see the log') : null,
      result: status === 'done' ? 'Funscript written — needs review' : null,
      thumbPath: src,
      actions,
      raw: j
    });
  });
}

// scenetest's 'cancelled' = removed or stopped by hand: not a job any more
const PIPELINE_STATUS = { queued: 'queued', running: 'running', done: 'done', error: 'failed' };
const PIPELINE_STEP = { detect: 'Labels', script: 'Funscript' };

// The last answer scenetest gave: while it is offline its queued and running rows stay, marked as last seen.
let lastPipeline = { jobs: [], paused: false, at: 0 };

function pipelineRow(j, paused, offlineAt) {
  const status = PIPELINE_STATUS[j.status];
  const r = j.result || {};
  const title = path.basename(j.path);
  const actions = actionsOf({
    pause: [false, 'Pause the whole queue in the Labels + funscript bar'],
    front: frontRule(status),
    retry: [status === 'failed', ONLY_FAILED],
    cancel: cancelRule(status),
    cancelAsk: { title: `Stop ${title}?`, text: 'scenetest stops on this video; what it made of it so far is lost.', okLabel: 'Stop' },
    remove: removeRule(status),
    open: { to: playerLink(j.path), label: 'Play' }
  });
  if (offlineAt) allOff(actions, 'scenetest is offline');
  return job({
    type: 'pipeline', sourceId: j.id, title, subtitle: performerFromPath(j.path), status,
    progress: status === 'done' ? 1 : (j.kind === 'detect' ? clamp01(j.progress) : null),
    stage: offlineAt ? `scenetest offline, last seen ${hhmm(offlineAt)}`
      : status === 'running' ? (j.message || null) : (status === 'queued' && paused ? 'paused' : null),
    startedAt: j.startedMs, finishedAt: j.finishedMs, elapsedMs: elapsed(j.startedMs, j.finishedMs),
    error: status === 'failed' ? (j.message || 'failed — see scenetest\'s worker.log') : null,
    result: status !== 'done' ? null : j.kind === 'detect'
      ? `${r.segments ?? '?'} scenes${r.app && r.app !== 'sent' ? ` · ${r.app}` : ''}`
      : `${r.parts ?? 0} scenes scripted${r.placed ? ` → ${path.basename(r.placed)}` : ''}`,
    chips: [PIPELINE_STEP[j.kind] || j.kind],
    thumbPath: j.path,
    actions,
    raw: { kind: j.kind, status: j.status, paused: !!paused, path: j.path, offline: !!offlineAt }
  });
}

async function pipelineJobs(fresh) {
  const s = await getScenetest(fresh);
  if (!s.ok) {
    if (!lastPipeline.at) return [];
    return lastPipeline.jobs.filter(j => j.status === 'queued' || j.status === 'running')
      .map(j => pipelineRow(j, lastPipeline.paused, lastPipeline.at));
  }
  const jobs = Array.isArray(s.jobs) ? s.jobs : [];
  lastPipeline = { jobs, paused: !!s.paused, at: Date.now() };
  return jobs.filter(j => PIPELINE_STATUS[j.status] && isRecent(j.finishedMs)).map(j => pipelineRow(j, s.paused, null));
}

const ENCODE_STATUS = { queued: 'queued', running: 'running', done: 'done', skipped: 'done', undone: 'done', failed: 'failed' };
const ENCODE_PHASE = { downloading: 'downloading', encoding: 'encoding', uploading: 'uploading', paused: 'paused', waiting: 'waiting for the GPU', verifying: 'checking', swapping: 'swapping in' };

function fmtBytes(bytes) {
  if (!bytes) return '0 B';
  const i = Math.min(4, Math.floor(Math.log(Math.abs(bytes)) / Math.log(1024)));
  return `${parseFloat((bytes / 1024 ** i).toFixed(i > 2 ? 2 : 0))} ${['B', 'KB', 'MB', 'GB', 'TB'][i]}`;
}

const dateOf = (ms) => new Date(ms).toISOString().slice(0, 10);

function encodeActions(j, status) {
  const swapping = j.phase === 'verifying' || j.phase === 'swapping';
  const paused = !!(j.hold || j.held);
  let pause;
  if (status === 'running') pause = swapping ? [false, 'It is being checked and swapped in'] : [true, null];
  else pause = [false, status === 'queued' ? 'Pause the whole queue in the Encoding bar' : ENDED];
  const heldUntil = j.heldUntil || null;
  return actionsOf({
    pause, pauseAct: status === 'running' && paused ? 'resume' : 'pause',
    front: frontRule(status),
    retry: [j.status === 'failed', ONLY_FAILED],
    cancel: status === 'running' && swapping ? [false, 'It is being checked and swapped in'] : cancelRule(status),
    cancelAsk: { title: `Stop re-encoding ${j.label || path.basename(j.path)}?`, text: 'Its progress is lost. The original stays as it is.', okLabel: 'Stop re-encode' },
    remove: status === 'running' ? [false, IS_RUNNING]
      : heldUntil ? [false, `Its original is kept for Undo until ${dateOf(heldUntil)} (Space page)`]
        : [true, null],
    open: { to: playerLink(j.path), label: 'Play' }
  });
}

/** The re-encode queue (Settings → Space): running all, the head of the queue, the recent ends. */
function encodeJobs() {
  const s = encodeQueue.status();
  const queued = s.queued.slice(0, QUEUED_SHOWN);
  const recent = s.recent.filter(j => isRecent(j.finishedAt) || j.heldUntil);
  const rows = [
    ...s.active.map(j => ({ ...j, status: 'running' })),
    ...queued.map(j => ({ ...j, status: 'queued' })),
    ...recent
  ];
  const capped = [];
  const counts = s.counts || {};
  if ((counts.queued || 0) > queued.length) capped.push({ kind: 'encode', status: 'queued', shown: queued.length, total: counts.queued });
  const failedShown = recent.filter(j => j.status === 'failed').length;
  if ((counts.failed || 0) > failedShown) capped.push({ kind: 'encode', status: 'failed', shown: failedShown, total: counts.failed });
  const jobs = rows.map(j => {
    const status = ENCODE_STATUS[j.status] || 'queued';
    const saved = j.outSize && j.size ? j.size - j.outSize : null;
    return job({
      type: 'encode', sourceId: j.id, title: j.label || path.basename(j.path), subtitle: performerFromPath(j.path) || genreFromPath(j.path), status,
      progress: status === 'done' ? 1 : status === 'running' ? clamp01(j.progress) : null,
      stage: status === 'running' ? [ENCODE_PHASE[j.phase] || j.phase, j.worker?.name].filter(Boolean).join(' · ') : (status === 'queued' && !s.running ? 'paused' : null),
      // the file name is the title unless the job has a label: then it is said once, here
      currentFile: status === 'running' && j.label ? path.basename(j.path) : null,
      startedAt: j.startedAt || null, finishedAt: j.finishedAt || null, elapsedMs: elapsed(j.startedAt, j.finishedAt),
      error: status === 'failed' ? (j.error || 'failed') : null,
      result: j.status === 'done' && saved != null
        ? `${fmtBytes(Math.max(0, saved))} saved${j.heldUntil ? ` · original kept until ${dateOf(j.heldUntil)}` : ''}`
        : j.status === 'skipped' ? (j.error || 'Not smaller: the original stays')
          : j.status === 'undone' ? 'Undone: the original is back' : null,
      note: j.size ? fmtBytes(j.size) : null,
      // every re-encode is video → HEVC 10-bit, which the Space page says once; a chip on each row repeated it
      chips: j.priority ? [`priority ${j.priority}`] : [],
      thumbPath: j.path,
      actions: encodeActions(j, status),
      raw: { status: j.status, phase: j.phase || null, hold: j.hold || null, held: !!j.held, heldUntil: j.heldUntil || null, priority: j.priority || 0, local: !!j.worker?.local }
    });
  });
  return { jobs, capped };
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

/** The key a removed row is remembered by (a new run of the same Discover slot or scan is not hidden by it). */
function dismissKeyOf(j) {
  if (j.type === 'cleanup') return j.id;
  if (j.type === 'discover') return `discover:${j.sourceId}@${j.finishedAt}`;
  if (j.type === 'probe') return `probe:scan@${j.finishedAt}`;
  return null;
}

function cleanupJobs() {
  // Required lazily: performers.js is the biggest route file and already loaded
  // by index.js; this only reads the task map it exposes.
  const performersRouter = require('./performers');
  const tasks = typeof performersRouter.getBackgroundTasks === 'function' ? performersRouter.getBackgroundTasks() : [];
  const why = 'File operations run to the end once started';
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
        actions: fixed(why, [isEnded(status), 'Wait until it ends'],
          t.performerId != null ? { to: performerLink(t.performerId), label: 'Open performer' } : {}),
        raw
      });
    });
}

// '1,203 hashed · 12 unchanged · 3 could not be read · 4 marked deleted · <warning>': each part when it applies
function hashResult(j) {
  if (j.status === 'cancelled') return `Cancelled after ${fmtN(j.processed)} of ${fmtN(j.total)} files`;
  if (j.status !== 'done') return null;
  const parts = [`${fmtN(j.succeeded)} hashed`];
  if (num(j.skipped) > 0) parts.push(`${fmtN(j.skipped)} unchanged`);
  if (num(j.failed) > 0) parts.push(`${fmtN(j.failed)} could not be read`);
  if (num(j.markedDeleted) > 0) parts.push(`${fmtN(j.markedDeleted)} marked deleted`);
  if (j.warning) parts.push(j.warning);
  return parts.join(' · ');
}

/** The hash build queue (services/hashQueue.js, hash_jobs): one build at a time, also across processes. */
function hashJobs() {
  const hashQueue = require('../services/hashQueue');   // lazily: it requires hashService, which is heavy
  const all = hashQueue.list();
  const queuedAll = all.filter(j => j.status === 'queued');
  const shownQueued = new Set(queuedAll.slice(0, QUEUED_SHOWN));
  const capped = queuedAll.length > QUEUED_SHOWN
    // rest: the waiting builds past the cap, so Performer Management still sees them as queued (useHashQueue.jobFor)
    ? [{
        kind: 'hash', status: 'queued', shown: QUEUED_SHOWN, total: queuedAll.length,
        rest: queuedAll.slice(QUEUED_SHOWN).map(j => ({ jobId: j.jobId, performerId: j.performerId }))
      }] : [];
  const jobs = all.filter(j => j.status !== 'queued' || shownQueued.has(j)).map(j => {
    const status = ['queued', 'running', 'done', 'failed', 'cancelled'].includes(j.status) ? j.status : 'queued';
    const title = j.performerName || `Performer ${j.performerId}`;
    const total = j.total > 0 ? j.total : null;
    const startedAt = j.startedAt || null;
    const finishedAt = j.finishedAt || null;
    const stopping = status === 'running' && !!j.cancelRequested;
    return job({
      type: 'hash', sourceId: j.jobId, title, status,
      progress: status === 'done' ? 1 : (total ? j.processed / total : null),
      done: total ? (j.processed || 0) : null, total, unit: 'files',
      stage: status !== 'running' ? null : stopping ? 'stopping' : total ? null : 'listing her files',
      startedAt, finishedAt, elapsedMs: elapsed(startedAt, finishedAt),
      error: status === 'failed' ? (j.error || 'failed') : null,
      result: hashResult({ ...j, status }),
      chips: [
        ...(j.location ? [j.location === 'after' ? 'After filter' : 'Before filter'] : []),
        j.mode === 'replace' ? 'rebuild' : 'update',
        ...(j.origin === 'import' ? ['from import'] : [])
      ],
      actions: actionsOf({
        pause: [false, 'A hash build can\'t pause: Cancel stops it and keeps the files hashed so far'],
        front: frontRule(status),
        retry: j.performerGone && (status === 'failed' || status === 'cancelled')
          ? [false, 'She is no longer in the app']
          : [status === 'failed' || status === 'cancelled', ONLY_FAILED_OR_CANCELLED],
        cancel: stopping ? [false, 'Stopping after the files it is reading now'] : cancelRule(status),
        cancelAsk: {
          title: `Stop hashing ${title}?`,
          text: 'It stops after the files it is reading now. Files hashed so far are kept and the next build skips them.',
          okLabel: 'Stop hashing'
        },
        remove: removeRule(status),
        open: { to: j.performerGone ? null : performerLink(j.performerId), label: 'Open performer' }
      }),
      raw: {
        jobId: j.jobId, performerId: j.performerId, mode: j.mode, origin: j.origin, status: j.status,
        location: j.location || null, failedFiles: Array.isArray(j.failedFiles) ? j.failedFiles : []
      }
    });
  });
  return { jobs, capped };
}

const TRAIN_TITLE = {
  binary: 'Keep / delete classifier', ranked_binary: 'Ranked keep / delete classifier',
  pairwise: 'Pairwise ranker', clip_siamese: 'CLIP siamese picture ranker', clip_taste: 'CLIP taste keep / delete model', clip_keepdelete: 'K keep / delete model',
  performer_ranker: 'Performer ranker'
};

/** The training queue (services/trainingQueue.js): the running run with its state as acm-gpu last sent it, the waiting ones, and the recent ends. */
async function trainJobs() {
  const STATUS = { queued: 'queued', running: 'running', done: 'done', failed: 'failed', cancelled: 'cancelled' };
  const pct = (n) => `${(n * 100).toFixed(1)}%`;
  // what val_acc means per type: AUC for K and CLIP taste, pair accuracy on held-out pairs for CLIP siamese
  const metricText = (type, v) => type === 'clip_keepdelete' || type === 'clip_taste' ? `AUC ${Number(v).toFixed(2)}` : type === 'clip_siamese' ? `${Math.round(v * 100)}% pairs right` : `val ${pct(v)}`;
  return trainingQueue.list().jobs.filter(j => j.status === 'queued' || j.status === 'running' || isRecent(j.finishedAt)).map(j => {
    const t = j.state || {};
    const status = STATUS[j.status] || 'queued';
    const title = TRAIN_TITLE[j.type] || `Training — ${j.type || 'model'}`;
    const ended = isEnded(status);
    return job({
      type: 'train', sourceId: j.id, title, subtitle: j.label,
      status,
      progress: status === 'done' ? 1 : status === 'running' ? clamp01(j.progress) : null,
      done: t.epoch || 0, total: t.total_epochs || j.epochs || null, unit: 'epochs',
      stage: status === 'running' ? (j.cancelling ? 'cancelling' : t.phase && t.phase !== 'idle' ? t.phase : j.phase) : null,
      note: t.val_acc ? `${metricText(j.type, t.val_acc)}${t.best_val_acc ? ` · best ${metricText(j.type, t.best_val_acc)}` : ''}` : (j.message || null),
      startedAt: j.startedAt || null, finishedAt: j.finishedAt || null, elapsedMs: elapsed(j.startedAt, j.finishedAt),
      error: status === 'failed' ? j.error || 'failed' : null,
      result: status === 'done' && j.result ? `best ${metricText(j.type, j.result.best_val_acc || 0)}${j.result.model ? ` · ${j.result.model}` : ''}` : null,
      link: '/ai-training?tab=train', linkLabel: 'AI & Training',
      actions: actionsOf({
        pause: [false, 'Training can\'t pause: Cancel stops it'],
        front: frontRule(status),
        retry: (status === 'failed' || status === 'cancelled')
          ? [!!j.trainable, 'That model type was removed']
          : [false, ONLY_FAILED_OR_CANCELLED],
        cancel: status === 'running' && j.cancelling ? [false, 'Stopping: it ends at its next report'] : cancelRule(status),
        cancelAsk: {
          title: `Stop training ${title}?`,
          text: 'It stops at its next report and ends as cancelled. Progress so far is lost.',
          okLabel: 'Stop training'
        },
        remove: [status === 'queued' || ended, IS_RUNNING],
        open: { to: '/ai-training?tab=train', label: 'Open AI & Training' }
      }),
      raw: { status: j.status, type: j.type, trainable: !!j.trainable, phase: t.phase || j.phase, epoch: t.epoch, total_epochs: t.total_epochs, val_acc: t.val_acc, best_val_acc: t.best_val_acc }
    });
  });
}

/** Discover's runs (services/discover/runner.js): the one started by hand and the timer's, running or just ended. */
const DISCOVER_TITLE = { scan: 'Scan of the watchers', backlog: 'Older posts', profiles: 'All creator profiles', rescore: 'Judging again with the current P', pools: 'Pictures together' };
function discoverJobs() {
  const { job: byHand, watchJob } = discoverRunner.status();
  return [['hand', byHand], ['timer', watchJob]]
    .filter(([slotName, s]) => s.running || (s.finishedAt && isRecent(toMs(s.finishedAt)) && !dismissed.has(`discover:${slotName}@${toMs(s.finishedAt)}`)))
    .map(([slotName, s]) => {
      const failed = s.exitCode === 1;
      const lastLine = s.log.filter(Boolean).pop() || null;
      const outcome = s.log.filter(l => /^This run/.test(l)).pop() || lastLine;
      const discoverPage = 'Discover runs start from its page';
      return job({
        type: 'discover', sourceId: slotName,
        title: `Discover: ${s.mode === 'watcher' ? WATCHERS.find(w => w.id === s.watcher)?.label || s.watcher : DISCOVER_TITLE[s.mode] || 'Scan'}`,
        subtitle: slotName === 'timer' ? 'On the timer' : 'Started by hand',
        status: s.running ? 'running' : failed ? 'failed' : 'done',
        stage: s.running ? 'scanning' : null, note: s.running ? lastLine : null,
        startedAt: toMs(s.startedAt), finishedAt: s.running ? null : toMs(s.finishedAt),
        elapsedMs: elapsed(toMs(s.startedAt), s.running ? null : toMs(s.finishedAt)),
        error: failed ? s.error : null,
        result: !s.running && !failed ? outcome : null,
        actions: actionsOf({
          pause: [!!s.running, 'Run it again from Discover: it goes on from where it paused'],
          front: [false, discoverPage],
          retry: [false, discoverPage],
          cancel: [false, 'Use Pause: a Discover run stops between two posts'],
          remove: [!s.running, 'It is running: Pause stops it'],
          open: { to: '/discover', label: 'Open Discover' }
        }),
        raw: { mode: s.mode, watcher: s.watcher, secondsPerPicture: s.secondsPerPicture }
      });
    });
}

/** The library scan (services/mediaProbe.js): while it runs, and its last run when that failed. */
function probeJobs() {
  const p = require('../services/mediaProbe').status();
  const finishedAt = p.finishedAt || null;
  const failedShown = !p.running && !!p.error && finishedAt && Date.now() - finishedAt < RECENT_MS && !dismissed.has(`probe:scan@${finishedAt}`);
  if (!p.running && !failedShown) return [];
  const status = p.running ? 'running' : 'failed';
  const listing = p.running && !p.toProbe && !p.probed;
  const startedAt = p.startedAt || null;
  const why = 'The library scan runs on its own';
  return [job({
    type: 'probe', sourceId: 'scan', title: 'Library scan', status,
    progress: listing ? null : (p.toProbe ? p.probed / p.toProbe : null),
    done: listing ? null : (p.probed || 0), total: listing ? null : (p.toProbe || null), unit: 'files',
    stage: listing ? `listing files · ${fmtN(p.files)} found` : null,
    startedAt, finishedAt: p.running ? null : finishedAt, elapsedMs: elapsed(startedAt, p.running ? null : finishedAt),
    error: status === 'failed' ? p.error : null,
    actions: fixed(why, [status === 'failed', why], { to: '/settings/space', label: 'Open Space' }),
    raw: { files: p.files || 0, toProbe: p.toProbe || 0, probed: p.probed || 0, known: p.known || 0, unprobed: p.unprobed || 0, errors: p.errors || 0 }
  })];
}

// ── assembling, once a second for every caller ───────────────
const SOURCES = [
  ['import', () => importJobs()],
  ['funpipe', (fresh) => funpipeJobs(fresh)],
  ['pipeline', (fresh) => pipelineJobs(fresh)],
  ['hash', () => hashJobs()],
  ['encode', () => encodeJobs()],
  ['cleanup', () => cleanupJobs()],
  ['train', () => trainJobs()],
  ['discover', () => discoverJobs()],
  ['probe', () => probeJobs()]
];

async function assemble(fresh) {
  // One broken source must not blank the others.
  const settled = await Promise.all(SOURCES.map(async ([name, read]) => {
    try {
      const out = await read(fresh);
      return Array.isArray(out) ? { jobs: out, capped: [] } : { jobs: out.jobs || [], capped: out.capped || [] };
    } catch (err) {
      console.warn(`[jobs] ${name} source failed: ${err.message}`);
      return { jobs: [], capped: [] };
    }
  }));
  return {
    jobs: settled.flatMap(s => s.jobs),
    capped: settled.flatMap(s => s.capped),
    serverTime: Date.now()
  };
}

const BUILD_TTL = 1000;
let built = null;          // { at, value }
let building = null;       // the assembly in progress for non-fresh callers

/** The whole list: from the cache when it is less than a second old, unless fresh. */
function build(fresh = false) {
  if (!fresh && built && Date.now() - built.at < BUILD_TTL) return Promise.resolve(built.value);
  if (!fresh && building) return building;
  const p = assemble(fresh).then(value => {
    built = { at: Date.now(), value };
    return value;
  }).finally(() => {
    if (building === p) building = null;
  });
  if (!fresh) building = p;
  return p;
}

/** After an action: the next read assembles again, and reads the local-db funpipe queue and a live scenetest again. */
function invalidate() {
  built = null;
  for (const key of ['funpipe', 'scenetest']) {
    const hit = remoteCache.get(key);
    if (hit && hit.ok && !hit.pending) remoteCache.delete(key);
  }
}

// ── acting on a row ──────────────────────────────────────────
/** uploadQueue answers { success: false, status, error } instead of throwing */
const sourceAnswer = (r) => {
  if (r && r.success === false) throw httpError(r.status || 409, r.error || 'Not possible now');
  return r;
};

async function dispatch(row, action) {
  const id = row.sourceId;
  const raw = row.raw || {};
  switch (row.type) {
    case 'import':
      if (action === 'retry') { sourceAnswer(await uploadQueue.retryJob(id)); return null; }
      if (action === 'remove') { sourceAnswer(uploadQueue.removeJob(id)); return null; }
      break;
    case 'funpipe':
      if (action === 'cancel' || action === 'remove') {
        const r = funpipeQueue.remove(Number(id));
        if (!r.ok) throw httpError(404, r.error === 'no such job' ? 'That job is no longer in the list' : r.error);
        return null;
      }
      if (action === 'retry') {
        // never reopens a stopped queue: funpipeQueue.enqueue, not funpipeService.enqueue (which starts it)
        const r = funpipeQueue.enqueue([raw.src], { pose: raw.pose !== false });
        if (!r.added) throw httpError(409, r.reason ? `Not queued again: ${r.reason}` : 'Not queued again');
        funpipeQueue.remove(Number(id));
        return null;
      }
      break;
    case 'pipeline': {
      const r = await scenetestService.act(id, action);
      if (!r.ok) throw httpError(502, r.error || 'scenetest did not answer');
      return null;
    }
    case 'hash': {
      const hashQueue = require('../services/hashQueue');
      if (action === 'cancel') { await hashQueue.cancel(id); return null; }
      if (action === 'retry') { await hashQueue.retry(id); return null; }
      if (action === 'front') { await hashQueue.front(id); return null; }
      if (action === 'remove') {
        const r = await hashQueue.remove(id);
        const u = r && r.undo;
        return u ? { undo: { method: 'POST', url: '/api/hashes/queue', body: { items: [{ performerId: u.performerId, mode: u.mode }] } } } : null;
      }
      break;
    }
    case 'encode': {
      const n = Number(id);
      if (action === 'pause') { await encodeQueue.pauseJob(n); return null; }
      if (action === 'resume') { await encodeQueue.resumeJob(n); return null; }
      if (action === 'front') { encodeQueue.bumpJob(n, 'up'); return null; }
      if (action === 'retry') { encodeQueue.retryJob(n); return null; }
      if (action === 'cancel') { encodeQueue.removeJob(n); return null; }
      if (action === 'remove') {
        if (raw.status === 'queued') encodeQueue.removeJob(n);
        else encodeQueue.dismissJob(n);
        return null;
      }
      break;
    }
    case 'train': {
      const n = Number(id);
      if (action === 'front') { trainingQueue.bump(n, 'up'); return null; }
      if (action === 'retry') { trainingQueue.retry(n); return null; }
      if (action === 'cancel') { trainingQueue.cancel(n); return null; }
      if (action === 'remove') {
        if (row.status === 'queued') trainingQueue.cancel(n);   // a waiting run ends as cancelled first
        trainingQueue.remove(n);
        return null;
      }
      break;
    }
    case 'discover':
      if (action === 'pause') {
        if (!discoverRunner.pause(id)) throw httpError(409, 'It is not running');
        return null;
      }
      if (action === 'remove') { dismissed.add(dismissKeyOf(row)); return null; }
      break;
    case 'cleanup':
    case 'probe':
      if (action === 'remove') { dismissed.add(dismissKeyOf(row)); return null; }
      break;
    default:
      break;
  }
  throw httpError(409, 'Not possible now');
}

/** The slot check, then the source's own action. */
async function actOn(row, action) {
  const s = row.actions && row.actions[action === 'resume' ? 'pause' : action];
  if (!s || !s.on || ((action === 'pause' || action === 'resume') && s.act !== action)) {
    throw httpError(409, (s && s.why) || 'Not possible now');
  }
  return dispatch(row, action);
}

const fail = (res, err) => res.status(err.status || 500).json({ error: err.message || 'Something went wrong' });

// ── routes ───────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const out = await build(req.query.fresh === '1');
    res.json(req.query.v === '2' ? out : out.jobs);
  } catch (err) {
    fail(res, err);
  }
});

router.post('/act', async (req, res) => {
  const { id, action } = req.body || {};
  if (!ACTIONS.includes(action)) return res.status(400).json({ error: `action must be one of ${ACTIONS.join(', ')}` });
  if (typeof id !== 'string' || !id) return res.status(400).json({ error: 'id is required' });
  try {
    const all = (await build(true)).jobs;
    const row = all.find(j => j.id === id);
    if (!row) throw httpError(404, 'That job is no longer in the list');
    const out = await actOn(row, action);
    invalidate();
    res.json({ success: true, undo: (out && out.undo) || null });
  } catch (err) {
    invalidate();
    fail(res, err);
  }
});

const kindOf = (req) => {
  const kind = req.body && req.body.kind != null && req.body.kind !== 'all' ? req.body.kind : null;
  if (kind != null && !KINDS.includes(kind)) throw httpError(400, `kind must be one of ${KINDS.join(', ')}`);
  return kind;
};

router.post('/clear-finished', async (req, res) => {
  let kind;
  try { kind = kindOf(req); } catch (err) { return fail(res, err); }
  try {
    const all = (await build(true)).jobs;
    const rows = all.filter(j => (!kind || j.type === kind) && (j.status === 'done' || j.status === 'cancelled') && j.actions?.remove?.on);
    const kinds = [...new Set(rows.map(j => j.type))];
    let cleared = 0;
    const errors = [];
    const noteError = (k, err) => { if (!errors.some(e => e.kind === k)) errors.push({ kind: k, error: err.message || String(err) }); };
    for (const k of kinds) {
      const mine = rows.filter(j => j.type === k);
      try {
        if (k === 'import') cleared += num(uploadQueue.clearCompleted().cleared);
        else if (k === 'funpipe') cleared += num(funpipeQueue.clearDone({ keepFailed: true }).removed);
        else if (k === 'hash') cleared += num(await require('../services/hashQueue').clearFinished());
        else if (k === 'encode') cleared += num(encodeQueue.clearFinished({ keepFailed: true }));
        else if (k === 'pipeline') {
          for (const j of mine) {
            const r = await scenetestService.act(j.sourceId, 'remove');
            if (r.ok) cleared += 1;
            else noteError(k, httpError(502, r.error || 'scenetest did not answer'));
          }
        } else if (k === 'train') {
          for (const j of mine) {
            try { trainingQueue.remove(Number(j.sourceId)); cleared += 1; } catch (err) { noteError(k, err); }
          }
        } else {
          for (const j of mine) { dismissed.add(dismissKeyOf(j)); cleared += 1; }
        }
      } catch (err) {
        noteError(k, err);
      }
    }
    invalidate();
    res.json({ success: true, cleared, errors });
  } catch (err) {
    invalidate();
    fail(res, err);
  }
});

router.post('/retry-failed', async (req, res) => {
  let kind;
  try { kind = kindOf(req); } catch (err) { return fail(res, err); }
  try {
    const all = (await build(true)).jobs;
    const rows = all.filter(j => (!kind || j.type === kind) && j.status === 'failed' && j.actions?.retry?.on);
    let retried = 0;
    const errors = [];
    for (const row of rows) {
      try {
        await dispatch(row, 'retry');
        retried += 1;
      } catch (err) {
        errors.push({ id: row.id, title: row.title, error: err.message || String(err) });
      }
    }
    invalidate();
    res.json({ success: true, retried, errors });
  } catch (err) {
    invalidate();
    fail(res, err);
  }
});

router.get('/services', async (req, res) => {
  const fresh = req.query.fresh === '1';
  funpipeService.pair(`${req.protocol}://${req.get('host')}`);   // the Jobs page keeps acm-gpu paired as a worker
  const [queue, health, training, scenetest] = await Promise.all([
    getFunpipeQueue(fresh), getFunpipeHealth(fresh), getTraining(fresh), getScenetest(fresh)
  ]);
  const workers = Array.isArray(queue.workers) ? queue.workers : [];
  const newest = workers.reduce((a, w) => (w && w.lastSeen && (!a || w.lastSeen > a.lastSeen) ? w : a), null);
  let encodeRunning = null;
  try { encodeRunning = !!encodeQueue.isRunning(); } catch (_) { /* the setting could not be read */ }
  res.json({
    // online: a worker (acm-gpu) has asked for jobs in the last 90 s; workerRunning: and the queue is not stopped
    funpipe: {
      online: !!queue.online, workerRunning: !!queue.running, url: queue.url, paused: !!queue.paused,
      lastSeen: newest ? newest.lastSeen : null, worker: newest ? newest.name || null : null
    },
    scenetest: { online: scenetest.ok, paused: !!scenetest.paused, url: scenetest.url, error: scenetest.ok ? null : scenetest.error },
    gpu: { warning: health.ok !== false ? (health.gpu_warning || null) : null },
    ffmpeg: { available: encodeQueue.localEngine().ok },
    encode: { running: encodeRunning },
    ai: { online: training.ok || health.ok !== false, url: getAiServerUrl(), trainingActive: !!(training.ok && training.active) }
  });
});

// Settings → Workers: every machine that works for this app, in one answer — acm-gpu (its address, whether it's
// paired and claiming, its host agent and lanes), scenetest, and the re-encode workers with their host agents.
const getAiHealth = (fresh) => remote('aiHealth', async () => {
  try {
    const base = String(getAiServerUrl()).replace(/\/+$/, '');
    return { ok: true, ...(await axios.get(`${base}/health`, { timeout: 5000 })).data };
  } catch (e) {
    return { ok: false, error: e.code === 'ECONNREFUSED' ? 'not running' : e.message };
  }
}, v => v.ok, fresh);
const settingOf = (key) => db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key)?.value ?? null;

router.get('/workers', async (req, res) => {
  const fresh = req.query.fresh === '1';
  funpipeService.pair(`${req.protocol}://${req.get('host')}`);   // opening Settings keeps acm-gpu paired too
  const [queue, ai, scenetest] = await Promise.all([getFunpipeQueue(fresh), getAiHealth(fresh), getScenetest(fresh)]);
  res.json({
    ai: {
      url: getAiServerUrl(), online: !!ai.ok, error: ai.ok ? null : ai.error, device: ai.device || null,
      // claiming: it has asked for funpipe or training work in the last 90 s (paired, with the worker token)
      claiming: !!queue.online, agent: ai.ok ? ai.host_agent || null : null,
    },
    scenetest: {
      url: scenetest.url || settingOf('scenetest_url'), online: !!scenetest.ok, paused: !!scenetest.paused, error: scenetest.ok ? null : scenetest.error,
      ownUrl: settingOf('scenetest_url'), mediaRoot: settingOf('scenetest_media_root'),
    },
    encode: encodeQueue.listWorkers().map(w => ({
      id: w.id, name: w.name, local: !!w.local, online: !!w.online, enabled: !!w.enabled, lastSeen: w.lastSeen || null, note: w.note || null,
      job: w.job ? { label: w.job.label, phase: w.job.phase, progress: w.job.progress } : null,
      agent: w.info?.agent || null, encoder: w.info ? (w.info.nvenc ? `${w.info.gpu || 'NVIDIA'} · NVENC` : w.info.encoder || (w.info.threads ? `CPU · ${w.info.threads} threads` : null)) : null,
    })),
  });
});

/** Old callers: hide ended cleanup, Discover and library-scan rows, by row id or by their dismiss key. */
router.post('/dismiss', async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : [];
  const rows = [];
  for (const read of [cleanupJobs, discoverJobs, probeJobs]) {
    try { rows.push(...read()); } catch (err) { console.warn(`[jobs] dismiss: ${err.message}`); }
  }
  const ended = rows.filter(j => isEnded(j.status));
  let count = 0;
  for (const id of ids) {
    const row = ended.find(j => j.id === id || dismissKeyOf(j) === id);
    if (row) { dismissed.add(dismissKeyOf(row)); count++; }
  }
  if (count) invalidate();
  res.json({ success: true, dismissed: count });
});

module.exports = router;
