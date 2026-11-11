/**
 * Import guard: the checks and file rules every import shares (server folder and browser upload).
 *
 * - which library a request means (only a registered folders row, never a path from the request as is)
 * - the name rules for a performer name and a "before upload" folder name (single path segments only)
 * - the name match, by the same rule the importer uses (findPerformerByNameOrAlias, any location)
 * - placeFile: moves a file into a folder and never overwrites (identical files are dropped, others renamed)
 * - the per-upload temp folder and its batch manifests
 */
const fs = require('fs-extra');
const path = require('path');
const db = require('../db');
const { findPerformerByNameOrAlias, normalizeName } = require('../utils/performerMatcher');

const SUPPORTED = {
  images: ['.jpg', '.jpeg', '.png', '.gif', '.webp'],
  videos: ['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm', '.m4v'],
  funscript: '.funscript'
};

function kindOf(name) {
  const ext = path.extname(String(name || '')).toLowerCase();
  if (!ext) return null;
  if (SUPPORTED.images.includes(ext)) return 'image';
  if (SUPPORTED.videos.includes(ext)) return 'video';
  if (ext === SUPPORTED.funscript) return 'funscript';
  return null;
}

const JUNK = new Set(['.ds_store', 'thumbs.db', 'desktop.ini']);
function isJunk(name) {
  const n = String(name || '');
  return JUNK.has(n.toLowerCase()) || n.startsWith('._');
}

// ── the library ──────────────────────────────────────────────
const norm = (p) => {
  const r = path.resolve(String(p)).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? r.toLowerCase() : r;
};

/** The registered folders row a request means: the first one without input, else the one with the same path. */
function resolveLibrary(input) {
  const rows = db.prepare('SELECT id, path FROM folders ORDER BY id').all();
  if (!rows.length) return null;
  if (input === undefined || input === null || input === '') return rows[0];
  if (typeof input !== 'string') return null;
  const want = norm(input);
  return rows.find(r => norm(r.path) === want) || null;
}

function httpError(status, code, message, extra = {}) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  Object.assign(err, extra);
  return err;
}

/** resolveLibrary, or an Error with status 400 and code 'no-library' / 'unknown-library'. */
function requireLibrary(input) {
  const lib = resolveLibrary(input);
  if (lib) return lib;
  const any = db.prepare('SELECT COUNT(*) AS n FROM folders').get().n > 0;
  if (any) throw httpError(400, 'unknown-library', 'This library folder is not registered');
  throw httpError(400, 'no-library', 'No library folder is set up');
}

// ── name rules ───────────────────────────────────────────────
const CONTROL = /[\u0000-\u001f\u007f]/;

function segmentError(name, what) {
  if (typeof name !== 'string' || !name.trim()) return 'Type a name';
  const n = name.trim();
  if (n.length > 200) return `A ${what} can be at most 200 characters`;
  if (n === '.' || n === '..') return `A ${what} cannot be . or ..`;
  if (/[\\/]/.test(n)) return `A ${what} cannot contain / or \\`;
  if (CONTROL.test(n)) return `A ${what} cannot contain control characters`;
  return null;
}

/** The rule for a performer name (it becomes a folder name in the library). A string, or null when it is fine. */
function performerNameError(name) {
  const err = segmentError(name, 'name');
  if (err) return err;
  if (name.trim().startsWith('.')) return 'A name cannot start with a dot';
  return null;
}

/**
 * The rule for a folder in "before upload": `{ code: 'invalid' | 'missing', error }`, or null when it is fine.
 * The name is used as is (not trimmed): it has to be the folder's real name.
 */
async function checkFolder(libPath, name) {
  const err = segmentError(name, 'folder name');
  if (err) return { code: 'invalid', error: err };
  const dir = path.join(libPath, 'before upload', name);
  // path.join could still fold a name; the folder must be directly in "before upload"
  if (path.dirname(dir) !== path.join(libPath, 'before upload')) return { code: 'invalid', error: 'Not a folder name' };
  try {
    const st = await fs.stat(dir);
    if (!st.isDirectory()) return { code: 'missing', error: `"${name}" is not a folder in before upload` };
  } catch (e) {
    return { code: 'missing', error: `The folder "${name}" is no longer in before upload` };
  }
  return null;
}

/** folderNameError(libPath, name): a string, or null when it is an existing folder directly in <lib>/before upload. */
async function folderNameError(libPath, name) {
  const p = await checkFolder(libPath, name);
  return p ? p.error : null;
}

// ── the name match ───────────────────────────────────────────
/** The Match object for a typed name: what an import under this name does. */
function resolveImportName(name) {
  const input = typeof name === 'string' ? name.trim() : '';
  const match = {
    kind: 'new', input, name: input, by: null, performerId: null, location: null,
    pics: null, vids: null, reason: null, blacklistedAt: null
  };
  const err = performerNameError(input);
  if (err) return { ...match, kind: 'invalid', reason: err };

  const row = findPerformerByNameOrAlias(input);
  if (!row) return match;

  Object.assign(match, {
    kind: 'existing',
    name: row.name,
    by: normalizeName(row.name) === normalizeName(input) ? 'name' : 'alias',
    performerId: row.id,
    location: row.moved_to_after ? 'after' : 'before',
    pics: row.pics_count ?? null,
    vids: row.vids_count ?? null
  });
  if (row.blacklisted === 1) {
    Object.assign(match, { kind: 'blacklisted', reason: row.blacklist_reason || null, blacklistedAt: row.blacklist_date || null });
  }
  // An import always goes into "before filter": into her Before record when she has one, otherwise into a new one next to
  // her After record (uploadImporter looks her up by name with moved_to_after = 0). Say which, with both counts.
  const twins = db.prepare('SELECT moved_to_after, pics_count, vids_count FROM performers WHERE name = ?').all(row.name);
  const counts = (r) => (r ? { pics: r.pics_count ?? 0, vids: r.vids_count ?? 0 } : null);
  match.before = counts(twins.find(t => !t.moved_to_after));
  match.after = counts(twins.find(t => t.moved_to_after));
  return match;
}

// ── uploads ──────────────────────────────────────────────────
const UPLOAD_ID = /^upload-[A-Za-z0-9_-]{6,80}$/;

/** A relative path from a browser: segments only, no '', '.' or '..', '/' separators, at most 400 characters. */
function safeRel(s) {
  const joined = String(s == null ? '' : s).split(/[\\/]+/).filter(p => p && p !== '.' && p !== '..').join('/');
  if (joined.length <= 400) return joined;
  // Too long: keep the end (the file name), dropping a cut first segment
  const tail = joined.slice(-400);
  const cut = tail.indexOf('/');
  return cut >= 0 && joined[joined.length - 401] !== '/' ? tail.slice(cut + 1) : tail;
}

/** A name for a temp file: characters outside [A-Za-z0-9._() -] become '_', at most 120 characters. */
function safeBase(name) {
  return String(name == null ? '' : name).replace(/[^A-Za-z0-9._() -]/g, '_').slice(0, 120);
}

const tempRoot = (libPath) => path.join(libPath, '.temp-uploads');

/** <lib>/.temp-uploads/<uploadId>, for a validated id only. */
function uploadTempDir(libPath, uploadId) {
  if (typeof uploadId !== 'string' || !UPLOAD_ID.test(uploadId)) throw httpError(400, 'bad-id', 'This upload id is not valid');
  return path.join(tempRoot(libPath), uploadId);
}

const MANIFEST = /^batch-(\d+)\.json$/;

/** The complete batches of an upload: Map index -> { index, files: [{ temp, rel, size }], at }. */
async function readManifests(dir) {
  const out = new Map();
  let names;
  try { names = await fs.readdir(dir); } catch (e) { return out; }
  for (const name of names) {
    const m = MANIFEST.exec(name);
    if (!m) continue;
    try {
      const data = JSON.parse(await fs.readFile(path.join(dir, name), 'utf8'));
      if (data && Array.isArray(data.files)) out.set(Number(m[1]), data);
    } catch (e) {
      // A broken manifest counts as a missing batch: it is sent again
    }
  }
  return out;
}

// ── folder contents ──────────────────────────────────────────
/** Files of unsupported types under dir, recursively, without hidden entries and junk. */
async function countOther(dir) {
  const result = { count: 0, bytes: 0, exts: [] };
  async function walk(d) {
    let entries;
    try { entries = await fs.readdir(d, { withFileTypes: true }); } catch (e) { return; }
    for (const e of entries) {
      if (e.name.startsWith('.') || isJunk(e.name)) continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) { await walk(full); continue; }
      if (!e.isFile() || kindOf(e.name)) continue;
      result.count++;
      try { result.bytes += (await fs.stat(full)).size; } catch (err) { /* gone meanwhile */ }
      const ext = path.extname(e.name).toLowerCase();
      if (ext && result.exts.length < 5 && !result.exts.includes(ext)) result.exts.push(ext);
    }
  }
  await walk(dir);
  return result;
}

/** True when both files have the same size and the same bytes. */
async function sameContent(a, b) {
  let sa, sb;
  try { [sa, sb] = await Promise.all([fs.stat(a), fs.stat(b)]); } catch (e) { return false; }
  if (!sa.isFile() || !sb.isFile() || sa.size !== sb.size) return false;
  const CHUNK = 1024 * 1024;
  const fa = await fs.promises.open(a, 'r');
  try {
    const fb = await fs.promises.open(b, 'r');
    try {
      const ba = Buffer.alloc(CHUNK);
      const bb = Buffer.alloc(CHUNK);
      let pos = 0;
      while (pos < sa.size) {
        const [ra, rb] = await Promise.all([fa.read(ba, 0, CHUNK, pos), fb.read(bb, 0, CHUNK, pos)]);
        if (ra.bytesRead !== rb.bytesRead) return false;
        if (ra.bytesRead === 0) break;
        if (!ba.subarray(0, ra.bytesRead).equals(bb.subarray(0, rb.bytesRead))) return false;
        pos += ra.bytesRead;
      }
      return true;
    } finally {
      await fb.close();
    }
  } finally {
    await fa.close();
  }
}

const exists = async (p) => {
  try { await fs.lstat(p); return true; } catch (e) { return false; }
};

/**
 * Move src into dir as base, never overwriting:
 * - a free name: moved ('imported')
 * - a file with the same bytes under that name (or under one of its "stem (n)" names): src is removed ('identical')
 * - otherwise: the first free "stem (n)ext", n = 2, 3, … ('renamed')
 */
async function placeFile(src, dir, base) {
  if (!base || base === '.' || base === '..' || /[\\/]/.test(base)) throw new Error(`Not a file name: ${base}`);
  await fs.ensureDir(dir);
  const ext = path.extname(base);
  const stem = path.basename(base, ext);
  for (let n = 1; n < 100000; n++) {
    const name = n === 1 ? base : `${stem} (${n})${ext}`;
    const target = path.join(dir, name);
    if (!(await exists(target))) {
      try {
        await fs.move(src, target, { overwrite: false });
        return { outcome: n === 1 ? 'imported' : 'renamed', target };
      } catch (e) {
        // Taken in the meantime: try the next name; anything else is a real error
        if (await exists(target) && await exists(src)) continue;
        throw e;
      }
    }
    if (await sameContent(src, target)) {
      await fs.remove(src);
      return { outcome: 'identical', target };
    }
  }
  throw new Error(`No free name for ${base}`);
}

module.exports = {
  SUPPORTED,
  kindOf,
  isJunk,
  resolveLibrary,
  requireLibrary,
  httpError,
  performerNameError,
  checkFolder,
  folderNameError,
  resolveImportName,
  UPLOAD_ID,
  safeRel,
  safeBase,
  tempRoot,
  uploadTempDir,
  readManifests,
  countOther,
  sameContent,
  placeFile
};
