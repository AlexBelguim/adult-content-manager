

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs-extra');
const sharp = require('sharp');
const ffmpegPath = require('ffmpeg-static');
const { spawn } = require('child_process');
const os = require('os');

// Serve funscript thumbnails (placeholder, but cached in .thumbnails)
router.get('/funscript-thumbnail', async (req, res) => {
  const { path: filePath } = req.query;
  if (!filePath) {
    return res.status(400).send({ error: 'File path is required' });
  }
  try {
    if (!await fs.pathExists(filePath)) {
      return res.status(404).send({ error: 'File not found' });
    }
    const ext = path.extname(filePath).toLowerCase();
    const isFunscript = ['.funscript', '.fs'].includes(ext);
    if (!isFunscript) {
      return res.status(400).send({ error: 'File is not a funscript' });
    }
    // --- Caching logic: .thumbnails at root of genre folder ---
    // Find genre root (assume /content/GENRE/ structure)
    const parts = filePath.split(path.sep);
    const contentIdx = parts.findIndex(p => p.toLowerCase() === 'content');
    let genreRoot = null;
    if (contentIdx !== -1 && parts.length > contentIdx + 1) {
      genreRoot = parts.slice(0, contentIdx + 2).join(path.sep);
    } else {
      // fallback: use parent of vids/pics
      genreRoot = path.dirname(path.dirname(filePath));
    }
    const baseName = path.basename(filePath, ext);
    const thumbDir = path.join(genreRoot, '.thumbnails');
    const thumbPath = path.join(thumbDir, `${baseName}.jpg`);
    // Serve cached thumbnail if exists
    if (await fs.pathExists(thumbPath)) {
      res.set('Content-Type', 'image/jpeg');
      res.set('Cache-Control', 'public, max-age=86400');
      res.set('Access-Control-Allow-Origin', '*');
      res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.set('Access-Control-Allow-Headers', 'Content-Type');
      return res.sendFile(thumbPath);
    }
    // If not cached, generate and save placeholder
    await fs.ensureDir(thumbDir);
    const filename = path.basename(filePath);
    const placeholder = await sharp({
      create: {
        width: 500,
        height: 400,
        channels: 4,
        background: { r: 30, g: 30, b: 60, alpha: 1 }
      }
    })
    .composite([
      {
        input: Buffer.from(`
          <svg width="500" height="400" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="grad1" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" style="stop-color:#5e35b1;stop-opacity:1" />
                <stop offset="100%" style="stop-color:#1976d2;stop-opacity:1" />
              </linearGradient>
              <filter id="shadow">
                <feDropShadow dx="2" dy="2" stdDeviation="4" flood-color="black" flood-opacity="0.5"/>
              </filter>
            </defs>
            <rect width="500" height="400" fill="url(#grad1)" rx="12"/>
            <!-- Large centered funscript icon -->
            <circle cx="250" cy="200" r="50" fill="rgba(255,255,255,0.95)" filter="url(#shadow)"/>
            <text x="250" y="215" font-family="Arial, sans-serif" font-size="38" font-weight="bold" fill="#5e35b1" text-anchor="middle">FS</text>
            <!-- Funscript label at top -->
            <rect x="20" y="20" width="460" height="35" fill="rgba(0,0,0,0.8)" rx="17"/>
            <text x="250" y="44" font-family="Arial, sans-serif" font-size="18" font-weight="bold" fill="white" text-anchor="middle">FUNSCRIPT</text>
            <!-- File name at bottom -->
            <rect x="20" y="345" width="460" height="35" fill="rgba(0,0,0,0.8)" rx="17"/>
            <text x="250" y="369" font-family="Arial, sans-serif" font-size="14" fill="rgba(255,255,255,0.9)" text-anchor="middle">${filename.length > 60 ? filename.substring(0, 57) + '...' : filename}</text>
          </svg>
        `),
        top: 0,
        left: 0
      }
    ])
    .jpeg({ quality: 90 })
    .toBuffer();
    await fs.writeFile(thumbPath, placeholder);
    res.set('Content-Type', 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=86400');
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    res.send(placeholder);
  } catch (err) {
    console.error('Error serving funscript thumbnail:', err);
    res.status(500).send({ error: err.message });
  }
});


// Serve image previews (thumbnails)
router.get('/preview', async (req, res) => {
  const { path: filePath } = req.query;
  
  if (!filePath) {
    return res.status(400).send({ error: 'File path is required' });
  }

  try {
    // Check if file exists
    if (!await fs.pathExists(filePath)) {
      return res.status(404).send({ error: 'File not found' });
    }

    const ext = path.extname(filePath).toLowerCase();
    const isImage = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'].includes(ext);

    if (!isImage) {
      return res.status(400).send({ error: 'File is not an image' });
    }

    // Try to use sharp for better thumbnail generation
    try {
      const thumbnail = await sharp(filePath)
        .resize(500, 400, { 
          fit: 'cover',
          position: 'center'
        })
        .jpeg({ quality: 90 })
        .toBuffer();
      
      res.set('Content-Type', 'image/jpeg');
      res.set('Cache-Control', 'public, max-age=3600');
      res.send(thumbnail);
    } catch (sharpError) {
      // Fallback to serving original file if sharp fails
      console.warn('Sharp failed, serving original:', sharpError.message);
      res.sendFile(path.resolve(filePath));
    }
  } catch (err) {
    console.error('Error serving image preview:', err);
    res.status(500).send({ error: err.message });
  }
});

// Serve video thumbnails
router.get('/video-thumbnail', async (req, res) => {
  const { path: filePath } = req.query;
  
  console.log('Video thumbnail requested for:', filePath);
  
  if (!filePath) {
    return res.status(400).send({ error: 'File path is required' });
  }

  try {
    // Check if file exists
    if (!await fs.pathExists(filePath)) {
      console.log('Video file not found:', filePath);
      return res.status(404).send({ error: 'File not found' });
    }

    const ext = path.extname(filePath).toLowerCase();
    const isVideo = ['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm'].includes(ext);

    if (!isVideo) {
      console.log('File is not a video:', filePath, 'extension:', ext);
      return res.status(400).send({ error: 'File is not a video' });
    }

    // --- Caching logic: .thumbnails at root of genre folder ---
    // Find genre root (assume /content/GENRE/ structure)
    const parts = filePath.split(path.sep);
    const contentIdx = parts.findIndex(p => p.toLowerCase() === 'content');
    let genreRoot = null;
    if (contentIdx !== -1 && parts.length > contentIdx + 1) {
      genreRoot = parts.slice(0, contentIdx + 2).join(path.sep);
    } else {
      // fallback: use parent of vids/pics
      genreRoot = path.dirname(path.dirname(filePath));
    }
    const baseName = path.basename(filePath, ext);
    const thumbDir = path.join(genreRoot, '.thumbnails');
    const thumbPath = path.join(thumbDir, `${baseName}.jpg`);

    // Serve cached thumbnail if exists
    if (await fs.pathExists(thumbPath)) {
      res.set('Content-Type', 'image/jpeg');
      res.set('Cache-Control', 'public, max-age=86400');
      res.set('Access-Control-Allow-Origin', '*');
      res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.set('Access-Control-Allow-Headers', 'Content-Type');
      return res.sendFile(thumbPath);
    }

    // If not cached, generate and save
    await fs.ensureDir(thumbDir);
    const tmpThumb = path.join(os.tmpdir(), `thumb_${Date.now()}.jpg`);
    try {
      await new Promise((resolve, reject) => {
        const ffmpeg = spawn(ffmpegPath, [
          '-i', filePath,
          '-ss', '00:00:10',
          '-vframes', '1',
          '-vf', 'scale=500:400:force_original_aspect_ratio=increase,crop=500:400',
          '-y',
          tmpThumb
        ]);
        ffmpeg.on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error(`FFmpeg exited with code ${code}`));
        });
        ffmpeg.on('error', reject);
      });
      if (await fs.pathExists(tmpThumb)) {
        await fs.copy(tmpThumb, thumbPath); // Save to .thumbnails
        const thumbnailBuffer = await fs.readFile(tmpThumb);
        fs.unlink(tmpThumb).catch(() => {});
        res.set('Content-Type', 'image/jpeg');
        res.set('Cache-Control', 'public, max-age=86400');
        res.set('Access-Control-Allow-Origin', '*');
        res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.set('Access-Control-Allow-Headers', 'Content-Type');
        return res.send(thumbnailBuffer);
      }
    } catch (videoError) {
      console.log('Failed to extract video frame with ffmpeg:', videoError.message);
    }

    // Generate an enhanced video thumbnail using sharp
    try {
      const filename = path.basename(filePath);
      const placeholder = await sharp({
        create: {
          width: 500,
          height: 400,
          channels: 4,
          background: { r: 15, g: 15, b: 15, alpha: 1 }
        }
      })
      .composite([
        {
          input: Buffer.from(`
            <svg width="500" height="400" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <linearGradient id="grad1" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" style="stop-color:#4d4d4d;stop-opacity:1" />
                  <stop offset="50%" style="stop-color:#3d3d3d;stop-opacity:1" />
                  <stop offset="100%" style="stop-color:#2d2d2d;stop-opacity:1" />
                </linearGradient>
                <filter id="shadow">
                  <feDropShadow dx="2" dy="2" stdDeviation="4" flood-color="black" flood-opacity="0.5"/>
                </filter>
              </defs>
              <rect width="500" height="400" fill="url(#grad1)" rx="12"/>
              
              <!-- Large centered play button -->
              <circle cx="250" cy="200" r="50" fill="rgba(255,255,255,0.95)" filter="url(#shadow)"/>
              <polygon points="225,175 225,225 285,200" fill="#333" />
              
              <!-- Video label at top -->
              <rect x="20" y="20" width="460" height="35" fill="rgba(0,0,0,0.8)" rx="17"/>
              <text x="250" y="44" font-family="Arial, sans-serif" font-size="18" font-weight="bold" fill="white" text-anchor="middle">VIDEO</text>
              
              <!-- File name at bottom -->
              <rect x="20" y="345" width="460" height="35" fill="rgba(0,0,0,0.8)" rx="17"/>
              <text x="250" y="369" font-family="Arial, sans-serif" font-size="14" fill="rgba(255,255,255,0.9)" text-anchor="middle">${filename.length > 60 ? filename.substring(0, 57) + '...' : filename}</text>
            </svg>
          `),
          top: 0,
          left: 0
        }
      ])
      .jpeg({ quality: 90 })
      .toBuffer();
      
      res.set('Content-Type', 'image/jpeg');
      res.set('Cache-Control', 'public, max-age=3600');
      res.set('Access-Control-Allow-Origin', '*');
      res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.set('Access-Control-Allow-Headers', 'Content-Type');
      res.send(placeholder);
    } catch (sharpError) {
      console.error('Sharp error generating video thumbnail:', sharpError);
      res.status(500).send({ error: 'Could not generate video placeholder' });
    }
  } catch (err) {
    console.error('Error serving video thumbnail:', err);
    res.status(500).send({ error: err.message });
  }
});

// Serve raw files (for download or full view)
router.get('/raw', async (req, res) => {
  const { path: filePath } = req.query;
  
  if (!filePath) {
    return res.status(400).send({ error: 'File path is required' });
  }

  try {
    // Check if file exists
    if (!await fs.pathExists(filePath)) {
      return res.status(404).send({ error: 'File not found' });
    }

    res.sendFile(path.resolve(filePath));
  } catch (err) {
    console.error('Error serving raw file:', err);
    res.status(500).send({ error: err.message });
  }
});

module.exports = router;
