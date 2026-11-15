/**
 * The label queue, kept in the app (label_jobs, migration 025), and "Labels + funscript": a label job and a funscript
 * job (funpipe_jobs, mode 'scenes') that waits for it.
 *
 * A worker node's acm-gpu claims a label job through the coordinator (kind acm-label; routes/workers.js /label/*),
 * downloads the video, runs labelmaster on it, uploads the full scenes and motion documents as the video's .labels.json
 * and .motion.json sidecars, and completes with the labels (they land in video_labels, as scenetest's did, and the
 * video gets the tags their scenes meet). A funscript job of the same video is handed out once its label job is done;
 * it reads those two sidecars. A label job that fails or is removed takes the funscript waiting for it along.
 *
 * run_on: the coordinator's node id a job must run on (an app's "Run on"); null = the order set for its kind there.
 */
const fs = require('fs-extra');
const path = require('path');
const db = require('../db');
const fq = require('./funpipeQueue');
const videoLabels = require('./videoLabels');

const LOG_LINES = 60;
const DOCS = ['.labels.json', '.motion.json'];   // what a funscript made from the scenes needs beside the video

/** the labels' full documents are beside the video (a funscript can be made from them without labelling again) */
const hasDocs = (video) => DOCS.every(ext => fs.existsSync(fq.sidecarPath(video, ext)));
/** a script made by the scenes pipeline (scenetest's or a node's) is beside the video */
function hasOurScript(video) {
  try {
    return ['scenetest+funpipe', 'acm-scenes'].includes(fs.readJsonSync(fq.sidecarPath(video, '.funscript')).author);
  } catch (_) {
    return false;
  }
}

const runOnOf = (v) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 100) : null);

/**
 * videos: library paths. funscript: also a funscript job made from the scenes. skipDone: a video already labelled (and,
 * for a funscript, with its label documents beside it) is not labelled again, and one with our script gets no new one.
 * -> { videos, labels, funscript, skipped: [{ video, reason }] }
 */
function enqueue(videos, { funscript = false, runOn = null, skipDone = true } = {}) {
  const node = runOnOf(runOn);
  const openLabel = db.prepare("SELECT id FROM label_jobs WHERE video_path = ? AND status IN ('queued', 'running') ORDER BY id DESC LIMIT 1");
  const openScript = db.prepare("SELECT id FROM funpipe_jobs WHERE video_path = ? AND mode = 'scenes' AND status IN ('queued', 'running')");
  const addLabel = db.prepare("INSERT INTO label_jobs (video_path, status, run_on, created_at) VALUES (?, 'queued', ?, ?)");
  const addScript = db.prepare("INSERT INTO funpipe_jobs (video_path, pose, stages, status, created_at, mode, wait_label, run_on) VALUES (?, 1, ?, 'queued', ?, 'scenes', ?, ?)");
  const out = { videos: 0, labels: 0, funscript: 0, skipped: [] };
  db.transaction(() => {
    for (const raw of videos) {
      const video = fq.libraryVideo(raw);
      if (!video) { out.skipped.push({ video: raw, reason: 'not a video in the library' }); continue; }
      out.videos += 1;
      const wantScript = funscript && !openScript.get(video) && !(skipDone && hasOurScript(video));
      // labels: for a funscript only when its documents aren't beside the video; on their own unless it's labelled already
      const needLabel = funscript && wantScript ? !(skipDone && hasDocs(video)) : !(skipDone && videoLabels.labelled(video));
      let labelId = openLabel.get(video)?.id || null;
      if (needLabel && !labelId) {
        labelId = addLabel.run(video, node, Date.now()).lastInsertRowid;
        out.labels += 1;
      }
      if (wantScript) {
        addScript.run(video, JSON.stringify(['from-scenes']), Date.now(), labelId, node);   // waits for the label job, if one is open
        out.funscript += 1;
      }
      if (!needLabel && !wantScript) out.skipped.push({ video: raw, reason: funscript ? 'already has its funscript' : 'already labelled' });
    }
  })();
  return out;
}

/** a running job nobody has reported on for STALE_MS goes back in the queue */
function requeueStale() {
  db.prepare("UPDATE label_jobs SET status = 'queued', worker = NULL, stage = NULL, progress = NULL WHERE status = 'running' AND heartbeat_at < ?")
    .run(Date.now() - fq.STALE_MS);
}

function view(r) {
  const log = r.log ? JSON.parse(r.log) : [];
  return {
    id: r.id, video: r.video_path, name: path.basename(r.video_path), status: r.status, runOn: r.run_on || null,
    worker: r.worker, stage: r.stage, progress: r.progress, message: r.message, error: r.error,
    result: r.result ? JSON.parse(r.result) : null, log_tail: log.slice(-6),
    created: r.created_at, started: r.started_at || null, finished: r.finished_at || null, heartbeat: r.heartbeat_at || null,
    // the funscript waiting for it, if any
    then: db.prepare("SELECT id FROM funpipe_jobs WHERE wait_label = ? AND status = 'queued'").get(r.id)?.id || null,
  };
}

function list() {
  requeueStale();
  return { ok: true, paused: fq.paused(), jobs: db.prepare('SELECT * FROM label_jobs ORDER BY id').all().map(view) };
}

/** the funscripts waiting for this label job end with it: failed with the reason, or removed */
function endWaiting(id, why) {
  if (why) {
    db.prepare("UPDATE funpipe_jobs SET status = 'failed', error = ?, finished_at = ? WHERE wait_label = ? AND status = 'queued'")
      .run(`its labels failed: ${why}`.slice(0, 1000), Date.now(), id);
  } else {
    db.prepare("DELETE FROM funpipe_jobs WHERE wait_label = ? AND status = 'queued'").run(id);
  }
}

/** a queued or finished job is dropped (and the funscript waiting for it); a running one is cancelled */
function remove(id) {
  const r = db.prepare('SELECT status FROM label_jobs WHERE id = ?').get(id);
  if (!r) return { ok: false, error: 'no such job' };
  if (r.status === 'running') db.prepare("UPDATE label_jobs SET status = 'cancelled', finished_at = ? WHERE id = ?").run(Date.now(), id);
  else db.prepare('DELETE FROM label_jobs WHERE id = ?').run(id);
  endWaiting(id, null);
  return { ok: true };
}

/** a failed or cancelled job back in the queue; a funscript that failed with it goes back to waiting for it */
function retry(id) {
  const r = db.prepare('SELECT status FROM label_jobs WHERE id = ?').get(id);
  if (!r) return { ok: false, error: 'no such job' };
  if (!['failed', 'cancelled'].includes(r.status)) return { ok: false, error: 'only a failed or cancelled job can be retried' };
  db.prepare("UPDATE label_jobs SET status = 'queued', worker = NULL, stage = NULL, progress = NULL, message = NULL, error = NULL, finished_at = NULL WHERE id = ?").run(id);
  db.prepare("UPDATE funpipe_jobs SET status = 'queued', error = NULL, finished_at = NULL WHERE wait_label = ? AND status = 'failed' AND error LIKE 'its labels failed:%'").run(id);
  return { ok: true };
}

function clearDone({ keepFailed = false } = {}) {
  const n = db.prepare(keepFailed ? "DELETE FROM label_jobs WHERE status IN ('done', 'cancelled')" : "DELETE FROM label_jobs WHERE status IN ('done', 'failed', 'cancelled')").run().changes;
  return { ok: true, removed: n };
}

// ── the worker's side ────────────────────────────────────────

/** what's waiting, in the order it would be handed out (for the coordinator); none while the queue is paused */
function queued() {
  if (fq.paused()) return [];
  return db.prepare("SELECT id, video_path, run_on FROM label_jobs WHERE status = 'queued' ORDER BY id LIMIT 200").all()
    .map(r => ({ id: r.id, label: path.basename(r.video_path), kind: 'label', why: [], priority: 0, node: r.run_on || null }));
}

/** the next queued job for this worker (wantId: that one, if it's still waiting), or null */
function claim(name, info, wantId = null) {
  fq.heartbeat(name, info);
  requeueStale();
  if (fq.paused()) return null;
  const r = db.transaction(() => {
    const row = wantId
      ? db.prepare("SELECT * FROM label_jobs WHERE status = 'queued' AND id = ?").get(wantId)
      : db.prepare("SELECT * FROM label_jobs WHERE status = 'queued' ORDER BY id LIMIT 1").get();
    if (!row) return null;
    const now = Date.now();
    db.prepare("UPDATE label_jobs SET status = 'running', worker = ?, started_at = ?, heartbeat_at = ?, stage = 'claimed', progress = NULL, error = NULL, finished_at = NULL WHERE id = ?")
      .run(name, now, now, row.id);
    return row;
  })();
  if (!r) return null;
  if (!fq.libraryVideo(r.video_path)) {
    fail(name, r.id, 'the video is no longer in the library');
    return wantId ? null : claim(name, info);
  }
  return { id: r.id, video: r.video_path, name: path.basename(r.video_path), label: path.basename(r.video_path), size: fs.statSync(r.video_path).size };
}

const own = (name, id) => db.prepare('SELECT * FROM label_jobs WHERE id = ? AND worker = ?').get(id, name);

/** { stage, progress, message, log: [new lines] } -> { action: continue | cancel } */
function progress(name, id, p = {}) {
  fq.heartbeat(name);
  const r = own(name, id);
  if (!r || r.status !== 'running') return { action: 'cancel' };
  const log = [...(r.log ? JSON.parse(r.log) : []), ...(Array.isArray(p.log) ? p.log.map(String) : [])].slice(-LOG_LINES);
  db.prepare('UPDATE label_jobs SET stage = ?, progress = ?, message = ?, log = ?, heartbeat_at = ? WHERE id = ?')
    .run(p.stage ?? r.stage, Number.isFinite(p.progress) ? p.progress : r.progress, p.message ?? r.message, JSON.stringify(log), Date.now(), id);
  return { action: 'continue' };
}

/**
 * { labels: { seconds, model, scenes, exposure } }: stored for the video (video_labels, its tags), after the worker
 * uploaded .labels.json and .motion.json. Returns false when the job isn't this worker's; throws on bad labels.
 */
function complete(name, id, body = {}) {
  const r = own(name, id);
  if (!r) return false;
  if (r.status === 'cancelled') return true;
  const labels = body.labels || {};
  const { tagsAdded } = videoLabels.store({ ...labels, path: r.video_path });
  const result = { scenes: labels.scenes.length, model: labels.model || null, tagsAdded, docs: hasDocs(r.video_path) };
  db.prepare("UPDATE label_jobs SET status = 'done', stage = NULL, progress = 1, result = ?, finished_at = ? WHERE id = ?")
    .run(JSON.stringify(result), Date.now(), id);
  // a funscript waiting for it can't be made without the documents
  if (!result.docs) endWaiting(id, 'its scenes and motion files did not arrive');
  fq.events.emit('changed');
  return true;
}

function fail(name, id, error) {
  const r = own(name, id);
  if (!r) return false;
  const why = String(error || 'failed').slice(0, 1000);
  db.prepare('UPDATE label_jobs SET status = ?, error = ?, stage = NULL, finished_at = ? WHERE id = ?')
    .run(r.status === 'cancelled' ? 'cancelled' : 'failed', why, Date.now(), id);
  endWaiting(id, why);
  return true;
}

module.exports = { DOCS, hasDocs, enqueue, list, view, remove, retry, clearDone, queued, claim, progress, complete, fail };
