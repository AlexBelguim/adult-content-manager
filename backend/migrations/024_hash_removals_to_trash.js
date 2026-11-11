/**
 * Migration 024 — duplicates go to her trash, not to Recently removed
 *
 * The duplicates page no longer holds removed files 30 days in <library>/.acm-removed: they go straight to her own
 * pics/.trash, vids/.trash or vids/funscript/.trash, named 'dupe__<name>' so the trash cleanup deletes them and never
 * saves them for training (services/fileTrash.js, dropNoTraining). Undo is only for the toast.
 *
 * hash_removals stays as history; nothing writes new removals to it. At start-up hashRemovals.moveOldRemovals() moves
 * each file still held there into her trash (marked the same way), once, and records where (trash_path, added here).
 * Statuses after that: trashed (moved to her trash), no_folder (her folder is gone; the file stays in .acm-removed
 * and is listed on the duplicates page, tried again at each start), lost (the stored file was gone), and the old
 * restored and purged. performer_file_hashes.deleted_flag 2 now reads "removed by a duplicate check".
 */
module.exports = {
  version: 24,
  name: 'hash_removals_to_trash',

  up(db) {
    const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'hash_removals'").get();
    if (!table) return;
    const cols = new Set(db.prepare('PRAGMA table_info(hash_removals)').all().map((c) => c.name));
    if (!cols.has('trash_path')) db.exec('ALTER TABLE hash_removals ADD COLUMN trash_path TEXT');
  }
};
