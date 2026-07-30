/**
 * funpipe client — funscript generation runs inside the AI Inference App.
 *
 * The pipeline is a Flask blueprint at /funpipe on the same server that already
 * handles DINOv2 inference and video analysis, so it reuses `ai_server_url` —
 * there is no second host or port to configure.
 *
 * Paths are sent exactly as this backend sees them (`/media/...` in the
 * container). The AI app's map_path() rewrites them to its own view of the
 * share, the same way the /video endpoints already work — so nothing here needs
 * to know where the GPU machine mounts the library.
 *
 * Every method resolves rather than throws: the GPU box is often off, and that
 * must never break a file operation here.
 */
const axios = require('axios');
const { getAiServerUrl } = require('../utils/aiUrl');

const TIMEOUT = 8000;
const base = (override) => `${String(getAiServerUrl(override)).replace(/\/+$/, '')}/funpipe`;

function fail(err) {
  const offline = ['ECONNREFUSED', 'ETIMEDOUT', 'ECONNABORTED', 'EHOSTUNREACH', 'ENOTFOUND']
    .includes(err.code);
  return { ok: false, error: offline ? 'AI server is offline' : err.message };
}

async function health(urlOverride) {
  const url = base(urlOverride);
  try {
    const res = await axios.get(`${url}/health`, { timeout: 5000 });
    return { ok: true, url, ...res.data };
  } catch (err) {
    return { ...fail(err), url };
  }
}

async function getQueue(urlOverride) {
  const url = base(urlOverride);
  try {
    const res = await axios.get(`${url}/queue`, { timeout: TIMEOUT });
    return { ok: true, url, ...res.data };
  } catch (err) {
    return { ...fail(err), url, running: false, jobs: [] };
  }
}

/**
 * Queue videos for funscript generation.
 * @param {string[]} videoPaths paths as THIS backend sees them
 * @returns {{queued:boolean, added:number, skipped?:object[], error?:string}}
 */
async function enqueue(videoPaths, options = {}) {
  const { pose = true, autoStart = true, urlOverride } = options;
  const videos = (videoPaths || []).filter(Boolean);
  if (videos.length === 0) return { queued: false, added: 0, error: 'no videos given' };

  const url = base(urlOverride);
  try {
    const res = await axios.post(`${url}/queue/add`,
      { videos, pose, autoStart }, { timeout: TIMEOUT });
    const { added = 0, skipped = [] } = res.data || {};

    // added === 0 with a reason means the pipeline deliberately declined
    // (already processed / already queued) — surface it, it isn't an error.
    return {
      queued: added > 0,
      added,
      skipped,
      reason: added === 0 && skipped.length ? skipped[0].reason : undefined
    };
  } catch (err) {
    const { error } = fail(err);
    console.warn(`[funpipe] enqueue failed (${videos.length} video(s)): ${error}`);
    return { queued: false, added: 0, error };
  }
}

const simplePost = (path) => async (urlOverride) => {
  try {
    const res = await axios.post(`${base(urlOverride)}${path}`, {}, { timeout: TIMEOUT });
    return { ok: true, ...res.data };
  } catch (err) { return fail(err); }
};

const start = simplePost('/queue/start');
const stop = simplePost('/queue/stop');
const clearDone = simplePost('/queue/clear_done');

async function remove(id, urlOverride) {
  try {
    const res = await axios.post(`${base(urlOverride)}/queue/remove`, { id }, { timeout: TIMEOUT });
    return { ok: true, ...res.data };
  } catch (err) { return fail(err); }
}

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

/** @param {string} root folder the editor should scan, as THIS backend sees it */
async function uiStart(root, urlOverride) {
  try {
    // Launching uvicorn + importing torch takes a moment.
    const res = await axios.post(`${base(urlOverride)}/ui/start`, { root }, { timeout: 30000 });
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
  health, getQueue, enqueue, start, stop, remove, clearDone,
  uiStatus, uiStart, uiStop
};
