/**
 * Hash database and duplicate checks.
 *
 * performer_file_hashes holds one row per file of a performer: SHA-256 (exact_hash) and a 64-bit dHash
 * (perceptual_hash, 16 hex). deleted_flag: 0 live file, 1 deleted before (history, recognises re-downloads),
 * 2 removed by a duplicate check (moved to her trash, services/hashRemovals.js).
 *
 * A check groups files around a keeper (hash_run_items.candidate_id) with no transitive chains: exact copies
 * first, then the files directly within distance 9 of a seed. The run view and its actions live in hashReview.js.
 */
const crypto = require('crypto');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const sharp = require('sharp');
const db = require('../db');
const PathHelper = require('../utils/pathHelper');

const CONFIG = {
  hashAlgorithm: 'sha256',
  perceptualHashSize: 8, // 8x8 = 64 bits
  workerConcurrency: 4,
  videoFramePosition: 0.5, // middle of the video
  imageExtensions: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'],
  videoExtensions: ['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm', '.m4v'],
  playableExtensions: ['.mp4', '.webm', '.m4v', '.mov'],
  maxDistance: 9, // dHash bits out of 64 for "similar"
};

const JOB_KEEP_MS = 6 * 60 * 60 * 1000;
const FRAME_TIMEOUT_MS = 30000;
const PROBE_TIMEOUT_MS = 10000;

/** An error with an HTTP status and a code the routes pass through as { error, code, ...extra }. */
class HashError extends Error {
  constructor(status, code, message, extra) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

// ── small helpers ──────────────────────────────────────────────

function mediaTypeOf(filePath) {
  const ext = path.extname(String(filePath || '')).toLowerCase();
  if (CONFIG.imageExtensions.includes(ext)) return 'pic';
  if (CONFIG.videoExtensions.includes(ext)) return 'vid';
  return null;
}

function isPlayable(filePath) {
  return CONFIG.playableExtensions.includes(path.extname(String(filePath || '')).toLowerCase());
}

function popcount32(x) {
  x = x >>> 0;
  x = x - ((x >>> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  x = (x + (x >>> 4)) & 0x0f0f0f0f;
  return Math.imul(x, 0x01010101) >>> 24;
}

/** True when a file name looks like a copy of another: "copy of x", "copy x", "x - Copy", "x (1)", "x copy 2". */
function looksLikeCopy(filePath) {
  const base = path.basename(String(filePath || '')).replace(/\.[^.]+$/, '');
  return /^copy\b/i.test(base) || /[\s_-]copy(\s*\d+)?$/i.test(base) || /\s\(\d{1,2}\)$/.test(base);
}

/** '16 hex chars' -> { hi, lo, bits } (two uint32 and the number of set bits), or null. */
function parsePhash(hex) {
  if (typeof hex !== 'string' || !/^[0-9a-fA-F]{16}$/.test(hex)) return null;
  const hi = parseInt(hex.slice(0, 8), 16) >>> 0;
  const lo = parseInt(hex.slice(8), 16) >>> 0;
  return { hi, lo, bits: popcount32(hi) + popcount32(lo) };
}

function phashDistance(a, b) {
  return popcount32(a.hi ^ b.hi) + popcount32(a.lo ^ b.lo);
}

/** Distance between two stored perceptual hashes, -1 when it cannot be computed. */
function hammingDistance(hash1, hash2) {
  const a = parsePhash(hash1);
  const b = parsePhash(hash2);
  if (!a || !b) return -1;
  return phashDistance(a, b);
}

function similarityOf(distance) {
  if (distance == null || distance < 0) return null;
  return Math.round((1 - distance / 64) * 100);
}

const PERFORMER_SEGMENT = /[\\/](before|after) filter performer[\\/]([^\\/]+)/i;

/**
 * Where a file sits: { location: 'before'|'after', performerDir, root, folder } with folder the directory of the file
 * inside the performer folder, '/'-separated, '' at the top. null when the path has no performer folder.
 */
function performerOfPath(filePath) {
  if (!filePath) return null;
  const m = PERFORMER_SEGMENT.exec(String(filePath));
  if (!m) return null;
  const performerDir = filePath.slice(0, m.index + m[0].length);
  const rest = filePath.slice(performerDir.length).split(/[\\/]/).filter(Boolean);
  rest.pop();
  return { location: m[1].toLowerCase(), performerDir, root: filePath.slice(0, m.index), folder: rest.join('/') };
}

/** The folder of a file for display: inside the performer folder, else its parent folder's name. */
function folderOf(filePath) {
  const info = performerOfPath(filePath);
  if (info) return info.folder;
  return path.basename(path.dirname(String(filePath || '')));
}

/** The same path under the other filter folder (before <-> after), or null. */
function alternatePath(filePath) {
  if (!filePath) return null;
  const s = String(filePath);
  if (/before filter performer/i.test(s)) return s.replace(/before filter performer/i, 'after filter performer');
  if (/after filter performer/i.test(s)) return s.replace(/after filter performer/i, 'before filter performer');
  return null;
}

/** folders.path of the performer's library folder, or null. */
function libraryRootOf(performerId) {
  if (performerId == null) return null;
  const row = db.prepare('SELECT f.path FROM performers p JOIN folders f ON f.id = p.folder_id WHERE p.id = ?').get(performerId);
  return row && row.path ? row.path : null;
}

/** The performer's folder on disk as the server sees it, or null when she has no library folder. */
function performerDirOf(performer) {
  if (!performer || performer.folder_id == null) return null;
  const folder = db.prepare('SELECT * FROM folders WHERE id = ?').get(performer.folder_id);
  if (!folder || !folder.path) return null;
  return PathHelper.getPerformerPath(folder, performer);
}

let notifyFn = null;
function setNotify(fn) { notifyFn = typeof fn === 'function' ? fn : null; }
function notify(payload) {
  try { if (notifyFn) notifyFn(payload); } catch (err) { console.error('hash notify failed:', err.message); }
}

/** internal_duplicate_count = open items of her latest internal run whose file and keeper are both live. */
function recountInternal(performerId) {
  const p = db.prepare('SELECT latest_internal_run_id FROM performers WHERE id = ?').get(performerId);
  if (!p || !p.latest_internal_run_id) return null;
  const row = db.prepare(`
    SELECT COUNT(*) AS n FROM hash_run_items i
    JOIN performer_file_hashes s ON s.id = i.file_id_ref
    JOIN performer_file_hashes k ON k.id = i.candidate_id
    WHERE i.run_id = ? AND i.status = 'open' AND s.deleted_flag = 0 AND k.deleted_flag = 0
  `).get(p.latest_internal_run_id);
  const n = row ? row.n : 0;
  db.prepare('UPDATE performers SET internal_duplicate_count = ? WHERE id = ?').run(n, performerId);
  return n;
}

// ── media ──────────────────────────────────────────────────────

function ffmpegBin() { return process.env.FFMPEG_PATH || require('ffmpeg-static'); }
function ffprobeBin() { return process.env.FFPROBE_PATH || require('ffprobe-static').path; }

/** Run a program with an argument array (no shell); resolves { code, stdout } or rejects on error / timeout. */
function runProcess(bin, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(bin, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      reject(err);
      return;
    }
    let stdout = '';
    let stderr = '';
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      try { child.kill('SIGKILL'); } catch (_) { /* gone */ }
      reject(new Error(`${path.basename(bin)} timed out`));
    }, timeoutMs);
    child.stdout.on('data', (d) => { if (stdout.length < 1e6) stdout += d; });
    child.stderr.on('data', (d) => { if (stderr.length < 2e4) stderr += d; });
    child.on('error', (err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

async function probeDuration(videoPath) {
  try {
    const { code, stdout } = await runProcess(ffprobeBin(),
      ['-v', 'quiet', '-print_format', 'json', '-show_format', videoPath], PROBE_TIMEOUT_MS);
    if (code !== 0) return null;
    const d = parseFloat(JSON.parse(stdout).format.duration);
    return Number.isFinite(d) && d > 0 ? d : null;
  } catch (_) {
    return null;
  }
}

async function extractVideoFrame(videoPath, position = CONFIG.videoFramePosition) {
  const dir = path.join(os.tmpdir(), 'acm-hash-frames');
  await fsp.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `frame-${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.jpg`);
  try {
    const duration = await probeDuration(videoPath);
    const t = duration ? Math.max(0, duration * position) : 0;
    const { code } = await runProcess(ffmpegBin(),
      ['-y', '-v', 'error', '-nostdin', '-ss', String(t), '-i', videoPath, '-frames:v', '1', '-f', 'image2', '-q:v', '2', tmp],
      FRAME_TIMEOUT_MS);
    if (code !== 0) return null;
    return await fsp.readFile(tmp);
  } catch (_) {
    return null;
  } finally {
    await fsp.unlink(tmp).catch(() => { });
  }
}

function calculateExactHash(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash(CONFIG.hashAlgorithm);
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

/** dHash of a picture file or an image buffer: 9x8 greyscale, each pixel against its right neighbour, 16 hex. */
async function calculatePerceptualHash(input) {
  try {
    const px = await sharp(input, { failOn: 'none' })
      .resize(9, 8, { fit: 'fill' })
      .greyscale()
      .raw()
      .toBuffer();
    let hi = 0;
    let lo = 0;
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const idx = row * 9 + col;
        const bit = px[idx] < px[idx + 1] ? 1 : 0;
        const n = row * 8 + col;
        if (n < 32) hi = ((hi << 1) | bit) >>> 0;
        else lo = ((lo << 1) | bit) >>> 0;
      }
    }
    return hi.toString(16).padStart(8, '0') + lo.toString(16).padStart(8, '0');
  } catch (_) {
    return null;
  }
}

/** Hash one file: { file_size, mtime, exact_hash, perceptual_hash }; throws when the file cannot be read. */
async function hashFile(filePath, stat) {
  const type = mediaTypeOf(filePath);
  const result = {
    file_size: stat.size,
    mtime: Math.floor(stat.mtimeMs / 1000),
    exact_hash: await calculateExactHash(filePath),
    perceptual_hash: null,
  };
  if (type === 'pic') {
    result.perceptual_hash = await calculatePerceptualHash(filePath);
  } else if (type === 'vid') {
    const frame = await extractVideoFrame(filePath);
    if (frame) result.perceptual_hash = await calculatePerceptualHash(frame);
  }
  return result;
}

// ── hash build jobs ────────────────────────────────────────────

const activeJobs = new Map();

function publicJob(job) {
  if (!job) return null;
  const { promise, ...rest } = job;
  return { ...rest, failedFiles: [...(job.failedFiles || [])] };
}

function pruneJobs() {
  const cutoff = Date.now() - JOB_KEEP_MS;
  for (const [id, job] of activeJobs) {
    if (job.status !== 'running' && job.endTime && job.endTime < cutoff) activeJobs.delete(id);
  }
}

function runningJobFor(performerId) {
  const id = Number(performerId);
  for (const job of activeJobs.values()) {
    if (job.status === 'running' && Number(job.performerId) === id) return job;
  }
  return null;
}

/** Every picture and video under dir, skipping dot entries. A subfolder that cannot be read is reported, not fatal. */
async function scanFiles(dir, errors) {
  const files = [];
  async function walk(d, isRoot) {
    let entries;
    try {
      entries = await fsp.readdir(d, { withFileTypes: true });
    } catch (err) {
      if (isRoot) throw new Error(`Her folder cannot be read: ${dir}`);
      errors.push({ path: d, error: err.message });
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) await walk(full, false);
      else if (entry.isFile() && mediaTypeOf(entry.name)) files.push(full);
    }
  }
  await walk(dir, true);
  return files;
}

function addFailure(job, filePath, message) {
  job.failed += 1;
  if (job.failedFiles.length < 20) job.failedFiles.push({ path: filePath, error: message });
}

async function runHashJob(job, onProgress) {
  const { performerId, mode } = job;
  try {
    const performer = db.prepare('SELECT * FROM performers WHERE id = ?').get(performerId);
    if (!performer) throw new Error('Performer not found');
    const dir = performerDirOf(performer);
    if (!dir) throw new Error('Her folder cannot be read: no library folder is set');
    try {
      const st = await fsp.stat(dir);
      if (!st.isDirectory()) throw new Error('not a folder');
    } catch (_) {
      throw new Error(`Her folder cannot be read: ${dir}`);
    }

    const scanErrors = [];
    const files = await scanFiles(dir, scanErrors);
    for (const e of scanErrors) addFailure(job, e.path, `Folder could not be read: ${e.error}`);
    job.total = files.length;
    job.estimatedCount = files.length;

    const byPath = new Map();
    for (const row of db.prepare(`
      SELECT id, file_path, file_size, mtime, exact_hash, perceptual_hash, deleted_flag
      FROM performer_file_hashes WHERE performer_id = ?
    `).all(performerId)) byPath.set(row.file_path, row);

    const seen = new Set();
    const now = () => Math.floor(Date.now() / 1000);
    const insertStmt = db.prepare(`
      INSERT OR IGNORE INTO performer_file_hashes
        (performer_id, performer_name, file_path, file_size, mtime, exact_hash, perceptual_hash, seen_at, deleted_flag)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
    `);
    const updateByPathStmt = db.prepare(`
      UPDATE performer_file_hashes
      SET file_size = ?, mtime = ?, exact_hash = ?, perceptual_hash = ?, seen_at = ?, deleted_flag = 0
      WHERE performer_id = ? AND file_path = ?
    `);
    const updateByIdStmt = db.prepare(`
      UPDATE performer_file_hashes
      SET file_path = ?, file_size = ?, mtime = ?, exact_hash = ?, perceptual_hash = ?, seen_at = ?, deleted_flag = 0
      WHERE id = ?
    `);
    const touchStmt = db.prepare('UPDATE performer_file_hashes SET file_path = ?, seen_at = ?, deleted_flag = 0 WHERE id = ?');
    const writeBatch = db.transaction((results) => {
      const t = now();
      for (const r of results) {
        if (r.kind === 'skip') {
          touchStmt.run(r.filePath, t, r.rowId);
        } else if (r.kind === 'hashed' && r.rowId != null) {
          updateByIdStmt.run(r.filePath, r.hash.file_size, r.hash.mtime, r.hash.exact_hash, r.hash.perceptual_hash, t, r.rowId);
        } else if (r.kind === 'hashed') {
          const ins = insertStmt.run(performerId, performer.name, r.filePath, r.hash.file_size, r.hash.mtime,
            r.hash.exact_hash, r.hash.perceptual_hash, t);
          if (ins.changes === 0) {
            updateByPathStmt.run(r.hash.file_size, r.hash.mtime, r.hash.exact_hash, r.hash.perceptual_hash, t, performerId, r.filePath);
          }
        }
      }
    });

    async function processOne(filePath) {
      seen.add(filePath);
      try {
        const stat = await fsp.stat(filePath);
        const mtime = Math.floor(stat.mtimeMs / 1000);
        let row = byPath.get(filePath) || null;
        if (!row) {
          // stored under the other filter folder (she was moved): reuse that row instead of making a second one
          const alt = alternatePath(filePath);
          const altRow = alt ? byPath.get(alt) : null;
          if (altRow && altRow.deleted_flag !== 2 && !seen.has(alt)) {
            byPath.delete(alt);
            byPath.set(filePath, altRow);
            row = altRow;
          }
        }
        if (row && row.deleted_flag !== 2 && row.file_size === stat.size && row.mtime === mtime && row.exact_hash) {
          return { kind: 'skip', filePath, rowId: row.id };
        }
        const hash = await hashFile(filePath, stat);
        return { kind: 'hashed', filePath, rowId: row ? row.id : null, hash };
      } catch (err) {
        return { kind: 'failed', filePath, error: err.message };
      }
    }

    const step = CONFIG.workerConcurrency;
    for (let i = 0; i < files.length; i += step) {
      if (job.cancelRequested) throw new Error('Cancelled');
      const batch = files.slice(i, i + step);
      const results = await Promise.all(batch.map(processOne));
      writeBatch(results);
      for (const r of results) {
        if (r.kind === 'skip') job.skipped += 1;
        else if (r.kind === 'hashed') job.succeeded += 1;
        else addFailure(job, r.filePath, r.error);
      }
      job.processed += batch.length;
      job.hashCount = job.succeeded + job.skipped;
      if (onProgress) {
        try { onProgress(job.processed, job.total); } catch (_) { /* caller's problem */ }
      }
    }
    if (job.cancelRequested) throw new Error('Cancelled');

    if (files.length === 0 && mode === 'replace') {
      throw new Error(`No pictures or videos found in ${dir}; nothing changed`);
    }
    if (files.length > 0 && job.succeeded + job.skipped === 0) {
      throw new Error('No file could be read');
    }

    if (mode === 'replace') {
      if (scanErrors.length > 0) {
        job.warning = 'Some folders could not be read, so nothing was marked as deleted.';
      } else {
        const live = db.prepare('SELECT id, file_path FROM performer_file_hashes WHERE performer_id = ? AND deleted_flag = 0').all(performerId);
        const flag = db.prepare('UPDATE performer_file_hashes SET deleted_flag = 1 WHERE id = ? AND deleted_flag = 0');
        const gone = live.filter((r) => !seen.has(r.file_path));
        db.transaction(() => { for (const r of gone) flag.run(r.id); })();
        job.markedDeleted = gone.length;
      }
    }

    job.status = 'completed';
    job.endTime = Date.now();
    job.error = null;
    return { success: true, jobId: job.jobId, hashCount: job.hashCount, duration: job.endTime - job.startTime };
  } catch (err) {
    job.status = 'failed';
    job.endTime = Date.now();
    job.error = err.message;
    if (err.message !== 'Cancelled') console.error(`Hash build for performer ${performerId} failed:`, err.message);
    throw err;
  } finally {
    try { recountInternal(performerId); } catch (_) { /* best effort */ }
    notify({ performerId: Number(performerId), type: 'hash_updated' });
  }
}

/**
 * Build or update a performer's hash database. The folder comes from her record, never from the caller
 * (basePathIgnored is kept for the old signature). One running job per performer: a second call gets the running
 * job's promise. mode 'replace' flags rows of files that are gone as deleted (1) after a full scan.
 */
function createHashDB(performerId, basePathIgnored, jobId, mode = 'append', onProgress) {
  pruneJobs();
  const running = runningJobFor(performerId);
  if (running) return running.promise;
  const job = {
    jobId: jobId || crypto.randomBytes(16).toString('hex'),
    performerId: Number(performerId),
    mode: mode === 'replace' ? 'replace' : 'append',
    status: 'running',
    processed: 0,
    total: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    failedFiles: [],
    hashCount: 0,
    error: null,
    startTime: Date.now(),
    endTime: null,
    cancelRequested: false,
  };
  activeJobs.set(job.jobId, job);
  job.promise = runHashJob(job, onProgress);
  return job.promise;
}

function getJobStatus(jobId) {
  return publicJob(activeJobs.get(jobId));
}

function listJobs() {
  pruneJobs();
  return Array.from(activeJobs.values()).map(publicJob);
}

function cancelJob(jobId) {
  const job = activeJobs.get(jobId);
  if (!job) return null;
  if (job.status === 'running') job.cancelRequested = true;
  return publicJob(job);
}

// ── duplicate checks ───────────────────────────────────────────

const yieldLoop = () => new Promise((r) => setImmediate(r));

/**
 * Check a performer against another (or herself when the ids are equal: use checkInternalDuplicates for that).
 * Returns { runId, groupCount, itemCount, exact, similar }.
 */
async function checkDuplicates(sourcePerformerId, targetPerformerId) {
  const sourceId = Number(sourcePerformerId);
  const targetId = Number(targetPerformerId);
  if (!Number.isInteger(sourceId) || !Number.isInteger(targetId)) {
    throw new HashError(400, 'bad_request', 'source_performer_id and target_performer_id are required');
  }
  const internal = sourceId === targetId;
  const performerStmt = db.prepare('SELECT id, name FROM performers WHERE id = ?');
  const source = performerStmt.get(sourceId);
  const target = internal ? source : performerStmt.get(targetId);
  if (!source || !target) throw new HashError(404, 'performer_not_found', 'Performer not found');

  const rowsStmt = db.prepare(`
    SELECT id, performer_id, file_path, file_size, mtime, exact_hash, perceptual_hash, deleted_flag
    FROM performer_file_hashes WHERE performer_id = ? AND deleted_flag IN (0, 1)
  `);
  const sourceRows = rowsStmt.all(sourceId);
  if (!sourceRows.some((r) => r.deleted_flag === 0)) {
    throw new HashError(409, 'no_hashes', `${source.name} has no hash database yet. Build it first.`, { performerId: sourceId });
  }
  const targetRows = internal ? sourceRows : rowsStmt.all(targetId);
  if (!internal && !targetRows.some((r) => r.deleted_flag === 0)) {
    throw new HashError(409, 'no_hashes', `${target.name} has no hash database yet. Build it first.`, { performerId: targetId });
  }

  const runId = internal ? `internal-${sourceId}-${Date.now()}` : crypto.randomBytes(16).toString('hex');
  const startTime = Date.now();
  db.prepare(`INSERT INTO hash_runs (run_id, source_performer_id, target_performer_id, status, metadata) VALUES (?, ?, ?, 'pending', ?)`)
    .run(runId, sourceId, targetId, JSON.stringify({ startTime }));

  try {
    const probeStmt = db.prepare('SELECT size, duration FROM media_probe WHERE path = ?');
    const prepare = (row, side) => {
      const type = mediaTypeOf(row.file_path);
      if (!type) return null;
      let ph = parsePhash(row.perceptual_hash);
      if (ph && (ph.bits < 4 || ph.bits > 60)) ph = null; // blank / near-uniform frame: says nothing
      let dur = null;
      if (type === 'vid') {
        try {
          const p = probeStmt.get(row.file_path);
          if (p && p.size === row.file_size && p.duration > 0) dur = p.duration;
        } catch (_) { /* no probe */ }
      }
      return {
        id: row.id, side, type, row, ph, dur,
        flag: row.deleted_flag, exact: row.exact_hash || null,
        size: row.file_size || 0, mtime: row.mtime == null ? Infinity : row.mtime,
        assigned: false, group: null,
      };
    };
    const entries = [];
    if (internal) {
      for (const r of sourceRows) { const e = prepare(r, 'source'); if (e) entries.push(e); }
    } else {
      for (const r of sourceRows) { const e = prepare(r, 'source'); if (e) entries.push(e); }
      for (const r of targetRows) { const e = prepare(r, 'target'); if (e) entries.push(e); }
    }

    const priority = (a, b) => {
      if (a.flag !== b.flag) return a.flag - b.flag;
      if (!internal && a.side !== b.side) return a.side === 'target' ? -1 : 1;
      if (a.size !== b.size) return b.size - a.size;
      // same size: a name that looks like a copy ("copy of x", "x (1)", "x - Copy") is not the keeper
      const ca = looksLikeCopy(a.row.file_path);
      const cb = looksLikeCopy(b.row.file_path);
      if (ca !== cb) return ca ? 1 : -1;
      if (a.mtime !== b.mtime) return a.mtime < b.mtime ? -1 : 1;
      return a.id - b.id;
    };
    const isCandidate = (e) => internal || e.side === 'target';
    const isRemovableSide = (e) => internal || e.side === 'source';

    // (a) exact buckets
    const groups = [];
    const buckets = new Map();
    for (const e of entries) {
      if (!e.exact) continue;
      const key = `${e.type}:${e.exact}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(e);
    }
    for (const bucket of buckets.values()) {
      if (bucket.length < 2) continue;
      if (!internal && !(bucket.some((e) => e.side === 'source') && bucket.some((e) => e.side === 'target'))) continue;
      const group = { members: bucket.slice(), seed: null };
      const seeds = bucket.filter(isCandidate).sort(priority);
      group.seed = seeds[0];
      for (const e of bucket) { e.assigned = true; e.group = group; }
      groups.push(group);
    }

    // (b) perceptual: each seed collects the unassigned files directly within distance 9 of it
    const seeds = [];
    for (const g of groups) seeds.push(g.seed);
    for (const e of entries) if (!e.assigned && isCandidate(e)) seeds.push(e);
    seeds.sort(priority);

    const pools = { pic: [], vid: [] };
    for (const e of entries) {
      if (!e.ph || (!internal && e.side !== 'source')) continue;
      pools[e.type].push(e);
    }
    const poolArrays = {};
    for (const type of Object.keys(pools)) {
      const list = pools[type];
      const hi = new Uint32Array(list.length);
      const lo = new Uint32Array(list.length);
      list.forEach((e, i) => { hi[i] = e.ph.hi; lo[i] = e.ph.lo; });
      poolArrays[type] = { list, hi, lo };
    }

    let n = 0;
    for (const seed of seeds) {
      if (++n % 250 === 0) await yieldLoop();
      if (!seed.ph) continue;
      // an exact group's seed collects for its group; any other file that is already in a group is no seed
      const ownGroup = seed.group && seed.group.seed === seed ? seed.group : null;
      if (!ownGroup && seed.assigned) continue;
      const pool = poolArrays[seed.type];
      if (!pool) continue;
      const wasAssigned = seed.assigned;
      seed.assigned = true;
      const attached = [];
      const { list, hi, lo } = pool;
      const sh = seed.ph.hi;
      const sl = seed.ph.lo;
      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        if (e.assigned) continue;
        const d = popcount32(hi[i] ^ sh) + popcount32(lo[i] ^ sl);
        if (d > CONFIG.maxDistance) continue;
        if (seed.type === 'vid' && seed.dur && e.dur) {
          const tol = Math.max(2, 0.02 * Math.max(seed.dur, e.dur));
          if (Math.abs(seed.dur - e.dur) > tol) continue;
        }
        e.assigned = true;
        attached.push(e);
      }
      if (ownGroup) {
        for (const e of attached) { e.group = ownGroup; ownGroup.members.push(e); }
      } else if (attached.length > 0) {
        const group = { members: [seed, ...attached], seed };
        for (const e of group.members) e.group = group;
        groups.push(group);
      } else {
        seed.assigned = wasAssigned;
      }
    }

    // keepers and items
    const items = [];
    let groupCount = 0;
    for (const g of groups) {
      const candidates = g.members.filter(isCandidate).sort(priority);
      if (candidates.length === 0) continue;
      let keeper = candidates[0];
      const live = g.members.filter((e) => e.flag === 0);
      if (live.length === 1 && live[0] === keeper) {
        const before = candidates.find((e) => e.flag === 1);
        if (before) keeper = before;
      }
      const others = g.members.filter((e) => e !== keeper);
      if (!others.some((e) => e.flag === 0 && isRemovableSide(e))) continue;
      groupCount += 1;
      const keeperPh = parsePhash(keeper.row.perceptual_hash);
      for (const e of others) {
        const exact = e.exact && keeper.exact && e.exact === keeper.exact ? 1 : 0;
        const ph = parsePhash(e.row.perceptual_hash);
        const dist = ph && keeperPh ? phashDistance(ph, keeperPh) : null;
        const auto = exact === 1 && keeper.flag === 0 && e.flag === 0 && isRemovableSide(e);
        items.push({
          file_path: e.row.file_path, file_id_ref: e.id, candidate_id: keeper.id,
          exact_match: exact, hamming_distance: dist, selected: auto ? 1 : 0, selected_by: auto ? 'auto' : null,
        });
      }
    }

    const insert = db.prepare(`
      INSERT INTO hash_run_items (run_id, file_path, file_id_ref, candidate_id, exact_match, hamming_distance, selected, selected_by, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open')
    `);
    const exactCount = items.filter((i) => i.exact_match === 1).length;
    const metadata = { startTime, endTime: Date.now(), groups: groupCount, items: items.length, actions: [] };
    db.transaction(() => {
      for (const it of items) {
        insert.run(runId, it.file_path, it.file_id_ref, it.candidate_id, it.exact_match, it.hamming_distance, it.selected, it.selected_by);
      }
      db.prepare(`UPDATE hash_runs SET status = 'completed', metadata = ? WHERE run_id = ?`).run(JSON.stringify(metadata), runId);
    })();

    // a re-check replaces the older runs of the same pair (held removals are per performer, nothing is lost)
    const older = db.prepare('SELECT run_id FROM hash_runs WHERE source_performer_id = ? AND target_performer_id = ? AND run_id != ?')
      .all(sourceId, targetId, runId);
    if (older.length > 0) {
      const delItems = db.prepare('DELETE FROM hash_run_items WHERE run_id = ?');
      const delRun = db.prepare('DELETE FROM hash_runs WHERE run_id = ?');
      db.transaction(() => { for (const r of older) { delItems.run(r.run_id); delRun.run(r.run_id); } })();
    }

    if (!internal) notify({ performerId: sourceId, type: 'hash_updated' }); // internal: after the recount
    return { success: true, runId, groupCount, itemCount: items.length, exact: exactCount, similar: items.length - exactCount };
  } catch (err) {
    console.error('Duplicate check failed:', err);
    try {
      db.prepare(`UPDATE hash_runs SET status = 'failed', metadata = ? WHERE run_id = ?`)
        .run(JSON.stringify({ startTime, endTime: Date.now(), error: err.message }), runId);
    } catch (_) { /* the run row is gone */ }
    throw err;
  }
}

/** A performer against herself: also sets latest_internal_run_id, resets hash_verified and recounts. */
async function checkInternalDuplicates(performerId) {
  const id = Number(performerId);
  const result = await checkDuplicates(id, id);
  db.prepare('UPDATE performers SET latest_internal_run_id = ?, hash_verified = 0 WHERE id = ?').run(result.runId, id);
  const duplicateCount = recountInternal(id) || 0;
  notify({ performerId: id, type: 'hash_updated' });
  return { ...result, duplicateCount };
}

function setHashVerified(performerId, verified) {
  db.prepare('UPDATE performers SET hash_verified = ? WHERE id = ?').run(verified ? 1 : 0, performerId);
  return { success: true, verified: !!verified };
}

function getPerformerHashStatus(performerId) {
  const p = db.prepare('SELECT hash_verified, latest_internal_run_id, internal_duplicate_count FROM performers WHERE id = ?').get(performerId);
  const counts = db.prepare(`
    SELECT SUM(CASE WHEN deleted_flag = 0 THEN 1 ELSE 0 END) AS live,
           SUM(CASE WHEN deleted_flag = 1 THEN 1 ELSE 0 END) AS deleted,
           MAX(seen_at) AS last_seen
    FROM performer_file_hashes WHERE performer_id = ?
  `).get(performerId) || {};
  const job = runningJobFor(performerId);
  return {
    hash_verified: p ? p.hash_verified || 0 : 0,
    latest_internal_run_id: p ? p.latest_internal_run_id || null : null,
    internal_duplicate_count: p ? p.internal_duplicate_count || 0 : 0,
    file_count: counts.live || 0,
    deleted_count: counts.deleted || 0,
    last_updated: counts.last_seen ? new Date(counts.last_seen * 1000).toISOString() : null,
    job: job ? { jobId: job.jobId, status: job.status, processed: job.processed, total: job.total } : null,
  };
}

function resetHashVerified(performerId) {
  db.prepare('UPDATE performers SET hash_verified = 0 WHERE id = ?').run(performerId);
}

module.exports = {
  CONFIG,
  HashError,
  createHashDB,
  getJobStatus,
  listJobs,
  cancelJob,
  runningJobFor,
  checkDuplicates,
  checkInternalDuplicates,
  hammingDistance,
  setHashVerified,
  getPerformerHashStatus,
  resetHashVerified,
  mediaTypeOf,
  isPlayable,
  parsePhash,
  phashDistance,
  popcount32,
  similarityOf,
  performerOfPath,
  folderOf,
  alternatePath,
  libraryRootOf,
  performerDirOf,
  recountInternal,
  setNotify,
  notify,
};
