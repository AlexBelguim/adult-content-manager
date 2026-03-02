const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const hashService = require('../services/hashService');
const quarantineService = require('../services/quarantineService');
const db = require('../db');

/**
 * GET /api/hashes/performers
 * Get all performers with their hash database status
 */
router.get('/performers', (req, res) => {
  try {
    // Optimized query to fetch performers with hash/clip stats in one go
    const performers = db.prepare(`
      SELECT 
        p.*,
        f.path as folder_path,
        (SELECT COUNT(*) FROM performer_file_hashes WHERE performer_id = p.id) as hash_file_count,
        (SELECT MAX(seen_at) FROM performer_file_hashes WHERE performer_id = p.id) as hash_last_updated,
        (
          SELECT COUNT(DISTINCT ci.id) 
          FROM content_items ci 
          JOIN content_clip_embeddings cce ON ci.id = cce.content_item_id 
          WHERE ci.performer_id = p.id
        ) as clip_files_count,
        (
          SELECT MAX(cce.generated_at) 
          FROM content_items ci 
          JOIN content_clip_embeddings cce ON ci.id = cce.content_item_id 
          WHERE ci.performer_id = p.id
        ) as clip_last_updated
      FROM performers p
      LEFT JOIN folders f ON p.folder_id = f.id
    `).all();

    const performersWithHashStatus = performers.map(performer => {
      const hasHashDB = performer.hash_file_count > 0;
      const hasClipDB = performer.clip_files_count > 0;

      // Determine location from moved_to_after flag or thumbnail path
      let location = 'unknown';
      let folderPath = performer.folder_path;

      // Check moved_to_after flag first (most reliable)
      if (performer.moved_to_after === 1) {
        location = 'after';
      } else if (performer.moved_to_after === 0) {
        location = 'before';
      } else if (performer.thumbnail) {
        // Fallback: check thumbnail path
        const lowerPath = performer.thumbnail.toLowerCase();
        if (lowerPath.includes('before filter performer')) {
          location = 'before';
        } else if (lowerPath.includes('after filter performer')) {
          location = 'after';
        }
      }

      // Build full performer path
      if (folderPath && performer.name) {
        const pathSep = folderPath.includes('\\') ? '\\' : '/';
        const subfolder = location === 'after' ? 'after filter performer' : 'before filter performer';
        folderPath = `${folderPath}${pathSep}${subfolder}${pathSep}${performer.name}`;
      }

      // Convert Unix timestamp to ISO string if available
      let lastUpdated = null;
      if (hasHashDB && performer.hash_last_updated) {
        lastUpdated = new Date(performer.hash_last_updated * 1000).toISOString();
      }

      let clipLastUpdated = null;
      if (hasClipDB && performer.clip_last_updated) {
        clipLastUpdated = new Date(performer.clip_last_updated * 1000).toISOString();
      }

      return {
        id: performer.id,
        canonical_name: performer.name,
        folder_path: folderPath,
        location: location,
        has_hash_db: hasHashDB,
        file_count: performer.hash_file_count,
        last_updated: lastUpdated,
        has_clip_db: hasClipDB,
        files_with_clip: performer.clip_files_count,
        clip_last_updated: clipLastUpdated,
        // Include other performer fields that might be needed
        thumbnail: performer.thumbnail,
        target_stats: {
          vids_count: performer.vids_count,
          pics_count: performer.pics_count,
          total_size_gb: performer.total_size_gb
        },
        ...performer // Spread the rest of the raw performer data just in case
      };
    });

    res.send(performersWithHashStatus);
  } catch (err) {
    console.error('Error fetching performers with hash status:', err);
    res.status(500).send({ error: err.message });
  }
});

/**
 * POST /api/hashes/create
 * Create hash database for a performer
 */
router.post('/create', async (req, res) => {
  try {
    const { performer_id, basePath, mode } = req.body; // mode: 'append'|'replace'

    if (!performer_id) {
      return res.status(400).send({ error: 'performer_id is required' });
    }

    if (!basePath) {
      return res.status(400).send({ error: 'basePath is required' });
    }

    // Check if performer exists
    const performer = db.prepare('SELECT * FROM performers WHERE id = ?').get(performer_id);
    if (!performer) {
      return res.status(404).send({ error: 'Performer not found' });
    }

    // Generate job ID
    const jobId = crypto.randomBytes(16).toString('hex');

    // Start hash creation in background (pass mode parameter)
    hashService.createHashDB(performer_id, basePath, jobId, mode || 'append')
      .catch(err => {
        console.error('Hash creation error:', err);
      });

    res.send({
      success: true,
      jobId,
      message: 'Hash creation started',
    });
  } catch (err) {
    console.error('Error creating hash DB:', err);
    res.status(500).send({ error: err.message });
  }
});


/**
 * DELETE /api/hashes/performer/:id
 * Delete hash DB entries for a performer
 */
router.delete('/performer/:id', (req, res) => {
  try {
    const { id } = req.params;
    const result = db.prepare('DELETE FROM performer_file_hashes WHERE performer_id = ?').run(id);
    res.send({ success: true, deleted: result.changes });
  } catch (err) {
    console.error('Error deleting performer hash DB:', err);
    res.status(500).send({ error: err.message });
  }
});

/**
 * POST /api/hashes/performer/:id/internal-check
 * Run internal duplicate check for a performer (self-comparison at 90% threshold)
 */
router.post('/performer/:id/internal-check', async (req, res) => {
  try {
    const { id } = req.params;

    // Check if performer exists
    const performer = db.prepare('SELECT * FROM performers WHERE id = ?').get(id);
    if (!performer) {
      return res.status(404).send({ error: 'Performer not found' });
    }

    const result = await hashService.checkInternalDuplicates(parseInt(id));

    res.send({
      success: true,
      ...result,
    });
  } catch (err) {
    console.error('Error running internal check:', err);
    res.status(500).send({ error: err.message });
  }
});

/**
 * POST /api/hashes/performer/:id/verify
 * Toggle hash_verified status for a performer
 */
router.post('/performer/:id/verify', (req, res) => {
  try {
    const { id } = req.params;
    const { verified } = req.body;

    // Check if performer exists
    const performer = db.prepare('SELECT * FROM performers WHERE id = ?').get(id);
    if (!performer) {
      return res.status(404).send({ error: 'Performer not found' });
    }

    const result = hashService.setHashVerified(parseInt(id), verified);

    res.send({
      success: true,
      ...result,
    });
  } catch (err) {
    console.error('Error toggling verified status:', err);
    res.status(500).send({ error: err.message });
  }
});

/**
 * GET /api/hashes/performer/:id/status
 * Get performer's hash status (verified, dup count, run id)
 */
router.get('/performer/:id/status', (req, res) => {
  try {
    const { id } = req.params;

    const status = hashService.getPerformerHashStatus(parseInt(id));

    res.send({
      success: true,
      ...status,
    });
  } catch (err) {
    console.error('Error getting performer hash status:', err);
    res.status(500).send({ error: err.message });
  }
});

/**
 * GET /api/hashes/status/:jobId
 * Get status of a hash creation job
 */
router.get('/status/:jobId', (req, res) => {
  try {
    const { jobId } = req.params;
    const status = hashService.getJobStatus(jobId);

    if (!status) {
      return res.status(404).send({ error: 'Job not found' });
    }

    res.send({
      success: true,
      status,
    });
  } catch (err) {
    console.error('Error getting job status:', err);
    res.status(500).send({ error: err.message });
  }
});

/**
 * POST /api/hashes/check
 * Check for duplicates between two performers
 */
router.post('/check', async (req, res) => {
  try {
    const { source_performer_id, target_performer_id, runId } = req.body;

    if (!source_performer_id || !target_performer_id) {
      return res.status(400).send({
        error: 'source_performer_id and target_performer_id are required'
      });
    }

    // Check if performers exist
    const sourcePerformer = db.prepare('SELECT * FROM performers WHERE id = ?').get(source_performer_id);
    const targetPerformer = db.prepare('SELECT * FROM performers WHERE id = ?').get(target_performer_id);

    if (!sourcePerformer || !targetPerformer) {
      return res.status(404).send({ error: 'One or both performers not found' });
    }

    // Generate run ID if not provided
    const actualRunId = runId || crypto.randomBytes(16).toString('hex');

    // Start comparison
    const result = await hashService.checkDuplicates(
      source_performer_id,
      target_performer_id,
      actualRunId
    );

    res.send({
      success: true,
      ...result,
    });
  } catch (err) {
    console.error('Error checking duplicates:', err);
    res.status(500).send({ error: err.message });
  }
});

/**
 * GET /api/hashes/run/:runId
 * Get results for a hash comparison run
 */
router.get('/run/:runId', (req, res) => {
  try {
    const { runId } = req.params;
    const { maxHammingDistance, limit, offset } = req.query;

    const options = {
      maxHammingDistance: maxHammingDistance ? parseInt(maxHammingDistance) : 10,
      limit: limit ? parseInt(limit) : 100,
      offset: offset ? parseInt(offset) : 0,
    };

    const results = hashService.getRunResults(runId, options);

    if (!results.run) {
      return res.status(404).send({ error: 'Run not found' });
    }

    res.send({
      success: true,
      ...results,
    });
  } catch (err) {
    console.error('Error getting run results:', err);
    res.status(500).send({ error: err.message });
  }
});

/**
 * POST /api/hashes/run/:runId/update-selection
 * Update selected items in a run
 */
router.post('/run/:runId/update-selection', (req, res) => {
  try {
    const { runId } = req.params;
    const { itemIds, selected } = req.body;

    if (!Array.isArray(itemIds)) {
      return res.status(400).send({ error: 'itemIds must be an array' });
    }

    const selectedValue = selected ? 1 : 0;

    const updateStmt = db.prepare(`
      UPDATE hash_run_items 
      SET selected = ? 
      WHERE run_id = ? AND id = ?
    `);

    const updateMany = db.transaction((ids) => {
      for (const id of ids) {
        updateStmt.run(selectedValue, runId, id);
      }
    });

    updateMany(itemIds);

    res.send({
      success: true,
      updated: itemIds.length,
    });
  } catch (err) {
    console.error('Error updating selection:', err);
    res.status(500).send({ error: err.message });
  }
});

/**
 * POST /api/hashes/run/:runId/commit
 * Commit action for selected items (quarantine or delete)
 */
router.post('/run/:runId/commit', async (req, res) => {
  try {
    const { runId } = req.params;
    const { action, selectedItems } = req.body;

    if (!action || !['quarantine', 'delete'].includes(action)) {
      return res.status(400).send({
        error: 'action must be either "quarantine" or "delete"'
      });
    }

    if (!Array.isArray(selectedItems) || selectedItems.length === 0) {
      return res.status(400).send({ error: 'selectedItems must be a non-empty array' });
    }

    const result = await quarantineService.commitBatchAction(runId, action, selectedItems);

    res.send({
      success: true,
      ...result,
    });
  } catch (err) {
    console.error('Error committing action:', err);
    res.status(500).send({ error: err.message });
  }
});

/**
 * POST /api/hashes/run/:runId/switch
 * Switch the keeper in a group: swap all items in the group so the chosen file
 * becomes the new candidate (keeper) and the old candidate becomes a removal item.
 */
router.post('/run/:runId/switch', (req, res) => {
  try {
    const { runId } = req.params;
    const { candidateId, chosenFileId } = req.body; // candidateId = current keeper id, chosenFileId = file id to promote

    if (!candidateId || !chosenFileId) {
      return res.status(400).send({ error: 'candidateId and chosenFileId are required' });
    }

    // Ensure run exists
    const run = db.prepare('SELECT * FROM hash_runs WHERE run_id = ?').get(runId);
    if (!run) {
      return res.status(404).send({ error: 'Run not found' });
    }

    // Get all items in this group (all items with the same candidate_id)
    const groupItems = db.prepare(`
      SELECT * FROM hash_run_items
      WHERE run_id = ? AND candidate_id = ?
    `).all(runId, candidateId);

    if (groupItems.length === 0) {
      return res.status(400).send({ error: 'No items found for this candidate' });
    }

    // Get the file path for the new keeper
    const newKeeperFile = db.prepare('SELECT * FROM performer_file_hashes WHERE id = ?').get(chosenFileId);
    if (!newKeeperFile) {
      return res.status(404).send({ error: 'Chosen file not found in performer_file_hashes' });
    }

    // Get the file path for the old keeper
    const oldKeeperFile = db.prepare('SELECT * FROM performer_file_hashes WHERE id = ?').get(candidateId);
    if (!oldKeeperFile) {
      return res.status(404).send({ error: 'Old keeper file not found in performer_file_hashes' });
    }

    // Swap the group in a transaction
    const swapTransaction = db.transaction(() => {
      // For each item in the group, swap file_id_ref and candidate_id
      for (const item of groupItems) {
        if (item.file_id_ref === chosenFileId) {
          // This is the item we're promoting - delete it since it becomes the keeper
          db.prepare('DELETE FROM hash_run_items WHERE id = ?').run(item.id);
        } else {
          // Swap: make this item point to the new keeper
          db.prepare(`
            UPDATE hash_run_items 
            SET candidate_id = ?
            WHERE id = ?
          `).run(chosenFileId, item.id);
        }
      }

      // Add a new item for the old keeper (now marked for removal)
      // Find a reference item to get the match metadata
      const refItem = groupItems[0];

      const result = db.prepare(`
        INSERT INTO hash_run_items (run_id, file_path, file_id_ref, candidate_id, exact_match, hamming_distance, selected)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        runId,
        oldKeeperFile.file_path,
        candidateId,
        chosenFileId,
        refItem.exact_match || 0,
        refItem.hamming_distance || 0,
        1 // selected for removal
      );

      return result.lastInsertRowid;
    });

    const newItemId = swapTransaction();

    // Get the updated group items with full details
    const updatedItems = db.prepare(`
      SELECT 
        ri.*,
        sf.file_path as source_path,
        sf.file_size as source_size,
        sf.perceptual_hash as source_hash,
        sf.deleted_flag as source_deleted,
        tf.file_path as target_path,
        tf.file_size as target_size,
        tf.perceptual_hash as target_hash,
        tf.deleted_flag as target_deleted
      FROM hash_run_items ri
      JOIN performer_file_hashes sf ON ri.file_id_ref = sf.id
      JOIN performer_file_hashes tf ON ri.candidate_id = tf.id
      WHERE ri.run_id = ? AND ri.candidate_id = ?
    `).all(runId, chosenFileId);

    res.send({ success: true, message: 'Switch applied', updatedItems, newItemId });
  } catch (err) {
    console.error('Error switching run items:', err);
    res.status(500).send({ error: err.message });
  }
});

/**
 * GET /api/hashes/run/:runId/export
 * Export run results as JSON
 */
router.get('/run/:runId/export', (req, res) => {
  try {
    const { runId } = req.params;

    const run = db.prepare('SELECT * FROM hash_runs WHERE run_id = ?').get(runId);
    if (!run) {
      return res.status(404).send({ error: 'Run not found' });
    }

    const items = db.prepare(`
      SELECT 
        ri.*,
        sf.file_path as source_path,
        sf.file_size as source_size,
        tf.file_path as target_path,
        tf.file_size as target_size
      FROM hash_run_items ri
      JOIN performer_file_hashes sf ON ri.file_id_ref = sf.id
      JOIN performer_file_hashes tf ON ri.candidate_id = tf.id
      WHERE ri.run_id = ?
    `).all(runId);

    const exportData = {
      run,
      items,
      exportedAt: Date.now(),
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="hash-run-${runId}.json"`);
    res.send(exportData);
  } catch (err) {
    console.error('Error exporting run:', err);
    res.status(500).send({ error: err.message });
  }
});

/**
 * DELETE /api/hashes/run/:runId
 * Delete/expire a hash run
 */
router.delete('/run/:runId', (req, res) => {
  try {
    const { runId } = req.params;

    // Delete run items first (cascade)
    db.prepare('DELETE FROM hash_run_items WHERE run_id = ?').run(runId);

    // Delete run
    const result = db.prepare('DELETE FROM hash_runs WHERE run_id = ?').run(runId);

    if (result.changes === 0) {
      return res.status(404).send({ error: 'Run not found' });
    }

    res.send({
      success: true,
      message: 'Run deleted',
    });
  } catch (err) {
    console.error('Error deleting run:', err);
    res.status(500).send({ error: err.message });
  }
});

/**
 * GET /api/hashes/runs
 * List all hash runs
 */
router.get('/runs', (req, res) => {
  try {
    const { status, limit, offset } = req.query;

    let query = 'SELECT * FROM hash_runs';
    const params = [];

    if (status) {
      query += ' WHERE status = ?';
      params.push(status);
    }

    query += ' ORDER BY created_at DESC';

    if (limit) {
      query += ' LIMIT ?';
      params.push(parseInt(limit));

      if (offset) {
        query += ' OFFSET ?';
        params.push(parseInt(offset));
      }
    }

    const runs = db.prepare(query).all(...params);

    // Get item counts for each run
    const runsWithCounts = runs.map(run => {
      const counts = db.prepare(`
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN exact_match = 1 THEN 1 ELSE 0 END) as exact,
          SUM(CASE WHEN selected = 1 THEN 1 ELSE 0 END) as selected
        FROM hash_run_items
        WHERE run_id = ?
      `).get(run.run_id);

      return {
        ...run,
        itemCounts: counts,
      };
    });

    res.send({
      success: true,
      runs: runsWithCounts,
    });
  } catch (err) {
    console.error('Error listing runs:', err);
    res.status(500).send({ error: err.message });
  }
});

/**
 * GET /api/hashes/stats/:performerId
 * Get hash statistics for a performer
 */
router.get('/stats/:performerId', (req, res) => {
  try {
    const { performerId } = req.params;

    const stats = db.prepare(`
      SELECT 
        COUNT(*) as total_files,
        COUNT(CASE WHEN exact_hash IS NOT NULL THEN 1 END) as files_with_exact_hash,
        COUNT(CASE WHEN perceptual_hash IS NOT NULL THEN 1 END) as files_with_perceptual_hash,
        COUNT(CASE WHEN deleted_flag = 1 THEN 1 END) as deleted_files,
        SUM(file_size) as total_size
      FROM performer_file_hashes
      WHERE performer_id = ?
    `).get(performerId);

    res.send({
      success: true,
      stats,
    });
  } catch (err) {
    console.error('Error getting stats:', err);
    res.status(500).send({ error: err.message });
  }
});

/**
 * GET /api/quarantine/list
 * List quarantined files
 */
router.get('/quarantine/list', async (req, res) => {
  try {
    const result = await quarantineService.listQuarantinedFiles();
    res.send(result);
  } catch (err) {
    console.error('Error listing quarantined files:', err);
    res.status(500).send({ error: err.message });
  }
});

/**
 * POST /api/quarantine/restore
 * Restore a file from quarantine
 */
router.post('/quarantine/restore', async (req, res) => {
  try {
    const { quarantinePath } = req.body;

    if (!quarantinePath) {
      return res.status(400).send({ error: 'quarantinePath is required' });
    }

    const result = await quarantineService.restoreFromQuarantine(quarantinePath);

    res.send(result);
  } catch (err) {
    console.error('Error restoring from quarantine:', err);
    res.status(500).send({ error: err.message });
  }
});

/**
 * POST /api/quarantine/cleanup
 * Clean up old quarantined files
 */
router.post('/quarantine/cleanup', async (req, res) => {
  try {
    const result = await quarantineService.cleanupOldQuarantineFiles();
    res.send(result);
  } catch (err) {
    console.error('Error cleaning up quarantine:', err);
    res.status(500).send({ error: err.message });
  }
});

module.exports = router;
