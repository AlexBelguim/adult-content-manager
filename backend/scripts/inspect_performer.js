const db = require('../db');
const path = require('path');

const query = process.argv[2];

if (!query) {
    console.log('Usage: node inspect_performer.js <performer_id_or_name>');
    process.exit(1);
}

console.log(`Searching for info on: "${query}"...`);

// Try as ID first
let performer;
if (!isNaN(query)) {
    performer = db.prepare('SELECT * FROM performers WHERE id = ?').get(query);
}

// If not found by ID, search by name or alias
if (!performer) {
    performer = db.prepare('SELECT * FROM performers WHERE name LIKE ? OR aliases LIKE ?').get(`%${query}%`, `%${query}%`);
}

if (!performer) {
    console.error('Performer not found!');
    process.exit(1);
}

console.log('\n--- Performer Details ---');
for (const [key, value] of Object.entries(performer)) {
    console.log(`${key}: ${value}`);
}

console.log('\n--- Related Tags ---');
const tags = db.prepare('SELECT * FROM tags WHERE performer_id = ?').all(performer.id);
if (tags.length > 0) {
    tags.forEach(t => console.log(`- ${t.tag}`));
} else {
    console.log('No tags found.');
}

console.log('\n--- Recent Filter Actions ---');
try {
    const actions = db.prepare('SELECT * FROM filter_actions WHERE performer_id = ? ORDER BY timestamp DESC LIMIT 10').all(performer.id);
    if (actions.length > 0) {
        actions.forEach(a => console.log(`[${a.timestamp}] ${a.action} on ${path.basename(a.file_path || '')} (${a.file_type})`));
    } else {
        console.log('No recent filter actions.');
    }
} catch (e) {
    console.log('Could not fetch filter actions (table might typically be empty or different schema). Error:', e.message);
}

// Check hashed files count if table exists
try {
    const hashCount = db.prepare('SELECT COUNT(*) as count FROM performer_file_hashes WHERE performer_id = ?').get(performer.id);
    console.log(`\n--- File Hashes ---`);
    console.log(`Total hashed files: ${hashCount.count}`);
} catch (e) {
    // Table might not exist or empty
}

console.log('\n--- Persistent File Cache (DB) ---');
const fileCache = db.prepare('SELECT type, length(data) as data_len, updated_at FROM performer_file_cache WHERE performer_id = ?').all(performer.id);

if (fileCache.length === 0) {
    console.log('No persistent file cache found for this performer.');
} else {
    fileCache.forEach(cache => {
        // We get the JSON string length, roughly indicating data size
        // To get actual file count, we'd need to parse it, but let's just show existence first
        // Actually, let's parse it to be helpful
        try {
            const data = db.prepare('SELECT data FROM performer_file_cache WHERE performer_id = ? AND type = ?').get(performer.id, cache.type).data;
            const files = JSON.parse(data);
            console.log(`[${cache.type}] Count: ${files.length}, Updated: ${cache.updated_at}`);
            if (files.length > 0) {
                console.log(`  First file: ${files[0].path}`);
            }
        } catch (e) {
            console.log(`[${cache.type}] Error parsing data: ${e.message}`);
        }
    });
}

console.log('\n--- End ---');
