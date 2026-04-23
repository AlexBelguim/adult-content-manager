const express = require('express');
const router = express.Router();
const multer = require('multer');
const { validateAndCreateStructure, scanBeforeFolder, scanAfterFolder, scanContentFolder, scanOrphanedPerformers, scanBeforeUploadFolder } = require('../services/fileScanner');
const { importPerformer, getPerformerFiles } = require('../services/importer');
const { uploadImportPerformer, uploadProgressMap } = require('../services/uploadImporter');
const { addLocalImportToQueue } = require('../services/uploadQueue');

const merger = require('../services/merger');

const db = require('../db');

const path = require('path');
const fs = require('fs-extra');

// Configure multer for disk storage (files saved to temp folder in basePath)
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      // Get basePath from query parameter (sent before body is parsed)
      const basePath = req.query.basePath;
      console.log(`[Multer] Receiving file: ${file.originalname}, basePath from query: ${basePath}`);
      if (!basePath) {
        console.error('[Multer] ERROR: basePath query parameter is missing!');
        return cb(new Error('basePath query parameter is required for upload'));
      }
      // Create temp folder in the basePath (same storage as final destination)
      const tempDir = path.join(basePath, '.temp-uploads');
      try {
        fs.ensureDirSync(tempDir);
        console.log(`[Multer] Saving to temp dir: ${tempDir}`);
        cb(null, tempDir);
      } catch (err) {
        console.error(`[Multer] ERROR creating temp dir: ${err.message}`);
        cb(err);
      }
    },
    filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.random().toString(36).substr(2, 9)}-${file.originalname}`)
  }),
  limits: {
    fileSize: 10 * 1024 * 1024 * 1024, // 10GB max per file
    files: 10000 // max 10000 files per upload
  }
});

// Add a new folder
router.post('/add', async (req, res) => {
  const { path: basePath } = req.body;
  try {
    await validateAndCreateStructure(basePath);
    db.prepare('INSERT OR IGNORE INTO folders (path) VALUES (?)').run(basePath);

    // Scan and import existing performers from "after filter performer" folder
    const existingPerformers = await scanAfterFolder(basePath);
    console.log(`Imported ${existingPerformers.length} existing performers from after filter folder`);

    res.send({
      success: true,
      message: `Folder added successfully. Found ${existingPerformers.length} existing performers.`
    });
  } catch (err) {
    res.status(500).send({ error: err.message });
  }
});

// Get all folders
router.get('/', (req, res) => {
  try {
    const folders = db.prepare('SELECT * FROM folders').all();
    res.send(folders);
  } catch (err) {
    res.status(500).send({ error: err.message });
  }
});

// Scan for new performers
router.get('/scan', async (req, res) => {
  try {
    const folders = db.prepare('SELECT * FROM folders').all();
    if (!folders.length) return res.send({ newPerformers: [], orphanedPerformers: [] });

    const newPerformers = await scanBeforeFolder(folders[0].path);
    const orphanedPerformers = await scanOrphanedPerformers(folders[0].path);

    res.send({
      newPerformers,
      orphanedPerformers
    });
  } catch (err) {
    console.error('Error scanning for new performers:', err);
    res.status(500).send({ error: err.message });
  }
});

// Manual scan - force scan filesystem for new performers
router.post('/scan-manual', async (req, res) => {
  try {
    const folders = db.prepare('SELECT * FROM folders').all();
    if (!folders.length) return res.send({ newPerformers: [], orphanedPerformers: [] });

    const newPerformers = await scanBeforeFolder(folders[0].path);
    const orphanedPerformers = await scanOrphanedPerformers(folders[0].path);

    res.send({
      success: true,
      newPerformers,
      orphanedPerformers,
      message: `Scan complete: Found ${newPerformers.length} new performer(s)`
    });
  } catch (err) {
    console.error('Error during manual scan:', err);
    res.status(500).send({ error: err.message });
  }
});

// Scan after filter performer folder and import existing performers
router.get('/scan-after', async (req, res) => {
  try {
    const folders = db.prepare('SELECT * FROM folders').all();
    if (!folders.length) return res.send([]);

    const existingPerformers = await scanAfterFolder(folders[0].path);
    res.send({
      success: true,
      count: existingPerformers.length,
      performers: existingPerformers
    });
  } catch (err) {
    console.error('Error scanning after filter performers:', err);
    res.status(500).send({ error: err.message });
  }
});

// Scan content folder for genres
router.get('/scan-content', async (req, res) => {
  try {
    const folders = db.prepare('SELECT * FROM folders').all();
    if (!folders.length) return res.send([]);

    const genres = await scanContentFolder(folders[0].path);
    res.send(genres);
  } catch (err) {
    console.error('Error scanning content folder:', err);
    res.status(500).send({ error: err.message });
  }
});

// Delete orphaned performers
router.post('/delete-orphaned', async (req, res) => {
  const { performerIds } = req.body;

  try {
    if (!Array.isArray(performerIds) || performerIds.length === 0) {
      return res.status(400).send({ error: 'No performer IDs provided' });
    }

    // Delete filter actions first (foreign key constraint)
    for (const id of performerIds) {
      db.prepare('DELETE FROM filter_actions WHERE performer_id = ?').run(id);
    }

    // Delete performers
    const placeholders = performerIds.map(() => '?').join(',');
    const deletedCount = db.prepare(`DELETE FROM performers WHERE id IN (${placeholders})`).run(...performerIds).changes;

    res.send({
      success: true,
      message: `Deleted ${deletedCount} orphaned performer(s) from database`,
      deletedCount
    });
  } catch (err) {
    console.error('Error deleting orphaned performers:', err);
    res.status(500).send({ error: err.message });
  }
});

// Import a performer
router.post('/import', async (req, res) => {
  const { performerName, basePath, newName, merge } = req.body;
  console.log(`Import API called:`, { performerName, basePath, newName, merge });

  try {
    const result = await importPerformer(performerName, basePath, newName, merge);
    console.log(`Import completed successfully:`, result);

    // Find the performer ID to return for alias saving
    const folder = db.prepare('SELECT * FROM folders WHERE path = ?').get(basePath);
    if (folder) {
      const performer = db.prepare(
        'SELECT id FROM performers WHERE name = ? AND folder_id = ?'
      ).get(newName || performerName, folder.id);
      if (performer) {
        result.performerId = performer.id;
      }
    }

    res.send(result);
  } catch (err) {
    console.error(`Import failed:`, err.message);
    // Handle different types of "already exists" errors
    if (err.message.includes('already exists in "before filter performer"')) {
      // Performer exists in before filter - require merge
      res.status(409).send({
        error: err.message,
        suggestMerge: true,
        performerName: newName || performerName,
        conflictLocation: 'before'
      });
    } else if (err.message.includes('already exists')) {
      // Generic already exists error
      res.status(409).send({
        error: err.message,
        suggestMerge: true,
        performerName: newName || performerName
      });
    } else {
      res.status(500).send({ error: err.message });
    }
  }
});

// Get performer files for import preview
router.get('/performer-files/:performerName', async (req, res) => {
  const { performerName } = req.params;
  const { basePath, type } = req.query;

  try {
    const files = await getPerformerFiles(performerName, basePath, type);
    res.send(files);
  } catch (err) {
    res.status(500).send({ error: err.message });
  }
});

// Scan "before upload" folder for performer folders ready for local import
router.get('/scan-before-upload', async (req, res) => {
  try {
    const folders = db.prepare('SELECT * FROM folders').all();
    if (!folders.length) return res.json({ performers: [] });

    const basePath = req.query.basePath || folders[0].path;
    const performers = await scanBeforeUploadFolder(basePath);

    res.json({
      success: true,
      performers,
      count: performers.length
    });
  } catch (err) {
    console.error('Error scanning before upload folder:', err);
    res.status(500).json({ error: err.message });
  }
});

// Local import - import performer(s) from "before upload" folder (no HTTP upload needed)
router.post('/local-import', async (req, res) => {
  const { performers, basePath, createHashes } = req.body;

  if (!performers || !Array.isArray(performers) || performers.length === 0) {
    return res.status(400).json({ error: 'performers array is required' });
  }

  if (!basePath) {
    return res.status(400).json({ error: 'basePath is required' });
  }

  try {
    const jobIds = [];

    for (const performer of performers) {
      const jobId = addLocalImportToQueue({
        folderName: performer.folderName,
        performerName: performer.name,
        basePath,
        totalFiles: performer.totalFiles || 0,
        createHashes: !!createHashes
      });
      jobIds.push({ performerName: performer.name, jobId });
    }

    res.json({
      success: true,
      message: `${performers.length} performer(s) queued for local import`,
      jobs: jobIds
    });
  } catch (err) {
    console.error('Error queuing local import:', err);
    res.status(500).json({ error: err.message });
  }
});

// Upload-based import - upload files directly instead of scanning
router.post('/upload-import', upload.array('files'), async (req, res) => {
  // Get basePath from query (for multer) and body
  const basePathFromQuery = req.query.basePath;
  const basePathFromBody = req.body.basePath;
  const basePath = basePathFromQuery || basePathFromBody;

  const { performerName, batchIndex, totalBatches, totalFiles, isLastBatch } = req.body;
  // Get uploadId from query (most reliable), body, headers, or generate one
  const uploadId = req.query.uploadId || req.body.uploadId || req.headers['x-upload-id'] || `upload-${Date.now()}`;
  const files = req.files;

  const batchNum = parseInt(batchIndex) || 0;
  const numTotalBatches = parseInt(totalBatches) || 1;
  const numTotalFiles = parseInt(totalFiles) || files?.length || 0;
  const isFinalBatch = isLastBatch === 'true' || isLastBatch === true;

  console.log(`\n=== Upload batch ${batchNum + 1}/${numTotalBatches} ===`);
  console.log(`  performerName: ${performerName}`);
  console.log(`  basePath: ${basePath}`);
  console.log(`  files in this batch: ${files?.length}`);
  console.log(`  total files: ${numTotalFiles}`);
  console.log(`  uploadId: ${uploadId}`);
  console.log(`  isFinalBatch: ${isFinalBatch}`);

  if (!performerName || !basePath) {
    return res.status(400).send({ error: 'Performer name and base path are required' });
  }

  if (!files || files.length === 0) {
    return res.status(400).send({ error: 'No files in this batch' });
  }

  // For non-final batches, just acknowledge receipt (files already saved to temp by multer)
  if (!isFinalBatch) {
    console.log(`  Batch ${batchNum + 1} received, waiting for more batches...`);
    return res.send({
      success: true,
      batch: batchNum,
      filesReceived: files.length,
      message: `Batch ${batchNum + 1}/${numTotalBatches} received`
    });
  }

  // This is the final batch - just acknowledge receipt
  // The frontend will call /api/upload-queue to add the job for background processing
  console.log(`  Final batch received! Files ready for queue processing.`);

  res.send({
    success: true,
    batch: batchNum,
    filesReceived: files.length,
    message: `Final batch ${batchNum + 1}/${numTotalBatches} received. Ready for queue processing.`,
    uploadId
  });
});

// Get upload status
router.get('/upload-status/:id', (req, res) => {
  const { id } = req.params;

  if (uploadProgressMap.has(id)) {
    res.send(uploadProgressMap.get(id));
  } else {
    // Return a "waiting" status instead of 404
    // This handles the race condition where polling starts before processing begins
    res.send({
      status: 'waiting',
      processed: 0,
      total: 0,
      currentFile: 'Waiting for server to start processing...'
    });
  }
});

// Check if performer exists in after folder
router.post('/check-performer', async (req, res) => {
  const { performerName, basePath } = req.body;

  try {
    const exists = await merger.checkPerformerExists(performerName, basePath, 'after');
    res.send({ exists });
  } catch (err) {
    res.status(500).send({ error: err.message });
  }
});

// Find potential performer matches by name and aliases
router.post('/find-matches', async (req, res) => {
  const { performerName, basePath } = req.body;

  try {
    // Get all performers in 'after filter performer'
    const folder = db.prepare('SELECT * FROM folders WHERE path = ?').get(basePath);
    if (!folder) {
      return res.status(404).send({ error: 'Folder not found' });
    }

    const allPerformers = db.prepare(
      'SELECT * FROM performers WHERE folder_id = ? AND moved_to_after = 1'
    ).all(folder.id);

    const matches = [];

    for (const performer of allPerformers) {
      let matchType = null;
      let matchScore = 0;

      // Exact name match
      if (performer.name.toLowerCase() === performerName.toLowerCase()) {
        matchType = 'exact_name';
        matchScore = 100;
      } else {
        // Check aliases
        if (performer.aliases) {
          try {
            const aliases = JSON.parse(performer.aliases);
            if (Array.isArray(aliases)) {
              for (const alias of aliases) {
                if (alias.toLowerCase() === performerName.toLowerCase()) {
                  matchType = 'alias_match';
                  matchScore = 90;
                  break;
                }
                // Partial match
                if (alias.toLowerCase().includes(performerName.toLowerCase()) ||
                  performerName.toLowerCase().includes(alias.toLowerCase())) {
                  if (!matchType) {
                    matchType = 'partial_match';
                    matchScore = 50;
                  }
                }
              }
            }
          } catch (e) {
            // Invalid JSON, skip
          }
        }

        // Partial name match
        if (!matchType && (
          performer.name.toLowerCase().includes(performerName.toLowerCase()) ||
          performerName.toLowerCase().includes(performer.name.toLowerCase())
        )) {
          matchType = 'partial_name';
          matchScore = 40;
        }
      }

      if (matchType) {
        matches.push({
          id: performer.id,
          name: performer.name,
          aliases: performer.aliases ? JSON.parse(performer.aliases) : [],
          matchType,
          matchScore,
          thumbnail: performer.thumbnail,
          pics_count: performer.pics_count,
          vids_count: performer.vids_count,
          total_size_gb: performer.total_size_gb
        });
      }
    }

    // Sort by match score (highest first)
    matches.sort((a, b) => b.matchScore - a.matchScore);

    res.send({ matches });
  } catch (err) {
    console.error('Error finding matches:', err);
    res.status(500).send({ error: err.message });
  }
});

// Merge imported performer with existing one
router.post('/merge-import', async (req, res) => {
  const { performerName, basePath, options } = req.body;

  try {
    const result = await merger.mergeImportedPerformer(performerName, basePath, options);
    res.send(result);
  } catch (err) {
    res.status(500).send({ error: err.message });
  }
});

// Delete a folder from the app (not from file system) - FULL DATABASE RESET
router.delete('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const folder = db.prepare('SELECT * FROM folders WHERE id = ?').get(id);
    if (!folder) {
      return res.status(404).send({ error: 'Folder not found' });
    }

    console.log(`Full database reset requested for folder: ${folder.path}`);

    // FULL DATABASE RESET - Delete ALL data from ALL tables
    console.log('Resetting all database tables...');

    // Delete all data from all tables in correct order (respecting foreign keys)
    db.exec('DELETE FROM filter_actions');
    db.exec('DELETE FROM tags');
    db.exec('DELETE FROM file_tags');
    db.exec('DELETE FROM exported_files');
    db.exec('DELETE FROM video_scenes');
    db.exec('DELETE FROM performers');
    db.exec('DELETE FROM content_genres');
    db.exec('DELETE FROM folders');
    db.exec('DELETE FROM app_settings');

    // Reset auto-increment counters (sqlite_sequence table only exists if there are AUTOINCREMENT columns)
    try {
      db.exec('DELETE FROM sqlite_sequence');
    } catch (e) {
      // sqlite_sequence table doesn't exist, which is fine
      console.log('sqlite_sequence table does not exist, skipping reset');
    }

    console.log('Database fully reset - all tables cleared');

    res.send({
      success: true,
      message: `Database fully reset. All folders and data have been cleared from the app.`,
      reset: true
    });
  } catch (err) {
    console.error('Error during database reset:', err);
    res.status(500).send({ error: err.message });
  }
});

module.exports = router;