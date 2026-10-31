/**
 * Re-encoding for space (Settings → Space) and its queue (services/encodeQueue.js). The workers' side of the queue —
 * claim, download, upload, complete — is in routes/workers.js.
 *
 *   GET    /space                     every performer and genre: videos' size, what a re-encode would save, totals
 *   GET    /space/group?key=          one performer's or genre's folders and files
 *   POST   /space/rescan              walk the library and probe what's new (in the background)
 *   POST   /queue                     { all } | { group[, folder] } | { paths: [] } → { added, skipped: { reason: n } }
 *   GET    /queue                     the queue: running, queued, recent, workers
 *   POST   /queue/start | /queue/pause
 *   PUT    /mode                      { mode: auto | local | remote } — who encodes (409 while a coordinator decides)
 *   DELETE /jobs/:id                  a queued job dropped, a running one stopped
 *   POST   /jobs/:id/pause | resume | retry | undo
 *   POST   /jobs/:id/bump             { dir: up | down }
 *   POST   /jobs/:id/priority         { priority }
 *   POST   /clear                     finished jobs off the list (not those whose original is still held)
 *   GET    /workers                   linked workers and this server
 *   POST   /workers                   { name } → { id, name, link } (the link is shown once)
 *   POST   /workers/:id/relink        a new link (the old one stops working)
 *   PUT    /workers/:id               { enabled }
 *   DELETE /workers/:id
 */
const express = require('express');
const router = express.Router();
const q = require('../services/encodeQueue');
const probe = require('../services/mediaProbe');

const id = (req) => {
  const n = Number(req.params.id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

// every handler: a thrown error with a status is the answer; anything else is a 500
const handle = (fn) => async (req, res) => {
  try {
    const out = await fn(req, res);
    if (!res.headersSent) res.json(out ?? { ok: true });
  } catch (err) {
    if (!err.status) console.error('[encode]', err);
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
};

const linkFor = (req, token) => `${req.protocol}://${req.get('host')}/api/workers/link/${token}`;

router.get('/space', handle(() => q.spaceReport()));
router.get('/space/group', handle((req) => q.groupReport(req.query.key)));
router.post('/space/rescan', handle(() => probe.scanInBackground()));

router.post('/queue', handle((req) => {
  const b = req.body || {};
  if (Array.isArray(b.paths)) {
    if (!b.paths.length) throw Object.assign(new Error('No files given'), { status: 400 });
    return q.enqueue(b.paths.map(String));
  }
  if (!b.all && !b.group) throw Object.assign(new Error('Say what to queue: all, a group, or paths'), { status: 400 });
  return q.enqueue(q.pathsFor({ all: !!b.all, group: b.group, folder: b.folder }), { bulk: true });
}));

router.get('/queue', handle(() => q.status()));
router.post('/queue/start', handle(() => q.start()));
router.post('/queue/pause', handle(() => q.pause()));
router.put('/mode', handle((req) => { q.setMode(req.body?.mode); return { ok: true, mode: q.mode() }; }));

router.delete('/jobs/:id', handle((req) => { q.removeJob(id(req)); }));
router.post('/jobs/:id/pause', handle((req) => q.pauseJob(id(req))));
router.post('/jobs/:id/resume', handle((req) => q.resumeJob(id(req))));
router.post('/jobs/:id/retry', handle((req) => { q.retryJob(id(req)); }));
router.post('/jobs/:id/undo', handle((req) => { q.undoJob(id(req)); }));
router.post('/jobs/:id/bump', handle((req) => { q.bumpJob(id(req), req.body?.dir); }));
router.post('/jobs/:id/priority', handle((req) => { q.setPriority(id(req), Number(req.body?.priority)); }));
router.post('/clear', handle(() => ({ ok: true, cleared: q.clearFinished() })));

router.get('/workers', handle(() => q.listWorkers()));
router.post('/workers', handle((req) => {
  const w = q.addWorker(req.body?.name);
  return { id: w.id, name: w.name, link: linkFor(req, w.token) };
}));
router.post('/workers/:id/relink', handle((req) => ({ link: linkFor(req, q.relinkWorker(id(req)).token) })));
router.put('/workers/:id', handle((req) => { q.setWorkerEnabled(id(req), !!req.body?.enabled); }));
router.delete('/workers/:id', handle((req) => { q.removeWorker(id(req)); }));

module.exports = router;
