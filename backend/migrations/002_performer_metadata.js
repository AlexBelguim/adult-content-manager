/**
 * Migration 002 — Performer Metadata
 *
 * Adds all scraped biographical columns, blacklist support,
 * thumbnail slideshows, content-update tracking, and misc fields.
 */
module.exports = {
  version: 2,
  name: 'performer_metadata',

  up(db) {
    // Helper: add column if it doesn't already exist
    const addCol = (table, col, type) => {
      try {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
      } catch (_) { /* column already exists */ }
    };

    // ── Biographical / Scraped Data ──────────────────────────
    addCol('performers', 'age',              'INTEGER');
    addCol('performers', 'born',             'TEXT');
    addCol('performers', 'birthplace',       'TEXT');
    addCol('performers', 'country_flag',     'TEXT');
    addCol('performers', 'height',           'TEXT');
    addCol('performers', 'weight',           'TEXT');
    addCol('performers', 'measurements',     'TEXT');
    addCol('performers', 'hair_color',       'TEXT');
    addCol('performers', 'eye_color',        'TEXT');
    addCol('performers', 'ethnicity',        'TEXT');
    addCol('performers', 'body_type',        'TEXT');
    addCol('performers', 'orientation',      'TEXT');
    addCol('performers', 'scraped_tags',     'TEXT');
    addCol('performers', 'scraped_at',       'DATETIME');
    addCol('performers', 'pubic_hair',       'TEXT');
    addCol('performers', 'tattoos',          'TEXT');
    addCol('performers', 'piercings',        'TEXT');

    // Detailed measurement columns
    addCol('performers', 'measurements_cup',       'TEXT');
    addCol('performers', 'measurements_band_size', 'TEXT');
    addCol('performers', 'measurements_fake',      'BOOLEAN DEFAULT 0');

    // ── Blacklist ────────────────────────────────────────────
    addCol('performers', 'blacklisted',      'INTEGER DEFAULT 0');
    addCol('performers', 'blacklist_reason',  'TEXT');
    addCol('performers', 'blacklist_date',    'DATETIME');

    // ── Thumbnail Slideshow ──────────────────────────────────
    addCol('performers', 'thumbnail_paths',           'TEXT');
    addCol('performers', 'thumbnail_transition_type',  'TEXT DEFAULT \'fade\'');
    addCol('performers', 'thumbnail_transition_time',  'REAL DEFAULT 3.0');
    addCol('performers', 'thumbnail_transition_speed', 'REAL DEFAULT 0.5');

    // ── Content-Update Tracking (Leakshaven) ─────────────────
    addCol('performers', 'last_leakshaven_check_date',    'DATETIME');
    addCol('performers', 'last_leakshaven_update_time',   'TEXT');
    addCol('performers', 'leakshaven_update_acknowledged', 'INTEGER DEFAULT 0');
    addCol('performers', 'leakshaven_check_error',        'TEXT');
    addCol('performers', 'leakshaven_search_name',        'TEXT');

    // ── Scraping Metadata ────────────────────────────────────
    addCol('performers', 'scraped_status',    'TEXT');
    addCol('performers', 'leakshaven_alias',  'TEXT');

    // ── Hash Verification ────────────────────────────────────
    addCol('performers', 'hash_verified',            'INTEGER DEFAULT 0');
    addCol('performers', 'latest_internal_run_id',   'TEXT');
    addCol('performers', 'internal_duplicate_count', 'INTEGER DEFAULT 0');

    // ── Rating ───────────────────────────────────────────────
    addCol('performers', 'performer_rating', 'REAL');
    addCol('performers', 'raw_ai_score',     'REAL');
  }
};
