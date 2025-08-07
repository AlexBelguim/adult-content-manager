const sqlite = require('better-sqlite3');
const config = require('./config');

function getEffectiveDatabasePath() {
  // Use environment variable if set, otherwise use config default
  if (process.env.DB_PATH) {
    return process.env.DB_PATH;
  }
  return config.dbPath;
}

const effectiveDbPath = getEffectiveDatabasePath();
console.log('Using database path:', effectiveDbPath);
const db = sqlite(effectiveDbPath);

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
    FOREIGN KEY(folder_id) REFERENCES folders(id)
  );
  CREATE TABLE IF NOT EXISTS content_genres (
    id INTEGER PRIMARY KEY,
    name TEXT,
    folder_id INTEGER,
    pics_count INTEGER DEFAULT 0,
    vids_count INTEGER DEFAULT 0,
    total_size_gb REAL DEFAULT 0,
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
  CREATE TABLE IF NOT EXISTS app_settings (
    id INTEGER PRIMARY KEY,
    key TEXT UNIQUE,
    value TEXT
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

module.exports = db;