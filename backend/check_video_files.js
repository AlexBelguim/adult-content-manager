const db = require('./db.js');
const fs = require('fs');
const path = require('path');

// Check video files for potential issues
const brokenPerformers = ['Senya Hardin', 'kennedyjaye', 'meriol_chan'];
const basePath = 'Z:\\Apps\\adultManager\\media';

console.log('=== CHECKING VIDEO FILES FOR POTENTIAL ISSUES ===\n');

for (const name of brokenPerformers) {
  const vidsPath = path.join(basePath, 'after filter performer', name, 'vids');
  
  console.log(`\n${name}:`);
  console.log(`Path: ${vidsPath}`);
  
  if (!fs.existsSync(vidsPath)) {
    console.log('  ❌ Path does not exist!');
    continue;
  }
  
  const files = fs.readdirSync(vidsPath).filter(f => {
    const ext = path.extname(f).toLowerCase();
    return ['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm'].includes(ext);
  });
  
  console.log(`  Total videos: ${files.length}`);
  
  for (const file of files) {
    const fullPath = path.join(vidsPath, file);
    try {
      const stats = fs.statSync(fullPath);
      const sizeGB = (stats.size / (1024 * 1024 * 1024)).toFixed(3);
      const sizeMB = (stats.size / (1024 * 1024)).toFixed(1);
      
      // Check for potential issues
      const issues = [];
      if (stats.size === 0) issues.push('EMPTY FILE');
      if (stats.size > 5 * 1024 * 1024 * 1024) issues.push('VERY LARGE (>5GB)');
      if (file.includes('(') && file.includes(')')) {
        // Check for special characters that might cause URL issues
      }
      
      const issueStr = issues.length > 0 ? ` ⚠️ ${issues.join(', ')}` : '';
      console.log(`    ${file}: ${sizeMB}MB${issueStr}`);
    } catch (e) {
      console.log(`    ${file}: ❌ ERROR: ${e.message}`);
    }
  }
}

// Also check for any files with unusual characters
console.log('\n\n=== CHECKING FOR UNUSUAL FILENAMES ===');
for (const name of brokenPerformers) {
  const vidsPath = path.join(basePath, 'after filter performer', name, 'vids');
  if (!fs.existsSync(vidsPath)) continue;
  
  const files = fs.readdirSync(vidsPath);
  for (const file of files) {
    // Check for non-ASCII characters
    if (/[^\x00-\x7F]/.test(file)) {
      console.log(`⚠️ Non-ASCII in filename: ${name}/${file}`);
    }
    // Check for very long filenames
    if (file.length > 200) {
      console.log(`⚠️ Very long filename (${file.length} chars): ${name}/${file}`);
    }
  }
}
