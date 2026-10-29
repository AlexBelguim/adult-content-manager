/**
 * The funpipe queue, kept in the app (funpipe_jobs, migration 015).
 *
 * acm-gpu on the GPU PC is a worker (routes/workers.js): it claims the next job, downloads the video, runs the stages
 * on its own copy, sends progress and uploads the sidecars and the funscript, which are written here next to the video.
 * It never reads or writes the library itself. This replaces the queue that lived in acm-gpu, which read and wrote
 * the video's folder on the NAS share.
 *
 * running: the queue is open (Start; Stop lets the running job finish and claims nothing more) and a worker has been
 * heard from in the last ONLINE_MS. A running job whose worker has not reported for STALE_MS is put back in the queue.
 */
const crypto = require('crypto');
const EventEmitter = require('events');
const fs = require('fs-extra');
const path = require('path');
const db = require('../db');

const VIDEO_EXTS = ['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.ts'];
// what a worker may read and write next to a video: funpipe's sidecars and the playable script
const SIDECARS = ['.scenes.json', '.tracks.npz', '.pose.json', '.signal.json', '.edits.json', '.funscript'];
const ONLINE_MS = 90 * 1000;
const STALE_MS = 10 * 60 * 1000;
const LOG_LINES = 60;

const events = new EventEmitter();   // 'changed': a job finished or sidecars were written (the library listing is stale)
const workers = new Map();           // name -> { name, lastSeen, info }

// intermediates are <video.ext>.<name>; the playable script is stem-based (<video>.funscript) so players find it
const sidecarPath = (video, ext) => (ext === '.funscript' ? video.slice(0, -path.extname(video).length) + '.funscript' : video + ext);

const setting = (key) => db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key)?.value ?? null;
const setSetting = (key, value) => db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);

/** the token a worker sends as its bearer; made the first time it is asked for */
function workerToken() {
  let t = setting('worker_token');
  if (!t) {
    t = crypto.randomBytes(24).toString('hex');
    setSetting('worker_token', t);
  }
  return t;
}

const paused = () => setting('funpipe_paused') === '1';
const online = () => [...workers.values()].some(w => Date.now() - w.lastSeen < ONLINE_MS);

/**
 * A video a worker may get or change files next to: an existing video file inside one of the library's base folders,
 * so a worker can never reach anything else on the NAS.
 */
function libraryVideo(p) {
  if (!p || !VIDEO_EXTS.includes(path.extname(p).toLowerCase())) return null;
  const abs = path.resolve(p);
  const roots = db.prepare('SELECT path FROM folders').all().map(f => path.resolve(f.path));
  if (!roots.some(r => abs === r || abs.startsWith(r + path.sep))) return null;
  return fs.existsSync(abs) && fs.statSync(abs).isFile() ? abs : null;
}

/** only the stages whose sidecars are missing, as funpipe always planned them: resume is free */
function planStages(video, pose) {
  const has = (ext) => fs.existsSync(sidecarPath(video, ext));
  const stages = [];
  if (!has('.scenes.json')) stages.push('scenes');
  if (!has('.tracks.npz')) stages.push('track');
  if (pose && !has('.pose.json')) stages.push('pose');
  if (!has('.signal.json') || stages.length) stages.push('extract');
  return stages;
}

function enqueue(videos, { pose = true } = {}) {
  const busy = new Set(db.prepare("SELECT video_path FROM funpipe_jobs WHERE status IN ('queued', 'running')").all().map(r => r.video_path));
  const insert = db.prepare('INSERT INTO funpipe_jobs (video_path, pose, stages, status, created_at) VALUES (?, ?, ?, ?, ?)');
  let added = 0;
  const skipped = [];
  for (const raw of videos) {
    const video = libraryVideo(raw);
    if (!video) { skipped.push({ video: raw, reason: 'not a video in the library' }); continue; }
    if (busy.has(video)) { skipped.push({ video: raw, reason: 'already queued' }); continue; }
    const stages = planStages(video, pose);
    if (!stages.length) { skipped.push({ video: raw, reason: 'already processed' }); continue; }
    insert.run(video, pose ? 1 : 0, JSON.stringify(stages), 'queued', Date.now());
    busy.add(video);
    added += 1;
  }
  return { queued: added > 0, added, skipped, reason: added === 0 && skipped.length ? skipped[0].reason : undefined };
}

/** a running job nobody has reported on for STALE_MS goes back in the queue (its worker stopped or lost the app) */
function requeueStale() {
  db.prepare("UPDATE funpipe_jobs SET status = 'queued', worker = NULL, stage = NULL, phase = NULL, progress = NULL WHERE status = 'running' AND heartbeat_at < ?")
    .run(Date.now() - STALE_MS);
}

/** a job as the Jobs page and the Funpipe page read it (the shape acm-gpu's queue had) */
function view(r) {
  const log = r.log ? JSON.parse(r.log) : [];
  return {
    id: r.id, video: r.video_path, src: r.video_path, name: path.basename(r.video_path),
    stages: JSON.parse(r.stages), pose: !!r.pose, status: r.status, stage: r.stage, phase: r.phase, progress: r.progress,
    windows_done: r.windows_done, total_windows: r.total_windows, gpu_warning: r.gpu_warning, worker: r.worker,
    started: r.started_at ? r.started_at / 1000 : null,
    elapsed: r.finished_at && r.started_at ? (r.finished_at - r.started_at) / 1000 : null,
    error: r.error, log_tail: log.slice(-6),
  };
}

function list() {
  requeueStale();
  const rows = db.prepare('SELECT * FROM funpipe_jobs ORDER BY id').all();
  return {
    ok: true, paused: paused(), online: online(), running: !paused() && online(),
    workers: [...workers.values()].map(w => ({ name: w.name, online: Date.now() - w.lastSeen < ONLINE_MS, lastSeen: w.lastSeen, info: w.info })),
    jobs: rows.map(view),
  };
}

function start() { setSetting('funpipe_paused', '0'); return { ok: true }; }
function stop() { setSetting('funpipe_paused', '1'); return { ok: true }; }   // the running job finishes; nothing new is claimed

/** a queued or finished job is dropped; a running one is cancelled (its worker stops at its next progress report) */
function remove(id) {
  const r = db.prepare('SELECT status FROM funpipe_jobs WHERE id = ?').get(id);
  if (!r) return { ok: false, error: 'no such job' };
  if (r.status === 'running') db.prepare("UPDATE funpipe_jobs SET status = 'cancelled', finished_at = ? WHERE id = ?").run(Date.now(), id);
  else db.prepare('DELETE FROM funpipe_jobs WHERE id = ?').run(id);
  return { ok: true };
}

function clearDone() {
  const n = db.prepare("DELETE FROM funpipe_jobs WHERE status IN ('done', 'failed', 'cancelled')").run().changes;
  return { ok: true, removed: n };
}

// ── the worker's side ────────────────────────────────────────

function heartbeat(name, info) {
  workers.set(name, { name, lastSeen: Date.now(), info: info || workers.get(name)?.info || null });
}

/**
 * the next queued job for this worker, or null; with the sidecars already next to the video (it downloads those);
 * with wantId (the control panel, which orders every app's jobs in one list) that job, if it's still waiting
 */
function claim(name, info, wantId = null) {
  heartbeat(name, info);
  requeueStale();
  if (paused()) return null;
  const take = db.transaction(() => {
    const r = wantId
      ? db.prepare("SELECT * FROM funpipe_jobs WHERE status = 'queued' AND id = ?").get(wantId)
      : db.prepare("SELECT * FROM funpipe_jobs WHERE status = 'queued' ORDER BY id LIMIT 1").get();
    if (!r) return null;
    const now = Date.now();
    db.prepare("UPDATE funpipe_jobs SET status = 'running', worker = ?, started_at = ?, heartbeat_at = ?, stage = NULL, phase = 'claimed', progress = NULL, error = NULL, finished_at = NULL WHERE id = ?")
      .run(name, now, now, r.id);
    return r;
  });
  const r = take();
  if (!r) return null;
  if (!libraryVideo(r.video_path)) {   // moved or deleted since it was queued
    fail(name, r.id, 'the video is no longer in the library');
    return wantId ? null : claim(name, info);
  }
  // planned again now: a sidecar may have arrived since it was queued
  const stages = planStages(r.video_path, !!r.pose);
  db.prepare('UPDATE funpipe_jobs SET stages = ? WHERE id = ?').run(JSON.stringify(stages), r.id);
  return {
    id: r.id, video: r.video_path, name: path.basename(r.video_path), pose: !!r.pose, stages,
    size: fs.statSync(r.video_path).size,
    sidecars: SIDECARS.filter(ext => fs.existsSync(sidecarPath(r.video_path, ext))),
  };
}

/** what's waiting, in the order it would be handed out (for the control panel); none while the queue is paused */
function queued() {
  return db.prepare("SELECT id, video_path, pose FROM funpipe_jobs WHERE status = 'queued' ORDER BY id LIMIT 200").all()
    .map(r => ({ id: r.id, label: path.basename(r.video_path), kind: 'funscript', why: r.pose ? ['with poses'] : [], priority: 0 }));
}

const own = (name, id) => db.prepare("SELECT * FROM funpipe_jobs WHERE id = ? AND worker = ?").get(id, name);

/** { stage, phase, progress, windows_done, total_windows, gpu_warning, log: [new lines] } -> { action: continue | cancel } */
function progress(name, id, p) {
  heartbeat(name);
  const r = own(name, id);
  if (!r || r.status !== 'running') return { action: 'cancel' };
  const log = [...(r.log ? JSON.parse(r.log) : []), ...(Array.isArray(p.log) ? p.log.map(String) : [])].slice(-LOG_LINES);
  db.prepare(`UPDATE funpipe_jobs SET stage = ?, phase = ?, progress = ?, windows_done = ?, total_windows = ?, gpu_warning = ?, log = ?,
    heartbeat_at = ? WHERE id = ?`).run(p.stage ?? r.stage, p.phase ?? r.phase, Number.isFinite(p.progress) ? p.progress : null,
    p.windows_done ?? null, p.total_windows ?? null, p.gpu_warning ?? null, JSON.stringify(log), Date.now(), id);
  return { action: 'continue' };
}

function finish(name, id, status, error) {
  const r = own(name, id);
  if (!r) return false;
  db.prepare('UPDATE funpipe_jobs SET status = ?, error = ?, stage = NULL, phase = NULL, progress = ?, finished_at = ? WHERE id = ?')
    .run(r.status === 'cancelled' ? 'cancelled' : status, error ? String(error).slice(0, 1000) : null, status === 'done' ? 1 : null, Date.now(), id);
  events.emit('changed');
  return true;
}
const complete = (name, id) => finish(name, id, 'done', null);
const fail = (name, id, error) => finish(name, id, 'failed', error || 'failed');

/** one sidecar of a library video: its path, or null when the video or the name is not one a worker may touch */
function sidecarFile(video, ext) {
  const v = libraryVideo(video);
  return v && SIDECARS.includes(ext) ? sidecarPath(v, ext) : null;
}

/** write a sidecar from a request body: to a temporary file first, so a broken upload never replaces a good file */
async function writeSidecar(video, ext, stream) {
  const dest = sidecarFile(video, ext);
  if (!dest) return { status: 400, error: 'not a funpipe file of a video in the library' };
  const tmp = `${dest}.upload-${process.pid}`;
  try {
    await new Promise((resolve, reject) => {
      const out = fs.createWriteStream(tmp);
      stream.on('error', reject);
      out.on('error', reject);
      out.on('finish', resolve);
      stream.pipe(out);
    });
    await fs.move(tmp, dest, { overwrite: true });
  } catch (err) {
    await fs.remove(tmp).catch(() => {});
    return { status: 500, error: err.message };
  }
  events.emit('changed');
  return { status: 200, path: dest, size: (await fs.stat(dest)).size };
}

module.exports = {
  VIDEO_EXTS, SIDECARS, events, workerToken, libraryVideo, sidecarPath,
  enqueue, list, start, stop, remove, clearDone,
  heartbeat, claim, queued, paused, progress, complete, fail, sidecarFile, writeSidecar,
};
