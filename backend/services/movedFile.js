/**
 * A file that moved on disk: every row that knows it by its path follows it, so its tags, ratings, filter decision,
 * labels (labelmaster's scenes), hash entry, probe and waiting GPU jobs stay with it. Used by "Move to funscript folder"
 * (routes/scenes.js). video_scenes and exported_files are repointed by that route itself.
 *
 * repoint(oldPath, newPath) -> { [table]: rows changed }. A row the new path already has stays and the old one is
 * dropped (UPDATE OR IGNORE, then DELETE), so a unique path never blocks the move.
 */
const db = require('../db');

const COLUMNS = [
  ['file_tags', 'file_path'],
  ['file_ratings', 'file_path'],
  ['filter_actions', 'file_path'],
  ['video_labels', 'file_path'],
  ['auto_tag_dismissed', 'file_path'],
  ['content_items', 'file_path'],
  ['performer_file_hashes', 'file_path'],
  ['media_probe', 'path'],
  ['video_analysis_settings', 'video_path'],
  ['label_jobs', 'video_path'],
  ['funpipe_jobs', 'video_path'],
];

const has = (table, col) => {
  try {
    return db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === col);
  } catch (_) {
    return false;
  }
};

function repoint(oldPath, newPath) {
  const changed = {};
  if (!oldPath || !newPath || oldPath === newPath) return changed;
  db.transaction(() => {
    for (const [table, col] of COLUMNS) {
      if (!has(table, col)) continue;
      const n = db.prepare(`UPDATE OR IGNORE ${table} SET ${col} = ? WHERE ${col} = ?`).run(newPath, oldPath).changes;
      db.prepare(`DELETE FROM ${table} WHERE ${col} = ?`).run(oldPath);   // left behind where the new path had a row
      if (n) changed[table] = n;
    }
  })();
  return changed;
}

module.exports = { repoint, COLUMNS };
