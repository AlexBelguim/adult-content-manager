/**
 * Settings → Coordinator: this app connected to the home's coordinator (the host-agent repo's coordinator, on the
 * NAS), which hands its re-encodes, training runs and funscripts to the worker nodes. To this app the coordinator is
 * one encode worker, called "Coordinator"; connecting makes it (or gives it a new link) and this app pairs itself: it
 * sends the coordinator that worker's link, made with this server's LAN address (the coordinator then also takes the
 * GPU-work token from GET /api/workers/link). Disconnecting removes the worker and tells the coordinator.
 *
 * Where acm-gpu is: once connected, the coordinator says (GET /api/panel/services/acm-gpu, asked every minute), and
 * utils/aiUrl.js uses that before the address saved by hand.
 *
 * Kept in app_settings: coordinator_url, coordinator_worker_id.
 */
const os = require('os');
const db = require('../db');
const eq = require('./encodeQueue');

const URL_KEY = 'coordinator_url';
const WORKER_KEY = 'coordinator_worker_id';
const bad = (message, status = 400) => Object.assign(new Error(message), { status });
const clean = (u) => String(u || '').trim().replace(/\/+$/, '');

const getSetting = (key) => { try { return db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key)?.value || null; } catch { return null; } };
const setSetting = (key, value) => {
  if (value == null) db.prepare('DELETE FROM app_settings WHERE key = ?').run(key);
  else db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));
};

async function call(base, path, init = {}) {
  const r = await fetch(`${base}${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...(init.headers || {}) }, signal: AbortSignal.timeout(15000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw bad(j.error || `the coordinator answered ${r.status}`, 502);
  return j;
}

/** This server as the coordinator reaches it: its first LAN address (the container runs on the NAS's own network). */
function selfUrl(req) {
  const port = process.env.PORT || 4069;
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      const [x, y] = a.address.split('.').map(Number);
      if ((x === 192 && y === 168) || x === 10) return `http://${a.address}:${port}`;
    }
  }
  return `${req.protocol}://${req.get('host')}`;
}

// where acm-gpu is, as the coordinator last said: { url, node, at }
let gpu = null;
async function refreshGpu() {
  const url = getSetting(URL_KEY);
  if (!url) { gpu = null; return; }
  try {
    const s = await call(url, '/api/panel/services/acm-gpu');
    const n = (s.nodes || []).find((x) => x.online) || s.nodes?.[0];
    gpu = n ? { url: n.url, node: n.node, online: !!n.online, at: Date.now() } : null;
  } catch { /* the coordinator is away: the last answer (or the saved address) stands */ }
}
setInterval(refreshGpu, 60000).unref();
setTimeout(refreshGpu, 3000).unref();

/** acm-gpu's address through the coordinator, when it's connected and has said one (utils/aiUrl.js). */
const gpuUrl = () => (getSetting(URL_KEY) && gpu?.url ? gpu.url : null);

function status() {
  const url = getSetting(URL_KEY);
  const id = Number(getSetting(WORKER_KEY)) || null;
  const worker = id ? eq.listWorkers().find((w) => w.id === id) || null : null;
  return { url, workerId: worker ? id : null, worker, connected: !!(url && worker), gpu };
}

async function connect(rawUrl, req) {
  const url = clean(rawUrl);
  if (!/^https?:\/\/[^/\s]+$/.test(url)) throw bad("The coordinator's address, like http://192.168.1.125:4700");
  const hello = await call(url, '/api/panel/hello').catch((e) => { throw bad(`No coordinator answers at ${url}: ${e.message}`, 502); });
  if (!hello.panel) throw bad(`${url} isn't a coordinator`);
  const old = status();
  let token;
  if (old.workerId) ({ token } = eq.relinkWorker(old.workerId));
  else {
    const w = eq.addWorker('Coordinator');
    setSetting(WORKER_KEY, w.id);
    token = w.token;
  }
  await call(url, '/api/panel/apps/pair', { method: 'POST', body: JSON.stringify({ link: `${selfUrl(req)}/api/workers/link/${token}` }) });
  setSetting(URL_KEY, url);
  await refreshGpu();
  return status();
}

async function disconnect(req) {
  const { url, workerId } = status();
  if (workerId) eq.removeWorker(workerId);
  if (url) {
    try {
      const st = await call(url, '/api/panel/state');
      const me = (st.apps || []).find((a) => a.app === 'acm' && a.url.includes(new URL(selfUrl(req)).host));
      if (me) await call(url, `/api/panel/apps/${encodeURIComponent(me.id)}/remove`, { method: 'POST', body: '{}' });
    } catch { /* it's away: it finds the link gone */ }
  }
  setSetting(URL_KEY, null);
  setSetting(WORKER_KEY, null);
  gpu = null;
  return status();
}

module.exports = { status, connect, disconnect, gpuUrl };
