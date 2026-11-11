/**
 * Migration 022 — an ended re-encode can leave the lists without being forgotten
 *
 * encode_jobs.dismissed_at (ms): set by the Jobs page's Remove and Clear finished on a skipped, undone or done row.
 * Such a row is left out of the lists (encodeQueue.status().recent, so also /api/jobs), but it stays in the table:
 * triedByQueue reads it so the video is not offered for a re-encode again, calibration learns from it, and the Space
 * page's freed total still counts it.
 */
module.exports = {
  version: 22,
  name: 'encode_jobs_dismissed',

  up(db) {
    const cols = new Set(db.prepare('PRAGMA table_info(encode_jobs)').all().map(c => c.name));
    if (!cols.has('dismissed_at')) db.exec('ALTER TABLE encode_jobs ADD COLUMN dismissed_at INTEGER');
  }
};
