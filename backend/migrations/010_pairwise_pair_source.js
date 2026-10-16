/**
 * Migration 010 — Source of a pairwise pair
 *
 * NULL = made with Rank images. 'pairwise_db' = imported from the old standalone
 * backend (backend-pairwise/pairwise.db) by scripts/import_pairwise_db.js.
 */
module.exports = {
  version: 10,
  name: 'pairwise_pair_source',

  up(db) {
    db.exec(`ALTER TABLE pairwise_pairs ADD COLUMN source TEXT`);
  }
};
