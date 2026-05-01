/**
 * Migration 006 — Pairwise Comparison Tables
 *
 * Absorbs the standalone pairwise backend's schema into the main DB.
 * Tables: pairwise_pairs, pairwise_image_scores, pairwise_inference_results,
 *         pairwise_selected_performers.
 * Settings are merged into the existing app_settings table.
 */
module.exports = {
  version: 6,
  name: 'pairwise_tables',

  up(db) {
    db.exec(`
      -- Labeled pairs (winner/loser from image pairwise comparisons)
      CREATE TABLE IF NOT EXISTS pairwise_pairs (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        performer_id INTEGER,
        winner       TEXT NOT NULL,
        loser        TEXT NOT NULL,
        type         TEXT DEFAULT 'mixed',
        created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(performer_id) REFERENCES performers(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_pw_pairs_performer ON pairwise_pairs(performer_id);
      CREATE INDEX IF NOT EXISTS idx_pw_pairs_created   ON pairwise_pairs(created_at);

      -- Image-level ELO scores (running averages from comparisons)
      CREATE TABLE IF NOT EXISTS pairwise_image_scores (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        performer_id INTEGER,
        path         TEXT NOT NULL,
        score        REAL DEFAULT 50,
        comparisons  INTEGER DEFAULT 0,
        updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(performer_id) REFERENCES performers(id) ON DELETE CASCADE,
        UNIQUE(performer_id, path)
      );

      CREATE INDEX IF NOT EXISTS idx_pw_scores_performer ON pairwise_image_scores(performer_id);
      CREATE INDEX IF NOT EXISTS idx_pw_scores_score     ON pairwise_image_scores(score);

      -- Inference results cache per performer
      CREATE TABLE IF NOT EXISTS pairwise_inference_results (
        performer_id INTEGER PRIMARY KEY,
        data         TEXT,
        timestamp    DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(performer_id) REFERENCES performers(id) ON DELETE CASCADE
      );

      -- Selected performers for active labeling session
      CREATE TABLE IF NOT EXISTS pairwise_selected_performers (
        performer_id INTEGER PRIMARY KEY,
        FOREIGN KEY(performer_id) REFERENCES performers(id) ON DELETE CASCADE
      );
    `);
  }
};
