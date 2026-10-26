
const express = require('express');
const router = express.Router();
const fs = require('fs-extra');
const path = require('path');
const db = require('../db');
const tagRules = require('../services/tagRules');

// Get tags for a specific file; `auto` = the ones a tag rule set from labelmaster's scenes
router.get('/file', (req, res) => {
  const { path: filePath } = req.query;
  if (!filePath) return res.status(400).json({ error: 'File path required' });
  const rows = db.prepare('SELECT tag, source FROM file_tags WHERE file_path = ?').all(filePath);
  res.json({ tags: rows.map(r => r.tag), auto: rows.filter(r => r.source === 'labelmaster').map(r => r.tag) });
});

// Tag rules: what a tag means in labelmaster's terms (services/tagRules), and the terms there are
router.get('/rules', (req, res) => {
  res.json({ rules: tagRules.rules(), terms: tagRules.TERMS });
});

// How many labelled videos a rule would tag, before saving it
router.post('/rules/preview', (req, res) => {
  const { terms, min_share: minShare } = req.body;
  if (!Array.isArray(terms) || !terms.length) return res.json({ matches: 0 });
  res.json({ matches: tagRules.countMatches(terms, Number(minShare) || 0) });
});

// Save a tag's rule and run it over every labelled video
router.put('/rules', (req, res) => {
  const { tag, terms, min_share: minShare } = req.body;
  if (!tag || !Array.isArray(terms) || !terms.length) return res.status(400).json({ error: 'tag and terms required' });
  db.prepare(`
    INSERT INTO tag_rules (tag, terms, min_share) VALUES (?, ?, ?)
    ON CONFLICT(tag) DO UPDATE SET terms = excluded.terms, min_share = excluded.min_share
  `).run(tag, JSON.stringify(terms), Number(minShare) || 0.1);
  res.json({ success: true, tagged: tagRules.applyRule(tag) });
});

// Forget a tag's rule (the tags it already set stay)
router.delete('/rules', (req, res) => {
  const { tag } = req.body;
  if (!tag) return res.status(400).json({ error: 'tag required' });
  db.prepare('DELETE FROM tag_rules WHERE tag = ?').run(tag);
  res.json({ success: true });
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
  db.prepare('DELETE FROM auto_tag_dismissed WHERE file_path = ? AND tag = ?').run(filePath, tag);
  res.json({ success: true });
});

// Remove a tag from a file
router.post('/remove-file', (req, res) => {
  const { path: filePath, tag } = req.body;
  if (!filePath || !tag) return res.status(400).json({ error: 'File path and tag required' });
  const row = db.prepare('SELECT source FROM file_tags WHERE file_path = ? AND tag = ?').get(filePath, tag);
  db.prepare('DELETE FROM file_tags WHERE file_path = ? AND tag = ?').run(filePath, tag);
  // taken off by hand: its rule must not set it again
  if (row?.source === 'labelmaster') db.prepare('INSERT OR IGNORE INTO auto_tag_dismissed (file_path, tag) VALUES (?, ?)').run(filePath, tag);
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
    // Remove tag from all files, with its rule
    db.prepare('DELETE FROM file_tags WHERE tag = ?').run(tag);
    db.prepare('DELETE FROM tags WHERE tag = ? AND performer_id IS NULL').run(tag);
    db.prepare('DELETE FROM tag_rules WHERE tag = ?').run(tag);
    db.prepare('DELETE FROM auto_tag_dismissed WHERE tag = ?').run(tag);
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
