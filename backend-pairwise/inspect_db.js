const sqlite = require('better-sqlite3');
const path = require('path');
const config = require('./config');

const mainDbPath = path.join(config.mainAppBasePath, 'backend', 'app.db');
console.log('Connecting to:', mainDbPath);

try {
    const db = sqlite(mainDbPath, { readonly: true });

    // List tables
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    console.log('Tables:', tables.map(t => t.name));

    // Check performers table
    if (tables.find(t => t.name === 'performers')) {
        const columns = db.prepare("PRAGMA table_info(performers)").all();
        console.log('Performers Schema:', columns);

        const sample = db.prepare("SELECT * FROM performers LIMIT 1").get();
        console.log('Sample Performer:', sample);
    }

} catch (err) {
    console.error('Error:', err);
}
