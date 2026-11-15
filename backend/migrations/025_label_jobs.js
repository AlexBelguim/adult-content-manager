/**
 * Migration 025 — label jobs, and where each GPU job runs
 *
 * label_jobs: one row per video to label with labelmaster (its scenes, the dress-state lane). The app owns the queue; a
 * worker node's acm-gpu claims a job through the coordinator (kind acm-label), downloads the video, labels it, and sends
 * the labels back (they land in video_labels, as scenetest's did) with the full scenes and motion documents as the
 * video's .labels.json and .motion.json sidecars, which a funscript job reads.
 *
 * funpipe_jobs.mode: null = funpipe on its own (as before), 'scenes' = the funscript made from the labels' scenes;
 * funpipe_jobs.wait_label: the label job it waits for (it is not handed out until that one is done).
 * run_on (label_jobs, funpipe_jobs, training_jobs): the coordinator's node id the job must run on, null = the order set
 * for its kind in the coordinator.
 */
module.exports = {
  version: 25,
  name: 'label_jobs',

  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS label_jobs (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        video_path    TEXT NOT NULL,
        status        TEXT NOT NULL DEFAULT 'queued',
        run_on        TEXT,
        worker        TEXT,
        stage         TEXT,
        progress      REAL,
        message       TEXT,
        log           TEXT,
        result        TEXT,
        error         TEXT,
        created_at    INTEGER NOT NULL,
        started_at    INTEGER,
        heartbeat_at  INTEGER,
        finished_at   INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_label_jobs_status ON label_jobs(status);
    `);
    const has = (table, col) => db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === col);
    if (!has('funpipe_jobs', 'mode')) db.exec('ALTER TABLE funpipe_jobs ADD COLUMN mode TEXT');
    if (!has('funpipe_jobs', 'wait_label')) db.exec('ALTER TABLE funpipe_jobs ADD COLUMN wait_label INTEGER');
    if (!has('funpipe_jobs', 'run_on')) db.exec('ALTER TABLE funpipe_jobs ADD COLUMN run_on TEXT');
    if (!has('training_jobs', 'run_on')) db.exec('ALTER TABLE training_jobs ADD COLUMN run_on TEXT');
  }
};
