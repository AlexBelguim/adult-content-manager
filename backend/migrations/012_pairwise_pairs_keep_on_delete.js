/**
 * Migration 012 — Pairwise pairs survive deleting their performer
 *
 * Hand-made pairs are training labels, so deleting a performer no longer deletes them: performer_id
 * becomes NULL (ON DELETE SET NULL instead of CASCADE) and performer_name keeps whose pairs they were.
 * SQLite can't change a foreign key in place, so the table is rebuilt with the same ids, columns and indexes.
 */
module.exports = {
  version: 12,
  name: 'pairwise_pairs_keep_on_delete',

  up(db) {
    db.exec(`
      CREATE TABLE pairwise_pairs_new (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        performer_id   INTEGER,
        performer_name TEXT,
        winner         TEXT NOT NULL,
        loser          TEXT NOT NULL,
        type           TEXT DEFAULT 'mixed',
        created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
        source         TEXT,
        FOREIGN KEY(performer_id) REFERENCES performers(id) ON DELETE SET NULL
      );

      INSERT INTO pairwise_pairs_new (id, performer_id, performer_name, winner, loser, type, created_at, source)
        SELECT pp.id, pp.performer_id, p.name, pp.winner, pp.loser, pp.type, pp.created_at, pp.source
        FROM pairwise_pairs pp LEFT JOIN performers p ON p.id = pp.performer_id;

      DROP TABLE pairwise_pairs;
      ALTER TABLE pairwise_pairs_new RENAME TO pairwise_pairs;

      CREATE INDEX idx_pw_pairs_performer ON pairwise_pairs(performer_id);
      CREATE INDEX idx_pw_pairs_created   ON pairwise_pairs(created_at);
    `);
  }
};
