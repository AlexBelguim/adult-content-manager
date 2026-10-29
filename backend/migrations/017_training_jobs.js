/**
 * Migration 017 — the training queue lives in the app
 *
 * training_jobs: one row per training run asked for on the Taste Dashboard. The app owns the queue; the AI app on the
 * GPU PC is a worker that claims the next run (routes/workers.js, the funpipe worker's token), trains it in a process of
 * its own, sends its state while it runs and the result at the end. Before this the dashboard started a run on the AI
 * app directly, one at a time, and a second one was turned away.
 * payload: the JSON the AI app trains with (type, epochs, pairs, ratings …); state: the last training_status the worker
 * sent (epoch, batch, accuracy, phase); result: what the run made (the model file, its best accuracy).
 * Status: queued | running | done | failed | cancelled. cancel = 1 while a running one is being stopped.
 */
module.exports = {
  version: 17,
  name: 'training_jobs',

  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS training_jobs (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        type          TEXT NOT NULL,
        label         TEXT,
        payload       TEXT NOT NULL,
        status        TEXT NOT NULL DEFAULT 'queued',
        priority      INTEGER NOT NULL DEFAULT 0,
        position      INTEGER,
        worker        TEXT,
        phase         TEXT,
        progress      REAL,
        message       TEXT,
        state         TEXT,
        result        TEXT,
        error         TEXT,
        cancel        INTEGER NOT NULL DEFAULT 0,
        created_at    INTEGER NOT NULL,
        started_at    INTEGER,
        heartbeat_at  INTEGER,
        finished_at   INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_training_jobs_status ON training_jobs(status);
    `);
  }
};
