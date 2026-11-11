/**
 * Migration 020 — reviewing duplicate checks, and Recently removed
 *
 * hash_run_items gets a status (open | removed | dismissed) and selected_by (auto | user): the duplicates page saves
 * every Keep / Remove choice as it is made, and a removal or a dismissed match leaves the item in place with its
 * status instead of deleting it.
 *
 * performer_file_hashes.deleted_flag gets a third value: 2 = removed by a duplicate check and held in Recently removed
 * (hash_removals). It is not history of a rejected file (that is 1, "deleted before"): new checks leave it out, a
 * restore sets it back to 0, and the row is deleted once the file is purged after the retention days.
 *
 * hash_removals is that store: where each file came from, where it is held (<library>/.acm-removed/<day>/<batch>/),
 * its hashes and size so a restore can put the row back, and what it was a copy of. No foreign keys: runs and hash
 * rows come and go while a removal is held.
 *
 * Existing runs are reset to the new auto pre-selection. That loses nothing: the old update-selection endpoint had no
 * caller, so every selected flag in them was written by the old check (which ticked every grouped file, chains and
 * last copies included), never by a person. exact_match is recomputed against the group's keeper (the old check copied
 * it from any match of the file), and only exact copies of a live keeper, themselves live and on a removable side
 * (internal run, or the run's source performer), start ticked.
 */
module.exports = {
  version: 20,
  name: 'hash_review',

  up(db) {
    const cols = db.prepare('PRAGMA table_info(hash_run_items)').all().map((c) => c.name);
    if (!cols.includes('status')) db.exec("ALTER TABLE hash_run_items ADD COLUMN status TEXT NOT NULL DEFAULT 'open'");
    if (!cols.includes('selected_by')) db.exec('ALTER TABLE hash_run_items ADD COLUMN selected_by TEXT');

    db.exec(`
      CREATE TABLE IF NOT EXISTS hash_removals (
        id              INTEGER PRIMARY KEY,
        batch_id        TEXT    NOT NULL,
        run_id          TEXT,
        run_item_id     INTEGER,
        file_hash_id    INTEGER,
        performer_id    INTEGER,
        original_path   TEXT    NOT NULL,
        stored_path     TEXT    NOT NULL,
        file_size       INTEGER,
        mtime           INTEGER,
        exact_hash      TEXT,
        perceptual_hash TEXT,
        keeper_path     TEXT,
        match           TEXT,
        distance        INTEGER,
        removed_at      INTEGER NOT NULL,
        status          TEXT    NOT NULL DEFAULT 'held',
        restored_at     INTEGER,
        restored_path   TEXT,
        purged_at       INTEGER,
        error           TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_hash_removals_performer_status ON hash_removals(performer_id, status);
      CREATE INDEX IF NOT EXISTS idx_hash_removals_batch ON hash_removals(batch_id);
      CREATE INDEX IF NOT EXISTS idx_hash_removals_status_removed ON hash_removals(status, removed_at);

      CREATE INDEX IF NOT EXISTS idx_hash_run_items_run_candidate ON hash_run_items(run_id, candidate_id);
      CREATE INDEX IF NOT EXISTS idx_hash_run_items_file ON hash_run_items(file_id_ref);
    `);

    db.exec(`
      UPDATE hash_run_items SET exact_match = CASE WHEN EXISTS (
        SELECT 1 FROM performer_file_hashes s JOIN performer_file_hashes k ON k.id = hash_run_items.candidate_id
        WHERE s.id = hash_run_items.file_id_ref AND s.exact_hash IS NOT NULL AND s.exact_hash = k.exact_hash
      ) THEN 1 ELSE 0 END;

      UPDATE hash_run_items SET selected_by = 'auto', selected = CASE WHEN exact_match = 1
        AND EXISTS (SELECT 1 FROM performer_file_hashes k WHERE k.id = hash_run_items.candidate_id AND k.deleted_flag = 0)
        AND EXISTS (
          SELECT 1 FROM performer_file_hashes s JOIN hash_runs r ON r.run_id = hash_run_items.run_id
          WHERE s.id = hash_run_items.file_id_ref AND s.deleted_flag = 0
            AND (r.source_performer_id = r.target_performer_id OR s.performer_id = r.source_performer_id)
        ) THEN 1 ELSE 0 END;
    `);
  }
};
