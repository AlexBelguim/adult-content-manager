/**
 * The re-encode queue: library videos made smaller, for good (Settings → Space). Modelled on Hikari's transcode
 * queue (server/lib/transcodeQueue.js), with ACM's rules:
 *
 *   video   always HEVC 10-bit: x265 medium CRF 20 on a CPU, hevc_nvenc p6 cq 22 main10 on an NVIDIA card; never
 *           above 10 Mb/s, and a picture bigger than 1080p (its short side) scaled to 1080p.
 *   audio   every track kept. Only what a browser can't play (AC3, E-AC3, DTS, TrueHD, PCM, WMA, MP2 …) becomes AAC
 *           with the same channels, 7.1 down to 5.1.
 *   subs    every track kept: copied, or made mov_text in an MP4.
 *   file    an MP4 / M4V / MOV stays one under its own name, an MKV stays an MKV; anything else (AVI, WMV, FLV, WebM,
 *           TS, MPEG …) becomes an .mp4 next to where it was, and every record of the old path follows it.
 *
 * Which files: everything but HEVC (HEVC only far above the cap); AV1, VP9 and the old codecs count. Never the
 * queue's own output, a file it already failed to shrink, one whose re-encode was undone, or a VR video (scaled to
 * 1080p it would lose its resolution). A file is
 * queued only when the estimate says it comes out at least a fifth smaller, and the new file is thrown away when it
 * isn't really at least 5% smaller. The estimate is from the file's length, bitrate and height, kept with each job and
 * corrected by the median of new size / estimate over the last 40 jobs, from 3 on.
 *
 * Who encodes: a worker on another machine (the GPU PC) that took a link from Settings → Space and calls in over
 * HTTP (routes/workers.js, Hikari's worker protocol: one worker program serves both apps), or this server's own
 * ffmpeg on the CPU — by default only while no linked worker is online (worker_mode auto | local | remote).
 *
 * The new file is written to <base folder>/.originals/tmp, on the same share, checked — as long as the original,
 * every track there — and only then swapped in. The original is held in <base folder>/.originals/<job id>/… for 14
 * days, with Undo, and then deleted. Pause freezes an encode where it is (the process suspended, not killed).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const db = require('../db');
const probe = require('./mediaProbe');
const { suspendProcess, resumeProcess } = require('../utils/suspend');

const HOLD_DAYS = 14;
const DAY = 86400000;
const WORK_DIR = '.originals';
const VIDEO_OK = new Set(['h264', 'hevc']);
const AUDIO_OK_MP4 = new Set(['aac', 'mp3', 'opus', 'flac']);
const AUDIO_OK_MKV = new Set([...AUDIO_OK_MP4, 'vorbis']);
const SUB_TEXT = new Set(['subrip', 'srt', 'ass', 'ssa', 'webvtt', 'mov_text', 'text']);
const SUB_DROP = new Set(['arib_caption', 'eia_608']);
const MP4_EXTS = new Set(['.mp4', '.m4v', '.mov']);
const CODEC_WORDS = /truehd|atmos|dts|e-?ac-?3|ac-?3|dolby|dd\+?|pcm|lpcm|wma/i;
const ACTIVE = "('queued','running')";
// a re-encode is queued only when the estimate is at least this much smaller …
const SPACE_MIN = 0.2;
// … and kept only when the real file is at least 5% smaller
const KEEP_MAX = 0.95;
// an HEVC source is worth it only this far above the 10 Mb/s cap
const SPACE_CAP_BPS = 12.5e6;
const ONLINE_MS = 60000;
// a worker that hasn't called in about its job for this long has its job put back in the queue
const STALE_MS = 30 * 60 * 1000;
// the chunks a worker uploads in: small enough for a Cloudflare tunnel's 100 MB limit
const CHUNK = 32 * 1024 * 1024;

const CODEC_NAME = {
  eac3: 'E-AC3', ac3: 'AC3', truehd: 'TrueHD', dts: 'DTS', mp2: 'MP2', wmav2: 'WMA', wmav1: 'WMA', wmapro: 'WMA Pro',
  h264: 'H.264', hevc: 'HEVC', mpeg4: 'MPEG-4 (DivX/Xvid)', msmpeg4v3: 'MS MPEG-4', wmv3: 'WMV', wmv2: 'WMV', wmv1: 'WMV',
  vc1: 'VC-1', flv1: 'FLV', mpeg2video: 'MPEG-2', mpeg1video: 'MPEG-1', vp9: 'VP9', vp8: 'VP8', av1: 'AV1', h263: 'H.263',
};
const codecName = (c) => CODEC_NAME[c] || (/^pcm_/.test(c || '') ? 'PCM' : /^adpcm/.test(c || '') ? 'ADPCM' : String(c || 'unknown').toUpperCase());

const ffmpegPath = () => process.env.FFMPEG_PATH || require('ffmpeg-static');

// ---------------------------------------------------------------- settings

const setting = (key, fallback = null) => db.prepare('SELECT value FROM encode_settings WHERE key = ?').get(key)?.value ?? fallback;
const setSetting = (key, value) => db.prepare(`
  INSERT INTO encode_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
  ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
`).run(key, String(value));

const MODES = ['auto', 'local', 'remote'];
/** auto: this server encodes while no linked worker is online; local: always (beside the workers); remote: never */
const mode = () => (MODES.includes(setting('worker_mode')) ? setting('worker_mode') : 'auto');
function setMode(m) {
  if (!MODES.includes(m)) throw Object.assign(new Error('mode must be auto, local or remote'), { status: 400 });
  setSetting('worker_mode', m);
  if (!localWanted()) stopLocal();
  kick();
}
const isRunning = () => setting('queue_running', '1') === '1';

let engine = null; // { ok, error } — whether this server's ffmpeg can make HEVC 10-bit at all
function localEngine() {
  if (engine) return engine;
  try {
    const r = spawnSync(ffmpegPath(), ['-hide_banner', '-encoders'], { encoding: 'utf8', timeout: 20000, windowsHide: true });
    engine = /\blibx265\b/.test(r.stdout || '') ? { ok: true } : { ok: false, error: "this server's ffmpeg has no libx265" };
  } catch (e) {
    engine = { ok: false, error: `no ffmpeg here (${e.message})` };
  }
  return engine;
}

const onlineWorkers = () => db.prepare('SELECT COUNT(*) AS n FROM encode_workers WHERE enabled = 1 AND last_seen > ?').get(Date.now() - ONLINE_MS).n;
const localWanted = () => localEngine().ok && (mode() === 'local' || (mode() === 'auto' && onlineWorkers() === 0));

// ---------------------------------------------------------------- the library

const TOPS = { 'before filter performer': 'before', 'after filter performer': 'after', content: 'content' };
const TOP_DIR = { before: 'before filter performer', after: 'after filter performer', content: 'content' };

const roots = () => db.prepare('SELECT id, path FROM folders').all().map(r => ({ id: r.id, path: path.resolve(r.path) }));

function rootOf(p, all = roots()) {
  const abs = path.resolve(p);
  return all.find(r => abs.startsWith(r.path + path.sep)) || null;
}

/** Where a video is: its base folder, before / after / content, the performer's or genre's name, and the folder in it. */
function placeOf(p, all = roots()) {
  const root = rootOf(p, all);
  if (!root) return null;
  const parts = path.relative(root.path, path.resolve(p)).split(path.sep);
  const top = TOPS[parts[0]];
  if (!top || parts.length < 3) return null;
  return { root, top, name: parts[1], key: `${root.id}/${top}/${parts[1]}`, folder: parts.slice(2, -1).join('/') };
}

function parseKey(key) {
  const m = /^(\d+)\/(before|after|content)\/(.+)$/.exec(String(key || ''));
  if (!m) return null;
  const root = roots().find(r => r.id === Number(m[1]));
  if (!root || m[3].includes('/') || m[3].includes('\\') || m[3].startsWith('.')) return null;
  return { root, top: m[2], name: m[3], dir: path.join(root.path, TOP_DIR[m[2]], m[3]) };
}

function toFile(r) {
  if (!r) return null;
  let streams = [];
  try { streams = r.streams ? JSON.parse(r.streams) : []; } catch { /* unreadable: treated as not probed */ }
  return {
    path: r.path, size: r.size, mtime: r.mtime, probed: !!r.probed_at && !!r.streams, error: r.error, container: r.container,
    duration: r.duration, width: r.width, height: r.height, bitrate: r.bitrate, video_codec: r.video_codec,
    video_bitrate: r.video_bitrate, fps: r.fps, bit_depth: r.bit_depth, streams,
  };
}
const fileRow = (p) => toFile(db.prepare('SELECT * FROM media_probe WHERE path = ?').get(p));

/**
 * Which file is at a path: size, mtime and inode (null: nothing there) — enough to tell "the file this job was made
 * from" from another that took its name meanwhile. A share that gives no inode ("0") leaves it to size and mtime.
 */
function fingerprint(p) {
  try {
    const s = fs.statSync(p, { bigint: true });
    return { size: Number(s.size), mtime: Number(s.mtimeMs), ino: String(s.ino) };
  } catch {
    return null;
  }
}
const realIno = (x) => x.ino && x.ino !== '0';
const sameFile = (a, b) => !!a && !!b && a.size === b.size && (realIno(a) && realIno(b) ? a.ino === b.ino : Math.round(a.mtime) === Math.round(b.mtime));
const parseJson = (s) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };

// ---------------------------------------------------------------- planning

const shortSide = (f) => Math.min(f.width || f.height || 0, f.height || f.width || 0);

// a word that says VR on its own, and words that only do together ("Part 180" is an ordinary title, "180_LR" isn't)
const VR_WORD = /^(vr|vr180|vr360|sbs|3dh|3dv|mkx200|mkx220|fisheye|fisheye190|rf52|180x180|360x180)$/;
const VR_FIELD = /^(180|360)$/;
const VR_LAYOUT = /^(lr|rl|tb|bt|ou)$/;

/** A VR video (side by side, over-under, fisheye): re-encoding it to 1080p would ruin it, so it's left alone. */
function isVR(f) {
  const words = path.basename(f.path).toLowerCase().split(/[^a-z0-9]+/);
  if (words.some(w => VR_WORD.test(w))) return true;
  if (words.some(w => VR_FIELD.test(w)) && words.some(w => VR_LAYOUT.test(w))) return true;
  const ratio = f.width && f.height ? f.width / f.height : 0;
  return (Math.abs(ratio - 2) < 0.02 && f.width >= 3000) || (Math.abs(ratio - 1) < 0.02 && f.width >= 2500);
}

let ours = null; // { at, sizes: path → size }: files the queue made, or tried to shrink and couldn't

/**
 * Whether the queue has had this file before: one of its re-encodes (done, not undone), one it didn't make smaller, or
 * one whose re-encode you undid. By path and size, so another file in its place is a new file.
 */
function triedByQueue(f) {
  if (!ours || Date.now() - ours.at > 30000) {
    const rows = db.prepare(`
      SELECT out_path AS path, out_fp, actual_size_bytes AS size, 'made' AS why, completed_at FROM encode_jobs WHERE status = 'done' AND out_path IS NOT NULL
      UNION ALL
      SELECT source_path, NULL, original_size_bytes, 'tried', completed_at FROM encode_jobs WHERE status = 'skipped' AND actual_size_bytes > 0
      UNION ALL
      SELECT source_path, NULL, original_size_bytes, 'undone', completed_at FROM encode_jobs WHERE status = 'undone'
      ORDER BY completed_at
    `).all();
    ours = { at: Date.now(), sizes: new Map(rows.map(r => [r.path, { size: parseJson(r.out_fp)?.size ?? r.size, why: r.why }])) };
  }
  const x = ours.sizes.get(f.path);
  return x && (!f.size || x.size === f.size) ? x.why : null;
}

const aacKbps = (ch) => (ch > 2 ? 448 : ch === 1 ? 128 : 256);

/** What an audio track probably runs at: the probe keeps no per-track rate, so its codec and channels say. */
function audioKbps(codec, ch = 2) {
  const n = Math.max(1, ch || 2);
  if (codec === 'truehd') return n > 6 ? 4500 : 3000;
  if (codec === 'dts') return 1500;
  if (/^pcm_/.test(codec || '')) return 768 * n;
  if (codec === 'flac') return 450 * n;
  if (codec === 'eac3') return n > 2 ? 640 : 224;
  if (codec === 'ac3') return n > 2 ? 448 : 192;
  if (codec === 'opus') return n > 2 ? 256 : 128;
  return n > 2 ? 384 : 192;
}

// What HEVC at quality 20 typically runs at by the picture's short side. Rough on purpose: calibration() corrects it
// from the jobs that finished.
const HEVC_KBPS = [[1000, 3200], [650, 1700], [0, 900]];
const videoKbpsOut = (side) => HEVC_KBPS.find(([min]) => Math.min(side || 1080, 1080) >= min)[1];

/**
 * The new file's size before calibration, from its length, bitrate and height: its video re-encoded at HEVC's typical
 * rate (never above the source's, never above the 10 Mb/s cap), converted audio at AAC's. null without a length.
 * Stored with each job (estimated_size_bytes), so finished jobs say how far off it was.
 */
function estimateSize(f, plan) {
  if (!f.size || !f.duration) return null;
  const secs = f.duration;
  const conv = new Set(plan.audio.map(a => a.index));
  let audioIn = 0;
  let saved = 0; // kb/s
  for (const s of f.streams) {
    if (s.type !== 'audio') continue;
    const k = audioKbps(s.codec, s.channels);
    audioIn += k;
    if (conv.has(s.index)) saved += Math.max(0, k - aacKbps(Math.min(s.channels || 2, 6)));
  }
  const total = f.bitrate ? f.bitrate / 1000 : (f.size * 8) / 1000 / secs;
  const vIn = f.video_bitrate ? Math.min(f.video_bitrate / 1000, total) : Math.max(total - audioIn, total * 0.4);
  saved += Math.max(0, vIn - Math.min(videoKbpsOut(shortSide(f)), vIn, 10000));
  return Math.round(Math.max(f.size * 0.05, f.size - saved * 125 * secs));
}

let calib = null; // { at, value: { factor, jobs } }

/**
 * How far off the estimates were: the median of new size / estimate over the last 40 finished re-encodes (one thrown
 * away for not being smaller counts too: it was made), 1 until three have finished.
 */
function calibration() {
  if (calib && Date.now() - calib.at < 600000) return calib.value;
  const r = db.prepare(`
    SELECT CAST(actual_size_bytes AS REAL) / estimated_size_bytes AS r FROM encode_jobs
    WHERE status IN ('done','skipped','undone') AND estimated_size_bytes > 0 AND actual_size_bytes > 0 AND plan IS NOT NULL
    ORDER BY completed_at DESC LIMIT 40
  `).all().map(x => x.r).sort((a, b) => a - b);
  const factor = r.length < 3 ? 1 : Math.max(0.5, Math.min(2, r[Math.floor(r.length / 2)]));
  calib = { at: Date.now(), value: { factor, jobs: r.length } };
  return calib.value;
}

/**
 * What a re-encode would do to one file: { plan, est, expected, gain } when it qualifies, else { reason } (and the
 * estimate when there is one). `plan` is what the job runs: the video track, the audio tracks to convert, the
 * container (mux mp4 | mkv), a new extension when the old one can't hold HEVC, and the scale.
 */
function assess(f) {
  if (!f || !f.probed) return { reason: f?.error ? `Can't be read (${f.error})` : 'Not looked at yet' };
  const sorted = [...f.streams].sort((a, b) => a.index - b.index);
  const main = sorted.find(s => s.type === 'video' && !s.cover);
  if (!main) return { reason: 'No video track' };
  if (!f.duration || !f.size) return { reason: 'Its length is unknown' };
  if (isVR(f)) return { reason: 'VR video: left as it is' };
  const tried = triedByQueue(f);
  if (tried) return { reason: { made: 'Made by this queue', undone: 'Its re-encode was undone' }[tried] || 'A re-encode didn\'t make it smaller before' };
  const hi10 = main.codec === 'h264' && (f.bit_depth || 8) > 8;
  const old = hi10 || !VIDEO_OK.has(main.codec);
  if (main.codec === 'hevc' && !((f.bitrate || 0) > SPACE_CAP_BPS)) return { reason: 'Already HEVC' };

  const ext = path.extname(f.path).toLowerCase();
  const subs = sorted.filter(s => s.type === 'subtitle' && !SUB_DROP.has(s.codec));
  const mkv = ext === '.mkv' || subs.some(s => !SUB_TEXT.has(s.codec)) || sorted.some(s => s.type === 'attachment');
  const ok = mkv ? AUDIO_OK_MKV : AUDIO_OK_MP4;
  const audio = sorted.filter(s => s.type === 'audio' && !ok.has(s.codec)).map(s => ({ index: s.index, from: s.codec, channels: s.channels || 2 }));
  const keepExt = mkv ? ext === '.mkv' : MP4_EXTS.has(ext);
  const why = [old ? (hi10 ? '10-bit H.264 (Hi10P)' : `${codecName(main.codec)} video`) : `${codecName(main.codec)} at ${Math.round((f.bitrate || 0) / 1e5) / 10} Mb/s`];
  if (audio.length) why.push(`${[...new Set(audio.map(a => codecName(a.from)))].join(', ')} audio to AAC`);
  const side = shortSide(f);
  const plan = {
    kind: 'space', video: 'encode', videoIndex: main.index, audio, why,
    mux: mkv ? 'mkv' : 'mp4', outExt: keepExt ? null : (mkv ? '.mkv' : '.mp4'),
    scale: side > 1080 ? ((f.width || 0) >= (f.height || 0) ? 'landscape' : 'portrait') : null,
  };
  if (plan.scale) why.push(`${side}p to 1080p`);
  const est = estimateSize(f, plan);
  const expected = est == null ? null : Math.min(f.size, Math.round(est * calibration().factor));
  const pct = expected == null ? 0 : Math.round((1 - expected / f.size) * 100);
  if (expected == null || expected > f.size * (1 - SPACE_MIN)) return { reason: `Only ~${pct}% smaller as HEVC`, est, expected };
  why.push(`~${pct}% smaller as HEVC`);
  return { plan, est, expected, gain: f.size - expected };
}

// ---------------------------------------------------------------- the queue

const setJob = (id, fields) => {
  const keys = Object.keys(fields);
  db.prepare(`UPDATE encode_jobs SET ${keys.map(k => `${k} = @${k}`).join(', ')} WHERE id = @id`).run({ ...fields, id });
};

/** The library's videos under a performer's or genre's folder (one folder in it, with `folder`), or all of them. */
function pathsFor({ all, group, folder } = {}) {
  if (all) return db.prepare('SELECT path FROM media_probe').all().map(r => r.path);
  const g = parseKey(group);
  if (!g) throw Object.assign(new Error('Unknown performer or genre'), { status: 400 });
  let dir = g.dir;
  if (folder) {
    const parts = String(folder).split('/').filter(Boolean);
    if (parts.some(p => p === '..' || p.startsWith('.'))) throw Object.assign(new Error('Bad folder'), { status: 400 });
    dir = path.join(dir, ...parts);
  }
  return db.prepare('SELECT path FROM media_probe WHERE substr(path, 1, length(@dir)) = @dir').all({ dir: dir + path.sep }).map(r => r.path);
}

/**
 * Put files in the queue, those a re-encode makes at least a fifth smaller, at the end. A file already waiting or
 * running isn't added twice; `bulk` (a performer, a folder, everything) also leaves out a file whose last job failed
 * (it would fail again) — queued on its own, it's tried again.
 */
function enqueue(paths, { bulk = false } = {}) {
  let added = 0;
  const skipped = {};
  const skip = (why) => { skipped[why] = (skipped[why] || 0) + 1; };
  let pos = db.prepare(`SELECT COALESCE(MAX(position), 0) AS p FROM encode_jobs WHERE status IN ${ACTIVE}`).get().p;
  const busy = new Set(db.prepare(`SELECT source_path FROM encode_jobs WHERE status IN ${ACTIVE}`).all().map(r => r.source_path));
  const lastFailed = db.prepare('SELECT status, original_size_bytes FROM encode_jobs WHERE source_path = ? ORDER BY id DESC LIMIT 1');
  const insert = db.prepare(`
    INSERT INTO encode_jobs (source_path, target_format, status, priority, position, original_size_bytes, estimated_size_bytes, created_at, kind, plan, label)
    VALUES (?, 'hevc', 'queued', 0, ?, ?, ?, ?, ?, ?, ?)
  `);
  const all = roots();
  db.transaction(() => {
    for (const p of paths) {
      if (!rootOf(p, all)) { skip('not in the library'); continue; }
      if (busy.has(p)) { skip('already queued'); continue; }
      const f = fileRow(p);
      const a = assess(f);
      if (!a.plan) { skip(a.reason); continue; }
      const last = bulk ? lastFailed.get(p) : null;
      if (last?.status === 'failed' && last.original_size_bytes === f.size) { skip('failed before'); continue; }
      insert.run(p, ++pos, f.size, a.est, Date.now(), a.plan.kind, JSON.stringify(a.plan), path.basename(p));
      busy.add(p);
      added += 1;
    }
  })();
  forget();
  if (added) kick();
  return { added, skipped };
}

/** A queued job is dropped; a running one is stopped (this server's ffmpeg killed, a worker told on its next call). */
function removeJob(id) {
  const job = db.prepare('SELECT * FROM encode_jobs WHERE id = ?').get(id);
  if (!job) throw Object.assign(new Error('No such job'), { status: 404 });
  if (job.status === 'running') {
    if (job.phase === 'verifying' || job.phase === 'swapping') throw Object.assign(new Error('It\'s being checked and swapped in: a moment'), { status: 409 });
    if (job.worker_id === 'local' && local.jobId === id) { local.removing = true; killLocal(); }
    // a worker's half-uploaded file: gone now, unless a chunk is still arriving — that upload removes it when it
    // finds the job gone (workerUpload), so its write can't bring the file back
    const tmp = tmpOf(job);
    if (tmp && job.worker_id !== 'local' && !uploading.has(id)) {
      try { fs.rmSync(tmp, { force: true }); } catch { /* still open: cleanup() clears it */ }
    }
  } else if (job.status !== 'queued') {
    throw Object.assign(new Error('Only a queued or running job can be removed'), { status: 409 });
  }
  resuming.delete(id);
  db.prepare('DELETE FROM encode_jobs WHERE id = ?').run(id);
  forget();
  return true;
}

/** The finished jobs off the list — not one whose original is still held (Undo, and its deletion, need its record). */
function clearFinished() {
  const r = db.prepare("DELETE FROM encode_jobs WHERE status IN ('failed','skipped','undone') OR (status = 'done' AND held_path IS NULL)").run();
  forget();
  return r.changes;
}

const PRIORITY_MAX = 999;
/** A job's priority, queued or running: higher goes first; 0 is everyone's. */
function setPriority(id, n) {
  if (!Number.isFinite(n)) throw Object.assign(new Error('priority must be a whole number'), { status: 400 });
  const v = Math.max(-PRIORITY_MAX, Math.min(PRIORITY_MAX, Math.trunc(n)));
  const r = db.prepare(`UPDATE encode_jobs SET priority = ? WHERE id = ? AND status IN ${ACTIVE}`).run(v, id);
  if (!r.changes) throw Object.assign(new Error('That job isn\'t queued or running'), { status: 409 });
}

/** Bump: 'up' puts it above every job waiting or running, 'down' below them all. */
function bumpJob(id, dir) {
  if (dir !== 'up' && dir !== 'down') throw Object.assign(new Error('dir must be up or down'), { status: 400 });
  const { lo, hi } = db.prepare(`SELECT MIN(priority) AS lo, MAX(priority) AS hi FROM encode_jobs WHERE status IN ${ACTIVE}`).get();
  setPriority(id, dir === 'up' ? (hi ?? 0) + 1 : (lo ?? 0) - 1);
}

function retryJob(id) {
  const pos = db.prepare(`SELECT COALESCE(MAX(position), 0) AS p FROM encode_jobs WHERE status IN ${ACTIVE}`).get().p;
  // not one whose swap was cut short with an original still held: its record is how that original is found
  const r = db.prepare(`
    UPDATE encode_jobs SET status = 'queued', error_message = NULL, progress = NULL, src_fp = NULL, position = ?, worker_id = NULL, phase = NULL
    WHERE id = ? AND status = 'failed' AND held_path IS NULL AND (phase IS NULL OR phase != 'swapping')
  `).run(pos + 1, id);
  if (!r.changes) throw Object.assign(new Error('Only a failed job can be tried again'), { status: 409 });
  forget();
  kick();
}

// ---------------------------------------------------------------- running

const local = { proc: null, jobId: null, stopping: false, removing: false, suspended: false, ops: Promise.resolve() };

// freezes and thaws of this server's ffmpeg, one at a time and in order (two at once could suspend it twice, and
// Windows counts suspends)
function serially(fn) {
  const p = local.ops.then(fn);
  local.ops = p.catch(() => {});
  return p;
}
// jobs told to resume whose worker hasn't reported encoding again yet: it hears 'resume' until it does
const resuming = new Set();

const runningJob = (id) => db.prepare("SELECT * FROM encode_jobs WHERE id = ? AND status = 'running'").get(id);

/** Start: jobs the queue's Pause froze carry on; one you paused yourself stays until you resume it. */
async function start() {
  setSetting('queue_running', '1');
  for (const job of db.prepare("SELECT id FROM encode_jobs WHERE status = 'running' AND hold = 'queue'").all()) {
    await resumeJob(job.id).catch(e => console.log(`[encode] can't resume job ${job.id}: ${e.message}`));
  }
  kick();
}

/** Pause: every encode in progress freezes where it is (a remote worker's on its next call), and nobody gets a new job. */
async function pause() {
  setSetting('queue_running', '0');
  for (const job of db.prepare("SELECT id FROM encode_jobs WHERE status = 'running' AND hold IS NULL").all()) {
    await pauseJob(job.id, 'queue').catch(e => console.log(`[encode] can't pause job ${job.id}: ${e.message}`));
  }
}

async function pauseJob(id, by = 'user') {
  const job = runningJob(id);
  if (!job) throw Object.assign(new Error('That job isn\'t running'), { status: 409 });
  if (job.phase === 'verifying' || job.phase === 'swapping') throw Object.assign(new Error('It\'s being checked and swapped in: a moment'), { status: 409 });
  if (job.hold) {
    if (by === 'user' && job.hold !== 'user') setJob(id, { hold: 'user' });
    return;
  }
  resuming.delete(id);
  setJob(id, { hold: by });
  if (job.worker_id === 'local') await holdLocal(id);
}

async function resumeJob(id) {
  const job = runningJob(id);
  if (!job) throw Object.assign(new Error('That job isn\'t running'), { status: 409 });
  if (!job.hold && !job.held) throw Object.assign(new Error('That job isn\'t paused'), { status: 409 });
  setJob(id, { hold: null });
  if (job.worker_id === 'local') await thawLocal(id);
  else if (job.held) resuming.add(id);
}

function holdLocal(id) {
  return serially(async () => {
    if (!local.proc || local.jobId !== id || local.suspended) return;
    const proc = local.proc;
    try {
      await suspendProcess(proc.pid);
    } catch (e) {
      await new Promise(r => setTimeout(r, 300));
      if (local.proc !== proc || proc.exitCode != null || proc.signalCode != null) return;   // it finished in that moment
      throw e;
    }
    local.suspended = true;
    setJob(id, { held: 1, phase: 'paused', speed: null });
  });
}

function thawLocal(id) {
  return serially(async () => {
    if (local.jobId !== id || !local.suspended) { setJob(id, { held: 0 }); return; }
    await resumeProcess(local.proc.pid);
    local.suspended = false;
    setJob(id, { held: 0, phase: 'encoding' });
  });
}

/** What a remote worker is to do with its job, beyond carrying on. */
const actionFor = (job) => (job.hold ? 'pause' : resuming.has(job.id) ? 'resume' : 'continue');

function killLocal() {
  if (!local.proc) return;
  const proc = local.proc;
  // a frozen process can't take the kill on Windows until it's thawed
  if (local.suspended) resumeProcess(proc.pid).catch(() => {}).finally(() => proc.kill('SIGKILL'));
  else proc.kill('SIGKILL');
}

function stopLocal() {
  if (local.proc) {
    local.stopping = true;
    killLocal();
  }
}

let looping = false;
function kick() {
  if (looping || !isRunning() || !localWanted()) return;
  looping = true;
  setImmediate(async () => {
    try {
      while (isRunning() && localWanted()) {
        const job = claimNext('local');
        if (!job) break;
        await runLocal(job);
      }
    } catch (e) {
      console.log(`[encode] queue stopped: ${e.message}`);
    } finally {
      looping = false;
    }
  });
}

/** The next job — highest priority, then queue order — taken by one worker atomically, so two never take the same one. */
function claimNext(workerKey) {
  return db.transaction(() => {
    const job = db.prepare("SELECT * FROM encode_jobs WHERE status = 'queued' ORDER BY priority DESC, position, id LIMIT 1").get();
    if (!job) return null;
    const now = Date.now();
    db.prepare(`
      UPDATE encode_jobs SET status = 'running', worker_id = ?, started_at = ?, heartbeat_at = ?, progress = 0, speed = NULL,
        phase = 'starting', error_message = NULL, hold = NULL, held = 0 WHERE id = ?
    `).run(workerKey, now, now, job.id);
    return { ...job, worker_id: workerKey };
  })();
}

const tmpOf = (job) => {
  const root = rootOf(job.source_path);
  return root ? path.join(root.path, WORK_DIR, 'tmp', `${job.id}.part`) : null;
};

/** Back to the queue — at the front, as if never started — and whatever it had written so far, gone. */
function requeue(job) {
  resuming.delete(job.id);
  setJob(job.id, { status: 'queued', worker_id: null, progress: null, speed: null, started_at: null, heartbeat_at: null, phase: null, src_fp: null, hold: null, held: 0 });
  const tmp = tmpOf(job);
  if (tmp) fs.rmSync(tmp, { force: true });
  forget();
}

/**
 * The ffmpeg arguments for a plan: everything mapped and copied, then the per-track changes. `encoder` "nvenc" is for
 * a worker with an NVIDIA card: the same target, made by the card. A remote worker gets "{in}" and "{out}" for paths.
 * Only options Hikari's worker accepts (its checkJob), so the one worker program runs either app's jobs.
 */
function ffmpegArgs(src, out, f, plan, { encoder = 'cpu' } = {}) {
  const sorted = [...f.streams].sort((a, b) => a.index - b.index);
  const mp4 = plan.mux === 'mp4';
  const drop = new Set(sorted.filter(s => s.type === 'data' || s.type === 'unknown' || (s.type === 'subtitle' && SUB_DROP.has(s.codec))
    || (mp4 && (s.type === 'attachment' || (s.type === 'video' && s.cover)))).map(s => s.index));
  const args = ['-hide_banner', '-nostdin', '-y', '-loglevel', 'error', '-nostats', '-progress', 'pipe:1', '-i', src, '-map', '0'];
  for (const i of drop) args.push('-map', `-0:${i}`);
  args.push('-map_metadata', '0', '-map_chapters', '0', '-c', 'copy', '-max_muxing_queue_size', '9999');
  const n = { video: 0, audio: 0, subtitle: 0, attachment: 0 };
  const audioPlan = new Map(plan.audio.map(a => [a.index, a]));
  for (const s of sorted) {
    if (drop.has(s.index) || !(s.type in n)) continue;
    const i = n[s.type]++;
    if (s.type === 'video' && s.index === plan.videoIndex) {
      const v = `v:${i}`;
      if (encoder === 'nvenc') {
        // constant quality held under the cap; NVDEC can't decode every source (10-bit H.264), so the CPU decodes
        args.push(`-c:${v}`, 'hevc_nvenc', `-preset:${v}`, 'p6', `-tune:${v}`, 'hq', `-rc:${v}`, 'vbr', `-b:${v}`, '0',
          `-cq:${v}`, '22', `-pix_fmt:${v}`, 'p010le', `-profile:${v}`, 'main10');
      } else {
        args.push(`-c:${v}`, 'libx265', `-preset:${v}`, 'medium', `-crf:${v}`, '20',
          `-pix_fmt:${v}`, 'yuv420p10le', `-profile:${v}`, 'main10', `-x265-params:${v}`, 'log-level=error');
      }
      args.push(`-maxrate:${v}`, '10M', `-bufsize:${v}`, '20M');
      // hvc1, not hev1: what Safari and Chrome want to see in an MP4
      if (mp4) args.push(`-tag:${v}`, 'hvc1');
      if (plan.scale === 'landscape') args.push(`-filter:${v}`, 'scale=-2:1080:flags=lanczos');
      else if (plan.scale === 'portrait') args.push(`-filter:${v}`, 'scale=1080:-2:flags=lanczos');
    } else if (s.type === 'audio' && audioPlan.has(s.index)) {
      const ch = Math.max(1, Math.min(audioPlan.get(s.index).channels || 2, 6));
      const a = `a:${i}`;
      args.push(`-c:${a}`, 'aac', `-b:${a}`, `${aacKbps(ch)}k`, `-ac:${a}`, String(ch));
      // a track named for its old codec ("DTS 5.1") would now be wrong
      if (s.title && CODEC_WORDS.test(s.title)) args.push(`-metadata:s:${a}`, `title=AAC ${ch > 2 ? '5.1' : ch === 1 ? 'mono' : '2.0'}`);
    } else if (s.type === 'subtitle') {
      if (mp4 && s.codec !== 'mov_text') args.push(`-c:s:${i}`, 'mov_text');
      else if (!mp4 && s.codec === 'mov_text') args.push(`-c:s:${i}`, 'srt');
    }
  }
  if (mp4 && sorted.some(s => s.type === 'audio' && s.codec === 'flac' && !audioPlan.has(s.index))) args.push('-strict', 'experimental');
  args.push('-f', mp4 ? 'mp4' : 'matroska');
  if (mp4) args.push('-movflags', '+faststart');
  args.push(out);
  const expect = { video: 0, audio: 0, subtitle: 0, attachment: 0 };
  for (const s of sorted) if (!drop.has(s.index) && s.type in expect) expect[s.type] += 1;
  return { args, expect };
}

// how far the new file's length, and where its video starts, may be from the original's: funscripts are timed against both
const LENGTH_SLACK_S = 0.5;
const START_SLACK_S = 0.1;

/** Where the main video begins on the file's timeline: what a player's 0 s is for it, and so for its funscript. */
const videoOffset = (p) => (p.video_start != null ? p.video_start - (p.start ?? 0) : 0);

/**
 * The new file has to be the whole thing: as long as the original, its video starting at the same point of the
 * timeline (a shifted video with the same length puts every funscript action out of step), every track there. The
 * original is probed again for that; its length is the probe's that planned the job, never the new file's.
 */
async function verify(out, f, expect, src) {
  const want = f.duration;
  if (!want) throw new Error('the original\'s length isn\'t known, so the new file can\'t be checked against it');
  const [p, o] = await Promise.all([probe.probeFile(out), probe.probeFile(src)]);
  if (!p.duration || Math.abs(p.duration - want) > LENGTH_SLACK_S) {
    throw new Error(`the new file is ${(p.duration || 0).toFixed(2)} s long, the original ${want.toFixed(2)} s`);
  }
  const shift = videoOffset(p) - videoOffset(o);
  if (Math.abs(shift) > START_SLACK_S) {
    throw new Error(`the new file's video starts ${Math.abs(shift).toFixed(2)} s ${shift > 0 ? 'later' : 'earlier'} than the original's (funscripts would be out of step)`);
  }
  const got = { video: 0, audio: 0, subtitle: 0, attachment: 0 };
  for (const s of p.streams) if (s.type in got) got[s.type] += 1;
  for (const k of Object.keys(expect)) {
    if (got[k] !== expect[k]) throw new Error(`the new file has ${got[k]} ${k} tracks, the original ${expect[k]}`);
  }
  const v = p.streams.find(s => s.type === 'video' && !s.cover);
  if (!v || v.codec !== 'hevc') throw new Error(`the new file's video is ${v ? codecName(v.codec) : 'missing'}, not HEVC`);
  return p;
}

function freeBytes(dir) {
  try {
    const s = fs.statfsSync(dir);
    return Number(s.bavail) * Number(s.bsize);
  } catch {
    return null;
  }
}

/**
 * What a job needs before anyone encodes it: the file still there and probed as it is now, its plan worked out again,
 * room on the share. null when there's nothing to do — the job is then finished as failed or skipped.
 * `claim`: a worker is taking it now, so which file it's made from is written down (src_fp), and finishJob swaps only
 * that file out. Without (a worker's upload just finished) the plan it was made with stands.
 */
async function prepareJob(job, { claim = true } = {}) {
  const root = rootOf(job.source_path);
  const now = fingerprint(job.source_path);
  if (!root || !now) {
    setJob(job.id, { status: 'failed', error_message: 'The file isn\'t there any more (moved or deleted since it was queued)', completed_at: Date.now(), phase: null });
    forget();
    return null;
  }
  let f = fileRow(job.source_path);
  if (!f || !f.probed || f.size !== now.size || f.mtime !== Math.round(now.mtime)) {
    await probe.refresh(job.source_path);
    f = fileRow(job.source_path);
  }
  let plan = parseJson(job.plan);
  if (claim) {
    const a = assess(f);
    if (!a.plan) {
      setJob(job.id, { status: 'skipped', completed_at: Date.now(), phase: null, error_message: `${a.reason || 'Nothing to do'}: left as it is` });
      forget();
      return null;
    }
    plan = a.plan;
    const tmpDir = path.join(root.path, WORK_DIR, 'tmp');
    fs.mkdirSync(tmpDir, { recursive: true });
    const free = freeBytes(tmpDir);
    if (free != null && free < f.size * 1.2) {
      setJob(job.id, { status: 'failed', error_message: `Not enough free space for the new file (${Math.round(free / 1e9)} GB free)`, completed_at: Date.now(), phase: null });
      forget();
      return null;
    }
    setJob(job.id, { kind: plan.kind, plan: JSON.stringify(plan), src_fp: JSON.stringify(now), original_size_bytes: f.size, estimated_size_bytes: a.est });
  }
  if (!plan || !f?.probed) {
    setJob(job.id, { status: 'failed', error_message: 'The file can\'t be read any more', completed_at: Date.now(), phase: null });
    forget();
    return null;
  }
  return { f, root, plan, work: path.join(root.path, WORK_DIR), tmp: tmpOf(job) };
}

/** Reads ffmpeg's -progress lines into how far along and how fast (frames over duration × fps when it gives no time). */
function progressReader(duration, fps) {
  const t0 = Date.now();
  let outSec = null;
  let frame = 0;
  let speed = null;
  const progress = () => {
    const done = outSec != null ? outSec / duration : fps ? frame / (fps * duration) : 0;
    return duration > 0 ? Math.min(0.999, Math.max(0, done)) : 0;
  };
  return {
    line(raw) {
      const [k, v] = raw.trim().split('=');
      if (k === 'out_time_us') { const x = Number(v); if (Number.isFinite(x)) outSec = x / 1e6; }
      else if (k === 'frame') { const x = Number(v); if (Number.isFinite(x)) frame = x; }
      else if (k === 'speed') { const x = parseFloat(v); speed = Number.isFinite(x) ? x : null; }
    },
    get progress() { return progress(); },
    get speed() {
      if (speed) return speed;
      const s = (Date.now() - t0) / 1000;
      return s > 2 && duration > 0 ? (progress() * duration) / s : null;
    },
  };
}

/** This server's own encode: ffmpeg at the lowest priority, progress into the job row. */
async function runLocal(job) {
  const prep = await prepareJob(job);
  if (!prep) return;
  const { f, plan, tmp } = prep;
  const { args } = ffmpegArgs(job.source_path, tmp, f, plan);
  setJob(job.id, { phase: 'encoding' });
  console.log(`[encode] ${job.label}: ${plan.why.join(', ')}, to HEVC 10-bit on this server`);
  Object.assign(local, { jobId: job.id, stopping: false, removing: false });

  let err = '';
  const code = await new Promise((resolve) => {
    const proc = spawn(ffmpegPath(), args, { windowsHide: true });
    local.proc = proc;
    try { os.setPriority(proc.pid, os.constants.priority.PRIORITY_LOW); } catch { /* not allowed here */ }
    if (runningJob(job.id)?.hold) holdLocal(job.id).catch(e => console.log(`[encode] ${job.label}: can't pause (${e.message})`));
    let buf = '';
    let lastWrite = 0;
    const pr = progressReader(f.duration, f.fps);
    proc.stdout.on('data', (d) => {
      buf += d;
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) pr.line(line);
      if (Date.now() - lastWrite > 2500 && !local.suspended) {
        lastWrite = Date.now();
        setJob(job.id, { progress: pr.progress, speed: pr.speed, heartbeat_at: lastWrite });
      }
    });
    proc.stderr.on('data', (d) => { err = (err + d).slice(-4000); });
    proc.on('error', (e) => { err = e.message; resolve(-1); });
    proc.on('close', (c) => resolve(c));
  });
  local.proc = null;
  local.jobId = null;
  local.suspended = false;

  if (local.removing) {
    local.removing = false;
    fs.rmSync(tmp, { force: true });
    return;
  }
  if (local.stopping) {
    local.stopping = false;
    requeue(job);
    console.log(`[encode] ${job.label}: stopped here, back in the queue`);
    return;
  }
  if (code !== 0) {
    fs.rmSync(tmp, { force: true });
    failJob(job, err.trim().split('\n').slice(-3).join(' ') || `ffmpeg exited ${code}`);
    return;
  }
  await finishJob(job, prep, 'this server');
}

function failJob(job, message) {
  resuming.delete(job.id);
  setJob(job.id, { status: 'failed', error_message: String(message || 'failed').slice(0, 500), completed_at: Date.now(), phase: null, hold: null, held: 0 });
  console.log(`[encode] ${job.label}: failed (${message})`);
  forget();
}

/** The job was removed, or put back in the queue, while its new file was being checked: nothing is swapped. */
class JobGone extends Error {
  constructor(deleted) {
    super(deleted ? 'removed while it was being checked; nothing was swapped' : 'taken back while it was being checked; nothing was swapped');
    this.deleted = deleted;
  }
}

/**
 * The new file in the work folder, wherever it was made: checked, then swapped in — the original to the holding folder
 * for 14 days, the new file into its place — and the library's records brought up to date. Throws nothing.
 *
 * Only the file the job was made from is swapped out (src_fp). Where the original and the new file are going is
 * written down before either moves, so a restart in between is finished or undone at the next start (reconcileSwaps).
 */
async function finishJob(job, prep, by) {
  const { f, root, plan, work, tmp } = prep;
  const made = by !== 'this server' ? ` (made on ${by})` : '';
  let held = null;
  let moved = false; // the original is out of its place and the new file not yet in it
  try {
    resuming.delete(job.id);
    setJob(job.id, { phase: 'verifying', hold: null, held: 0 });
    const { expect } = ffmpegArgs(job.source_path, tmp, f, plan);
    const out = await verify(tmp, f, expect, job.source_path);
    const outBytes = out.size || fingerprint(tmp)?.size || 0;
    // re-encoded only to save room: one that didn't is thrown away, the original stays
    if (outBytes > f.size * KEEP_MAX) {
      fs.rmSync(tmp, { force: true });
      setJob(job.id, {
        status: 'skipped', progress: 1, completed_at: Date.now(), phase: null, actual_size_bytes: outBytes,
        error_message: `The new file wasn't at least 5% smaller (${Math.round(f.size / 1e6)} → ${Math.round(outBytes / 1e6)} MB), so the original stays`,
      });
      console.log(`[encode] ${job.label}: not smaller (${Math.round(f.size / 1e6)} → ${Math.round(outBytes / 1e6)} MB), original kept`);
      return { ok: true };
    }
    const final = plan.outExt ? job.source_path.replace(/\.[^.\\/]+$/, plan.outExt) : job.source_path;
    held = path.join(work, String(job.id), path.relative(root.path, job.source_path));
    // (the row as it is now: `job` may be from before prepareJob wrote it)
    const was = parseJson(db.prepare('SELECT src_fp FROM encode_jobs WHERE id = ?').get(job.id)?.src_fp);
    const now = fingerprint(job.source_path);
    if (!now) throw new Error('the original isn\'t there any more');
    if (was ? !sameFile(was, now) : job.original_size_bytes && now.size !== job.original_size_bytes) {
      throw new Error('the original changed while this was being made, so it wasn\'t swapped in; nothing changed');
    }
    // an AVI becoming .mp4 mustn't land on another file of that name
    if (final !== job.source_path && fs.existsSync(final)) {
      throw new Error(`there's already a ${path.basename(final)} beside it, so it wasn't swapped in`);
    }
    // still this worker's job? Removing or requeueing it is refused while it's being checked, but whatever got in
    // before that must not end with an original in .originals that no record knows about
    const cur = db.prepare('SELECT status, worker_id FROM encode_jobs WHERE id = ?').get(job.id);
    if (!cur || cur.status !== 'running' || cur.worker_id !== job.worker_id) throw new JobGone(!cur);
    fs.mkdirSync(path.dirname(held), { recursive: true });
    // from here to "done" nothing waits, so nothing else runs in between
    setJob(job.id, { phase: 'swapping', held_path: held, out_path: final, held_until: null });
    fs.renameSync(job.source_path, held);
    moved = true;
    try {
      fs.renameSync(tmp, final);
    } catch (e) {
      fs.renameSync(held, job.source_path);
      moved = false;
      throw e;
    }
    moved = false;
    const outFp = fingerprint(final);
    setJob(job.id, {
      status: 'done', progress: 1, completed_at: Date.now(), actual_size_bytes: outFp?.size || outBytes, phase: null,
      out_path: final, held_path: held, held_until: Date.now() + HOLD_DAYS * DAY, out_fp: JSON.stringify(outFp), error_message: null,
    });
    console.log(`[encode] ${job.label}: done by ${by} (${Math.round(f.size / 1e6)} → ${Math.round(outBytes / 1e6)} MB), original held ${HOLD_DAYS} days`);
    afterSwap(job.source_path, final, f.size, outFp?.size || outBytes);
    return { ok: true };
  } catch (e) {
    if (moved) {
      // the new file couldn't go in and the original couldn't go back: both stay where they are, on record, and the
      // next start puts the original back (reconcileSwaps)
      const msg = `The swap failed and the original couldn't be put back yet: it's in ${held}, the new file in ${tmp}; the app puts it back at the next start (${e.message})`;
      setJob(job.id, { status: 'failed', error_message: msg.slice(0, 500), completed_at: Date.now(), phase: 'swapping' });
      console.error(`[encode] ${job.label}: ${msg}`);
      return { ok: false, error: e.message };
    }
    if (e instanceof JobGone) {
      // nothing was moved; the row isn't ours to write any more. Its new file goes only when the job is gone
      // altogether (back in the queue, the same name may be another worker's upload soon)
      if (e.deleted) fs.rmSync(tmp, { force: true });
      console.log(`[encode] ${job.label}: ${e.message}`);
      return { ok: false, error: e.message };
    }
    fs.rmSync(tmp, { force: true });
    setJob(job.id, { held_path: null, out_path: null, held_until: null });
    failJob(job, `${e.message || e}${made}`);
    return { ok: false, error: e.message };
  } finally {
    forget();
  }
}

// ---------------------------------------------------------------- the library's records

const PATH_SKIP = new Set(['folders', 'media_probe', 'encode_jobs', 'encode_workers', 'schema_migrations', 'performer_file_cache']);
let pathCols = null;
/** Every column that names a file (path, *_path, a pairwise winner / loser), in every table but the queue's own. */
function pathColumns() {
  if (pathCols) return pathCols;
  pathCols = [];
  for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all()) {
    if (PATH_SKIP.has(name)) continue;
    for (const c of db.prepare(`PRAGMA table_info("${name}")`).all()) {
      if (c.name === 'path' || c.name.endsWith('_path') || c.name === 'winner' || c.name === 'loser') pathCols.push([name, c.name]);
    }
  }
  return pathCols;
}

/**
 * A file under a new name: every record of the old one follows it (ratings, tags, hashes, scenes, labels …).
 * A record already under the new name is of a file that isn't there any more (the swap and Undo both check that
 * nothing is at the new path), so where the two clash on a unique key the moving one replaces it — said in the log.
 */
function repointPath(from, to) {
  if (from === to) return;
  const replaced = [];
  db.transaction(() => {
    for (const [t, c] of pathColumns()) {
      const moving = db.prepare(`SELECT COUNT(*) AS n FROM "${t}" WHERE "${c}" = ?`).get(from).n;
      if (!moving) continue;
      const before = db.prepare(`SELECT COUNT(*) AS n FROM "${t}" WHERE "${c}" = ?`).get(to).n;
      db.prepare(`UPDATE OR REPLACE "${t}" SET "${c}" = ? WHERE "${c}" = ?`).run(to, from);
      const gone = before + moving - db.prepare(`SELECT COUNT(*) AS n FROM "${t}" WHERE "${c}" = ?`).get(to).n;
      if (gone > 0) replaced.push(`${gone} in ${t}.${c}`);
    }
  })();
  if (replaced.length) console.log(`[encode] ${path.basename(to)}: stale records under its new name replaced by the moved ones (${replaced.join(', ')})`);
}

/** A performer's cached file lists: the entry follows a new name and is looked at again (size, dates) on the next load. */
function touchFileCache(from, to) {
  const needles = [JSON.stringify(from).slice(1, -1)];
  for (const r of db.prepare('SELECT performer_id, type, data FROM performer_file_cache WHERE instr(data, ?) > 0').all(needles[0])) {
    let list;
    try { list = JSON.parse(r.data); } catch { continue; }
    if (!Array.isArray(list)) continue;
    let changed = false;
    for (const e of list) {
      if (!e || e.path !== from) continue;
      changed = true;
      for (const [k, v] of Object.entries(e)) {
        if (typeof v !== 'string') continue;
        if (v === from) e[k] = to;
        else if (v.includes(encodeURIComponent(from))) e[k] = v.split(encodeURIComponent(from)).join(encodeURIComponent(to));
        else if (k === 'name' && v === path.basename(from)) e[k] = path.basename(to);
      }
      delete e.size;
      delete e.modified;
    }
    if (changed) db.prepare('UPDATE performer_file_cache SET data = ? WHERE performer_id = ? AND type = ?').run(JSON.stringify(list), r.performer_id, r.type);
  }
}

/** After a swap (or an Undo): the old path's records follow the new one, the sizes shown are corrected, the probe redone. */
function afterSwap(from, to, oldSize, newSize) {
  try {
    repointPath(from, to);
    touchFileCache(from, to);
    const place = placeOf(to);
    const gb = ((newSize || 0) - (oldSize || 0)) / (1024 ** 3);
    if (place && gb) {
      if (place.top === 'content') {
        db.prepare('UPDATE content_genres SET total_size_gb = MAX(0, COALESCE(total_size_gb, 0) + ?) WHERE name = ? AND folder_id = ?').run(gb, place.name, place.root.id);
      } else {
        db.prepare('UPDATE performers SET total_size_gb = MAX(0, COALESCE(total_size_gb, 0) + ?) WHERE name = ? AND folder_id = ? AND moved_to_after = ?')
          .run(gb, place.name, place.root.id, place.top === 'after' ? 1 : 0);
      }
    }
    db.prepare('UPDATE content_items SET file_size = ? WHERE file_path = ?').run(newSize, to);
  } catch (e) {
    console.log(`[encode] couldn't bring the records of ${path.basename(to)} up to date: ${e.message}`);
  }
  if (from !== to) probe.forget(from);
  probe.refresh(to).then(() => forget()).catch(() => {});
}

// ---------------------------------------------------------------- undo, cleanup, start

/**
 * A swap something cut short, finished or undone from what the record says was moving where and what the disk says
 * got there. At start, and before each cleanup.
 */
function reconcileSwaps() {
  for (const job of db.prepare("SELECT * FROM encode_jobs WHERE phase = 'swapping'").all()) {
    const tmp = tmpOf(job);
    const has = (p) => !!p && fs.existsSync(p);
    const fail = (error, fields = {}) => setJob(job.id, { status: 'failed', phase: null, completed_at: Date.now(), error_message: error, ...fields });
    try {
      if (has(job.held_path) && !has(tmp) && has(job.out_path)) {
        const outFp = fingerprint(job.out_path);
        setJob(job.id, {
          status: 'done', progress: 1, phase: null, error_message: null, completed_at: Date.now(), actual_size_bytes: outFp?.size ?? null,
          out_fp: JSON.stringify(outFp), held_until: Date.now() + HOLD_DAYS * DAY,
        });
        afterSwap(job.source_path, job.out_path, job.original_size_bytes, outFp?.size);
      } else if (has(job.held_path)) {
        if (has(job.source_path)) {
          fail(`Interrupted mid-swap, and another file is at ${path.basename(job.source_path)} now; the original is kept in ${job.held_path}`, { held_until: null });
        } else {
          fs.renameSync(job.held_path, job.source_path);
          if (tmp) fs.rmSync(tmp, { force: true });
          fail('Interrupted while being swapped in; the original is back in place', { held_path: null, out_path: null, held_until: null });
        }
      } else if (has(job.source_path)) {
        if (tmp) fs.rmSync(tmp, { force: true });
        fail('Interrupted just before the swap; nothing was changed', { held_path: null, out_path: null, held_until: null });
      } else {
        setJob(job.id, { status: 'failed', error_message: `The original is missing${has(tmp) ? `; the new file is kept in ${tmp}` : ''}` });
      }
    } catch (e) {
      console.log(`[encode] ${job.label}: couldn't settle an interrupted swap yet (${e.message})`);
    }
  }
}

const conflict = (message) => Object.assign(new Error(message), { status: 409 });

/** A job's own folder in .originals, emptied once its original has gone (deleted, or put back). */
function dropHeldDir(job) {
  const root = rootOf(job.source_path);
  if (!root || !job.held_path) return;
  const dir = path.join(root.path, WORK_DIR, String(job.id));
  if (!job.held_path.startsWith(dir + path.sep) || fs.existsSync(job.held_path)) return;
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* empty folders: harmless */ }
}

/** Put the original back, within the 14 days: the new file goes — only when it's still the file this job put there. */
function undoJob(id) {
  const job = db.prepare('SELECT * FROM encode_jobs WHERE id = ?').get(id);
  if (!job || job.status !== 'done') throw conflict('Only a finished job can be undone');
  if (!job.held_path || !fs.existsSync(job.held_path)) throw conflict('The original isn\'t kept any more');
  const out = job.out_path || job.source_path;
  const there = fingerprint(out);
  const kept = `It's kept in .originals${job.held_until ? ` until ${new Date(job.held_until).toISOString().slice(0, 10)}` : ''}.`;
  if (!there) throw conflict(`${path.basename(out)} isn't there any more (moved or deleted since), so the original wasn't put back. ${kept}`);
  const madeFp = parseJson(job.out_fp);
  if (madeFp ? !sameFile(madeFp, there) : job.actual_size_bytes && there.size !== job.actual_size_bytes) {
    throw conflict(`${path.basename(out)} has changed since this job put it there, so it wasn't deleted and nothing was undone. ${kept}`);
  }
  if (out !== job.source_path) {
    if (fs.existsSync(job.source_path)) throw conflict(`There's a file at ${path.basename(job.source_path)} again, so the original wasn't put back over it. ${kept}`);
    fs.mkdirSync(path.dirname(job.source_path), { recursive: true });
    fs.renameSync(job.held_path, job.source_path);
    fs.rmSync(out, { force: true });
  } else {
    // one rename: the original takes its name back, and the new file is gone with it
    fs.renameSync(job.held_path, job.source_path);
  }
  setJob(id, { status: 'undone', held_path: null, held_until: null, out_fp: null, completed_at: Date.now() });
  dropHeldDir(job);
  afterSwap(out, job.source_path, there.size, job.original_size_bytes);
  forget();
}

/** Originals past their 14 days are deleted; half-written files nobody is writing are cleared. */
function cleanup() {
  reconcileSwaps();
  let deleted = 0;
  for (const j of db.prepare('SELECT id, source_path, held_path FROM encode_jobs WHERE held_path IS NOT NULL AND held_until < ?').all(Date.now())) {
    // the record goes only once the file has: one the share wouldn't delete is tried again next time
    try { fs.rmSync(j.held_path, { force: true }); } catch (e) { console.log(`[encode] couldn't delete ${j.held_path} yet: ${e.message}`); continue; }
    if (fs.existsSync(j.held_path)) continue;
    deleted += 1;
    dropHeldDir(j);
    setJob(j.id, { held_path: null, held_until: null });
  }
  const live = new Set(db.prepare("SELECT id FROM encode_jobs WHERE status = 'running' OR phase = 'swapping'").all().map(r => `${r.id}.part`));
  for (const root of roots()) {
    const tmpDir = path.join(root.path, WORK_DIR, 'tmp');
    let names = [];
    try { names = fs.readdirSync(tmpDir); } catch { continue; }
    for (const n of names) {
      if (live.has(n)) continue;
      try { fs.rmSync(path.join(tmpDir, n), { force: true }); } catch { /* in use */ }
    }
  }
  if (deleted) forget();
  return deleted;
}

/** A remote job whose worker has gone quiet for half an hour goes back to the queue (it's told to drop it if it's back). */
function requeueStale() {
  for (const job of db.prepare("SELECT * FROM encode_jobs WHERE status = 'running' AND worker_id != 'local' AND heartbeat_at < ? AND (phase IS NULL OR phase NOT IN ('verifying','swapping'))").all(Date.now() - STALE_MS)) {
    console.log(`[encode] ${job.label}: its worker went quiet, back in the queue`);
    requeue(job);
  }
}

let started = false;
/** At start: a job this server died in goes back to the queue; a running queue picks up again. */
function startQueue() {
  if (started) return;
  started = true;
  reconcileSwaps();
  db.prepare(`
    UPDATE encode_jobs SET status = 'queued', worker_id = NULL, progress = NULL, speed = NULL, started_at = NULL, phase = NULL, hold = NULL, held = 0
    WHERE status = 'running' AND (worker_id IS NULL OR worker_id = 'local')
  `).run();
  cleanup();
  kick();
  // a worker going offline doesn't call in to say so: look every half minute whether this server should take over
  setInterval(() => { requeueStale(); kick(); }, 30000).unref?.();
  setInterval(cleanup, 60 * 60 * 1000).unref?.();
  probe.onScanned(forget);
}

// ---------------------------------------------------------------- remote workers

const hash = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');
const keyOf = (w) => `w:${w.id}`;

/** A new worker: its name, and the token its link carries (shown once; only the hash is kept). */
function addWorker(name) {
  const token = crypto.randomBytes(24).toString('base64url');
  const clean = String(name || 'Worker').trim().slice(0, 60) || 'Worker';
  const r = db.prepare('INSERT INTO encode_workers (name, token_hash, created_at) VALUES (?, ?, ?)').run(clean, hash(token), Date.now());
  return { id: Number(r.lastInsertRowid), name: clean, token };
}

function relinkWorker(id) {
  const token = crypto.randomBytes(24).toString('base64url');
  const r = db.prepare('UPDATE encode_workers SET token_hash = ? WHERE id = ?').run(hash(token), id);
  if (!r.changes) throw Object.assign(new Error('not found'), { status: 404 });
  return { token };
}

/** Gone: its link stops working, and a job it held goes back to the queue. */
function removeWorker(id) {
  for (const job of db.prepare("SELECT * FROM encode_jobs WHERE status = 'running' AND worker_id = ?").all(`w:${id}`)) requeue(job);
  db.prepare('DELETE FROM encode_workers WHERE id = ?').run(id);
  kick();
}

function setWorkerEnabled(id, on) {
  db.prepare('UPDATE encode_workers SET enabled = ? WHERE id = ?').run(on ? 1 : 0, id);
  kick();
}

const workerForToken = (token) => (token ? db.prepare('SELECT * FROM encode_workers WHERE token_hash = ?').get(hash(token)) || null : null);

function seen(w, info) {
  db.prepare('UPDATE encode_workers SET last_seen = ?, info = COALESCE(?, info) WHERE id = ?')
    .run(Date.now(), info ? JSON.stringify(info).slice(0, 4000) : null, w.id);
}

const heldBy = (w, jobId) => {
  const job = db.prepare('SELECT * FROM encode_jobs WHERE id = ?').get(jobId);
  return job && job.status === 'running' && job.worker_id === keyOf(w) ? job : null;
};

/** A worker calling in: told to drop a job that isn't its any more, and to pause or resume the one it has. */
function workerHeartbeat(w, { info, holding } = {}) {
  seen(w, info);
  let cancel = [];
  const actions = {};
  if (holding) {
    const job = heldBy(w, holding);
    if (!job) cancel = [holding];
    else {
      setJob(job.id, { heartbeat_at: Date.now() });
      const a = actionFor(job);
      if (a !== 'continue') actions[job.id] = a;
    }
  }
  return { paused: !isRunning(), enabled: !!w.enabled, cancel, actions };
}

/** The next job with its exact ffmpeg arguments ({in}, {out}), on the card when the worker has a working NVENC. */
async function workerClaim(w, info) {
  seen(w, info);
  if (!isRunning() || !w.enabled) return null;
  for (let tries = 0; tries < 10; tries++) {
    const job = claimNext(keyOf(w));
    if (!job) return null;
    const prep = await prepareJob(job);
    if (!prep) continue;
    fs.rmSync(prep.tmp, { force: true });
    const encoder = info?.nvenc && !info?.cpuOnly ? 'nvenc' : 'cpu';
    const { args } = ffmpegArgs('{in}', '{out}', prep.f, prep.plan, { encoder });
    setJob(job.id, { phase: 'downloading' });
    console.log(`[encode] ${job.label}: to ${w.name} (${encoder === 'nvenc' ? 'GPU' : 'CPU'})`);
    return {
      id: job.id, label: job.label, kind: prep.plan.kind, why: prep.plan.why, args, encoder, priority: job.priority || 0,
      size: prep.f.size, duration: prep.f.duration, fps: prep.f.fps, ext: path.extname(job.source_path).toLowerCase() || '.mp4', chunk: CHUNK,
      // the original and where the new file goes, as this server sees them: a worker that sees the share
      // (its --map, e.g. /media=Z:/Apps/adultManager/media) reads and writes them there instead of the download and upload
      share: { src: job.source_path, out: prep.tmp },
    };
  }
  return null;
}

function workerProgress(w, jobId, { phase, progress, speed } = {}) {
  seen(w);
  const job = heldBy(w, jobId);
  if (!job) return { cancel: true, action: 'cancel' };
  const known = ['downloading', 'encoding', 'uploading', 'paused', 'waiting'].includes(phase);
  if (known && phase !== 'paused') resuming.delete(job.id);
  setJob(job.id, {
    phase: known ? phase : job.phase,
    held: known ? (phase === 'paused' ? 1 : 0) : job.held,
    progress: Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : job.progress,
    speed: Number.isFinite(speed) ? speed : null,
    heartbeat_at: Date.now(),
  });
  return { cancel: false, action: actionFor(job), priority: job.priority || 0 };
}

function workerSource(w, jobId) {
  seen(w);
  return heldBy(w, jobId)?.source_path || null;
}

function workerReceived(w, jobId) {
  const job = heldBy(w, jobId);
  if (!job) return null;
  try { return fs.statSync(tmpOf(job)).size; } catch { return 0; }
}

const uploading = new Set();
// the most a job's new file may be: twice the original, never less than 64 MB — a worker's token can't fill the share
const uploadCap = (job) => Math.max(64 * 1024 * 1024, 2 * (job.original_size_bytes || fingerprint(job.source_path)?.size || 0));

/** One chunk of the new file at `offset`; out of step it's refused with what has arrived, and the worker goes on from there. */
function workerUpload(w, jobId, offset, req) {
  const job = heldBy(w, jobId);
  if (!job) return Promise.resolve({ status: 410 });
  if (uploading.has(job.id)) return Promise.resolve({ status: 409, error: 'Another upload of this job is still arriving' });
  const tmp = tmpOf(job);
  fs.mkdirSync(path.dirname(tmp), { recursive: true });
  let have = 0;
  try { have = fs.statSync(tmp).size; } catch { /* nothing yet */ }
  if (offset !== have) return Promise.resolve({ status: 409, received: have });
  const cap = uploadCap(job);
  const declared = Number(req.headers['content-length']);
  const tooBig = () => {
    fs.rmSync(tmp, { force: true });
    failJob(job, `The worker's file grew past ${Math.round(cap / 1e6)} MB, twice the original: refused (on ${w.name})`);
  };
  if (Number.isFinite(declared) && have + declared > cap) {
    tooBig();
    return Promise.resolve({ status: 413, error: 'Larger than this job\'s file can be' });
  }
  if (Number.isFinite(declared) && declared > CHUNK * 2) return Promise.resolve({ status: 413, error: 'Chunk too large' });
  uploading.add(job.id);
  return new Promise((resolve) => {
    const out = fs.createWriteStream(tmp, { flags: 'a' });
    let n = 0;
    let refused = null;
    let settled = false;
    const settle = (r) => {
      if (settled) return;
      settled = true;
      uploading.delete(job.id);
      resolve(r);
    };
    const cutBack = () => { try { fs.truncateSync(tmp, have); } catch { /* removed */ } };
    req.on('data', (d) => {
      n += d.length;
      if (refused) return;
      if (have + n > cap) refused = 'cap';
      else if (n > CHUNK * 2) refused = 'chunk';
      if (!refused) return;
      req.unpipe(out);
      req.destroy();
      out.destroy();
      out.once('close', () => {
        if (refused === 'cap') { tooBig(); settle({ status: 413, error: 'Larger than this job\'s file can be' }); } else { cutBack(); settle({ status: 413, error: 'Chunk too large' }); }
      });
    });
    req.pipe(out);
    out.on('finish', () => {
      if (refused) return;
      // removed (or taken back) while this chunk was arriving: what it wrote mustn't stay behind
      if (!heldBy(w, job.id)) {
        try { fs.rmSync(tmp, { force: true }); } catch { /* cleanup() clears it */ }
        return settle({ status: 410 });
      }
      seen(w);
      setJob(job.id, { heartbeat_at: Date.now() });
      settle({ status: 200, received: have + n });
    });
    out.on('error', (e) => { if (!refused) settle({ status: 500, error: e.message }); });
    req.on('aborted', () => { out.destroy(); out.once('close', () => { cutBack(); settle({ status: 400, error: 'upload interrupted' }); }); });
  });
}

/** The worker's upload is complete: check it and swap it in — the same as a job done here. */
async function workerComplete(w, jobId, { size } = {}) {
  seen(w);
  const job = heldBy(w, jobId);
  if (!job) return { status: 410, error: 'That job isn\'t yours any more' };
  const tmp = tmpOf(job);
  let have = 0;
  try { have = fs.statSync(tmp).size; } catch { /* none */ }
  if (!have || (size && have !== size)) return { status: 409, error: `Got ${have} of ${size} bytes`, received: have };
  // before anything waits: from now on Remove and the stale-worker requeue leave the job alone
  setJob(job.id, { phase: 'verifying', heartbeat_at: Date.now() });
  const prep = await prepareJob(job, { claim: false });
  if (!prep) return { status: 409, error: 'The original changed since: not swapped in' };
  const r = await finishJob(job, prep, w.name);
  return r.ok ? { status: 200, ok: true } : { status: 422, error: r.error };
}

function workerFail(w, jobId, error) {
  seen(w);
  const job = heldBy(w, jobId);
  if (!job) return false;
  const tmp = tmpOf(job);
  if (tmp) fs.rmSync(tmp, { force: true });
  failJob(job, `${String(error || 'failed').slice(0, 400)} (on ${w.name})`);
  return true;
}

function listWorkers() {
  const now = Date.now();
  const running = db.prepare("SELECT id, label, worker_id, phase, progress FROM encode_jobs WHERE status = 'running'").all();
  const jobOf = (key) => running.find(j => j.worker_id === key) || null;
  const cpus = os.cpus();
  const eng = localEngine();
  const self = {
    id: 'local', name: 'This server', local: true, online: true, enabled: localWanted(),
    note: !eng.ok ? eng.error : mode() === 'remote' ? 'Off: only linked workers encode' : mode() === 'auto' ? (onlineWorkers() ? 'Waiting: a linked worker is online' : 'Encoding while no linked worker is online') : 'Always encoding',
    info: { encoder: `CPU · ${cpus.length} threads`, cpu: cpus[0]?.model?.trim() || null },
    job: jobOf('local'),
  };
  const remote = db.prepare('SELECT * FROM encode_workers ORDER BY id').all().map(w => ({
    id: w.id, name: w.name, local: false, enabled: !!w.enabled, lastSeen: w.last_seen,
    online: !!w.last_seen && now - w.last_seen < ONLINE_MS, info: parseJson(w.info), job: jobOf(keyOf(w)),
  }));
  return [self, ...remote];
}

// ---------------------------------------------------------------- what to show

const whyOf = (p) => parseJson(p)?.why || [];

/** The queue as the Space page and the Jobs page show it. */
function status() {
  const counts = Object.fromEntries(db.prepare('SELECT status, COUNT(*) AS n FROM encode_jobs GROUP BY status').all().map(r => [r.status, r.n]));
  const workers = listWorkers();
  const now = Date.now();
  const active = db.prepare("SELECT j.*, p.duration FROM encode_jobs j LEFT JOIN media_probe p ON p.path = j.source_path WHERE j.status = 'running' ORDER BY j.started_at").all().map(j => {
    const w = workers.find(x => (x.local ? j.worker_id === 'local' : j.worker_id === `w:${x.id}`));
    const quiet = !w?.local && (!w || !w.online || now - (j.heartbeat_at || 0) > ONLINE_MS * 1.5);
    return {
      id: j.id, label: j.label, path: j.source_path, why: whyOf(j.plan), size: j.original_size_bytes, est: j.estimated_size_bytes,
      worker: w ? { id: w.id, name: w.name, local: !!w.local } : { id: null, name: 'a removed worker' },
      phase: j.phase, progress: j.progress || 0, speed: j.speed, startedAt: j.started_at,
      eta: j.phase === 'encoding' && j.speed > 0 && j.duration ? Math.round((j.duration * (1 - (j.progress || 0))) / j.speed) : null,
      offline: quiet, hold: j.hold || null, held: !!j.held, resuming: resuming.has(j.id), priority: j.priority || 0,
    };
  });
  const queued = db.prepare("SELECT id, label, source_path, plan, original_size_bytes, estimated_size_bytes, priority FROM encode_jobs WHERE status = 'queued' ORDER BY priority DESC, position, id LIMIT 300").all();
  const recent = db.prepare(`
    SELECT id, label, source_path, out_path, plan, status, error_message, original_size_bytes, estimated_size_bytes, actual_size_bytes, completed_at, held_until, held_path IS NOT NULL AS held
    FROM encode_jobs WHERE status IN ('done','failed','undone','skipped') ORDER BY completed_at DESC LIMIT 60
  `).all();
  const eng = localEngine();
  return {
    running: isRunning(), mode: mode(), local: { ok: eng.ok, error: eng.error || null, active: localWanted() },
    active, workers,
    counts: { queued: counts.queued || 0, running: counts.running || 0, done: counts.done || 0, failed: counts.failed || 0, skipped: counts.skipped || 0 },
    queuedSize: db.prepare("SELECT COALESCE(SUM(original_size_bytes), 0) AS n FROM encode_jobs WHERE status = 'queued'").get().n,
    queued: queued.map(j => ({ id: j.id, label: j.label, path: j.source_path, why: whyOf(j.plan), size: j.original_size_bytes, est: j.estimated_size_bytes, priority: j.priority || 0 })),
    recent: recent.map(j => ({
      id: j.id, label: j.label, path: j.out_path || j.source_path, why: whyOf(j.plan), status: j.status, error: j.error_message,
      size: j.original_size_bytes, est: j.estimated_size_bytes, outSize: j.actual_size_bytes, finishedAt: j.completed_at,
      heldUntil: j.held ? j.held_until : null,
    })),
  };
}

let spaceCache = null; // { at, value }

/** Something queued, finished or undone, or the scan found new files: what the pages list is worked out again. */
function forget() {
  spaceCache = null;
  calib = null;
  ours = null;
}

// path → { sig, f, a }: a file as read and what a re-encode would do to it, good while its size, mtime and probe, the
// calibration and what the queue has had of it are the same — so a job finishing doesn't re-read the whole library
let assessed = new Map();
let assessedRoots = null;
const probeRow = db.prepare('SELECT * FROM media_probe WHERE path = ?');

/** The file and its assessment for a media_probe row's path, size, mtime, probed_at and error: from the memo when it holds. */
function assessRow(r) {
  const sig = `${r.size}:${r.mtime}:${r.probed_at}:${r.error ? 1 : 0}|${calibration().factor}|${triedByQueue({ path: r.path, size: r.size }) || ''}`;
  const hit = assessed.get(r.path);
  if (hit && hit.sig === sig) return hit;
  const f = toFile(r.streams !== undefined ? r : probeRow.get(r.path));
  const x = { sig, f, a: assess(f) };
  assessed.set(r.path, x);
  return x;
}

const blank = () => ({ size: 0, files: 0, gain: 0, gainFiles: 0, queued: 0, unprobed: 0 });
function add(x, f, a, active) {
  x.size += f.size || 0;
  x.files += 1;
  if (!f.probed) x.unprobed += 1;
  if (active) x.queued += 1;
  else if (a.plan) { x.gain += a.gain; x.gainFiles += 1; }
}

/**
 * Settings → Space: every performer (before and after filter) and content genre with its videos' size, what a
 * re-encode would save, and how many are queued. Kept half a minute; worked out again, only the files whose
 * assessment can have changed are read and assessed again (assessRow).
 */
function spaceReport() {
  if (spaceCache && Date.now() - spaceCache.at < 30000) return spaceCache.value;
  const all = roots();
  const active = new Set(db.prepare(`SELECT source_path FROM encode_jobs WHERE status IN ${ACTIVE}`).all().map(r => r.source_path));
  const groups = new Map();
  const totals = blank();
  const kept = new Map();
  // a file's place is kept with its assessment, as long as the base folders are the same
  const rootsSig = all.map(r => `${r.id}:${r.path}`).join('|');
  if (rootsSig !== assessedRoots) { assessed = new Map(); assessedRoots = rootsSig; }
  for (const r of db.prepare('SELECT path, size, mtime, probed_at, error FROM media_probe').all()) {
    const x = assessRow(r);
    if (x.place === undefined) x.place = placeOf(r.path, all);
    const place = x.place;
    if (!place) continue;
    kept.set(r.path, x);
    const { f, a } = x;
    let g = groups.get(place.key);
    if (!g) groups.set(place.key, (g = { key: place.key, top: place.top, name: place.name, folderId: place.root.id, ...blank() }));
    add(g, f, a, active.has(r.path));
    add(totals, f, a, active.has(r.path));
  }
  const perf = new Map(db.prepare('SELECT id, name, folder_id, moved_to_after FROM performers').all().map(p => [`${p.folder_id}/${p.moved_to_after ? 'after' : 'before'}/${p.name}`, p.id]));
  const genre = new Map(db.prepare('SELECT id, name, folder_id FROM content_genres').all().map(g => [`${g.folder_id}/content/${g.name}`, g.id]));
  const list = [...groups.values()].map(g => ({ ...g, performerId: perf.get(g.key) ?? null, genreId: genre.get(g.key) ?? null }));
  assessed = kept;   // files gone from the library drop out of the memo
  const jobs = db.prepare(`
    SELECT COALESCE(SUM(CASE WHEN held_path IS NULL THEN original_size_bytes - actual_size_bytes END), 0) AS freed,
           COALESCE(SUM(CASE WHEN held_path IS NOT NULL THEN original_size_bytes - actual_size_bytes END), 0) AS pending,
           COALESCE(SUM(CASE WHEN held_path IS NOT NULL THEN original_size_bytes END), 0) AS held,
           COUNT(*) AS n, MIN(CASE WHEN held_path IS NOT NULL THEN held_until END) AS nextFree
    FROM encode_jobs WHERE status = 'done' AND actual_size_bytes > 0 AND original_size_bytes > 0
  `).get();
  const value = {
    calibration: calibration(),
    totals: {
      ...totals,
      // saved: what finished re-encodes took off; freed once their originals are gone, held in .originals until then
      saved: jobs.freed + jobs.pending, freed: jobs.freed, pending: jobs.pending, held: jobs.held, jobs: jobs.n, nextFree: jobs.nextFree,
    },
    groups: list,
    scan: probe.status(),
  };
  spaceCache = { at: Date.now(), value };
  return value;
}

/** One performer's or genre's videos, folder by folder, each with what a re-encode would do and its last job. */
function groupReport(key) {
  const g = parseKey(key);
  if (!g) throw Object.assign(new Error('Unknown performer or genre'), { status: 404 });
  const dir = g.dir + path.sep;
  const rows = db.prepare('SELECT * FROM media_probe WHERE substr(path, 1, length(@dir)) = @dir').all({ dir });
  // each file's last job, from one query: by its path, or the path a job gave it
  const lastJob = new Map();
  for (const j of db.prepare(`
    SELECT id, source_path, out_path, status, error_message, actual_size_bytes, held_until, held_path IS NOT NULL AS held FROM encode_jobs
    WHERE substr(source_path, 1, length(@dir)) = @dir OR substr(out_path, 1, length(@dir)) = @dir ORDER BY id
  `).all({ dir })) {
    lastJob.set(j.source_path, j);
    if (j.out_path) lastJob.set(j.out_path, j);
  }
  const folders = new Map();
  const files = rows.map(r => {
    const { f, a } = assessRow(r);
    const folder = path.relative(g.dir, path.dirname(r.path)).split(path.sep).filter(Boolean).join('/');
    const j = lastJob.get(r.path);
    const active = j && (j.status === 'queued' || j.status === 'running');
    let x = folders.get(folder);
    if (!x) folders.set(folder, (x = { folder, ...blank() }));
    add(x, f, a, active);
    return {
      path: r.path, name: path.basename(r.path), folder, size: r.size, duration: r.duration, height: shortSide(f) || null,
      codec: r.video_codec, bitrate: r.bitrate, gain: a.gain || 0, expected: a.expected ?? null, why: a.plan ? a.plan.why : [], reason: a.reason || null,
      job: j ? { id: j.id, status: j.status, error: j.error_message, outSize: j.actual_size_bytes, heldUntil: j.held ? j.held_until : null } : null,
    };
  }).sort((a, b) => b.gain - a.gain || b.size - a.size);
  return {
    key, top: g.top, name: g.name,
    folders: [...folders.values()].sort((a, b) => a.folder.localeCompare(b.folder)),
    files,
  };
}

module.exports = {
  HOLD_DAYS, CHUNK, localEngine,
  assess, estimateSize, calibration, fileRow, placeOf, parseKey, ffmpegArgs, verify,
  pathsFor, enqueue, removeJob, clearFinished, setPriority, bumpJob, retryJob, undoJob,
  start, pause, pauseJob, resumeJob, mode, setMode, isRunning, startQueue, cleanup, kick,
  addWorker, relinkWorker, removeWorker, setWorkerEnabled, workerForToken, listWorkers,
  workerHeartbeat, workerClaim, workerProgress, workerSource, workerReceived, workerUpload, workerComplete, workerFail,
  status, spaceReport, groupReport, forget,
};
