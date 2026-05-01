/**
 * Schema Migration Runner
 * 
 * Tracks applied migrations in a `schema_migrations` table and runs
 * any unapplied migrations in order.  Each migration file exports
 * { version, name, up(db) }.
 *
 * Usage:
 *   const { runMigrations } = require('./migrate');
 *   runMigrations(db);   // called once on startup from db.js
 */

const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

/**
 * Ensure the schema_migrations tracking table exists.
 */
function ensureTrackingTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name    TEXT NOT NULL,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

/**
 * Return the highest migration version that has been applied (0 if none).
 */
function getCurrentVersion(db) {
  const row = db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get();
  return (row && row.v) || 0;
}

/**
 * Discover migration files, sorted by version number.
 * Each file must export { version: Number, name: String, up: Function }.
 */
function discoverMigrations() {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    console.log('📂 No migrations directory found – skipping.');
    return [];
  }

  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.js'))
    .sort(); // lexicographic sort works because filenames are zero-padded (001_, 002_, …)

  return files.map(f => {
    const migration = require(path.join(MIGRATIONS_DIR, f));
    if (!migration.version || !migration.name || !migration.up) {
      throw new Error(`Migration file ${f} is missing required exports (version, name, up).`);
    }
    return { ...migration, file: f };
  });
}

/**
 * Run all pending migrations inside a transaction (per migration).
 */
function runMigrations(db) {
  ensureTrackingTable(db);

  const currentVersion = getCurrentVersion(db);
  const allMigrations = discoverMigrations();

  const pending = allMigrations.filter(m => m.version > currentVersion);

  if (pending.length === 0) {
    console.log(`✅ Database schema is up-to-date (version ${currentVersion}).`);
    return;
  }

  console.log(`🔄 ${pending.length} migration(s) to apply (current version: ${currentVersion})…`);

  for (const migration of pending) {
    console.log(`  ▸ Applying ${migration.file} — "${migration.name}" …`);

    const runOne = db.transaction(() => {
      migration.up(db);
      db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)').run(
        migration.version,
        migration.name
      );
    });

    try {
      runOne();
      console.log(`    ✔ v${migration.version} applied.`);
    } catch (err) {
      console.error(`    ✖ Migration v${migration.version} FAILED:`, err.message);
      throw err; // Stop on first failure – don't apply later migrations
    }
  }

  const newVersion = getCurrentVersion(db);
  console.log(`✅ All migrations applied. Schema is now at version ${newVersion}.`);
}

module.exports = { runMigrations };
