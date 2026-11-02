/**
 * Training: what /start queues for the three picture types acm-gpu trains, that it turns the removed types away, and that
 * their routes are gone while old runs keep their labels. Runs on a database made here: nothing real is touched.
 */
const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acm-training-'));
process.env.DB_PATH = path.join(dir, 'app.db');
process.env.DATA_PATH = path.join(dir, 'data');

const express = require('express');
const db = require('../db');
const trainingQueue = require('../services/trainingQueue');

const REMOVED = ['binary', 'ranked_binary', 'pairwise', 'performer_ranker'];
let base, server;

const api = async (method, url, body) => {
  const res = await fetch(`${base}${url}`, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const payloadOf = (id) => JSON.parse(db.prepare('SELECT payload FROM training_jobs WHERE id = ?').get(id).payload);

before(async () => {
  const media = path.join(dir, 'media');
  for (const [folder, n] of [['after filter performer', 25], ['deleted keep for training', 21]]) {
    fs.mkdirSync(path.join(media, folder, 'Anna', 'pics'), { recursive: true });
    for (let i = 0; i < n; i++) fs.writeFileSync(path.join(media, folder, 'Anna', 'pics', `${i}.jpg`), '');
  }
  db.prepare('INSERT INTO folders (path) VALUES (?)').run(media);
  const insert = db.prepare('INSERT INTO performers (name, folder_id, blacklisted) VALUES (?, (SELECT id FROM folders LIMIT 1), ?)');
  const anna = insert.run('Anna', 0).lastInsertRowid;
  insert.run('Bea', 1);
  db.prepare('INSERT INTO ratings (performer_id, manual_star) VALUES (?, 4.5)').run(anna);
  const pair = db.prepare('INSERT INTO pairwise_pairs (performer_id, winner, loser, type, source) VALUES (?, ?, ?, ?, ?)');
  pair.run(anna, 'a', 'b', 'intra', null);
  pair.run(anna, 'c', 'd', 'inter', null);
  pair.run(anna, 'e', 'f', 'both_bad', null);

  const app = express();
  app.use(express.json());
  app.use('/api/training', require('../routes/training'));
  app.use('/api/pairwise', require('../routes/pairwise'));
  require('../routes/ranking'); // makes image_elo_scores, which the data summary counts
  server = await new Promise((resolve) => { const s = http.createServer(app).listen(0, '127.0.0.1', () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the three kept types queue what their trainers read', async () => {
  const siamese = await api('POST', '/api/training/start', { type: 'clip_siamese', epochs: 3, batch_size: 8, use_legacy: false, synthetic_pairs_per_epoch: 200 });
  assert.equal(siamese.status, 200);
  assert.equal(siamese.body.queued, true);
  const s = payloadOf(siamese.body.id);
  assert.deepEqual(s.pairs.map(p => p.winner), ['a']);
  assert.equal(s.use_legacy, false);
  assert.equal(s.synthetic_pairs_per_epoch, 200);
  assert.equal(s.epochs, 3);
  assert.equal(s.batch_size, 8);
  assert.ok(s.base_path.endsWith('media'));

  const taste = await api('POST', '/api/training/start', { type: 'clip_taste' });
  const t = payloadOf(taste.body.id);
  assert.deepEqual(t.pairs.map(p => p.winner).sort(), ['a', 'c']);
  assert.deepEqual(t.performer_ratings, { Anna: 4.5 });
  assert.deepEqual(t.blacklisted_performers, ['Bea']);

  const k = await api('POST', '/api/training/start', { type: 'clip_keepdelete' });
  const keepDelete = payloadOf(k.body.id);
  assert.equal(keepDelete.type, 'clip_keepdelete');
  assert.equal(keepDelete.pairs, undefined);
});

test('a run without a type is a CLIP Siamese run', async () => {
  const r = await api('POST', '/api/training/start', {});
  assert.equal(payloadOf(r.body.id).type, 'clip_siamese');
});

test('the DINO settings no longer reach a run', async () => {
  const r = await api('POST', '/api/training/start', { type: 'clip_siamese', backbone: 'facebook/dinov2-large', quantize: true, enable_mining: true, deduplicate: true, finetune_start_epoch: 3, use_hard_examples: true });
  const p = payloadOf(r.body.id);
  for (const key of ['backbone', 'learning_rate', 'quantize', 'enable_mining', 'mining_multiplier', 'deduplicate', 'finetune_start_epoch', 'hard_examples']) {
    assert.equal(p[key], undefined, key);
  }
});

test('the removed types are turned away and nothing is queued', async () => {
  const before = trainingQueue.list().jobs.length;
  for (const type of REMOVED) {
    const r = await api('POST', '/api/training/start', { type });
    assert.equal(r.status, 400, type);
  }
  assert.equal(trainingQueue.list().jobs.length, before);
});

test('an old run of a removed type keeps its label in the queue', () => {
  const titles = { binary: 'Keep / delete classifier', ranked_binary: 'Ranked keep / delete classifier', pairwise: 'Pairwise ranker', performer_ranker: 'Performer ranker' };
  for (const [type, title] of Object.entries(titles)) {
    const { id } = trainingQueue.enqueue({ type, epochs: 8 });
    assert.equal(trainingQueue.list().jobs.find(j => j.id === id).label, `${title} · 8 epochs`);
    trainingQueue.cancel(id);
  }
});

test('a run of a removed type cannot run again, a kept one can', async () => {
  const old = trainingQueue.enqueue({ type: 'binary', epochs: 8 });
  trainingQueue.cancel(old.id);
  assert.equal((await api('POST', `/api/training/jobs/${old.id}/retry`)).status, 409);
  assert.equal(trainingQueue.list().jobs.find(j => j.id === old.id).status, 'cancelled');

  const kept = trainingQueue.enqueue({ type: 'clip_taste', epochs: 8 });
  trainingQueue.cancel(kept.id);
  assert.equal((await api('POST', `/api/training/jobs/${kept.id}/retry`)).status, 200);
  assert.equal(trainingQueue.list().jobs.find(j => j.id === kept.id).status, 'queued');
});

test("the removed models' routes are gone", async () => {
  for (const url of ['/api/training/predict-performer-rank', '/api/training/predict-ranks-batch', '/api/training/export-binary', '/api/training/export-pairs',
    '/api/pairwise/run-inference', '/api/pairwise/load-model']) {
    assert.equal((await api('POST', url, {})).status, 404, url);
  }
  assert.equal((await api('GET', '/api/pairwise/models')).status, 404);
});

test('the data summary counts the pictures and says when there are enough', async () => {
  const { status, body } = await api('GET', '/api/training/data-summary');
  assert.equal(status, 200);
  assert.deepEqual(body.pictures, { keep: 25, delete: 21, performers: 1 });
  assert.deepEqual(body.readyForTraining, { pictures: true });
  assert.equal(body.binary, undefined);
  assert.equal(body.pairwise.intraPairs, 1);
});

test('hand labelling still saves pairs for the CLIP models', async () => {
  const anna = db.prepare("SELECT id FROM performers WHERE name = 'Anna'").get().id;
  const r = await api('POST', '/api/pairwise/submit', { performer_id: anna, winner: 'w', loser: 'l', type: 'intra' });
  assert.equal(r.status, 200);
  const started = await api('POST', '/api/training/start', { type: 'clip_siamese' });
  assert.ok(payloadOf(started.body.id).pairs.some(p => p.winner === 'w'));
});
