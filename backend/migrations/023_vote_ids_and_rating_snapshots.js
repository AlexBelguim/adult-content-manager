/**
 * Migration 023 — vote ids, so a resent vote counts once, and snapshots of the ratings, so a reset can be undone
 *
 * vote_ids: one row per vote the rate pages sent with a vote id (Smart Compare, Group Rate, their undo). A vote
 *   that comes again with the same id is answered with `result` (the JSON the first send got) and not applied
 *   again. The row is written in the same transaction as the rating change. Rows older than 30 days are pruned.
 *
 * rating_snapshots: the ratings as they were just before "Reset all ratings" or a restore. `data` is JSON:
 *   { performers: [{ id, import_date, performer_rating }], ratings: [{ performer_id, manual_star }] } for every
 *   performer and every ratings row (the fields a reset changes; import_date so a restore only touches the same
 *   performer, never a new one that was given a deleted performer's id). The reset keeps duel counts and duel history, so they are
 *   not in it. Only the 10 newest are kept.
 */
module.exports = {
  version: 23,
  name: 'vote_ids_and_rating_snapshots',

  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS vote_ids (
        id         TEXT PRIMARY KEY,
        kind       TEXT NOT NULL,
        result     TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_vote_ids_created ON vote_ids(created_at);

      CREATE TABLE IF NOT EXISTS rating_snapshots (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at INTEGER NOT NULL,
        label      TEXT NOT NULL,
        performers INTEGER NOT NULL DEFAULT 0,
        data       TEXT NOT NULL
      );
    `);
  }
};
