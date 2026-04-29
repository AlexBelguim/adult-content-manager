const express = require('express');
const router = express.Router();
const { importPerformer } = require('../services/importer');
const { scanPerformerFolder } = require('../services/fileScanner');
const merger = require('../services/merger');
const db = require('../db');
const fs = require('fs-extra');
const path = require('path');
const { findPerformerByNameOrAlias, findFuzzyMatches } = require('../utils/performerMatcher');

/**
 * Handle deleted file - either move to training folder or permanently delete
 * based on save_deleted_for_training setting
 */
async function handleDeletedFile(filePath, performerName, basePath, fileType) {
  try {
    const setting = db.prepare('SELECT value FROM app_settings WHERE key = ?').get('save_deleted_for_training');
    const saveForTraining = setting && setting.value === 'true';

    console.log(`handleDeletedFile: file=${path.basename(filePath)}, performer=${performerName}, type=${fileType}, setting=${setting?.value}, saveForTraining=${saveForTraining}`);

    if (saveForTraining) {
      // Move to training folder
      const subfolder = fileType === 'video' || fileType === 'funscript' ? 'vids' : 'pics';
      const destFolder = path.join(basePath, 'deleted keep for training', performerName, subfolder);
      await fs.ensureDir(destFolder);

      const fileName = path.basename(filePath);
      const destPath = path.join(destFolder, fileName);

      // If file already exists in destination, append timestamp
      if (await fs.pathExists(destPath)) {
        const ext = path.extname(fileName);
        const nameWithoutExt = path.basename(fileName, ext);
        const timestamp = Date.now();
        const newDestPath = path.join(destFolder, `${nameWithoutExt}_${timestamp}${ext}`);
        await fs.move(filePath, newDestPath, { overwrite: false });
      } else {
        await fs.move(filePath, destPath, { overwrite: false });
      }

      return { saved: true, path: destFolder };
    } else {
      // Permanently delete
      await fs.remove(filePath);
      return { saved: false };
    }
  } catch (err) {
    console.error('Error handling deleted file:', err);
    // Fallback to deletion if move fails
    try {
      await fs.remove(filePath);
    } catch (e) {
      console.error('Failed to delete file:', e);
    }
    return { saved: false, error: err.message };
  }
}

function normalizeRating(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim().toLowerCase();
    if (trimmed === 'null' || trimmed === 'undefined') {
      return null;
    }
  }

  const parsed = parseFloat(value);
  if (!Number.isFinite(parsed)) {
    throw new Error('Rating must be a number');
  }
  if (parsed < 0 || parsed > 5) {
    throw new Error('Rating must be between 0 and 5');
  }

  return Math.round(parsed * 2) / 2;
}

// Get all performers
router.get('/', (req, res) => {
  try {
    const performers = db.prepare(`
      SELECT p.*, f.path as folder_path 
      FROM performers p 
      JOIN folders f ON p.folder_id = f.id
    `).all();
    console.log('All performers query returned:', performers.length, 'performers');
    res.send(performers);
  } catch (err) {
    console.error('Error getting all performers:', err);
    res.status(500).send({ error: err.message });
  }
});

// Get performers by folder
router.get('/folder/:folderId', (req, res) => {
  const { folderId } = req.params;
  try {
    const performers = db.prepare(`
      SELECT p.*, f.path as folder_path 
      FROM performers p 
      JOIN folders f ON p.folder_id = f.id
      WHERE p.folder_id = ?
    `).all(folderId);
    res.send(performers);
  } catch (err) {
    res.status(500).send({ error: err.message });
  }
});

// Check if performer is blacklisted
router.get('/check-blacklist', (req, res) => {
  try {
    const { name } = req.query;

    if (!name) {
      return res.status(400).send({ error: 'name parameter is required' });
    }

    // Check by name and aliases
    const blacklistedPerformer = findPerformerByNameOrAlias(name, [], null);

    if (blacklistedPerformer && blacklistedPerformer.blacklisted === 1) {
      return res.send({
        blacklisted: true,
        reason: blacklistedPerformer.blacklist_reason,
        blacklistedDate: blacklistedPerformer.blacklist_date,
        performerId: blacklistedPerformer.id
      });
    }

    res.send({ blacklisted: false });
  } catch (err) {
    console.error('Error checking blacklist:', err);
    res.status(500).send({ error: err.message });
  }
});

// Get performers ready to move
router.get('/ready-to-move/:folderId', async (req, res) => {
  const { folderId } = req.params;
  try {
    const performers = await merger.getPerformerReadyToMove(folderId);
    res.send(performers);
  } catch (err) {
    res.status(500).send({ error: err.message });
  }
});

// Get performers for filter mode (from 'before filter performer' folder)
router.get('/filter', (req, res) => {
  try {
    const { limit = 12, offset = 0, sortBy = 'size-desc', searchTerm = '' } = req.query;
    const parsedLimit = parseInt(limit, 10);
    const parsedOffset = parseInt(offset, 10);

    // Check if sorting by completion percentage (requires post-fetch sorting)
    const isCompletionSort = sortBy.includes('completion');

    // Build ORDER BY clause based on sortBy parameter
    let orderByClause = '';
    if (!isCompletionSort) {
      switch (sortBy) {
        case 'size-desc':
          orderByClause = 'ORDER BY p.total_size_gb DESC';
          break;
        case 'size-asc':
          orderByClause = 'ORDER BY p.total_size_gb ASC';
          break;
        case 'name-asc':
          orderByClause = 'ORDER BY p.name ASC';
          break;
        case 'name-desc':
          orderByClause = 'ORDER BY p.name DESC';
          break;
        case 'date-desc':
          orderByClause = 'ORDER BY p.import_date DESC';
          break;
        case 'date-asc':
          orderByClause = 'ORDER BY p.import_date ASC';
          break;
        case 'pics-desc':
          orderByClause = 'ORDER BY p.pics_count DESC';
          break;
        case 'pics-asc':
          orderByClause = 'ORDER BY p.pics_count ASC';
          break;
        case 'vids-desc':
          orderByClause = 'ORDER BY p.vids_count DESC';
          break;
        case 'vids-asc':
          orderByClause = 'ORDER BY p.vids_count ASC';
          break;
        case 'funscript-desc':
          orderByClause = 'ORDER BY p.funscript_vids_count DESC';
          break;
        case 'funscript-asc':
          orderByClause = 'ORDER BY p.funscript_vids_count ASC';
          break;
        default:
          orderByClause = 'ORDER BY p.total_size_gb DESC';
      }
    }

    // Build WHERE clause for search
    const searchCondition = searchTerm ? `AND p.name LIKE ?` : '';
    const searchParam = searchTerm ? `%${searchTerm}%` : null;

    // Get total count for pagination (with search filter, excluding blacklisted)
    const totalCountQuery = `
      SELECT COUNT(*) as count
      FROM performers p 
      WHERE p.moved_to_after = 0 AND (p.blacklisted IS NULL OR p.blacklisted = 0) ${searchCondition}
    `;
    const totalCountResult = searchParam
      ? db.prepare(totalCountQuery).get(searchParam)
      : db.prepare(totalCountQuery).get();
    const totalCount = totalCountResult.count;

    // Add filter statistics for each performer
    const filterService = require('../services/filterService');

    let performersWithStats;

    if (isCompletionSort) {
      // For completion-based sorting, fetch ALL performers first, add stats, sort, then paginate
      const allPerformersQuery = `
        SELECT p.*, f.path as folder_path 
        FROM performers p 
        JOIN folders f ON p.folder_id = f.id
        WHERE p.moved_to_after = 0 AND (p.blacklisted IS NULL OR p.blacklisted = 0) ${searchCondition}
      `;
      const allPerformers = searchParam
        ? db.prepare(allPerformersQuery).all(searchParam)
        : db.prepare(allPerformersQuery).all();

      // Add filter stats to all performers - use FAST version for bulk requests
      const allWithStats = allPerformers.map(performer => {
        const filterStats = filterService.getFilterStatsFast(performer.id);
        return {
          ...performer,
          filterStats
        };
      });

      // Sort by completion percentage
      allWithStats.sort((a, b) => {
        let aVal, bVal;
        switch (sortBy) {
          case 'pics-completion-asc':
            aVal = a.filterStats?.picsCompletion ?? 100;
            bVal = b.filterStats?.picsCompletion ?? 100;
            return aVal - bVal;
          case 'pics-completion-desc':
            aVal = a.filterStats?.picsCompletion ?? 100;
            bVal = b.filterStats?.picsCompletion ?? 100;
            return bVal - aVal;
          case 'vids-completion-asc':
            aVal = a.filterStats?.vidsCompletion ?? 100;
            bVal = b.filterStats?.vidsCompletion ?? 100;
            return aVal - bVal;
          case 'vids-completion-desc':
            aVal = a.filterStats?.vidsCompletion ?? 100;
            bVal = b.filterStats?.vidsCompletion ?? 100;
            return bVal - aVal;
          case 'overall-completion-asc':
            aVal = a.filterStats?.completion ?? 100;
            bVal = b.filterStats?.completion ?? 100;
            return aVal - bVal;
          case 'overall-completion-desc':
            aVal = a.filterStats?.completion ?? 100;
            bVal = b.filterStats?.completion ?? 100;
            return bVal - aVal;
          default:
            return 0;
        }
      });

      // Apply pagination after sorting
      performersWithStats = allWithStats.slice(parsedOffset, parsedOffset + parsedLimit);
    } else {
      // For regular sorting, use database ORDER BY with pagination
      const performersQuery = `
        SELECT p.*, f.path as folder_path 
        FROM performers p 
        JOIN folders f ON p.folder_id = f.id
        WHERE p.moved_to_after = 0 AND (p.blacklisted IS NULL OR p.blacklisted = 0) ${searchCondition}
        ${orderByClause}
        LIMIT ? OFFSET ?
      `;
      const performers = searchParam
        ? db.prepare(performersQuery).all(searchParam, parsedLimit, parsedOffset)
        : db.prepare(performersQuery).all(parsedLimit, parsedOffset);

      // Add filter statistics for each performer - use FAST version for bulk requests
      performersWithStats = performers.map(performer => {
        const filterStats = filterService.getFilterStatsFast(performer.id);
        return {
          ...performer,
          filterStats
        };
      });
    }

    res.send({
      performers: performersWithStats,
      totalCount,
      limit: parsedLimit,
      offset: parsedOffset,
      sortBy,
      searchTerm
    });
  } catch (err) {
    res.status(500).send({ error: err.message });
  }
});

// Get performers for gallery mode (from 'after filter performer' folder)
router.get('/gallery', (req, res) => {
  try {
    const performers = db.prepare(`
      SELECT p.*, f.path as folder_path 
      FROM performers p 
      JOIN folders f ON p.folder_id = f.id
      WHERE p.moved_to_after = 1
    `).all();

    // Ensure proper UTF-8 encoding for emojis
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.send(performers);
  } catch (err) {
    res.status(500).send({ error: err.message });
  }
});

router.post('/:id/rating', (req, res) => {
  const { id } = req.params;
  const { rating } = req.body;

  try {
    const normalized = normalizeRating(rating);
    const result = db.prepare('UPDATE performers SET performer_rating = ? WHERE id = ?').run(normalized, id);

    if (!result.changes) {
      return res.status(404).send({ error: 'Performer not found' });
    }

    // Notify clients about the update
    const io = req.app.get('io');
    if (io) {
      io.emit('performers_updated', { performerId: Number(id), type: 'rating_updated', rating: normalized });
    }

    res.send({
      success: true,
      performerId: Number(id),
      rating: normalized
    });
  } catch (error) {
    console.error('Failed to save performer rating:', error);
    res.status(400).send({ error: error.message });
  }
});

// Get performer lightweight data (for thumbnail selector)
router.get('/:id/lite', (req, res) => {
  const { id } = req.params;
  console.time(`performers-lite-${id}`);
  try {
    const performer = db.prepare(`
      SELECT 
        p.id, p.name, p.folder_id, 
        p.thumbnail, p.thumbnail_paths,
        p.thumbnail_transition_type,
        p.thumbnail_transition_time,
        p.thumbnail_transition_speed
      FROM performers p 
      WHERE p.id = ?
    `).get(id);

    if (!performer) {
      console.timeEnd(`performers-lite-${id}`);
      return res.status(404).send({ error: 'Performer not found' });
    }

    console.timeEnd(`performers-lite-${id}`);
    res.send(performer);
  } catch (err) {
    console.error('Error getting performer lite:', err);
    res.status(500).send({ error: err.message });
  }
});

// Get performer by ID
router.get('/:id', (req, res) => {
  const { id } = req.params;
  console.log('Getting performer by ID:', id);
  try {
    const performer = db.prepare(`
      SELECT p.*, f.path as folder_path 
      FROM performers p 
      JOIN folders f ON p.folder_id = f.id
      WHERE p.id = ?
    `).get(id);

    console.log('Found performer:', performer);

    if (!performer) {
      console.log('No performer found with ID:', id);
      return res.status(404).send({ error: 'Performer not found' });
    }

    res.send(performer);
  } catch (err) {
    console.error('Error getting performer by ID:', err);
    res.status(500).send({ error: err.message });
  }
});

// Update performer thumbnail
router.post('/:id/thumbnail', async (req, res) => {
  const { id } = req.params;
  const { thumbnailPath } = req.body;

  try {
    db.prepare('UPDATE performers SET thumbnail = ? WHERE id = ?').run(thumbnailPath, id);

    const io = req.app.get('io');
    if (io) {
      io.emit('performers_updated', { performerId: Number(id), type: 'thumbnail_updated', thumbnail: thumbnailPath });
    }

    res.send({ success: true, message: 'Thumbnail updated' });
  } catch (err) {
    res.status(500).send({ error: err.message });
  }
});

// Update performer thumbnail slideshow
router.post('/:id/thumbnail-slideshow', async (req, res) => {
  const { id } = req.params;
  const { thumbnailPaths, transitionType, transitionTime, transitionSpeed } = req.body;

  try {
    if (!Array.isArray(thumbnailPaths) || thumbnailPaths.length === 0) {
      return res.status(400).send({ error: 'thumbnailPaths must be a non-empty array' });
    }

    // Store the array as JSON
    const thumbnailPathsJson = JSON.stringify(thumbnailPaths);

    // Set the first image as the main thumbnail for backward compatibility
    const firstThumbnail = thumbnailPaths[0];

    // Update all fields
    db.prepare(`
      UPDATE performers 
      SET thumbnail = ?, 
          thumbnail_paths = ?, 
          thumbnail_transition_type = ?,
          thumbnail_transition_time = ?,
          thumbnail_transition_speed = ?
      WHERE id = ?
    `).run(
      firstThumbnail,
      thumbnailPathsJson,
      transitionType || 'fade',
      transitionTime || 3.0,
      transitionSpeed || 0.5,
      id
    );

    res.send({
      success: true,
      message: 'Thumbnail slideshow updated',
      thumbnailPath: firstThumbnail,
      thumbnailPaths: thumbnailPaths,
      transitionType: transitionType || 'fade',
      transitionTime: transitionTime || 3.0,
      transitionSpeed: transitionSpeed || 0.5
    });
  } catch (err) {
    res.status(500).send({ error: err.message });
  }
});

// Generate random thumbnail for performer
router.post('/:id/random-thumbnail', async (req, res) => {
  const { id } = req.params;

  try {
    const performer = db.prepare('SELECT * FROM performers WHERE id = ?').get(id);
    if (!performer) {
      return res.status(404).send({ error: 'Performer not found' });
    }

    const folder = db.prepare('SELECT * FROM folders WHERE id = ?').get(performer.folder_id);
    if (!folder) {
      return res.status(404).send({ error: 'Folder not found' });
    }

    // Determine correct pics path based on whether performer was moved to after folder
    let picsPath;
    if (performer.moved_to_after === 1) {
      // Gallery mode - look in "after filter performer" folder
      picsPath = path.join(folder.path, 'after filter performer', performer.name, 'pics');
    } else {
      // Filter mode - look in "before filter performer" folder
      picsPath = path.join(folder.path, 'before filter performer', performer.name, 'pics');
    }

    if (!await fs.pathExists(picsPath)) {
      return res.status(404).send({ error: 'No pics folder found' });
    }

    const pics = await fs.readdir(picsPath);
    const imageFiles = pics.filter(file =>
      ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(path.extname(file).toLowerCase())
    );

    if (imageFiles.length === 0) {
      return res.status(404).send({ error: 'No images found' });
    }

    // Select random image
    const randomImage = imageFiles[Math.floor(Math.random() * imageFiles.length)];
    const newThumbnailPath = path.join(picsPath, randomImage);

    // Update database
    db.prepare('UPDATE performers SET thumbnail = ? WHERE id = ?').run(newThumbnailPath, id);

    res.send({
      success: true,
      message: 'Random thumbnail generated',
      thumbnailPath: newThumbnailPath
    });
  } catch (err) {
    res.status(500).send({ error: err.message });
  }
});

// In-memory cache for performer file lists (cleared when performer data changes)
const performerFilesCache = new Map();

// Helper to clear cache for a performer
function clearPerformerFilesCache(performerId) {
  try {
    db.prepare('DELETE FROM performer_file_cache WHERE performer_id = ?').run(performerId);
  } catch (err) {
    console.error('Error clearing performer file cache:', err);
  }
}

// Get all image files for performer (for thumbnail selection) - with streaming
router.get('/:id/images', async (req, res) => {
  const { id } = req.params;
  const { stream } = req.query; // ?stream=true for Socket.IO streaming mode
  const cacheKey = `pics-${id}`;

  // Check persistent DB cache first
  try {
    const cached = db.prepare('SELECT data FROM performer_file_cache WHERE performer_id = ? AND type = ?').get(id, 'pics');
    if (cached) {
      const files = JSON.parse(cached.data);
      return res.send({ pics: files, count: files.length, fromCache: true });
    }
  } catch (err) {
    console.error('Error checking DB cache:', err);
  }

  try {
    const performer = db.prepare('SELECT * FROM performers WHERE id = ?').get(id);
    if (!performer) {
      return res.status(404).send({ error: 'Performer not found' });
    }

    const folder = db.prepare('SELECT * FROM folders WHERE id = ?').get(performer.folder_id);
    if (!folder) {
      return res.status(404).send({ error: 'Folder not found' });
    }

    // Determine correct pics path based on whether performer was moved to after folder
    let picsPath;
    if (performer.moved_to_after === 1) {
      picsPath = path.join(folder.path, 'after filter performer', performer.name, 'pics');
    } else {
      picsPath = path.join(folder.path, 'before filter performer', performer.name, 'pics');
    }

    if (!await fs.pathExists(picsPath)) {
      return res.send({ pics: [], count: 0 });
    }

    const io = req.app.get('io');

    // If streaming mode, return count immediately and stream files
    if (stream === 'true' && io) {
      // Use fs.opendir for streaming directory reading
      const dir = await fs.opendir(picsPath);
      const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
      let count = 0;
      let batch = [];
      const batchSize = 20; // Send in batches of 20
      const allFiles = []; // Collect for cache

      // First, quickly count files (still need to iterate but don't build full array)
      for await (const dirent of dir) {
        if (dirent.isFile() && imageExtensions.includes(path.extname(dirent.name).toLowerCase())) {
          count++;
          const fileObj = {
            path: path.join(picsPath, dirent.name),
            name: dirent.name
          };

          batch.push(fileObj);
          allFiles.push(fileObj);

          // Emit batch when full
          if (batch.length >= batchSize) {
            io.emit('performer_images_batch', {
              performerId: id,
              files: batch,
              progress: count
            });
            batch = [];
          }
        }
      }

      // Emit remaining files
      if (batch.length > 0) {
        io.emit('performer_images_batch', {
          performerId: id,
          files: batch,
          progress: count
        });
      }

      // Cache the result in DB
      try {
        db.prepare(`
          INSERT OR REPLACE INTO performer_file_cache (performer_id, type, data) 
          VALUES (?, ?, ?)
        `).run(id, 'pics', JSON.stringify(allFiles));
      } catch (err) {
        console.error('Failed to cache files to DB:', err);
      }

      // Emit completion
      io.emit('performer_images_complete', { performerId: id, count });

      // Return just the count for immediate response
      return res.send({ pics: [], count, streaming: true });
    }

    // Non-streaming mode: read all at once (for backwards compatibility)
    const pics = await fs.readdir(picsPath);
    const imageFiles = pics.filter(file =>
      ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(path.extname(file).toLowerCase())
    );

    // Return full paths
    const imagePaths = imageFiles.map(file => ({
      path: path.join(picsPath, file),
      name: file
    }));

    // Cache the result
    performerFilesCache.set(cacheKey, {
      data: imagePaths,
      timestamp: Date.now()
    });

    res.send({ pics: imagePaths, count: imagePaths.length });
  } catch (err) {
    res.status(500).send({ error: err.message });
  }
});

// Mark filtering as complete for a type
router.post('/:id/complete-filtering', async (req, res) => {
  const { id } = req.params;
  const { type } = req.body; // 'pics', 'vids', or 'funscript_vids'

  try {
    const result = await merger.markPerformerFilteringComplete(id, type);
    res.send(result);
  } catch (err) {
    res.status(500).send({ error: err.message });
  }
});

// Move performer to after folder (async - returns job ID immediately)
router.post('/:id/move-to-after-async', async (req, res) => {
  const { id } = req.params;
  const { keepCurrentThumbnail, merge } = req.body;

  try {
    const performer = db.prepare('SELECT * FROM performers WHERE id = ?').get(id);
    if (!performer) {
      return res.status(404).send({ error: 'Performer not found' });
    }

    const jobId = `move-to-after-${id}-${Date.now()}`;

    // Store initial job status
    backgroundTasks.set(jobId, {
      id: jobId,
      type: 'move-to-after',
      performerId: id,
      performerName: performer.name,
      status: 'processing',
      startTime: Date.now(),
      progress: 0,
      merge: merge || false,
    });

    // Start move in background
    (async () => {
      try {
        backgroundTasks.set(jobId, {
          ...backgroundTasks.get(jobId),
          progress: 10,
          progressText: 'Checking performer location...',
        });

        const result = await merger.movePerformerToAfter(id, keepCurrentThumbnail);

        backgroundTasks.set(jobId, {
          ...backgroundTasks.get(jobId),
          progress: 90,
          progressText: 'Finalizing...',
        });

        // Small delay to show the progress update
        await new Promise(resolve => setTimeout(resolve, 100));

        backgroundTasks.set(jobId, {
          ...backgroundTasks.get(jobId),
          progress: 100,
          status: 'completed',
          endTime: Date.now(),
          result: result.merged ? `Merged with existing performer` : `Moved to after filter folder`,
        });

        console.log(`Async move-to-after completed for ${performer.name}${result.merged ? ' (merged)' : ''}`);

        // Notify clients about the update
        // We need to access io here somehow. Since this is an async closure, we can capture req.app.get('io') from outside if available
        // BUT wait, req is available in the outer scope!
        const io = req.app.get('io');
        if (io) {
          io.emit('performers_updated', { performerId: id, type: 'performer_moved', jobId });
        }

      } catch (error) {
        console.error('Error in async move-to-after:', error);
        backgroundTasks.set(jobId, {
          ...backgroundTasks.get(jobId),
          status: 'error',
          error: error.message,
          endTime: Date.now(),
        });
      }
    })();

    res.send({ success: true, jobId });
  } catch (err) {
    console.error('Error starting async move-to-after:', err);
    res.status(500).send({ error: err.message });
  }
});

// Move performer to after folder (synchronous - kept for backward compatibility)
router.post('/:id/move-to-after', async (req, res) => {
  const { id } = req.params;
  const { keepCurrentThumbnail } = req.body;

  try {
    const result = await merger.movePerformerToAfter(id, keepCurrentThumbnail);
    res.send(result);
  } catch (err) {
    if (err.message.includes('Merge required')) {
      res.status(409).send({ error: err.message, requiresMerge: true });
    } else {
      res.status(500).send({ error: err.message });
    }
  }
});

// Merge performer with existing one in after folder
router.post('/:id/merge', async (req, res) => {
  const { id } = req.params;
  const { keepCurrentThumbnail } = req.body;

  try {
    const result = await merger.mergePerformers(id, { keepCurrentThumbnail });
    res.send(result);
  } catch (err) {
    res.status(500).send({ error: err.message });
  }
});

// Move performer back to "before filter performer" folder
router.post('/:id/move-to-before', async (req, res) => {
  const { id } = req.params;

  try {
    const performer = db.prepare('SELECT * FROM performers WHERE id = ?').get(id);
    if (!performer) {
      return res.status(404).send({ error: 'Performer not found' });
    }

    const folder = db.prepare('SELECT * FROM folders WHERE id = ?').get(performer.folder_id);
    const afterPath = path.join(folder.path, 'after filter performer', performer.name);
    const beforePath = path.join(folder.path, 'before filter performer', performer.name);

    // Check if performer is actually in "after filter performer" folder
    if (!await fs.pathExists(afterPath)) {
      return res.status(400).send({ error: 'Performer folder not found in "after filter performer"' });
    }

    // Check if destination doesn't already exist
    if (await fs.pathExists(beforePath)) {
      return res.status(400).send({ error: 'Performer folder already exists in "before filter performer"' });
    }

    // Move the folder
    await fs.move(afterPath, beforePath);

    // Update file paths in hash database
    db.prepare(`
      UPDATE performer_file_hashes 
      SET file_path = REPLACE(file_path, 'after filter performer', 'before filter performer')
      WHERE performer_id = ? AND file_path LIKE '%after filter performer%'
    `).run(id);

    // Reset all filter data - clear filter actions and reset flags
    db.prepare('DELETE FROM filter_actions WHERE performer_id = ?').run(id);
    db.prepare(`
      UPDATE performers 
      SET moved_to_after = 0, ready_to_move = 0,
          pics_filtered = 0, vids_filtered = 0, funscript_vids_filtered = 0
      WHERE id = ?
    `).run(id);

    res.send({
      success: true,
      message: `Performer ${performer.name} moved back to "before filter performer"`
    });
  } catch (err) {
    console.error('Error moving performer back:', err);
    res.status(500).send({ error: err.message });
  }
});

// Delete performer data
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  const { deleteFromSystem } = req.query;

  try {
    const result = await merger.deletePerformerData(id, deleteFromSystem === 'true');
    res.send(result);
  } catch (err) {
    res.status(500).send({ error: err.message });
  }
});

// Refresh performer stats
router.post('/:id/refresh-stats', async (req, res) => {
  const { id } = req.params;

  try {
    const performer = db.prepare(`
      SELECT p.*, f.path as folder_path 
      FROM performers p 
      JOIN folders f ON p.folder_id = f.id
      WHERE p.id = ?
    `).get(id);

    if (!performer) {
      return res.status(404).send({ error: 'Performer not found' });
    }

    // Determine correct path based on whether performer was moved to after folder
    let performerPath;
    if (performer.moved_to_after === 1) {
      performerPath = path.join(performer.folder_path, 'after filter performer', performer.name);
    } else {
      performerPath = path.join(performer.folder_path, 'before filter performer', performer.name);
    }

    // Use enhanced scanning method from importer service
    const { scanPerformerFolderEnhanced } = require('../services/importer');
    const stats = await scanPerformerFolderEnhanced(performerPath);

    // Update cached paths
    const picsPath = path.join(performerPath, 'pics');
    const vidsPath = path.join(performerPath, 'vids');
    const funscriptPath = path.join(vidsPath, 'funscript');
    const now = new Date().toISOString();

    db.prepare(`
      UPDATE performers 
      SET pics_count = ?, vids_count = ?, funscript_vids_count = ?, 
          funscript_files_count = ?, total_size_gb = ?,
          last_scan_date = ?, cached_pics_path = ?, cached_vids_path = ?, cached_funscript_path = ?
      WHERE id = ?
    `).run(
      stats.pics_count,
      stats.vids_count,
      stats.funscript_vids_count,
      stats.funscript_files_count,
      stats.total_size_gb,
      now,
      picsPath,
      vidsPath,
      funscriptPath,
      id
    );

    // Only set original counts if they are currently 0 or NULL (first-time baseline)
    const current = db.prepare('SELECT pics_original_count, vids_original_count, funscript_vids_original_count FROM performers WHERE id = ?').get(id);
    if (current && (!current.pics_original_count && !current.vids_original_count && !current.funscript_vids_original_count)) {
      db.prepare(`
        UPDATE performers 
        SET pics_original_count = ?, vids_original_count = ?, funscript_vids_original_count = ?
        WHERE id = ?
      `).run(stats.pics_count, stats.vids_count, stats.funscript_vids_count, id);
    }

    // Notify clients about the update
    const io = req.app.get('io');
    if (io) {
      // We can either send just the ID or the full updated list or the updated items
      // For simplicity/robustness, let's signal a general update or send the updated performer ID
      io.emit('performers_updated', { performerId: id, type: 'stats_refreshed' });
    }

    res.send({ success: true, message: 'Stats refreshed', stats });
  } catch (err) {
    console.error('Error refreshing stats:', err);
    res.status(500).send({ error: err.message });
  }
});

// Refresh performer stats using enhanced scanning (same method as import modal)
router.post('/:id/refresh-stats-enhanced', async (req, res) => {
  const { id } = req.params;

  try {
    const performer = db.prepare(`
      SELECT p.*, f.path as folder_path 
      FROM performers p 
      JOIN folders f ON p.folder_id = f.id
      WHERE p.id = ?
    `).get(id);

    if (!performer) {
      return res.status(404).send({ error: 'Performer not found' });
    }

    // Determine correct path based on whether performer was moved to after folder
    let performerPath;
    if (performer.moved_to_after === 1) {
      performerPath = path.join(performer.folder_path, 'after filter performer', performer.name);
    } else {
      performerPath = path.join(performer.folder_path, 'before filter performer', performer.name);
    }

    // Use enhanced scanning method from importer service
    const { scanPerformerFolderEnhanced } = require('../services/importer');
    const stats = await scanPerformerFolderEnhanced(performerPath);

    // Update cached paths
    const picsPath = path.join(performerPath, 'pics');
    const vidsPath = path.join(performerPath, 'vids');
    const funscriptPath = path.join(vidsPath, 'funscript');
    const now = new Date().toISOString();

    db.prepare(`
      UPDATE performers 
      SET pics_count = ?, vids_count = ?, funscript_vids_count = ?, 
          funscript_files_count = ?, total_size_gb = ?,
          last_scan_date = ?, cached_pics_path = ?, cached_vids_path = ?, cached_funscript_path = ?
      WHERE id = ?
    `).run(
      stats.pics_count,
      stats.vids_count,
      stats.funscript_vids_count,
      stats.funscript_files_count,
      stats.total_size_gb,
      now,
      picsPath,
      vidsPath,
      funscriptPath,
      id
    );

    // Only set original counts if they are currently 0 or NULL (first-time baseline)
    const current = db.prepare('SELECT pics_original_count, vids_original_count, funscript_vids_original_count FROM performers WHERE id = ?').get(id);
    if (current && (!current.pics_original_count && !current.vids_original_count && !current.funscript_vids_original_count)) {
      db.prepare(`
        UPDATE performers 
        SET pics_original_count = ?, vids_original_count = ?, funscript_vids_original_count = ?
        WHERE id = ?
      `).run(stats.pics_count, stats.vids_count, stats.funscript_vids_count, id);
    }

    res.send({ success: true, message: 'Stats refreshed using enhanced scanning', stats });
  } catch (err) {
    console.error('Error refreshing enhanced stats:', err);
    res.status(500).send({ error: err.message });
  }
});

// Complete performer filtering (set to 100%) and advance to next
router.post('/:id/complete', async (req, res) => {
  const { id } = req.params;

  try {
    const performer = db.prepare('SELECT * FROM performers WHERE id = ?').get(id);
    if (!performer) {
      return res.status(404).send({ error: 'Performer not found' });
    }

    // Mark all file types as complete (100%)
    const updateQuery = `
      UPDATE performers SET 
        pics_filtered = pics_count,
        vids_filtered = vids_count,
        funscript_vids_filtered = funscript_vids_count
      WHERE id = ?
    `;

    db.prepare(updateQuery).run(id);

    // Get next performer that needs filtering
    const nextPerformer = db.prepare(`
      SELECT * FROM performers 
      WHERE id > ? 
      AND (
        pics_filtered < pics_count OR 
        vids_filtered < vids_count OR 
        funscript_vids_filtered < funscript_vids_count
      )
      ORDER BY id ASC 
      LIMIT 1
    `).get(id);

    res.send({
      success: true,
      message: 'Performer marked as complete',
      nextPerformer: nextPerformer || null
    });
  } catch (err) {
    res.status(500).send({ error: err.message });
  }
});

// Get next performer without completing current one
router.get('/next/:id', async (req, res) => {
  const { id } = req.params;

  try {
    console.log(`Finding next performer after ID: ${id}`);

    // Get all performers to debug
    const allPerformers = db.prepare(`
      SELECT id, name, pics_count, vids_count, funscript_vids_count, 
             pics_filtered, vids_filtered, funscript_vids_filtered
      FROM performers 
      ORDER BY id ASC
    `).all();

    console.log('All performers:', allPerformers);

    // Get next performer that needs filtering
    const nextPerformer = db.prepare(`
      SELECT * FROM performers 
      WHERE id > ? 
      AND (
        pics_filtered < pics_count OR 
        vids_filtered < vids_count OR 
        funscript_vids_filtered < funscript_vids_count
      )
      ORDER BY id ASC 
      LIMIT 1
    `).get(id);

    console.log('Next performer found:', nextPerformer);

    res.send({
      success: true,
      nextPerformer: nextPerformer || null
    });
  } catch (err) {
    res.status(500).send({ error: err.message });
  }
});

// Get performer settings and status
router.get('/:id/settings', async (req, res) => {
  const { id } = req.params;

  try {
    const performer = db.prepare('SELECT * FROM performers WHERE id = ?').get(id);
    if (!performer) {
      return res.status(404).send({ error: 'Performer not found' });
    }

    const folder = db.prepare('SELECT * FROM folders WHERE id = ?').get(performer.folder_id);

    // Check if performer is ready to move (all filtering complete)
    const isReadyToMove = (
      performer.pics_filtered >= performer.pics_count &&
      performer.vids_filtered >= performer.vids_count &&
      performer.funscript_vids_filtered >= performer.funscript_vids_count
    );

    // Check if after folder exists and if performer already exists there
    const afterPath = path.join(folder.path, 'after filter performer', performer.name);
    const existsInAfter = await fs.pathExists(afterPath);

    res.send({
      performer,
      isReadyToMove,
      existsInAfter,
      filteringComplete: {
        pics: performer.pics_filtered >= performer.pics_count,
        vids: performer.vids_filtered >= performer.vids_count,
        funscript_vids: performer.funscript_vids_filtered >= performer.funscript_vids_count
      }
    });
  } catch (err) {
    res.status(500).send({ error: err.message });
  }
});

// Manually mark filtering categories as complete
router.post('/:id/mark-complete', async (req, res) => {
  const { id } = req.params;
  const { categories } = req.body; // Array of 'pics', 'vids', 'funscript_vids'

  try {
    const performer = db.prepare('SELECT * FROM performers WHERE id = ?').get(id);
    if (!performer) {
      return res.status(404).send({ error: 'Performer not found' });
    }

    let updateFields = [];
    let values = [];

    if (categories.includes('pics')) {
      updateFields.push('pics_filtered = pics_count');
    }
    if (categories.includes('vids')) {
      updateFields.push('vids_filtered = vids_count');
    }
    if (categories.includes('funscript_vids')) {
      updateFields.push('funscript_vids_filtered = funscript_vids_count');
    }

    if (updateFields.length > 0) {
      const query = `UPDATE performers SET ${updateFields.join(', ')} WHERE id = ?`;
      db.prepare(query).run(id);
    }

    res.send({ success: true, message: 'Categories marked as complete' });
  } catch (err) {
    res.status(500).send({ error: err.message });
  }
});

// Toggle filtering completion status for categories
router.post('/:id/toggle-complete', async (req, res) => {
  const { id } = req.params;
  const { category, complete } = req.body; // category: 'pics', 'vids', 'funscript_vids'; complete: boolean

  try {
    const performer = db.prepare('SELECT * FROM performers WHERE id = ?').get(id);
    if (!performer) {
      return res.status(404).send({ error: 'Performer not found' });
    }

    let updateField = '';
    let newValue = '';

    if (category === 'pics') {
      updateField = 'pics_filtered';
      newValue = complete ? 'pics_count' : '0';
    } else if (category === 'vids') {
      updateField = 'vids_filtered';
      newValue = complete ? 'vids_count' : '0';
    } else if (category === 'funscript_vids') {
      updateField = 'funscript_vids_filtered';
      newValue = complete ? 'funscript_vids_count' : '0';
    } else {
      return res.status(400).send({ error: 'Invalid category' });
    }

    const query = `UPDATE performers SET ${updateField} = ${newValue} WHERE id = ?`;
    db.prepare(query).run(id);

    res.send({ success: true, message: `${category} completion toggled` });
  } catch (err) {
    res.status(500).send({ error: err.message });
  }
});

// Move performer to "after filter performer" folder
router.post('/:id/move-to-after', async (req, res) => {
  const { id } = req.params;
  const { force = false, keepCurrentThumbnail = false } = req.body;

  try {
    const result = await merger.movePerformerToAfter(id, keepCurrentThumbnail, force);
    res.send(result);
  } catch (err) {
    res.status(500).send({ error: err.message });
  }
});

// Delete all performer data (for re-import)
router.delete('/:id/data', async (req, res) => {
  const { id } = req.params;

  try {
    // Delete from database - this completely removes the performer record
    // so it can be re-imported fresh without any moved_to_after conflicts
    db.prepare('DELETE FROM filter_actions WHERE performer_id = ?').run(id);
    db.prepare('DELETE FROM tags WHERE performer_id = ?').run(id);
    db.prepare('DELETE FROM performers WHERE id = ?').run(id);

    res.send({ success: true, message: 'Performer data deleted' });
  } catch (err) {
    res.status(500).send({ error: err.message });
  }
});

/**
 * Handle trash folder - either move contents to training or permanently delete
 */
async function handleTrashFolder(trashFolderPath, performerName, basePath, fileType, forceTraining = false) {
  const setting = db.prepare('SELECT value FROM app_settings WHERE key = ?').get('save_deleted_for_training');
  const saveForTraining = forceTraining || (setting && setting.value === 'true');

  console.log(`handleTrashFolder: folder=${trashFolderPath}, performer=${performerName}, type=${fileType}, saveForTraining=${saveForTraining}, forceTraining=${forceTraining}`);

  try {
    if (!await fs.pathExists(trashFolderPath)) {
      return { saved: false, count: 0 };
    }

    const files = await fs.readdir(trashFolderPath);

    if (saveForTraining && files.length > 0) {
      // Move entire contents to training folder
      const trainingBasePath = path.join(basePath, 'deleted keep for training', performerName);
      const destFolder = path.join(trainingBasePath, fileType === 'video' ? 'vids' : 'pics');

      await fs.ensureDir(destFolder);

      // Move each file
      for (const file of files) {
        const sourcePath = path.join(trashFolderPath, file);
        const destPath = path.join(destFolder, file);
        await fs.move(sourcePath, destPath, { overwrite: true });
      }

      console.log(`Saved ${files.length} files for training: ${destFolder}`);

      // Remove empty trash folder
      await fs.remove(trashFolderPath);

      return { saved: true, count: files.length };
    } else {
      // Permanently delete the entire trash folder
      await fs.remove(trashFolderPath);
      console.log(`Permanently deleted trash folder: ${trashFolderPath} (${files.length} files)`);

      return { saved: false, count: files.length };
    }
  } catch (err) {
    console.error('Error handling trash folder:', err);
    throw err;
  }
}

// Delete performer folder from system
router.delete('/:id/folder', async (req, res) => {
  const { id } = req.params;

  try {
    const performer = db.prepare('SELECT * FROM performers WHERE id = ?').get(id);
    if (!performer) {
      return res.status(404).send({ error: 'Performer not found' });
    }

    const folder = db.prepare('SELECT * FROM folders WHERE id = ?').get(performer.folder_id);

    let performerPath;
    let locationMessage;

    // Determine which folder the performer is in and delete accordingly
    if (performer.moved_to_after === 1) {
      // Performer is in "after filter performer" folder
      performerPath = path.join(folder.path, 'after filter performer', performer.name);
      locationMessage = 'after filter performer folder';
    } else {
      // Performer is in "before filter performer" folder
      performerPath = path.join(folder.path, 'before filter performer', performer.name);
      locationMessage = 'before filter performer folder';
    }

    // Delete folder from filesystem
    if (await fs.pathExists(performerPath)) {
      await fs.remove(performerPath);
      console.log(`Deleted performer folder: ${performerPath}`);
    } else {
      console.log(`Performer folder not found: ${performerPath}`);
    }

    // Delete from database - this completely removes the performer record
    // so it can be re-imported fresh without any moved_to_after conflicts
    db.prepare('DELETE FROM filter_actions WHERE performer_id = ?').run(id);
    db.prepare('DELETE FROM tags WHERE performer_id = ?').run(id);
    db.prepare('DELETE FROM performers WHERE id = ?').run(id);

    res.send({
      success: true,
      message: `Performer folder and data deleted from ${locationMessage}`
    });
  } catch (err) {
    console.error('Error deleting performer folder:', err);
    res.status(500).send({ error: err.message });
  }
});

// Clean up trash folder for performer
router.post('/:id/cleanup-trash', async (req, res) => {
  const { id } = req.params;

  try {
    const performer = db.prepare('SELECT * FROM performers WHERE id = ?').get(id);
    if (!performer) {
      return res.status(404).send({ error: 'Performer not found' });
    }

    const folder = db.prepare('SELECT * FROM folders WHERE id = ?').get(performer.folder_id);
    const trashPath = path.join(folder.path, 'trash', performer.name);

    if (await fs.pathExists(trashPath)) {
      await fs.remove(trashPath);
    }

    res.send({ success: true, message: 'Trash folder cleaned up' });
  } catch (err) {
    res.status(500).send({ error: err.message });
  }
});

// Move performer back to "before filter performer" folder
router.post('/:id/move-to-before', async (req, res) => {
  const { id } = req.params;
  const { markFilesAsKept = false } = req.body;

  try {
    const performer = db.prepare('SELECT * FROM performers WHERE id = ?').get(id);
    if (!performer) {
      return res.status(404).send({ error: 'Performer not found' });
    }

    // Only allow moving performers that are currently in "after filter performer" state
    if (performer.moved_to_after !== 1) {
      return res.status(400).send({ error: 'Performer is not in "after filter performer" folder' });
    }

    const folder = db.prepare('SELECT * FROM folders WHERE id = ?').get(performer.folder_id);

    const afterPath = path.join(folder.path, 'after filter performer', performer.name);
    const beforePath = path.join(folder.path, 'before filter performer', performer.name);

    // Check if source folder exists
    if (!await fs.pathExists(afterPath)) {
      return res.status(400).send({ error: 'Performer folder not found in "after filter performer"' });
    }

    // Check if destination already exists
    if (await fs.pathExists(beforePath)) {
      return res.status(400).send({ error: 'Performer folder already exists in "before filter performer"' });
    }

    // Move the folder
    await fs.move(afterPath, beforePath);

    // Update database: reset moved_to_after flag and optionally mark files as kept
    if (markFilesAsKept) {
      // Mark all files as "keep" in filter_actions
      // First, we need to scan the folder to get all files
      const { scanPerformerFolder } = require('../services/fileScanner');
      await scanPerformerFolder(beforePath); // This will update stats

      // Get all files in the performer folder and mark them as kept
      const fs = require('fs-extra');
      const path = require('path');

      async function markFilesInDirectory(dirPath, fileType) {
        if (!await fs.pathExists(dirPath)) return;

        const files = await fs.readdir(dirPath, { withFileTypes: true });
        for (const file of files) {
          const filePath = path.join(dirPath, file.name);

          if (file.isFile()) {
            const ext = path.extname(file.name).toLowerCase();
            let currentFileType = fileType;

            // Determine file type if not specified
            if (!currentFileType) {
              if (['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) {
                currentFileType = 'image';
              } else if (['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm'].includes(ext)) {
                currentFileType = 'video';
              } else if (ext === '.funscript') {
                currentFileType = 'funscript';
              }
            }

            if (currentFileType) {
              // Check if filter action already exists
              const existingAction = db.prepare('SELECT * FROM filter_actions WHERE performer_id = ? AND file_path = ?').get(id, filePath);
              if (!existingAction) {
                // Insert new "keep" action
                db.prepare('INSERT INTO filter_actions (performer_id, file_path, file_type, action) VALUES (?, ?, ?, ?)').run(id, filePath, currentFileType, 'keep');
                console.log(`Marked as kept: ${filePath}`);
              }
            }
          } else if (file.isDirectory() && file.name !== '.thumbnails' && file.name !== '.thumbnail' && file.name !== '.trash') {
            // Recursively mark files in subdirectories
            await markFilesInDirectory(filePath, fileType);
          }
        }
      }

      // Mark files in pics, vids, and funscript folders
      await markFilesInDirectory(path.join(beforePath, 'pics'), 'image');
      await markFilesInDirectory(path.join(beforePath, 'vids'), 'video');
      await markFilesInDirectory(path.join(beforePath, 'vids', 'funscript'), 'funscript');

      // Update performer flags to show filtering is complete
      db.prepare(`
        UPDATE performers 
        SET moved_to_after = 0, ready_to_move = 0, pics_filtered = 1, vids_filtered = 1, funscript_vids_filtered = 1
        WHERE id = ?
      `).run(id);
    } else {
      // Just reset the moved_to_after flag, files will need to be filtered again
      db.prepare(`
        UPDATE performers 
        SET moved_to_after = 0, ready_to_move = 0, pics_filtered = 0, vids_filtered = 0, funscript_vids_filtered = 0
        WHERE id = ?
      `).run(id);
    }

    res.send({
      success: true,
      message: `Performer ${performer.name} moved back to "before filter performer"`,
      markedAsKept: markFilesAsKept
    });
  } catch (err) {
    res.status(500).send({ error: err.message });
  }
});

// Permanently delete performer trash files
router.delete('/:id/trash-permanent', async (req, res) => {
  const { id } = req.params;

  try {
    const performer = db.prepare('SELECT * FROM performers WHERE id = ?').get(id);
    if (!performer) {
      return res.status(404).send({ error: 'Performer not found' });
    }

    const folder = db.prepare('SELECT * FROM folders WHERE id = ?').get(performer.folder_id);
    const performerPath = path.join(folder.path, 'before filter performer', performer.name);

    let deletedCount = 0;
    let savedForTrainingCount = 0;
    const trashFolders = [
      { path: path.join(performerPath, 'pics', '.trash'), type: 'image' },
      { path: path.join(performerPath, 'vids', '.trash'), type: 'video' },
      { path: path.join(performerPath, 'vids', 'funscript', '.trash'), type: 'funscript' }
    ];

    for (const trashFolder of trashFolders) {
      const result = await handleTrashFolder(trashFolder.path, performer.name, folder.path, trashFolder.type);

      if (result.saved) {
        savedForTrainingCount += result.count;
      }
      deletedCount += result.count;
    }

    res.send({
      success: true,
      message: savedForTrainingCount > 0
        ? `Moved ${savedForTrainingCount} files to training folder`
        : `Permanently deleted ${deletedCount} files from trash`,
      deletedCount,
      savedForTrainingCount
    });
  } catch (err) {
    res.status(500).send({ error: err.message });
  }
});

// Clean up trash folders when exiting performer filter view
router.post('/:id/cleanup-trash-on-exit', async (req, res) => {
  const { id } = req.params;

  try {
    const performer = db.prepare('SELECT * FROM performers WHERE id = ?').get(id);
    if (!performer) {
      return res.status(404).send({ error: 'Performer not found' });
    }

    const folder = db.prepare('SELECT * FROM folders WHERE id = ?').get(performer.folder_id);
    const performerPath = path.join(folder.path, 'before filter performer', performer.name);

    let deletedCount = 0;
    let savedForTrainingCount = 0;
    const trashFolders = [
      { path: path.join(performerPath, 'pics', '.trash'), type: 'image' },
      { path: path.join(performerPath, 'vids', '.trash'), type: 'video' },
      { path: path.join(performerPath, 'vids', 'funscript', '.trash'), type: 'funscript' }
    ];

    for (const trashFolder of trashFolders) {
      const result = await handleTrashFolder(trashFolder.path, performer.name, folder.path, trashFolder.type);

      if (result.saved) {
        savedForTrainingCount += result.count;
      }
      deletedCount += result.count;
    }

    // Recalculate performer stats after trash cleanup since file counts may have changed
    const { scanPerformerFolder } = require('../services/fileScanner');
    const updatedStats = await scanPerformerFolder(performerPath);

    // Update the performer stats in the database
    db.prepare(`
      UPDATE performers 
      SET pics_count = ?, vids_count = ?, funscript_vids_count = ?, 
          funscript_files_count = ?, total_size_gb = ?
      WHERE id = ?
    `).run(
      updatedStats.pics_count,
      updatedStats.vids_count,
      updatedStats.funscript_vids_count,
      updatedStats.funscript_files_count,
      updatedStats.total_size_gb,
      id
    );

    console.log(`Updated performer stats after trash cleanup:`, updatedStats);

    res.send({
      success: true,
      message: savedForTrainingCount > 0
        ? `Moved ${savedForTrainingCount} files to training folder and updated stats`
        : `Cleaned up ${deletedCount} trash files and updated stats`,
      deletedCount,
      savedForTrainingCount,
      updatedStats
    });
  } catch (err) {
    console.error('Error cleaning up trash on exit:', err);
    res.status(500).send({ error: err.message });
  }
});

// Get performer folder stats (size + file counts)
router.get('/stats/:name', async (req, res) => {
  const { name } = req.params;
  const { basePath } = req.query;

  if (!basePath) {
    return res.status(400).send({ error: 'basePath parameter is required' });
  }

  try {
    // Find performer in database
    const performer = db.prepare(`
      SELECT p.*, f.path as folder_path 
      FROM performers p 
      JOIN folders f ON p.folder_id = f.id
      WHERE p.name = ? AND f.path = ?
    `).get(name, basePath);

    if (!performer) {
      return res.status(404).send({ error: 'Performer not found' });
    }

    // Get performer folder path (try "after filter performer" first, then "before filter performer")
    const afterFilterPath = path.join(performer.folder_path, 'after filter performer', performer.name);
    const beforeFilterPath = path.join(performer.folder_path, 'before filter performer', performer.name);

    let performerPath;
    if (await fs.pathExists(afterFilterPath)) {
      performerPath = afterFilterPath;
    } else if (await fs.pathExists(beforeFilterPath)) {
      performerPath = beforeFilterPath;
    } else {
      return res.status(404).send({ error: 'Performer folder not found' });
    }

    // Calculate folder stats using the stats service
    const { getPerformerStats } = require('../services/stats');
    const stats = await getPerformerStats(performerPath);

    res.send({
      performer: performer.name,
      path: performerPath,
      stats: {
        pics: stats.pics,
        vids: stats.vids,
        funscriptVids: stats.funVids,
        funscripts: stats.funscripts,
        sizeGB: parseFloat(stats.size) // Convert string to number
      }
    });
  } catch (err) {
    console.error('Error getting performer stats:', err);
    res.status(500).send({ error: err.message });
  }
});

// Get performer content for filtering (phone interface)
router.get('/:performerId/content', async (req, res) => {
  const { performerId } = req.params;
  const { type, sortBy, sortOrder, hideKept } = req.query;

  try {
    // Use the existing filter service to get filterable files
    const filterService = require('../services/filterService');
    const files = await filterService.getFilterableFiles(
      performerId,
      type || 'pics',
      sortBy || 'name',
      sortOrder || 'asc',
      hideKept === 'true' // Hide kept files based on query parameter
    );

    res.send({
      items: files.map(file => ({
        id: file.id || file.path, // Use path as ID if no database ID
        name: file.name,
        path: file.path,
        type: file.type,
        size: file.size,
        modified: file.modified
      }))
    });
  } catch (err) {
    console.error('Error getting performer content:', err);
    res.status(500).send({ error: err.message });
  }
});

// Update performer aliases
router.put('/:id/aliases', (req, res) => {
  const { id } = req.params;
  const { aliases } = req.body;

  try {
    // Store aliases as JSON array string
    const aliasesJson = JSON.stringify(aliases || []);
    db.prepare('UPDATE performers SET aliases = ? WHERE id = ?').run(aliasesJson, id);

    const updated = db.prepare('SELECT * FROM performers WHERE id = ?').get(id);
    res.send({ success: true, performer: updated });
  } catch (err) {
    console.error('Error updating performer aliases:', err);
    res.status(500).send({ error: err.message });
  }
});

// Scrape performer data from leakshaven.com
router.post('/:id/scrape', async (req, res) => {
  const { id } = req.params;

  try {
    const performer = db.prepare('SELECT * FROM performers WHERE id = ?').get(id);
    if (!performer) {
      return res.status(404).send({ error: 'Performer not found' });
    }

    // Parse existing aliases
    const existingAliases = performer.aliases ? JSON.parse(performer.aliases) : [];

    // Scrape data using performer name and aliases
    const { scrapeLeakshaven } = require('../services/scraperService');
    const scrapedData = await scrapeLeakshaven(performer.name, existingAliases);

    // Merge scraped aliases with existing ones (avoiding duplicates)
    const allAliases = [...new Set([...existingAliases, ...scrapedData.alsoKnownAs])];

    // Prepare scraped tags as JSON string
    const scrapedTagsJson = JSON.stringify(scrapedData.tags || []);
    const aliasesJson = JSON.stringify(allAliases);

    // Update database with scraped data
    const now = new Date().toISOString();
    console.log('Scraped data to save:', JSON.stringify(scrapedData, null, 2));

    // Determine scraped status
    const scrapedStatus = scrapedData.hasContent ? 'scraped' : 'found_no_data';
    const workingAlias = scrapedData.workingAlias || performer.name;

    db.prepare(`
      UPDATE performers 
      SET aliases = ?,
          age = ?,
          born = ?,
          birthplace = ?,
          country_flag = ?,
          height = ?,
          weight = ?,
          measurements = ?,
          measurements_cup = ?,
          measurements_band_size = ?,
          measurements_fake = ?,
          hair_color = ?,
          eye_color = ?,
          ethnicity = ?,
          body_type = ?,
          orientation = ?,
          scraped_tags = ?,
          scraped_at = ?,
          scraped_status = ?,
          leakshaven_alias = ?
      WHERE id = ?
    `).run(
      aliasesJson,
      scrapedData.personalInfo.age || null,
      scrapedData.personalInfo.born || null,
      scrapedData.personalInfo.birthplace || null,
      scrapedData.personalInfo.countryFlag || null,
      scrapedData.physicalAttributes.height || null,
      scrapedData.physicalAttributes.weight || null,
      scrapedData.physicalAttributes.measurements || null,
      scrapedData.physicalAttributes.measurements_cup || null,
      scrapedData.physicalAttributes.measurements_band_size || null,
      scrapedData.physicalAttributes.measurements_fake !== undefined ? (scrapedData.physicalAttributes.measurements_fake ? 1 : 0) : null,
      scrapedData.physicalAttributes.hair || null,
      scrapedData.physicalAttributes.eyes || null,
      scrapedData.physicalAttributes.ethnicity || null,
      scrapedData.physicalAttributes.bodyType || null,
      scrapedData.personalInfo.orientation || null,
      scrapedTagsJson,
      now,
      scrapedStatus,
      workingAlias,
      id
    );

    const updated = db.prepare('SELECT * FROM performers WHERE id = ?').get(id);

    const statusMessage = scrapedData.hasContent
      ? `Successfully scraped performer data from ${workingAlias}`
      : `Model page found for ${workingAlias} but no additional data available. Alias saved for future update checks.`;

    res.send({
      success: true,
      message: statusMessage,
      hasContent: scrapedData.hasContent,
      workingAlias: workingAlias,
      performer: updated,
      scrapedData
    });
  } catch (err) {
    console.error('Error scraping performer data:', err);
    res.status(500).send({ error: err.message });
  }
});

// Background task tracking for async operations
const backgroundTasks = new Map();

// Start async trash cleanup (returns job ID immediately)
router.post('/:id/cleanup-trash-async', async (req, res) => {
  const { id } = req.params;
  const { mode } = req.body; // 'training' or 'delete' (default)

  try {
    const performer = db.prepare('SELECT * FROM performers WHERE id = ?').get(id);
    if (!performer) {
      return res.status(404).send({ error: 'Performer not found' });
    }

    const jobId = `cleanup-${id}-${Date.now()}`;

    // Store initial job status
    backgroundTasks.set(jobId, {
      id: jobId,
      type: 'trash-cleanup',
      performerId: id,
      performerName: performer.name,
      status: 'processing',
      startTime: Date.now(),
      progress: 0,
    });

    // Start cleanup in background
    (async () => {
      try {
        const folder = db.prepare('SELECT * FROM folders WHERE id = ?').get(performer.folder_id);
        const performerPath = path.join(folder.path, 'before filter performer', performer.name);

        let deletedCount = 0;
        let savedForTrainingCount = 0;
        const trashFolders = [
          { path: path.join(performerPath, 'pics', '.trash'), type: 'image' },
          { path: path.join(performerPath, 'vids', '.trash'), type: 'video' },
          { path: path.join(performerPath, 'vids', 'funscript', '.trash'), type: 'funscript' }
        ];

        let processed = 0;
        for (const trashFolder of trashFolders) {
          const result = await handleTrashFolder(
            trashFolder.path,
            performer.name,
            folder.path,
            trashFolder.type,
            mode === 'training' // Force training if mode is 'training'
          );
          deletedCount += result.count;
          if (result.saved) {
            savedForTrainingCount += result.count;
          }

          processed++;
          backgroundTasks.set(jobId, {
            ...backgroundTasks.get(jobId),
            progress: (processed / trashFolders.length) * 50, // 0-50% for deletion
          });
        }

        // Recalculate stats
        const { scanPerformerFolder } = require('../services/fileScanner');
        const updatedStats = await scanPerformerFolder(performerPath);

        backgroundTasks.set(jobId, {
          ...backgroundTasks.get(jobId),
          progress: 75,
        });

        // Update database
        db.prepare(`
          UPDATE performers 
          SET pics_count = ?, vids_count = ?, funscript_vids_count = ?, 
              funscript_files_count = ?, total_size_gb = ?
          WHERE id = ?
        `).run(
          updatedStats.pics_count,
          updatedStats.vids_count,
          updatedStats.funscript_vids_count,
          updatedStats.funscript_files_count,
          updatedStats.total_size_gb,
          id
        );

        backgroundTasks.set(jobId, {
          ...backgroundTasks.get(jobId),
          status: 'completed',
          progress: 100,
          endTime: Date.now(),
          result: { deletedCount, savedForTrainingCount, updatedStats },
        });

        const message = savedForTrainingCount > 0
          ? `Async cleanup completed: ${savedForTrainingCount} files saved for training, ${deletedCount - savedForTrainingCount} permanently deleted`
          : `Async cleanup completed: ${deletedCount} files permanently deleted`;

        console.log(message);
      } catch (error) {
        console.error('Error in async cleanup:', error);
        backgroundTasks.set(jobId, {
          ...backgroundTasks.get(jobId),
          status: 'error',
          error: error.message,
          endTime: Date.now(),
        });
      }
    })();

    res.send({ success: true, jobId });
  } catch (err) {
    console.error('Error starting async cleanup:', err);
    res.status(500).send({ error: err.message });
  }
});

// Get background task status
router.get('/background-task/:jobId', (req, res) => {
  const { jobId } = req.params;
  const task = backgroundTasks.get(jobId);

  if (!task) {
    return res.status(404).send({ error: 'Task not found' });
  }

  res.send({ success: true, task });
});

// Start async stats refresh (returns job ID immediately)
router.post('/:id/refresh-stats-async', async (req, res) => {
  const { id } = req.params;

  try {
    const performer = db.prepare('SELECT * FROM performers WHERE id = ?').get(id);
    if (!performer) {
      return res.status(404).send({ error: 'Performer not found' });
    }

    const jobId = `refresh-stats-${id}-${Date.now()}`;

    // Store initial job status
    backgroundTasks.set(jobId, {
      id: jobId,
      type: 'refresh-stats',
      performerId: id,
      performerName: performer.name,
      status: 'processing',
      startTime: Date.now(),
      progress: 0,
    });

    // Start refresh in background
    (async () => {
      try {
        const folder = db.prepare('SELECT * FROM folders WHERE id = ?').get(performer.folder_id);

        // Determine correct path
        let performerPath;
        if (performer.moved_to_after === 1) {
          performerPath = path.join(folder.path, 'after filter performer', performer.name);
        } else {
          performerPath = path.join(folder.path, 'before filter performer', performer.name);
        }

        backgroundTasks.set(jobId, {
          ...backgroundTasks.get(jobId),
          progress: 10,
        });

        // Scan folder
        const { scanPerformerFolderEnhanced } = require('../services/importer');
        const stats = await scanPerformerFolderEnhanced(performerPath);

        backgroundTasks.set(jobId, {
          ...backgroundTasks.get(jobId),
          progress: 80,
        });

        // Update database
        const picsPath = path.join(performerPath, 'pics');
        const vidsPath = path.join(performerPath, 'vids');
        const funscriptPath = path.join(vidsPath, 'funscript');
        const now = new Date().toISOString();

        db.prepare(`
          UPDATE performers 
          SET pics_count = ?, vids_count = ?, funscript_vids_count = ?, 
              funscript_files_count = ?, total_size_gb = ?,
              pics_original_count = ?, vids_original_count = ?, funscript_vids_original_count = ?,
              last_scan_date = ?, cached_pics_path = ?, cached_vids_path = ?, cached_funscript_path = ?
          WHERE id = ?
        `).run(
          stats.pics_count,
          stats.vids_count,
          stats.funscript_vids_count,
          stats.funscript_files_count,
          stats.total_size_gb,
          stats.pics_count,
          stats.vids_count,
          stats.funscript_vids_count,
          now,
          picsPath,
          vidsPath,
          funscriptPath,
          id
        );

        backgroundTasks.set(jobId, {
          ...backgroundTasks.get(jobId),
          status: 'completed',
          progress: 100,
          endTime: Date.now(),
          result: { stats },
        });

        console.log(`Async refresh completed for ${performer.name}`);
      } catch (error) {
        console.error('Error in async refresh:', error);
        backgroundTasks.set(jobId, {
          ...backgroundTasks.get(jobId),
          status: 'error',
          error: error.message,
          endTime: Date.now(),
        });
      }
    })();

    res.send({ success: true, jobId });
  } catch (err) {
    console.error('Error starting async refresh:', err);
    res.status(500).send({ error: err.message });
  }
});

// Smart Scan: Scan folder stats AND check for fuzzy duplicates
router.post('/:id/smart-scan', async (req, res) => {
  const { id } = req.params;
  const { basePath } = req.body;

  if (!basePath) {
    return res.status(400).send({ error: 'basePath is required' });
  }

  try {
    const performer = db.prepare('SELECT * FROM performers WHERE id = ?').get(id);
    if (!performer) {
      return res.status(404).send({ error: 'Performer not found' });
    }

    // 1. Scan folder stats/files
    let performerPath;
    if (performer.moved_to_after === 1) {
      performerPath = path.join(basePath, 'after filter performer', performer.name);
    } else {
      performerPath = path.join(basePath, 'before filter performer', performer.name);
    }

    // Check if folder exists
    if (!await fs.pathExists(performerPath)) {
      return res.status(404).send({ error: `Performer folder not found: ${performerPath}` });
    }

    // Wait for scan to update stats in DB
    const stats = await scanPerformerFolder(performerPath);

    // 2. Find fuzzy matches
    const matches = findFuzzyMatches(performer.name, performer.id);

    res.send({
      success: true,
      stats,
      matches
    });

  } catch (err) {
    console.error('Smart Scan Error:', err);
    res.status(500).send({ error: err.message });
  }
});

// Merge two performers
router.post('/merge', async (req, res) => {
  const { sourceId, targetId } = req.body;

  if (!sourceId || !targetId) {
    return res.status(400).send({ error: 'Source and Target IDs are required' });
  }

  try {
    const result = await merger.mergePerformers(sourceId, targetId);
    res.send(result);
  } catch (err) {
    console.error('Merge Error:', err);
    res.status(500).send({ error: err.message });
  }
});

// Force rescan of files and update DB cache
router.post('/:id/rescan-files', async (req, res) => {
  const { id } = req.params;
  try {
    const performer = db.prepare('SELECT * FROM performers WHERE id = ?').get(id);
    if (!performer) return res.status(404).send({ error: 'Performer not found' });

    const folder = db.prepare('SELECT path FROM folders WHERE id = ?').get(performer.folder_id);
    if (!folder) return res.status(404).send({ error: 'Folder not found' });

    // Determine correct path
    let performerPath;
    if (performer.moved_to_after === 1) {
      performerPath = path.join(folder.path, 'after filter performer', performer.name);
    } else {
      performerPath = path.join(folder.path, 'before filter performer', performer.name);
    }

    if (!await fs.pathExists(performerPath)) {
      return res.status(404).send({ error: `Performer folder not found: ${performerPath}` });
    }

    // Helper to scan recursively
    async function scanDir(dir, fileList) {
      const items = await fs.readdir(dir, { withFileTypes: true });
      for (const item of items) {
        // Skip hidden/system folders
        if (item.isDirectory() && (item.name.startsWith('.') || item.name === '.trash')) continue;

        const fullPath = path.join(dir, item.name);
        if (item.isDirectory()) {
          await scanDir(fullPath, fileList);
        } else if (item.isFile()) {
          fileList.push({ path: fullPath, name: item.name });
        }
      }
    }

    const allFiles = [];
    await scanDir(performerPath, allFiles);

    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
    const videoExtensions = ['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm', '.m4v'];

    const pics = allFiles.filter(f => imageExtensions.includes(path.extname(f.name).toLowerCase()));
    const vids = allFiles.filter(f => videoExtensions.includes(path.extname(f.name).toLowerCase()));

    // Transaction to update DB
    const updateCache = db.transaction(() => {
      db.prepare('DELETE FROM performer_file_cache WHERE performer_id = ?').run(id);
      db.prepare('INSERT INTO performer_file_cache (performer_id, type, data) VALUES (?, ?, ?)').run(id, 'pics', JSON.stringify(pics));
      // Also cache vids as requested
      db.prepare('INSERT INTO performer_file_cache (performer_id, type, data) VALUES (?, ?, ?)').run(id, 'vids', JSON.stringify(vids));
      // Also update stats in performers table? 
      // The user didn't ask explicitly but it makes sense. However, `scanPerformerFolder` usually handles stats.
      // I'll stick to updating CACHE as requested.
    });

    updateCache();

    res.send({
      success: true,
      picsCount: pics.length,
      vidsCount: vids.length,
      message: `Rescanned: ${pics.length} images, ${vids.length} videos`
    });

  } catch (err) {
    console.error('Rescan error:', err);
    res.status(500).send({ error: err.message });
  }
});

// Specialized endpoint for gallery images (fast cache-first)
router.get('/:id/gallery/images', async (req, res) => {
  const { id } = req.params;
  const { fast } = req.query; // ?fast=true skips stat() calls for faster response
  const startTime = Date.now();
  
  try {
    // 1. Check Cache
    const cacheStart = Date.now();
    const cached = db.prepare('SELECT data FROM performer_file_cache WHERE performer_id = ? AND type = ?').get(id, 'pics');
    console.log(`[gallery/images] Cache check took ${Date.now() - cacheStart}ms`);
    if (cached) {
      const parseStart = Date.now();
      const files = JSON.parse(cached.data);
      console.log(`[gallery/images] JSON parse took ${Date.now() - parseStart}ms for ${files.length} files`);
      console.log(`[gallery/images] Total time (cached): ${Date.now() - startTime}ms`);
      // Add HTTP cache headers - cache for 5 minutes on client side
      res.set('Cache-Control', 'private, max-age=300');
      return res.send({ pics: files, count: files.length, fromCache: true });
    }

    // 2. If Miss, Scan & Cache
    const performer = db.prepare('SELECT * FROM performers WHERE id = ?').get(id);
    if (!performer) return res.status(404).send({ error: 'Performer not found' });

    const folder = db.prepare('SELECT path FROM folders WHERE id = ?').get(performer.folder_id);
    if (!folder) return res.status(404).send({ error: 'Folder not found' });

    let performerPath;
    if (performer.moved_to_after === 1) {
      performerPath = path.join(folder.path, 'after filter performer', performer.name);
    } else {
      performerPath = path.join(folder.path, 'before filter performer', performer.name);
    }

    if (!await fs.pathExists(performerPath)) {
      return res.status(404).send({ error: 'Performer folder not found' });
    }

    const allFiles = [];
    const imageExtensions = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);
    
    // Fast mode: skip stat() calls, just collect paths
    // This is much faster for large directories (avoids thousands of disk I/O ops)
    async function scanDirFast(dir) {
      try {
        const items = await fs.readdir(dir, { withFileTypes: true });
        for (const item of items) {
          if (item.name.startsWith('.') || item.name === '.trash') continue;
          const fullPath = path.join(dir, item.name);
          if (item.isDirectory()) {
            await scanDirFast(fullPath);
          } else if (item.isFile()) {
            const ext = path.extname(item.name).toLowerCase();
            if (imageExtensions.has(ext)) {
              allFiles.push({
                path: fullPath,
                name: item.name
              });
            }
          }
        }
      } catch (e) {
        console.warn('Failed to scan directory:', dir, e.message);
      }
    }
    
    // Full mode: includes stat() for size/modified (slower but more data)
    async function scanDirFull(dir) {
      try {
        const items = await fs.readdir(dir, { withFileTypes: true });
        // Batch stat calls using Promise.all for better performance
        const statPromises = [];
        const validItems = [];
        
        for (const item of items) {
          if (item.name.startsWith('.') || item.name === '.trash') continue;
          const fullPath = path.join(dir, item.name);
          if (item.isDirectory()) {
            await scanDirFull(fullPath);
          } else if (item.isFile()) {
            const ext = path.extname(item.name).toLowerCase();
            if (imageExtensions.has(ext)) {
              validItems.push({ fullPath, name: item.name });
              statPromises.push(fs.stat(fullPath).catch(() => null));
            }
          }
        }
        
        // Wait for all stat calls in parallel
        const stats = await Promise.all(statPromises);
        for (let i = 0; i < validItems.length; i++) {
          const stat = stats[i];
          if (stat) {
            allFiles.push({
              path: validItems[i].fullPath,
              name: validItems[i].name,
              size: stat.size,
              modified: stat.mtime.getTime()
            });
          } else {
            // File stat failed, include without metadata
            allFiles.push({
              path: validItems[i].fullPath,
              name: validItems[i].name
            });
          }
        }
      } catch (e) {
        console.warn('Failed to scan directory:', dir, e.message);
      }
    }
    
    // Use fast mode by default for initial load, or if explicitly requested
    const scanStart = Date.now();
    if (fast === 'true' || fast === undefined) {
      await scanDirFast(performerPath);
    } else {
      await scanDirFull(performerPath);
    }
    console.log(`[gallery/images] Directory scan took ${Date.now() - scanStart}ms for ${allFiles.length} files`);

    // Cache it
    db.prepare('INSERT OR REPLACE INTO performer_file_cache (performer_id, type, data) VALUES (?, ?, ?)').run(id, 'pics', JSON.stringify(allFiles));
    console.log(`[gallery/images] Total time (uncached): ${Date.now() - startTime}ms`);

    res.send({ pics: allFiles, count: allFiles.length });

  } catch (err) {
    console.error('Gallery images error:', err);
    res.status(500).send({ error: err.message });
  }
});

// Specialized endpoint for gallery videos (fast cache-first)
router.get('/:id/gallery/videos', async (req, res) => {
  const { id } = req.params;
  const { fast } = req.query; // ?fast=true skips stat() calls for faster response
  
  try {
    // 1. Check Cache
    const cached = db.prepare('SELECT data FROM performer_file_cache WHERE performer_id = ? AND type = ?').get(id, 'vids');
    if (cached) {
      const files = JSON.parse(cached.data);
      return res.send({ vids: files, count: files.length, fromCache: true });
    }

    // 2. If Miss, Scan & Cache
    const performer = db.prepare('SELECT * FROM performers WHERE id = ?').get(id);
    if (!performer) return res.status(404).send({ error: 'Performer not found' });

    const folder = db.prepare('SELECT path FROM folders WHERE id = ?').get(performer.folder_id);
    if (!folder) return res.status(404).send({ error: 'Folder not found' });

    let performerPath;
    if (performer.moved_to_after === 1) {
      performerPath = path.join(folder.path, 'after filter performer', performer.name);
    } else {
      performerPath = path.join(folder.path, 'before filter performer', performer.name);
    }

    if (!await fs.pathExists(performerPath)) {
      return res.status(404).send({ error: 'Performer folder not found' });
    }

    const allFiles = [];
    const videoExtensions = new Set(['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm', '.m4v']);
    
    // Fast mode: skip stat() calls, just collect paths
    async function scanDirFast(dir) {
      try {
        const items = await fs.readdir(dir, { withFileTypes: true });
        for (const item of items) {
          if (item.name.startsWith('.') || item.name === '.trash') continue;
          const fullPath = path.join(dir, item.name);
          if (item.isDirectory()) {
            await scanDirFast(fullPath);
          } else if (item.isFile()) {
            const ext = path.extname(item.name).toLowerCase();
            if (videoExtensions.has(ext)) {
              allFiles.push({
                path: fullPath,
                name: item.name
              });
            }
          }
        }
      } catch (e) {
        console.warn('Failed to scan directory:', dir, e.message);
      }
    }
    
    // Full mode: includes stat() for size/modified (slower but more data)
    async function scanDirFull(dir) {
      try {
        const items = await fs.readdir(dir, { withFileTypes: true });
        const statPromises = [];
        const validItems = [];
        
        for (const item of items) {
          if (item.name.startsWith('.') || item.name === '.trash') continue;
          const fullPath = path.join(dir, item.name);
          if (item.isDirectory()) {
            await scanDirFull(fullPath);
          } else if (item.isFile()) {
            const ext = path.extname(item.name).toLowerCase();
            if (videoExtensions.has(ext)) {
              validItems.push({ fullPath, name: item.name });
              statPromises.push(fs.stat(fullPath).catch(() => null));
            }
          }
        }
        
        const stats = await Promise.all(statPromises);
        for (let i = 0; i < validItems.length; i++) {
          const stat = stats[i];
          if (stat) {
            allFiles.push({
              path: validItems[i].fullPath,
              name: validItems[i].name,
              size: stat.size,
              modified: stat.mtime.getTime()
            });
          } else {
            allFiles.push({
              path: validItems[i].fullPath,
              name: validItems[i].name
            });
          }
        }
      } catch (e) {
        console.warn('Failed to scan directory:', dir, e.message);
      }
    }
    
    // Use fast mode by default
    if (fast === 'true' || fast === undefined) {
      await scanDirFast(performerPath);
    } else {
      await scanDirFull(performerPath);
    }

    // Cache it
    db.prepare('INSERT OR REPLACE INTO performer_file_cache (performer_id, type, data) VALUES (?, ?, ?)').run(id, 'vids', JSON.stringify(allFiles));

    res.send({ vids: allFiles, count: allFiles.length });

  } catch (err) {
    console.error('Gallery videos error:', err);
    res.status(500).send({ error: err.message });
  }
});

module.exports = router;

