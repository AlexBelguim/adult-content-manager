/**
 * /api/hashes: hash databases, duplicate checks and the duplicates page (/hash-results/:runId).
 * Errors are { error, code?, ...extra } with a non-2xx status; every 2xx body has success: true
 * (GET /performers answers a bare array).
 *
 * Builds go through the server's hash queue (services/hashQueue.js, one at a time):
 *   POST /queue { items: [{ performerId, mode? }] }   queue 1 to 1000 builds; answers { queued, skipped }
 *   POST /create { performer_id, mode }               queue one build after checking her folder
 *   GET  /status/:jobId                               one build (status queued|running|completed|failed)
 *   POST /job/:jobId/cancel|remove|retry|front        stop, take out, run again, run next
 */
const express = require('express');
const fsp = require('fs').promises;
const db = require('../db');
const hashService = require('../services/hashService');
const hashQueue = require('../services/hashQueue');
const hashReview = require('../services/hashReview');
const hashRemovals = require('../services/hashRemovals');

const router = express.Router();
const { HashError } = hashService;

function fail(res, err, what) {
  if (!err.status || err.status >= 500) console.error(`${what}:`, err);
  res.status(err.status || 500).send({ error: err.message, code: err.code, ...(err.extra || {}) });
}

function idParam(value) {
  const n = Number(value);
  if (!Number.isInteger(n)) throw new HashError(400, 'bad_request', 'The id must be a whole number');
  return n;
}

function performerOr404(id) {
  const p = db.prepare('SELECT * FROM performers WHERE id = ?').get(id);
  if (!p) throw new HashError(404, 'performer_not_found', 'Performer not found');
  return p;
}

// ── performers and builds ──────────────────────────────────────

/** GET /performers: every performer with her hash database state. */
router.get('/performers', (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT p.id, p.name, p.moved_to_after, p.hash_verified, h.file_count, h.last_seen
      FROM performers p
      LEFT JOIN (
        SELECT performer_id,
               SUM(CASE WHEN deleted_flag = 0 THEN 1 ELSE 0 END) AS file_count,
               MAX(seen_at) AS last_seen
        FROM performer_file_hashes WHERE performer_id IS NOT NULL GROUP BY performer_id
      ) h ON h.performer_id = p.id
      ORDER BY p.name COLLATE NOCASE
    `).all();
    res.send(rows.map((r) => ({
      id: r.id,
      name: r.name,
      location: r.moved_to_after === 1 ? 'after' : 'before',
      has_hash_db: (r.file_count || 0) > 0,
      file_count: r.file_count || 0,
      last_updated: r.last_seen ? new Date(r.last_seen * 1000).toISOString() : null,
      hash_verified: r.hash_verified || 0,
    })));
  } catch (err) {
    fail(res, err, 'Error listing performers with hash state');
  }
});

/** POST /queue { items: [{ performerId, mode? }] }: queue builds; a performer already queued or running gets no new row. */
router.post('/queue', (req, res) => {
  try {
    const items = req.body && req.body.items;
    if (!Array.isArray(items) || items.length === 0 || items.length > 1000) {
      throw new HashError(400, 'bad_request', 'items must be a list of 1 to 1000 performers');
    }
    const r = hashQueue.enqueue(items.map((i) => ({ performerId: Number(i && i.performerId), mode: i && i.mode })), { origin: 'user' });
    res.send({ success: true, ...r });
  } catch (err) {
    fail(res, err, 'Error queueing hash builds');
  }
});

/** POST /create { performer_id, mode }: queue building her hash database (the folder comes from her record). */
router.post('/create', async (req, res) => {
  try {
    const body = req.body || {};
    if (body.performer_id == null || body.performer_id === '') throw new HashError(400, 'bad_request', 'performer_id is required');
    const id = idParam(body.performer_id);
    const mode = body.mode == null ? 'append' : body.mode;
    if (mode !== 'append' && mode !== 'replace') throw new HashError(400, 'bad_request', "mode must be 'append' or 'replace'");
    const performer = performerOr404(id);

    const dir = hashService.performerDirOf(performer);
    let readable = false;
    if (dir) {
      try {
        const st = await fsp.stat(dir);
        if (st.isDirectory()) { await fsp.readdir(dir); readable = true; }
      } catch (_) { readable = false; }
    }
    if (!readable) {
      throw new HashError(409, 'folder_missing', `Her folder was not found: ${dir || 'no library folder is set'}`);
    }

    const r = hashQueue.enqueue([{ performerId: id, mode }]);
    if (r.skipped.length > 0) throw new HashError(409, 'not_queued', r.skipped[0].reason);
    const q = r.queued[0];
    res.send({
      success: true, jobId: q.jobId, queued: true,
      alreadyRunning: q.already === 'running', alreadyQueued: q.already === 'queued',
    });
  } catch (err) {
    fail(res, err, 'Error queueing a hash build');
  }
});

const OLD_STATUS = { done: 'completed', cancelled: 'failed' };

/** GET /status/:jobId: the old shape; done reads 'completed', cancelled reads 'failed' with error 'Cancelled'. */
router.get('/status/:jobId', (req, res) => {
  try {
    const job = hashQueue.get(req.params.jobId);
    if (!job) throw new HashError(404, 'job_not_found', 'Job not found');
    const cancelled = job.status === 'cancelled';
    const error = cancelled ? 'Cancelled' : job.error;
    res.send({ success: true, status: { ...job, status: OLD_STATUS[job.status] || job.status, error }, error });
  } catch (err) {
    fail(res, err, 'Error reading a hash job');
  }
});

/** POST /job/:jobId/cancel: a running build stops after the files it is reading now and ends as cancelled. */
router.post('/job/:jobId/cancel', (req, res) => {
  try {
    res.send({ success: true, status: hashQueue.cancel(req.params.jobId) });
  } catch (err) {
    fail(res, err, 'Error cancelling a hash job');
  }
});

/** POST /job/:jobId/remove: a row that is not running; a queued one answers its undo { performerId, mode }. */
router.post('/job/:jobId/remove', (req, res) => {
  try {
    res.send({ success: true, ...hashQueue.remove(req.params.jobId) });
  } catch (err) {
    fail(res, err, 'Error removing a hash job');
  }
});

/** POST /job/:jobId/retry: a failed or cancelled build goes to the end of the queue. */
router.post('/job/:jobId/retry', (req, res) => {
  try {
    res.send({ success: true, status: hashQueue.retry(req.params.jobId) });
  } catch (err) {
    fail(res, err, 'Error retrying a hash job');
  }
});

/** POST /job/:jobId/front: a waiting build runs next. */
router.post('/job/:jobId/front', (req, res) => {
  try {
    res.send({ success: true, status: hashQueue.front(req.params.jobId) });
  } catch (err) {
    fail(res, err, 'Error moving a hash job');
  }
});

/**
 * DELETE /performer/:id: her runs and her live hash rows go; history (deleted before, removed as a duplicate)
 * stays so re-downloads are still recognised.
 */
router.delete('/performer/:id', (req, res) => {
  try {
    const id = idParam(req.params.id);
    performerOr404(id);
    if (hashService.runningJobFor(id)) {
      throw new HashError(409, 'job_running', 'Her hash database is being built. Cancel that job first.');
    }
    const result = db.transaction(() => {
      const runs = db.prepare('SELECT run_id FROM hash_runs WHERE source_performer_id = ? OR target_performer_id = ?').all(id, id);
      const delItems = db.prepare('DELETE FROM hash_run_items WHERE run_id = ?');
      const delRun = db.prepare('DELETE FROM hash_runs WHERE run_id = ?');
      for (const r of runs) { delItems.run(r.run_id); delRun.run(r.run_id); }
      // items of any other run that still point at her live rows
      db.prepare(`
        DELETE FROM hash_run_items
        WHERE file_id_ref IN (SELECT id FROM performer_file_hashes WHERE performer_id = ? AND deleted_flag = 0)
           OR candidate_id IN (SELECT id FROM performer_file_hashes WHERE performer_id = ? AND deleted_flag = 0)
      `).run(id, id);
      const deleted = db.prepare('DELETE FROM performer_file_hashes WHERE performer_id = ? AND deleted_flag = 0').run(id).changes;
      const kept = db.prepare('SELECT COUNT(*) AS n FROM performer_file_hashes WHERE performer_id = ? AND deleted_flag IN (1, 2)').get(id);
      db.prepare('UPDATE performers SET latest_internal_run_id = NULL, internal_duplicate_count = 0, hash_verified = 0 WHERE id = ?').run(id);
      return { deleted, keptHistory: kept ? kept.n : 0, runsDeleted: runs.length };
    })();
    hashService.notify({ performerId: id, type: 'hash_updated' });
    res.send({ success: true, ...result });
  } catch (err) {
    fail(res, err, 'Error deleting a hash database');
  }
});

/** POST /performer/:id/internal-check: her own files against each other. */
router.post('/performer/:id/internal-check', async (req, res) => {
  try {
    const id = idParam(req.params.id);
    performerOr404(id);
    const r = await hashService.checkInternalDuplicates(id);
    res.send({
      success: true, runId: r.runId, groupCount: r.groupCount, itemCount: r.itemCount,
      exact: r.exact, similar: r.similar, duplicateCount: r.duplicateCount,
    });
  } catch (err) {
    fail(res, err, 'Error running an internal check');
  }
});

/** POST /performer/:id/verify { verified } */
router.post('/performer/:id/verify', (req, res) => {
  try {
    const id = idParam(req.params.id);
    performerOr404(id);
    const verified = !!(req.body && req.body.verified);
    hashService.setHashVerified(id, verified);
    hashService.notify({ performerId: id, type: 'hash_updated' });
    res.send({ success: true, verified });
  } catch (err) {
    fail(res, err, 'Error setting verified');
  }
});

/** GET /performer/:id/status */
router.get('/performer/:id/status', (req, res) => {
  try {
    const id = idParam(req.params.id);
    performerOr404(id);
    const job = hashQueue.jobFor(id);
    res.send({
      success: true,
      ...hashService.getPerformerHashStatus(id),
      job: job ? { jobId: job.jobId, status: job.status, processed: job.processed, total: job.total } : null,
    });
  } catch (err) {
    fail(res, err, 'Error reading hash status');
  }
});

/** POST /check { source_performer_id, target_performer_id }: the same id twice is an internal check. */
router.post('/check', async (req, res) => {
  try {
    const body = req.body || {};
    if (body.source_performer_id == null || body.target_performer_id == null) {
      throw new HashError(400, 'bad_request', 'source_performer_id and target_performer_id are required');
    }
    const sourceId = idParam(body.source_performer_id);
    const targetId = idParam(body.target_performer_id);
    performerOr404(sourceId);
    performerOr404(targetId);
    const r = sourceId === targetId
      ? await hashService.checkInternalDuplicates(sourceId)
      : await hashService.checkDuplicates(sourceId, targetId);
    const out = { success: true, runId: r.runId, groupCount: r.groupCount, itemCount: r.itemCount, exact: r.exact, similar: r.similar };
    if (r.duplicateCount != null) out.duplicateCount = r.duplicateCount;
    res.send(out);
  } catch (err) {
    fail(res, err, 'Error checking duplicates');
  }
});

// ── runs ───────────────────────────────────────────────────────

/** GET /run/:runId?section&page&pageSize&kind&media&size&maxDistance */
router.get('/run/:runId', async (req, res) => {
  try {
    res.send(await hashReview.getRunView(req.params.runId, req.query));
  } catch (err) {
    fail(res, err, 'Error reading a check');
  }
});

/** POST /run/:runId/selection { itemIds, selected } | { all: true, selected: false } | { restore: [{ itemId, selectedBy }] } (Undo of a clear) */
router.post('/run/:runId/selection', (req, res) => {
  try {
    res.send(hashReview.setSelection(req.params.runId, req.body || {}));
  } catch (err) {
    fail(res, err, 'Error saving a selection');
  }
});

/** GET /run/:runId/selection: the effective selection, for the remove dialog. */
router.get('/run/:runId/selection', (req, res) => {
  try {
    res.send(hashReview.getSelectionList(req.params.runId));
  } catch (err) {
    fail(res, err, 'Error reading a selection');
  }
});

/** POST /run/:runId/keeper { groupKey, fileId } */
router.post('/run/:runId/keeper', async (req, res) => {
  try {
    const body = req.body || {};
    res.send(await hashReview.setKeeper(req.params.runId, body.groupKey, body.fileId));
  } catch (err) {
    fail(res, err, 'Error changing a keeper');
  }
});

/** POST /run/:runId/dismiss { groupKey }: drop the match from the check; no file is touched. */
router.post('/run/:runId/dismiss', (req, res) => {
  try {
    const body = req.body || {};
    res.send(hashReview.dismissGroup(req.params.runId, body.groupKey));
  } catch (err) {
    fail(res, err, 'Error dismissing a match');
  }
});

/**
 * POST /run/:runId/remove { itemIds }: move the ticked files to her trash folder, each checked again first. They are
 * marked so the trash cleanup deletes them and never saves them for training. Answers a batchId for Undo.
 */
router.post('/run/:runId/remove', async (req, res) => {
  try {
    const body = req.body || {};
    if (!Array.isArray(body.itemIds) || body.itemIds.length === 0) throw new HashError(400, 'empty', 'Nothing to remove.');
    res.send(await hashReview.removeItems(req.params.runId, body.itemIds));
  } catch (err) {
    fail(res, err, 'Error removing duplicates');
  }
});

/** POST /run/:runId/undo { batchId }: the toast's Undo; the files come back from her trash while they are there. */
router.post('/run/:runId/undo', async (req, res) => {
  try {
    const body = req.body || {};
    res.send(await hashReview.undoRemove(req.params.runId, body.batchId));
  } catch (err) {
    fail(res, err, 'Error undoing a removal');
  }
});

/** DELETE /run/:runId: the run and its items; files already removed are not affected. */
router.delete('/run/:runId', (req, res) => {
  try {
    const runId = String(req.params.runId);
    const changes = db.transaction(() => {
      db.prepare('DELETE FROM hash_run_items WHERE run_id = ?').run(runId);
      return db.prepare('DELETE FROM hash_runs WHERE run_id = ?').run(runId).changes;
    })();
    if (changes === 0) throw new HashError(404, 'run_not_found', 'Run not found');
    db.prepare('UPDATE performers SET latest_internal_run_id = NULL, internal_duplicate_count = 0 WHERE latest_internal_run_id = ?').run(runId);
    res.send({ success: true, message: 'Run deleted' });
  } catch (err) {
    fail(res, err, 'Error deleting a run');
  }
});

// ── the old Recently removed store ─────────────────────────────

/** GET /old-removed: files of the old 30-day store that could not go to a trash folder (her folder is gone). */
router.get('/old-removed', (req, res) => {
  try {
    res.send({ success: true, ...hashRemovals.listOldRemovals() });
  } catch (err) {
    fail(res, err, 'Error listing the old removed files');
  }
});

module.exports = router;
