const express = require('express');
const router = express.Router();
const db = require('../db');
const path = require('path');
const fs = require('fs');

/**
 * Mobile API Routes
 * Handles mobile app sync, downloads, and offline functionality
 */

// Get all performers with metadata for mobile sync
router.get('/performers', (req, res) => {
  try {
    const performers = db.prepare(`
      SELECT 
        p.id,
        p.name,
        p.thumbnail,
        p.aliases,
        p.moved_to_after,
        p.age,
        p.country_flag,
        p.birthplace,
        p.hair_color,
        p.eye_color,
        p.ethnicity,
        p.body_type,
        p.height,
        p.weight,
        p.measurements,
        f.path as folder_path,
        p.vids_count as video_count,
        p.pics_count as image_count,
        p.funscript_vids_count as funscript_count,
        p.total_size_gb * 1024 * 1024 * 1024 as total_size
      FROM performers p
      JOIN folders f ON p.folder_id = f.id
      ORDER BY p.name
    `).all();

    res.json(performers);
  } catch (err) {
    console.error('Error fetching performers for mobile:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get performer's content with file info for download
router.get('/performers/:id/content', (req, res) => {
  const { id } = req.params;
  const { type } = req.query; // optional filter: video, image, funscript

  try {
    // Get performer info to build file paths
    const performer = db.prepare(`
      SELECT p.*, f.path as folder_path
      FROM performers p
      JOIN folders f ON p.folder_id = f.id
      WHERE p.id = ?
    `).get(id);

    if (!performer) {
      return res.status(404).json({ error: 'Performer not found' });
    }

    // Build the performer's folder path
    const folderName = performer.moved_to_after ? 'after filter performer' : 'before filter performer';
    const performerPath = path.join(performer.folder_path, folderName, performer.name);

    // Scan the actual files from the filesystem
    const content = [];
    
    // Add videos
    if (!type || type === 'video') {
      const vidsPath = path.join(performerPath, 'vids');
      if (fs.existsSync(vidsPath)) {
        const files = fs.readdirSync(vidsPath);
        files.forEach((file, index) => {
          const ext = path.extname(file).toLowerCase();
          if (['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm'].includes(ext)) {
            const filePath = path.join(vidsPath, file);
            const stats = fs.statSync(filePath);
            
            // Check if there's a funscript file
            const funscriptPath = path.join(vidsPath, file.replace(ext, '.funscript'));
            const hasFunscript = fs.existsSync(funscriptPath);
            
            // Check filter status
            const filterAction = db.prepare('SELECT action FROM filter_actions WHERE performer_id = ? AND file_path = ?')
              .get(id, filePath);
            
            content.push({
              id: `video_${index}`,
              file_name: file,
              file_path: filePath,
              type: 'video',
              size: stats.size,
              has_funscript: hasFunscript,
              funscript_path: hasFunscript ? funscriptPath : null,
              filter_status: filterAction ? filterAction.action : null,
              created_at: stats.birthtime
            });
          }
        });
      }
    }

    // Add images
    if (!type || type === 'image') {
      const picsPath = path.join(performerPath, 'pics');
      if (fs.existsSync(picsPath)) {
        const files = fs.readdirSync(picsPath);
        files.forEach((file, index) => {
          const ext = path.extname(file).toLowerCase();
          if (['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) {
            const filePath = path.join(picsPath, file);
            const stats = fs.statSync(filePath);
            
            // Check filter status
            const filterAction = db.prepare('SELECT action FROM filter_actions WHERE performer_id = ? AND file_path = ?')
              .get(id, filePath);
            
            content.push({
              id: `image_${index}`,
              file_name: file,
              file_path: filePath,
              type: 'image',
              size: stats.size,
              filter_status: filterAction ? filterAction.action : null,
              created_at: stats.birthtime
            });
          }
        });
      }
    }

    res.json(content);
  } catch (err) {
    console.error('Error fetching performer content:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get genres with content counts
router.get('/genres', (req, res) => {
  const { basePath } = req.query;

  if (!basePath) {
    return res.status(400).json({ error: 'basePath is required' });
  }

  try {
    const contentPath = path.join(basePath, 'content');
    
    if (!fs.existsSync(contentPath)) {
      return res.json([]);
    }

    const genres = fs.readdirSync(contentPath, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => {
        const genrePath = path.join(contentPath, dirent.name);
        const files = fs.readdirSync(genrePath);
        
        const videos = files.filter(f => /\.(mp4|avi|mov|mkv|wmv)$/i.test(f));
        const images = files.filter(f => /\.(jpg|jpeg|png|gif|webp)$/i.test(f));
        const funscripts = files.filter(f => f.endsWith('.funscript'));

        // Calculate total size
        let totalSize = 0;
        files.forEach(file => {
          try {
            const filePath = path.join(genrePath, file);
            const stats = fs.statSync(filePath);
            totalSize += stats.size;
          } catch (e) {
            // Skip files that can't be read
          }
        });

        return {
          name: dirent.name,
          path: genrePath,
          video_count: videos.length,
          image_count: images.length,
          funscript_count: funscripts.length,
          total_size: totalSize
        };
      });

    res.json(genres);
  } catch (err) {
    console.error('Error fetching genres:', err);
    res.status(500).json({ error: err.message });
  }
});

// Check for updates since last sync
router.get('/sync/check', (req, res) => {
  const { since } = req.query; // timestamp of last sync

  if (!since) {
    return res.status(400).json({ error: 'since timestamp is required' });
  }

  try {
    const sinceDate = new Date(parseInt(since));

    // Get updated performers
    const updatedPerformers = db.prepare(`
      SELECT id, name, updated_at
      FROM performers
      WHERE updated_at > ?
    `).all(sinceDate.toISOString());

    // Get new/updated content
    const updatedContent = db.prepare(`
      SELECT id, performer_id, file_name, created_at
      FROM content_items
      WHERE created_at > ?
    `).all(sinceDate.toISOString());

    // Get filter actions that need to be downloaded
    const filterActions = db.prepare(`
      SELECT id, content_id, action, created_at
      FROM filter_actions
      WHERE created_at > ?
    `).all(sinceDate.toISOString());

    res.json({
      has_updates: updatedPerformers.length > 0 || updatedContent.length > 0 || filterActions.length > 0,
      updated_performers: updatedPerformers,
      updated_content: updatedContent,
      filter_actions: filterActions,
      sync_timestamp: Date.now()
    });
  } catch (err) {
    console.error('Error checking for sync updates:', err);
    res.status(500).json({ error: err.message });
  }
});

// Upload Keep/Delete actions from mobile
router.post('/sync/actions', (req, res) => {
  const { actions } = req.body; // Array of {performer_id, file_path, action: 'keep'|'delete'}

  if (!actions || !Array.isArray(actions)) {
    return res.status(400).json({ error: 'actions array is required' });
  }

  try {
    const results = {
      success: [],
      failed: []
    };

    actions.forEach(({ performer_id, file_path, action }) => {
      try {
        if (!performer_id || !file_path || !action) {
          results.failed.push({ performer_id, file_path, error: 'Missing required fields' });
          return;
        }

        if (!fs.existsSync(file_path)) {
          results.failed.push({ performer_id, file_path, error: 'File not found' });
          return;
        }

        // Determine file type
        const ext = path.extname(file_path).toLowerCase();
        let fileType = 'unknown';
        if (['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm'].includes(ext)) {
          fileType = 'video';
        } else if (['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) {
          fileType = 'image';
        } else if (ext === '.funscript') {
          fileType = 'funscript';
        }

        if (action === 'keep') {
          // Record filter action
          db.prepare(`
            INSERT OR REPLACE INTO filter_actions (performer_id, file_path, file_type, action, timestamp)
            VALUES (?, ?, ?, 'keep', ?)
          `).run(performer_id, file_path, fileType, new Date().toISOString());

          results.success.push({ performer_id, file_path, action: 'keep' });

        } else if (action === 'delete') {
          // Record filter action
          db.prepare(`
            INSERT OR REPLACE INTO filter_actions (performer_id, file_path, file_type, action, timestamp)
            VALUES (?, ?, ?, 'delete', ?)
          `).run(performer_id, file_path, fileType, new Date().toISOString());

          // Delete the actual file
          fs.unlinkSync(file_path);

          // Delete funscript if exists
          const funscriptPath = file_path.replace(ext, '.funscript');
          if (fs.existsSync(funscriptPath)) {
            fs.unlinkSync(funscriptPath);
          }

          results.success.push({ performer_id, file_path, action: 'delete' });
        } else {
          results.failed.push({ performer_id, file_path, error: 'Invalid action' });
        }

      } catch (err) {
        console.error('Error processing action:', err);
        results.failed.push({ performer_id, file_path, error: err.message });
      }
    });

    res.json(results);
  } catch (err) {
    console.error('Error syncing actions:', err);
    res.status(500).json({ error: err.message });
  }
});

// Download file with range support (for resume capability)
router.get('/download/:type/:id', (req, res) => {
  const { type, id } = req.params; // type: 'content' or 'thumbnail'

  try {
    let filePath;

    if (type === 'content') {
      const content = db.prepare('SELECT file_path, file_name, size FROM content_items WHERE id = ?').get(id);
      if (!content) {
        return res.status(404).json({ error: 'Content not found' });
      }
      filePath = content.file_path;
    } else if (type === 'thumbnail') {
      const performer = db.prepare('SELECT thumbnail FROM performers WHERE id = ?').get(id);
      if (!performer || !performer.thumbnail) {
        return res.status(404).json({ error: 'Thumbnail not found' });
      }
      filePath = performer.thumbnail;
    } else {
      return res.status(400).json({ error: 'Invalid type' });
    }

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found on disk' });
    }

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;

    if (range) {
      // Handle range request for resume capability
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = (end - start) + 1;
      const file = fs.createReadStream(filePath, { start, end });

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': 'application/octet-stream',
      });

      file.pipe(res);
    } else {
      // Normal download
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${path.basename(filePath)}"`
      });

      fs.createReadStream(filePath).pipe(res);
    }
  } catch (err) {
    console.error('Error downloading file:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get download progress tracking info
router.get('/downloads/status', (req, res) => {
  const { content_ids } = req.query; // comma-separated content IDs

  if (!content_ids) {
    return res.status(400).json({ error: 'content_ids is required' });
  }

  try {
    const ids = content_ids.split(',').map(id => parseInt(id));
    const placeholders = ids.map(() => '?').join(',');
    
    const content = db.prepare(`
      SELECT id, file_name, size, type
      FROM content_items
      WHERE id IN (${placeholders})
    `).all(...ids);

    res.json(content);
  } catch (err) {
    console.error('Error fetching download status:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
