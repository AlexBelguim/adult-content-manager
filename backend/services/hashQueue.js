/**
 * The hash-build queue (table hash_jobs, migration 021).
 *
 * Every hash database build goes through here: the Performer Management buttons, the settings dialog and imports
 * (uploadImporter step g, through enqueueAndWait). One build runs at a time, also across processes: a running row
 * whose heartbeat_at is newer than STALE_MS blocks the next one. Order: priority DESC, queued_at, id.
 * The build itself is hashService.createHashDB with the row id as its job id; a HEARTBEAT_MS interval copies its
 * progress into the row and passes a Cancel on (cancel_requested) to hashService.cancelJob.
 * A process that stops (exit, SIGTERM, SIGINT) puts the build it runs back at the front of the queue; a running row
 * cut off any other way (no heartbeat for STALE_MS) ends as failed with 'Stopped by a server restart'.
 * Times are in ms. Every thrown error is an Error with .status (404, 409).
 */
const db = require('../db');
const hashService = require('./hashService');

const STALE_MS = 120000;
const HEARTBEAT_MS = 2000;
const SHOW_ENDED_MS = 6 * 60 * 60 * 1000;
const PRUNE_MS = 7 * 24 * 60 * 60 * 1000;
const KICK_EVERY_MS = 30000;
const FIRST_KICK_MS = 5000;

const ACTIVE = "('queued', 'running')";

const httpError = (status, msg) => Object.assign(new Error(msg), { status });

let started = false;
let busy = false;
let current = null; // the id of the row this process runs
// jobId -> [{ resolve, reject, onStart, onProgress, started }]; in memory only
const waiters = new Map();

// ── start and recovery ─────────────────────────────────────────

function ensureStarted() {
  if (!started) start();
}

/** Idempotent: recover once, then a kick every 30 s and one 5 s from now. */
function start() {
  if (started) return;
  started = true;
  try { recover(); } catch (err) { console.error('[HashQueue] Recovery failed:', err.message); }
  setInterval(kick, KICK_EVERY_MS).unref();
  setTimeout(kick, FIRST_KICK_MS).unref();
  // A stop (Settings → System → Restart, a Deploy rebuild, Ctrl+C) puts the build this process runs back at the
  // front of the queue, so the next start runs it again instead of waiting STALE_MS and failing it.
  process.once('exit', release);
  for (const sig of ['SIGTERM', 'SIGINT']) {
    const onSignal = () => {
      release();
      // nobody else handles it: end the way Node would have without this listener
      if (process.listenerCount(sig) === 1) {
        process.removeListener(sig, onSignal);
        process.kill(process.pid, sig);
      }
    };
    process.on(sig, onSignal);
  }
}

/** The build this process runs goes back to the front of the queue (it starts from the top when it runs again). */
function release() {
  if (current == null) return;
  const id = current;
  current = null;
  try {
    db.prepare(`
      UPDATE hash_jobs SET status = 'queued', started_at = NULL, heartbeat_at = NULL, cancel_requested = 0,
        priority = (SELECT COALESCE(MAX(priority), 0) + 1 FROM hash_jobs WHERE status = 'queued')
      WHERE id = ? AND status = 'running' AND cancel_requested = 0
    `).run(id);
    // one that was being cancelled just ends as cancelled
    db.prepare("UPDATE hash_jobs SET status = 'cancelled', error = NULL, finished_at = ? WHERE id = ? AND status = 'running'").run(Date.now(), id);
  } catch (err) {
    console.error('[HashQueue] Could not put the running build back in the queue:', err.message);
  }
}

/** A running row with no heartbeat for STALE_MS ends as failed; done and cancelled rows older than 7 days go. */
function recover() {
  const now = Date.now();
  db.prepare(`
    UPDATE hash_jobs SET status = 'failed', error = 'Stopped by a server restart', finished_at = ?
    WHERE status = 'running' AND (heartbeat_at IS NULL OR heartbeat_at < ?)
  `).run(now, now - STALE_MS);
  db.prepare("DELETE FROM hash_jobs WHERE status IN ('done', 'cancelled') AND finished_at < ?").run(now - PRUNE_MS);
}

// ── waiters (enqueueAndWait) ───────────────────────────────────

function addWaiter(jobId, w) {
  const list = waiters.get(jobId) || [];
  list.push(w);
  waiters.set(jobId, list);
}

function startWaiter(w) {
  if (w.started) return;
  w.started = true;
  if (typeof w.onStart === 'function') {
    try { w.onStart(); } catch (err) { console.error('[HashQueue] onStart failed:', err.message); }
  }
}

function settleWaiters(jobId, err, value) {
  const list = waiters.get(jobId);
  if (!list) return;
  waiters.delete(jobId);
  for (const w of list) {
    if (err) w.reject(err);
    else w.resolve(value);
  }
}

/** Waiters on rows that ended or went without this process running them (another process, a recovery). */
function settleEnded() {
  if (waiters.size === 0) return;
  for (const jobId of [...waiters.keys()]) {
    const row = rowOf(jobId);
    if (!row) settleWaiters(jobId, new Error('Removed from the hash queue'));
    else if (row.status === 'done') settleWaiters(jobId, null, { jobId, status: 'done', hashCount: (row.succeeded || 0) + (row.skipped || 0) });
    else if (row.status === 'failed') settleWaiters(jobId, new Error(row.error || 'Cancelled'));
    else if (row.status === 'cancelled') settleWaiters(jobId, new Error('Cancelled'));
    else if (row.status === 'running') for (const w of waiters.get(jobId) || []) startWaiter(w);
  }
}

// ── running ────────────────────────────────────────────────────

function maxQueuedPriority() {
  const r = db.prepare("SELECT MAX(priority) AS m FROM hash_jobs WHERE status = 'queued'").get();
  return r && r.m != null ? r.m : 0;
}

/** A queued_at behind every waiting row, also one queued in the same millisecond. */
function endOfQueue() {
  const r = db.prepare("SELECT MAX(queued_at) AS m FROM hash_jobs WHERE status = 'queued'").get();
  return Math.max(Date.now(), r && r.m != null ? r.m + 1 : 0);
}

/** Start the next queued build when nothing runs here or (with a fresh heartbeat) in another process. */
function kick() {
  if (busy) return;
  try {
    ensureStarted();
    recover();
    settleEnded();
  } catch (err) {
    console.error('[HashQueue] Could not check the queue:', err.message);
  }
  let row = null;
  try {
    row = db.transaction(() => {
      const now = Date.now();
      const live = db.prepare("SELECT id FROM hash_jobs WHERE status = 'running' AND heartbeat_at >= ? LIMIT 1").get(now - STALE_MS);
      if (live) return null;
      const next = db.prepare("SELECT * FROM hash_jobs WHERE status = 'queued' ORDER BY priority DESC, queued_at, id LIMIT 1").get();
      if (!next) return null;
      const r = db.prepare(`
        UPDATE hash_jobs SET status = 'running', started_at = ?, heartbeat_at = ?, processed = 0, total = 0, succeeded = 0,
          skipped = 0, failed_count = 0, failed_files = NULL, marked_deleted = NULL, warning = NULL, error = NULL,
          cancel_requested = 0, finished_at = NULL
        WHERE id = ? AND status = 'queued'
      `).run(now, now, next.id);
      return r.changes === 1 ? next : null;
    }).immediate();
  } catch (err) {
    console.error('[HashQueue] Could not take the next build:', err.message);
    return;
  }
  if (row) run(row);
}

function run(row) {
  busy = true;
  const id = row.id;
  current = id;
  const jobId = String(id);
  let timer = null;

  try {
    for (const w of waiters.get(jobId) || []) startWaiter(w);

    const tick = () => {
      try {
        const j = hashService.getJobStatus(jobId);
        const total = j ? j.total || 0 : 0;
        let processed = j ? j.processed || 0 : 0;
        if (total > 0) processed = Math.min(processed, total);
        try {
          db.prepare('UPDATE hash_jobs SET heartbeat_at = ?, processed = ?, total = ? WHERE id = ?').run(Date.now(), processed, total, id);
        } catch (err) {
          console.error(`[HashQueue] Could not write the heartbeat of build ${jobId}:`, err.message);
        }
        for (const w of waiters.get(jobId) || []) {
          if (typeof w.onProgress !== 'function') continue;
          try { w.onProgress(processed, total); } catch (err) { console.error('[HashQueue] onProgress failed:', err.message); }
        }
        const c = db.prepare('SELECT cancel_requested FROM hash_jobs WHERE id = ?').get(id);
        if (c && c.cancel_requested === 1) hashService.cancelJob(jobId);
      } catch (err) {
        console.error(`[HashQueue] Heartbeat of build ${jobId} failed:`, err.message);
      }
    };
    timer = setInterval(tick, HEARTBEAT_MS);
    timer.unref();
  } catch (err) {
    console.error(`[HashQueue] Could not watch build ${jobId}:`, err.message);
  }

  let promise;
  try {
    promise = Promise.resolve(hashService.createHashDB(row.performer_id, null, jobId, row.mode));
  } catch (err) {
    promise = Promise.reject(err);
  }

  promise.then(() => finish(null), (err) => finish(err || new Error('The build failed')));

  function finish(err) {
    try {
      if (timer) clearInterval(timer);
      const j = hashService.getJobStatus(jobId) || {};
      const total = j.total || 0;
      let processed = j.processed || 0;
      if (total > 0) processed = Math.min(processed, total);
      const succeeded = j.succeeded || 0;
      const skipped = j.skipped || 0;
      const counts = [
        total, succeeded, skipped, j.failed || 0,
        JSON.stringify((j.failedFiles || []).slice(0, 20)),
        j.markedDeleted ?? null, j.warning ?? null,
      ];
      const now = Date.now();
      if (!err) {
        try {
          db.prepare(`
            UPDATE hash_jobs SET status = 'done', processed = ?, total = ?, succeeded = ?, skipped = ?, failed_count = ?,
              failed_files = ?, marked_deleted = ?, warning = ?, error = NULL, heartbeat_at = ?, finished_at = ?
            WHERE id = ?
          `).run(total, ...counts, now, now, id);
        } catch (e) {
          console.error(`[HashQueue] Could not save the end of build ${jobId}:`, e.message);
        }
        settleWaiters(jobId, null, { jobId, status: 'done', hashCount: succeeded + skipped });
      } else {
        const cancelled = err.message === 'Cancelled';
        try {
          db.prepare(`
            UPDATE hash_jobs SET status = ?, processed = ?, total = ?, succeeded = ?, skipped = ?, failed_count = ?,
              failed_files = ?, marked_deleted = ?, warning = ?, error = ?, heartbeat_at = ?, finished_at = ?
            WHERE id = ?
          `).run(cancelled ? 'cancelled' : 'failed', processed, ...counts, cancelled ? null : err.message, now, now, id);
        } catch (e) {
          console.error(`[HashQueue] Could not save the end of build ${jobId}:`, e.message);
        }
        settleWaiters(jobId, new Error(cancelled ? 'Cancelled' : err.message));
      }
    } catch (e) {
      console.error(`[HashQueue] Could not end build ${jobId}:`, e.message);
      settleWaiters(jobId, err || null, err ? undefined : { jobId, status: 'done', hashCount: 0 });
    } finally {
      waiters.delete(jobId);
      if (current === id) current = null;
      busy = false;
      setImmediate(kick);
    }
  }
}

// ── queue actions ──────────────────────────────────────────────

/**
 * Queue builds: items [{ performerId, mode? }], mode 'replace' or else 'append'. Folders are not read here.
 * Returns { queued: [{ performerId, jobId, already: false|'queued'|'running' }], skipped: [{ performerId, reason }] }.
 */
function enqueue(items, { origin = 'user', front = false } = {}) {
  ensureStarted();
  const list = Array.isArray(items) ? items : [];
  const org = origin === 'import' ? 'import' : 'user';
  const out = { queued: [], skipped: [] };

  db.transaction(() => {
    const top = front ? maxQueuedPriority() + 1 : 0;
    const seen = new Map(); // performerId -> 'skipped' | 'queued': the same performer twice counts once
    const getPerformer = db.prepare('SELECT * FROM performers WHERE id = ?');
    const getActive = db.prepare(`SELECT * FROM hash_jobs WHERE performer_id = ? AND status IN ${ACTIVE} ORDER BY status = 'running' DESC, id LIMIT 1`);
    const insert = db.prepare(`
      INSERT INTO hash_jobs (performer_id, performer_name, mode, origin, status, priority, queued_at)
      VALUES (?, ?, ?, ?, 'queued', ?, ?)
    `);
    for (const item of list) {
      const raw = item && item.performerId;
      const pid = raw == null || raw === '' ? NaN : Number(raw);
      const mode = item && item.mode === 'replace' ? 'replace' : 'append';
      if (!Number.isInteger(pid)) { out.skipped.push({ performerId: raw ?? null, reason: 'Performer not found' }); continue; }
      const before = seen.get(pid);
      if (before === 'skipped') continue;

      if (!before) {
        const performer = getPerformer.get(pid);
        if (!performer) {
          out.skipped.push({ performerId: pid, reason: 'Performer not found' });
          seen.set(pid, 'skipped');
          continue;
        }
        if (!hashService.performerDirOf(performer)) {
          out.skipped.push({ performerId: pid, reason: 'She has no library folder' });
          seen.set(pid, 'skipped');
          continue;
        }
        const active = getActive.get(pid);
        if (active) {
          out.queued.push({ performerId: pid, jobId: String(active.id), already: active.status });
        } else {
          const r = insert.run(pid, performer.name || null, mode, org, top, Date.now());
          out.queued.push({ performerId: pid, jobId: String(r.lastInsertRowid), already: false });
        }
        seen.set(pid, 'queued');
      }

      // an active row (also one made earlier in this call): 'replace' upgrades a waiting row, front raises it
      const active = getActive.get(pid);
      if (active && active.status === 'queued') {
        if (mode === 'replace' && active.mode !== 'replace') db.prepare("UPDATE hash_jobs SET mode = 'replace' WHERE id = ?").run(active.id);
        if (front && active.priority < top) db.prepare('UPDATE hash_jobs SET priority = ? WHERE id = ?').run(top, active.id);
      }
    }
  }).immediate();

  setImmediate(kick);
  return out;
}

/**
 * Queue one build at the front and wait for it: resolves { jobId, status: 'done', hashCount } and rejects with
 * Error(error or 'Cancelled'). onStart() fires when it runs, onProgress(processed, total) on every heartbeat.
 */
function enqueueAndWait({ performerId, mode = 'append', origin = 'import', onStart, onProgress } = {}) {
  let r;
  try {
    r = enqueue([{ performerId, mode }], { origin, front: true });
  } catch (err) {
    return Promise.reject(err);
  }
  if (r.skipped.length > 0) return Promise.reject(new Error(r.skipped[0].reason));
  const { jobId, already } = r.queued[0];
  return new Promise((resolve, reject) => {
    const w = { resolve, reject, onStart, onProgress, started: false };
    addWaiter(jobId, w);
    if (already === 'running') startWaiter(w);
  });
}

function rowOf(jobId) {
  const n = Number(jobId);
  if (jobId == null || jobId === '' || !Number.isInteger(n)) return null;
  return db.prepare('SELECT * FROM hash_jobs WHERE id = ?').get(n) || null;
}

function rowOr404(jobId) {
  const row = rowOf(jobId);
  if (!row) throw httpError(404, 'That hash build is no longer in the list');
  return row;
}

/** Stop a running build: it ends as cancelled after the files it is reading now. */
function cancel(jobId) {
  const row = rowOr404(jobId);
  if (row.status === 'queued') throw httpError(409, 'Not started yet: Remove takes it out of the queue');
  if (row.status !== 'running') throw httpError(409, 'It has already ended');
  db.prepare('UPDATE hash_jobs SET cancel_requested = 1 WHERE id = ?').run(row.id);
  hashService.cancelJob(String(row.id));
  return get(row.id);
}

/** Delete a row that is not running. A queued row's undo is { performerId, mode }. */
function remove(jobId) {
  const row = rowOr404(jobId);
  if (row.status === 'running') throw httpError(409, 'It is running: Cancel stops it');
  db.prepare('DELETE FROM hash_jobs WHERE id = ?').run(row.id);
  const wasQueued = row.status === 'queued';
  if (wasQueued) settleWaiters(String(row.id), new Error('Removed from the hash queue'));
  return { undo: wasQueued ? { performerId: row.performer_id, mode: row.mode } : null };
}

/** A failed or cancelled build goes back to the end of the queue. */
function retry(jobId) {
  const row = rowOr404(jobId);
  if (row.status !== 'failed' && row.status !== 'cancelled') throw httpError(409, 'Only a failed or cancelled build can run again');
  if (!db.prepare('SELECT id FROM performers WHERE id = ?').get(row.performer_id)) throw httpError(409, 'She is no longer in the app');
  db.transaction(() => {
    const other = db.prepare(`SELECT id FROM hash_jobs WHERE performer_id = ? AND status IN ${ACTIVE} AND id != ? LIMIT 1`).get(row.performer_id, row.id);
    if (other) throw httpError(409, 'She is already queued');
    db.prepare(`
      UPDATE hash_jobs SET status = 'queued', processed = 0, total = 0, succeeded = 0, skipped = 0, failed_count = 0,
        failed_files = NULL, marked_deleted = NULL, warning = NULL, error = NULL, cancel_requested = 0,
        started_at = NULL, heartbeat_at = NULL, finished_at = NULL, priority = 0, queued_at = ?
      WHERE id = ?
    `).run(endOfQueue(), row.id);
  }).immediate();
  setImmediate(kick);
  return get(row.id);
}

/** A waiting build runs next. */
function front(jobId) {
  const row = rowOr404(jobId);
  if (row.status !== 'queued') throw httpError(409, 'Only a waiting build can run next');
  db.transaction(() => {
    db.prepare('UPDATE hash_jobs SET priority = ? WHERE id = ?').run(maxQueuedPriority() + 1, row.id);
  }).immediate();
  return get(row.id);
}

/** Delete done and cancelled rows; failed rows stay until they are retried or removed. */
function clearFinished() {
  return db.prepare("DELETE FROM hash_jobs WHERE status IN ('done', 'cancelled')").run().changes;
}

// ── reading ────────────────────────────────────────────────────

const SELECT_VIEW = `
  SELECT h.*, p.id AS p_id, p.name AS p_name, p.moved_to_after AS p_moved
  FROM hash_jobs h LEFT JOIN performers p ON p.id = h.performer_id
`;

function parseList(json) {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v : [];
  } catch (_) {
    return [];
  }
}

function view(r) {
  const total = r.total || 0;
  const processed = total > 0 ? Math.min(r.processed || 0, total) : r.processed || 0;
  return {
    jobId: String(r.id),
    id: r.id,
    performerId: r.performer_id,
    performerName: r.p_name ?? r.performer_name ?? null,
    location: r.p_id != null ? (r.p_moved === 1 ? 'after' : 'before') : null,
    performerGone: r.p_id == null,
    mode: r.mode,
    origin: r.origin,
    status: r.status,
    processed,
    total,
    succeeded: r.succeeded || 0,
    skipped: r.skipped || 0,
    failed: r.failed_count || 0,
    failedFiles: parseList(r.failed_files),
    markedDeleted: r.marked_deleted ?? null,
    warning: r.warning ?? null,
    error: r.error ?? null,
    queuedAt: r.queued_at,
    startedAt: r.started_at ?? null,
    finishedAt: r.finished_at ?? null,
    cancelRequested: !!r.cancel_requested,
  };
}

/** Queued and running rows, every failed row, and done/cancelled rows of the last 6 hours. */
function list() {
  ensureStarted();
  const rows = db.prepare(`
    ${SELECT_VIEW}
    WHERE h.status IN ('queued', 'running', 'failed')
       OR (h.status IN ('done', 'cancelled') AND h.finished_at >= ?)
    ORDER BY CASE h.status WHEN 'running' THEN 0 WHEN 'queued' THEN 1 ELSE 2 END,
             CASE WHEN h.status = 'queued' THEN h.priority ELSE 0 END DESC,
             CASE WHEN h.status = 'queued' THEN h.queued_at ELSE -COALESCE(h.finished_at, 0) END,
             h.id
  `).all(Date.now() - SHOW_ENDED_MS);
  return rows.map(view);
}

function get(jobId) {
  const n = Number(jobId);
  if (jobId == null || jobId === '' || !Number.isInteger(n)) return null;
  const r = db.prepare(`${SELECT_VIEW} WHERE h.id = ?`).get(n);
  return r ? view(r) : null;
}

/** Her queued or running build, or null. */
function jobFor(performerId) {
  const n = Number(performerId);
  if (!Number.isInteger(n)) return null;
  const r = db.prepare(`${SELECT_VIEW} WHERE h.performer_id = ? AND h.status IN ${ACTIVE} ORDER BY h.status = 'running' DESC, h.id LIMIT 1`).get(n);
  return r ? view(r) : null;
}

module.exports = {
  start, recover, release, kick, enqueue, enqueueAndWait, cancel, remove, retry, front, clearFinished, list, get, jobFor,
  STALE_MS, HEARTBEAT_MS,
};
