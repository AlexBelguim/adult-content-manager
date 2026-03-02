const db = require('./db.js');

// Check all performers in the "after" folder to see which ones have content_items and cached paths
const results = db.prepare(`
  SELECT 
    p.id, 
    p.name, 
    p.moved_to_after, 
    p.cached_vids_path,
    p.cached_pics_path,
    (SELECT COUNT(*) FROM content_items WHERE performer_id = p.id) as content_count
  FROM performers p 
  WHERE p.moved_to_after = 1 
  ORDER BY content_count DESC
`).all();

console.log('=== ALL PERFORMERS IN "AFTER" FOLDER ===\n');
console.log('Performers WITH content_items (potential issue):');
console.log('------------------------------------------------');
let withContent = 0;
let withoutContent = 0;

for (const r of results) {
  if (r.content_count > 0) {
    withContent++;
    console.log(`❌ ${r.name}: ${r.content_count} items, cached_vids: ${r.cached_vids_path ? 'SET' : 'NULL'}`);
  }
}

console.log('\n\nPerformers WITHOUT content_items (should work):');
console.log('------------------------------------------------');
for (const r of results) {
  if (r.content_count === 0) {
    withoutContent++;
    console.log(`✅ ${r.name}: ${r.content_count} items, cached_vids: ${r.cached_vids_path ? 'SET' : 'NULL'}`);
  }
}

console.log(`\n\nSUMMARY:`);
console.log(`- Total performers in "after": ${results.length}`);
console.log(`- With content_items: ${withContent}`);
console.log(`- Without content_items: ${withoutContent}`);
