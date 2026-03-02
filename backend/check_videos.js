const db = require('./db.js');
const fs = require('fs');

// Check video content items for broken performers
const items = db.prepare(`
  SELECT * FROM content_items 
  WHERE performer_id IN (60, 77, 100) 
  AND file_type = 'video' 
  LIMIT 10
`).all();

console.log('=== VIDEO CONTENT ITEMS FOR BROKEN PERFORMERS ===');
for (const item of items) {
  const exists = fs.existsSync(item.file_path);
  console.log(`\nID: ${item.id}, Performer: ${item.performer_id}`);
  console.log(`  Path: ${item.file_path}`);
  console.log(`  Exists: ${exists}`);
  console.log(`  Size in DB: ${item.file_size}`);
  if (exists) {
    const stats = fs.statSync(item.file_path);
    console.log(`  Actual size: ${stats.size}`);
  }
}

// Check if there are any orphaned or invalid paths
console.log('\n\n=== CHECKING FOR INVALID VIDEO PATHS ===');
const allVideoItems = db.prepare(`
  SELECT ci.*, p.name as performer_name 
  FROM content_items ci
  JOIN performers p ON ci.performer_id = p.id
  WHERE ci.performer_id IN (60, 77, 100) 
  AND ci.file_type = 'video'
`).all();

let invalidCount = 0;
for (const item of allVideoItems) {
  const exists = fs.existsSync(item.file_path);
  if (!exists) {
    invalidCount++;
    console.log(`❌ Missing: ${item.file_path} (${item.performer_name})`);
  }
}
console.log(`\nTotal invalid video paths: ${invalidCount}/${allVideoItems.length}`);

// Check for duplicate paths
console.log('\n\n=== CHECKING FOR DUPLICATE VIDEO PATHS ===');
const duplicates = db.prepare(`
  SELECT file_path, COUNT(*) as count 
  FROM content_items 
  WHERE performer_id IN (60, 77, 100) 
  AND file_type = 'video'
  GROUP BY file_path 
  HAVING count > 1
`).all();

if (duplicates.length > 0) {
  console.log('Found duplicates:');
  for (const dup of duplicates) {
    console.log(`  ${dup.file_path}: ${dup.count} entries`);
  }
} else {
  console.log('No duplicate video paths found.');
}
