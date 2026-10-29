/**
 * The workers' side: the AI app on the GPU PC (or any machine) works for this app over HTTP alone, so it never needs
 * the NAS share mapped. Modelled on Hikari's worker protocol (link, heartbeat, claim, progress, complete / fail).
 * Every call but /link carries the worker token as a bearer (Authorization: Bearer <token>, plus X-Worker: <name>).
 * The app hands its address and the token to the AI app by itself (funpipeService.pair).
 *
 *   GET  /link                         { url, token } for a worker set up by hand (open like the rest of the app, which has no
 *                                      login: the token keeps out what is not a worker, not who can reach the app)
 *   POST /heartbeat                    { info } -> { paused }; an encode worker's: see below
 *   POST /funpipe/claim                { info } -> the next funpipe job { id, video, name, pose, stages, size, sidecars }, or 204
 *   POST /funpipe/jobs/:id/progress    { stage, phase, progress, windows_done, total_windows, gpu_warning, log } -> { action }
 *   POST /funpipe/jobs/:id/complete
 *   POST /funpipe/jobs/:id/fail        { error }
 *   GET  /media?path=                  a library file (Range requests: a broken download picks up where it stopped)
 *   GET  /sidecar?video=&ext=          one of funpipe's files next to a library video (404 when there is none)
 *   GET  /beside?video=&name=          a .funscript file beside it by name, read only (the editor's human ground truth)
 *   PUT  /sidecar?video=&ext=          write one (the body is the file, sent as application/octet-stream so the app's JSON
 *                                      parser leaves it alone): the job's results, and the review editor's saves
 *
 * The same token claims training runs (the training queue, services/trainingQueue.js):
 *
 *   POST /training/claim               -> the next run { id, label, payload }, or 204 (never a second while one runs)
 *   POST /training/jobs/:id/progress   { state: the run's training_status } -> { action: continue | cancel }
 *   POST /training/jobs/:id/complete   { result }
 *   POST /training/jobs/:id/fail       { error } ('cancelled' when it was stopped)
 *
 * Encode workers (the re-encode queue, services/encodeQueue.js) speak Hikari's worker protocol exactly, so Hikari's
 * worker program (server/worker/hikari-worker.mjs) runs this app's jobs as it is, started with a link from
 * Settings → Space (<this app>/api/workers/link/<token>). Each has a token of its own (encode_workers); the funpipe
 * token above opens none of these, and theirs none of funpipe's.
 *
 *   GET  /link/:token                  is this link good? -> { ok, name, app }
 *   POST /heartbeat                    { info, holding } -> { paused, enabled, cancel: [job ids to drop], actions: { id: pause | resume } }
 *                                      holding: a job id, or a list of them (a control panel holds one per machine at work)
 *   GET  /queue                        what's waiting, in order -> { running, enabled, jobs: [{ id, label, kind, why, size, priority }] }
 *                                      (POST /claim takes { jobId } too: that job, or 204)
 *   POST /claim                        { info } -> the next job { id, label, kind, why, args ({in}/{out}), encoder, priority, size,
 *                                      duration, fps, ext, chunk }, or 204
 *   POST /jobs/:id/progress            { phase, progress, speed } -> { action: continue | pause | resume | cancel, cancel, priority }
 *   GET  /jobs/:id/source              the original (Range requests)
 *   GET  /jobs/:id/result              how much of the new file has arrived -> { received }
 *   PUT  /jobs/:id/result?offset=n     one chunk of it (at most 32 MB)
 *   POST /jobs/:id/complete            { size } — checked and swapped in
 *   POST /jobs/:id/fail                { error }
 */
const express = require('express');
const router = express.Router();
const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');
const q = require('../services/funpipeQueue');
const eq = require('../services/encodeQueue');
const tq = require('../services/trainingQueue');

const same = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

router.get('/link', (req, res) => {
  res.json({ url: `${req.protocol}://${req.get('host')}`, token: q.workerToken() });
});

router.get('/link/:token', (req, res) => {
  const w = eq.workerForToken(req.params.token);
  if (!w) return res.status(401).json({ error: "This link isn't valid any more: make a new one in Settings → Space" });
  res.json({ ok: true, name: w.name, app: 'acm' });
});

// the bearer is an encode worker's token (req.encoder) or the funpipe worker's (req.worker)
router.use((req, res, next) => {
  const m = /^Bearer\s+(\S+)$/i.exec(req.get('authorization') || '');
  const enc = m ? eq.workerForToken(m[1]) : null;
  if (enc) {
    req.encoder = enc;
    return next();
  }
  if (!m || !same(m[1], q.workerToken())) return res.status(401).json({ error: 'Unknown worker: the app has another token now' });
  req.worker = String(req.get('x-worker') || 'worker').slice(0, 60);
  next();
});

// ── encode workers ───────────────────────────────────────────
const encoderOnly = (req, res, next) => (req.encoder ? next() : res.status(401).json({ error: "Not an encode worker's token" }));
const funpipeOnly = (req, res, next) => (req.worker ? next() : res.status(401).json({ error: "Not the funpipe worker's token" }));

const jobId = (req) => {
  const n = Number(req.params.id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

router.post('/heartbeat', (req, res) => {
  const b = req.body || {};
  const holding = Array.isArray(b.holding) ? b.holding.map(Number).filter(n => Number.isInteger(n) && n > 0) : Number(b.holding) || null;
  if (req.encoder) return res.json(eq.workerHeartbeat(req.encoder, { info: b.info || null, holding }));
  q.heartbeat(req.worker, b.info || null);
  res.json({ paused: q.list().paused });
});

router.get('/queue', encoderOnly, (req, res) => res.json(eq.workerQueue(req.encoder)));

router.post('/claim', encoderOnly, async (req, res) => {
  const want = Number(req.body?.jobId);
  const job = await eq.workerClaim(req.encoder, req.body?.info || null, { jobId: Number.isInteger(want) && want > 0 ? want : null });
  if (!job) return res.status(204).end();
  res.json(job);
});

router.post('/jobs/:id/progress', encoderOnly, (req, res) => {
  const b = req.body || {};
  res.json(eq.workerProgress(req.encoder, jobId(req), { phase: b.phase, progress: Number(b.progress), speed: b.speed == null ? null : Number(b.speed) }));
});

router.get('/jobs/:id/source', encoderOnly, (req, res) => {
  const p = eq.workerSource(req.encoder, jobId(req));
  if (!p) return res.status(410).json({ error: "That job isn't yours any more" });
  res.sendFile(p, { acceptRanges: true, dotfiles: 'allow' }, (e) => {
    if (e && !res.headersSent) res.status(500).json({ error: e.message });
  });
});

router.get('/jobs/:id/result', encoderOnly, (req, res) => {
  const n = eq.workerReceived(req.encoder, jobId(req));
  if (n == null) return res.status(410).json({ error: "That job isn't yours any more" });
  res.json({ received: n });
});

router.put('/jobs/:id/result', encoderOnly, async (req, res) => {
  const offset = Number(req.query.offset);
  if (!Number.isInteger(offset) || offset < 0) return res.status(400).json({ error: 'offset is required' });
  const r = await eq.workerUpload(req.encoder, jobId(req), offset, req);
  if (r.status === 200) return res.json({ received: r.received });
  res.status(r.status).json({ error: r.error || (r.status === 409 ? 'Out of step' : r.status === 410 ? "That job isn't yours any more" : 'Upload refused'), received: r.received });
});

router.post('/jobs/:id/complete', encoderOnly, async (req, res) => {
  const r = await eq.workerComplete(req.encoder, jobId(req), { size: Number(req.body?.size) || null });
  res.status(r.status).json(r);
});

router.post('/jobs/:id/fail', encoderOnly, (req, res) => {
  res.json({ ok: eq.workerFail(req.encoder, jobId(req), req.body?.error) });
});

// ── the funpipe worker ───────────────────────────────────────
router.use(['/funpipe', '/media', '/sidecar', '/beside', '/training'], funpipeOnly);

// ── training runs (the same worker) ──────────────────────────
router.post('/training/claim', (req, res) => {
  q.heartbeat(req.worker, req.body?.info || null);
  const job = tq.claim(req.worker);
  if (!job) return res.status(204).end();
  res.json(job);
});
router.post('/training/jobs/:id/progress', (req, res) => res.json(tq.progress(req.worker, jobId(req), req.body?.state || {})));
router.post('/training/jobs/:id/complete', (req, res) => res.json({ ok: tq.finish(req.worker, jobId(req), { ok: true, result: req.body?.result || null }) }));
router.post('/training/jobs/:id/fail', (req, res) => res.json({ ok: tq.finish(req.worker, jobId(req), { ok: false, error: req.body?.error }) }));

router.post('/funpipe/claim', (req, res) => {
  const job = q.claim(req.worker, req.body?.info || null);
  if (!job) return res.status(204).end();
  res.json(job);
});

router.post('/funpipe/jobs/:id/progress', (req, res) => res.json(q.progress(req.worker, jobId(req), req.body || {})));
router.post('/funpipe/jobs/:id/complete', (req, res) => res.json({ ok: q.complete(req.worker, jobId(req)) }));
router.post('/funpipe/jobs/:id/fail', (req, res) => res.json({ ok: q.fail(req.worker, jobId(req), req.body?.error) }));

router.get('/media', (req, res) => {
  const p = q.libraryVideo(req.query.path);
  if (!p) return res.status(404).json({ error: 'not a video in the library' });
  res.sendFile(p, { acceptRanges: true, dotfiles: 'allow' }, (e) => {
    if (e && !res.headersSent) res.status(500).json({ error: e.message });
  });
});

router.get('/sidecar', async (req, res) => {
  const p = q.sidecarFile(req.query.video, req.query.ext);
  if (!p) return res.status(400).json({ error: 'not a funpipe file of a video in the library' });
  if (!await fs.pathExists(p)) return res.status(404).json({ error: 'none yet' });
  res.sendFile(p, { dotfiles: 'allow' });
});

// a .funscript beside a library video, by its plain file name (read only): the review editor compares against a human
// script there (og.funscript, <video>.human.funscript ...)
router.get('/beside', async (req, res) => {
  const v = q.libraryVideo(req.query.video);
  const name = String(req.query.name || '');
  if (!v || !name.toLowerCase().endsWith('.funscript') || name !== path.basename(name) || name.startsWith('.')) {
    return res.status(400).json({ error: 'a .funscript file name beside a video in the library' });
  }
  const p = path.join(path.dirname(v), name);
  if (!await fs.pathExists(p)) return res.status(404).json({ error: 'none' });
  res.sendFile(p, { dotfiles: 'allow' });
});

router.put('/sidecar', async (req, res) => {
  const r = await q.writeSidecar(req.query.video, req.query.ext, req);
  res.status(r.status).json(r.status === 200 ? { ok: true, file: path.basename(r.path), size: r.size } : { error: r.error });
});

module.exports = router;
