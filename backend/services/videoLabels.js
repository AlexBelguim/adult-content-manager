/**
 * A video's labels (labelmaster's scenes and dress-state lane) stored in video_labels, and the tags their scenes meet
 * given to it (services/tagRules). Used by PUT /api/video-labels (scenetest) and by a label job's completion
 * (services/labelQueue, a worker node's acm-gpu).
 */
const db = require('../db');
const tagRules = require('./tagRules');

/** { path, seconds, model, scenes, exposure } -> { tagsAdded }; throws a 400-style error when something is missing */
function store({ path: filePath, seconds, model, scenes, exposure } = {}) {
  if (!filePath || !(seconds > 0) || !Array.isArray(scenes) || !Array.isArray(exposure)) {
    throw Object.assign(new Error('path, seconds, scenes and exposure required'), { status: 400 });
  }
  db.prepare(`
    INSERT INTO video_labels (file_path, seconds, model, scenes, exposure, updated_at)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(file_path) DO UPDATE SET seconds = excluded.seconds, model = excluded.model, scenes = excluded.scenes,
      exposure = excluded.exposure, updated_at = CURRENT_TIMESTAMP
  `).run(filePath, seconds, model || null, JSON.stringify(scenes), JSON.stringify(exposure));
  return { tagsAdded: tagRules.applyToFile(filePath) };
}

const labelled = (filePath) => !!db.prepare('SELECT 1 FROM video_labels WHERE file_path = ?').get(filePath);

module.exports = { store, labelled };
