const fs = require('fs').promises;
const path = require('path');
const db = require('../db');
const axios = require('axios');
const config = require('../config');
const sharp = require('sharp');

// Configuration
const CONFIG = {
  mlServiceUrl: process.env.ML_SERVICE_URL || 'http://localhost:5001',
  workerConcurrency: 20, // High concurrency for CPU-bound preprocessing (i9-14900KF has 24 cores)
  imageExtensions: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'],
  videoExtensions: ['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm', '.m4v'],
  maxImageSize: 1024, // Resize large images before sending to CLIP
  
  // Video frame extraction config (Option B: Adaptive Sampling)
  video: {
    targetFrames: 30,      // Target number of frames for consistent representation
    minInterval: 5,        // Minimum 5 seconds between frames (avoid redundancy)
    maxInterval: 30,       // Maximum 30 seconds between frames (ensure coverage)
    minFrames: 3,          // Always extract at least 3 frames
    poolingMethod: 'mean', // Average embeddings for aggregate representation
  },
};

// Active job tracking
const activeJobs = new Map();

/**
 * Calculate frame positions using adaptive sampling
 */
function calculateFramePositions(duration) {
  const { targetFrames, minInterval, maxInterval, minFrames } = CONFIG.video;
  
  // Calculate ideal interval
  let interval = duration / targetFrames;
  
  // Clamp to min/max bounds
  interval = Math.max(minInterval, Math.min(maxInterval, interval));
  
  // Calculate actual frame count
  const frameCount = Math.max(minFrames, Math.floor(duration / interval));
  
  // Generate evenly spaced timestamps
  const positions = [];
  for (let i = 0; i < frameCount; i++) {
    positions.push(i * interval);
  }
  
  return positions;
}

/**
 * Extract multiple frames from video at specified timestamps
 */
async function extractVideoFrames(videoPath) {
  const { promisify } = require('util');
  const { exec } = require('child_process');
  const execPromise = promisify(exec);
  
  const tempDir = path.join(process.cwd(), 'temp');
  await fs.mkdir(tempDir, { recursive: true });
  
  try {
    // Get video duration
    const metadataCmd = `ffprobe -v quiet -print_format json -show_format "${videoPath}"`;
    const { stdout } = await execPromise(metadataCmd, { timeout: 10000 });
    const metadata = JSON.parse(stdout);
    const duration = parseFloat(metadata.format.duration) || 0;
    
    if (duration === 0) {
      console.warn(`Could not determine duration for ${videoPath}`);
      // Fallback to single middle frame
      return [await extractSingleFrame(videoPath, 0.5)];
    }
    
    // Calculate frame positions
    const framePositions = calculateFramePositions(duration);
    console.log(`Extracting ${framePositions.length} frames from ${duration.toFixed(1)}s video (interval: ${(duration/framePositions.length).toFixed(1)}s)`);
    
    // Extract all frames in parallel batches
    const frameBuffers = [];
    const batchSize = 5; // Extract 5 frames at a time
    
    for (let i = 0; i < framePositions.length; i += batchSize) {
      const batch = framePositions.slice(i, i + batchSize);
      const batchPromises = batch.map(async (timestamp, idx) => {
        const tempFrame = path.join(tempDir, `clip_frame_${Date.now()}_${i + idx}_${Math.random()}.jpg`);
        
        try {
          const cmd = `ffmpeg -ss ${timestamp} -i "${videoPath}" -vframes 1 -q:v 2 "${tempFrame}" -y`;
          await execPromise(cmd, { timeout: 30000 });
          
          const frameBuffer = await fs.readFile(tempFrame);
          await fs.unlink(tempFrame).catch(() => {});
          return frameBuffer;
        } catch (error) {
          console.error(`Error extracting frame at ${timestamp}s:`, error.message);
          return null;
        }
      });
      
      const batchResults = await Promise.all(batchPromises);
      frameBuffers.push(...batchResults.filter(b => b !== null));
    }
    
    return frameBuffers;
  } catch (error) {
    console.error('Error extracting video frames:', error);
    // Fallback to single middle frame
    return [await extractSingleFrame(videoPath, 0.5)];
  }
}

/**
 * Extract a single frame from video at specified position (fallback method)
 */
async function extractSingleFrame(videoPath, position = 0.5) {
  const { promisify } = require('util');
  const { exec } = require('child_process');
  const execPromise = promisify(exec);
  
  const tempDir = path.join(process.cwd(), 'temp');
  await fs.mkdir(tempDir, { recursive: true });
  
  const tempFrame = path.join(tempDir, `clip_frame_${Date.now()}_${Math.random()}.jpg`);
  
  try {
    // Get video duration first
    const metadataCmd = `ffprobe -v quiet -print_format json -show_format "${videoPath}"`;
    const { stdout } = await execPromise(metadataCmd, { timeout: 10000 });
    const metadata = JSON.parse(stdout);
    const duration = parseFloat(metadata.format.duration) || 0;
    
    if (duration > 0) {
      const timeInSeconds = Math.max(0, duration * position);
      const cmd = `ffmpeg -ss ${timeInSeconds} -i "${videoPath}" -vframes 1 -q:v 2 "${tempFrame}" -y`;
      await execPromise(cmd, { timeout: 30000 });
    } else {
      // No duration info, just extract first frame
      const cmd = `ffmpeg -i "${videoPath}" -vframes 1 -q:v 2 "${tempFrame}" -y`;
      await execPromise(cmd, { timeout: 30000 });
    }
    
    const frameBuffer = await fs.readFile(tempFrame);
    await fs.unlink(tempFrame).catch(() => {});
    
    return frameBuffer;
  } catch (error) {
    console.error('Error extracting video frame:', error);
    await fs.unlink(tempFrame).catch(() => {});
    return null;
  }
}

/**
 * Prepare image for CLIP extraction (resize if needed)
 */
async function prepareImage(imageBuffer) {
  try {
    const metadata = await sharp(imageBuffer).metadata();
    
    // Resize if image is very large (to save bandwidth and processing time)
    if (metadata.width > CONFIG.maxImageSize || metadata.height > CONFIG.maxImageSize) {
      return await sharp(imageBuffer)
        .resize(CONFIG.maxImageSize, CONFIG.maxImageSize, { fit: 'inside' })
        .jpeg({ quality: 90 })
        .toBuffer();
    }
    
    return imageBuffer;
  } catch (error) {
    console.error('Error preparing image:', error);
    return imageBuffer;
  }
}

/**
 * Extract CLIP embedding from ML service
 */
async function extractClipEmbedding(imageBuffer) {
  try {
    const preparedImage = await prepareImage(imageBuffer);
    const base64Image = preparedImage.toString('base64');
    
    const response = await axios.post(
      `${CONFIG.mlServiceUrl}/extract-clip`,
      { image_data: base64Image },
      { 
        timeout: 30000,
        headers: { 'Content-Type': 'application/json' }
      }
    );
    
    if (!response.data.success) {
      throw new Error(response.data.error || 'CLIP extraction failed');
    }
    
    // Return embedding as base64 (for BLOB storage)
    return Buffer.from(response.data.embedding_base64, 'base64');
  } catch (error) {
    console.error('Error calling ML service for CLIP:', error.message);
    throw error;
  }
}

/**
 * Average multiple embeddings (for video pooling)
 */
function averageEmbeddings(embeddingBuffers) {
  if (embeddingBuffers.length === 0) return null;
  if (embeddingBuffers.length === 1) return embeddingBuffers[0];
  
  // Convert buffers to float arrays
  const float32Arrays = embeddingBuffers.map(buf => new Float32Array(buf.buffer));
  const embeddingSize = float32Arrays[0].length;
  
  // Calculate mean
  const avgEmbedding = new Float32Array(embeddingSize);
  for (let i = 0; i < embeddingSize; i++) {
    let sum = 0;
    for (const embedding of float32Arrays) {
      sum += embedding[i];
    }
    avgEmbedding[i] = sum / float32Arrays.length;
  }
  
  // Convert back to buffer
  return Buffer.from(avgEmbedding.buffer);
}

/**
 * Get or create content_item entry for a file
 */
async function getOrCreateContentItem(filePath, performerId) {
  // Check if content item exists
  let contentItem = db.prepare('SELECT * FROM content_items WHERE file_path = ?').get(filePath);
  
  if (!contentItem) {
    // Create new content item
    const ext = path.extname(filePath).toLowerCase();
    const isImage = CONFIG.imageExtensions.includes(ext);
    const fileType = isImage ? 'image' : 'video';
    
    const stats = await fs.stat(filePath);
    
    const result = db.prepare(`
      INSERT INTO content_items (performer_id, file_path, file_type, file_size)
      VALUES (?, ?, ?, ?)
    `).run(performerId, filePath, fileType, stats.size);
    
    contentItem = db.prepare('SELECT * FROM content_items WHERE id = ?').get(result.lastInsertRowid);
  }
  
  return contentItem;
}

/**
 * Process a single file and extract CLIP embedding
 */
async function processFile(filePath, performerId) {
  const ext = path.extname(filePath).toLowerCase();
  const isImage = CONFIG.imageExtensions.includes(ext);
  const isVideo = CONFIG.videoExtensions.includes(ext);
  
  if (!isImage && !isVideo) {
    return null; // Skip unsupported files
  }
  
  try {
    // Get or create content item
    const contentItem = await getOrCreateContentItem(filePath, performerId);
    
    // Check if CLIP embedding already exists
    const existing = db.prepare('SELECT * FROM content_clip_embeddings WHERE content_item_id = ?').get(contentItem.id);
    if (existing) {
      console.log(`CLIP embedding already exists for ${filePath}, skipping...`);
      return { contentItemId: contentItem.id, skipped: true };
    }
    
    let clipEmbedding;
    
    if (isImage) {
      // Single frame for images
      const imageBuffer = await fs.readFile(filePath);
      clipEmbedding = await extractClipEmbedding(imageBuffer);
    } else if (isVideo) {
      // Multiple frames for videos with averaging
      const frameBuffers = await extractVideoFrames(filePath);
      
      if (frameBuffers.length === 0) {
        console.warn(`Failed to extract frames from video: ${filePath}`);
        return null;
      }
      
      // Extract CLIP embeddings for all frames
      const frameEmbeddings = await Promise.all(
        frameBuffers.map(buf => extractClipEmbedding(buf))
      );
      
      // Average the embeddings
      clipEmbedding = averageEmbeddings(frameEmbeddings);
      
      console.log(`Processed video with ${frameBuffers.length} frames: ${path.basename(filePath)}`);
    }
    
    // Store in database
    db.prepare(`
      INSERT OR REPLACE INTO content_clip_embeddings (content_item_id, clip_embedding, model_version)
      VALUES (?, ?, ?)
    `).run(contentItem.id, clipEmbedding, 'openai/clip-vit-large-patch14');
    
    return { contentItemId: contentItem.id, success: true };
  } catch (error) {
    console.error(`Error processing file ${filePath}:`, error);
    return null;
  }
}

/**
 * Process files in batches with concurrency control
 */
async function processBatch(files, performerId, jobId, onProgress) {
  const results = [];
  let processed = 0;
  let skipped = 0;
  
  // Process with limited concurrency (CLIP is GPU intensive)
  for (let i = 0; i < files.length; i += CONFIG.workerConcurrency) {
    const batch = files.slice(i, i + CONFIG.workerConcurrency);
    const batchResults = await Promise.all(
      batch.map(file => processFile(file, performerId))
    );
    
    for (const result of batchResults) {
      if (result) {
        if (result.skipped) {
          skipped++;
        }
        results.push(result);
      }
    }
    
    processed += batch.length;
    
    // Update job progress
    if (activeJobs.has(jobId)) {
      activeJobs.get(jobId).processed = processed;
      activeJobs.get(jobId).skipped = skipped;
      activeJobs.get(jobId).total = files.length;
    }
    
    if (onProgress) {
      onProgress(processed, files.length, skipped);
    }
  }
  
  return results;
}

/**
 * Discover all files for a performer
 */
async function discoverPerformerFiles(performerId, basePath) {
  const performer = db.prepare('SELECT * FROM performers WHERE id = ?').get(performerId);
  if (!performer) {
    throw new Error('Performer not found');
  }
  
  const files = [];
  
  // Determine the correct subfolder based on moved_to_after flag
  const subfolder = performer.moved_to_after === 1 ? 'after filter performer' : 'before filter performer';
  const performerPath = path.join(basePath, subfolder, performer.name);
  
  console.log(`Scanning directory for performer ${performer.name}: ${performerPath}`);
  
  async function scanDirectory(dirPath) {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        
        if (entry.isDirectory()) {
          await scanDirectory(fullPath);
        } else {
          const ext = path.extname(entry.name).toLowerCase();
          if (CONFIG.imageExtensions.includes(ext) || CONFIG.videoExtensions.includes(ext)) {
            files.push(fullPath);
          }
        }
      }
    } catch (error) {
      console.error(`Error scanning directory ${dirPath}:`, error);
    }
  }
  
  await scanDirectory(performerPath);
  return files;
}

/**
 * Create CLIP embeddings for a performer
 * @param {number} performerId - ID of the performer
 * @param {string} basePath - Base directory path
 * @param {string} jobId - Unique job identifier
 * @param {string} mode - 'append' (default, skip existing) or 'replace' (regenerate all)
 */
async function createClipDB(performerId, basePath, jobId, mode = 'append') {
  const job = {
    jobId,
    performerId,
    basePath,
    mode,
    status: 'running',
    processed: 0,
    skipped: 0,
    total: 0,
    startTime: Date.now(),
  };
  
  activeJobs.set(jobId, job);
  
  try {
    // Check if ML service is available
    try {
      await axios.get(`${CONFIG.mlServiceUrl}/health`, { timeout: 5000 });
    } catch (error) {
      throw new Error('ML service is not available. Please start the ML service first.');
    }
    
    // If mode is 'replace', delete existing embeddings
    if (mode === 'replace') {
      const contentItems = db.prepare(`
        SELECT id FROM content_items WHERE performer_id = ?
      `).all(performerId);
      
      for (const item of contentItems) {
        db.prepare('DELETE FROM content_clip_embeddings WHERE content_item_id = ?').run(item.id);
      }
    }
    
    // Get all files for this performer
    const files = await discoverPerformerFiles(performerId, basePath);
    job.total = files.length;
    job.estimatedCount = files.length;
    
    // Process files in batches
    const clipResults = await processBatch(files, performerId, jobId, (processed, total, skipped) => {
      console.log(`Progress: ${processed}/${total} files processed (${skipped} skipped)`);
    });
    
    job.status = 'completed';
    job.endTime = Date.now();
    job.embeddingCount = clipResults.filter(r => r.success).length;
    
    return {
      success: true,
      jobId,
      embeddingCount: job.embeddingCount,
      skipped: job.skipped,
      duration: job.endTime - job.startTime,
    };
  } catch (error) {
    job.status = 'failed';
    job.error = error.message;
    console.error('Error creating CLIP DB:', error);
    throw error;
  }
}

/**
 * Get job status
 */
function getJobStatus(jobId) {
  return activeJobs.get(jobId) || null;
}

/**
 * Get CLIP statistics for a performer
 */
function getClipStats(performerId) {
  const stats = db.prepare(`
    SELECT 
      COUNT(DISTINCT ci.id) as total_files,
      COUNT(DISTINCT cce.id) as files_with_clip,
      MAX(cce.generated_at) as last_updated
    FROM content_items ci
    LEFT JOIN content_clip_embeddings cce ON ci.id = cce.content_item_id
    WHERE ci.performer_id = ?
  `).get(performerId);
  
  return stats;
}

module.exports = {
  createClipDB,
  getJobStatus,
  getClipStats,
  CONFIG,
};
