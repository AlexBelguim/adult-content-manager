const sqlite = require('better-sqlite3');
const path = require('path');
const config = require('../config');

// Connect to DB
const db = sqlite(config.dbPath);

console.log('Checking performer_file_cache...');

// Check total count
const count = db.prepare('SELECT COUNT(*) as count FROM performer_file_cache').get();
console.log(`Total cache entries: ${count.count}`);

if (count.count > 0) {
    // Get a sample
    const row = db.prepare('SELECT * FROM performer_file_cache LIMIT 1').get();
    console.log(`Sample Entry: Performer ID ${row.performer_id}, Type: ${row.type}`);

    try {
        const files = JSON.parse(row.data);
        console.log(`Contains ${files.length} files.`);
        if (files.length > 0) {
            console.log('First file structure:', files[0]);

            if (files[0].size !== undefined && files[0].modified !== undefined) {
                console.log('SUCCESS: Cache contains size and modified stats!');
            } else {
                console.log('WARNING: Cache is missing stats (likely from old scan logic).');
                console.log('Use "Rescan Files" or visit the gallery to update.');
            }
        }
    } catch (e) {
        console.error('Error parsing JSON:', e.message);
    }
} else {
    console.log('Cache is empty. Please visit a gallery page or use "Rescan Files" to populate it.');
}
