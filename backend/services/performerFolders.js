/**
 * One performer record owns one folder.
 *
 * A record's folder is <library>/<before|after filter performer>/<name>. Two records can share a name in one library
 * (a new import of her into Before while her After record exists, or two Before records left by old imports): they
 * are "twins". Every route that reads, deletes, moves or renames a performer's folder decides here which folder is
 * hers, so a twin's folder is never touched by mistake.
 *
 * - Her home: After when moved_to_after is 1, else Before.
 * - Her own folder: her home folder when it exists; else the folder in the other location when it exists and no
 *   twin has that location as home; else none.
 * - A shared folder: a twin with the same home folder. Nothing that deletes a folder runs then: merge them first.
 * - The legacy trash (<library>/trash/<name>) and the training folder (<library>/deleted keep for training/<name>)
 *   are per name: they go only when she has no twins.
 * - Her real trash is inside her folder (pics/.trash, vids/.trash, vids/funscript/.trash, written by the filter):
 *   it is saved for training (setting save_deleted_for_training) or deleted with the folder.
 */
const db = require('../db');
const fs = require('fs-extra');
const path = require('path');
const { BEFORE_FOLDER, AFTER_FOLDER } = require('./performerRecords');

const TRASH_FOLDER = 'trash';
const TRAINING_FOLDER = 'deleted keep for training';

const NAME_RULE = 'A name cannot contain / \\ or :, be . or .., or start with a dot';
const INVALID_BLOCK = 'Her name is not a valid folder name. Rename her first.';
const sharedBlock = (id) => `Another record of hers (#${id}) uses the same folder. Merge the two records first.`;

/** null when the name can be a folder name, else the reason. */
function validName(name) {
  if (typeof name !== 'string' || name.length === 0) return 'Enter a name';
  if (name !== name.trim()) return 'A name cannot start or end with a space';
  if (name.length > 255) return 'A name can be at most 255 characters';
  if (/[\u0000-\u001f]/.test(name)) return 'A name cannot contain control characters';
  if (name === '.' || name === '..' || name.startsWith('.') || /[/\\:]/.test(name)) return NAME_RULE;
  return null;
}

const locationFolder = (location) => (location === 'after' ? AFTER_FOLDER : BEFORE_FOLDER);
const otherLocation = (location) => (location === 'after' ? 'before' : 'after');
const locationLabel = (location) => (location === 'after' ? 'After' : 'Before');

function homeLocation(p) {
  return p && p.moved_to_after === 1 ? 'after' : 'before';
}

function homePath(p) {
  if (!p || !p.folder_path || validName(p.name)) return null;
  return path.join(p.folder_path, locationFolder(homeLocation(p)), p.name);
}

/** Same folder path: case-insensitive on Windows, exact elsewhere (the NAS). */
function samePath(a, b) {
  if (!a || !b) return false;
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/** '<folder>/<name>' relative to the library, always with '/'. */
function relOf(base, abs) {
  return path.relative(base, abs).split(path.sep).join('/');
}

async function isDir(p) {
  try {
    return (await fs.stat(p)).isDirectory();
  } catch {
    return false;
  }
}

/** The other records of her name in her library (null folder_id matches null). */
function twinsOf(p) {
  return db.prepare(`
    SELECT p.*, f.path AS folder_path
    FROM performers p LEFT JOIN folders f ON p.folder_id = f.id
    WHERE p.id != ? AND p.folder_id IS ? AND p.name = ? COLLATE NOCASE AND p.name NOT LIKE '.%'
  `).all(p.id, p.folder_id ?? null, p.name);
}

/**
 * Her own folder, where it is expected, and which twins share it.
 * @returns {{ own: {location, path, rel}|null, expected: {location, path}|null, invalidName: boolean, sharedWith: number[] }}
 */
async function resolveOwnFolder(p, twins = []) {
  const result = { own: null, expected: null, invalidName: false, sharedWith: [] };
  if (!p) return result;
  if (validName(p.name)) {
    result.invalidName = true;
    return result;
  }
  if (!p.folder_path) return result;

  const home = homeLocation(p);
  const expectedPath = homePath(p);
  result.expected = { location: home, path: expectedPath };
  result.sharedWith = twins
    .filter(t => t.id !== p.id && samePath(homePath({ ...t, folder_path: t.folder_path ?? p.folder_path }), expectedPath))
    .map(t => t.id);

  let location = null;
  if (await isDir(expectedPath)) {
    location = home;
  } else {
    const other = otherLocation(home);
    const otherPath = path.join(p.folder_path, locationFolder(other), p.name);
    if (await isDir(otherPath) && !twins.some(t => t.id !== p.id && homeLocation(t) === other)) location = other;
  }
  if (!location) return result;

  const ownPath = path.join(p.folder_path, locationFolder(location), p.name);
  // Belt and braces: her folder is a direct child of the location folder and carries her name
  if (path.dirname(ownPath) !== path.join(p.folder_path, locationFolder(location)) || path.basename(ownPath) !== p.name) {
    return result;
  }
  result.own = { location, path: ownPath, rel: `${locationFolder(location)}/${p.name}` };
  return result;
}

/** Files and bytes under dir, counting at most `cap` entries (then approx is true). */
async function folderStats(dir, cap = 20000) {
  const out = { files: 0, bytes: 0, approx: false };
  let entries = 0;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    let items;
    try {
      items = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    const files = [];
    for (const item of items) {
      entries += 1;
      if (entries > cap) {
        out.approx = true;
        break;
      }
      const full = path.join(current, item.name);
      if (item.isDirectory()) stack.push(full);
      else if (item.isFile()) files.push(full);
    }
    for (let i = 0; i < files.length; i += 50) {
      const sizes = await Promise.all(files.slice(i, i + 50).map(f => fs.stat(f).then(s => s.size, () => 0)));
      out.files += sizes.length;
      for (const size of sizes) out.bytes += size;
    }
    if (out.approx) break;
  }
  return out;
}

function trashSubfolders(dir) {
  return [
    { path: path.join(dir, 'pics', '.trash'), kind: 'image' },
    { path: path.join(dir, 'vids', '.trash'), kind: 'video' },
    { path: path.join(dir, 'vids', 'funscript', '.trash'), kind: 'funscript' }
  ];
}

/** Files in her trash: pics/.trash, vids/.trash and vids/funscript/.trash inside dir. */
async function trashFileCount(dir) {
  let count = 0;
  for (const t of trashSubfolders(dir)) {
    if (await isDir(t.path)) count += (await folderStats(t.path)).files;
  }
  return count;
}

function saveTrashForTraining() {
  const setting = db.prepare('SELECT value FROM app_settings WHERE key = ?').get('save_deleted_for_training');
  return !!setting && setting.value === 'true';
}

/**
 * Save a .trash folder's contents for training (setting save_deleted_for_training) or delete it.
 * kind 'image' goes to <base>/deleted keep for training/<name>/pics, 'video' and 'funscript' to .../vids.
 */
async function handleTrashFolder(trashFolderPath, performerName, basePath, kind) {
  // Duplicates (name 'dupe__...', from the duplicates page) are deleted first and never saved for training
  const { dropNoTraining, isNoTraining } = require('./fileTrash');
  await dropNoTraining(trashFolderPath);
  if (!await fs.pathExists(trashFolderPath)) {
    return { saved: false, count: 0 };
  }
  // a duplicate that could not be deleted (in use) is never moved to training: it goes with the folder below
  const files = (await fs.readdir(trashFolderPath)).filter(f => !isNoTraining(f));
  if (saveTrashForTraining() && files.length > 0) {
    const destFolder = path.join(basePath, TRAINING_FOLDER, performerName, kind === 'image' ? 'pics' : 'vids');
    await fs.ensureDir(destFolder);
    for (const file of files) {
      await fs.move(path.join(trashFolderPath, file), path.join(destFolder, file), { overwrite: true });
    }
    await fs.remove(trashFolderPath);
    return { saved: true, count: files.length };
  }
  await fs.remove(trashFolderPath);
  return { saved: false, count: files.length };
}

/** Delete a folder, retrying a few times while a file in it is locked. */
async function deleteFolderWithRetry(folderPath, maxRetries = 3, delayMs = 1000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await fs.remove(folderPath);
      return { success: true };
    } catch (err) {
      if (err.code === 'EBUSY' && attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
        continue;
      }
      throw err;
    }
  }
}

/**
 * Delete one folder of hers. With saveTrash, its .trash subfolders pass through handleTrashFolder first (a failure
 * there is reported in errors and does not stop); without, they are deleted with the folder. A failure deleting the
 * folder itself throws.
 */
async function removeFolder(dir, performer, { saveTrash = true } = {}) {
  const out = { saved: 0, deleted: 0, errors: [] };
  if (saveTrash) {
    for (const t of trashSubfolders(dir)) {
      try {
        const r = await handleTrashFolder(t.path, performer.name, performer.folder_path, t.kind);
        if (r.saved) out.saved += r.count;
        else out.deleted += r.count;
      } catch (err) {
        out.errors.push({ rel: relOf(performer.folder_path, t.path), error: err.message });
      }
    }
  } else {
    out.deleted = await trashFileCount(dir);
  }
  await deleteFolderWithRetry(dir);
  return out;
}

/**
 * What each removal option deletes, and whether it is refused. The remove dialog shows it (with stats); every
 * destructive route recomputes it (without) and deletes exactly options[option].goes.
 */
async function planRemoval(p, { stats = false } = {}) {
  const twins = twinsOf(p);
  const resolved = await resolveOwnFolder(p, twins);
  const { own, sharedWith } = resolved;
  const invalid = resolved.invalidName;
  const hasTwins = twins.length > 0;
  const base = p.folder_path;
  const folders = [];

  if (!invalid && base) {
    // Each twin's own folder: listed, never deleted
    const others = [];
    for (const twin of twins) {
      const t = { ...twin, folder_path: twin.folder_path ?? base };
      const r = await resolveOwnFolder(t, [p, ...twins.filter(x => x.id !== twin.id)]);
      if (!r.own || (own && samePath(r.own.path, own.path))) continue;
      others.push({ key: 'other', label: locationLabel(r.own.location), rel: r.own.rel, path: r.own.path, otherId: twin.id });
    }

    if (own) folders.push({ key: 'own', label: locationLabel(own.location), rel: own.rel, path: own.path });

    const beforePath = path.join(base, BEFORE_FOLDER, p.name);
    if (p.moved_to_after === 1 && own && own.location === 'after' && await isDir(beforePath)
      && !twins.some(t => homeLocation(t) === 'before') && !others.some(o => samePath(o.path, beforePath))) {
      folders.push({ key: 'leftover', label: 'Leftover', rel: `${BEFORE_FOLDER}/${p.name}`, path: beforePath });
    }

    const trashPath = path.join(base, TRASH_FOLDER, p.name);
    if (await isDir(trashPath)) {
      folders.push({ key: 'trash', label: 'Old trash', rel: `${TRASH_FOLDER}/${p.name}`, path: trashPath, shared: hasTwins });
    }
    const trainingPath = path.join(base, TRAINING_FOLDER, p.name);
    if (await isDir(trainingPath)) {
      folders.push({ key: 'training', label: 'Saved for training', rel: `${TRAINING_FOLDER}/${p.name}`, path: trainingPath, shared: hasTwins });
    }
    folders.push(...others);
  }

  if (stats) {
    for (const f of folders) {
      Object.assign(f, await folderStats(f.path));
      if (f.key === 'own' || f.key === 'leftover') f.trashFiles = await trashFileCount(f.path);
    }
  }

  const has = (key) => folders.some(f => f.key === key);
  const free = (key) => folders.some(f => f.key === key && !f.shared);
  const ownAndTrash = [...(has('own') ? ['own'] : []), ...(free('trash') ? ['trash'] : [])];
  const common = invalid ? INVALID_BLOCK : sharedWith.length ? sharedBlock(sharedWith[0]) : null;

  let cleanupBlocked = null;
  if (invalid) cleanupBlocked = INVALID_BLOCK;
  else if (p.moved_to_after !== 1) cleanupBlocked = 'Her record is not in After';
  else if (own && own.location === 'before') cleanupBlocked = 'Her After folder is missing: the Before folder holds her files';
  else if (base && (twins.some(t => homeLocation(t) === 'before')
    || folders.some(f => f.key === 'other' && samePath(f.path, path.join(base, BEFORE_FOLDER, p.name))))
    && await isDir(path.join(base, BEFORE_FOLDER, p.name))) {
    cleanupBlocked = 'Her Before folder belongs to her other record, a new import';
  } else if (!has('leftover')) cleanupBlocked = 'She has no Before folder';
  else if (sharedWith.length) cleanupBlocked = sharedBlock(sharedWith[0]);

  const options = {
    blacklist: { goes: ownAndTrash, blocked: common },
    'delete-folder-only': { goes: ownAndTrash, blocked: common || (has('own') ? null : 'She has no folder to delete') },
    'cleanup-before': { goes: has('leftover') ? ['leftover'] : [], blocked: cleanupBlocked },
    'delete-record': { goes: [], blocked: null },
    'delete-complete': { goes: ownAndTrash, blocked: common },
    'delete-forget': { goes: [...ownAndTrash, ...(free('training') ? ['training'] : [])], blocked: common },
    unblacklist: { goes: [], blocked: p.blacklisted === 1 ? null : 'She is not blacklisted' }
  };

  const isEmpty = (p.pics_count || 0) + (p.vids_count || 0) + (p.funscript_vids_count || 0) === 0;
  const location = p.blacklisted === 1 ? 'blacklisted' : own && !isEmpty ? own.location : 'missing-or-empty';

  return { id: p.id, name: p.name, location, saveTrashForTraining: saveTrashForTraining(), folders, options };
}

module.exports = {
  BEFORE_FOLDER,
  AFTER_FOLDER,
  TRASH_FOLDER,
  TRAINING_FOLDER,
  NAME_RULE,
  validName,
  locationFolder,
  locationLabel,
  homeLocation,
  homePath,
  samePath,
  relOf,
  twinsOf,
  resolveOwnFolder,
  folderStats,
  trashFileCount,
  saveTrashForTraining,
  handleTrashFolder,
  deleteFolderWithRetry,
  removeFolder,
  planRemoval
};
