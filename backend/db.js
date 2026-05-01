/**
 * Database Connection & Schema Management
 *
 * Connects to SQLite, enables pragmas, and runs versioned migrations.
 * All schema definitions live in backend/migrations/*.js
 */
const sqlite = require('better-sqlite3');
const config = require('./config');
const { runMigrations } = require('./migrate');

const db = sqlite(config.dbPath);

// Enable foreign keys and WAL mode for concurrency
db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');

// Run all pending migrations
runMigrations(db);

module.exports = db;