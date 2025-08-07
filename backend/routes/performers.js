const express = require('express');
const router = express.Router();
const { importPerformer } = require('../services/importer');
const { scanPerformerFolder } = require('../services/fileScanner');
const merger = require('../services/merger');
const db = require('../db');
const fs = require('fs-extra');
const path = require('path');

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
    const performers = db.prepare(`
      SELECT p.*, f.path as folder_path 
      FROM performers p 
      JOIN folders f ON p.folder_id = f.id
      WHERE p.moved_to_after = 0
    `).all();
    
    // Add filter statistics for each performer
    const filterService = require('../services/filterService');
    const performersWithStats = performers.map(performer => {
      const filterStats = filterService.getFilterStats(performer.id);
      return {
        ...performer,
        filterStats
      };
    });
    
    res.send(performersWithStats);
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
    res.send(performers);
  } catch (err) {
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
    res.send({ success: true, message: 'Thumbnail updated' });
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

// Move performer to after folder
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
    
    const performerPath = path.join(performer.folder_path, 'before filter performer', performer.name);
    const stats = await scanPerformerFolder(performerPath);
    
    db.prepare(`
      UPDATE performers 
      SET pics_count = ?, vids_count = ?, funscript_vids_count = ?, 
          funscript_files_count = ?, total_size_gb = ?,
          pics_original_count = ?, vids_original_count = ?, funscript_vids_original_count = ?
      WHERE id = ?
    `).run(
      stats.pics_count,
      stats.vids_count,
      stats.funscript_vids_count,
      stats.funscript_files_count,
      stats.total_size_gb,
      stats.pics_count,      // Update original counts to match current counts
      stats.vids_count,      
      stats.funscript_vids_count,
      id
    );
    
    res.send({ success: true, message: 'Stats refreshed', stats });
  } catch (err) {
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

// Delete performer folder from system
router.delete('/:id/folder', async (req, res) => {
  const { id } = req.params;
  
  try {
    const performer = db.prepare('SELECT * FROM performers WHERE id = ?').get(id);
    if (!performer) {
      return res.status(404).send({ error: 'Performer not found' });
    }

    // Only allow deletion of performers that are in "after filter performer" state
    if (performer.moved_to_after !== 1) {
      return res.status(400).send({ error: 'Can only delete performers from "after filter performer" folder' });
    }

    const folder = db.prepare('SELECT * FROM folders WHERE id = ?').get(performer.folder_id);
    
    // Only delete from "after filter performer" folder
    const afterPath = path.join(folder.path, 'after filter performer', performer.name);
    
    // Delete folder from filesystem
    if (await fs.pathExists(afterPath)) {
      await fs.remove(afterPath);
    }
    
    // Delete from database - this completely removes the performer record
    // so it can be re-imported fresh without any moved_to_after conflicts
    db.prepare('DELETE FROM filter_actions WHERE performer_id = ?').run(id);
    db.prepare('DELETE FROM tags WHERE performer_id = ?').run(id);
    db.prepare('DELETE FROM performers WHERE id = ?').run(id);
    
    res.send({ success: true, message: 'Performer folder and data deleted from after filter folder' });
  } catch (err) {
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
    const trashFolders = [
      path.join(performerPath, 'pics', '.trash'),
      path.join(performerPath, 'vids', '.trash'),
      path.join(performerPath, 'vids', 'funscript', '.trash')
    ];

    for (const trashFolder of trashFolders) {
      if (await fs.pathExists(trashFolder)) {
        const files = await fs.readdir(trashFolder);
        deletedCount += files.length;
        await fs.remove(trashFolder); // Permanently delete the entire .trash folder
      }
    }

    res.send({ 
      success: true, 
      message: `Permanently deleted ${deletedCount} files from trash`,
      deletedCount 
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
    const trashFolders = [
      path.join(performerPath, 'pics', '.trash'),
      path.join(performerPath, 'vids', '.trash'),
      path.join(performerPath, 'vids', 'funscript', '.trash')
    ];

    for (const trashFolder of trashFolders) {
      if (await fs.pathExists(trashFolder)) {
        const files = await fs.readdir(trashFolder);
        deletedCount += files.length;
        await fs.remove(trashFolder); // Delete the entire .trash folder
        console.log(`Cleaned up trash folder on exit: ${trashFolder} (${files.length} files)`);
      }
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
      message: `Cleaned up ${deletedCount} trash files and updated stats`,
      deletedCount,
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

module.exports = router;