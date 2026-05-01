/**
 * Centralized AI Server URL resolver.
 *
 * Priority order:
 * 1. Per-request override (passed in request body/query)
 * 2. Database setting (app_settings.ai_server_url) — configurable from UI
 * 3. Environment variable (AI_SERVER_URL)
 * 4. Default (http://localhost:3344)
 */
const db = require('../db');

const DEFAULT_URL = 'http://localhost:3344';

let cachedUrl = null;
let cacheTime = 0;
const CACHE_TTL = 30000; // Re-read from DB every 30s

function getAiServerUrl(requestOverride) {
  // 1. Per-request override always wins
  if (requestOverride) return requestOverride;

  // 2. Check DB (with caching)
  const now = Date.now();
  if (!cachedUrl || now - cacheTime > CACHE_TTL) {
    try {
      const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get('ai_server_url');
      cachedUrl = row?.value || null;
      cacheTime = now;
    } catch (_) {
      cachedUrl = null;
    }
  }
  if (cachedUrl) return cachedUrl;

  // 3. Environment variable
  if (process.env.AI_SERVER_URL) return process.env.AI_SERVER_URL;

  // 4. Default
  return DEFAULT_URL;
}

/** Call this when the setting is updated from the UI to bust the cache */
function clearCache() {
  cachedUrl = null;
  cacheTime = 0;
}

module.exports = { getAiServerUrl, clearCache };
