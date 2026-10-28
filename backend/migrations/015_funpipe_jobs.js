/**
 * Migration 015 — the funpipe queue lives in the app
 *
 * funpipe_jobs: one row per video queued for funscript generation. The app owns the queue; the AI app on the GPU PC is a
 * worker that claims the next job, downloads the video, runs the stages and uploads the sidecars and the funscript back
 * (routes/workers.js). Before this the queue lived in the AI app and it read the video from the NAS share.
 * stages is the JSON list of stages still to run, worked out from the sidecars next to the video when it was queued;
 * log is the JSON list of the last lines the worker sent.
 */
module.exports = {
  version: 15,
  name: 'funpipe_jobs',

  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS funpipe_jobs (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        video_path    TEXT NOT NULL,
        pose          INTEGER NOT NULL DEFAULT 1,
        stages        TEXT NOT NULL,
        status        TEXT NOT NULL DEFAULT 'queued',
        worker        TEXT,
        stage         TEXT,
        phase         TEXT,
        progress      REAL,
        windows_done  INTEGER,
        total_windows INTEGER,
        gpu_warning   TEXT,
        log           TEXT,
        error         TEXT,
        created_at    INTEGER NOT NULL,
        started_at    INTEGER,
        heartbeat_at  INTEGER,
        finished_at   INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_funpipe_jobs_status ON funpipe_jobs(status);
    `);
  }
};
