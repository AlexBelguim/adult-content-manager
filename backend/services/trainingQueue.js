/**
 * The training queue, kept in the app (training_jobs, migration 017).
 *
 * The Taste Dashboard's Start puts a run here (with everything the AI app trains with, collected now). The AI app on
 * the GPU PC is a worker (routes/workers.js, the funpipe worker's token): it claims the next run, trains it in a process
 * of its own, sends its state every few seconds and the result at the end. One run at a time: the AI app claims the
 * next only when the last has ended. Cancel stops a waiting run at once and a running one on its next report.
 *
 * A running run whose worker hasn't reported for STALE_MS failed (training can't pick up where it stopped): Retry puts
 * it back in the queue.
 */
const db = require('../db');

const STALE_MS = 10 * 60 * 1000;
const ACTIVE = "('queued','running')";

const TITLE = {
  binary: 'Keep / delete classifier', ranked_binary: 'Ranked keep / delete classifier',
  pairwise: 'Pairwise ranker', clip_siamese: 'CLIP siamese picture ranker', clip_taste: 'CLIP taste keep / delete model',
  clip_keepdelete: 'K keep / delete model', performer_ranker: 'Performer ranker',
};
const titleOf = (type) => TITLE[type] || `Training ${type}`;
const parse = (s) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };

/** a run at the end of the queue: { id, position } */
function enqueue(payload) {
  const pos = db.prepare(`SELECT COALESCE(MAX(position), 0) AS p FROM training_jobs WHERE status IN ${ACTIVE}`).get().p + 1;
  const label = `${titleOf(payload.type)} · ${payload.epochs || '?'} epochs`;
  const r = db.prepare('INSERT INTO training_jobs (type, label, payload, status, position, created_at) VALUES (?, ?, ?, \'queued\', ?, ?)')
    .run(payload.type, label, JSON.stringify(payload), pos, Date.now());
  const ahead = db.prepare(`SELECT COUNT(*) AS n FROM training_jobs WHERE status IN ${ACTIVE} AND id != ?`).get(Number(r.lastInsertRowid)).n;
  return { id: Number(r.lastInsertRowid), label, ahead };
}

function failStale() {
  db.prepare("UPDATE training_jobs SET status = 'failed', error = 'The AI app stopped reporting (restarted or switched off): Retry runs it again', finished_at = ?, phase = NULL WHERE status = 'running' AND heartbeat_at < ?")
    .run(Date.now(), Date.now() - STALE_MS);
}

function view(r) {
  return {
    id: r.id, type: r.type, title: titleOf(r.type), label: r.label, status: r.status, priority: r.priority, worker: r.worker,
    phase: r.phase, progress: r.progress, message: r.message, state: parse(r.state), result: parse(r.result), error: r.error,
    cancelling: !!r.cancel, createdAt: r.created_at, startedAt: r.started_at, heartbeatAt: r.heartbeat_at, finishedAt: r.finished_at,
    epochs: parse(r.payload)?.epochs ?? null,
  };
}

/** the queue: running and waiting first (in the order they run), then the last 20 that ended */
function list() {
  failStale();
  const active = db.prepare(`SELECT * FROM training_jobs WHERE status IN ${ACTIVE} ORDER BY status = 'running' DESC, priority DESC, position, id`).all();
  const recent = db.prepare(`SELECT * FROM training_jobs WHERE status NOT IN ${ACTIVE} ORDER BY finished_at DESC LIMIT 20`).all();
  return { jobs: [...active, ...recent].map(view) };
}

const err = (status, message) => Object.assign(new Error(message), { status });

/** Cancel: a waiting run leaves the queue; a running one is stopped on its worker's next report */
function cancel(id) {
  const r = db.prepare('SELECT * FROM training_jobs WHERE id = ?').get(id);
  if (!r) throw err(404, 'No such training run');
  if (r.status === 'queued') {
    db.prepare("UPDATE training_jobs SET status = 'cancelled', finished_at = ? WHERE id = ?").run(Date.now(), id);
  } else if (r.status === 'running') {
    db.prepare('UPDATE training_jobs SET cancel = 1 WHERE id = ?').run(id);
  } else {
    throw err(409, 'That run has already ended');
  }
  return view(db.prepare('SELECT * FROM training_jobs WHERE id = ?').get(id));
}

/** an ended run off the list */
function remove(id) {
  const r = db.prepare(`DELETE FROM training_jobs WHERE id = ? AND status NOT IN ${ACTIVE}`).run(id);
  if (!r.changes) throw err(409, 'Only a run that has ended can be removed (cancel a waiting or running one)');
  return true;
}

function retry(id) {
  const pos = db.prepare(`SELECT COALESCE(MAX(position), 0) AS p FROM training_jobs WHERE status IN ${ACTIVE}`).get().p + 1;
  const r = db.prepare(`UPDATE training_jobs SET status = 'queued', position = ?, worker = NULL, phase = NULL, progress = NULL, message = NULL,
    state = NULL, result = NULL, error = NULL, cancel = 0, started_at = NULL, heartbeat_at = NULL, finished_at = NULL
    WHERE id = ? AND status IN ('failed','cancelled')`).run(pos, id);
  if (!r.changes) throw err(409, 'Only a failed or cancelled run can be run again');
  return true;
}

/** Bump: 'up' before every waiting run, 'down' after them all */
function bump(id, dir) {
  if (dir !== 'up' && dir !== 'down') throw err(400, 'dir must be up or down');
  const { lo, hi } = db.prepare("SELECT MIN(priority) AS lo, MAX(priority) AS hi FROM training_jobs WHERE status = 'queued'").get();
  const r = db.prepare("UPDATE training_jobs SET priority = ? WHERE id = ? AND status = 'queued'").run(dir === 'up' ? (hi ?? 0) + 1 : (lo ?? 0) - 1, id);
  if (!r.changes) throw err(409, 'Only a waiting run can be moved');
  return true;
}

// ── the worker's side (routes/workers.js) ──────────────────────

/** the next waiting run for the AI app: { id, label, payload }, or null — never a second while one of its runs is running */
function claim(name) {
  failStale();
  return db.transaction(() => {
    if (db.prepare("SELECT 1 FROM training_jobs WHERE status = 'running' AND worker = ?").get(name)) return null;
    const r = db.prepare("SELECT * FROM training_jobs WHERE status = 'queued' ORDER BY priority DESC, position, id LIMIT 1").get();
    if (!r) return null;
    const now = Date.now();
    db.prepare("UPDATE training_jobs SET status = 'running', worker = ?, started_at = ?, heartbeat_at = ?, phase = 'claimed', progress = 0 WHERE id = ?")
      .run(name, now, now, r.id);
    return { id: r.id, label: r.label, payload: parse(r.payload) };
  })();
}

const own = (name, id) => db.prepare("SELECT * FROM training_jobs WHERE id = ? AND worker = ? AND status = 'running'").get(id, name);

/** the run's training_status now -> { action: continue | cancel } */
function progress(name, id, state = {}) {
  const r = own(name, id);
  if (!r) return { action: 'cancel' };
  const total = state.total_epochs || 0;
  const within = state.total_batches ? (state.batch || 0) / state.total_batches : 0;
  const p = total ? Math.min(0.999, (Math.max(0, (state.epoch || 1) - 1) + within) / total) : null;
  const slim = { ...state };
  delete slim.log;
  db.prepare('UPDATE training_jobs SET phase = ?, progress = ?, message = ?, state = ?, heartbeat_at = ? WHERE id = ?')
    .run(state.phase || r.phase, p, state.message ? String(state.message).slice(0, 300) : r.message, JSON.stringify(slim).slice(0, 20000), Date.now(), id);
  return { action: r.cancel ? 'cancel' : 'continue' };
}

function finish(name, id, { ok, result, error }) {
  const r = own(name, id);
  if (!r) return false;
  const status = ok ? 'done' : r.cancel || error === 'cancelled' ? 'cancelled' : 'failed';
  db.prepare('UPDATE training_jobs SET status = ?, result = ?, error = ?, phase = NULL, progress = ?, cancel = 0, finished_at = ? WHERE id = ?')
    .run(status, result ? JSON.stringify(result) : null, status === 'failed' ? String(error || 'failed').slice(0, 1000) : null, ok ? 1 : r.progress, Date.now(), id);
  return true;
}

module.exports = { enqueue, list, cancel, remove, retry, bump, claim, progress, finish, titleOf };
