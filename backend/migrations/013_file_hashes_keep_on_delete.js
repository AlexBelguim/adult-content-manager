/**
 * Migration 013 — File hashes survive deleting their performer
 *
 * Hashes of deleted files are what lets a re-download be recognised, so deleting a performer no longer
 * deletes them: performer_id becomes NULL (ON DELETE SET NULL instead of a blocking FK) and performer_name
 * remembers whose they were, so a re-import under the same name adopts them again. SQLite can't change a
 * foreign key in place, so the table is rebuilt with the same ids, columns and indexes.
 *
 * hash_run_items references this table, so the rebuild runs with foreign keys off (see migrate.js);
 * the ids are preserved and foreign_key_check runs before commit.
 */
module.exports = {
  version: 13,
  name: 'file_hashes_keep_on_delete',
  foreignKeys: false,

  up(db) {
    db.exec(`
      CREATE TABLE performer_file_hashes_new (
        id INTEGER PRIMARY KEY,
        performer_id INTEGER,
        performer_name TEXT,
        file_path TEXT NOT NULL,
        file_size INTEGER,
        mtime INTEGER,
        exact_hash TEXT,
        perceptual_hash TEXT,
        deleted_flag INTEGER DEFAULT 0,
        seen_at INTEGER DEFAULT (strftime('%s', 'now')),
        FOREIGN KEY(performer_id) REFERENCES performers(id) ON DELETE SET NULL,
        UNIQUE(performer_id, file_path)
      );

      INSERT INTO performer_file_hashes_new
        (id, performer_id, performer_name, file_path, file_size, mtime, exact_hash, perceptual_hash, deleted_flag, seen_at)
        SELECT h.id, h.performer_id, p.name, h.file_path, h.file_size, h.mtime, h.exact_hash, h.perceptual_hash, h.deleted_flag, h.seen_at
        FROM performer_file_hashes h LEFT JOIN performers p ON p.id = h.performer_id;

      DROP TABLE performer_file_hashes;
      ALTER TABLE performer_file_hashes_new RENAME TO performer_file_hashes;

      CREATE INDEX idx_performer_file_hashes_performer ON performer_file_hashes(performer_id);
      CREATE INDEX idx_performer_file_hashes_exact ON performer_file_hashes(exact_hash) WHERE exact_hash IS NOT NULL;
      CREATE INDEX idx_performer_file_hashes_perceptual ON performer_file_hashes(perceptual_hash) WHERE perceptual_hash IS NOT NULL;
      CREATE INDEX idx_performer_file_hashes_deleted ON performer_file_hashes(deleted_flag);
      CREATE INDEX idx_performer_file_hashes_orphan_name ON performer_file_hashes(performer_name) WHERE performer_id IS NULL;
    `);
  }
};
