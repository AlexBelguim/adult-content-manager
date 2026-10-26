/**
 * scenetest client — labels (labelmaster's scenes) and funscripts from the scenes run in scenetest on the GPU PC.
 *
 * Its queue is shared with scenetest's own library backlog; jobs queued from here carry source 'app' and run
 * ahead of the backlog. scenetest sees the library through the share, so paths go out as share paths
 * (app_settings.scenetest_media_root, default Z:\Apps\adultManager\media\) and come back as the app's.
 * URL: app_settings.scenetest_url, else the AI server's host on port 8199. scenetest itself must listen on the
 * LAN and allow this NAS ("host" / "allow" in its data/settings.json).
 *
 * Every method resolves rather than throws: the GPU PC is often off.
 */
const axios = require('axios');
const path = require('path');
const db = require('../db');
const config = require('../config');
const { getAiServerUrl } = require('../utils/aiUrl');

const TIMEOUT = 8000;
const setting = (key) => db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key)?.value;

function baseUrl() {
  const own = setting('scenetest_url');
  if (own) return own.replace(/\/+$/, '');
  const ai = new URL(getAiServerUrl());
  return `${ai.protocol}//${ai.hostname}:8199`;
}

const shareRoot = () => setting('scenetest_media_root') || 'Z:\\Apps\\adultManager\\media\\';

/** /media/after filter performer/x/vids/a.mp4 → Z:\Apps\adultManager\media\after filter performer\x\vids\a.mp4 */
const toShare = (appPath) => shareRoot() + path.relative(config.mediaBasePath, appPath).split(path.sep).join('\\');

function toApp(sharePath) {
  const root = shareRoot();
  return sharePath.toLowerCase().startsWith(root.toLowerCase())
    ? path.posix.join(config.mediaBasePath.split(path.sep).join('/'), ...sharePath.slice(root.length).split('\\'))
    : sharePath;
}

function fail(err) {
  const offline = ['ECONNREFUSED', 'ETIMEDOUT', 'ECONNABORTED', 'EHOSTUNREACH', 'ENOTFOUND'].includes(err.code);
  return { ok: false, error: offline ? 'scenetest is not reachable on the GPU PC' : err.response?.status === 403
    ? 'scenetest refuses this NAS: add its IP to "allow" in scenetest\'s data/settings.json' : err.message };
}

/**
 * { ok, paused, running, jobs: the app's jobs, paths as the app's }. scenetest stamps jobs in the GPU PC's local
 * time; its `now` in the same answer turns them into epoch ms here (startedMs, finishedMs), zone and clock skew included.
 */
async function getState() {
  try {
    const { data } = await axios.get(`${baseUrl()}/api/state`, { timeout: TIMEOUT });
    const asUtc = (s) => (s ? Date.parse(s.replace(' ', 'T') + 'Z') : NaN);
    const offset = Date.now() - asUtc(data.now);
    const ms = (s) => (Number.isFinite(asUtc(s)) && Number.isFinite(offset) ? asUtc(s) + offset : null);
    const jobs = data.jobs.filter(j => j.source === 'app')
      .map(j => ({ ...j, path: toApp(j.path), startedMs: ms(j.started), finishedMs: ms(j.finished) }));
    return { ok: true, url: baseUrl(), paused: data.paused, running: data.running, jobs };
  } catch (err) {
    return { ...fail(err), url: baseUrl() };
  }
}

/** Queue labels and/or funscripts for app paths. Returns { ok, labels, funscript, missing }. */
async function queue(appPaths, steps, skipDone) {
  try {
    const { data } = await axios.post(`${baseUrl()}/api/pipeline`, { paths: appPaths.map(toShare), steps, skip_done: skipDone },
      { timeout: 30000 });
    return { ok: true, ...data };
  } catch (err) {
    return fail(err);
  }
}

async function post(endpoint) {
  try {
    await axios.post(`${baseUrl()}${endpoint}`, {}, { timeout: TIMEOUT });
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

const pause = (on) => post(`/api/pause/${on ? 1 : 0}`);
const act = (jobId, action) => post(`/api/job/${encodeURIComponent(jobId)}/${action}`);

module.exports = { getState, queue, pause, act, toShare, toApp };
