/**
 * Migration 009 — Hard Examples Tracking
 * 
 * Stores human corrections from the Smart Filter UI to be used for 
 * Hard Example Mining during training.
 */
module.exports = {
  version: 9,
  name: 'hard_examples',

  up(db) {
    db.exec(`
      -- Track image classification corrections
      CREATE TABLE IF NOT EXISTS hard_examples (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        performer_id INTEGER,
        file_path    TEXT NOT NULL,
        original_label TEXT, -- 'keep' or 'delete' as predicted by AI
        corrected_label TEXT, -- 'keep' or 'delete' as decided by human
        model_type   TEXT,    -- 'binary' or 'pairwise'
        model_name   TEXT,    -- name of the model that made the mistake
        created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(performer_id) REFERENCES performers(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_hard_examples_performer ON hard_examples(performer_id);
      CREATE INDEX IF NOT EXISTS idx_hard_examples_path      ON hard_examples(file_path);
      
      -- Track pairwise comparison corrections (if applicable later)
      CREATE TABLE IF NOT EXISTS hard_pairwise_examples (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        performer_id INTEGER,
        winner_path  TEXT NOT NULL,
        loser_path   TEXT NOT NULL,
        source       TEXT DEFAULT 'human_correction',
        created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(performer_id) REFERENCES performers(id) ON DELETE CASCADE
      );
    `);
  }
};
