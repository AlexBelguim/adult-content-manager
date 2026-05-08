/**
 * Migration 008 — Performer Comparisons History
 *
 * Stores every performer-level comparison (from Group Rate & Smart Compare)
 * as winner/loser pairs, tagged with a distinct type so they can be used
 * for Siamese model training without conflicting with the image-level
 * pairwise pairs in `pairwise_pairs`.
 *
 * Types:
 *   - 'performer_rank'       — single 1v1 from Group Rate (move up/down)
 *   - 'performer_rank_batch' — derived from Smart Compare batch ordering
 */
module.exports = {
  version: 8,
  name: 'performer_comparisons',

  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS performer_comparisons (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        winner_id      INTEGER NOT NULL,
        loser_id       INTEGER NOT NULL,
        type           TEXT    NOT NULL DEFAULT 'performer_rank',
        winner_rating_before REAL,
        loser_rating_before  REAL,
        winner_rating_after  REAL,
        loser_rating_after   REAL,
        source         TEXT    DEFAULT 'group_rate',
        created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(winner_id) REFERENCES performers(id) ON DELETE CASCADE,
        FOREIGN KEY(loser_id)  REFERENCES performers(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_perf_comp_winner  ON performer_comparisons(winner_id);
      CREATE INDEX IF NOT EXISTS idx_perf_comp_loser   ON performer_comparisons(loser_id);
      CREATE INDEX IF NOT EXISTS idx_perf_comp_type    ON performer_comparisons(type);
      CREATE INDEX IF NOT EXISTS idx_perf_comp_created ON performer_comparisons(created_at);
    `);
  }
};
