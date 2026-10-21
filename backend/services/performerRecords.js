const db = require('../db');

const BEFORE_FOLDER = 'before filter performer';
const AFTER_FOLDER = 'after filter performer';

/**
 * Delete a performer row and every row that references it.
 *
 * Several tables reference performers(id) without ON DELETE CASCADE
 * (hash_runs, content_items, ...). With foreign_keys=ON a bare
 * `DELETE FROM performers` fails as soon as one of those has a row, which
 * previously left a performer card behind after its folder had already been
 * removed. Runs in a single transaction so a failure leaves the database
 * untouched.
 *
 * File hashes are deliberately kept: they are what recognises a re-download
 * of a file that was deleted before. The rows lose their performer_id
 * (ON DELETE SET NULL, migration 013) and keep performer_name so that a
 * re-import under the same name adopts them again (adoptOrphanedHashes).
 *
 * @returns {Object} number of rows removed per table
 */
const deletePerformerRecord = db.transaction((performerId) => {
  const id = Number(performerId);
  const counts = {};
  const run = (key, sql, ...params) => {
    counts[key] = db.prepare(sql).run(...params).changes;
  };

  // Comparison runs are per performer pair and meaningless without one side;
  // their items cascade. The hashes themselves stay (see above).
  run('hashRuns', 'DELETE FROM hash_runs WHERE source_performer_id = ? OR target_performer_id = ?', id, id);
  run('fileHashesKept', `
    UPDATE performer_file_hashes
    SET performer_name = (SELECT name FROM performers WHERE id = ?)
    WHERE performer_id = ?
  `, id, id);
  run('filterActions', 'DELETE FROM filter_actions WHERE performer_id = ?', id);
  run('tags', 'DELETE FROM tags WHERE performer_id = ?', id);
  run('clipEmbeddings', 'DELETE FROM content_clip_embeddings WHERE content_item_id IN (SELECT id FROM content_items WHERE performer_id = ?)', id);
  run('contentItems', 'DELETE FROM content_items WHERE performer_id = ?', id);
  // ELO scores are keyed by image path (training images live on under
  // "deleted keep for training"), so unlink them instead of deleting them.
  run('imageEloScores', 'UPDATE image_elo_scores SET performer_id = NULL WHERE performer_id = ?', id);
  run('fileCache', 'DELETE FROM performer_file_cache WHERE performer_id = ?', id);
  // Everything else referencing performers cascades or sets null.
  run('performer', 'DELETE FROM performers WHERE id = ?', id);

  return counts;
});

/**
 * Give a newly created performer the hashes left behind by a deleted performer
 * of the same name, so files deleted back then are still recognised when they
 * are downloaded again. Rows whose path already exists for the new performer
 * are left orphaned (OR IGNORE on the UNIQUE(performer_id, file_path) index).
 *
 * @returns {number} rows adopted
 */
function adoptOrphanedHashes(performerId, performerName) {
  if (!performerName) return 0;
  return db.prepare(`
    UPDATE OR IGNORE performer_file_hashes
    SET performer_id = ?
    WHERE performer_id IS NULL AND performer_name = ? COLLATE NOCASE
  `).run(Number(performerId), performerName).changes;
}

/**
 * Rewrite every stored path for a performer after its folder moved between
 * "before filter performer" and "after filter performer": thumbnail,
 * thumbnail_paths (slideshow), hash file paths, and the cached file lists
 * (which are dropped so the next request rescans the new location).
 */
const relocatePerformerPaths = db.transaction((performerId, fromFolder, toFolder) => {
  const id = Number(performerId);
  const like = `%${fromFolder}%`;
  const thumbs = db.prepare(`
    UPDATE performers
    SET thumbnail = REPLACE(thumbnail, ?, ?),
        thumbnail_paths = REPLACE(thumbnail_paths, ?, ?)
    WHERE id = ? AND (thumbnail LIKE ? OR thumbnail_paths LIKE ?)
  `).run(fromFolder, toFolder, fromFolder, toFolder, id, like, like).changes;
  const hashes = db.prepare(`
    UPDATE performer_file_hashes
    SET file_path = REPLACE(file_path, ?, ?)
    WHERE performer_id = ? AND file_path LIKE ?
  `).run(fromFolder, toFolder, id, like).changes;
  const cache = db.prepare('DELETE FROM performer_file_cache WHERE performer_id = ?').run(id).changes;
  return { thumbs, hashes, cache };
});

/**
 * One-off repair for rows written before relocatePerformerPaths existed:
 * performers whose stored paths still point at the folder they were moved
 * out of. Safe to run on every startup.
 */
function repairPerformerPaths() {
  const stale = db.prepare(`
    SELECT id, moved_to_after FROM performers
    WHERE (moved_to_after = 1 AND (thumbnail LIKE ? OR thumbnail_paths LIKE ?))
       OR (moved_to_after = 0 AND (thumbnail LIKE ? OR thumbnail_paths LIKE ?))
  `).all(`%${BEFORE_FOLDER}%`, `%${BEFORE_FOLDER}%`, `%${AFTER_FOLDER}%`, `%${AFTER_FOLDER}%`);

  for (const row of stale) {
    const [from, to] = row.moved_to_after === 1 ? [BEFORE_FOLDER, AFTER_FOLDER] : [AFTER_FOLDER, BEFORE_FOLDER];
    relocatePerformerPaths(row.id, from, to);
  }

  const staleCache = db.prepare(`
    DELETE FROM performer_file_cache WHERE performer_id IN (
      SELECT c.performer_id FROM performer_file_cache c
      JOIN performers p ON p.id = c.performer_id
      WHERE (p.moved_to_after = 1 AND c.data LIKE ?)
         OR (p.moved_to_after = 0 AND c.data LIKE ?)
    )
  `).run(`%${BEFORE_FOLDER}%`, `%${AFTER_FOLDER}%`).changes;

  return { performers: stale.length, fileCacheRows: staleCache };
}

module.exports = {
  BEFORE_FOLDER,
  AFTER_FOLDER,
  deletePerformerRecord,
  adoptOrphanedHashes,
  relocatePerformerPaths,
  repairPerformerPaths
};
