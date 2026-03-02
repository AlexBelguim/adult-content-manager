const db = require('./db.js');
const path = require('path');
const fs = require('fs');

// Simulate what the gallery API does

async function getPerformerGalleryData(performerName, basePath) {
  const performer = db.prepare(`
    SELECT p.*, f.path as folder_path 
    FROM performers p 
    JOIN folders f ON p.folder_id = f.id
    WHERE p.name = ? AND f.path = ?
  `).get(performerName, basePath);
  
  if (!performer) {
    console.log(`Performer not found: ${performerName}`);
    return null;
  }
  
  const performerPath = path.join(performer.folder_path, 'after filter performer', performer.name);
  const vidsPath = path.join(performerPath, 'vids');
  
  console.log(`\n=== ${performerName} ===`);
  console.log(`Performer path: ${performerPath}`);
  console.log(`Vids path: ${vidsPath}`);
  
  if (!fs.existsSync(vidsPath)) {
    console.log('Vids path does not exist!');
    return null;
  }
  
  // Get video files
  const files = fs.readdirSync(vidsPath).filter(f => {
    const ext = path.extname(f).toLowerCase();
    return ['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm'].includes(ext);
  });
  
  console.log(`Found ${files.length} video files`);
  
  // Simulate URL generation
  console.log('\nSample URLs that would be generated:');
  files.slice(0, 3).forEach(file => {
    const filePath = path.join(vidsPath, file);
    const url = `/api/files/raw?path=${encodeURIComponent(filePath)}`;
    const thumbnailUrl = `/api/files/video-thumbnail?path=${encodeURIComponent(filePath)}`;
    
    console.log(`\nFile: ${file}`);
    console.log(`  Full path: ${filePath}`);
    console.log(`  URL length: ${url.length}`);
    console.log(`  URL: ${url.substring(0, 100)}...`);
    
    // Check for any encoding issues
    const decodedPath = decodeURIComponent(encodeURIComponent(filePath));
    if (decodedPath !== filePath) {
      console.log(`  ⚠️ ENCODING MISMATCH!`);
      console.log(`    Original: ${filePath}`);
      console.log(`    Decoded:  ${decodedPath}`);
    }
  });
  
  return files;
}

const basePath = 'Z:\\Apps\\adultManager\\media';

// Test broken performers
console.log('\n========== TESTING BROKEN PERFORMERS ==========');
getPerformerGalleryData('Senya Hardin', basePath);
getPerformerGalleryData('kennedyjaye', basePath);
getPerformerGalleryData('meriol_chan', basePath);

// Test working performer
console.log('\n\n========== TESTING WORKING PERFORMER ==========');
getPerformerGalleryData('daddysgirl222', basePath);
