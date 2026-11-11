/**
 * Folder check (Settings → Library): read-only. Lists performer folders of one library folder whose pics / vids
 * folder is spelled differently ('Vids'), exists twice in two spellings, or whose vids folder holds two funscript
 * folders. Folders are read with readdir, so a share that ignores case never shows one folder as two; two spellings
 * count as two only when they are different folders (inode / device). Blacklisted performers are left out; a missing
 * performer folder is counted, not listed. Nothing is written.
 *
 * The automatic fixer is removed: it could delete the real funscript folder on a case-insensitive share and
 * overwrote the original counts. Folders are fixed by hand.
 */
const express = require('express');
const router = express.Router();
const fs = require('fs-extra');
const path = require('path');
const db = require('../db');
const PathHelper = require('../utils/pathHelper');

const MAX_ISSUES = 500;

/** True when the two stats are different folders. A share that reports inode 0 cannot tell: distinct names count. */
function distinct(a, b) {
  if (!a || !b) return false;
  if (!a.ino || !b.ino) return true;
  return a.ino !== b.ino || a.dev !== b.dev;
}

async function statOrNull(p) {
  try { return await fs.stat(p); } catch (e) { return null; }
}

async function dirsOf(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries.filter(e => e.isDirectory()).map(e => e.name);
}

/** Names among stats that are distinct folders (the first of each folder kept) */
async function distinctFolders(dir, names) {
  const seen = [];
  for (const name of names) {
    const st = await statOrNull(path.join(dir, name));
    if (!st) continue;
    if (seen.every(s => distinct(s.st, st))) seen.push({ name, st });
  }
  return seen.map(s => s.name);
}

router.get('/truenas-status', async (req, res) => {
  try {
    const checkedAt = () => new Date().toISOString();
    const id = Number(req.query.folderId);
    const folder = (req.query.folderId !== undefined && Number.isFinite(id)
      ? db.prepare('SELECT * FROM folders WHERE id = ?').get(id)
      : null) || db.prepare('SELECT * FROM folders LIMIT 1').get();
    if (!folder) return res.json({ folder: null, checked: 0, missing: 0, issues: [], more: 0, checkedAt: checkedAt() });

    const performers = db.prepare(
      'SELECT * FROM performers WHERE folder_id = ? AND COALESCE(blacklisted, 0) = 0 ORDER BY name COLLATE NOCASE'
    ).all(folder.id);

    let checked = 0;
    let missing = 0;
    let more = 0;
    const issues = [];
    const add = (issue) => {
      if (issues.length < MAX_ISSUES) issues.push(issue);
      else more += 1;
    };

    for (const performer of performers) {
      checked += 1;
      const performerPath = PathHelper.getPerformerPath({ path: folder.path }, performer);
      const st = await statOrNull(performerPath);
      if (!st || !st.isDirectory()) {
        missing += 1;
        continue;
      }
      let dirs;
      try {
        dirs = await dirsOf(performerPath);
      } catch (e) {
        missing += 1;
        continue;
      }
      const base = { performerId: performer.id, performer: performer.name, path: performerPath };

      let vidsName = null;
      for (const want of ['pics', 'vids']) {
        const variants = dirs.filter(n => n.toLowerCase() === want);
        if (variants.includes(want) && variants.length > 1) {
          const real = await distinctFolders(performerPath, [want, ...variants.filter(n => n !== want)]);
          if (real.length > 1) add({ ...base, kind: 'both', names: real });
        } else if (variants.length === 1 && variants[0] !== want) {
          add({ ...base, kind: 'case', names: [variants[0], want] });
        }
        if (want === 'vids') vidsName = variants.includes('vids') ? 'vids' : (variants.length === 1 ? variants[0] : null);
      }

      if (vidsName) {
        const vidsPath = path.join(performerPath, vidsName);
        let funscripts = [];
        try {
          funscripts = (await dirsOf(vidsPath)).filter(n => n.toLowerCase() === 'funscript');
        } catch (e) {
          funscripts = [];
        }
        if (funscripts.length > 1) {
          const real = await distinctFolders(vidsPath, funscripts);
          if (real.length > 1) {
            const files = [];
            for (const name of real) {
              files.push(await fs.readdir(path.join(vidsPath, name)).then(e => e.length, () => 0));
            }
            add({ ...base, kind: 'funscript', path: vidsPath, names: real, files });
          }
        }
      }
    }

    res.json({ folder: { id: folder.id, path: folder.path }, checked, missing, issues, more, checkedAt: checkedAt() });
  } catch (err) {
    console.error('Error checking folders:', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/run-truenas-fixes', (req, res) => {
  res.status(410).json({ error: 'The automatic fixer is removed: it could delete folders on a share that ignores case. Fix the listed folders by hand.' });
});

module.exports = router;
