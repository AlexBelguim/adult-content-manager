const { spawn } = require('child_process');
const fs = require('fs-extra');
const sharp = require('sharp');

/**
 * Pixel dimensions (and video duration) for gallery files.
 *
 * Field contract on a file entry:
 *   absent      -> not probed yet
 *   null        -> probed, file unreadable / value unknown (not retried until the cache row is rebuilt)
 *   number      -> display dimensions in px (EXIF / rotation already applied), duration in seconds
 */

const IMAGE_CONCURRENCY = 8;
const VIDEO_CONCURRENCY = 3;
const FFPROBE_TIMEOUT_MS = 30000;
const CHECKPOINT_EVERY = 400; // entries probed between cache-row rewrites during a backfill

// path -> { size, modified, width, height, duration } for callers without a persistent cache (routes/gallery.js)
const memo = new Map();
const MEMO_MAX = 50000;
const memoInFlight = new Set();

// `${performerId}:${type}` of backfills currently running
const runningBackfills = new Set();

function memoSet(filePath, value) {
  if (memo.size >= MEMO_MAX) memo.delete(memo.keys().next().value);
  memo.set(filePath, value);
}

async function probeImage(filePath) {
  try {
    const meta = await sharp(filePath).metadata();
    if (!meta || !meta.width || !meta.height) return null;
    // EXIF orientation 5-8 = rotated by 90/270 degrees: displayed size is swapped
    const swap = meta.orientation >= 5;
    return { width: swap ? meta.height : meta.width, height: swap ? meta.width : meta.height };
  } catch (e) {
    return null;
  }
}

function probeVideo(filePath) {
  return new Promise((resolve) => {
    let ffprobePath;
    try { ffprobePath = require('ffprobe-static').path; } catch (e) { return resolve(null); }

    let child;
    try {
      child = spawn(ffprobePath, [
        '-v', 'error',
        '-select_streams', 'v:0',
        // full stream dump: the bundled ffprobe (4.x) cannot select side data via -show_entries
        '-show_streams', '-show_format',
        '-of', 'json',
        filePath
      ]);
    } catch (e) {
      return resolve(null);
    }

    let out = '';
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => { child.kill(); finish(null); }, FFPROBE_TIMEOUT_MS);

    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', () => {});
    child.on('error', () => finish(null));
    child.on('close', () => {
      try {
        const json = JSON.parse(out);
        const stream = json.streams && json.streams[0];
        if (!stream || !stream.width || !stream.height) return finish(null);

        let rotation = 0;
        if (stream.tags && stream.tags.rotate !== undefined) rotation = parseInt(stream.tags.rotate, 10) || 0;
        const sideData = (stream.side_data_list || []).find(s => s.rotation !== undefined);
        if (sideData) rotation = parseInt(sideData.rotation, 10) || 0;
        const swap = Math.abs(rotation) % 180 === 90;

        let duration = parseFloat(json.format && json.format.duration);
        if (!(duration > 0)) duration = parseFloat(stream.duration);

        finish({
          width: swap ? stream.height : stream.width,
          height: swap ? stream.width : stream.height,
          duration: duration > 0 ? duration : null
        });
      } catch (e) {
        finish(null);
      }
    });
  });
}

function needsEnrichment(entries) {
  return entries.some(e => e.width === undefined || e.size === undefined || e.modified === undefined);
}

/**
 * Fill size/modified (stat) and width/height(/duration) on entries that lack them. Mutates the entries.
 * @param {Array<{path:string}>} entries
 * @param {'image'|'video'} kind
 * @param {{budgetMs?:number}} [options] stop picking up new entries once the budget is spent;
 *   whatever was not reached keeps its fields absent.
 * @returns {Promise<number>} number of entries touched
 */
async function enrichEntries(entries, kind, options = {}) {
  const deadline = options.budgetMs !== undefined ? Date.now() + options.budgetMs : Infinity;
  const todo = entries.filter(e => e.width === undefined || e.size === undefined || e.modified === undefined);
  let next = 0;
  let touched = 0;

  async function worker() {
    while (next < todo.length && Date.now() < deadline) {
      const entry = todo[next++];
      try {
        if (entry.size === undefined || entry.modified === undefined) {
          const stat = await fs.stat(entry.path).catch(() => null);
          entry.size = stat ? stat.size : null;
          entry.modified = stat ? stat.mtime.getTime() : null;
        }
        if (entry.width === undefined) {
          const probed = kind === 'video' ? await probeVideo(entry.path) : await probeImage(entry.path);
          entry.width = probed ? probed.width : null;
          entry.height = probed ? probed.height : null;
          if (kind === 'video') entry.duration = probed ? probed.duration : null;
        }
      } catch (e) {
        if (entry.width === undefined) { entry.width = null; entry.height = null; }
        if (kind === 'video' && entry.duration === undefined) entry.duration = null;
      }
      touched++;
    }
  }

  const concurrency = kind === 'video' ? VIDEO_CONCURRENCY : IMAGE_CONCURRENCY;
  await Promise.all(Array.from({ length: Math.min(concurrency, todo.length) }, worker));
  return touched;
}

const MEDIA_FIELDS = ['size', 'modified', 'width', 'height', 'duration'];

// Copy probed fields onto the cache row as it is NOW (it may have been rebuilt while we were probing).
// Returns false when the row is gone, i.e. the cache was invalidated and must not be resurrected.
function mergeIntoCacheRow(db, performerId, type, probedEntries) {
  const row = db.prepare('SELECT data FROM performer_file_cache WHERE performer_id = ? AND type = ?').get(performerId, type);
  if (!row) return false;

  const byPath = new Map(probedEntries.map(e => [e.path, e]));
  const current = JSON.parse(row.data);
  for (const entry of current) {
    const probed = byPath.get(entry.path);
    if (!probed) continue;
    for (const field of MEDIA_FIELDS) {
      if (entry[field] === undefined && probed[field] !== undefined) entry[field] = probed[field];
    }
  }
  db.prepare('UPDATE performer_file_cache SET data = ? WHERE performer_id = ? AND type = ?')
    .run(JSON.stringify(current), performerId, type);
  return true;
}

/**
 * Fire-and-forget: probe whatever the cached list for performer+type is missing and rewrite the row.
 * No-op when nothing is missing or the same backfill is already running.
 * @param {object} db better-sqlite3 handle
 * @param {string|number} performerId
 * @param {'pics'|'vids'} type
 * @param {Array} entries parsed cache blob (not mutated)
 */
function backfillCacheInBackground(db, performerId, type, entries) {
  const key = `${performerId}:${type}`;
  if (runningBackfills.has(key) || !needsEnrichment(entries)) return false;
  runningBackfills.add(key);

  const kind = type === 'vids' ? 'video' : 'image';
  const tag = type === 'vids' ? 'gallery/videos' : 'gallery/images';
  const startTime = Date.now();
  const pending = entries
    .filter(e => e.width === undefined || e.size === undefined || e.modified === undefined)
    .map(e => ({ ...e }));

  (async () => {
    try {
      for (let i = 0; i < pending.length; i += CHECKPOINT_EVERY) {
        const chunk = pending.slice(i, i + CHECKPOINT_EVERY);
        await enrichEntries(chunk, kind);
        if (!mergeIntoCacheRow(db, performerId, type, chunk)) {
          console.log(`[${tag}] Dimension backfill for performer ${performerId} stopped: cache row was cleared`);
          return;
        }
      }
      console.log(`[${tag}] Dimension backfill for performer ${performerId} took ${Date.now() - startTime}ms for ${pending.length} files`);
    } catch (err) {
      console.error(`[${tag}] Dimension backfill failed for performer ${performerId}:`, err.message);
    } finally {
      runningBackfills.delete(key);
    }
  })();

  return true;
}

/**
 * For code that rebuilds a cache row from a bare directory listing: keep the width/height/duration
 * already probed for paths that still exist. size/modified are deliberately NOT carried over, so the
 * next gallery load re-stats them.
 */
function carryOverDimensions(db, performerId, type, newEntries) {
  try {
    const row = db.prepare('SELECT data FROM performer_file_cache WHERE performer_id = ? AND type = ?').get(performerId, type);
    if (!row) return newEntries;
    const old = new Map(JSON.parse(row.data).map(e => [e.path, e]));
    return newEntries.map((entry) => {
      const prev = old.get(entry.path);
      if (!prev || typeof prev.width !== 'number') return entry;
      const merged = { ...entry, width: prev.width, height: prev.height };
      if (prev.duration !== undefined) merged.duration = prev.duration;
      return merged;
    });
  } catch (e) {
    return newEntries;
  }
}

/**
 * For responses built from a live directory scan (no persistent cache): attach dimensions already
 * known in memory, and probe the rest in the background so the next request has them.
 * Never blocks. `getPath(item)` returns the media file's absolute path.
 * @param {Array} items
 * @param {'image'|'video'} kind
 * @param {(item:object)=>string} getPath
 */
function attachKnownDimensions(items, kind, getPath) {
  const missing = [];
  for (const item of items) {
    const filePath = getPath(item);
    if (!filePath) continue;
    const isVideo = kind === 'video';
    const modified = item.modified instanceof Date ? item.modified.getTime() : item.modified;
    const known = memo.get(filePath);
    if (known && known.size === item.size && known.modified === modified) {
      item.width = known.width;
      item.height = known.height;
      if (isVideo && item.duration === undefined && known.duration != null) item.duration = known.duration;
    } else if (!memoInFlight.has(filePath)) {
      memoInFlight.add(filePath);
      missing.push({ path: filePath, size: item.size, modified });
    }
  }
  if (!missing.length) return;

  (async () => {
    try {
      await enrichEntries(missing, kind);
      for (const m of missing) {
        memoSet(m.path, { size: m.size, modified: m.modified, width: m.width, height: m.height, duration: m.duration });
      }
    } catch (e) {
      // best effort
    } finally {
      for (const m of missing) memoInFlight.delete(m.path);
    }
  })();
}

module.exports = {
  probeImage,
  probeVideo,
  needsEnrichment,
  enrichEntries,
  backfillCacheInBackground,
  carryOverDimensions,
  attachKnownDimensions
};
