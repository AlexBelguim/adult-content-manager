
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

// a rule's share of the video: 0 to 1, or null when it is not one
const shareOf = (v) => {
  const x = Number(v);
  return Number.isFinite(x) && x >= 0 && x <= 1 ? x : null;
};
const TERM_VALUES = new Set(Object.values(tagRules.TERMS).flat().map(([v]) => v));
const autoCount = (tag) => db.prepare("SELECT COUNT(*) AS n FROM file_tags WHERE tag = ? AND source = 'labelmaster'").get(tag).n;

// A tag is a folder in <library>/content: a plain folder name. Returns the trimmed name, or null when it is not one.
const BAD_NAME = 'A tag is a folder name: no / \\ or :, and it cannot start with a dot';
function tagName(v) {
  const tag = String(v || '').trim();
  // eslint-disable-next-line no-control-regex
  if (!tag || tag.length > 100 || tag.startsWith('.') || /[/\\:\u0000-\u001f\u007f]/.test(tag)) return null;
  return tag;
}

// the entries in a tag's folder; null when there is no such folder
async function folderEntries(dir) {
  try {
    return await fs.readdir(dir);
  } catch (e) {
    if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return null;
    throw e;
  }
}

// How many labelled videos a rule would tag, before saving it (a share of 0 counts every video with a term)
router.post('/rules/preview', (req, res) => {
  const { terms, min_share: minShare } = req.body || {};
  if (!Array.isArray(terms) || !terms.length) return res.json({ matches: 0 });
  res.json({ matches: tagRules.countMatches(terms, shareOf(minShare) ?? 0.1) });
});

// Save a tag's rule and make its tags match it: videos that now meet it get the tag, those that no longer do lose it
router.put('/rules', (req, res) => {
  const { tag, terms, min_share: minShare } = req.body || {};
  if (typeof tag !== 'string' || !tag.trim()) return res.status(400).json({ error: 'Name the tag' });
  if (!Array.isArray(terms) || !terms.length) return res.status(400).json({ error: 'Pick at least one term' });
  const unknown = terms.find(t => !TERM_VALUES.has(t));
  if (unknown !== undefined) return res.status(400).json({ error: `Unknown term: ${unknown}` });
  const min = minShare == null ? 0.1 : shareOf(minShare);
  if (min == null) return res.status(400).json({ error: 'The share is between 0 and 1' });
  try {
    const r = db.transaction(() => {
      db.prepare(`
        INSERT INTO tag_rules (tag, terms, min_share) VALUES (?, ?, ?)
        ON CONFLICT(tag) DO UPDATE SET terms = excluded.terms, min_share = excluded.min_share
      `).run(tag, JSON.stringify(terms), min);
      return tagRules.syncRule(tag);
    })();
    res.json({ success: true, ...r, tagged: r.added });
  } catch (e) {
    console.error('[tags] rule', e);
    res.status(500).json({ error: e.message });
  }
});

// Forget a tag's rule (the tags it already set stay: `kept` of them)
router.delete('/rules', (req, res) => {
  const { tag } = req.body || {};
  if (!tag) return res.status(400).json({ error: 'tag required' });
  const kept = autoCount(tag);
  db.prepare('DELETE FROM tag_rules WHERE tag = ?').run(tag);
  res.json({ success: true, kept });
});

// Settings → Tags: every tag of a library folder (the first one unless basePath says), with how many files carry
// it, how many of those its rule set, what its content folder holds, and its rule
router.get('/manage', async (req, res) => {
  try {
    const { basePath } = req.query;
    const folder = basePath
      ? db.prepare('SELECT id, path FROM folders WHERE path = ?').get(basePath)
      : db.prepare('SELECT id, path FROM folders ORDER BY id LIMIT 1').get();
    if (!folder) {
      if (basePath) return res.status(404).json({ error: 'Folder not found' });
      return res.json({ folder: null, tags: [], terms: tagRules.TERMS });
    }
    const contentDir = path.join(folder.path, 'content');
    const dirs = await fs.readdir(contentDir, { withFileTypes: true }).catch((e) => {
      if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return [];
      throw e;
    });
    const rules = new Map(tagRules.rules().map(r => [r.tag, { terms: r.terms, min_share: r.min_share }]));
    const names = new Set([
      ...db.prepare('SELECT DISTINCT tag FROM tags WHERE performer_id IS NULL').all().map(r => r.tag),
      ...dirs.filter(d => d.isDirectory() && !d.name.startsWith('.')).map(d => d.name),
      ...rules.keys()
    ].filter(n => typeof n === 'string' && n));
    const counts = new Map(db.prepare(`
      SELECT tag, COUNT(*) AS files, SUM(CASE WHEN source = 'labelmaster' THEN 1 ELSE 0 END) AS auto
      FROM file_tags GROUP BY tag
    `).all().map(r => [r.tag, r]));
    const tags = await Promise.all([...names].map(async (tag) => {
      const entries = await folderEntries(path.join(contentDir, tag));
      const c = counts.get(tag);
      return {
        tag,
        files: c?.files || 0,
        auto: c?.auto || 0,
        folder: entries == null ? 'missing' : entries.length > 0 ? 'files' : 'empty',
        folderFiles: entries?.length || 0,
        rule: rules.get(tag) || null
      };
    }));
    tags.sort((a, b) => a.tag.localeCompare(b.tag));
    res.json({ folder: { id: folder.id, path: folder.path }, tags, terms: tagRules.TERMS });
  } catch (e) {
    console.error('[tags] manage', e);
    res.status(500).json({ error: e.message });
  }
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
  const { basePath } = req.body || {};
  const tag = tagName(req.body?.tag);
  if (!tag) return res.status(400).json({ error: BAD_NAME });
  if (!basePath) return res.status(400).json({ error: 'basePath and tag required' });
  const folder = db.prepare('SELECT id FROM folders WHERE path = ?').get(basePath);
  if (!folder) return res.status(404).json({ error: 'Folder not found' });
  try {
    // Create tag in DB if not exists
    db.prepare('INSERT OR IGNORE INTO tags (performer_id, tag) VALUES (?, ?)').run(null, tag);
    // Create folder if not exists
    const tagFolder = path.join(basePath, 'content', tag);
    await fs.ensureDir(tagFolder);
    res.json({ success: true, tag });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Delete a tag: off every file, with its rule and its empty folder. Refused while the folder holds anything;
// a tag without a folder is deleted all the same.
router.delete('/', async (req, res) => {
  const { basePath } = req.body || {};
  const tag = tagName(req.body?.tag);
  if (!tag) return res.status(400).json({ error: BAD_NAME });
  if (!basePath) return res.status(400).json({ error: 'basePath and tag required' });
  const tagFolder = path.join(basePath, 'content', tag);
  try {
    const entries = await folderEntries(tagFolder);
    if (entries && entries.length > 0) {
      return res.status(409).json({ error: `Its folder holds ${entries.length} ${entries.length === 1 ? 'file' : 'files'}` });
    }
    const out = db.transaction(() => {
      const files = db.prepare('DELETE FROM file_tags WHERE tag = ?').run(tag).changes;
      db.prepare('DELETE FROM tags WHERE tag = ? AND performer_id IS NULL').run(tag);
      const rule = db.prepare('DELETE FROM tag_rules WHERE tag = ?').run(tag).changes > 0;
      db.prepare('DELETE FROM auto_tag_dismissed WHERE tag = ?').run(tag);
      return { files, rule };
    })();
    // rmdir, not a recursive remove: it fails rather than delete a file that turned up since the check
    if (entries) await fs.rmdir(tagFolder);
    res.json({ success: true, ...out });
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
