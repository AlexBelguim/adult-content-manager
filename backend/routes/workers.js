/**
 * The workers' side: the AI app on the GPU PC (or any machine) works for this app over HTTP alone, so it never needs
 * the NAS share mapped. Modelled on Hikari's worker protocol (link, heartbeat, claim, progress, complete / fail).
 * Every call but /link carries the worker token as a bearer (Authorization: Bearer <token>, plus X-Worker: <name>).
 * The app hands its address and the token to the AI app by itself (funpipeService.pair).
 *
 *   GET  /link                         { url, token } for a worker set up by hand (open like the rest of the app, which has no
 *                                      login: the token keeps out what is not a worker, not who can reach the app)
 *   POST /heartbeat                    { info } -> { paused }
 *   POST /funpipe/claim                { info } -> the next funpipe job { id, video, name, pose, stages, size, sidecars }, or 204
 *   POST /funpipe/jobs/:id/progress    { stage, phase, progress, windows_done, total_windows, gpu_warning, log } -> { action }
 *   POST /funpipe/jobs/:id/complete
 *   POST /funpipe/jobs/:id/fail        { error }
 *   GET  /media?path=                  a library file (Range requests: a broken download picks up where it stopped)
 *   GET  /sidecar?video=&ext=          one of funpipe's files next to a library video (404 when there is none)
 *   GET  /beside?video=&name=          a .funscript file beside it by name, read only (the editor's human ground truth)
 *   PUT  /sidecar?video=&ext=          write one (the body is the file, sent as application/octet-stream so the app's JSON
 *                                      parser leaves it alone): the job's results, and the review editor's saves
 */
const express = require('express');
const router = express.Router();
const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');
const q = require('../services/funpipeQueue');

const same = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

router.get('/link', (req, res) => {
  res.json({ url: `${req.protocol}://${req.get('host')}`, token: q.workerToken() });
});

router.use((req, res, next) => {
  const m = /^Bearer\s+(\S+)$/i.exec(req.get('authorization') || '');
  if (!m || !same(m[1], q.workerToken())) return res.status(401).json({ error: 'Unknown worker: the app has another token now' });
  req.worker = String(req.get('x-worker') || 'worker').slice(0, 60);
  next();
});

const jobId = (req) => {
  const n = Number(req.params.id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

router.post('/heartbeat', (req, res) => {
  q.heartbeat(req.worker, req.body?.info || null);
  res.json({ paused: q.list().paused });
});

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
