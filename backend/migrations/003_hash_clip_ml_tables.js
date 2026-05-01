/**
 * Migration 003 — Hash Deduplication, CLIP Embeddings & ML Tables
 *
 * Creates performer_file_hashes, hash_runs, hash_run_items,
 * content_clip_embeddings, content_items, ml_models, ml_training_jobs,
 * ml_predictions, ml_included_performers, ml_batch_state, ml_batch_settings.
 */
module.exports = {
  version: 3,
  name: 'hash_clip_ml_tables',

  up(db) {
    // ── Hash Deduplication ───────────────────────────────────
    db.exec(`
      CREATE TABLE IF NOT EXISTS performer_file_hashes (
        id              INTEGER PRIMARY KEY,
        performer_id    INTEGER NOT NULL,
        file_path       TEXT    NOT NULL,
        file_size       INTEGER,
        mtime           INTEGER,
        exact_hash      TEXT,
        perceptual_hash TEXT,
        deleted_flag    INTEGER DEFAULT 0,
        seen_at         INTEGER DEFAULT (strftime('%s', 'now')),
        FOREIGN KEY(performer_id) REFERENCES performers(id),
        UNIQUE(performer_id, file_path)
      );

      CREATE INDEX IF NOT EXISTS idx_performer_file_hashes_performer
        ON performer_file_hashes(performer_id);
      CREATE INDEX IF NOT EXISTS idx_performer_file_hashes_exact
        ON performer_file_hashes(exact_hash) WHERE exact_hash IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_performer_file_hashes_perceptual
        ON performer_file_hashes(perceptual_hash) WHERE perceptual_hash IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_performer_file_hashes_deleted
        ON performer_file_hashes(deleted_flag);

      CREATE TABLE IF NOT EXISTS hash_runs (
        run_id               TEXT PRIMARY KEY,
        source_performer_id  INTEGER NOT NULL,
        target_performer_id  INTEGER NOT NULL,
        created_at           INTEGER DEFAULT (strftime('%s', 'now')),
        status               TEXT    DEFAULT 'pending',
        metadata             TEXT,
        FOREIGN KEY(source_performer_id) REFERENCES performers(id),
        FOREIGN KEY(target_performer_id) REFERENCES performers(id)
      );

      CREATE INDEX IF NOT EXISTS idx_hash_runs_status  ON hash_runs(status);
      CREATE INDEX IF NOT EXISTS idx_hash_runs_created ON hash_runs(created_at);

      CREATE TABLE IF NOT EXISTS hash_run_items (
        id               INTEGER PRIMARY KEY,
        run_id           TEXT    NOT NULL,
        file_path        TEXT    NOT NULL,
        file_id_ref      INTEGER,
        candidate_id     INTEGER,
        exact_match      INTEGER DEFAULT 0,
        hamming_distance INTEGER,
        selected         INTEGER DEFAULT 0,
        note             TEXT,
        FOREIGN KEY(run_id)       REFERENCES hash_runs(run_id) ON DELETE CASCADE,
        FOREIGN KEY(file_id_ref)  REFERENCES performer_file_hashes(id),
        FOREIGN KEY(candidate_id) REFERENCES performer_file_hashes(id)
      );

      CREATE INDEX IF NOT EXISTS idx_hash_run_items_run      ON hash_run_items(run_id);
      CREATE INDEX IF NOT EXISTS idx_hash_run_items_selected  ON hash_run_items(selected);
    `);

    // ── Content Items (reference table for CLIP / ML) ────────
    db.exec(`
      CREATE TABLE IF NOT EXISTS content_items (
        id           INTEGER PRIMARY KEY,
        performer_id INTEGER NOT NULL,
        file_path    TEXT    NOT NULL UNIQUE,
        file_type    TEXT,
        file_size    INTEGER,
        created_at   INTEGER DEFAULT (strftime('%s', 'now')),
        FOREIGN KEY(performer_id) REFERENCES performers(id)
      );

      CREATE INDEX IF NOT EXISTS idx_content_items_performer ON content_items(performer_id);
      CREATE INDEX IF NOT EXISTS idx_content_items_path      ON content_items(file_path);
    `);

    // ── CLIP Embeddings ──────────────────────────────────────
    db.exec(`
      CREATE TABLE IF NOT EXISTS content_clip_embeddings (
        id              INTEGER PRIMARY KEY,
        content_item_id INTEGER NOT NULL,
        clip_embedding  BLOB    NOT NULL,
        model_version   TEXT    DEFAULT 'openai/clip-vit-large-patch14',
        generated_at    INTEGER DEFAULT (strftime('%s', 'now')),
        UNIQUE(content_item_id)
      );

      CREATE INDEX IF NOT EXISTS idx_clip_content_item  ON content_clip_embeddings(content_item_id);
      CREATE INDEX IF NOT EXISTS idx_clip_model_version ON content_clip_embeddings(model_version);
    `);

    // ── ML Models & Predictions ──────────────────────────────
    db.exec(`
      CREATE TABLE IF NOT EXISTS ml_models (
        id                       TEXT PRIMARY KEY,
        name                     TEXT,
        created_at               INTEGER DEFAULT (strftime('%s', 'now')),
        training_duration_seconds INTEGER,
        training_samples         INTEGER,
        training_deleted_samples INTEGER,
        training_kept_samples    INTEGER,
        accuracy                 REAL,
        precision_score          REAL,
        recall_score             REAL,
        f1_score                 REAL,
        model_type               TEXT DEFAULT 'XGBoost',
        model_file_path          TEXT,
        metadata_file_path       TEXT,
        excluded_performers      TEXT,
        is_active                INTEGER DEFAULT 0,
        status                   TEXT DEFAULT 'training'
      );

      CREATE INDEX IF NOT EXISTS idx_ml_models_active  ON ml_models(is_active);
      CREATE INDEX IF NOT EXISTS idx_ml_models_created ON ml_models(created_at);

      CREATE TABLE IF NOT EXISTS ml_training_jobs (
        job_id       TEXT PRIMARY KEY,
        model_id     TEXT,
        status       TEXT    DEFAULT 'pending',
        progress     INTEGER DEFAULT 0,
        started_at   INTEGER,
        completed_at INTEGER,
        error        TEXT,
        FOREIGN KEY(model_id) REFERENCES ml_models(id)
      );

      CREATE INDEX IF NOT EXISTS idx_ml_training_jobs_status ON ml_training_jobs(status);

      CREATE TABLE IF NOT EXISTS ml_predictions (
        id              INTEGER PRIMARY KEY,
        model_id        TEXT    NOT NULL,
        content_item_id INTEGER NOT NULL,
        prediction      INTEGER,
        confidence      REAL,
        predicted_at    INTEGER DEFAULT (strftime('%s', 'now')),
        FOREIGN KEY(model_id)        REFERENCES ml_models(id) ON DELETE CASCADE,
        FOREIGN KEY(content_item_id) REFERENCES content_items(id) ON DELETE CASCADE,
        UNIQUE(model_id, content_item_id)
      );

      CREATE INDEX IF NOT EXISTS idx_ml_predictions_model      ON ml_predictions(model_id);
      CREATE INDEX IF NOT EXISTS idx_ml_predictions_content     ON ml_predictions(content_item_id);
      CREATE INDEX IF NOT EXISTS idx_ml_predictions_confidence  ON ml_predictions(confidence);

      CREATE TABLE IF NOT EXISTS ml_included_performers (
        performer_id INTEGER,
        model_type   TEXT DEFAULT 'both',
        included_at  INTEGER DEFAULT (strftime('%s', 'now')),
        PRIMARY KEY(performer_id, model_type),
        FOREIGN KEY(performer_id) REFERENCES performers(id) ON DELETE CASCADE
      );
    `);

    // ── ML Batch State (crash recovery) ──────────────────────
    db.exec(`
      CREATE TABLE IF NOT EXISTS ml_batch_state (
        id             INTEGER PRIMARY KEY,
        performer_id   INTEGER,
        performer_name TEXT,
        batch_state    TEXT,
        settings       TEXT,
        created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
        status         TEXT DEFAULT 'in_progress',
        UNIQUE(performer_id),
        FOREIGN KEY(performer_id) REFERENCES performers(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_ml_batch_state_performer ON ml_batch_state(performer_id);
      CREATE INDEX IF NOT EXISTS idx_ml_batch_state_status    ON ml_batch_state(status);

      CREATE TABLE IF NOT EXISTS ml_batch_settings (
        id         INTEGER PRIMARY KEY,
        key        TEXT UNIQUE NOT NULL,
        value      TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
  }
};
