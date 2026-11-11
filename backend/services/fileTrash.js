/**
 * Recoverable deletes for the player: a video and its funscripts go to the .trash folder beside them (the same
 * folder the filter view uses), and can be put back. Tag and score rows are kept, so an Undo brings them back too.
 *
 * Layout: <dir>/x.mp4 goes to <dir>/.trash/x.mp4; the per-video funscript folders vids/funscript/<sub>/x.mp4 go to
 * vids/funscript/.trash/<sub>/x.mp4. performerFolders already processes both trash folders.
 *
 * Duplicates (the duplicates page, services/hashRemovals.js) go to her own pics/.trash, vids/.trash or
 * vids/funscript/.trash with the name prefix NO_TRAINING_PREFIX ('dupe__'). A duplicate is not a bad picture, so it
 * must never be saved for training: every path that empties a .trash calls dropNoTraining(trashFolder) first, which
 * deletes the marked files, and only then saves or deletes the rest.
 */
const fs = require('fs-extra');
const path = require('path');
const db = require('../db');

const VIDEO_EXT = ['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.webm', '.m4v', '.flv', '.ts', '.mpg', '.mpeg'];
const WIN = process.platform === 'win32';

class TrashError extends Error {
  constructor(status, message, results) {
    super(message);
    this.name = 'TrashError';
    this.status = status;
    if (results) this.results = results;
  }
}

/** A path in one form for comparisons: resolved, no trailing separator, lowercase on Windows. */
function norm(p) {
  const s = path.resolve(String(p)).replace(/[\\/]+$/, '');
  return WIN ? s.toLowerCase() : s;
}

/** True when p is inside a registered library folder and no folder or file below that root starts with a dot. */
function insideLibrary(p) {
  if (typeof p !== 'string' || !p || !path.isAbsolute(p)) return false;
  const target = norm(p);
  let rows = [];
  try {
    rows = db.prepare('SELECT path FROM folders').all();
  } catch (err) {
    return false;
  }
  for (const row of rows) {
    if (!row || !row.path) continue;
    const root = norm(row.path);
    if (!target.startsWith(root + path.sep)) continue;
    const rest = target.slice(root.length + 1).split(/[\\/]/).filter(Boolean);
    if (rest.length && !rest.some(seg => seg.startsWith('.'))) return true;
  }
  return false;
}

/** The trash folder a file goes to. */
function trashDirOf(filePath) {
  const dir = path.dirname(filePath);
  const parent = path.dirname(dir);
  if (path.basename(parent).toLowerCase() === 'funscript' && path.basename(path.dirname(parent)).toLowerCase() === 'vids') {
    return path.join(parent, '.trash', path.basename(dir));
  }
  return path.join(dir, '.trash');
}

/** The funscripts of a video by the dot rule: <base>.funscript and <base>.<axis>.funscript, main script first. */
async function videoScripts(videoPath) {
  const dir = path.dirname(String(videoPath));
  const base = path.basename(String(videoPath), path.extname(String(videoPath)));
  const same = (a, b) => (WIN ? a.toLowerCase() === b.toLowerCase() : a === b);
  const startsWith = (s, prefix) => (WIN ? s.toLowerCase().startsWith(prefix.toLowerCase()) : s.startsWith(prefix));
  let names;
  try {
    names = await fs.readdir(dir);
  } catch (err) {
    return [];
  }
  const found = [];
  for (const name of names) {
    if (!name.toLowerCase().endsWith('.funscript')) continue;
    const stem = name.slice(0, -'.funscript'.length);
    let axis;
    if (same(stem, base)) axis = '';
    else if (startsWith(stem, base + '.')) axis = stem.slice(base.length + 1);
    else continue;
    const full = path.join(dir, name);
    try {
      const st = await fs.stat(full);
      if (!st.isFile()) continue;
      found.push({ name, path: full, size: st.size, axis });
    } catch (err) {
      // gone or unreadable: not listed
    }
  }
  found.sort((a, b) => {
    if ((a.axis === '') !== (b.axis === '')) return a.axis === '' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return found;
}

function reasonOf(err) {
  const code = err && err.code;
  if (code === 'EBUSY') return 'The file is in use by another program.';
  if (code === 'EPERM' || code === 'EACCES') return 'No permission to move it.';
  if (code === 'ENOENT') return 'It is not there any more.';
  return (err && err.message) || String(err);
}

async function lstatOrNull(p) {
  try {
    return await fs.lstat(p);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

function isVideo(p) {
  return VIDEO_EXT.includes(path.extname(String(p)).toLowerCase());
}

/** The performers row whose folder holds the file, or null. */
function ownerOf(filePath) {
  try {
    const hashService = require('./hashService');
    const info = hashService.performerOfPath(filePath);
    if (!info) return null;
    const want = norm(info.performerDir);
    const rows = db.prepare('SELECT * FROM performers WHERE name = ?').all(path.basename(info.performerDir));
    for (const row of rows) {
      const dir = hashService.performerDirOf(row);
      if (dir && norm(dir) === want) return row;
    }
  } catch (err) {
    console.warn('[fileTrash] owner lookup failed:', err.message);
  }
  return null;
}

/** Keeps the hash flag, the performer's counts and the filter cache in step with a move. direction 1 trash, -1 back. */
function afterMove(filePath, direction) {
  try {
    if (direction > 0) {
      db.prepare('UPDATE performer_file_hashes SET deleted_flag = 1 WHERE file_path = ? AND deleted_flag = 0').run(filePath);
    } else {
      db.prepare('UPDATE performer_file_hashes SET deleted_flag = 0 WHERE file_path = ? AND deleted_flag = 1').run(filePath);
    }
  } catch (err) {
    console.warn('[fileTrash] deleted_flag update failed:', err.message);
  }
  const owner = ownerOf(filePath);
  if (!owner) return;
  try {
    const filterService = require('./filterService');
    if (isVideo(filePath)) {
      const type = /[\\/]vids[\\/]funscript[\\/]/i.test(filePath) ? 'funscript_video' : 'video';
      filterService.adjustDiskCounts(owner.id, type, 'delete', direction);
    }
    filterService.clearPerformerCache(owner.id);
  } catch (err) {
    console.warn('[fileTrash] count update failed:', err.message);
  }
}

/** Moves one file into its trash folder, with ' (n)' on a name clash. Throws when the move fails. */
async function trashOne(filePath) {
  const trashDir = trashDirOf(filePath);
  await fs.ensureDir(trashDir);
  const name = path.basename(filePath);
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  let dest = path.join(trashDir, name);
  for (let n = 2; await lstatOrNull(dest); n += 1) {
    if (n > 999) throw new Error('The trash already holds too many files with this name.');
    dest = path.join(trashDir, `${stem} (${n})${ext}`);
  }
  await fs.move(filePath, dest, { overwrite: false });
  afterMove(filePath, 1);
  return { path: filePath, trashPath: dest };
}

/** Moves a video and the chosen funscripts of it to the trash. Nothing moves when the video cannot. */
async function trashVideo({ videoPath, funscriptPaths } = {}) {
  if (typeof videoPath !== 'string' || !videoPath || !path.isAbsolute(videoPath) || !isVideo(videoPath) || !insideLibrary(videoPath)) {
    throw new TrashError(400, 'Not a video in the library.');
  }
  let st;
  try {
    st = await lstatOrNull(videoPath);
  } catch (err) {
    throw new TrashError(500, reasonOf(err));
  }
  if (!st) throw new TrashError(404, 'The video is not there any more.');
  if (!st.isFile()) throw new TrashError(400, 'Not a file.');

  if (funscriptPaths != null && !Array.isArray(funscriptPaths)) {
    throw new TrashError(400, 'The funscripts must be a list.');
  }
  const own = new Map((await videoScripts(videoPath)).map(s => [norm(s.path), s.path]));
  const scripts = [];
  const seen = new Set();
  for (const p of funscriptPaths || []) {
    const key = typeof p === 'string' && p ? norm(p) : null;
    if (!key || !own.has(key)) {
      throw new TrashError(400, `${path.basename(String(p || ''))} is not a funscript of this video.`);
    }
    if (seen.has(key)) continue;
    seen.add(key);
    scripts.push(own.get(key));
  }

  const trashed = [];
  try {
    trashed.push(await trashOne(videoPath));
  } catch (err) {
    const reason = reasonOf(err);
    throw new TrashError(err && err.code === 'EBUSY' ? 409 : 500, 'Nothing was moved: ' + reason, [
      { path: videoPath, reason },
      ...scripts.map(p => ({ path: p, reason: 'Left in place with the video.' }))
    ]);
  }
  const failed = [];
  for (const p of scripts) {
    try {
      trashed.push(await trashOne(p));
    } catch (err) {
      failed.push({ path: p, reason: reasonOf(err) });
    }
  }
  return { success: failed.length === 0, trashed, failed };
}

/** Moves one funscript to the trash. */
async function trashFunscript(scriptPath) {
  if (typeof scriptPath !== 'string' || !scriptPath || !path.isAbsolute(scriptPath)
    || path.extname(scriptPath).toLowerCase() !== '.funscript' || !insideLibrary(scriptPath)) {
    throw new TrashError(400, 'Not a funscript in the library.');
  }
  let st;
  try {
    st = await lstatOrNull(scriptPath);
  } catch (err) {
    throw new TrashError(500, reasonOf(err));
  }
  if (!st) throw new TrashError(404, 'The funscript is not there any more.');
  if (!st.isFile()) throw new TrashError(400, 'Not a file.');
  try {
    return { success: true, trashed: [await trashOne(scriptPath)] };
  } catch (err) {
    throw new TrashError(err && err.code === 'EBUSY' ? 409 : 500, reasonOf(err));
  }
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** True when trashPath is where trashOne would have put path (with or without ' (n)'). */
function isTrashCopy(original, trashPath) {
  if (norm(path.dirname(trashPath)) !== norm(trashDirOf(original))) return false;
  const name = path.basename(original);
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  const low = ext.toLowerCase();
  if (!VIDEO_EXT.includes(low) && low !== '.funscript') return false;
  const re = new RegExp(`^${escapeRegExp(stem)}( \\(\\d{1,3}\\))?${escapeRegExp(ext)}$`, WIN ? 'i' : '');
  return re.test(path.basename(trashPath));
}

async function removeIfEmpty(dir) {
  try {
    const left = await fs.readdir(dir);
    if (left.length === 0) await fs.rmdir(dir);
  } catch (err) {
    // not empty, gone or busy: leave it
  }
}

/** Puts trashed files back where they were. Items that cannot go back are skipped with a reason. */
async function restoreFromTrash(items) {
  if (!Array.isArray(items) || items.length < 1 || items.length > 50
    || items.some(it => !it || typeof it !== 'object')) {
    throw new TrashError(400, 'Nothing to put back.');
  }
  const restored = [];
  const skipped = [];
  for (const item of items) {
    const original = item.path;
    const trashPath = item.trashPath;
    const skip = (reason) => skipped.push({ path: typeof original === 'string' ? original : String(original), reason });
    if (typeof original !== 'string' || typeof trashPath !== 'string' || !original || !trashPath
      || !path.isAbsolute(original) || !path.isAbsolute(trashPath)
      || !insideLibrary(original) || !isTrashCopy(original, trashPath)) {
      skip('Not a trash copy of this file.');
      continue;
    }
    try {
      const st = await lstatOrNull(trashPath);
      if (!st || !st.isFile()) { skip('It is not in the trash any more.'); continue; }
      if (await lstatOrNull(original)) { skip('A file with this name is already there.'); continue; }
      const dir = path.dirname(original);
      if (!(await lstatOrNull(dir))) {
        if (!(await lstatOrNull(path.dirname(dir)))) { skip('Its folder is gone.'); continue; }
        await fs.ensureDir(dir);
      }
      await fs.move(trashPath, original, { overwrite: false });
    } catch (err) {
      skip(reasonOf(err));
      continue;
    }
    restored.push(original);
    afterMove(original, -1);
    const trashDir = trashDirOf(original);
    await removeIfEmpty(trashDir);
    if (path.basename(path.dirname(trashDir)) === '.trash') await removeIfEmpty(path.dirname(trashDir));
  }
  return { restored, skipped };
}

// ── duplicates: to her trash, marked not for training ─────────

/** Name prefix of a file that is in a .trash only to be deleted, never saved for training. */
const NO_TRAINING_PREFIX = 'dupe__';

function isNoTraining(name) {
  return typeof name === 'string' && name.toLowerCase().startsWith(NO_TRAINING_PREFIX);
}

const PERFORMER_SEGMENT = /[\\/](before|after) filter performer[\\/]([^\\/]+)/i;

/**
 * Her trash folder for a file of hers, given her folder and the file's folder inside it ('/'-separated):
 * vids/funscript/... -> vids/funscript/.trash, vids/... -> vids/.trash, pics/... -> pics/.trash; a file elsewhere in
 * her folder goes by its type (a video to vids/.trash, anything else to pics/.trash). Those three are the trash
 * folders the emptying paths read.
 */
function performerTrashDir(performerDir, folder, filePath) {
  const segs = String(folder || '').split(/[\\/]/).filter(Boolean);
  const low = segs.map(s => s.toLowerCase());
  if (low[0] === 'vids' && low[1] === 'funscript') return path.join(performerDir, segs[0], segs[1], '.trash');
  if (low[0] === 'vids' || low[0] === 'pics') return path.join(performerDir, segs[0], '.trash');
  return path.join(performerDir, isVideo(filePath) ? 'vids' : 'pics', '.trash');
}

/** { performerDir, trashDir } of a file inside a performer folder, or null when it is not in one. */
function duplicateTrashOf(filePath) {
  const s = String(filePath || '');
  const m = PERFORMER_SEGMENT.exec(s);
  if (!m || !path.isAbsolute(s)) return null;
  const performerDir = s.slice(0, m.index + m[0].length);
  const rest = s.slice(performerDir.length).split(/[\\/]/).filter(Boolean);
  if (rest.length === 0) return null;
  rest.pop();
  return { performerDir, trashDir: performerTrashDir(performerDir, rest.join('/'), s) };
}

/** A free 'dupe__<name>' (then 'dupe__<stem> (2)<ext>', ...) in trashDir. */
async function freeMarkedPath(trashDir, name) {
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  let dest = path.join(trashDir, NO_TRAINING_PREFIX + name);
  for (let n = 2; await lstatOrNull(dest); n += 1) {
    if (n > 999) throw new Error('The trash already holds too many files with this name.');
    dest = path.join(trashDir, `${NO_TRAINING_PREFIX}${stem} (${n})${ext}`);
  }
  return dest;
}

/**
 * Moves a file into trashDir as a marked duplicate (not for training), as 'dupe__<name>' (name: its own by default).
 * Throws the move's error (err.code EBUSY when it is in use); nothing is left behind when it fails. No bookkeeping:
 * the caller does that.
 */
async function moveMarked(filePath, trashDir, name = path.basename(filePath)) {
  await fs.ensureDir(trashDir);
  const dest = await freeMarkedPath(trashDir, name);
  try {
    await fs.move(filePath, dest, { overwrite: false });
  } catch (err) {
    // a copy across devices that could not delete its source leaves the copy behind: drop it, the original is intact
    try {
      if (await lstatOrNull(filePath) && await lstatOrNull(dest)) await fs.remove(dest);
    } catch (_) { /* leave it */ }
    throw err;
  }
  return dest;
}

/** Moves a duplicate of hers into her trash, marked not for training. Returns { path, trashPath }. */
async function trashDuplicate(filePath) {
  const where = duplicateTrashOf(filePath);
  if (!where) throw new TrashError(400, 'Not a file in a performer folder.');
  const trashPath = await moveMarked(filePath, where.trashDir);
  return { path: filePath, trashPath };
}

/**
 * Puts a duplicate moved by trashDuplicate back. Throws a TrashError with the reason when it cannot: it is not in
 * the trash any more, a file took its name, or its folder is gone.
 */
async function untrashDuplicate(original, trashPath) {
  const where = duplicateTrashOf(original);
  if (!where || typeof trashPath !== 'string' || !path.isAbsolute(trashPath)
    || norm(path.dirname(trashPath)) !== norm(where.trashDir) || !isNoTraining(path.basename(trashPath))) {
    throw new TrashError(400, 'Not a trash copy of this file.');
  }
  const st = await lstatOrNull(trashPath);
  if (!st || !st.isFile()) throw new TrashError(404, 'It is not in the trash any more.');
  if (await lstatOrNull(original)) throw new TrashError(409, 'A file with this name is already there.');
  if (!(await lstatOrNull(path.dirname(original)))) throw new TrashError(404, 'Its folder is gone.');
  try {
    await fs.move(trashPath, original, { overwrite: false });
  } catch (err) {
    throw new TrashError(err && err.code === 'EBUSY' ? 409 : 500, reasonOf(err));
  }
  await removeIfEmpty(where.trashDir);
  return { path: original };
}

/**
 * Deletes the files marked not for training (NO_TRAINING_PREFIX) in a .trash folder and the folders below it, before
 * the rest is saved for training or deleted. Never throws: a missing folder is nothing to do, a file that cannot be
 * deleted is listed in failed. Returns { dropped, failed: [{ path, reason }] }.
 */
async function dropNoTraining(trashFolder) {
  const out = { dropped: 0, failed: [] };
  async function walk(dir, depth) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (err) {
      if (err.code !== 'ENOENT' && err.code !== 'ENOTDIR') out.failed.push({ path: dir, reason: reasonOf(err) });
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (depth < 4) {
          await walk(full, depth + 1);
          await removeIfEmpty(full);
        }
        continue;
      }
      if (!isNoTraining(e.name)) continue;
      try {
        await fs.remove(full);
        out.dropped += 1;
      } catch (err) {
        out.failed.push({ path: full, reason: reasonOf(err) });
      }
    }
  }
  await walk(String(trashFolder || ''), 0);
  if (out.failed.length) console.warn(`[fileTrash] ${out.failed.length} duplicate(s) in ${trashFolder} could not be deleted`);
  return out;
}

module.exports = {
  VIDEO_EXT,
  TrashError,
  norm,
  insideLibrary,
  trashDirOf,
  videoScripts,
  reasonOf,
  trashOne,
  trashVideo,
  trashFunscript,
  restoreFromTrash,
  NO_TRAINING_PREFIX,
  isNoTraining,
  performerTrashDir,
  duplicateTrashOf,
  moveMarked,
  trashDuplicate,
  untrashDuplicate,
  dropNoTraining
};
