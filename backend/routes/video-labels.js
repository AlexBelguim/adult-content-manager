/**
 * Video labels — labelmaster's scenes of a video, sent by scenetest on the GPU PC after it labels one.
 *
 * - GET /api/video-labels?path=   — { seconds, model, scenes, exposure } of one video ({ scenes: [] } when unlabelled)
 * - GET /api/video-labels/counts  — labelled videos per performer, for Performer Management's "unlabelled" count
 * - PUT /api/video-labels         — { path, seconds, model, scenes, exposure }: store them (a re-label replaces
 *                                   them) and give the video the tags its scenes meet (services/tagRules)
 *
 * scenes: [{ start, end, group, detail, position, cast, exposure }]; exposure: [[start, end, state], ...], the
 * dress-state lane. Paths are the app's (/media/...); scenetest maps its share paths before sending.
 */
const express = require('express');
const router = express.Router();
const db = require('../db');
const videoLabels = require('../services/videoLabels');

router.get('/', (req, res) => {
  const row = db.prepare('SELECT seconds, model, scenes, exposure FROM video_labels WHERE file_path = ?').get(req.query.path);
  if (!row) return res.json({ scenes: [], exposure: [] });
  res.json({ seconds: row.seconds, model: row.model, scenes: JSON.parse(row.scenes), exposure: JSON.parse(row.exposure) });
});

// How many of each performer's videos are labelled: { counts: { "after/<name>": n, "before/<name>": n } }
router.get('/counts', (req, res) => {
  const counts = {};
  for (const { file_path: p } of db.prepare('SELECT file_path FROM video_labels').all()) {
    const m = /[\\/](before|after) filter performer[\\/]([^\\/]+)[\\/]/.exec(p);
    if (m) counts[`${m[1]}/${m[2]}`] = (counts[`${m[1]}/${m[2]}`] || 0) + 1;
  }
  res.json({ counts });
});

router.put('/', (req, res) => {
  try {
    res.json({ success: true, ...videoLabels.store(req.body || {}) });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
