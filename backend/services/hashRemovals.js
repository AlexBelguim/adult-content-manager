/**
 * Removing duplicates: a file the duplicates page removes goes straight to her own trash folder (pics/.trash,
 * vids/.trash or vids/funscript/.trash of her folder), like every other delete in the app, and the trash is emptied
 * later. Its name there starts with fileTrash.NO_TRAINING_PREFIX: a duplicate is not a bad picture, so the trash
 * cleanup deletes it instead of saving it for training (fileTrash.dropNoTraining).
 *
 * Undo is for the toast only: the server remembers a batch for UNDO_MS, in memory, and Undo moves the files back
 * while they are still in the trash. When that time is up the batch's files are deleted from her trash, so a duplicate
 * never waits for a trash cleanup (the .trash of a performer in after filter is only emptied when she is removed).
 * The file's hash row gets deleted_flag 2 (removed by a duplicate check): new checks leave it out, Undo sets it back
 * to 0.
 *
 * Before this, removals were held 30 days in <library root>/.acm-removed (table hash_removals). Nothing writes new
 * removals there any more; at start-up moveOldRemovals() moves what is still held into her trash, marked the same way,
 * once. A file whose performer folder is gone stays where it is and is listed (listOldRemovals) until 30 days after
 * it was removed, the old retention, then it is deleted.
 *
 * At start-up and once a day, sweepDuplicates() deletes every marked file left in a performer's trash that no live
 * batch holds: a restart forgets the batches, and a file that was in use when its batch ended is tried again.
 */
const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');
const db = require('../db');
const filterService = require('./filterService');
const hashService = require('./hashService');
const fileTrash = require('./fileTrash');

const {
  HashError, mediaTypeOf, performerOfPath, performerDirOf, alternatePath, libraryRootOf, recountInternal, notify,
} = hashService;

/** How long the server keeps a batch for Undo (the toast shows 8 to 12 seconds, longer while hovered). */
const UNDO_MS = 15 * 60 * 1000;
const STORE_DIR = '.acm-removed';
/** The old store's retention: a file whose folder is gone is deleted this long after it was removed. */
const OLD_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const SWEEP_MS = 24 * 60 * 60 * 1000;

/** 'image' | 'video' | 'funscript_video' for filterService.adjustDiskCounts. */
function countTypeOf(filePath) {
  if (mediaTypeOf(filePath) === 'pic') return 'image';
  return /[\\/]vids[\\/]funscript[\\/]/i.test(String(filePath)) ? 'funscript_video' : 'video';
}

function adjustCounts(ownerId, filePath, direction) {
  if (ownerId == null) return;
  try {
    filterService.adjustDiskCounts(ownerId, countTypeOf(filePath), 'delete', direction);
    filterService.clearPerformerCache(ownerId);
  } catch (err) {
    console.error('Could not adjust performer counts:', err.message);
  }
}

async function dirExists(p) {
  try {
    return (await fs.stat(p)).isDirectory();
  } catch (_) {
    return false;
  }
}

async function removeIfEmpty(dir) {
  try {
    const entries = await fs.readdir(dir);
    if (entries.length === 0) await fs.rmdir(dir);
  } catch (_) { /* in use or gone */ }
}

// ── removing ───────────────────────────────────────────────────

/**
 * Move one file into her trash, marked not for training, and mark it removed. Throws HashError('busy') when the file
 * is in use; nothing is changed when the move fails. Returns { trashPath }.
 */
async function trashFile({ row, itemId, ownerId }) {
  const src = row.file_path;
  let moved;
  try {
    moved = await fileTrash.trashDuplicate(src);
  } catch (err) {
    if (err.code === 'EBUSY') throw new HashError(409, 'busy', 'The file is in use. Try again.');
    if (err instanceof fileTrash.TrashError) throw new HashError(err.status || 500, 'error', err.message);
    throw new HashError(500, 'error', `Could not move the file: ${err.message}`);
  }
  try {
    db.transaction(() => {
      if (itemId) db.prepare(`UPDATE hash_run_items SET status = 'removed', selected = 0 WHERE id = ?`).run(itemId);
      db.prepare('UPDATE performer_file_hashes SET deleted_flag = 2 WHERE id = ?').run(row.id);
    })();
  } catch (err) {
    // the file is in the trash (marked, so never saved for training); the page shows it as not on disk
    console.error('Removal bookkeeping failed:', err.message);
  }
  adjustCounts(ownerId, src, 1);
  return { trashPath: moved.trashPath };
}

// ── undo (while the toast shows) ───────────────────────────────

const batches = new Map(); // batchId -> { runId, at, timer, entries: [{ itemId, fileId, ownerId, path, trashPath, name }] }

/** Deletes marked files from her trash (only marked ones, only where the batch put them). Never throws. */
async function dropTrashed(entries) {
  const out = { dropped: 0, failed: 0 };
  for (const e of entries) {
    const p = e && e.trashPath;
    if (typeof p !== 'string' || !path.isAbsolute(p) || !fileTrash.isNoTraining(path.basename(p))) continue;
    try {
      if (!(await fs.pathExists(p))) continue;
      await fs.remove(p);
      out.dropped += 1;
      await removeIfEmpty(path.dirname(p));
    } catch (err) {
      out.failed += 1; // in use: the daily sweep tries again
      console.warn('Duplicate could not be deleted from the trash:', p, err.message);
    }
  }
  return out;
}

/** The batch's undo time is up: forget it and delete its files from her trash. */
function expireBatch(batchId) {
  const b = batches.get(batchId);
  if (!b) return Promise.resolve({ dropped: 0, failed: 0 });
  batches.delete(batchId);
  if (b.timer) clearTimeout(b.timer);
  return dropTrashed(b.entries);
}

function forgetOld() {
  const cutoff = Date.now() - UNDO_MS;
  for (const [id, b] of batches) if (b.at < cutoff) expireBatch(id).catch(() => { });
}

/** Trash paths that an undo can still put back (normalised). */
function liveTrashPaths() {
  const set = new Set();
  for (const b of batches.values()) for (const e of b.entries) if (e.trashPath) set.add(fileTrash.norm(e.trashPath));
  return set;
}

function newBatchId() {
  return crypto.randomBytes(8).toString('hex');
}

/** Keep a batch for Undo. */
function rememberBatch(batchId, runId, entries) {
  forgetOld();
  if (entries.length === 0) return;
  const timer = setTimeout(() => { expireBatch(batchId).catch(() => { }); }, UNDO_MS);
  if (timer.unref) timer.unref();
  batches.set(batchId, { runId: String(runId), at: Date.now(), timer, entries });
}

/**
 * Undo of a removal: move the batch's files back from her trash while they are still there.
 * Returns { restored: [{ itemId, path, name }], skipped: [{ itemId, name, reason, message }] }. Never overwrites.
 */
async function undoBatch(runId, batchId) {
  forgetOld();
  const b = typeof batchId === 'string' ? batches.get(batchId) : null;
  if (!b || b.runId !== String(runId)) {
    throw new HashError(410, 'too_late', 'Too late to undo. The files were deleted.');
  }
  batches.delete(batchId);
  if (b.timer) clearTimeout(b.timer);

  const restored = [];
  const skipped = [];
  const owners = new Set();
  for (const e of b.entries) {
    try {
      await fileTrash.untrashDuplicate(e.path, e.trashPath);
    } catch (err) {
      const busy = !!err && err.status === 409 && /in use/i.test(err.message || '');
      skipped.push({ itemId: e.itemId, name: e.name, reason: busy ? 'busy' : 'error', message: err.message || 'Could not put it back.' });
      continue;
    }
    try {
      db.transaction(() => {
        db.prepare('UPDATE performer_file_hashes SET deleted_flag = 0 WHERE id = ? AND deleted_flag = 2').run(e.fileId);
        if (e.itemId != null) {
          db.prepare(`
            UPDATE hash_run_items SET status = 'open', selected = 0, selected_by = NULL
            WHERE id = ? AND status = 'removed' AND file_id_ref = ?
          `).run(e.itemId, e.fileId);
        }
      })();
    } catch (err) {
      console.error('Undo bookkeeping failed:', err.message);
    }
    adjustCounts(e.ownerId, e.path, -1);
    if (e.ownerId != null) owners.add(e.ownerId);
    restored.push({ itemId: e.itemId, path: e.path, name: e.name });
  }

  for (const ownerId of owners) {
    try { recountInternal(ownerId); } catch (_) { /* best effort */ }
    notify({ performerId: ownerId, type: 'hash_updated' });
  }
  return { restored, skipped };
}

// ── the old Recently removed store (.acm-removed), once ───────

const STORE_SEGMENT = /[\\/]\.acm-removed[\\/]/;

/** removed_at in ms (the store wrote ms; a value in seconds is read as such). */
function removedAtMs(record) {
  const v = Number(record && record.removed_at) || 0;
  return v > 0 && v < 1e12 ? v * 1000 : v;
}

/** The library root a stored file sits under (the part before .acm-removed), or null. */
function storeRootOf(storedPath) {
  const m = STORE_SEGMENT.exec(String(storedPath || ''));
  return m ? storedPath.slice(0, m.index) : null;
}

/** An unreachable library (NAS asleep, drive not mapped) must never be read as "the stored file is gone". */
async function storeReachable(storedPath) {
  const root = storeRootOf(storedPath) || path.dirname(String(storedPath || ''));
  return root ? dirExists(root) : false;
}

async function originalReachable(record) {
  const info = performerOfPath(record.original_path);
  const root = (info && info.root) || libraryRootOf(record.performer_id);
  return root ? dirExists(root) : false;
}

/** The thumbnail the /api/files/video-thumbnail route caches beside a video (same naming as files.js). */
function cachedThumbOf(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const key = crypto.createHash('md5').update(filePath).digest('hex').slice(0, 16);
  return path.join(path.dirname(filePath), '.thumbnails', `${path.basename(filePath, ext)}.${key}.jpg`);
}

/** After a stored file left its batch folder: its cached thumbnail, then the empty batch, day and store folders. */
async function cleanStoreDirs(storedPath) {
  try { await fs.remove(cachedThumbOf(storedPath)); } catch (_) { /* not there */ }
  const batchDir = path.dirname(storedPath);
  try {
    const entries = await fs.readdir(batchDir);
    if (entries.every((e) => e === '.thumbnails')) await fs.remove(batchDir);
  } catch (_) { /* in use or gone */ }
  const dayDir = path.dirname(batchDir);
  await removeIfEmpty(dayDir);
  if (path.basename(path.dirname(dayDir)) === STORE_DIR) await removeIfEmpty(path.dirname(dayDir));
}

/**
 * Her trash folder for an old removal: her folder as it is now (a rename or a move to after changes it), else the
 * original performer folder, else the same one under the other filter folder.
 * Returns { trashDir } | { gone: true } (the library is there, her folder is not) | { unreachable: true }.
 */
async function oldTrashTarget(record) {
  const original = record.original_path;
  const info = performerOfPath(original);
  const folder = info ? info.folder : '';
  const dirs = [];
  if (record.performer_id != null) {
    const performer = db.prepare('SELECT * FROM performers WHERE id = ?').get(record.performer_id);
    const dir = performer ? performerDirOf(performer) : null;
    if (dir) dirs.push(dir);
  }
  if (info) {
    dirs.push(info.performerDir);
    const alt = alternatePath(info.performerDir);
    if (alt) dirs.push(alt);
  }
  for (const dir of dirs) {
    if (await dirExists(dir)) return { trashDir: fileTrash.performerTrashDir(dir, folder, original) };
  }
  const root = (info && info.root) || libraryRootOf(record.performer_id);
  if (root && !(await dirExists(root))) return { unreachable: true };
  return { gone: true };
}

/**
 * Moves every file still held in the old store into her trash, marked not for training, once. Records end as
 * 'trashed' (trash_path says where), 'lost' (the stored file was gone) or 'no_folder' (her folder is gone: the file
 * stays in .acm-removed and is listed; tried again at the next start). A library that cannot be reached is left for
 * the next start.
 */
async function moveOldRemovals() {
  const out = { moved: 0, noFolder: 0, lost: 0, purged: 0, waiting: 0 };
  let rows = [];
  try {
    rows = db.prepare(`SELECT * FROM hash_removals WHERE status IN ('moving', 'held', 'no_folder') ORDER BY id`).all();
  } catch (_) {
    return out; // no table: nothing was ever held
  }
  const roots = new Set();
  for (const r of rows) {
    try {
      if (!(await storeReachable(r.stored_path))) { out.waiting += 1; continue; }
      const root = storeRootOf(r.stored_path);
      if (root) roots.add(root);
      const stored = await fs.pathExists(r.stored_path);

      if (r.status === 'moving') {
        if (!(await originalReachable(r))) { out.waiting += 1; continue; }
        const original = await fs.pathExists(r.original_path);
        if (!stored || original) {
          // the move never finished: the original is where it was; a partial copy is not kept
          if (stored && original) await fs.remove(r.stored_path).catch(() => { });
          db.prepare('DELETE FROM hash_removals WHERE id = ?').run(r.id);
          continue;
        }
        // the move finished but the restart cut off its bookkeeping
        db.transaction(() => {
          db.prepare(`UPDATE hash_removals SET status = 'held' WHERE id = ?`).run(r.id);
          if (r.run_item_id != null) db.prepare(`UPDATE hash_run_items SET status = 'removed', selected = 0 WHERE id = ?`).run(r.run_item_id);
          if (r.file_hash_id != null) db.prepare('UPDATE performer_file_hashes SET deleted_flag = 2 WHERE id = ? AND deleted_flag = 0').run(r.file_hash_id);
        })();
        adjustCounts(r.performer_id, r.original_path, 1);
      }

      if (!stored) {
        db.prepare(`UPDATE hash_removals SET status = 'lost', error = ? WHERE id = ?`).run('Stored file not found', r.id);
        out.lost += 1;
        continue;
      }

      const where = await oldTrashTarget(r);
      if (where.unreachable) { out.waiting += 1; continue; }
      if (where.gone) {
        if (removedAtMs(r) + OLD_RETENTION_MS < Date.now()) {
          // past the old retention, and nowhere to put it back: delete it, as the old store would have
          await fs.remove(r.stored_path);
          await cleanStoreDirs(r.stored_path);
          db.prepare(`UPDATE hash_removals SET status = 'purged', error = NULL WHERE id = ?`).run(r.id);
          out.purged += 1;
          continue;
        }
        db.prepare(`UPDATE hash_removals SET status = 'no_folder', error = ? WHERE id = ?`).run('Her folder is gone', r.id);
        out.noFolder += 1;
        continue;
      }
      // the stored name is '<n>-<name>': in the trash it gets the original name, marked
      const dest = await fileTrash.moveMarked(r.stored_path, where.trashDir, path.basename(r.original_path));
      await cleanStoreDirs(r.stored_path);
      db.prepare(`UPDATE hash_removals SET status = 'trashed', trash_path = ?, error = NULL WHERE id = ?`).run(dest, r.id);
      out.moved += 1;
    } catch (err) {
      try { db.prepare('UPDATE hash_removals SET error = ? WHERE id = ?').run(err.message, r.id); } catch (_) { /* ignore */ }
      console.error('Old Recently removed: could not move record', r.id, err.message);
    }
  }
  for (const root of roots) await removeIfEmpty(path.join(root, STORE_DIR));
  if (out.moved || out.noFolder || out.lost || out.purged) {
    console.log(`Old Recently removed: ${out.moved} moved to her trash, ${out.noFolder} with no folder, ${out.purged} deleted after 30 days, ${out.lost} lost`);
  }
  return out;
}

/** Files of the old store that could not go to a trash folder because her folder is gone. */
function listOldRemovals() {
  let rows = [];
  try {
    rows = db.prepare(`SELECT * FROM hash_removals WHERE status = 'no_folder' ORDER BY removed_at DESC, id DESC`).all();
  } catch (_) {
    rows = [];
  }
  return {
    items: rows.map((r) => ({
      id: r.id,
      performerId: r.performer_id,
      name: path.basename(r.original_path),
      originalPath: r.original_path,
      storedPath: r.stored_path,
      size: r.file_size,
      removedAt: removedAtMs(r),
      deleteAfter: removedAtMs(r) + OLD_RETENTION_MS,
    })),
    count: rows.length,
  };
}

/**
 * Deletes the marked files (dupe__) at the top of every performer's pics/.trash, vids/.trash and vids/funscript/.trash
 * that no live batch can still put back. Only marked files; never throws. Returns { dropped, failed }.
 */
async function sweepDuplicates() {
  const out = { dropped: 0, failed: 0 };
  let performers = [];
  try {
    performers = db.prepare('SELECT * FROM performers').all();
  } catch (_) {
    return out;
  }
  const seen = new Set();
  for (const p of performers) {
    let dir = null;
    try { dir = performerDirOf(p); } catch (_) { dir = null; }
    if (!dir) continue;
    for (const trashDir of [path.join(dir, 'pics', '.trash'), path.join(dir, 'vids', '.trash'), path.join(dir, 'vids', 'funscript', '.trash')]) {
      const key = fileTrash.norm(trashDir);
      if (seen.has(key)) continue;
      seen.add(key);
      let names;
      try {
        names = await fs.readdir(trashDir);
      } catch (_) {
        continue; // not there, or the library is away
      }
      const live = liveTrashPaths();
      const entries = names
        .filter((n) => fileTrash.isNoTraining(n))
        .map((n) => ({ trashPath: path.join(trashDir, n) }))
        .filter((e) => !live.has(fileTrash.norm(e.trashPath)));
      if (!entries.length) continue;
      const r = await dropTrashed(entries);
      out.dropped += r.dropped;
      out.failed += r.failed;
    }
  }
  if (out.dropped || out.failed) console.log(`Duplicates in the trash: ${out.dropped} deleted, ${out.failed} in use`);
  return out;
}

async function housekeeping() {
  try { await moveOldRemovals(); } catch (err) { console.error('Old Recently removed move failed:', err.message); }
  try { await sweepDuplicates(); } catch (err) { console.error('Duplicate sweep failed:', err.message); }
}

let started = false;
/**
 * At start-up (index.js): the old store's files go to her trash, once, and the marked files left in her trash are
 * deleted; both again once a day.
 */
function startRetention() {
  if (started) return;
  started = true;
  housekeeping();
  const timer = setInterval(housekeeping, SWEEP_MS);
  if (timer.unref) timer.unref();
}

module.exports = {
  UNDO_MS,
  newBatchId,
  trashFile,
  rememberBatch,
  undoBatch,
  moveOldRemovals,
  listOldRemovals,
  expireBatch,
  sweepDuplicates,
  startRetention,
  countTypeOf,
};
