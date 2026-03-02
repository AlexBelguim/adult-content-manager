const db = require('./db.js');
const fs = require('fs');
const path = require('path');

// Deep comparison of broken vs working performers
const brokenNames = ['Senya Hardin', 'kennedyjaye', 'meriol_chan'];
const workingWithContent = ['zzzsunvi', 'nacrevictoire'];
const workingWithoutContent = ['daddysgirl222'];

const allNames = [...brokenNames, ...workingWithContent, ...workingWithoutContent];

console.log('=== DEEP COMPARISON OF PERFORMERS ===\n');

for (const name of allNames) {
  const performer = db.prepare(`
    SELECT p.*, f.path as folder_path 
    FROM performers p 
    JOIN folders f ON p.folder_id = f.id
    WHERE p.name = ?
  `).get(name);
  
  if (!performer) {
    console.log(`${name}: NOT FOUND`);
    continue;
  }
  
  const isBroken = brokenNames.includes(name);
  const status = isBroken ? '❌ BROKEN' : '✅ WORKING';
  
  console.log(`\n${'='.repeat(60)}`);
  console.log(`${status}: ${name} (ID: ${performer.id})`);
  console.log(`${'='.repeat(60)}`);
  
  // Get counts from various tables
  const contentItems = db.prepare('SELECT COUNT(*) as count FROM content_items WHERE performer_id = ?').get(performer.id);
  const scenes = db.prepare(`SELECT COUNT(*) as count FROM video_scenes WHERE video_path LIKE ?`).get(`%${name}%`);
  const tags = db.prepare(`SELECT COUNT(*) as count FROM file_tags WHERE file_path LIKE ?`).get(`%${name}%`);
  const ratings = db.prepare(`SELECT COUNT(*) as count FROM file_ratings WHERE file_path LIKE ?`).get(`%${name}%`);
  // Skip embeddings check as table may not exist
  
  console.log(`\nDatabase entries:`);
  console.log(`  content_items: ${contentItems.count}`);
  console.log(`  video_scenes: ${scenes.count}`);
  console.log(`  file_tags: ${tags.count}`);
  console.log(`  file_ratings: ${ratings.count}`);
  
  console.log(`\nCached paths:`);
  console.log(`  cached_vids_path: ${performer.cached_vids_path || 'NULL'}`);
  console.log(`  cached_pics_path: ${performer.cached_pics_path || 'NULL'}`);
  console.log(`  cached_funscript_path: ${performer.cached_funscript_path || 'NULL'}`);
  
  console.log(`\nPerformer stats:`);
  console.log(`  vids_count: ${performer.vids_count}`);
  console.log(`  pics_count: ${performer.pics_count}`);
  console.log(`  funscript_vids_count: ${performer.funscript_vids_count}`);
  console.log(`  last_scan_date: ${performer.last_scan_date || 'NULL'}`);
  
  // Check if there are any scenes with potentially problematic data
  const scenesList = db.prepare(`SELECT * FROM video_scenes WHERE video_path LIKE ? LIMIT 5`).all(`%${name}%`);
  if (scenesList.length > 0) {
    console.log(`\nSample scenes:`);
    for (const scene of scenesList) {
      console.log(`  Scene ${scene.id}: ${scene.name}, ${scene.start_time}-${scene.end_time}s`);
      console.log(`    video_path: ${scene.video_path}`);
      if (scene.funscript_path) {
        console.log(`    funscript_path: ${scene.funscript_path}`);
      }
    }
  }
}

// Check for any data that might be causing issues
console.log('\n\n=== CHECKING FOR PROBLEMATIC DATA ===\n');

// Check if any scenes have invalid paths
console.log('Scenes with non-existent video files:');
const allScenes = db.prepare(`SELECT * FROM video_scenes WHERE video_path LIKE '%after filter performer%'`).all();
for (const scene of allScenes) {
  if (!fs.existsSync(scene.video_path)) {
    console.log(`  ❌ Scene ${scene.id}: ${scene.video_path}`);
  }
}

// Check for any NULL or empty values that might cause issues
console.log('\nPerformers with potential data issues:');
const problemPerformers = db.prepare(`
  SELECT name, id, 
    CASE WHEN cached_vids_path IS NOT NULL AND cached_vids_path != '' THEN 1 ELSE 0 END as has_cached_vids
  FROM performers 
  WHERE moved_to_after = 1
`).all();

for (const p of problemPerformers) {
  const vidsPath = `Z:\\Apps\\adultManager\\media\\after filter performer\\${p.name}\\vids`;
  const pathExists = fs.existsSync(vidsPath);
  if (p.has_cached_vids && !pathExists) {
    console.log(`  ⚠️ ${p.name}: has cached_vids_path but vids folder doesn't exist`);
  }
}
