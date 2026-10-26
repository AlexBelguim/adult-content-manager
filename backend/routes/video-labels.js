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
const tagRules = require('../services/tagRules');

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
  const { path: filePath, seconds, model, scenes, exposure } = req.body;
  if (!filePath || !(seconds > 0) || !Array.isArray(scenes) || !Array.isArray(exposure)) {
    return res.status(400).json({ error: 'path, seconds, scenes and exposure required' });
  }
  db.prepare(`
    INSERT INTO video_labels (file_path, seconds, model, scenes, exposure, updated_at)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(file_path) DO UPDATE SET seconds = excluded.seconds, model = excluded.model, scenes = excluded.scenes,
      exposure = excluded.exposure, updated_at = CURRENT_TIMESTAMP
  `).run(filePath, seconds, model || null, JSON.stringify(scenes), JSON.stringify(exposure));
  res.json({ success: true, tagsAdded: tagRules.applyToFile(filePath) });
});

module.exports = router;
