// Check which videos are missing thumbnail cache
const path = require('path');
const fs = require('fs-extra');
const crypto = require('crypto');

const basePath = 'Z:\\Apps\\adultManager\\media\\after filter performer';

const performers = ['meriol_chan', 'kennedyjaye', 'Senya Hardin', 'daddysgirl222'];

async function checkThumbnailCache(performer) {
  const vidsPath = path.join(basePath, performer, 'vids');
  
  console.log(`\n=== ${performer} ===`);
  
  if (!await fs.pathExists(vidsPath)) {
    console.log('Vids path does not exist');
    return;
  }
  
  const files = (await fs.readdir(vidsPath)).filter(f => {
    const ext = path.extname(f).toLowerCase();
    return ['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm'].includes(ext);
  });
  
  let cached = 0;
  let missing = 0;
  const missingFiles = [];
  
  for (const file of files) {
    const filePath = path.join(vidsPath, file);
    const normalizedPath = path.normalize(filePath);
    
    // Find thumbnail cache path
    const parts = normalizedPath.split(path.sep);
    const vidsIdx = parts.map(p => p.toLowerCase()).lastIndexOf('vids');
    const thumbRoot = vidsIdx !== -1 
      ? path.join(parts.slice(0, vidsIdx + 1).join(path.sep), '.thumbnails')
      : path.join(path.dirname(normalizedPath), '.thumbnails');
    
    const thumbDir = path.join(thumbRoot, '.cache');
    const cacheKey = crypto.createHash('md5').update(normalizedPath).digest('hex');
    const thumbPath = path.join(thumbDir, `${cacheKey}.jpg`);
    
    if (await fs.pathExists(thumbPath)) {
      const stats = await fs.stat(thumbPath);
      if (stats.size > 0) {
        cached++;
      } else {
        missing++;
        missingFiles.push(file + ' (empty cache)');
      }
    } else {
      missing++;
      missingFiles.push(file);
    }
  }
  
  console.log(`Total videos: ${files.length}`);
  console.log(`Cached thumbnails: ${cached}`);
  console.log(`Missing thumbnails: ${missing}`);
  
  if (missingFiles.length > 0) {
    console.log('Missing files:');
    missingFiles.forEach(f => console.log(`  - ${f}`));
  }
}

(async () => {
  for (const performer of performers) {
    await checkThumbnailCache(performer);
  }
})();
