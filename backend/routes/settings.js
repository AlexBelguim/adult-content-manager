/**
 * App settings (app_settings), shown in Settings.
 *
 *   GET    /                               every setting but the secret ones
 *   GET    /effective/ai_server_url        { url, source: coordinator | saved | env | default, saved, env }
 *   GET    /:key                           { value } (null when not set)
 *   POST   /:key                           { value } → { success, value: what was stored } | 400 | 403
 *   DELETE /:key                           back to the default
 *
 * Secret keys (tokens, passwords, license data) are never read or written here, and the coordinator's keys are set
 * only by connecting or disconnecting it (routes/coordinator.js). Keys in VALIDATE are checked and cleaned before
 * they are stored; any other key is stored as given.
 */
const express = require('express');
const router = express.Router();
const db = require('../db');

const SECRET = /(token|secret|password|license|gumroad)/i;
const OWN_ROUTE = new Set(['coordinator_url', 'coordinator_worker_id']);
const NOT_READABLE = 'This setting is not readable here';
const NOT_WRITABLE = 'This setting cannot be changed here';
const WORKERS_ONLY = 'Change it in Settings → Workers';
const DEFAULT_AI_URL = 'http://localhost:3344';

const fail = (message, status = 400) => Object.assign(new Error(message), { status });

function url(v) {
  let s = String(v ?? '').trim();
  if (!s) throw fail('Enter an address, or clear the field to use the default');
  if (!/^[a-z]+:\/\//i.test(s)) s = `http://${s}`;
  const notAddress = 'Not an address: use host:port, for example 192.168.1.40:3344';
  let u;
  try { u = new URL(s); } catch { throw fail(notAddress); }
  if (!['http:', 'https:'].includes(u.protocol) || !u.host) throw fail(notAddress);
  return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}`;
}

function shareRoot(v) {
  let s = String(v ?? '').trim();
  if (!s) throw fail('Enter the share path, or clear the field to use the default');
  if (!/[\\/]$/.test(s)) s += '\\';
  return s;
}

function bool(v) {
  if (v === true || v === 'true') return 'true';
  if (v === false || v === 'false') return 'false';
  throw fail('Use true or false');
}

// the Filter view's keys (frontend utils/settings.js); Space and Escape are fixed there (play/pause, close), Tab moves focus
const SHORTCUT_ACTIONS = {
  keep: 'Keep', delete: 'Delete', move_to_funscript: 'Move to funscript', undo: 'Undo', prev: 'Previous', next: 'Next'
};
const RESERVED = new Set([' ', 'Space', 'Escape', 'Tab']);
const keyLabel = (k) => (k.length === 1 ? k.toUpperCase() : k);

function shortcuts(v) {
  let o = v;
  if (typeof o === 'string') {
    try { o = JSON.parse(o); } catch { throw fail('Not valid JSON'); }
  }
  if (!o || typeof o !== 'object' || Array.isArray(o)) throw fail('Shortcuts are an object of action and key');
  const seen = new Set();
  for (const [action, key] of Object.entries(o)) {
    const name = SHORTCUT_ACTIONS[action];
    if (!name) throw fail(`Not an action: ${action}`);
    if (typeof key !== 'string' || key.length > 20) throw fail(`${name}: a key is a text of at most 20 characters`);
    if (RESERVED.has(key)) throw fail(`${key === ' ' ? 'Space' : key} cannot be a shortcut`);
    if (!key) continue;
    const same = key.length === 1 ? key.toLowerCase() : key;
    if (seen.has(same)) throw fail(`${keyLabel(key)} is used twice`);
    seen.add(same);
  }
  return JSON.stringify(o);
}

const VALIDATE = {
  ai_server_url: url,
  scenetest_url: url,
  scenetest_media_root: shareRoot,
  save_deleted_for_training: bool,
  shortcuts
};

const getValue = (key) => db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key)?.value ?? null;
const clearAiCache = (key) => { if (key === 'ai_server_url') require('../utils/aiUrl').clearCache(); };
const writable = (key) => {
  if (SECRET.test(key)) throw fail(NOT_WRITABLE, 403);
  if (OWN_ROUTE.has(key)) throw fail(WORKERS_ONLY, 403);
};

// every handler: a thrown error with a status is the answer; anything else is a 500
const handle = (fn) => (req, res) => {
  try {
    res.json(fn(req));
  } catch (err) {
    if (!err.status) console.error('[settings]', err);
    res.status(err.status || 500).json({ error: err.message });
  }
};

router.get('/', handle(() => {
  const out = {};
  for (const { key, value } of db.prepare('SELECT key, value FROM app_settings').all()) {
    if (key != null && !SECRET.test(key)) out[key] = value;
  }
  return out;
}));

// where acm-gpu is reached, and why (the order of utils/aiUrl.js)
router.get('/effective/ai_server_url', handle(() => {
  const saved = getValue('ai_server_url') || null;
  const env = process.env.AI_SERVER_URL || null;
  const fromCoordinator = require('../services/coordinator').gpuUrl();
  if (fromCoordinator) return { url: fromCoordinator, source: 'coordinator', saved, env };
  if (saved) return { url: saved, source: 'saved', saved, env };
  if (env) return { url: env, source: 'env', saved, env };
  return { url: DEFAULT_AI_URL, source: 'default', saved, env };
}));

router.get('/:key', handle((req) => {
  if (SECRET.test(req.params.key)) throw fail(NOT_READABLE, 403);
  return { value: getValue(req.params.key) };
}));

router.post('/:key', handle((req) => {
  const { key } = req.params;
  writable(key);
  const value = VALIDATE[key] ? VALIDATE[key](req.body?.value) : req.body?.value;
  db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value);
  clearAiCache(key);
  return { success: true, value };
}));

router.delete('/:key', handle((req) => {
  const { key } = req.params;
  writable(key);
  db.prepare('DELETE FROM app_settings WHERE key = ?').run(key);
  clearAiCache(key);
  return { success: true };
}));

module.exports = router;
