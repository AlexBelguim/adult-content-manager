/**
 * funpipe client — funscript generation runs inside the AI Inference App, as a worker of this app.
 *
 * The queue is this app's own (services/funpipeQueue.js, funpipe_jobs): the AI app claims a job, downloads the video,
 * runs the stages on its own copy and uploads the sidecars and the funscript, which are written here next to the
 * video (routes/workers.js). The AI app never reads the NAS share. What still goes to the AI app is its health and
 * the review editor, which runs there (it tracks points on the GPU) on copies it pulls when a video is opened.
 *
 * pair() hands the AI app this app's address and the worker token, so nothing has to be set up on the GPU PC.
 *
 * Every method resolves rather than throws: the GPU box is often off, and that must never break a file operation here.
 */
const axios = require('axios');
const { getAiServerUrl } = require('../utils/aiUrl');
const queue = require('./funpipeQueue');

const TIMEOUT = 8000;
const base = (override) => `${String(getAiServerUrl(override)).replace(/\/+$/, '')}/funpipe`;
const aiRoot = (override) => String(getAiServerUrl(override)).replace(/\/+$/, '');

function fail(err) {
  const offline = ['ECONNREFUSED', 'ETIMEDOUT', 'ECONNABORTED', 'EHOSTUNREACH', 'ENOTFOUND']
    .includes(err.code);
  return { ok: false, error: offline ? 'AI server is offline' : err.message };
}

// ── pairing ──────────────────────────────────────────────────
// The AI app needs this app's address and the worker token to claim jobs and fetch files. The address is the one a
// page of this app was opened at (the AI app is on the same network as that browser), sent again every PAIR_MS so
// a restarted AI app, or a new token, is picked up.
const PAIR_MS = 5 * 60 * 1000;
let paired = { url: null, at: 0 };

/** @param {string} appUrl this app's address as a browser reached it (`${req.protocol}://${req.get('host')}`) */
async function pair(appUrl, urlOverride) {
  if (!appUrl || (paired.url === appUrl && Date.now() - paired.at < PAIR_MS)) return;
  paired = { url: appUrl, at: Date.now() };
  try {
    await axios.post(`${aiRoot(urlOverride)}/acm/link`, { url: appUrl, token: queue.workerToken() }, { timeout: 5000 });
  } catch (err) {
    paired.at = 0;   // try again with the next request
  }
}

async function health(urlOverride) {
  const url = base(urlOverride);
  try {
    const res = await axios.get(`${url}/health`, { timeout: 5000 });
    return { ok: true, url, ...res.data, running: queue.list().running };
  } catch (err) {
    return { ...fail(err), url };
  }
}

// ── the queue (this app's own) ───────────────────────────────

async function getQueue(urlOverride) {
  return { url: base(urlOverride), ...queue.list() };
}

/**
 * Queue videos for funscript generation.
 * @param {string[]} videoPaths library paths as this backend sees them
 * @returns {{queued:boolean, added:number, skipped?:object[], reason?:string}}
 */
async function enqueue(videoPaths, options = {}) {
  const videos = (videoPaths || []).filter(Boolean);
  if (videos.length === 0) return { queued: false, added: 0, error: 'no videos given' };
  const { pose = true, autoStart = true } = options;
  const r = queue.enqueue(videos, { pose });
  if (r.added && autoStart) queue.start();
  return r;
}

const start = async () => queue.start();
const stop = async () => queue.stop();
const clearDone = async () => queue.clearDone();
const remove = async (id) => queue.remove(Number(id));

// ── review editor ────────────────────────────────────────────
// funpipe's review UI is FastAPI, so it can't live in the Flask app — the AI
// server spawns it as a child process on demand instead.

/**
 * The AI server reports the editor as http://localhost:<port>, which is only
 * true on the GPU box itself. Re-host it onto whatever address we reach the AI
 * server at, so the link works from a phone, a headset, or any other machine.
 */
function rehost(data, urlOverride) {
  if (!data || !data.url) return data;
  try {
    const ai = new URL(getAiServerUrl(urlOverride));
    const editor = new URL(data.url);
    editor.hostname = ai.hostname;
    return { ...data, url: editor.toString().replace(/\/$/, '') };
  } catch (_) {
    return data;
  }
}

async function uiStatus(urlOverride) {
  try {
    const res = await axios.get(`${base(urlOverride)}/ui/status`, { timeout: TIMEOUT });
    return rehost({ ok: true, ...res.data }, urlOverride);
  } catch (err) { return { ...fail(err), running: false }; }
}

/**
 * Start the editor. It lists the videos funpipe has made a signal for (GET /api/funpipe/library here) and pulls a
 * video and its sidecars to the AI app when one is opened; root narrows the list to one folder.
 * @param {string} root folder to list, as THIS backend sees it (optional)
 */
async function uiStart(root, urlOverride) {
  try {
    // Launching uvicorn + importing torch takes a moment.
    const res = await axios.post(`${base(urlOverride)}/ui/start`, { root: root || null }, { timeout: 30000 });
    return rehost({ ok: true, ...res.data }, urlOverride);
  } catch (err) {
    if (err.response?.data?.error) return { ok: false, error: err.response.data.error };
    return fail(err);
  }
}

async function uiStop(urlOverride) {
  try {
    const res = await axios.post(`${base(urlOverride)}/ui/stop`, {}, { timeout: TIMEOUT });
    return { ok: true, ...res.data };
  } catch (err) { return fail(err); }
}

module.exports = {
  pair, health, getQueue, enqueue, start, stop, remove, clearDone,
  uiStatus, uiStart, uiStop
};
