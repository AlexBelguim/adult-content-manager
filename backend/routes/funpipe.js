/**
 * funpipe routes — funscript auto-generation pipeline integration.
 *
 * funpipe runs on the GPU machine; this backend usually runs on the NAS. We hand
 * it paths (never bytes) and it writes .funscript back next to the video.
 *
 * Endpoints:
 * - GET  /api/funpipe/health        — is funpipe reachable
 * - GET  /api/funpipe/config        — server url + media root as configured
 * - POST /api/funpipe/config        — update those settings
 * - GET  /api/funpipe/queue         — live funpipe queue (proxied)
 * - POST /api/funpipe/queue/add     — queue videos (ACM paths in, translated out)
 * - POST /api/funpipe/queue/start   — start the worker
 * - POST /api/funpipe/queue/stop    — stop after the current job
 * - POST /api/funpipe/queue/remove  — drop a job
 * - POST /api/funpipe/queue/clear-done — clear finished jobs
 * - GET  /api/funpipe/library       — every video in a funscript folder + its script state
 */
const express = require('express');
const router = express.Router();
const fs = require('fs-extra');
const path = require('path');
const db = require('../db');
const funpipeService = require('../services/funpipeService');
const { getAiServerUrl } = require('../utils/aiUrl');

const VIDEO_EXTS = ['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.ts'];

// funpipe sidecar names. Intermediates are <video.ext>.<name>, but the playable
// script is stem-based (<video>.funscript) so players find it.
const sidecar = (videoPath, ext) => videoPath + ext;
const scriptPath = (videoPath) => videoPath.slice(0, -path.extname(videoPath).length) + '.funscript';

// The library walk hits SMB — cache it.
const libraryCache = { data: null, time: 0 };
const LIBRARY_TTL = 60 * 1000;

// ── config ───────────────────────────────────────────────────

// The pipeline lives on the AI server, so there is nothing funpipe-specific to
// configure — it follows ai_server_url, set from the Training Hub.
router.get('/config', (req, res) => {
  res.json({ url: `${String(getAiServerUrl()).replace(/\/+$/, '')}/funpipe`, aiServerUrl: getAiServerUrl() });
});

// ── queue proxies ────────────────────────────────────────────

router.get('/health', async (req, res) => {
  res.json(await funpipeService.health(req.query.url));
});

router.get('/queue', async (req, res) => {
  res.json(await funpipeService.getQueue(req.query.url));
});

router.post('/queue/add', async (req, res) => {
  const { videos, pose = true, autoStart = true, url } = req.body;
  if (!Array.isArray(videos) || videos.length === 0) {
    return res.status(400).json({ error: 'videos array is required' });
  }
  const result = await funpipeService.enqueue(videos, { pose, autoStart, urlOverride: url });
  libraryCache.time = 0;
  res.json(result);
});

router.post('/queue/start', async (req, res) => res.json(await funpipeService.start(req.body?.url)));
router.post('/queue/stop', async (req, res) => res.json(await funpipeService.stop(req.body?.url)));
router.post('/queue/clear-done', async (req, res) => res.json(await funpipeService.clearDone(req.body?.url)));

router.post('/queue/remove', async (req, res) => {
  const { id, url } = req.body;
  if (id === undefined) return res.status(400).json({ error: 'id is required' });
  res.json(await funpipeService.remove(id, url));
});

// ── review editor ────────────────────────────────────────────

router.get('/ui/status', async (req, res) => res.json(await funpipeService.uiStatus(req.query.url)));
router.post('/ui/stop', async (req, res) => res.json(await funpipeService.uiStop(req.body?.url)));

// Launch the editor over the media library so every funscript folder is
// reachable. Scanning is rglob over the share, so a narrower root is faster —
// callers may pass one (e.g. a single performer's funscript folder).
router.post('/ui/start', async (req, res) => {
  const { root, url } = req.body || {};
  let target = root;
  if (!target) {
    const folder = db.prepare('SELECT path FROM folders ORDER BY id LIMIT 1').get();
    if (!folder) return res.status(400).json({ error: 'No base folder configured' });
    target = folder.path;
  }
  res.json(await funpipeService.uiStart(target, url));
});

// ── library inventory ────────────────────────────────────────

/** Resolve a performer's on-disk root, matching filterService's convention. */
function performerRoot(performer, folderPath) {
  return performer.moved_to_after === 1
    ? path.join(folderPath, 'after filter performer', performer.name)
    : path.join(folderPath, 'before filter performer', performer.name);
}

/** funscript folders are `vids/funscript` or `vids/Funscript` depending on vintage. */
async function findFunscriptDir(performerPath) {
  for (const name of ['funscript', 'Funscript']) {
    const p = path.join(performerPath, 'vids', name);
    if (await fs.pathExists(p)) return p;
  }
  return null;
}

/**
 * Has this .edits.json got real human work in it? funpipe autosaves the file as
 * soon as the review UI is opened, so mere existence isn't proof of review.
 */
async function editsAreMeaningful(editsPath) {
  try {
    const e = await fs.readJson(editsPath);
    return !!(
      (e.cluster_marks && e.cluster_marks.length) ||
      (e.range_marks && e.range_marks.length) ||
      (e.regions && e.regions.length) ||
      (e.segments && e.segments.length) ||
      (e.windows && Object.keys(e.windows).length) ||
      e.offset_ms
    );
  } catch (_) {
    return false;
  }
}

async function inspectVideoFolder(performerName, folderName, dirPath) {
  const contents = await fs.readdir(dirPath);
  const videoFile = contents.find(f => VIDEO_EXTS.includes(path.extname(f).toLowerCase()) && !f.includes('.proxy.'));
  if (!videoFile) return null;

  const videoPath = path.join(dirPath, videoFile);
  const funscripts = contents.filter(f => f.toLowerCase().endsWith('.funscript'));

  const has = (ext) => fs.pathExists(sidecar(videoPath, ext));
  const [scenes, tracks, pose, signal, editsExists] = await Promise.all([
    has('.scenes.json'), has('.tracks.npz'), has('.pose.json'),
    has('.signal.json'), has('.edits.json')
  ]);
  const reviewed = editsExists && await editsAreMeaningful(sidecar(videoPath, '.edits.json'));

  let size = 0, modified = 0;
  try {
    const st = await fs.stat(videoPath);
    size = st.size;
    modified = st.mtime.getTime();
  } catch (_) { /* non-critical */ }

  // Provenance: a .signal.json means funpipe produced this. Anything else with a
  // script came from outside (downloaded or hand-scripted).
  let status;
  if (signal) status = reviewed ? 'reviewed' : 'needs_review';
  else if (funscripts.length > 0) status = 'external';
  else if (scenes || tracks) status = 'incomplete';
  else status = 'no_script';

  return {
    performer: performerName,
    folderName,
    name: videoFile,
    stem: path.basename(videoFile, path.extname(videoFile)),
    path: videoPath,
    funscripts,
    size,
    modified,
    sidecars: { scenes, tracks, pose, signal, edits: editsExists },
    fromFunpipe: signal,
    reviewed,
    status
  };
}

router.get('/library', async (req, res) => {
  try {
    const { performerId, refresh } = req.query;
    const now = Date.now();

    let videos;
    if (!performerId && !refresh && libraryCache.data && now - libraryCache.time < LIBRARY_TTL) {
      videos = libraryCache.data;
    } else {
      const folder = db.prepare('SELECT path FROM folders ORDER BY id LIMIT 1').get();
      if (!folder) return res.status(400).json({ error: 'No base folder configured' });

      const performers = performerId
        ? db.prepare('SELECT id, name, moved_to_after FROM performers WHERE id = ?').all(performerId)
        : db.prepare('SELECT id, name, moved_to_after FROM performers ORDER BY name ASC').all();

      videos = [];
      for (const performer of performers) {
        const dir = await findFunscriptDir(performerRoot(performer, folder.path));
        if (!dir) continue;
        let entries;
        try {
          entries = await fs.readdir(dir, { withFileTypes: true });
        } catch (err) {
          console.warn(`[funpipe] cannot read ${dir}: ${err.message}`);
          continue;
        }
        for (const entry of entries) {
          if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
          try {
            const row = await inspectVideoFolder(performer.name, entry.name, path.join(dir, entry.name));
            if (row) videos.push({ ...row, performerId: performer.id });
          } catch (err) {
            console.warn(`[funpipe] skipped ${entry.name}: ${err.message}`);
          }
        }
      }

      if (!performerId) {
        libraryCache.data = videos;
        libraryCache.time = now;
      }
    }

    // Overlay live queue state — in-flight beats whatever is on disk.
    // Jobs are keyed by `src`, the path we originally sent, which the pipeline
    // echoes back untouched; `video` is its own remapped view and won't match.
    const queue = await funpipeService.getQueue();
    const key = (p) => String(p || '').replace(/\\/g, '/').toLowerCase();
    const byPath = new Map();
    for (const job of queue.jobs || []) {
      byPath.set(key(job.src || job.video), job);
      if (job.src) byPath.set(key(job.video), job); // tolerate either side
    }

    const rows = videos.map(v => {
      const job = byPath.get(key(v.path));
      if (!job) return v;
      const jobStatus = job.status === 'done' ? v.status
        : job.status === 'failed' ? 'failed'
        : job.status; // 'queued' | 'running'
      return { ...v, status: jobStatus, job: { id: job.id, stage: job.stage, progress: job.progress, status: job.status } };
    });

    const counts = rows.reduce((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc; }, {});

    res.json({
      total: rows.length,
      counts,
      funpipeOnline: queue.ok !== false,
      cached: videos === libraryCache.data && now - libraryCache.time > 0 && !refresh,
      videos: rows
    });
  } catch (err) {
    console.error('[funpipe] library error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
// Exposed for tests — status derivation is the tricky part of this file.
module.exports._internal = { inspectVideoFolder, editsAreMeaningful };
