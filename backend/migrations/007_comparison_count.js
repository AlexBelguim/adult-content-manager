/**
 * Migration 007 — Add comparison_count to ratings table
 *
 * Tracks how many times a performer has been compared (ELO duels).
 * Used by the Smart Compare algorithm to keep performers in "calibration
 * mode" until they have enough comparisons to find their true position.
 */
module.exports = {
  version: 7,
  name: 'comparison_count',

  up(db) {
    // Add comparison_count column to ratings table
    try {
      db.exec(`ALTER TABLE ratings ADD COLUMN comparison_count INTEGER DEFAULT 0`);
      console.log('    Added comparison_count column to ratings table');
    } catch (err) {
      // Column might already exist — SQLite says "duplicate column name"
      if (err.message && err.message.includes('duplicate column')) {
        console.log('    comparison_count column already exists');
      } else {
        console.error('    Failed to add comparison_count column:', err.message);
        throw err;
      }
    }
  }
};
