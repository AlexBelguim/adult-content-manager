// Test video thumbnail generation for broken vs working performers
const path = require('path');
const fs = require('fs-extra');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const crypto = require('crypto');

const basePath = 'Z:\\Apps\\adultManager\\media\\after filter performer';

const testVideos = [
  // Broken performers
  { performer: 'meriol_chan', file: 'HD3 (1).mov' },
  { performer: 'meriol_chan', file: 'HD3 (2).mp4' },
  { performer: 'kennedyjaye', file: 'FJT (24).mp4' },
  { performer: 'Senya Hardin', file: '3BU (6).mp4' },
  // Working performer
  { performer: 'daddysgirl222', file: 'RAV (12).mp4' },
  { performer: 'daddysgirl222', file: 'RAV (18).mp4' },
];

async function testThumbnailGeneration(performer, file) {
  const filePath = path.join(basePath, performer, 'vids', file);
  
  console.log(`\n=== Testing: ${performer}/${file} ===`);
  console.log(`Path: ${filePath}`);
  
  // Check if file exists
  if (!await fs.pathExists(filePath)) {
    console.log('❌ File does not exist!');
    return;
  }
  
  const stats = await fs.stat(filePath);
  console.log(`Size: ${(stats.size / 1024 / 1024).toFixed(1)} MB`);
  
  // Check for existing thumbnail cache
  const normalizedPath = path.normalize(filePath);
  const parts = normalizedPath.split(path.sep);
  const vidsIdx = parts.map(p => p.toLowerCase()).lastIndexOf('vids');
  let thumbRoot = vidsIdx !== -1 
    ? path.join(parts.slice(0, vidsIdx + 1).join(path.sep), '.thumbnails')
    : path.join(path.dirname(normalizedPath), '.thumbnails');
  
  const thumbDir = path.join(thumbRoot, '.cache');
  const cacheKey = crypto.createHash('md5').update(normalizedPath).digest('hex');
  const thumbPath = path.join(thumbDir, `${cacheKey}.jpg`);
  
  console.log(`Cache path: ${thumbPath}`);
  console.log(`Cache exists: ${await fs.pathExists(thumbPath)}`);
  
  // If cache exists, check its size
  if (await fs.pathExists(thumbPath)) {
    const thumbStats = await fs.stat(thumbPath);
    console.log(`Cache size: ${thumbStats.size} bytes`);
    if (thumbStats.size === 0) {
      console.log('⚠️ Cache file is EMPTY!');
    }
    return;
  }
  
  // Try to generate thumbnail with ffmpeg (with timeout)
  console.log('Attempting to generate thumbnail with ffmpeg...');
  
  const tmpThumb = path.join(require('os').tmpdir(), `test_thumb_${Date.now()}.jpg`);
  
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        ffmpeg.kill();
        reject(new Error('Timeout after 10 seconds'));
      }, 10000);
      
      const ffmpeg = spawn(ffmpegPath, [
        '-i', filePath,
        '-ss', '00:00:05',  // 5 seconds in
        '-vframes', '1',
        '-vf', 'scale=500:400:force_original_aspect_ratio=increase,crop=500:400',
        '-y',
        tmpThumb
      ]);
      
      let stderr = '';
      ffmpeg.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      
      ffmpeg.on('close', (code) => {
        clearTimeout(timeout);
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`FFmpeg exited with code ${code}\n${stderr.slice(-500)}`));
        }
      });
      
      ffmpeg.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
    
    if (await fs.pathExists(tmpThumb)) {
      const thumbStats = await fs.stat(tmpThumb);
      console.log(`✅ Thumbnail generated successfully! Size: ${thumbStats.size} bytes`);
      await fs.remove(tmpThumb);
    } else {
      console.log('❌ Thumbnail file was not created');
    }
  } catch (err) {
    console.log(`❌ FFmpeg error: ${err.message}`);
  }
}

(async () => {
  for (const test of testVideos) {
    await testThumbnailGeneration(test.performer, test.file);
  }
})();
