/**
 * Videos the browser cannot play as they are, converted while they play.
 *
 * Every video is probed once (ffprobe, kept in memory per path, size and mtime) and gets a plan:
 *   direct     the file goes out as it is, with range requests (mp4/m4v/mov/webm whose codecs the browser decodes)
 *   remux      the streams are copied into fragmented MP4 (h264, or hevc/av1 when the browser says it decodes them);
 *              audio is copied when it is aac or mp3, else made aac
 *   transcode  everything else: h264 + aac, fast preset
 * The browser says what it decodes with ?can=h264,hevc,aac,... (canPlayType). A request without it (the scene editor,
 * the duplicate compare view, VR) gets the old behaviour for mp4/m4v/mov/webm: the file as it is, with range requests;
 * other files are planned with the defaults below.
 *
 * A conversion starts at ?start=<seconds> (-ss before -i). A remux can only start on a keyframe, so the player first
 * asks keyframeAt() where the stream will really begin and adds that offset to the time it shows. Errors before the
 * first byte go out as a proper status; ffmpeg is killed when the client goes away; at most MAX_CONVERSIONS run at a
 * time and a client (?client=<id>, else its address) has PER_CLIENT of them: a new one ends that client's oldest.
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ffmpegBin = () => process.env.FFMPEG_PATH || require('ffmpeg-static');
const ffprobeBin = () => process.env.FFPROBE_PATH || require('ffprobe-static').path;

const MAX_CONVERSIONS = 2;
const PER_CLIENT = 1;            // a player tab (it sends ?client=) plays one video at a time
const PER_ADDRESS = 2;           // callers without an id (the duplicate compare view shows two videos side by side)
const FIRST_BYTE_MS = 45000;     // a conversion that gives nothing for this long is given up
const PROBE_TIMEOUT_MS = 30000;
const CACHE_MAX = 500;
const MAX_SIDE = 1920;           // a transcode is scaled down to this on its long side

const DIRECT_MP4 = new Set(['.mp4', '.m4v', '.mov']);
const DIRECT_WEBM = new Set(['.webm']);
const DEFAULT_CAN = ['h264', 'hevc', 'aac', 'mp3'];
const MP4_VIDEO = new Set(['h264', 'hevc', 'av1']);   // copied into fragmented MP4 when the browser decodes them
const MP4_AUDIO = new Set(['aac', 'mp3']);            // copied as they are; any other audio becomes aac
const COVER = new Set(['mjpeg', 'png', 'bmp', 'gif', 'webp']);
// Pixel formats the browsers' decoders take, per codec (h264 High 10 / 4:2:2 is not played by Chrome or Firefox).
const PIX_OK = {
  h264: ['yuv420p', 'yuvj420p'],
  hevc: ['yuv420p', 'yuvj420p', 'yuv420p10le'],
  av1: ['yuv420p', 'yuv420p10le'],
  vp9: ['yuv420p', 'yuv420p10le'],
  vp8: ['yuv420p'],
};

const CONTENT_TYPES = {
  '.mp4': 'video/mp4',
  '.mkv': 'video/x-matroska',
  '.webm': 'video/webm',
  '.avi': 'video/x-msvideo',
  '.mov': 'video/quicktime',
  '.wmv': 'video/x-ms-wmv',
  '.flv': 'video/x-flv',
  '.m4v': 'video/x-m4v',
  '.ts': 'video/mp2t',
};

/* ── probe ── */

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};
const codecOf = (s) => String(s.codec_name || '').toLowerCase();
/**
 * Cover art: a picture stream marked attached_pic, or a still-picture codec (mjpeg, png, ...) with one frame, or with
 * neither a frame count nor a duration. A Motion-JPEG video (old cameras) has many frames and is the video.
 */
function isCover(s) {
  if (s.disposition?.attached_pic === 1) return true;
  if (!COVER.has(codecOf(s))) return false;
  const frames = Number(s.nb_frames);
  if (Number.isFinite(frames) && frames > 0) return frames <= 1;
  return !num(s.duration) && !s.tags?.DURATION && !s.tags?.duration;
}

/** ffprobe's JSON as the plan reads it: { duration, start, size, video: {...} | null, audio: {...} | null }. */
function parseProbe(j) {
  const streams = (j && j.streams) || [];
  const videos = streams.filter((s) => s.codec_type === 'video' && !isCover(s));
  // a real video codec first: a Motion-JPEG stream is the video only when there is no other
  const v = videos.find((s) => !COVER.has(codecOf(s))) || videos[0];
  const a = streams.find((s) => s.codec_type === 'audio');
  let video = null;
  if (v) {
    let width = v.width || null;
    let height = v.height || null;
    let rotation = parseInt(v.tags?.rotate, 10) || 0;
    const side = (v.side_data_list || []).find((s) => s.rotation !== undefined);
    if (side) rotation = parseInt(side.rotation, 10) || 0;
    if (Math.abs(rotation) % 180 === 90) [width, height] = [height, width];
    const depth = /(\d+)(le|be)$/.exec(v.pix_fmt || '');
    video = {
      index: v.index,
      codec: String(v.codec_name || '').toLowerCase() || null,
      pix_fmt: v.pix_fmt || null,
      bit_depth: num(v.bits_per_raw_sample) || (depth ? Number(depth[1]) : 8),
      width,
      height,
    };
  }
  const start = parseFloat(j?.format?.start_time);
  return {
    container: String(j?.format?.format_name || '').split(',')[0] || null,
    duration: num(j?.format?.duration) || num(v?.duration),
    start: Number.isFinite(start) ? start : 0,
    size: num(j?.format?.size),
    video,
    audio: a ? { index: a.index, codec: String(a.codec_name || '').toLowerCase() || null, channels: a.channels || null } : null,
  };
}

function runFfprobe(args) {
  return new Promise((resolve, reject) => {
    let out = '';
    let err = '';
    let child;
    try {
      child = spawn(ffprobeBin(), args, { windowsHide: true });
    } catch (e) {
      reject(e);
      return;
    }
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

async function defaultProber(file) {
  const p = parseProbe(await runFfprobe(['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file]));
  if (!p.video && !p.audio) throw new Error('there is no video or audio in this file');
  return p;
}
let prober = defaultProber;

const cache = new Map();     // `${path}|${size}|${mtime}` -> probe
const inflight = new Map();  // same key -> Promise

function remember(map, key, value) {
  map.delete(key);
  map.set(key, value);
  while (map.size > CACHE_MAX) map.delete(map.keys().next().value);
}

/** The probe of `file`, once per path + size + mtime. `stat` saves a second stat when the caller has one. */
async function probe(file, stat) {
  const st = stat || await fs.promises.stat(file);
  const key = `${file}|${st.size}|${Math.round(st.mtimeMs)}`;
  if (cache.has(key)) return cache.get(key);
  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    try {
      const result = await prober(file);
      remember(cache, key, result);
      return result;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

/* ── plan ── */

/** ?can=h264,hevc,aac → Set. Unknown words are dropped; nothing usable gives the defaults. */
function parseCan(value) {
  const words = String(value || '').toLowerCase().split(',').map((w) => w.trim()).filter((w) => /^[a-z0-9]{2,12}$/.test(w)).slice(0, 24);
  return new Set(words.length ? words : DEFAULT_CAN);
}

const decodes = (v, can) => !!v && !!v.codec && can.has(v.codec) && (!v.pix_fmt || !PIX_OK[v.codec] || PIX_OK[v.codec].includes(v.pix_fmt));

/** The audio of a converted stream: copied when MP4 takes it and the browser decodes it, else made aac. */
const audioPlan = (a, can) => (a ? { index: a.index, codec: a.codec, copy: MP4_AUDIO.has(a.codec) && can.has(a.codec) } : null);

/**
 * How `probeResult` (parseProbe's shape, or null when it could not be probed) goes to a browser that decodes `can`.
 * -> { mode: 'direct' | 'remux' | 'transcode', reason, video: { index, codec, copy } | null, audio: { index, codec, copy } | null }
 * `force` ('direct' | 'remux' | 'transcode') asks for a mode; remux is only given when the video can be copied.
 * `legacy`: the caller did not say what it decodes (no ?can=): mp4/m4v/mov/webm go as they are, as they always did,
 * since such a caller seeks them natively and cannot seek a converted stream.
 */
function decidePlan(probeResult, { ext = '', can = new Set(DEFAULT_CAN), force = null, legacy = false } = {}) {
  const e = String(ext || '').toLowerCase();
  const p = probeResult;
  const directExt = DIRECT_MP4.has(e) || DIRECT_WEBM.has(e);
  if (legacy && directExt && !force) {
    return { mode: 'direct', reason: 'as it is (the caller did not say what it decodes)', video: null, audio: null };
  }
  if (!p) {
    // Unknown codecs: a browser-friendly container goes as it is (as before), anything else is converted fully.
    if (force === 'direct' || (directExt && force !== 'transcode' && force !== 'remux')) {
      return { mode: 'direct', reason: 'not probed', video: null, audio: null };
    }
    return { mode: 'transcode', reason: 'not probed', video: { index: null, codec: null, copy: false }, audio: { index: null, codec: null, copy: false } };
  }
  const v = p.video;
  const a = p.audio;
  const videoOk = !v || decodes(v, can);
  const audioOk = !a || can.has(a.codec);
  let containerOk = false;
  if (DIRECT_MP4.has(e)) containerOk = !v || ['h264', 'hevc', 'av1', 'vp9'].includes(v.codec);
  else if (DIRECT_WEBM.has(e)) containerOk = (!v || ['vp8', 'vp9', 'av1'].includes(v.codec)) && (!a || ['opus', 'vorbis'].includes(a.codec));

  if (force === 'direct' || (!force && containerOk && videoOk && audioOk)) {
    return { mode: 'direct', reason: 'plays as it is', video: null, audio: null };
  }
  const audio = audioPlan(a, can);
  if (force !== 'transcode' && v && videoOk && MP4_VIDEO.has(v.codec)) {
    const why = !containerOk ? `the browser does not open ${e.replace('.', '') || 'this'} files` : 'its audio is not played by the browser';
    return { mode: 'remux', reason: why, video: { index: v.index, codec: v.codec, copy: true }, audio };
  }
  if (!v) {
    return { mode: 'transcode', reason: 'its audio is not played by the browser', video: null, audio: audio && { ...audio, copy: false } };
  }
  return {
    mode: 'transcode',
    reason: v.codec ? `the browser does not decode ${v.codec}${v.pix_fmt && PIX_OK[v.codec] && !PIX_OK[v.codec].includes(v.pix_fmt) ? ` ${v.pix_fmt}` : ''}` : 'unknown video',
    video: { index: v.index, codec: v.codec, copy: false },
    audio,
  };
}

/** Seconds for -ss: rounded UP to the millisecond, so a backward seek to a keyframe's time lands on that keyframe. */
const fmtSeconds = (t) => (Math.ceil(Math.max(0, Number(t) || 0) * 1000) / 1000).toFixed(3);

/** Even WxH with the long side at most `max`, or null when it already fits (or the size is unknown). */
function scaleFor(width, height, max = MAX_SIDE) {
  if (!width || !height || Math.max(width, height) <= max) return null;
  const k = max / Math.max(width, height);
  const even = (n) => Math.max(2, Math.round((n * k) / 2) * 2);
  return { width: even(width), height: even(height) };
}

/** ffmpeg's arguments for a converted stream of `file` from `start` seconds, to stdout as fragmented MP4. */
function buildArgs({ file, plan, start = 0, probe: p = null }) {
  const args = ['-hide_banner', '-nostdin', '-loglevel', 'error'];
  if (start > 0) args.push('-ss', fmtSeconds(start));
  args.push('-i', file);
  const v = plan.video;
  const a = plan.audio;
  if (v) args.push('-map', v.index != null ? `0:${v.index}` : '0:v:0?');
  else args.push('-vn');
  if (a) args.push('-map', a.index != null ? `0:${a.index}` : '0:a:0?');
  else args.push('-an');
  args.push('-sn', '-dn', '-map_chapters', '-1');
  if (v && v.copy) {
    args.push('-c:v', 'copy');
    if (v.codec === 'hevc') args.push('-tag:v', 'hvc1');
  } else if (v) {
    args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-profile:v', 'high',
      // a keyframe every 2 s: fragments (and so the first picture) come quickly
      '-force_key_frames', 'expr:gte(t,n_forced*2)');
    const size = scaleFor(p?.video?.width, p?.video?.height);
    if (size) args.push('-vf', `scale=${size.width}:${size.height}`);
  }
  if (a && a.copy) args.push('-c:a', 'copy');
  else if (a) args.push('-c:a', 'aac', '-b:a', '160k');
  args.push(
    '-avoid_negative_ts', 'make_zero',
    '-max_muxing_queue_size', '1024',
    '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
    '-frag_duration', '1000000',
    '-f', 'mp4', 'pipe:1'
  );
  return args;
}

/* ── keyframes ── */

/** The latest keyframe at or before `t` (file seconds) among ffprobe's packets, or null. `base` is the file's start. */
function lastKeyframe(j, t, base = 0) {
  let best = null;
  for (const pk of (j && j.packets) || []) {
    if (!String(pk.flags || '').includes('K')) continue;
    const abs = parseFloat(pk.pts_time !== undefined && pk.pts_time !== 'N/A' ? pk.pts_time : pk.dts_time);
    if (!Number.isFinite(abs)) continue;
    const at = Math.max(0, abs - base);
    if (at <= t + 0.0005 && (best === null || at > best)) best = at;
  }
  return best;
}

const keyCache = new Map();

/**
 * Where a remux asked to start at `t` really begins: the keyframe at or before it (ffmpeg's -ss seeks back to it).
 * Reads only the packets of the main video in a window before `t`. Falls back to `t` when it cannot tell.
 */
async function keyframeAt(file, t, stat) {
  const p = await probe(file, stat);
  const v = p && p.video;
  if (!v || !(t > 0)) return 0;
  const st = stat || await fs.promises.stat(file);
  const key = `${file}|${Math.round(st.mtimeMs)}|${Math.round(t * 1000)}`;
  if (keyCache.has(key)) return keyCache.get(key);
  const base = p.start || 0;
  let found = null;
  let fromZero = false;
  for (const back of [15, 120]) {
    const from = Math.max(0, t - back);
    fromZero = from === 0;
    const j = await runFfprobe(['-v', 'error', '-select_streams', String(v.index), '-show_entries', 'packet=pts_time,dts_time,flags',
      '-read_intervals', `${(from + base).toFixed(3)}%${(t + base + 0.001).toFixed(3)}`, '-of', 'json', file]);
    found = lastKeyframe(j, t, base);
    if (found !== null || fromZero) break;
  }
  // Nothing found from the start on: the stream starts with its first keyframe. Else: no better guess than t.
  const at = found !== null ? found : fromZero ? 0 : t;
  remember(keyCache, key, at);
  return at;
}

/* ── conversions in flight ── */

const active = [];   // oldest first: { client, child, res, file, startedAt }

/** Stop one conversion: ffmpeg is killed; a response not begun gets `status`, a begun one ends where it is. */
function endConversion(entry, why, status = 503, message = 'Another video took the converter') {
  const i = active.indexOf(entry);
  if (i >= 0) active.splice(i, 1);
  entry.ended = why;
  try { entry.child.stdout.unpipe(entry.res); } catch (e) { /* not piped yet */ }
  if (entry.child.exitCode === null && !entry.child.killed) entry.child.kill('SIGKILL');
  const { res } = entry;
  if (!res.headersSent) res.status(status).send({ error: message });
  else if (!res.writableEnded) res.end();
}

/** Make room for a new conversion for `client` (whose limit is `perClient`), then count it. */
function claimSlot(entry, perClient) {
  const mine = active.filter((e) => e.client === entry.client);
  while (mine.length >= perClient) endConversion(mine.shift(), 'replaced');
  while (active.length >= MAX_CONVERSIONS) endConversion(active[0], 'busy');
  active.push(entry);
}

const releaseSlot = (entry) => {
  const i = active.indexOf(entry);
  if (i >= 0) active.splice(i, 1);
};

const activeConversions = () => active.map((e) => ({ client: e.client, file: e.file, mode: e.mode, start: e.start, startedAt: e.startedAt }));

/* ── HTTP ── */

/** As before: the file as it is, 2 MB a request when the browser asks for an open range. */
function sendDirect(req, res, file, stat, ext) {
  const fileSize = stat.size;
  const contentType = CONTENT_TYPES[ext] || 'video/mp4';
  const range = req.headers.range;
  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    let start = parseInt(parts[0], 10);
    let end = parts[1] ? parseInt(parts[1], 10) : NaN;
    if (Number.isNaN(start) && !Number.isNaN(end)) {   // bytes=-500: the last 500 bytes
      start = Math.max(0, fileSize - end);
      end = fileSize - 1;
    }
    const CHUNK_SIZE = 2 * 1024 * 1024;
    if (Number.isNaN(end)) end = Math.min(start + CHUNK_SIZE - 1, fileSize - 1);
    end = Math.min(end, fileSize - 1);
    if (!(start >= 0) || start > end) {
      res.writeHead(416, { 'Content-Range': `bytes */${fileSize}` });
      return res.end();
    }
    const stream = fs.createReadStream(file, { start, end });
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*',
    });
    stream.pipe(res);
    res.on('close', () => stream.destroy());   // releases the file lock when the client goes away
    stream.on('error', (err) => {
      console.error('[Video Stream] Stream error:', err.message);
      if (!res.headersSent) res.status(500).send({ error: 'Stream error' });
      else res.destroy();
    });
    return undefined;
  }
  res.writeHead(200, {
    'Content-Length': fileSize,
    'Content-Type': contentType,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=3600',
    'Access-Control-Allow-Origin': '*',
  });
  if (req.method === 'HEAD') return res.end();
  const stream = fs.createReadStream(file);
  stream.pipe(res);
  res.on('close', () => stream.destroy());
  stream.on('error', (err) => {
    console.error('[Video Stream] Stream error:', err.message);
    if (!res.headersSent) res.status(500).send({ error: 'Stream error' });
    else res.destroy();
  });
  return undefined;
}

const clientKey = (req) => {
  const id = String(req.query.client || '');
  return /^[\w-]{1,64}$/.test(id) ? { key: `c:${id}`, limit: PER_CLIENT } : { key: `ip:${req.ip}`, limit: PER_ADDRESS };
};

/** A converted stream: 200 only once ffmpeg gave its first bytes, else an error status with ffmpeg's reason. */
function sendConverted(req, res, { file, plan, probe: p, start }) {
  const headers = {
    'Content-Type': 'video/mp4',
    'Cache-Control': 'no-store',
    'Accept-Ranges': 'none',
    'Access-Control-Allow-Origin': '*',
    'X-Start-Time': String(start),
    'X-Stream-Mode': plan.mode,
  };
  if (req.method === 'HEAD') {
    res.writeHead(200, headers);
    return res.end();
  }
  const args = buildArgs({ file, plan, start, probe: p });
  let child;
  try {
    child = spawn(ffmpegBin(), args, { windowsHide: true });
  } catch (e) {
    return res.status(500).send({ error: `Could not start ffmpeg: ${e.message}` });
  }
  const { key, limit } = clientKey(req);
  const entry = { client: key, child, res, file, mode: plan.mode, start, startedAt: Date.now(), ended: null };
  claimSlot(entry, limit);
  console.log(`[Video Stream] ${plan.mode} from ${start}s: ${path.basename(file)}`);

  let stderr = '';
  let started = false;
  const timer = setTimeout(() => {
    if (started || entry.ended) return;
    endConversion(entry, 'timeout', 504, 'The conversion did not start in time');
  }, FIRST_BYTE_MS);

  child.stderr.on('data', (d) => { stderr = (stderr + d).slice(-2000); });
  child.stdout.once('data', (chunk) => {
    if (entry.ended || res.writableEnded) return;
    started = true;
    clearTimeout(timer);
    res.writeHead(200, headers);
    res.write(chunk);
    child.stdout.pipe(res);
  });
  child.on('error', (err) => {
    clearTimeout(timer);
    releaseSlot(entry);
    console.error('[Video Stream] ffmpeg could not run:', err.message);
    if (!res.headersSent) res.status(500).send({ error: `ffmpeg could not run: ${err.message}` });
  });
  child.on('close', (code) => {
    clearTimeout(timer);
    releaseSlot(entry);
    if (entry.ended) return;
    const reason = stderr.trim().split('\n').pop() || `ffmpeg exited ${code}`;
    if (!started) {
      if (!res.headersSent) {
        console.error(`[Video Stream] ${plan.mode} failed: ${reason}`);
        res.status(code === 0 ? 500 : 422).send({ error: `Could not convert this video: ${reason}` });
      }
      return;
    }
    if (code !== 0 && code !== null) console.error(`[Video Stream] ffmpeg exited ${code}: ${reason}`);
    if (!res.writableEnded) res.end();
  });
  // The client went away (closed, seeked, next video): stop converting.
  res.on('close', () => {
    clearTimeout(timer);
    releaseSlot(entry);
    if (child.exitCode === null && !child.killed) child.kill('SIGKILL');
  });
  return undefined;
}

const parseStart = (q) => {
  const t = parseFloat(q.start !== undefined ? q.start : q.startTime);
  return Number.isFinite(t) && t > 0 ? t : 0;
};
const parseForce = (m) => (['direct', 'remux', 'transcode'].includes(m) ? m : null);

/**
 * GET /api/files/stream-video?path=&start=&can=&mode=&client=
 * `file` is the path that exists on disk (the route resolves it); `startTime` is the old name of `start`.
 */
async function streamVideo(req, res, file) {
  const stat = await fs.promises.stat(file);
  const ext = path.extname(file).toLowerCase();
  let p = null;
  try {
    p = await probe(file, stat);
  } catch (e) {
    console.warn(`[Video Stream] probe failed for ${path.basename(file)}: ${e.message}`);
  }
  const legacy = String(req.query.can == null ? '' : req.query.can).trim() === '';
  const plan = decidePlan(p, { ext, can: parseCan(req.query.can), force: parseForce(req.query.mode), legacy });
  if (plan.mode === 'direct') return sendDirect(req, res, file, stat, ext);
  let start = parseStart(req.query);
  if (p && p.duration && start >= p.duration) {
    return res.status(416).send({ error: 'The start is past the end of the video' });
  }
  if (p && p.duration) start = Math.min(start, p.duration);
  return sendConverted(req, res, { file, plan, probe: p, start });
}

/** What the player needs to know before it loads a video. */
async function describe(file, can) {
  const stat = await fs.promises.stat(file);
  const ext = path.extname(file).toLowerCase();
  const p = await probe(file, stat);
  const plan = decidePlan(p, { ext, can });
  return {
    duration: p.duration || null,
    mode: plan.mode,
    reason: plan.reason,
    video: p.video ? { codec: p.video.codec, pix_fmt: p.video.pix_fmt, width: p.video.width, height: p.video.height } : null,
    audio: p.audio ? { codec: p.audio.codec, channels: p.audio.channels } : null,
  };
}

module.exports = {
  streamVideo,
  describe,
  keyframeAt,
  probe,
  parseProbe,
  parseCan,
  decidePlan,
  buildArgs,
  lastKeyframe,
  scaleFor,
  fmtSeconds,
  activeConversions,
  MAX_CONVERSIONS,
  DEFAULT_CAN,
  // for tests: replace ffprobe, and forget what was probed
  _setProber: (fn) => { prober = fn || defaultProber; cache.clear(); inflight.clear(); keyCache.clear(); },
};
