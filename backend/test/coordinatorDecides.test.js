/**
 * Who encodes: the coordinator alone while this app is connected to one, this server (worker_mode) when it isn't. Runs
 * the real queue and a real ffmpeg on a short clip, against a database and a library made here and a stand-in
 * coordinator on loopback: nothing of the real one is touched.
 */
const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acm-coordinator-'));
const root = path.join(dir, 'library');
const vids = path.join(root, 'after filter performer', 'Someone', 'vids');
fs.mkdirSync(vids, { recursive: true });
process.env.DB_PATH = path.join(dir, 'app.db');

const db = require('../db');
const probe = require('../services/mediaProbe');
const eq = require('../services/encodeQueue');
const coord = require('../services/coordinator');

const req = { protocol: 'http', get: () => '127.0.0.1:4069' };
const master = path.join(dir, 'master.mp4');
const longer = path.join(dir, 'longer.mp4');
const stub = { token: null, refuse: false, server: null, url: null };
let n = 0;

/** A video the queue would re-encode, probed, and queued; its job's id. */
async function queueOne(from = master) {
  const p = path.join(vids, `clip${++n}.mp4`);
  fs.copyFileSync(from, p);
  await probe.refresh(p);
  assert.equal(eq.enqueue([p]).added, 1);
  return db.prepare('SELECT id FROM encode_jobs WHERE source_path = ?').get(p).id;
}

const job = (id) => db.prepare('SELECT * FROM encode_jobs WHERE id = ?').get(id);
const self = () => eq.listWorkers().find(w => w.local);
const settle = (ms = 150) => new Promise(r => setTimeout(r, ms));

async function until(what, ok, ms = 60000) {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await settle(20);
  }
}

const connect = () => coord.connect(stub.url, req);
const disconnect = () => coord.disconnect(req);

before(async () => {
  for (const [out, secs] of [[master, 2], [longer, 60]]) {
    const made = spawnSync(require('ffmpeg-static'), ['-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', `testsrc2=s=320x180:r=24:d=${secs}`, '-c:v', 'libx264', '-preset', 'ultrafast', '-qp', '0', out], { encoding: 'utf8' });
    assert.equal(made.status, 0, made.stderr);
  }
  db.prepare("INSERT INTO folders (path) VALUES (?)").run(root);
  stub.server = http.createServer((q, res) => {
    let body = '';
    q.on('data', (d) => { body += d; });
    q.on('end', () => {
      const send = (code, j) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(j)); };
      if (q.url === '/api/panel/hello') return send(200, { panel: true });
      if (q.url === '/api/panel/state') return send(200, { apps: [] });
      if (q.url !== '/api/panel/apps/pair') return send(404, {});
      if (stub.refuse) return send(500, { error: 'no' });
      stub.token = JSON.parse(body).link.split('/').pop();
      return send(200, { ok: true });
    });
  });
  await new Promise(r => stub.server.listen(0, '127.0.0.1', r));
  stub.url = `http://127.0.0.1:${stub.server.address().port}`;
  await eq.start();
});

after(() => {
  stub.server?.close();
  db.close();
  try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 }); } catch { /* in use: it goes with the rest of the temp folder */ }
});

test('not connected: this server encodes, and worker_mode switches it as ever', async () => {
  eq.setMode('remote');
  const id = await queueOne();
  await settle();
  assert.equal(job(id).status, 'queued');
  assert.equal(eq.status().coordinated, false);
  assert.equal(self().enabled, false);

  eq.setMode('auto');
  assert.equal(self().enabled, true);
  await until('this server to encode it', () => job(id).status === 'done');
  assert.equal(job(id).worker_id, 'local');
});

test('a connection that fails leaves this server encoding', async () => {
  stub.refuse = true;
  await assert.rejects(connect());
  stub.refuse = false;
  assert.equal(coord.status().connected, false);
  const id = await queueOne();
  await until('this server to encode it', () => job(id).status === 'done');
  assert.equal(job(id).worker_id, 'local');
});

test("connected: this server claims nothing, the coordinator's worker gets the job, and disconnecting brings this server back", async () => {
  assert.equal((await connect()).connected, true);
  // its worker hasn't called in: without the coordinator's say, worker_mode auto would have this server take over
  const id = await queueOne();
  await settle();
  assert.equal(job(id).status, 'queued');

  // nor at Start, or after a restart
  await eq.start();
  eq.startQueue();
  await settle();
  assert.equal(job(id).status, 'queued');

  const st = eq.status();
  assert.equal(st.coordinated, true);
  assert.equal(st.local.active, false);
  assert.equal(self().note, 'Left to the coordinator');
  assert.throws(() => eq.setMode('local'), { status: 409 });
  assert.equal(eq.mode(), 'auto');

  const w = eq.workerForToken(stub.token);
  const claim = await eq.workerClaim(w, { nvenc: false });
  assert.equal(claim.id, id);
  assert.equal(job(id).worker_id, `w:${w.id}`);

  // its job comes back and this server takes it, with no restart
  await disconnect();
  assert.equal(eq.status().coordinated, false);
  await until('this server to take it back', () => job(id).status === 'done');
  assert.equal(job(id).worker_id, 'local');
});

test('connected: worker_mode local claims nothing either, and comes back on disconnecting', async () => {
  eq.setMode('local');
  await connect();
  const id = await queueOne();
  await settle();
  assert.equal(job(id).status, 'queued');
  await disconnect();
  assert.equal(eq.mode(), 'local');
  await until('this server to encode it', () => job(id).status === 'done');
  eq.setMode('auto');
});

test('connected with a job running here: it finishes and swaps in, and nothing after it is claimed', async () => {
  const running = await queueOne(longer);
  await until('this server to claim it', () => job(running).status === 'running');
  // long, and paused, so it's certainly still at it when the app connects: a freeze takes a second on Windows
  await eq.pauseJob(running);
  await until('the encode to freeze', () => job(running).held === 1);
  const waiting = await queueOne();
  await connect();
  assert.equal(job(running).status, 'running');
  assert.equal(job(running).worker_id, 'local');
  assert.equal(self().note, 'Finishing its job, then left to the coordinator');

  // a mode change kills this server's job when it isn't wanted: not while the coordinator decides
  assert.throws(() => eq.setMode('remote'), { status: 409 });
  await settle();
  assert.equal(job(running).status, 'running');

  await eq.resumeJob(running);
  await until('it to finish', () => job(running).status === 'done');
  assert.equal(job(running).worker_id, 'local');
  assert.ok(fs.existsSync(job(running).out_path));
  assert.ok(fs.existsSync(job(running).held_path));
  await settle();
  assert.equal(job(waiting).status, 'queued');

  await disconnect();
  await until('this server to go on with the next', () => job(waiting).status === 'done');
});

test('worker_mode remote stays remote through connecting and disconnecting', async () => {
  eq.setMode('remote');
  await connect();
  const id = await queueOne();
  await disconnect();
  await settle();
  assert.equal(eq.mode(), 'remote');
  assert.equal(job(id).status, 'queued');

  eq.setMode('auto');
  await until('this server to encode it', () => job(id).status === 'done');
});
