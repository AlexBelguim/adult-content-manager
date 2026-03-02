
const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs-extra');
const sharp = require('sharp');
const ffmpegPath = require('ffmpeg-static');
const { spawn } = require('child_process');
const os = require('os');
const crypto = require('crypto');
const db = require('../db');
const imageCache = require('../services/thumbnailCache');
const { getVideoDuration, getVideoDurations, formatDuration } = require('../utils/videoDuration');

// Get duration for a single video
router.get('/video-duration', async (req, res) => {
  const { path: filePath } = req.query;

  if (!filePath) {
    return res.status(400).send({ error: 'File path is required' });
  }

  try {
    if (!await fs.pathExists(filePath)) {
      return res.status(404).send({ error: 'File not found' });
    }

    const duration = await getVideoDuration(filePath);
    res.send({
      path: filePath,
      duration,
      durationFormatted: formatDuration(duration)
    });
  } catch (err) {
    console.error('Error getting video duration:', err);
    res.status(500).send({ error: err.message });
  }
});

// Get durations for multiple videos (batch)
router.post('/video-durations', async (req, res) => {
  const { paths } = req.body;

  if (!paths || !Array.isArray(paths)) {
    return res.status(400).send({ error: 'paths array is required' });
  }

  try {
    const durations = await getVideoDurations(paths);

    // Format results
    const results = {};
    for (const [filePath, duration] of Object.entries(durations)) {
      results[filePath] = {
        duration,
        durationFormatted: duration ? formatDuration(duration) : null
      };
    }

    res.send(results);
  } catch (err) {
    console.error('Error getting video durations:', err);
    res.status(500).send({ error: err.message });
  }
});

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

// Stream video with range request support (crucial for large files over SMB/network)
router.get('/stream-video', async (req, res) => {
  const { path: filePath, startTime } = req.query;

  if (!filePath) {
    return res.status(400).send({ error: 'File path is required' });
  }

  try {
    // Check if file exists
    if (!await fs.pathExists(filePath)) {
      return res.status(404).send({ error: 'File not found' });
    }

    const stat = await fs.stat(filePath);
    const fileSize = stat.size;
    const ext = path.extname(filePath).toLowerCase();

    // For video formats that need remuxing, use ffmpeg with seek support
    const needsRemux = ['.mkv', '.avi', '.wmv', '.flv'].includes(ext);

    if (needsRemux) {
      // Remux to MP4 on-the-fly using ffmpeg, starting from startTime if provided
      const seekSeconds = parseFloat(startTime) || 0;
      console.log(`[Video Stream] Remuxing ${ext} from ${seekSeconds}s: ${path.basename(filePath)}`);

      res.writeHead(200, {
        'Content-Type': 'video/mp4',
        'Transfer-Encoding': 'chunked',
        'Cache-Control': 'no-cache',
        'Access-Control-Allow-Origin': '*',
        'X-Start-Time': seekSeconds.toString()
      });

      // Build ffmpeg args - seek before input for fast seeking
      const ffmpegArgs = [];
      if (seekSeconds > 0) {
        ffmpegArgs.push('-ss', seekSeconds.toString());
      }
      ffmpegArgs.push(
        '-i', filePath,
        '-c:v', 'copy',      // Copy video codec (no re-encoding)
        '-c:a', 'aac',       // Re-encode audio to AAC for compatibility
        '-movflags', 'frag_keyframe+empty_moov+faststart',
        '-f', 'mp4',
        '-'
      );

      const ffmpeg = spawn(ffmpegPath, ffmpegArgs);

      ffmpeg.stdout.pipe(res);

      ffmpeg.stderr.on('data', (data) => {
        const msg = data.toString();
        if (msg.includes('Error') || msg.includes('error')) {
          console.error('[Video Stream] FFmpeg error:', msg);
        }
      });

      ffmpeg.on('error', (err) => {
        console.error('[Video Stream] FFmpeg spawn error:', err);
        if (!res.headersSent) {
          res.status(500).send({ error: 'Remux error' });
        }
      });

      ffmpeg.on('close', (code) => {
        if (code !== 0 && code !== null) {
          console.error(`[Video Stream] FFmpeg exited with code ${code}`);
        }
      });

      req.on('close', () => {
        ffmpeg.kill('SIGTERM');
      });

      return;
    }

    // Determine content type
    const contentTypes = {
      '.mp4': 'video/mp4',
      '.mkv': 'video/x-matroska',
      '.webm': 'video/webm',
      '.avi': 'video/x-msvideo',
      '.mov': 'video/quicktime',
      '.wmv': 'video/x-ms-wmv',
      '.flv': 'video/x-flv',
      '.m4v': 'video/x-m4v',
      '.ts': 'video/mp2t'
    };
    const contentType = contentTypes[ext] || 'video/mp4';

    const range = req.headers.range;

    if (range) {
      // Parse Range header
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      // For network files, use smaller chunks (2MB) for faster initial load
      const CHUNK_SIZE = 2 * 1024 * 1024; // 2MB chunks
      const end = parts[1] ? parseInt(parts[1], 10) : Math.min(start + CHUNK_SIZE - 1, fileSize - 1);

      const chunkSize = (end - start) + 1;

      console.log(`[Video Stream] Range request: ${start}-${end}/${fileSize} (${Math.round(chunkSize / 1024)}KB)`);

      const stream = fs.createReadStream(filePath, { start, end });

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=3600',
        'Access-Control-Allow-Origin': '*'
      });

      stream.pipe(res);

      // Ensure stream is destroyed if client disconnects (releases file lock)
      res.on('close', () => {
        stream.destroy();
      });

      stream.on('error', (err) => {
        console.error('[Video Stream] Stream error:', err);
        if (!res.headersSent) {
          res.status(500).send({ error: 'Stream error' });
        }
      });
    } else {
      // No range requested - send headers for range support
      console.log(`[Video Stream] Full file request: ${fileSize} bytes`);

      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=3600',
        'Access-Control-Allow-Origin': '*'
      });

      const stream = fs.createReadStream(filePath);
      stream.pipe(res);

      // Ensure stream is destroyed if client disconnects (releases file lock)
      res.on('close', () => {
        stream.destroy();
      });

      stream.on('error', (err) => {
        console.error('[Video Stream] Stream error:', err);
        if (!res.headersSent) {
          res.status(500).send({ error: 'Stream error' });
        }
      });
    }
  } catch (err) {
    console.error('[Video Stream] Error:', err);
    res.status(500).send({ error: err.message });
  }
});

// Serve cached image (raw quality, from .cache folder)
router.get('/cached-image', async (req, res) => {
  const { path: filePath, basePath, folderType, checkOnly } = req.query;

  if (!filePath || !basePath || !folderType) {
    return res.status(400).send({ error: 'path, basePath, and folderType are required' });
  }

  try {
    // Check if source file exists
    if (!await fs.pathExists(filePath)) {
      return res.status(404).send({ error: 'File not found' });
    }

    const ext = path.extname(filePath).toLowerCase();
    const isImage = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'].includes(ext);

    if (!isImage) {
      return res.status(400).send({ error: 'File is not an image' });
    }

    // If checkOnly, just return cache metadata
    if (checkOnly === 'true') {
      const cachePath = imageCache.getCachedFilePath(filePath, basePath, folderType);
      const cacheCheck = await imageCache.isCacheValid(filePath, cachePath);
      const cacheKey = imageCache.getCacheKey(filePath);

      return res.send({
        cacheKey,
        valid: cacheCheck.valid,
        sourceModTime: cacheCheck.sourceModTime,
        cacheModTime: cacheCheck.cacheModTime
      });
    }

    // Get or copy to cache (returns path to cached file)
    const result = await imageCache.getCachedFile(filePath, basePath, folderType);

    // Serve the cached file directly
    res.set('Cache-Control', 'public, max-age=86400');
    res.set('X-Cache-Key', result.cacheKey);
    res.set('X-Cache-ModTime', result.modTime.toString());
    res.set('X-From-Cache', result.fromCache.toString());
    res.sendFile(result.cachePath);
  } catch (err) {
    console.error('Error serving cached image:', err);
    res.status(500).send({ error: err.message });
  }
});

// Get cache metadata for performer images (for frontend localStorage sync)
router.post('/image-cache-meta', async (req, res) => {
  const { imagePaths, basePath, folderType } = req.body;

  if (!imagePaths || !basePath || !folderType) {
    return res.status(400).send({ error: 'imagePaths, basePath, and folderType are required' });
  }

  try {
    const metadata = await imageCache.getImageCacheMeta(
      imagePaths,
      basePath,
      folderType
    );

    res.send(metadata);
  } catch (err) {
    console.error('Error getting cache metadata:', err);
    res.status(500).send({ error: err.message });
  }
});

// Pre-cache images for a performer (batch caching - copies originals)
router.post('/pre-cache-images', async (req, res) => {
  const { imagePaths, basePath, folderType } = req.body;

  if (!imagePaths || !basePath || !folderType) {
    return res.status(400).send({ error: 'imagePaths, basePath, and folderType are required' });
  }

  try {
    const results = await imageCache.preCacheImages(
      imagePaths,
      basePath,
      folderType
    );

    res.send({
      success: true,
      results,
      cached: results.filter(r => !r.error).length,
      failed: results.filter(r => r.error).length
    });
  } catch (err) {
    console.error('Error pre-caching images:', err);
    res.status(500).send({ error: err.message });
  }
});

// Invalidate cache for a specific image
router.post('/invalidate-image-cache', async (req, res) => {
  const { sourcePath, basePath, folderType } = req.body;

  if (!sourcePath || !basePath || !folderType) {
    return res.status(400).send({ error: 'sourcePath, basePath, and folderType are required' });
  }

  try {
    await imageCache.invalidateCache(sourcePath, basePath, folderType);
    res.send({ success: true });
  } catch (err) {
    console.error('Error invalidating cache:', err);
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
    const isVideo = ['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm', '.m4v'].includes(ext);

    if (!isVideo) {
      console.log('File is not a video:', filePath, 'extension:', ext);
      return res.status(400).send({ error: 'File is not a video' });
    }

    // --- Caching logic: Always use vids/.thumbnails/.cache ---
    // All video thumbnails (including funscript videos) go to the same cache folder

    const normalizedPath = path.normalize(filePath);
    const parts = normalizedPath.split(path.sep);
    // Find the last 'vids' segment (case insensitive)
    const vidsIdx = parts.map(p => p.toLowerCase()).lastIndexOf('vids');

    let thumbRoot;

    if (vidsIdx !== -1) {
      // Always use vids/.thumbnails for all videos
      const vidsDir = parts.slice(0, vidsIdx + 1).join(path.sep);
      thumbRoot = path.join(vidsDir, '.thumbnails');
    } else {
      // Fallback if no 'vids' folder found
      const videoDir = path.dirname(normalizedPath);
      thumbRoot = path.join(videoDir, '.thumbnails');
    }

    // Create .cache folder inside the thumbnail root
    const thumbDir = path.join(thumbRoot, '.cache');

    // Use MD5 hash of file path for cache key (like performer thumbnails)
    const cacheKey = crypto.createHash('md5').update(normalizedPath).digest('hex');
    const thumbPath = path.join(thumbDir, `${cacheKey}.jpg`);

    console.log('[video-thumbnail] Cache lookup:', { normalizedPath, cacheKey, thumbPath });

    // Serve cached thumbnail if exists
    if (await fs.pathExists(thumbPath)) {
      console.log('[video-thumbnail] Serving cached thumbnail:', thumbPath);
      res.set('Content-Type', 'image/jpeg');
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.set('Pragma', 'no-cache');
      res.set('Expires', '0');
      res.set('Access-Control-Allow-Origin', '*');
      res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.set('Access-Control-Allow-Headers', 'Content-Type');
      return res.sendFile(thumbPath);
    }

    // If not cached, generate and save
    await fs.ensureDir(thumbDir);
    const tmpThumb = path.join(os.tmpdir(), `thumb_${Date.now()}.jpg`);

    // Helper to try generating thumbnail at a specific seek time
    const tryGenerateThumbnail = (seekTime) => {
      return new Promise((resolve, reject) => {
        const ffmpeg = spawn(ffmpegPath, [
          '-ss', seekTime,  // Seek before input for faster processing
          '-i', filePath,
          '-vframes', '1',
          '-vf', 'scale=1280:-1',
          '-q:v', '2',
          '-y',
          tmpThumb
        ]);
        ffmpeg.on('close', (code) => {
          if (code === 0) resolve(true);
          else resolve(false);
        });
        ffmpeg.on('error', () => resolve(false));
      });
    };

    // Try 10 seconds first, fallback to 1 second for short videos
    let success = await tryGenerateThumbnail('00:00:10');
    if (!success || !await fs.pathExists(tmpThumb)) {
      console.log('[video-thumbnail] 10s seek failed, trying 1s for short video');
      success = await tryGenerateThumbnail('00:00:01');
    }

    if (success && await fs.pathExists(tmpThumb)) {
      console.log('[video-thumbnail] Generated new thumbnail, saving to:', thumbPath);
      await fs.copy(tmpThumb, thumbPath); // Save to .thumbnails
      const thumbnailBuffer = await fs.readFile(tmpThumb);
      fs.unlink(tmpThumb).catch(() => { });
      res.set('Content-Type', 'image/jpeg');
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.set('Pragma', 'no-cache');
      res.set('Expires', '0');
      res.set('Access-Control-Allow-Origin', '*');
      res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.set('Access-Control-Allow-Headers', 'Content-Type');
      return res.send(thumbnailBuffer);
    }

    console.log('Failed to extract video frame with ffmpeg');

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

// Regenerate video thumbnail at random position
router.post('/regenerate-thumbnail', async (req, res) => {
  const { path: filePath } = req.body;

  if (!filePath) {
    return res.status(400).send({ error: 'File path is required' });
  }

  try {
    // Check if file exists
    if (!await fs.pathExists(filePath)) {
      return res.status(404).send({ error: 'File not found' });
    }

    const ext = path.extname(filePath).toLowerCase();
    const isVideo = ['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm', '.m4v'].includes(ext);

    if (!isVideo) {
      return res.status(400).send({ error: 'File is not a video' });
    }

    // Get video duration using ffprobe
    const normalizedPath = path.normalize(filePath);
    let duration = 60; // Default fallback

    try {
      const ffprobePath = require('ffprobe-static').path;
      const durationResult = await new Promise((resolve, reject) => {
        const ffprobe = spawn(ffprobePath, [
          '-v', 'error',
          '-show_entries', 'format=duration',
          '-of', 'default=noprint_wrappers=1:nokey=1',
          filePath
        ]);
        let output = '';
        ffprobe.stdout.on('data', (data) => { output += data.toString(); });
        ffprobe.on('close', (code) => {
          if (code === 0) resolve(parseFloat(output.trim()));
          else reject(new Error('ffprobe failed'));
        });
        ffprobe.on('error', reject);
      });
      if (!isNaN(durationResult) && durationResult > 0) {
        duration = durationResult;
      }
    } catch (probeError) {
      console.log('Could not get video duration, using default:', probeError.message);
    }

    // Generate random timestamp (between 10% and 90% of video, minimum 1 second)
    const minTime = Math.max(0.5, duration * 0.1);
    const maxTime = Math.max(1, duration * 0.9);
    const randomTime = Math.max(1, Math.floor(minTime + Math.random() * (maxTime - minTime)));
    const timeString = new Date(randomTime * 1000).toISOString().substr(11, 8);

    console.log(`Regenerating thumbnail for ${path.basename(filePath)} at ${timeString} (${randomTime}s of ${duration}s)`);

    // Determine cache path (same logic as video-thumbnail endpoint)
    const parts = normalizedPath.split(path.sep);
    const vidsIdx = parts.map(p => p.toLowerCase()).lastIndexOf('vids');

    let thumbRoot;
    if (vidsIdx !== -1) {
      const vidsDir = parts.slice(0, vidsIdx + 1).join(path.sep);
      thumbRoot = path.join(vidsDir, '.thumbnails');
    } else {
      thumbRoot = path.join(path.dirname(normalizedPath), '.thumbnails');
    }

    const thumbDir = path.join(thumbRoot, '.cache');
    const cacheKey = crypto.createHash('md5').update(normalizedPath).digest('hex');
    const thumbPath = path.join(thumbDir, `${cacheKey}.jpg`);

    console.log('[regenerate-thumbnail] Cache path:', { normalizedPath, cacheKey, thumbPath });

    // Delete existing thumbnail if it exists
    if (await fs.pathExists(thumbPath)) {
      await fs.remove(thumbPath);
    }

    // Generate new thumbnail at random position
    await fs.ensureDir(thumbDir);
    const tmpThumb = path.join(os.tmpdir(), `thumb_regen_${Date.now()}.jpg`);

    await new Promise((resolve, reject) => {
      const ffmpeg = spawn(ffmpegPath, [
        '-ss', timeString,
        '-i', filePath,
        '-vframes', '1',
        '-vf', 'scale=1280:-1',
        '-q:v', '2',
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
      console.log('[regenerate-thumbnail] Saving new thumbnail to:', thumbPath);
      await fs.copy(tmpThumb, thumbPath);
      await fs.unlink(tmpThumb).catch(() => { });

      res.send({
        success: true,
        timestamp: randomTime,
        timeString,
        thumbnailPath: thumbPath
      });
    } else {
      throw new Error('Failed to generate thumbnail');
    }
  } catch (err) {
    console.error('Error regenerating thumbnail:', err);
    res.status(500).send({ error: err.message });
  }
});

// Serve raw files (for download or full view)
// Serve raw files - shared handler for /raw and /file endpoints
const serveRawFile = async (req, res) => {
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
};

router.get('/raw', serveRawFile);
router.get('/file', serveRawFile);

// Stream video with range request support (for large files / network shares)
router.get('/stream', async (req, res) => {
  const { path: filePath } = req.query;

  if (!filePath) {
    return res.status(400).send({ error: 'File path is required' });
  }

  try {
    // Check if file exists
    if (!await fs.pathExists(filePath)) {
      return res.status(404).send({ error: 'File not found' });
    }

    const stat = await fs.stat(filePath);
    const fileSize = stat.size;
    const ext = path.extname(filePath).toLowerCase();

    // Determine content type
    const mimeTypes = {
      '.mp4': 'video/mp4',
      '.webm': 'video/webm',
      '.mkv': 'video/x-matroska',
      '.avi': 'video/x-msvideo',
      '.mov': 'video/quicktime',
      '.wmv': 'video/x-ms-wmv',
      '.flv': 'video/x-flv',
      '.m4v': 'video/x-m4v',
      '.ts': 'video/mp2t'
    };
    const contentType = mimeTypes[ext] || 'video/mp4';

    const range = req.headers.range;

    if (range) {
      // Parse range header
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      // For large files, limit chunk size to 10MB to prevent memory issues
      const CHUNK_SIZE = 10 * 1024 * 1024; // 10MB
      const requestedEnd = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const end = Math.min(start + CHUNK_SIZE - 1, requestedEnd, fileSize - 1);
      const chunkSize = end - start + 1;

      console.log(`[Stream] Range request: ${start}-${end}/${fileSize} (${(chunkSize / 1024 / 1024).toFixed(2)}MB) for ${path.basename(filePath)}`);

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': contentType,
        'Cache-Control': 'no-cache',
        'Access-Control-Allow-Origin': '*'
      });

      const stream = fs.createReadStream(filePath, { start, end });

      stream.on('error', (err) => {
        console.error('[Stream] Read stream error:', err);
        if (!res.headersSent) {
          res.status(500).send({ error: 'Stream error' });
        }
      });

      stream.pipe(res);
    } else {
      // No range requested - send file info for initial request
      console.log(`[Stream] Full file request: ${fileSize} bytes for ${path.basename(filePath)}`);

      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-cache',
        'Access-Control-Allow-Origin': '*'
      });

      const stream = fs.createReadStream(filePath);

      stream.on('error', (err) => {
        console.error('[Stream] Read stream error:', err);
        if (!res.headersSent) {
          res.status(500).send({ error: 'Stream error' });
        }
      });

      stream.pipe(res);
    }
  } catch (err) {
    console.error('Error streaming video:', err);
    res.status(500).send({ error: err.message });
  }
});

const deleteFileTagsStmt = db.prepare('DELETE FROM file_tags WHERE file_path = ?');
const deleteFileRatingStmt = db.prepare('DELETE FROM file_ratings WHERE file_path = ?');

router.post('/delete-with-funscripts', async (req, res) => {
  try {
    const { videoPath, funscriptPaths } = req.body || {};

    if (!videoPath) {
      return res.status(400).send({ error: 'videoPath is required' });
    }

    const targets = Array.from(new Set([
      videoPath,
      ...(Array.isArray(funscriptPaths) ? funscriptPaths : []),
    ].filter(Boolean)));

    const deleted = [];
    const missing = [];
    const errors = [];

    for (const target of targets) {
      try {
        const exists = await fs.pathExists(target);
        if (!exists) {
          missing.push(target);
        } else {
          await fs.remove(target);
          deleted.push(target);
        }
      } catch (err) {
        errors.push({ path: target, error: err.message });
      }

      try {
        deleteFileTagsStmt.run(target);
      } catch (err) {
        console.warn('Failed to delete tags for path:', target, err.message);
      }

      try {
        deleteFileRatingStmt.run(target);
      } catch (err) {
        console.warn('Failed to delete ratings for path:', target, err.message);
      }
    }

    res.send({ success: errors.length === 0, deleted, missing, errors });
  } catch (error) {
    console.error('Failed to delete video and funscripts:', error);
    res.status(500).send({ error: error.message });
  }
});

// Open folder in Windows Explorer
router.post('/open-folder', async (req, res) => {
  try {
    const { path: folderPath } = req.body;

    if (!folderPath) {
      return res.status(400).send({ error: 'Folder path is required' });
    }

    // Check if folder exists
    if (!await fs.pathExists(folderPath)) {
      return res.status(404).send({ error: 'Folder not found' });
    }

    // Open in Windows Explorer using spawn to avoid shell quoting issues
    const { spawn } = require('child_process');
    try {
      const child = spawn('explorer', [folderPath], { detached: true, stdio: 'ignore' });
      // Detach so the server isn't tied to Explorer process
      child.unref();
      return res.send({ success: true });
    } catch (err) {
      console.error('Error spawning explorer process:', err);
      return res.status(500).send({ error: 'Failed to open folder', details: err.message });
    }
  } catch (error) {
    console.error('Error opening folder:', error);
    res.status(500).send({ error: error.message });
  }
});

// List video files in a folder (recursive)
router.get('/list-videos', async (req, res) => {
  const { folder } = req.query;

  if (!folder) {
    return res.status(400).send({ error: 'Folder path is required' });
  }

  try {
    if (!await fs.pathExists(folder)) {
      return res.status(404).send({ error: 'Folder not found' });
    }

    const videoExtensions = ['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.webm', '.m4v', '.flv'];
    const videos = [];

    // Recursive function to find videos
    const scanDir = async (dir) => {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          // Skip hidden folders and common non-video folders
          if (!entry.name.startsWith('.') && entry.name !== 'node_modules' && entry.name !== '.thumbnails') {
            await scanDir(fullPath);
          }
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (videoExtensions.includes(ext)) {
            try {
              const stats = await fs.stat(fullPath);
              const duration = await getVideoDuration(fullPath);
              videos.push({
                name: entry.name,
                path: fullPath,
                size: stats.size,
                duration: duration,
                durationFormatted: formatDuration(duration),
                modified: stats.mtime
              });
            } catch (err) {
              // Still add video even if we can't get duration
              videos.push({
                name: entry.name,
                path: fullPath,
                duration: null,
                durationFormatted: null
              });
            }
          }
        }
      }
    };

    await scanDir(folder);

    // Sort by name
    videos.sort((a, b) => a.name.localeCompare(b.name));

    res.send({
      folder,
      count: videos.length,
      videos
    });
  } catch (err) {
    console.error('Error listing videos:', err);
    res.status(500).send({ error: err.message });
  }
});

module.exports = router;
