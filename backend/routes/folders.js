const express = require('express');
const router = express.Router();
const { validateAndCreateStructure, scanBeforeFolder, scanAfterFolder, scanContentFolder, scanOrphanedPerformers } = require('../services/fileScanner');
const { importPerformer, getPerformerFiles } = require('../services/importer');
const merger = require('../services/merger');
const db = require('../db');

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