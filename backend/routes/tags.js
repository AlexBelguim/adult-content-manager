
const express = require('express');
const router = express.Router();
const fs = require('fs-extra');
const path = require('path');
const db = require('../db');

// Get tags for a specific file
router.get('/file', (req, res) => {
  const { path: filePath } = req.query;
  if (!filePath) return res.status(400).json({ error: 'File path required' });
  const rows = db.prepare('SELECT tag FROM file_tags WHERE file_path = ?').all(filePath);
  res.json({ tags: rows.map(r => r.tag) });
});

// Get tags for a specific performer
router.get('/performer/:performerId', (req, res) => {
  const { performerId } = req.params;
  if (!performerId) return res.status(400).json({ error: 'Performer ID required' });
  const rows = db.prepare('SELECT tag FROM tags WHERE performer_id = ?').all(performerId);
  res.json({ tags: rows.map(r => r.tag) });
});

// Get all tags (for suggestions)
router.get('/all', async (req, res) => {
  const tagsFromDB = db.prepare('SELECT DISTINCT tag FROM tags').all();
  const manualTags = tagsFromDB.map(r => r.tag);
  
  // Also get genre names from content folders across all base paths
  const genreTags = new Set();
  
  try {
    // Get all folders to check for content genres
    const folders = db.prepare('SELECT path FROM folders').all();
    
    for (const folder of folders) {
      const contentPath = path.join(folder.path, 'content');
      if (await fs.pathExists(contentPath)) {
        const genres = await fs.readdir(contentPath, { withFileTypes: true });
        for (const genre of genres.filter(g => g.isDirectory())) {
          genreTags.add(genre.name);
        }
      }
    }
  } catch (err) {
    console.log('Error scanning for genre tags:', err.message);
  }
  
  // Combine manual tags and genre tags, removing duplicates
  const allTags = [...new Set([...manualTags, ...Array.from(genreTags)])];
  
  res.json({ tags: allTags });
});

// Assign a tag to a file
router.post('/assign-file', (req, res) => {
  const { path: filePath, tag } = req.body;
  if (!filePath || !tag) return res.status(400).json({ error: 'File path and tag required' });
  db.prepare('INSERT OR IGNORE INTO file_tags (file_path, tag) VALUES (?, ?)').run(filePath, tag);
  res.json({ success: true });
});

// Remove a tag from a file
router.post('/remove-file', (req, res) => {
  const { path: filePath, tag } = req.body;
  if (!filePath || !tag) return res.status(400).json({ error: 'File path and tag required' });
  db.prepare('DELETE FROM file_tags WHERE file_path = ? AND tag = ?').run(filePath, tag);
  res.json({ success: true });
});

// Get all tags for a folder (basePath)
router.get('/', (req, res) => {
  const { basePath } = req.query;
  if (!basePath) return res.status(400).json({ error: 'basePath required' });
  const folder = db.prepare('SELECT id FROM folders WHERE path = ?').get(basePath);
  if (!folder) return res.status(404).json({ error: 'Folder not found' });
  const tags = db.prepare('SELECT * FROM tags WHERE performer_id IS NULL OR performer_id IN (SELECT id FROM performers WHERE folder_id = ?)').all(folder.id);
  res.json(tags);
});

// Create a new tag (and folder)
router.post('/', async (req, res) => {
  const { basePath, tag } = req.body;
  if (!basePath || !tag) return res.status(400).json({ error: 'basePath and tag required' });
  const folder = db.prepare('SELECT id FROM folders WHERE path = ?').get(basePath);
  if (!folder) return res.status(404).json({ error: 'Folder not found' });
  // Create tag in DB if not exists
  db.prepare('INSERT OR IGNORE INTO tags (performer_id, tag) VALUES (?, ?)').run(null, tag);
  // Create folder if not exists
  const tagFolder = path.join(basePath, 'content', tag);
  await fs.ensureDir(tagFolder);
  res.json({ success: true, tag });
});

// Delete a tag (only if folder is empty)
router.delete('/', async (req, res) => {
  const { basePath, tag } = req.body;
  if (!basePath || !tag) return res.status(400).json({ error: 'basePath and tag required' });
  const tagFolder = path.join(basePath, 'content', tag);
  try {
    const files = await fs.readdir(tagFolder);
    if (files.length > 0) {
      return res.status(400).json({ error: 'Tag folder is not empty' });
    }
    // Remove tag from all files
    db.prepare('DELETE FROM file_tags WHERE tag = ?').run(tag);
    db.prepare('DELETE FROM tags WHERE tag = ? AND performer_id IS NULL').run(tag);
    await fs.remove(tagFolder);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Assign a tag to a folder (genre)
router.post('/assign', (req, res) => {
  const { basePath, genre, tag } = req.body;
  if (!basePath || !genre || !tag) return res.status(400).json({ error: 'basePath, genre, tag required' });
  // For now, just add a tag row for the genre (future: support file tags)
  // Find genre folder id
  const folder = db.prepare('SELECT id FROM folders WHERE path = ?').get(basePath);
  if (!folder) return res.status(404).json({ error: 'Folder not found' });
  // Add tag for genre (performer_id = null, tag = genre)
  db.prepare('INSERT OR IGNORE INTO tags (performer_id, tag) VALUES (?, ?)').run(null, tag);
  res.json({ success: true });
});

module.exports = router;
