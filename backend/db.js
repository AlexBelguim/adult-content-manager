const sqlite = require('better-sqlite3');
const config = require('./config');
const db = sqlite(config.dbPath);

// Enable foreign keys and WAL mode for concurrency
db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');

// Schema
db.exec(`
  CREATE TABLE IF NOT EXISTS folders (id INTEGER PRIMARY KEY, path TEXT UNIQUE);
  CREATE TABLE IF NOT EXISTS performers (
    id INTEGER PRIMARY KEY,
    name TEXT,
    folder_id INTEGER,
    thumbnail TEXT,
    pics_count INTEGER DEFAULT 0,
    vids_count INTEGER DEFAULT 0,
    funscript_vids_count INTEGER DEFAULT 0,
    funscript_files_count INTEGER DEFAULT 0,
    total_size_gb REAL DEFAULT 0,
    pics_filtered INTEGER DEFAULT 0,
    vids_filtered INTEGER DEFAULT 0,
    funscript_vids_filtered INTEGER DEFAULT 0,
    pics_original_count INTEGER DEFAULT 0,
    vids_original_count INTEGER DEFAULT 0,
    funscript_vids_original_count INTEGER DEFAULT 0,
    ready_to_move BOOLEAN DEFAULT 0,
    moved_to_after BOOLEAN DEFAULT 0,
    import_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_scan_date DATETIME,
    cached_pics_path TEXT,
    cached_vids_path TEXT,
    cached_funscript_path TEXT,
    aliases TEXT,
    age INTEGER,
    born TEXT,
    birthplace TEXT,
    country_flag TEXT,
    height TEXT,
    weight TEXT,
    measurements TEXT,
    hair_color TEXT,
    eye_color TEXT,
    ethnicity TEXT,
    body_type TEXT,
    orientation TEXT,
    scraped_tags TEXT,
    scraped_at DATETIME,
    FOREIGN KEY(folder_id) REFERENCES folders(id)
  );
  CREATE TABLE IF NOT EXISTS content_genres (
    id INTEGER PRIMARY KEY,
    name TEXT,
    folder_id INTEGER,
    pics_count INTEGER DEFAULT 0,
    vids_count INTEGER DEFAULT 0,
    total_size_gb REAL DEFAULT 0,
    last_scan_date DATETIME,
    cached_pics_path TEXT,
    cached_vids_path TEXT,
    cached_funscript_path TEXT,
    FOREIGN KEY(folder_id) REFERENCES folders(id)
  );
  CREATE TABLE IF NOT EXISTS filter_actions (
    id INTEGER PRIMARY KEY,
    performer_id INTEGER,
    file_path TEXT,
    file_type TEXT, -- 'image', 'video', 'funscript'
    action TEXT, -- 'keep', 'delete', 'move_to_funscript'
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(performer_id) REFERENCES performers(id)
  );
  CREATE TABLE IF NOT EXISTS tags (id INTEGER PRIMARY KEY, performer_id INTEGER, tag TEXT);
  CREATE TABLE IF NOT EXISTS file_tags (id INTEGER PRIMARY KEY, file_path TEXT, tag TEXT, UNIQUE(file_path, tag));
  CREATE TABLE IF NOT EXISTS file_ratings (
    file_path TEXT PRIMARY KEY,
    video_rating REAL,
    funscript_rating REAL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS app_settings (
    id INTEGER PRIMARY KEY,
    key TEXT UNIQUE,
    value TEXT
  );
  CREATE TABLE IF NOT EXISTS video_analysis_settings (
    id INTEGER PRIMARY KEY,
    video_path TEXT UNIQUE NOT NULL,
    allowed_actions TEXT DEFAULT '',
    window_size TEXT DEFAULT '',
    preserve_existing INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS video_scenes (
    id INTEGER PRIMARY KEY,
    video_path TEXT NOT NULL,
    name TEXT NOT NULL,
    start_time REAL NOT NULL,
    end_time REAL NOT NULL,
    export_path TEXT,
    funscript_path TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    exported_at DATETIME
  );
  CREATE TABLE IF NOT EXISTS exported_files (
    id INTEGER PRIMARY KEY,
    original_video_path TEXT NOT NULL,
    scene_id INTEGER,
    file_path TEXT NOT NULL,
    funscript_path TEXT,
    name TEXT NOT NULL,
    tags TEXT, -- JSON string of tags
    content_type TEXT DEFAULT 'video', -- 'video' or 'funscript'
    file_size INTEGER,
    duration REAL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(scene_id) REFERENCES video_scenes(id) ON DELETE SET NULL
  );
  CREATE TABLE IF NOT EXISTS performer_file_cache (
    performer_id INTEGER,
    type TEXT, -- 'pics', 'vids', 'funscript'
    data JSON, -- Array of file objects [{path, name}, ...]
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (performer_id, type),
    FOREIGN KEY(performer_id) REFERENCES performers(id) ON DELETE CASCADE
  );
`);

// Migration: Add exported_files table if it doesn't exist
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS exported_files (
      id INTEGER PRIMARY KEY,
      original_video_path TEXT NOT NULL,
      scene_id INTEGER,
      file_path TEXT NOT NULL,
      funscript_path TEXT,
      name TEXT NOT NULL,
      tags TEXT, -- JSON string of tags
      file_size INTEGER,
      duration REAL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(scene_id) REFERENCES video_scenes(id) ON DELETE SET NULL
    );
  `);
} catch (e) {
  // Table already exists
}

// Migration: Remove tags column from video_scenes if it exists and preserve funscript_path
try {
  // Check if the old table has funscript_path column
  const tableInfo = db.pragma('table_info(video_scenes)');
  const hasFunscriptPath = tableInfo.some(col => col.name === 'funscript_path');

  // Create new table without tags but with funscript_path
  db.exec(`
    CREATE TABLE IF NOT EXISTS video_scenes_new (
      id INTEGER PRIMARY KEY,
      video_path TEXT NOT NULL,
      name TEXT NOT NULL,
      start_time REAL NOT NULL,
      end_time REAL NOT NULL,
      export_path TEXT,
      funscript_path TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      exported_at DATETIME
    );
  `);

  // Copy data from old table to new table (including funscript_path if it exists)
  if (hasFunscriptPath) {
    db.exec(`
      INSERT OR IGNORE INTO video_scenes_new 
      (id, video_path, name, start_time, end_time, export_path, funscript_path, created_at, updated_at, exported_at)
      SELECT id, video_path, name, start_time, end_time, export_path, funscript_path, created_at, updated_at, exported_at
      FROM video_scenes;
    `);
  } else {
    db.exec(`
      INSERT OR IGNORE INTO video_scenes_new 
      (id, video_path, name, start_time, end_time, export_path, created_at, updated_at, exported_at)
      SELECT id, video_path, name, start_time, end_time, export_path, created_at, updated_at, exported_at
      FROM video_scenes;
    `);
  }

  // Drop old table and rename new one
  db.exec(`DROP TABLE IF EXISTS video_scenes;`);
  db.exec(`ALTER TABLE video_scenes_new RENAME TO video_scenes;`);
} catch (e) {
  // Migration already completed or table structure is correct
}

// Migration: Add original count columns if they don't exist and populate them
try {
  // Add columns if they don't exist
  db.exec(`
    ALTER TABLE performers ADD COLUMN pics_original_count INTEGER DEFAULT 0;
  `);
} catch (e) {
  // Column already exists
}

try {
  db.exec(`
    ALTER TABLE performers ADD COLUMN vids_original_count INTEGER DEFAULT 0;
  `);
} catch (e) {
  // Column already exists
}

try {
  db.exec(`
    ALTER TABLE performers ADD COLUMN funscript_vids_original_count INTEGER DEFAULT 0;
  `);
} catch (e) {
  // Column already exists
}

// Initialize original counts for existing performers who don't have them set
db.exec(`
  UPDATE performers 
  SET pics_original_count = pics_count,
      vids_original_count = vids_count,
      funscript_vids_original_count = funscript_vids_count
  WHERE pics_original_count = 0 AND vids_original_count = 0 AND funscript_vids_original_count = 0
`);

// Data repair: fix corrupted original counts where filtered > original
// This happens when the old code overwrote original counts with reduced current counts after duplicate deletion
db.exec(`
  UPDATE performers 
  SET pics_original_count = MAX(pics_original_count, pics_filtered, pics_count),
      vids_original_count = MAX(vids_original_count, vids_filtered, vids_count),
      funscript_vids_original_count = MAX(funscript_vids_original_count, funscript_vids_filtered, funscript_vids_count)
  WHERE pics_filtered > pics_original_count 
     OR vids_filtered > vids_original_count 
     OR funscript_vids_filtered > funscript_vids_original_count
`);

// Migration: Add caching columns if they don't exist
try {
  db.exec(`ALTER TABLE performers ADD COLUMN last_scan_date DATETIME;`);
} catch (e) {
  // Column already exists
}

try {
  db.exec(`ALTER TABLE performers ADD COLUMN cached_pics_path TEXT;`);
} catch (e) {
  // Column already exists
}

try {
  db.exec(`ALTER TABLE performers ADD COLUMN cached_vids_path TEXT;`);
} catch (e) {
  // Column already exists
}

try {
  db.exec(`ALTER TABLE performers ADD COLUMN cached_funscript_path TEXT;`);
} catch (e) {
  // Column already exists
}

// Migration: Add aliases column if it doesn't exist
try {
  db.exec(`ALTER TABLE performers ADD COLUMN aliases TEXT;`);
} catch (e) {
  // Column already exists
}

// Migration: Add scraped data columns if they don't exist
try {
  db.exec(`ALTER TABLE performers ADD COLUMN age INTEGER;`);
} catch (e) { }

try {
  db.exec(`ALTER TABLE performers ADD COLUMN born TEXT;`);
} catch (e) { }

try {
  db.exec(`ALTER TABLE performers ADD COLUMN birthplace TEXT;`);
} catch (e) { }

try {
  db.exec(`ALTER TABLE performers ADD COLUMN country_flag TEXT;`);
} catch (e) { }

try {
  db.exec(`ALTER TABLE performers ADD COLUMN height TEXT;`);
} catch (e) { }

try {
  db.exec(`ALTER TABLE performers ADD COLUMN weight TEXT;`);
} catch (e) { }

try {
  db.exec(`ALTER TABLE performers ADD COLUMN measurements TEXT;`);
} catch (e) { }

try {
  db.exec(`ALTER TABLE performers ADD COLUMN hair_color TEXT;`);
} catch (e) { }

try {
  db.exec(`ALTER TABLE performers ADD COLUMN eye_color TEXT;`);
} catch (e) { }

try {
  db.exec(`ALTER TABLE performers ADD COLUMN ethnicity TEXT;`);
} catch (e) { }

try {
  db.exec(`ALTER TABLE performers ADD COLUMN scraped_tags TEXT;`);
} catch (e) { }

try {
  db.exec(`ALTER TABLE performers ADD COLUMN scraped_at DATETIME;`);
} catch (e) { }

try {
  db.exec(`ALTER TABLE performers ADD COLUMN body_type TEXT;`);
} catch (e) { }

try {
  db.exec(`ALTER TABLE performers ADD COLUMN orientation TEXT;`);
} catch (e) { }

try {
  db.exec(`ALTER TABLE performers ADD COLUMN performer_rating REAL;`);
} catch (e) { }

try {
  db.exec(`ALTER TABLE performers ADD COLUMN pubic_hair TEXT;`);
} catch (e) { }

try {
  db.exec(`ALTER TABLE performers ADD COLUMN tattoos TEXT;`);
} catch (e) { }

try {
  db.exec(`ALTER TABLE performers ADD COLUMN piercings TEXT;`);
} catch (e) { }

// Add detailed measurement columns
try {
  db.exec(`ALTER TABLE performers ADD COLUMN measurements_cup TEXT;`);
} catch (e) { }

try {
  db.exec(`ALTER TABLE performers ADD COLUMN measurements_band_size TEXT;`);
} catch (e) { }

try {
  db.exec(`ALTER TABLE performers ADD COLUMN measurements_fake BOOLEAN DEFAULT 0;`);
} catch (e) { }

// Migration: Add content_type column to exported_files if it doesn't exist
try {
  db.exec(`
    ALTER TABLE exported_files ADD COLUMN content_type TEXT DEFAULT 'video';
  `);
} catch (e) {
  // Column already exists
}

// One-time migration: Update existing exported_files based on their file paths (only for NULL values)
try {
  db.exec(`
    UPDATE exported_files 
    SET content_type = CASE 
      WHEN file_path LIKE '%/funscript/%' OR file_path LIKE '%\\funscript\\%' OR 
           file_path LIKE '%/.thumbnails/scenes/funscript/%' OR file_path LIKE '%\\.thumbnails\\scenes\\funscript\\%' 
      THEN 'funscript'
      ELSE 'video'
    END
    WHERE content_type IS NULL
  `);
} catch (e) {
  // Migration already completed or error
}

// Populate file_type for existing filter_actions based on file extension
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

// Add cached path columns to content_genres if they don't exist
try {
  db.exec(`ALTER TABLE content_genres ADD COLUMN last_scan_date DATETIME`);
} catch (e) { }
try {
  db.exec(`ALTER TABLE content_genres ADD COLUMN cached_pics_path TEXT`);
} catch (e) { }
try {
  db.exec(`ALTER TABLE content_genres ADD COLUMN cached_vids_path TEXT`);
} catch (e) { }
try {
  db.exec(`ALTER TABLE content_genres ADD COLUMN cached_funscript_path TEXT`);
} catch (e) { }

// Migration: Add aliases column to performers if it doesn't exist
try {
  db.exec(`ALTER TABLE performers ADD COLUMN aliases TEXT`);
} catch (e) { }

// Migration: Add blacklist columns if they don't exist
try {
  db.exec(`ALTER TABLE performers ADD COLUMN blacklisted INTEGER DEFAULT 0`);
} catch (e) { }

try {
  db.exec(`ALTER TABLE performers ADD COLUMN blacklist_reason TEXT`);
} catch (e) { }

try {
  db.exec(`ALTER TABLE performers ADD COLUMN blacklist_date DATETIME`);
} catch (e) { }

// Migration: Add thumbnail slideshow columns
try {
  db.exec(`ALTER TABLE performers ADD COLUMN thumbnail_paths TEXT`);
} catch (e) { }

try {
  db.exec(`ALTER TABLE performers ADD COLUMN thumbnail_transition_type TEXT DEFAULT 'fade'`);
} catch (e) { }

try {
  db.exec(`ALTER TABLE performers ADD COLUMN thumbnail_transition_time REAL DEFAULT 3.0`);
} catch (e) { }

try {
  db.exec(`ALTER TABLE performers ADD COLUMN thumbnail_transition_speed REAL DEFAULT 0.5`);
} catch (e) { }

// Migration: Add leakshaven content update tracking columns
try {
  db.exec(`ALTER TABLE performers ADD COLUMN last_leakshaven_check_date DATETIME`);
} catch (e) { }

try {
  db.exec(`ALTER TABLE performers ADD COLUMN last_leakshaven_update_time TEXT`);
} catch (e) { }

try {
  db.exec(`ALTER TABLE performers ADD COLUMN leakshaven_update_acknowledged INTEGER DEFAULT 0`);
} catch (e) { }

try {
  db.exec(`ALTER TABLE performers ADD COLUMN leakshaven_check_error TEXT`);
} catch (e) { }

try {
  db.exec(`ALTER TABLE performers ADD COLUMN leakshaven_search_name TEXT`);
} catch (e) { }

// Migration: Add scraped status and working alias tracking
try {
  db.exec(`ALTER TABLE performers ADD COLUMN scraped_status TEXT`);
} catch (e) { }

try {
  db.exec(`ALTER TABLE performers ADD COLUMN leakshaven_alias TEXT`);
} catch (e) { }

// Migration: Add internal duplicate detection columns
try {
  db.exec(`ALTER TABLE performers ADD COLUMN hash_verified INTEGER DEFAULT 0`);
} catch (e) { }

try {
  db.exec(`ALTER TABLE performers ADD COLUMN latest_internal_run_id TEXT`);
} catch (e) { }

try {
  db.exec(`ALTER TABLE performers ADD COLUMN internal_duplicate_count INTEGER DEFAULT 0`);
} catch (e) { }

// Hash Deduplication Tables
db.exec(`
  CREATE TABLE IF NOT EXISTS performer_file_hashes (
    id INTEGER PRIMARY KEY,
    performer_id INTEGER NOT NULL,
    file_path TEXT NOT NULL,
    file_size INTEGER,
    mtime INTEGER,
    exact_hash TEXT,
    perceptual_hash TEXT,
    deleted_flag INTEGER DEFAULT 0,
    seen_at INTEGER DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY(performer_id) REFERENCES performers(id),
    UNIQUE(performer_id, file_path)
  );
  
  CREATE INDEX IF NOT EXISTS idx_performer_file_hashes_performer ON performer_file_hashes(performer_id);
  CREATE INDEX IF NOT EXISTS idx_performer_file_hashes_exact ON performer_file_hashes(exact_hash) WHERE exact_hash IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_performer_file_hashes_perceptual ON performer_file_hashes(perceptual_hash) WHERE perceptual_hash IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_performer_file_hashes_deleted ON performer_file_hashes(deleted_flag);
  
  CREATE TABLE IF NOT EXISTS hash_runs (
    run_id TEXT PRIMARY KEY,
    source_performer_id INTEGER NOT NULL,
    target_performer_id INTEGER NOT NULL,
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    status TEXT DEFAULT 'pending',
    metadata TEXT,
    FOREIGN KEY(source_performer_id) REFERENCES performers(id),
    FOREIGN KEY(target_performer_id) REFERENCES performers(id)
  );
  
  CREATE INDEX IF NOT EXISTS idx_hash_runs_status ON hash_runs(status);
  CREATE INDEX IF NOT EXISTS idx_hash_runs_created ON hash_runs(created_at);
  
  CREATE TABLE IF NOT EXISTS hash_run_items (
    id INTEGER PRIMARY KEY,
    run_id TEXT NOT NULL,
    file_path TEXT NOT NULL,
    file_id_ref INTEGER,
    candidate_id INTEGER,
    exact_match INTEGER DEFAULT 0,
    hamming_distance INTEGER,
    selected INTEGER DEFAULT 0,
    note TEXT,
    FOREIGN KEY(run_id) REFERENCES hash_runs(run_id) ON DELETE CASCADE,
    FOREIGN KEY(file_id_ref) REFERENCES performer_file_hashes(id),
    FOREIGN KEY(candidate_id) REFERENCES performer_file_hashes(id)
  );
  
  CREATE INDEX IF NOT EXISTS idx_hash_run_items_run ON hash_run_items(run_id);
  CREATE INDEX IF NOT EXISTS idx_hash_run_items_selected ON hash_run_items(selected);
`);

// CLIP Embeddings Table
db.exec(`
  CREATE TABLE IF NOT EXISTS content_clip_embeddings (
    id INTEGER PRIMARY KEY,
    content_item_id INTEGER NOT NULL,
    clip_embedding BLOB NOT NULL,
    model_version TEXT DEFAULT 'openai/clip-vit-large-patch14',
    generated_at INTEGER DEFAULT (strftime('%s', 'now')),
    UNIQUE(content_item_id)
  );
  
  CREATE INDEX IF NOT EXISTS idx_clip_content_item ON content_clip_embeddings(content_item_id);
  CREATE INDEX IF NOT EXISTS idx_clip_model_version ON content_clip_embeddings(model_version);
`);

// Migration: Add content_items table if it doesn't exist (for CLIP embedding reference)
db.exec(`
  CREATE TABLE IF NOT EXISTS content_items (
    id INTEGER PRIMARY KEY,
    performer_id INTEGER NOT NULL,
    file_path TEXT NOT NULL UNIQUE,
    file_type TEXT,
    file_size INTEGER,
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY(performer_id) REFERENCES performers(id)
  );
  
  CREATE INDEX IF NOT EXISTS idx_content_items_performer ON content_items(performer_id);
  CREATE INDEX IF NOT EXISTS idx_content_items_path ON content_items(file_path);
`);

// Migration: Update ml_predictions table to use content_item_id instead of file_hash_id
try {
  // Check if ml_predictions table exists and has the old schema
  const tableInfo = db.pragma('table_info(ml_predictions)');
  const hasFileHashId = tableInfo.some(col => col.name === 'file_hash_id');
  const hasContentItemId = tableInfo.some(col => col.name === 'content_item_id');

  if (hasFileHashId && !hasContentItemId) {
    console.log('Migrating ml_predictions table to new schema...');
    // Drop old ml_predictions table (data will be lost, but models can be retrained)
    db.exec('DROP TABLE IF EXISTS ml_predictions');
    console.log('Old ml_predictions table dropped. Models will need to be retrained with CLIP data.');
  }
} catch (e) {
  // Table doesn't exist yet, that's fine
}

// ML Prediction Tables
db.exec(`
  CREATE TABLE IF NOT EXISTS ml_models (
    id TEXT PRIMARY KEY,
    name TEXT,
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    training_duration_seconds INTEGER,
    training_samples INTEGER,
    training_deleted_samples INTEGER,
    training_kept_samples INTEGER,
    accuracy REAL,
    precision_score REAL,
    recall_score REAL,
    f1_score REAL,
    model_type TEXT DEFAULT 'XGBoost',
    model_file_path TEXT,
    metadata_file_path TEXT,
    excluded_performers TEXT,
    is_active INTEGER DEFAULT 0,
    status TEXT DEFAULT 'training'
  );
  
  CREATE INDEX IF NOT EXISTS idx_ml_models_active ON ml_models(is_active);
  CREATE INDEX IF NOT EXISTS idx_ml_models_created ON ml_models(created_at);
  
  CREATE TABLE IF NOT EXISTS ml_training_jobs (
    job_id TEXT PRIMARY KEY,
    model_id TEXT,
    status TEXT DEFAULT 'pending',
    progress INTEGER DEFAULT 0,
    started_at INTEGER,
    completed_at INTEGER,
    error TEXT,
    FOREIGN KEY(model_id) REFERENCES ml_models(id)
  );
  
  CREATE INDEX IF NOT EXISTS idx_ml_training_jobs_status ON ml_training_jobs(status);
  
  CREATE TABLE IF NOT EXISTS ml_predictions (
    id INTEGER PRIMARY KEY,
    model_id TEXT NOT NULL,
    content_item_id INTEGER NOT NULL,
    prediction INTEGER,
    confidence REAL,
    predicted_at INTEGER DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY(model_id) REFERENCES ml_models(id) ON DELETE CASCADE,
    FOREIGN KEY(content_item_id) REFERENCES content_items(id) ON DELETE CASCADE,
    UNIQUE(model_id, content_item_id)
  );
  
  CREATE INDEX IF NOT EXISTS idx_ml_predictions_model ON ml_predictions(model_id);
  CREATE INDEX IF NOT EXISTS idx_ml_predictions_content ON ml_predictions(content_item_id);
  CREATE INDEX IF NOT EXISTS idx_ml_predictions_confidence ON ml_predictions(confidence);
  
  CREATE TABLE IF NOT EXISTS ml_included_performers (
    performer_id INTEGER,
    model_type TEXT DEFAULT 'both', -- 'image', 'video', or 'both'
    included_at INTEGER DEFAULT (strftime('%s', 'now')),
    PRIMARY KEY(performer_id, model_type),
    FOREIGN KEY(performer_id) REFERENCES performers(id) ON DELETE CASCADE
  );
`);

// Migrate existing ml_included_performers to new schema
try {
  const existingRows = db.prepare('SELECT performer_id, included_at FROM ml_included_performers').all();
  if (existingRows.length > 0 && existingRows[0].model_type === undefined) {
    console.log('Migrating ml_included_performers to support model_type...');
    db.exec('DROP TABLE IF EXISTS ml_included_performers_old');
    db.exec('ALTER TABLE ml_included_performers RENAME TO ml_included_performers_old');
    db.exec(`
      CREATE TABLE ml_included_performers (
        performer_id INTEGER,
        model_type TEXT DEFAULT 'both',
        included_at INTEGER DEFAULT (strftime('%s', 'now')),
        PRIMARY KEY(performer_id, model_type),
        FOREIGN KEY(performer_id) REFERENCES performers(id) ON DELETE CASCADE
      )
    `);
    // Migrate old data - set all to 'both'
    db.exec(`
      INSERT INTO ml_included_performers (performer_id, model_type, included_at)
      SELECT performer_id, 'both', included_at FROM ml_included_performers_old
    `);
    db.exec('DROP TABLE ml_included_performers_old');
    console.log('Migration complete.');
  }
} catch (err) {
  // Table might not exist yet or already migrated
  console.log('ml_included_performers migration check:', err.message);
}

// Migration: Add reasons column to filter_actions if it doesn't exist
try {
  db.exec(`ALTER TABLE filter_actions ADD COLUMN reasons TEXT`);
} catch (e) {
  // Column already exists
}

// ML Batch State table - persists batch processing state across browser crashes
db.exec(`
  CREATE TABLE IF NOT EXISTS ml_batch_state (
    id INTEGER PRIMARY KEY,
    performer_id INTEGER,
    performer_name TEXT,
    batch_state TEXT, -- JSON blob of results array with keep/delete decisions
    settings TEXT, -- JSON blob of batch settings (batchSize, secureMode, etc.)
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    status TEXT DEFAULT 'in_progress', -- 'in_progress', 'completed', 'abandoned'
    UNIQUE(performer_id),
    FOREIGN KEY(performer_id) REFERENCES performers(id) ON DELETE CASCADE
  );
  
  CREATE INDEX IF NOT EXISTS idx_ml_batch_state_performer ON ml_batch_state(performer_id);
  CREATE INDEX IF NOT EXISTS idx_ml_batch_state_status ON ml_batch_state(status);
`);

// ML Settings table - global settings for batch processing
db.exec(`
  CREATE TABLE IF NOT EXISTS ml_batch_settings (
    id INTEGER PRIMARY KEY,
    key TEXT UNIQUE NOT NULL,
    value TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Encode Jobs table - queue for media optimization tasks
db.exec(`
  CREATE TABLE IF NOT EXISTS encode_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    performer_id INTEGER,
    source_path TEXT NOT NULL,
    target_format TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    priority INTEGER DEFAULT 0,
    original_size_bytes INTEGER,
    estimated_size_bytes INTEGER,
    actual_size_bytes INTEGER,
    worker_id TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    started_at TEXT,
    completed_at TEXT,
    error_message TEXT,
    FOREIGN KEY (performer_id) REFERENCES performers(id) ON DELETE CASCADE
  );
  
  CREATE INDEX IF NOT EXISTS idx_encode_jobs_status ON encode_jobs(status);
  CREATE INDEX IF NOT EXISTS idx_encode_jobs_performer ON encode_jobs(performer_id);
`);

// Encode Settings table - configuration for encoding
db.exec(`
  CREATE TABLE IF NOT EXISTS encode_settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
`);

// Insert default encode settings if not present
const defaultSettings = [
  ['video_codec', 'h265'],
  ['video_crf', '28'],
  ['video_preset', 'medium'],
  ['video_hw_accel', 'auto'],
  ['image_format', 'webp'],
  ['image_quality', '85'],
  ['keep_originals', 'true'],
  ['worker_mode', 'local'],
  ['backup_folder', '.originals']
];

const insertSetting = db.prepare(`
  INSERT OR IGNORE INTO encode_settings (key, value) VALUES (?, ?)
`);

for (const [key, value] of defaultSettings) {
  insertSetting.run(key, value);
}

module.exports = db;