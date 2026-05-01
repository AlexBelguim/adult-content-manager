/**
 * Migration 005 — Ratings & Calibration Tables
 *
 * Creates the personalized rating system tables and populates
 * initial ratings from existing performer_rating values.
 */
module.exports = {
  version: 5,
  name: 'ratings_and_calibration',

  up(db) {
    // ── Ratings Table ────────────────────────────────────────
    db.exec(`
      CREATE TABLE IF NOT EXISTS ratings (
        performer_id INTEGER PRIMARY KEY,
        manual_star  REAL,
        confidence   REAL    DEFAULT 1.0,
        is_flagged   BOOLEAN DEFAULT 0,
        created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(performer_id) REFERENCES performers(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS user_global_model (
        id           INTEGER PRIMARY KEY DEFAULT 1,
        model_params TEXT,
        n_effective  REAL,
        updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // One-time seed: populate ratings from existing performer_rating
    try {
      const count = db.prepare('SELECT COUNT(*) AS count FROM ratings').get().count;
      if (count === 0) {
        const rows = db.prepare(
          'SELECT id, performer_rating FROM performers WHERE performer_rating IS NOT NULL AND performer_rating > 0'
        ).all();

        if (rows.length > 0) {
          console.log(`    Seeding ratings table from ${rows.length} existing performer ratings…`);
          const ins = db.prepare(
            'INSERT OR IGNORE INTO ratings (performer_id, manual_star, confidence, is_flagged) VALUES (?, ?, 0.3, 1)'
          );
          for (const row of rows) {
            ins.run(row.id, row.performer_rating);
          }
        }
      }
    } catch (err) {
      console.log('    Ratings seed skipped:', err.message);
    }
  }
};
