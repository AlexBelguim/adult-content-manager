/**
 * What every video in the library is (media_probe, migration 016): codec, bitrate, fps, bit depth, size on screen,
 * length and its tracks, from ffprobe. The Space page and the re-encode queue (encodeQueue.js) read only this.
 *
 * A background scan walks every base folder's `before filter performer`, `after filter performer` and `content`
 * trees — every level, so vids/funscript/<scene>/ and the genres' own sub-folders too — and probes what's new or
 * changed (by size and mtime), two files at a time, biggest first. Dot folders (.cache, .originals …) are skipped. It
 * runs a little after start, every six hours, and when asked (Space → Rescan); a request never waits for it.
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const db = require('../db');

const VIDEO_EXTS = new Set(['.mp4', '.m4v', '.mov', '.mkv', '.avi', '.wmv', '.flv', '.webm', '.ts', '.m2ts', '.mts',
  '.mpg', '.mpeg', '.3gp', '.asf', '.divx', '.ogv', '.vob']);
const SUBS = ['before filter performer', 'after filter performer', 'content'];
const PROBE_CONCURRENCY = 2;
const PROBE_TIMEOUT_MS = 60000;
const RESCAN_MS = 6 * 60 * 60 * 1000;

const ffprobePath = () => process.env.FFPROBE_PATH || require('ffprobe-static').path;

const state = { running: false, startedAt: null, finishedAt: null, files: 0, toProbe: 0, probed: 0, error: null };
const listeners = new Set();   // called after a scan finished: the Space page's numbers are stale

const isVideo = (name) => VIDEO_EXTS.has(path.extname(name).toLowerCase());

function runProbe(file) {
  return new Promise((resolve, reject) => {
    let out = '';
    let err = '';
    const child = spawn(ffprobePath(), ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], { windowsHide: true });
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('ffprobe took too long')); }, PROBE_TIMEOUT_MS);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err = (err + d).slice(-2000); });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(err.trim().split('\n').pop() || `ffprobe exited ${code}`));
      try { resolve(JSON.parse(out)); } catch (e) { reject(new Error('ffprobe gave no JSON')); }
    });
  });
}

const rate = (r) => {
  const [a, b] = String(r || '').split('/').map(Number);
  return a > 0 && b > 0 ? a / b : null;
};
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};
const COVER = new Set(['mjpeg', 'png', 'bmp', 'gif', 'webp']);

/**
 * One file as the queue reads it: { container, duration, width, height (as shown: a rotated phone video is portrait),
 * bitrate (overall, b/s), video_codec, video_bitrate, fps, bit_depth, pix_fmt, streams: [{ index, type, codec,
 * channels, title, cover }] }.
 */
async function probeFile(file) {
  const j = await runProbe(file);
  const streams = (j.streams || []).map(s => ({
    index: s.index,
    type: s.codec_type || 'unknown',
    codec: String(s.codec_name || '').toLowerCase() || null,
    channels: s.channels || null,
    title: s.tags?.title || s.tags?.TITLE || null,
    cover: s.codec_type === 'video' && (s.disposition?.attached_pic === 1 || COVER.has(String(s.codec_name || '').toLowerCase())),
  }));
  const raw = (j.streams || []).find(s => s.codec_type === 'video' && s.disposition?.attached_pic !== 1 && !COVER.has(String(s.codec_name || '').toLowerCase()));
  let width = raw?.width || null;
  let height = raw?.height || null;
  let rotation = 0;
  if (raw?.tags?.rotate !== undefined) rotation = parseInt(raw.tags.rotate, 10) || 0;
  const side = (raw?.side_data_list || []).find(s => s.rotation !== undefined);
  if (side) rotation = parseInt(side.rotation, 10) || 0;
  if (Math.abs(rotation) % 180 === 90) [width, height] = [height, width];
  const pixDepth = /(\d+)(le|be)$/.exec(raw?.pix_fmt || '');
  const depth = num(raw?.bits_per_raw_sample) || (pixDepth ? Number(pixDepth[1]) : raw ? 8 : null);
  const tagBps = raw?.tags ? num(raw.tags.BPS || raw.tags['BPS-eng']) : null;
  return {
    container: (j.format?.format_name || '').split(',')[0] || null,
    duration: num(j.format?.duration) || num(raw?.duration),
    size: num(j.format?.size),
    width, height,
    bitrate: num(j.format?.bit_rate),
    video_codec: raw ? String(raw.codec_name || '').toLowerCase() : null,
    video_bitrate: num(raw?.bit_rate) || tagBps,
    fps: rate(raw?.avg_frame_rate) || rate(raw?.r_frame_rate),
    bit_depth: depth,
    pix_fmt: raw?.pix_fmt || null,
    streams,
  };
}

const upsertSeen = () => db.prepare(`
  INSERT INTO media_probe (path, size, mtime, seen_at) VALUES (@path, @size, @mtime, @seen)
  ON CONFLICT(path) DO UPDATE SET
    probed_at = CASE WHEN media_probe.size = excluded.size AND media_probe.mtime = excluded.mtime THEN media_probe.probed_at ELSE NULL END,
    error     = CASE WHEN media_probe.size = excluded.size AND media_probe.mtime = excluded.mtime THEN media_probe.error ELSE NULL END,
    size = excluded.size, mtime = excluded.mtime, seen_at = excluded.seen_at
`);

function store(file, size, mtime, p, error) {
  db.prepare(`
    INSERT INTO media_probe (path, size, mtime, seen_at, probed_at, error, container, duration, width, height, bitrate, video_codec,
      video_bitrate, fps, bit_depth, pix_fmt, streams)
    VALUES (@path, @size, @mtime, @now, @now, @error, @container, @duration, @width, @height, @bitrate, @video_codec,
      @video_bitrate, @fps, @bit_depth, @pix_fmt, @streams)
    ON CONFLICT(path) DO UPDATE SET size = excluded.size, mtime = excluded.mtime, probed_at = excluded.probed_at, error = excluded.error,
      container = excluded.container, duration = excluded.duration, width = excluded.width, height = excluded.height,
      bitrate = excluded.bitrate, video_codec = excluded.video_codec, video_bitrate = excluded.video_bitrate, fps = excluded.fps,
      bit_depth = excluded.bit_depth, pix_fmt = excluded.pix_fmt, streams = excluded.streams, seen_at = excluded.seen_at
  `).run({
    path: file, size, mtime, now: Date.now(), error: error || null,
    container: p?.container ?? null, duration: p?.duration ?? null, width: p?.width ?? null, height: p?.height ?? null,
    bitrate: p?.bitrate ?? null, video_codec: p?.video_codec ?? null, video_bitrate: p?.video_bitrate ?? null, fps: p?.fps ?? null,
    bit_depth: p?.bit_depth ?? null, pix_fmt: p?.pix_fmt ?? null, streams: p ? JSON.stringify(p.streams) : null,
  });
}

/** Probe one file now and keep what it says (after the queue swapped a new file in, or put the original back). */
async function refresh(file) {
  let st;
  try { st = fs.statSync(file); } catch { db.prepare('DELETE FROM media_probe WHERE path = ?').run(file); return null; }
  try {
    const p = await probeFile(file);
    store(file, st.size, Math.round(st.mtimeMs), p, null);
    return p;
  } catch (e) {
    store(file, st.size, Math.round(st.mtimeMs), null, e.message);
    return null;
  }
}

const forget = (file) => db.prepare('DELETE FROM media_probe WHERE path = ?').run(file);

/** Every video under a folder, every level down; dot folders and dot files left out. */
async function walk(dir, out) {
  let entries;
  try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return false; }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await walk(p, out);
    else if (e.isFile() && isVideo(e.name)) {
      try {
        const st = await fs.promises.stat(p);
        out.push({ path: p, size: st.size, mtime: Math.round(st.mtimeMs) });
      } catch { /* gone meanwhile */ }
    }
  }
  return true;
}

async function probeAll(rows) {
  let next = 0;
  const one = async () => {
    while (next < rows.length) {
      const r = rows[next++];
      try {
        const p = await probeFile(r.path);
        store(r.path, r.size, r.mtime, p, null);
      } catch (e) {
        store(r.path, r.size, r.mtime, null, e.message);
      }
      state.probed += 1;
    }
  };
  await Promise.all(Array.from({ length: Math.min(PROBE_CONCURRENCY, rows.length) }, one));
}

/** Walk the library, note what's there, probe what's new or changed. One at a time; a second ask while it runs is a no-op. */
async function scan() {
  if (state.running) return state;
  Object.assign(state, { running: true, startedAt: Date.now(), finishedAt: null, files: 0, toProbe: 0, probed: 0, error: null });
  try {
    const stamp = Date.now();
    const seen = upsertSeen();
    const drop = db.prepare('DELETE FROM media_probe WHERE substr(path, 1, length(@dir)) = @dir AND seen_at < @stamp');
    for (const { path: base } of db.prepare('SELECT path FROM folders').all()) {
      for (const sub of SUBS) {
        const dir = path.join(base, sub);
        const files = [];
        if (!(await walk(dir, files))) continue;   // not there (or the share is down): its rows stay as they were
        db.transaction(() => {
          for (const f of files) seen.run({ ...f, seen: stamp });
          drop.run({ dir: dir + path.sep, stamp });
        })();
        state.files += files.length;
      }
    }
    const todo = db.prepare('SELECT path, size, mtime FROM media_probe WHERE probed_at IS NULL ORDER BY size DESC').all();
    state.toProbe = todo.length;
    await probeAll(todo);
  } catch (e) {
    state.error = e.message;
    console.error('[space] library scan failed:', e.message);
  } finally {
    state.running = false;
    state.finishedAt = Date.now();
    for (const fn of listeners) { try { fn(); } catch { /* a listener's own trouble */ } }
  }
  return state;
}

const scanInBackground = () => { scan().catch(() => {}); return status(); };

function status() {
  const c = db.prepare('SELECT COUNT(*) AS n, SUM(probed_at IS NULL) AS unprobed, SUM(error IS NOT NULL) AS errors FROM media_probe').get();
  return { ...state, known: c.n || 0, unprobed: c.unprobed || 0, errors: c.errors || 0 };
}

let timer = null;
function startScanner({ delayMs = 20000 } = {}) {
  if (timer) return;
  setTimeout(scanInBackground, delayMs).unref?.();
  timer = setInterval(scanInBackground, RESCAN_MS);
  timer.unref?.();
}

module.exports = {
  VIDEO_EXTS, isVideo, probeFile, refresh, forget, scan, scanInBackground, status, startScanner,
  onScanned: (fn) => listeners.add(fn),
};
