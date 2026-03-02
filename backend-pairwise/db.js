const sqlite = require('better-sqlite3');
const config = require('./config');
const db = sqlite(config.dbPath);

// Enable WAL mode for better concurrency
db.pragma('journal_mode = WAL');

// Schema
db.exec(`
  -- Labeled pairs (winner/loser from pairwise comparisons)
  CREATE TABLE IF NOT EXISTS pairs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    winner TEXT NOT NULL,
    loser TEXT NOT NULL,
    type TEXT DEFAULT 'mixed',
    performer TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Image scores (running averages from comparisons)
  CREATE TABLE IF NOT EXISTS image_scores (
    path TEXT PRIMARY KEY,
    score REAL DEFAULT 50,
    comparisons INTEGER DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Inference results cache per performer
  CREATE TABLE IF NOT EXISTS inference_results (
    performer TEXT PRIMARY KEY,
    data TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Selected performers for current labeling session
  CREATE TABLE IF NOT EXISTS selected_performers (
    name TEXT PRIMARY KEY
  );

  -- Settings (server URL, thresholds, etc.)
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  -- Create indexes for common queries
  CREATE INDEX IF NOT EXISTS idx_pairs_performer ON pairs(performer);
  CREATE INDEX IF NOT EXISTS idx_pairs_created ON pairs(created_at);
  CREATE INDEX IF NOT EXISTS idx_pairs_created ON pairs(created_at);

  -- Link to Main App DB
  CREATE TABLE IF NOT EXISTS performer_links (
    main_id INTEGER PRIMARY KEY,
    name TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Helper functions
const queries = {
  // Pairs
  insertPair: db.prepare(`
    INSERT INTO pairs (winner, loser, type, performer) VALUES (?, ?, ?, ?)
  `),
  getAllPairs: db.prepare(`SELECT * FROM pairs ORDER BY created_at DESC`),
  getPairCount: db.prepare(`SELECT COUNT(*) as count FROM pairs`),
  getPairsByType: db.prepare(`SELECT COUNT(*) as count FROM pairs WHERE type = ?`),

  // Scores
  getScore: db.prepare(`SELECT * FROM image_scores WHERE path = ?`),
  upsertScore: db.prepare(`
    INSERT INTO image_scores (path, score, comparisons, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(path) DO UPDATE SET
      score = excluded.score,
      comparisons = excluded.comparisons,
      updated_at = CURRENT_TIMESTAMP
  `),
  getAllScores: db.prepare(`SELECT * FROM image_scores ORDER BY score DESC`),
  insertScoreIgnore: db.prepare(`
    INSERT OR IGNORE INTO image_scores (path, score, comparisons, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
  `),

  // Inference results
  getInferenceResult: db.prepare(`SELECT * FROM inference_results WHERE performer = ?`),
  upsertInferenceResult: db.prepare(`
    INSERT INTO inference_results (performer, data, timestamp)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(performer) DO UPDATE SET
      data = excluded.data,
      timestamp = CURRENT_TIMESTAMP
  `),

  // Selected performers
  getSelectedPerformers: db.prepare(`SELECT name FROM selected_performers`),
  clearSelectedPerformers: db.prepare(`DELETE FROM selected_performers`),
  insertSelectedPerformer: db.prepare(`INSERT OR IGNORE INTO selected_performers (name) VALUES (?)`),

  // Settings
  getSetting: db.prepare(`SELECT value FROM settings WHERE key = ?`),
  setSetting: db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `),

  // Performer Links
  getLink: db.prepare('SELECT * FROM performer_links WHERE main_id = ?'),
  upsertLink: db.prepare(`
    INSERT INTO performer_links (main_id, name) VALUES (?, ?)
    ON CONFLICT(main_id) DO UPDATE SET name = excluded.name, updated_at = CURRENT_TIMESTAMP
  `),
  getAllLinks: db.prepare('SELECT * FROM performer_links'),
};

module.exports = { db, queries };
