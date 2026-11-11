const express = require('express');
const router = express.Router();
const multer = require('multer');
const { validateAndCreateStructure, scanBeforeFolder, scanAfterFolder, scanContentFolder, scanOrphanedPerformers, scanBeforeUploadFolder, scanBeforeUploadPerformerDetails } = require('../services/fileScanner');
const { importPerformer, getPerformerFiles } = require('../services/importer');
const { addLocalImportToQueue, activeJobFor, jobForUpload, anyJobForUpload } = require('../services/uploadQueue');
const {
  SUPPORTED, UPLOAD_ID, resolveLibrary, requireLibrary, checkFolder, resolveImportName,
  safeRel, safeBase, uploadTempDir, readManifests, countOther
} = require('../services/importGuard');

const db = require('../db');
const folderRemoval = require('../services/folderRemoval');

const path = require('path');
const fs = require('fs-extra');

// The name a browser sent (encodeURIComponent of the path inside the chosen folder), decoded when it can be
const decodedName = (raw) => {
  try { return decodeURIComponent(raw); } catch (e) { return String(raw); }
};

// An error answer: { error, code? } with the status the error carries
const sendError = (res, err, fallback = 500) => res.status(err.status || fallback).json({ error: err.message, code: err.code });

// Multer saves each batch of an upload into that upload's own temp folder (set by prepareBatch)
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      if (!req.uploadDir) return cb(new Error('No temp folder for this upload'));
      cb(null, req.uploadDir);
    },
    filename: (req, file, cb) => {
      const last = safeRel(decodedName(file.originalname)).split('/').pop() || 'file';
      cb(null, `b${req.batchIndex}-${req.seq++}-${safeBase(last)}`);
    }
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

// The library folders with their counts, in the order of GET / (the first one is the folder in use)
router.get('/summary', async (req, res) => {
  try {
    const folders = db.prepare('SELECT * FROM folders').all();
    const count = (sql, id) => db.prepare(sql).get(id).n;
    const out = [];
    for (const f of folders) {
      out.push({
        id: f.id,
        path: f.path,
        name: folderRemoval.folderName(f.path),
        performers: count('SELECT COUNT(*) AS n FROM performers WHERE folder_id = ?', f.id),
        before: count('SELECT COUNT(*) AS n FROM performers WHERE folder_id = ? AND (moved_to_after = 0 OR moved_to_after IS NULL)', f.id),
        after: count('SELECT COUNT(*) AS n FROM performers WHERE folder_id = ? AND moved_to_after = 1', f.id),
        genres: count('SELECT COUNT(*) AS n FROM content_genres WHERE folder_id = ?', f.id),
        exists: await fs.pathExists(f.path)
      });
    }
    res.json({ folders: out, currentId: folders[0]?.id ?? null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// What removing a folder from the app would remove and keep, and what stops it now (read-only)
router.get('/:id/removal', async (req, res) => {
  try {
    res.json(await folderRemoval.plan(req.params.id));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
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

// Scan "before upload" for folders ready for import (read-only), with the name match and job of each
router.get('/scan-before-upload', async (req, res) => {
  try {
    const count = db.prepare('SELECT COUNT(*) AS n FROM folders').get().n;
    if (!count) {
      return res.json({ success: true, noLibrary: true, basePath: null, beforeUploadPath: null, types: SUPPORTED, performers: [], count: 0 });
    }
    const lib = resolveLibrary(req.query.basePath);
    if (!lib) return res.status(400).json({ error: 'This library folder is not registered', code: 'unknown-library' });

    const beforeUploadPath = path.join(lib.path, 'before upload');
    const folders = await scanBeforeUploadFolder(lib.path);
    const performers = folders.map(f => ({
      name: f.name,
      path: f.path,
      match: resolveImportName(f.name),
      job: activeJobFor({ libPath: lib.path, folderName: f.name })
    }));

    res.json({
      success: true,
      basePath: lib.path,
      beforeUploadPath,
      types: SUPPORTED,
      performers,
      count: performers.length
    });
  } catch (err) {
    console.error('Error scanning before upload folder:', err);
    sendError(res, err);
  }
});

// One folder in "before upload": stats, up to 30 pictures, and the files that cannot be imported (read-only)
router.get('/scan-before-upload-details', async (req, res) => {
  try {
    const { performerName } = req.query;
    if (typeof performerName !== 'string' || !performerName) {
      return res.status(400).json({ error: 'performerName is required', code: 'invalid' });
    }
    const lib = requireLibrary(req.query.basePath);
    const problem = await checkFolder(lib.path, performerName);
    if (problem) return res.status(problem.code === 'missing' ? 404 : 400).json({ error: problem.error, code: problem.code });

    const details = await scanBeforeUploadPerformerDetails(lib.path, performerName);
    const other = await countOther(path.join(lib.path, 'before upload', performerName));
    res.json({
      success: true,
      stats: details.stats,
      previewImages: details.previewImages,
      other
    });
  } catch (err) {
    console.error('Error getting performer details:', err);
    sendError(res, err);
  }
});

// What an import under this name does: { match } (read-only)
router.get('/name-check', (req, res) => {
  try {
    const { name } = req.query;
    if (typeof name !== 'string') return res.status(400).json({ error: 'name is required', code: 'invalid' });
    requireLibrary(req.query.basePath);
    res.json({ match: resolveImportName(name) });
  } catch (err) {
    sendError(res, err);
  }
});

// Local import: queue folders of "before upload". Each folder is checked; the refused ones are listed with a code.
router.post('/local-import', async (req, res) => {
  const { performers, basePath, createHashes } = req.body || {};

  if (!Array.isArray(performers) || performers.length === 0
    || performers.some(p => !p || typeof p !== 'object' || typeof p.folderName !== 'string')) {
    return res.status(400).json({ error: 'performers must be a list of { folderName, name }', code: 'bad-request' });
  }

  let lib;
  try {
    lib = requireLibrary(basePath);
  } catch (err) {
    return sendError(res, err, 400);
  }

  const jobs = [];
  const refused = [];
  for (const performer of performers) {
    const name = typeof performer.name === 'string' && performer.name.trim() ? performer.name.trim() : performer.folderName;
    try {
      const queued = await addLocalImportToQueue({
        folderName: performer.folderName,
        performerName: name,
        basePath: lib.path,
        totalFiles: performer.totalFiles || 0,
        createHashes: !!createHashes
      });
      jobs.push({ folderName: performer.folderName, performerName: queued.performerName, jobId: queued.jobId });
    } catch (err) {
      // A refusal without one of these codes is a server error (a busy database, say), not a bad name
      const code = ['invalid', 'blacklisted', 'queued', 'missing'].includes(err.code) ? err.code : 'error';
      if (!err.code) console.error(`Error queuing local import of "${performer.folderName}":`, err);
      refused.push({ folderName: performer.folderName, code, error: err.message });
    }
  }

  if (jobs.length) return res.json({ success: true, jobs, refused });
  res.status(409).json({ error: refused[0].error, jobs: [], refused });
});

const toInt = (v) => (typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : null);

/**
 * Before multer: check the upload id, batch numbers and library, refuse a handed-over upload, and remove what an
 * earlier try of this batch left, so a batch sent again never doubles.
 */
async function prepareBatch(req, res, next) {
  try {
    const { uploadId } = req.query;
    if (typeof uploadId !== 'string' || !UPLOAD_ID.test(uploadId)) {
      return res.status(400).json({ error: 'This upload id is not valid', code: 'bad-id' });
    }
    const i = toInt(req.query.batchIndex);
    const n = toInt(req.query.totalBatches);
    if (i === null || n === null || n < 1 || n > 100000 || i >= n) {
      return res.status(400).json({ error: 'batchIndex and totalBatches must be whole numbers, 0 <= batchIndex < totalBatches <= 100000', code: 'bad-batch' });
    }
    const lib = requireLibrary(req.query.basePath);
    if (jobForUpload(uploadId)) {
      return res.status(409).json({ error: 'This upload is already handed over for import', code: 'handed-over' });
    }

    const dir = uploadTempDir(lib.path, uploadId);
    await fs.ensureDir(dir);
    for (const name of await fs.readdir(dir)) {
      if (name.startsWith(`b${i}-`) || name === `batch-${i}.json` || name.startsWith(`batch-${i}.json.`)) {
        await fs.remove(path.join(dir, name));
      }
    }
    req.uploadDir = dir;
    req.uploadId = uploadId;
    req.batchIndex = i;
    req.seq = 0;
    next();
  } catch (err) {
    sendError(res, err);
  }
}

// Multer with JSON errors
function receiveFiles(req, res, next) {
  upload.array('files')(req, res, (err) => {
    if (!err) return next();
    console.error(`[Upload] Batch ${req.batchIndex} of ${req.uploadId} failed:`, err.message);
    res.status(err instanceof multer.MulterError ? 400 : 500).json({ error: err.message, code: err.code || 'upload-failed' });
  });
}

// One batch of a browser upload, into <lib>/.temp-uploads/<uploadId>/, with its manifest batch-<i>.json
router.post('/upload-import', prepareBatch, receiveFiles, async (req, res) => {
  const files = req.files || [];
  const dir = req.uploadDir;
  const i = req.batchIndex;
  try {
    if (!files.length) return res.status(400).json({ error: 'No files in this batch', code: 'no-files' });

    // Handed over while this batch was on its way: it is not part of that import
    if (jobForUpload(req.uploadId)) {
      for (const f of files) await fs.remove(path.join(dir, f.filename)).catch(() => {});
      return res.status(409).json({ error: 'This upload is already handed over for import', code: 'handed-over' });
    }

    const manifest = {
      index: i,
      files: files.map(f => ({ temp: f.filename, rel: safeRel(decodedName(f.originalname)) || f.filename, size: f.size })),
      at: new Date().toISOString()
    };
    const target = path.join(dir, `batch-${i}.json`);
    const tmp = `${target}.${process.pid}-${Date.now()}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(manifest));
    await fs.rename(tmp, target);

    const batches = [...(await readManifests(dir)).keys()].sort((a, b) => a - b);
    res.json({ success: true, uploadId: req.uploadId, batchIndex: i, files: files.length, batches });
  } catch (err) {
    console.error(`[Upload] Could not store batch ${i} of ${req.uploadId}:`, err);
    sendError(res, err);
  }
});

// What the server has of an upload (read-only)
router.get('/upload-import/:uploadId', async (req, res) => {
  try {
    const { uploadId } = req.params;
    if (!UPLOAD_ID.test(uploadId)) return res.status(400).json({ error: 'This upload id is not valid', code: 'bad-id' });
    const lib = requireLibrary(req.query.basePath);
    const dir = uploadTempDir(lib.path, uploadId);
    const exists = await fs.pathExists(dir);
    const manifests = exists ? await readManifests(dir) : new Map();
    let files = 0;
    let bytes = 0;
    for (const m of manifests.values()) {
      files += m.files.length;
      for (const f of m.files) bytes += Number(f && f.size) || 0;
    }
    res.json({
      uploadId,
      exists,
      batches: [...manifests.keys()].sort((a, b) => a - b),
      files,
      bytes,
      job: anyJobForUpload(uploadId)
    });
  } catch (err) {
    sendError(res, err);
  }
});

// Size of everything under a folder
async function treeBytes(dir) {
  let total = 0;
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) total += await treeBytes(full);
    else if (e.isFile()) total += (await fs.stat(full).catch(() => ({ size: 0 }))).size;
  }
  return total;
}

// Drop an upload that was not handed over: its temp folder goes
router.delete('/upload-import/:uploadId', async (req, res) => {
  try {
    const { uploadId } = req.params;
    if (!UPLOAD_ID.test(uploadId)) return res.status(400).json({ error: 'This upload id is not valid', code: 'bad-id' });
    const lib = requireLibrary(req.query.basePath);
    if (jobForUpload(uploadId)) {
      return res.status(409).json({ error: 'This upload is handed over for import: remove it on the Jobs page', code: 'handed-over' });
    }
    const dir = uploadTempDir(lib.path, uploadId);
    if (!await fs.pathExists(dir)) return res.status(404).json({ error: 'The server has no files for this upload', code: 'missing' });
    const removedBytes = await treeBytes(dir).catch(() => 0);
    await fs.remove(dir);
    console.log(`[Upload] Removed the temp folder of ${uploadId} (${removedBytes} bytes)`);
    res.json({ success: true, removedBytes });
  } catch (err) {
    sendError(res, err);
  }
});

// Forget one library folder (no file on disk is touched): body { confirm: <folder name> }. A copy of the database is
// saved first; settings, tag definitions and file hashes stay (services/folderRemoval.js).
router.delete('/:id', async (req, res) => {
  try {
    res.json({ success: true, ...(await folderRemoval.remove(req.params.id, { confirm: req.body?.confirm })) });
  } catch (err) {
    if (!err.status) console.error('Error removing a folder:', err);
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;