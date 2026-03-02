const db = require('./db.js');
const fs = require('fs');
const path = require('path');

// Compare broken performers vs working ones
const brokenNames = ['Senya Hardin', 'kennedyjaye', 'meriol_chan'];
const workingNames = ['daddysgirl222', 'Amouranth', 'Belle Delphine']; // add some known working ones

console.log('=== COMPARING BROKEN VS WORKING PERFORMERS ===\n');

// Get all performers we want to check
const allPerformers = db.prepare(`
  SELECT p.*, f.path as folder_path 
  FROM performers p 
  JOIN folders f ON p.folder_id = f.id
  WHERE p.name IN ('Senya Hardin', 'kennedyjaye', 'meriol_chan', 'daddysgirl222')
`).all();

for (const p of allPerformers) {
  const isBroken = brokenNames.includes(p.name);
  console.log(`\n${'='.repeat(60)}`);
  console.log(`${isBroken ? '❌ BROKEN' : '✅ WORKING'}: ${p.name} (ID: ${p.id})`);
  console.log(`${'='.repeat(60)}`);
  
  // Check for special characters in name
  const hasSpecialChars = /[^\x00-\x7F]/.test(p.name);
  const hasSpaces = p.name.includes(' ');
  const hasUnderscores = p.name.includes('_');
  console.log(`Name analysis: hasSpecialChars=${hasSpecialChars}, hasSpaces=${hasSpaces}, hasUnderscores=${hasUnderscores}`);
  
  // Check paths
  const afterPath = path.join(p.folder_path, 'after filter performer', p.name);
  const vidsPath = path.join(afterPath, 'vids');
  const picsPath = path.join(afterPath, 'pics');
  
  console.log(`\nExpected paths:`);
  console.log(`  After path: ${afterPath}`);
  console.log(`  Vids path: ${vidsPath}`);
  console.log(`  Pics path: ${picsPath}`);
  
  // Check if paths exist
  console.log(`\nPath existence:`);
  console.log(`  After folder exists: ${fs.existsSync(afterPath)}`);
  console.log(`  Vids folder exists: ${fs.existsSync(vidsPath)}`);
  console.log(`  Pics folder exists: ${fs.existsSync(picsPath)}`);
  
  // Check cached paths in DB
  console.log(`\nCached paths in DB:`);
  console.log(`  cached_vids_path: ${p.cached_vids_path}`);
  console.log(`  cached_pics_path: ${p.cached_pics_path}`);
  
  // Check if cached paths match expected paths
  if (p.cached_vids_path) {
    const cacheMatchesExpected = p.cached_vids_path === vidsPath;
    console.log(`  Vids cache matches expected: ${cacheMatchesExpected}`);
    if (!cacheMatchesExpected) {
      console.log(`    Expected: ${vidsPath}`);
      console.log(`    Got:      ${p.cached_vids_path}`);
    }
  }
  
  // List actual video files
  if (fs.existsSync(vidsPath)) {
    try {
      const files = fs.readdirSync(vidsPath).filter(f => !f.startsWith('.'));
      console.log(`\nVideo files (${files.length} total):`);
      files.slice(0, 5).forEach(f => {
        const fullPath = path.join(vidsPath, f);
        // Check for encoding issues
        const hasEncodingIssue = /[^\x00-\x7F]/.test(f);
        console.log(`  ${hasEncodingIssue ? '⚠️' : '✓'} ${f}`);
      });
    } catch (e) {
      console.log(`  Error listing files: ${e.message}`);
    }
  }
  
  // Check content_items table
  const contentCount = db.prepare('SELECT COUNT(*) as count FROM content_items WHERE performer_id = ?').get(p.id);
  console.log(`\nContent items in DB: ${contentCount.count}`);
  
  // Check file_tags for this performer's files
  const taggedFiles = db.prepare(`
    SELECT COUNT(*) as count FROM file_tags 
    WHERE file_path LIKE ?
  `).get(`%${p.name}%`);
  console.log(`Tagged files: ${taggedFiles.count}`);
  
  // Check file_ratings
  const ratedFiles = db.prepare(`
    SELECT COUNT(*) as count FROM file_ratings 
    WHERE file_path LIKE ?
  `).get(`%${p.name}%`);
  console.log(`Rated files: ${ratedFiles.count}`);
  
  // Check scenes
  const scenes = db.prepare(`
    SELECT COUNT(*) as count FROM video_scenes 
    WHERE video_path LIKE ?
  `).get(`%${p.name}%`);
  console.log(`Video scenes: ${scenes.count}`);
}

// Also check for any database entries with potential encoding issues
console.log('\n\n=== CHECKING FOR ENCODING ISSUES IN DB ===');
const allPaths = db.prepare(`
  SELECT DISTINCT file_path FROM content_items 
  WHERE performer_id IN (SELECT id FROM performers WHERE name IN ('Senya Hardin', 'kennedyjaye', 'meriol_chan'))
  LIMIT 20
`).all();

for (const row of allPaths) {
  const hasNonAscii = /[^\x00-\x7F]/.test(row.file_path);
  if (hasNonAscii) {
    console.log(`⚠️ Non-ASCII path: ${row.file_path}`);
  }
}
