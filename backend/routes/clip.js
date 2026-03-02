const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const clipService = require('../services/clipService');
const db = require('../db');

/**
 * GET /api/clip/performers
 * Get all performers with their CLIP database status
 */
router.get('/performers', (req, res) => {
  try {
    // Get all performers
    const performers = db.prepare('SELECT * FROM performers').all();
    
    // Get CLIP status for each performer
    const performersWithClipStatus = performers.map(performer => {
      const clipStats = clipService.getClipStats(performer.id);
      
      const hasClipDB = clipStats && clipStats.files_with_clip > 0;
      
      // Determine location from moved_to_after flag
      let location = 'unknown';
      let folderPath = null;
      
      if (performer.folder_id) {
        const folder = db.prepare('SELECT path FROM folders WHERE id = ?').get(performer.folder_id);
        if (folder) {
          folderPath = folder.path;
        }
      }
      
      // Check moved_to_after flag
      if (performer.moved_to_after === 1) {
        location = 'after';
      } else if (performer.moved_to_after === 0) {
        location = 'before';
      }
      
      // Build full performer path
      if (folderPath && performer.name) {
        const pathSep = folderPath.includes('\\') ? '\\' : '/';
        const subfolder = location === 'after' ? 'after filter performer' : 'before filter performer';
        folderPath = `${folderPath}${pathSep}${subfolder}${pathSep}${performer.name}`;
      }
      
      // Convert Unix timestamp to ISO string if available
      let lastUpdated = null;
      if (hasClipDB && clipStats.last_updated) {
        lastUpdated = new Date(clipStats.last_updated * 1000).toISOString();
      }
      
      return {
        id: performer.id,
        canonical_name: performer.name,
        folder_path: folderPath,
        location: location,
        has_clip_db: hasClipDB,
        file_count: clipStats ? clipStats.total_files : 0,
        files_with_clip: clipStats ? clipStats.files_with_clip : 0,
        last_updated: lastUpdated,
      };
    });
    
    res.send(performersWithClipStatus);
  } catch (err) {
    console.error('Error fetching performers with CLIP status:', err);
    res.status(500).send({ error: err.message });
  }
});

/**
 * POST /api/clip/create
 * Create CLIP embeddings for a performer
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
    
    // Start CLIP creation in background
    clipService.createClipDB(performer_id, basePath, jobId, mode || 'append')
      .catch(err => {
        console.error('CLIP creation error:', err);
      });
    
    res.send({
      success: true,
      jobId,
      message: 'CLIP embedding creation started',
    });
  } catch (err) {
    console.error('Error creating CLIP DB:', err);
    res.status(500).send({ error: err.message });
  }
});

/**
 * GET /api/clip/status/:jobId
 * Get status of a CLIP creation job
 */
router.get('/status/:jobId', (req, res) => {
  try {
    const { jobId } = req.params;
    const status = clipService.getJobStatus(jobId);
    
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
 * GET /api/clip/stats/:performerId
 * Get CLIP statistics for a performer
 */
router.get('/stats/:performerId', (req, res) => {
  try {
    const { performerId } = req.params;
    
    const stats = clipService.getClipStats(performerId);
    
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
 * DELETE /api/clip/performer/:id
 * Delete CLIP embeddings for a performer
 */
router.delete('/performer/:id', (req, res) => {
  try {
    const { id } = req.params;
    
    // Get all content items for this performer
    const contentItems = db.prepare(`
      SELECT id FROM content_items WHERE performer_id = ?
    `).all(id);
    
    let deletedCount = 0;
    for (const item of contentItems) {
      const result = db.prepare('DELETE FROM content_clip_embeddings WHERE content_item_id = ?').run(item.id);
      deletedCount += result.changes;
    }
    
    res.send({ success: true, deleted: deletedCount });
  } catch (err) {
    console.error('Error deleting performer CLIP DB:', err);
    res.status(500).send({ error: err.message });
  }
});

module.exports = router;
