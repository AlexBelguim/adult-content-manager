/**
 * Migration 001 — Initial Schema
 *
 * Core tables: folders, performers (base columns), content_genres,
 * filter_actions, tags, file_tags, file_ratings, app_settings.
 */
module.exports = {
  version: 1,
  name: 'initial_schema',

  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS folders (
        id   INTEGER PRIMARY KEY,
        path TEXT UNIQUE
      );

      CREATE TABLE IF NOT EXISTS performers (
        id                   INTEGER PRIMARY KEY,
        name                 TEXT,
        folder_id            INTEGER,
        thumbnail            TEXT,
        pics_count           INTEGER DEFAULT 0,
        vids_count           INTEGER DEFAULT 0,
        funscript_vids_count INTEGER DEFAULT 0,
        funscript_files_count INTEGER DEFAULT 0,
        total_size_gb        REAL    DEFAULT 0,
        pics_filtered        INTEGER DEFAULT 0,
        vids_filtered        INTEGER DEFAULT 0,
        funscript_vids_filtered INTEGER DEFAULT 0,
        pics_original_count  INTEGER DEFAULT 0,
        vids_original_count  INTEGER DEFAULT 0,
        funscript_vids_original_count INTEGER DEFAULT 0,
        ready_to_move        BOOLEAN DEFAULT 0,
        moved_to_after       BOOLEAN DEFAULT 0,
        import_date          DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_scan_date       DATETIME,
        cached_pics_path     TEXT,
        cached_vids_path     TEXT,
        cached_funscript_path TEXT,
        aliases              TEXT,
        FOREIGN KEY(folder_id) REFERENCES folders(id)
      );

      CREATE TABLE IF NOT EXISTS content_genres (
        id              INTEGER PRIMARY KEY,
        name            TEXT,
        folder_id       INTEGER,
        pics_count      INTEGER DEFAULT 0,
        vids_count      INTEGER DEFAULT 0,
        total_size_gb   REAL    DEFAULT 0,
        last_scan_date  DATETIME,
        cached_pics_path TEXT,
        cached_vids_path TEXT,
        cached_funscript_path TEXT,
        FOREIGN KEY(folder_id) REFERENCES folders(id)
      );

      CREATE TABLE IF NOT EXISTS filter_actions (
        id           INTEGER PRIMARY KEY,
        performer_id INTEGER,
        file_path    TEXT,
        file_type    TEXT,
        action       TEXT,
        reasons      TEXT,
        timestamp    DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(performer_id) REFERENCES performers(id)
      );

      CREATE TABLE IF NOT EXISTS tags (
        id           INTEGER PRIMARY KEY,
        performer_id INTEGER,
        tag          TEXT
      );

      CREATE TABLE IF NOT EXISTS file_tags (
        id        INTEGER PRIMARY KEY,
        file_path TEXT,
        tag       TEXT,
        UNIQUE(file_path, tag)
      );

      CREATE TABLE IF NOT EXISTS file_ratings (
        file_path        TEXT PRIMARY KEY,
        video_rating     REAL,
        funscript_rating REAL,
        updated_at       DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS app_settings (
        id    INTEGER PRIMARY KEY,
        key   TEXT UNIQUE,
        value TEXT
      );

      CREATE TABLE IF NOT EXISTS performer_file_cache (
        performer_id INTEGER,
        type         TEXT,
        data         JSON,
        updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (performer_id, type),
        FOREIGN KEY(performer_id) REFERENCES performers(id) ON DELETE CASCADE
      );
    `);

    // Populate file_type for any existing filter_actions that lack it
    db.exec(`
      UPDATE filter_actions
      SET file_type = CASE
        WHEN LOWER(SUBSTR(file_path, -4)) IN ('.jpg', '.png', '.gif') OR
             LOWER(SUBSTR(file_path, -5)) IN ('.jpeg', '.webp') THEN 'image'
        WHEN LOWER(SUBSTR(file_path, -4)) IN ('.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv') OR
             LOWER(SUBSTR(file_path, -5)) IN ('.webm') THEN 'video'
        WHEN LOWER(SUBSTR(file_path, -10)) = '.funscript' THEN 'funscript'
        ELSE 'unknown'
      END
      WHERE file_type IS NULL
    `);

    // Initialize original counts for existing performers who don't have them set
    db.exec(`
      UPDATE performers
      SET pics_original_count           = pics_count,
          vids_original_count           = vids_count,
          funscript_vids_original_count = funscript_vids_count
      WHERE pics_original_count = 0
        AND vids_original_count = 0
        AND funscript_vids_original_count = 0
    `);

    // Data repair: fix corrupted original counts where filtered > original
    db.exec(`
      UPDATE performers
      SET pics_original_count           = MAX(pics_original_count, pics_filtered, pics_count),
          vids_original_count           = MAX(vids_original_count, vids_filtered, vids_count),
          funscript_vids_original_count = MAX(funscript_vids_original_count, funscript_vids_filtered, funscript_vids_count)
      WHERE pics_filtered > pics_original_count
         OR vids_filtered > vids_original_count
         OR funscript_vids_filtered > funscript_vids_original_count
    `);
  }
};
