/**
 * Migration 004 — Video Scenes, Exported Files & Encoding Jobs
 */
module.exports = {
  version: 4,
  name: 'video_scenes_and_encoding',

  up(db) {
    // ── Video Scenes ─────────────────────────────────────────
    db.exec(`
      CREATE TABLE IF NOT EXISTS video_scenes (
        id              INTEGER PRIMARY KEY,
        video_path      TEXT NOT NULL,
        name            TEXT NOT NULL,
        start_time      REAL NOT NULL,
        end_time        REAL NOT NULL,
        export_path     TEXT,
        funscript_path  TEXT,
        created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
        exported_at     DATETIME
      );

      CREATE TABLE IF NOT EXISTS video_analysis_settings (
        id                INTEGER PRIMARY KEY,
        video_path        TEXT UNIQUE NOT NULL,
        allowed_actions   TEXT DEFAULT '',
        window_size       TEXT DEFAULT '',
        preserve_existing INTEGER DEFAULT 0,
        created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at        DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // ── Exported Files ───────────────────────────────────────
    db.exec(`
      CREATE TABLE IF NOT EXISTS exported_files (
        id                  INTEGER PRIMARY KEY,
        original_video_path TEXT NOT NULL,
        scene_id            INTEGER,
        file_path           TEXT NOT NULL,
        funscript_path      TEXT,
        name                TEXT NOT NULL,
        tags                TEXT,
        content_type        TEXT DEFAULT 'video',
        file_size           INTEGER,
        duration            REAL,
        created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(scene_id) REFERENCES video_scenes(id) ON DELETE SET NULL
      );
    `);

    // ── Encoding Jobs ────────────────────────────────────────
    db.exec(`
      CREATE TABLE IF NOT EXISTS encode_jobs (
        id                   INTEGER PRIMARY KEY AUTOINCREMENT,
        performer_id         INTEGER,
        source_path          TEXT NOT NULL,
        target_format        TEXT NOT NULL,
        status               TEXT DEFAULT 'pending',
        priority             INTEGER DEFAULT 0,
        original_size_bytes  INTEGER,
        estimated_size_bytes INTEGER,
        actual_size_bytes    INTEGER,
        worker_id            TEXT,
        created_at           TEXT DEFAULT CURRENT_TIMESTAMP,
        started_at           TEXT,
        completed_at         TEXT,
        error_message        TEXT,
        FOREIGN KEY (performer_id) REFERENCES performers(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_encode_jobs_status    ON encode_jobs(status);
      CREATE INDEX IF NOT EXISTS idx_encode_jobs_performer ON encode_jobs(performer_id);

      CREATE TABLE IF NOT EXISTS encode_settings (
        key        TEXT PRIMARY KEY,
        value      TEXT,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Insert default encode settings if not present
    const defaults = [
      ['video_codec',    'h265'],
      ['video_crf',      '28'],
      ['video_preset',   'medium'],
      ['video_hw_accel', 'auto'],
      ['image_format',   'webp'],
      ['image_quality',  '85'],
      ['keep_originals', 'true'],
      ['worker_mode',    'local'],
      ['backup_folder',  '.originals']
    ];

    const insert = db.prepare('INSERT OR IGNORE INTO encode_settings (key, value) VALUES (?, ?)');
    for (const [key, value] of defaults) {
      insert.run(key, value);
    }
  }
};
