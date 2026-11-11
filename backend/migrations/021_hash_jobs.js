/**
 * Migration 021 — the hash-build queue lives on the server
 *
 * hash_jobs: one row per hash database build of a performer. services/hashQueue.js runs them one at a time (also
 * across processes: a running row with a fresh heartbeat_at blocks the next), in the order
 * priority DESC, queued_at, id. Before this the queue lived in the browser (localStorage 'hashQueue') and imports
 * hashed on their own, next to it.
 * mode is 'append' or 'replace'; origin is 'user' or 'import'; status is queued, running, done, failed or cancelled.
 * failed_files is the JSON list of at most 20 { path, error }. cancel_requested is set by Cancel and read by the
 * process that runs the build. Times are in ms.
 */
module.exports = {
  version: 21,
  name: 'hash_jobs',

  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS hash_jobs (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        performer_id     INTEGER NOT NULL,
        performer_name   TEXT,
        mode             TEXT NOT NULL DEFAULT 'append',
        origin           TEXT NOT NULL DEFAULT 'user',
        status           TEXT NOT NULL DEFAULT 'queued',
        priority         INTEGER NOT NULL DEFAULT 0,
        processed        INTEGER NOT NULL DEFAULT 0,
        total            INTEGER NOT NULL DEFAULT 0,
        succeeded        INTEGER NOT NULL DEFAULT 0,
        skipped          INTEGER NOT NULL DEFAULT 0,
        failed_count     INTEGER NOT NULL DEFAULT 0,
        failed_files     TEXT,
        marked_deleted   INTEGER,
        warning          TEXT,
        error            TEXT,
        cancel_requested INTEGER NOT NULL DEFAULT 0,
        queued_at        INTEGER NOT NULL,
        started_at       INTEGER,
        heartbeat_at     INTEGER,
        finished_at      INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_hash_jobs_order ON hash_jobs(status, priority, queued_at);
      CREATE INDEX IF NOT EXISTS idx_hash_jobs_performer ON hash_jobs(performer_id);
    `);
  }
};
