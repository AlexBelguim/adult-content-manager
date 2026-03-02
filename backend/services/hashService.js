const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');
const sharp = require('sharp');
const db = require('../db');
const { promisify } = require('util');
const { exec } = require('child_process');
const execPromise = promisify(exec);

// Configuration
const CONFIG = {
  hashAlgorithm: 'sha256', // or 'blake3' if package installed
  perceptualHashSize: 8, // 8x8 = 64 bits
  workerConcurrency: 4,
  videoFramePosition: 0.5, // middle of video (50%)
  imageExtensions: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'],
  videoExtensions: ['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm', '.m4v'],
};

// Active job tracking
const activeJobs = new Map();

/**
 * Calculate SHA-256 hash of a file
 */
async function calculateExactHash(filePath) {
  const hash = crypto.createHash(CONFIG.hashAlgorithm);
  const fileBuffer = await fs.readFile(filePath);
  hash.update(fileBuffer);
  return hash.digest('hex');
}

/**
 * Calculate perceptual hash (dHash) for an image
 * dHash is simpler and faster than pHash, good for duplicate detection
 */
async function calculatePerceptualHash(imageBuffer) {
  try {
    // Resize to 9x8 (we need one extra column for difference calculation)
    const resized = await sharp(imageBuffer)
      .resize(9, 8, { fit: 'fill' })
      .greyscale()
      .raw()
      .toBuffer();

    // Calculate dHash: compare each pixel to the next pixel in the row
    let hash = '';
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const idx = row * 9 + col;
        const left = resized[idx];
        const right = resized[idx + 1];
        hash += left < right ? '1' : '0';
      }
    }

    // Convert binary string to hex for storage efficiency
    return binaryToHex(hash);
  } catch (error) {
    console.error('Error calculating perceptual hash:', error);
    return null;
  }
}

/**
 * Extract a frame from video at specified position
 */
async function extractVideoFrame(videoPath, position = 0.5) {
  const tempDir = path.join(process.cwd(), 'temp');
  await fs.mkdir(tempDir, { recursive: true });

  const tempFrame = path.join(tempDir, `frame_${Date.now()}_${Math.random()}.jpg`);

  try {
    // First get video duration
    const metadata = await getVideoMetadata(videoPath);
    if (!metadata || !metadata.duration) {
      console.warn(`Could not get duration for ${videoPath}, using default position`);
      // Try without seeking
      const cmd = `ffmpeg -i "${videoPath}" -vframes 1 -q:v 2 "${tempFrame}" -y`;
      await execPromise(cmd, { timeout: 30000 });
    } else {
      // Calculate time in seconds based on position (0.0 to 1.0)
      const timeInSeconds = Math.max(0, metadata.duration * position);
      // Use ffmpeg to extract frame at specific time
      const cmd = `ffmpeg -ss ${timeInSeconds} -i "${videoPath}" -vframes 1 -q:v 2 "${tempFrame}" -y`;
      await execPromise(cmd, { timeout: 30000 });
    }

    const frameBuffer = await fs.readFile(tempFrame);
    await fs.unlink(tempFrame).catch(() => { }); // Clean up

    return frameBuffer;
  } catch (error) {
    console.error('Error extracting video frame:', error);
    await fs.unlink(tempFrame).catch(() => { });
    return null;
  }
}

/**
 * Get video metadata (duration, size)
 */
async function getVideoMetadata(videoPath) {
  try {
    const cmd = `ffprobe -v quiet -print_format json -show_format -show_streams "${videoPath}"`;
    const { stdout } = await execPromise(cmd, { timeout: 10000 });
    const metadata = JSON.parse(stdout);

    return {
      duration: parseFloat(metadata.format.duration) || 0,
      size: parseInt(metadata.format.size) || 0,
    };
  } catch (error) {
    console.error('Error getting video metadata:', error);
    return null;
  }
}

/**
 * Process a single file and return hash data
 */
async function processFile(filePath, performerId) {
  const ext = path.extname(filePath).toLowerCase();
  const isImage = CONFIG.imageExtensions.includes(ext);
  const isVideo = CONFIG.videoExtensions.includes(ext);

  if (!isImage && !isVideo) {
    return null; // Skip unsupported files
  }

  try {
    const stats = await fs.stat(filePath);
    const result = {
      performer_id: performerId,
      file_path: filePath,
      file_size: stats.size,
      mtime: Math.floor(stats.mtimeMs / 1000),
      exact_hash: null,
      perceptual_hash: null,
    };

    if (isImage) {
      // Calculate both hashes for images
      result.exact_hash = await calculateExactHash(filePath);
      const imageBuffer = await fs.readFile(filePath);
      result.perceptual_hash = await calculatePerceptualHash(imageBuffer);
    } else if (isVideo) {
      // For videos: store size and duration, extract frame for perceptual hash
      result.exact_hash = await calculateExactHash(filePath);
      const frameBuffer = await extractVideoFrame(filePath, CONFIG.videoFramePosition);
      if (frameBuffer) {
        result.perceptual_hash = await calculatePerceptualHash(frameBuffer);
      }
    }

    return result;
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

  // Process with limited concurrency
  for (let i = 0; i < files.length; i += CONFIG.workerConcurrency) {
    const batch = files.slice(i, i + CONFIG.workerConcurrency);
    const batchResults = await Promise.all(
      batch.map(file => processFile(file, performerId))
    );

    results.push(...batchResults.filter(r => r !== null));
    processed += batch.length;

    // Update job progress
    if (activeJobs.has(jobId)) {
      activeJobs.get(jobId).processed = processed;
      activeJobs.get(jobId).total = files.length;
    }

    if (onProgress) {
      onProgress(processed, files.length);
    }
  }

  return results;
}

/**
 * Create hash database for a performer
 * @param {number} performerId - ID of the performer
 * @param {string} basePath - Base directory path
 * @param {string} jobId - Unique job identifier
 * @param {string} mode - 'append' (default, preserve existing hashes) or 'replace' (delete existing and rebuild)
 */
async function createHashDB(performerId, basePath, jobId, mode = 'append', onProgress) {
  const job = {
    jobId,
    performerId,
    basePath,
    mode,
    status: 'running',
    processed: 0,
    total: 0,
    startTime: Date.now(),
  };

  activeJobs.set(jobId, job);

  try {
    // If mode is 'replace', mark all existing hashes for this performer as deleted
    if (mode === 'replace') {
      db.prepare('UPDATE performer_file_hashes SET deleted_flag = 1 WHERE performer_id = ?').run(performerId);
    }

    // Get all files for this performer
    const files = await discoverPerformerFiles(performerId, basePath);
    job.total = files.length;
    job.estimatedCount = files.length;

    // Process files in batches
    const hashResults = await processBatch(files, performerId, jobId, (processed, total) => {
      console.log(`Progress: ${processed}/${total} files processed`);
      if (onProgress) onProgress(processed, total);
    });

    // Store results in database
    // Use INSERT OR IGNORE to avoid breaking foreign keys, then UPDATE existing rows
    const insertStmt = db.prepare(`
      INSERT OR IGNORE INTO performer_file_hashes 
      (performer_id, file_path, file_size, mtime, exact_hash, perceptual_hash, seen_at, deleted_flag)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0)
    `);

    const updateStmt = db.prepare(`
      UPDATE performer_file_hashes 
      SET file_size = ?, mtime = ?, exact_hash = ?, perceptual_hash = ?, seen_at = ?, deleted_flag = 0
      WHERE performer_id = ? AND file_path = ?
    `);

    const insertMany = db.transaction((results) => {
      for (const result of results) {
        // Try to insert first
        const insertResult = insertStmt.run(
          result.performer_id,
          result.file_path,
          result.file_size,
          result.mtime,
          result.exact_hash,
          result.perceptual_hash,
          Math.floor(Date.now() / 1000)
        );

        // If no row was inserted (already exists), update it instead
        if (insertResult.changes === 0) {
          updateStmt.run(
            result.file_size,
            result.mtime,
            result.exact_hash,
            result.perceptual_hash,
            Math.floor(Date.now() / 1000),
            result.performer_id,
            result.file_path
          );
        }
      }
    });

    insertMany(hashResults);

    // If mode is 'replace', we used to clean up rows that are still marked deleted.
    // BUT the user wants to preserve history of deleted files to detect duplicates later.
    // So we do NOT delete them. We just leave them as deleted_flag = 1.
    if (mode === 'replace') {
      console.log('Finished recreation. Preserving stale/deleted entries for history.');
      // const deletedCount = db.prepare('DELETE FROM performer_file_hashes WHERE performer_id = ? AND deleted_flag = 1').run(performerId).changes;
      // console.log(`Removed ${deletedCount} stale hash entries (replace mode)`);
    }

    job.status = 'completed';
    job.endTime = Date.now();
    job.hashCount = hashResults.length;

    return {
      success: true,
      jobId,
      hashCount: hashResults.length,
      duration: job.endTime - job.startTime,
    };
  } catch (error) {
    job.status = 'failed';
    job.error = error.message;
    console.error('Error creating hash DB:', error);
    throw error;
  }
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
 * Get job status
 */
function getJobStatus(jobId) {
  return activeJobs.get(jobId) || null;
}

/**
 * Calculate hamming distance between two perceptual hashes
 */
function hammingDistance(hash1, hash2) {
  if (!hash1 || !hash2 || hash1.length !== hash2.length) {
    return -1;
  }

  const bin1 = hexToBinary(hash1);
  const bin2 = hexToBinary(hash2);

  let distance = 0;
  for (let i = 0; i < bin1.length; i++) {
    if (bin1[i] !== bin2[i]) {
      distance++;
    }
  }

  return distance;
}

/**
 * Check for duplicates between source and target performer
 */
async function checkDuplicates(sourcePerformerId, targetPerformerId, runId) {
  try {
    // Get all hashes for source performer (include deleted ones - they're "bad" files we want to find everywhere)
    const sourceHashes = db.prepare(`
      SELECT * FROM performer_file_hashes 
      WHERE performer_id = ?
    `).all(sourcePerformerId);

    // Get all hashes for target performer (include deleted ones too)
    const targetHashes = db.prepare(`
      SELECT * FROM performer_file_hashes 
      WHERE performer_id = ?
    `).all(targetPerformerId);

    // Create run record
    const runStmt = db.prepare(`
      INSERT INTO hash_runs (run_id, source_performer_id, target_performer_id, status, metadata)
      VALUES (?, ?, ?, 'pending', ?)
    `);

    runStmt.run(
      runId,
      sourcePerformerId,
      targetPerformerId,
      JSON.stringify({ startTime: Date.now() })
    );

    // Helper function to determine if a file is a video
    const isVideo = (filePath) => {
      const ext = filePath.toLowerCase().split('.').pop();
      return CONFIG.videoExtensions.some(e => e.slice(1) === ext);
    };

    // Helper function to determine if a file is an image
    const isImage = (filePath) => {
      const ext = filePath.toLowerCase().split('.').pop();
      return CONFIG.imageExtensions.some(e => e.slice(1) === ext);
    };

    // Track seen pairs to avoid duplicates (for internal comparisons)
    const seenPairs = new Set();

    // Compare each source file against target files
    const matches = [];

    for (const sourceHash of sourceHashes) {
      const sourceIsVideo = isVideo(sourceHash.file_path);
      const sourceIsImage = isImage(sourceHash.file_path);

      for (const targetHash of targetHashes) {
        // Skip comparing the same file (avoid self-matches when source === target performer)
        if (sourceHash.id === targetHash.id || sourceHash.file_path === targetHash.file_path) {
          continue;
        }

        // Only compare videos to videos and images to images
        const targetIsVideo = isVideo(targetHash.file_path);
        const targetIsImage = isImage(targetHash.file_path);

        if (sourceIsVideo !== targetIsVideo || sourceIsImage !== targetIsImage) {
          continue; // Skip if file types don't match
        }

        // For internal comparisons (same performer), avoid duplicate pairs (A->B and B->A)
        if (sourcePerformerId === targetPerformerId) {
          // Create a unique pair key using sorted IDs
          const pairKey = [sourceHash.id, targetHash.id].sort((a, b) => a - b).join('-');
          if (seenPairs.has(pairKey)) {
            continue; // Skip this pair, we already processed it
          }
          seenPairs.add(pairKey);
        }

        // Check exact match first
        if (sourceHash.exact_hash && targetHash.exact_hash &&
          sourceHash.exact_hash === targetHash.exact_hash) {
          matches.push({
            run_id: runId,
            file_path: sourceHash.file_path,
            file_id_ref: sourceHash.id,
            candidate_id: targetHash.id,
            exact_match: 1,
            hamming_distance: 0,
            selected: 1, // Auto-select exact matches
          });
          continue; // Continue to check for more matches (don't break)
        }

        // Check perceptual similarity
        if (sourceHash.perceptual_hash && targetHash.perceptual_hash) {
          const distance = hammingDistance(sourceHash.perceptual_hash, targetHash.perceptual_hash);

          // Consider similar if hamming distance is low (< 10 bits difference out of 64)
          if (distance >= 0 && distance < 10) {
            matches.push({
              run_id: runId,
              file_path: sourceHash.file_path,
              file_id_ref: sourceHash.id,
              candidate_id: targetHash.id,
              exact_match: 0,
              hamming_distance: distance,
              selected: distance < 5 ? 1 : 0, // Auto-select very similar matches
            });
            // Don't break - allow finding more matches for this source file
          }
        }
      }
    }

    console.log(`Total matches found before grouping: ${matches.length}`);

    // Build an adjacency graph from matches to find connected components (groups)
    const graph = new Map(); // fileId -> Set of connected fileIds
    const fileInfo = new Map();

    // Build the graph
    for (const match of matches) {
      // Add file info
      if (!fileInfo.has(match.file_id_ref)) {
        fileInfo.set(match.file_id_ref, { id: match.file_id_ref, path: match.file_path });
      }
      if (!fileInfo.has(match.candidate_id)) {
        const targetHash = [...sourceHashes, ...targetHashes].find(h => h.id === match.candidate_id);
        if (targetHash) {
          fileInfo.set(match.candidate_id, { id: match.candidate_id, path: targetHash.file_path });
        }
      }

      // Add edges (bidirectional)
      if (!graph.has(match.file_id_ref)) {
        graph.set(match.file_id_ref, new Set());
      }
      if (!graph.has(match.candidate_id)) {
        graph.set(match.candidate_id, new Set());
      }
      graph.get(match.file_id_ref).add(match.candidate_id);
      graph.get(match.candidate_id).add(match.file_id_ref);
    }

    // Find connected components using DFS
    const visited = new Set();
    const groups = [];

    const dfs = (fileId, currentGroup) => {
      if (visited.has(fileId)) return;
      visited.add(fileId);
      currentGroup.add(fileId);

      const neighbors = graph.get(fileId);
      if (neighbors) {
        for (const neighbor of neighbors) {
          dfs(neighbor, currentGroup);
        }
      }
    };

    // Find all connected components
    for (const fileId of graph.keys()) {
      if (!visited.has(fileId)) {
        const group = new Set();
        dfs(fileId, group);
        if (group.size >= 2) { // Only keep groups with 2+ files
          groups.push(group);
        }
      }
    }

    console.log(`Found ${groups.length} connected groups:`);
    for (let i = 0; i < groups.length; i++) {
      const groupArray = Array.from(groups[i]);
      console.log(`  Group ${i}: ${groupArray.length} files - IDs: ${groupArray.join(', ')}`);
    }

    // Create group-based matches: for each group, pick one file as "keeper" and mark others for removal
    const groupedMatches = [];

    for (const groupSet of groups) {
      const groupFiles = Array.from(groupSet);

      if (groupFiles.length < 2) continue; // Skip single-file groups

      // Sort by ID to have consistent ordering (lowest ID becomes the keeper)
      groupFiles.sort((a, b) => a - b);

      const keeperId = groupFiles[0]; // Keep the first one

      // Create matches for all other files in the group pointing to the keeper
      for (let i = 1; i < groupFiles.length; i++) {
        const removeId = groupFiles[i];
        const removeFile = fileInfo.get(removeId);

        if (!removeFile) {
          console.warn(`Missing file info for ID ${removeId}`);
          continue;
        }

        // Find the original match between these two files (or any match involving removeId)
        const originalMatch = matches.find(m =>
          (m.file_id_ref === removeId && m.candidate_id === keeperId) ||
          (m.file_id_ref === keeperId && m.candidate_id === removeId)
        );

        // If no direct match, find any match involving removeId
        const anyMatch = originalMatch || matches.find(m =>
          m.file_id_ref === removeId || m.candidate_id === removeId
        );

        groupedMatches.push({
          run_id: runId,
          file_path: removeFile.path,
          file_id_ref: removeId,
          candidate_id: keeperId,
          exact_match: anyMatch ? anyMatch.exact_match : 0,
          hamming_distance: anyMatch ? anyMatch.hamming_distance : 0,
          selected: 1, // Auto-select all grouped items
        });
      }
    }

    console.log(`Created ${groupedMatches.length} grouped matches from ${groups.length} groups`);

    // Use grouped matches instead of original matches
    const finalMatches = groupedMatches.length > 0 ? groupedMatches : matches;

    // Insert matches into database
    const insertStmt = db.prepare(`
      INSERT INTO hash_run_items (run_id, file_path, file_id_ref, candidate_id, exact_match, hamming_distance, selected)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = db.transaction((items) => {
      for (const item of items) {
        insertStmt.run(
          item.run_id,
          item.file_path,
          item.file_id_ref,
          item.candidate_id,
          item.exact_match,
          item.hamming_distance,
          item.selected
        );
      }
    });

    insertMany(finalMatches);

    // Update run status
    db.prepare(`
      UPDATE hash_runs 
      SET status = 'completed', 
          metadata = json_set(metadata, '$.endTime', ?)
      WHERE run_id = ?
    `).run(Date.now(), runId);

    return {
      success: true,
      runId,
      matchCount: finalMatches.length,
      exactMatches: finalMatches.filter(m => m.exact_match).length,
      perceptualMatches: finalMatches.filter(m => !m.exact_match).length,
      groupCount: groups.length,
    };
  } catch (error) {
    console.error('Error checking duplicates:', error);

    // Update run status to failed
    db.prepare(`UPDATE hash_runs SET status = 'failed' WHERE run_id = ?`).run(runId);

    throw error;
  }
}

/**
 * Get run results with optional filtering
 */
function getRunResults(runId, options = {}) {
  const { maxHammingDistance = 10, limit = 100, offset = 0 } = options;

  const items = db.prepare(`
    SELECT 
      ri.*,
      sf.id as source_file_id,
      sf.file_path as source_path,
      sf.file_size as source_size,
      sf.perceptual_hash as source_hash,
      sf.deleted_flag as source_deleted,
      tf.id as target_file_id,
      tf.file_path as target_path,
      tf.file_size as target_size,
      tf.perceptual_hash as target_hash,
      tf.deleted_flag as target_deleted
    FROM hash_run_items ri
    JOIN performer_file_hashes sf ON ri.file_id_ref = sf.id
    JOIN performer_file_hashes tf ON ri.candidate_id = tf.id
    WHERE ri.run_id = ? 
      AND (ri.exact_match = 1 OR ri.hamming_distance <= ?)
    ORDER BY ri.exact_match DESC, ri.hamming_distance ASC
    LIMIT ? OFFSET ?
  `).all(runId, maxHammingDistance, limit, offset);

  const run = db.prepare('SELECT * FROM hash_runs WHERE run_id = ?').get(runId);

  // Check file existence and update deleted_flag if needed
  const fs = require('fs');
  const updateDeletedFlag = db.prepare('UPDATE performer_file_hashes SET deleted_flag = 1 WHERE id = ?');
  const checkedPaths = new Set();

  for (const item of items) {
    // Check source file
    if (item.source_deleted !== 1 && !checkedPaths.has(item.source_path)) {
      checkedPaths.add(item.source_path);
      if (!fs.existsSync(item.source_path)) {
        updateDeletedFlag.run(item.source_file_id);
        item.source_deleted = 1;
      }
    }

    // Check target file
    if (item.target_deleted !== 1 && !checkedPaths.has(item.target_path)) {
      checkedPaths.add(item.target_path);
      if (!fs.existsSync(item.target_path)) {
        updateDeletedFlag.run(item.target_file_id);
        item.target_deleted = 1;
      }
    }
  }

  return {
    run,
    items,
    count: items.length,
  };
}

// Utility functions
function binaryToHex(binary) {
  let hex = '';
  for (let i = 0; i < binary.length; i += 4) {
    const chunk = binary.substr(i, 4);
    hex += parseInt(chunk, 2).toString(16);
  }
  return hex;
}

function hexToBinary(hex) {
  let binary = '';
  for (let i = 0; i < hex.length; i++) {
    const bin = parseInt(hex[i], 16).toString(2);
    binary += bin.padStart(4, '0');
  }
  return binary;
}

/**
 * Check internal duplicates for a performer (self-comparison)
 * Uses 90% similarity threshold (hamming distance <= 6 out of 64 bits)
 * @param {number} performerId - Performer ID
 * @returns {Object} - Run results with duplicate count
 */
async function checkInternalDuplicates(performerId) {
  const runId = `internal-${performerId}-${Date.now()}`;

  try {
    // Run self-comparison
    const result = await checkDuplicates(performerId, performerId, runId);

    // Count matches at 90% threshold (hamming <= 6)
    // The checkDuplicates already filters by threshold 10, but we want 90% (6 bits)
    const items = db.prepare(`
      SELECT COUNT(*) as count FROM hash_run_items 
      WHERE run_id = ? AND (exact_match = 1 OR hamming_distance <= 6)
    `).get(runId);

    const duplicateCount = items ? items.count : 0;

    // Update performer record
    db.prepare(`
      UPDATE performers 
      SET latest_internal_run_id = ?, 
          internal_duplicate_count = ?,
          hash_verified = 0
      WHERE id = ?
    `).run(runId, duplicateCount, performerId);

    console.log(`Internal dup check for performer ${performerId}: ${duplicateCount} duplicates found`);

    return {
      success: true,
      runId,
      duplicateCount,
      matchCount: result.matchCount,
      exactMatches: result.exactMatches,
      perceptualMatches: result.perceptualMatches,
    };
  } catch (error) {
    console.error('Error in internal duplicate check:', error);
    throw error;
  }
}

/**
 * Toggle hash_verified status for a performer
 * @param {number} performerId - Performer ID
 * @param {boolean} verified - New verified status
 */
function setHashVerified(performerId, verified) {
  db.prepare('UPDATE performers SET hash_verified = ? WHERE id = ?')
    .run(verified ? 1 : 0, performerId);
  return { success: true, verified };
}

/**
 * Get performer's hash status (verified, dup count, run id)
 * @param {number} performerId - Performer ID
 */
function getPerformerHashStatus(performerId) {
  const performer = db.prepare(`
    SELECT hash_verified, latest_internal_run_id, internal_duplicate_count 
    FROM performers WHERE id = ?
  `).get(performerId);

  return performer || { hash_verified: 0, latest_internal_run_id: null, internal_duplicate_count: 0 };
}

/**
 * Reset hash_verified when performer data changes (e.g., merge)
 * @param {number} performerId - Performer ID
 */
function resetHashVerified(performerId) {
  db.prepare('UPDATE performers SET hash_verified = 0 WHERE id = ?').run(performerId);
}

module.exports = {
  createHashDB,
  getJobStatus,
  checkDuplicates,
  getRunResults,
  hammingDistance,
  checkInternalDuplicates,
  setHashVerified,
  getPerformerHashStatus,
  resetHashVerified,
  CONFIG,
};
