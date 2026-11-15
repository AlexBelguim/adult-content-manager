/**
 * Label jobs and "Labels + funscript" (services/labelQueue.js): what gets queued, a funscript that waits for its
 * labels, the node a job is pinned to in the coordinator's listings, completion storing the labels, and a failed or
 * removed label job taking its funscript along. Runs against a database and a library made here.
 */
const { after, beforeEach, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acm-label-jobs-'));
const root = path.join(dir, 'library');
const vids = path.join(root, 'after filter performer', 'Someone', 'vids');
fs.mkdirSync(vids, { recursive: true });
process.env.DB_PATH = path.join(dir, 'app.db');

const db = require('../db');
const fq = require('../services/funpipeQueue');
const lq = require('../services/labelQueue');
const tq = require('../services/trainingQueue');

db.prepare('INSERT INTO folders (path) VALUES (?)').run(root);
const video = (n) => {
  const p = path.join(vids, `v${n}.mp4`);
  fs.writeFileSync(p, 'not really a video');
  return p;
};
const LABELS = { seconds: 60, model: 'labelmaster-9', scenes: [{ start: 0, end: 60, group: 'show', detail: null, position: null, cast: 'none', exposure: 'dressed' }], exposure: [[0, 60, 'dressed']] };
const docs = (v) => { for (const ext of lq.DOCS) fs.writeFileSync(fq.sidecarPath(v, ext), '{}'); };

beforeEach(() => {
  for (const t of ['label_jobs', 'funpipe_jobs', 'video_labels', 'training_jobs']) db.prepare(`DELETE FROM ${t}`).run();
  for (const f of fs.readdirSync(vids)) fs.rmSync(path.join(vids, f));
  fq.start();
});
after(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('labels only: one label job per video, none for one already labelled', () => {
  const [a, b] = [video(1), video(2)];
  db.prepare("INSERT INTO video_labels (file_path, seconds, scenes, exposure) VALUES (?, 10, '[]', '[]')").run(b);
  const r = lq.enqueue([a, b, path.join(dir, 'elsewhere.mp4')]);
  assert.equal(r.labels, 1);
  assert.equal(r.funscript, 0);
  assert.deepEqual(r.skipped.map(s => s.reason), ['already labelled', 'not a video in the library']);
  assert.equal(lq.enqueue([a]).labels, 0, 'a video with a label job open gets no second one');
});

test('labels + funscript: the funscript waits for its labels, then is handed out', () => {
  const v = video(3);
  const r = lq.enqueue([v], { funscript: true });
  assert.deepEqual([r.labels, r.funscript], [1, 1]);
  assert.equal(fq.queued().length, 0, 'the funscript is not in the coordinator listing while its labels are open');
  assert.equal(fq.claim('NAS', {}), null, 'nor can a worker claim it');

  const job = lq.claim('NAS', {});
  assert.equal(job.video, v);
  assert.equal(lq.progress('NAS', job.id, { stage: 'looks', progress: 0.5 }).action, 'continue');
  assert.equal(lq.progress('PC', job.id, {}).action, 'cancel', 'another worker is told to drop it');
  docs(v);
  assert.ok(lq.complete('NAS', job.id, { labels: LABELS }));
  assert.equal(db.prepare('SELECT model FROM video_labels WHERE file_path = ?').get(v).model, 'labelmaster-9', 'the labels are stored');

  const listed = fq.queued();
  assert.equal(listed.length, 1);
  assert.deepEqual(listed[0].why, ['from its scenes']);
  const fj = fq.claim('NAS', {});
  assert.equal(fj.mode, 'scenes');
  assert.deepEqual(fj.stages, ['from-scenes']);
  assert.ok(fj.sidecars.includes('.labels.json') && fj.sidecars.includes('.motion.json'), 'it gets the label documents');
});

test('a funscript for a video whose label documents are there: no label job', () => {
  const v = video(4);
  docs(v);
  const r = lq.enqueue([v], { funscript: true });
  assert.deepEqual([r.labels, r.funscript], [0, 1]);
  assert.equal(fq.queued().length, 1, 'ready at once');
});

test('Run on: the pin is in every listing the coordinator reads', () => {
  const v = video(5);
  lq.enqueue([v], { funscript: true, runOn: 'm-pc' });
  assert.equal(lq.queued()[0].node, 'm-pc');
  tq.enqueue({ type: 'clip_taste', epochs: 2 }, { runOn: 'm-nas' });
  assert.equal(tq.queued()[0].node, 'm-nas');
  const j = lq.claim('PC', {});
  docs(v);
  lq.complete('PC', j.id, { labels: LABELS });
  assert.equal(fq.queued()[0].node, 'm-pc', 'the funscript keeps the pin');
  fq.enqueue([video(6)], { pose: true, runOn: '  ' });
  assert.equal(fq.queued().find(x => x.label === 'v6.mp4').node, null, 'a blank pin is no pin');
});

test('a failed label job fails its funscript; Retry brings both back', () => {
  const v = video(7);
  lq.enqueue([v], { funscript: true });
  const j = lq.claim('NAS', {});
  lq.fail('NAS', j.id, 'CUDA out of memory');
  const f = db.prepare('SELECT status, error FROM funpipe_jobs').get();
  assert.equal(f.status, 'failed');
  assert.match(f.error, /its labels failed: CUDA out of memory/);
  assert.ok(lq.retry(j.id).ok);
  assert.equal(db.prepare('SELECT status FROM funpipe_jobs').get().status, 'queued');
  assert.equal(lq.list().jobs[0].status, 'queued');
});

test('labels that arrive without their documents: the funscript cannot be made', () => {
  const v = video(8);
  lq.enqueue([v], { funscript: true });
  const j = lq.claim('NAS', {});
  lq.complete('NAS', j.id, { labels: LABELS });
  assert.equal(db.prepare('SELECT status FROM funpipe_jobs').get().status, 'failed');
});

test('removing a label job takes the waiting funscript along; clearing a done one frees it', () => {
  const [a, b] = [video(9), video(10)];
  lq.enqueue([a], { funscript: true });
  lq.remove(lq.list().jobs[0].id);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM funpipe_jobs').get().n, 0);

  lq.enqueue([b], { funscript: true });
  const j = lq.claim('NAS', {});
  docs(b);
  lq.complete('NAS', j.id, { labels: LABELS });
  lq.clearDone();
  assert.equal(lq.list().jobs.length, 0);
  assert.equal(fq.queued().length, 1, 'its funscript is still handed out');
});

test('bad labels are refused (the route fails the job)', () => {
  const v = video(11);
  lq.enqueue([v]);
  const j = lq.claim('NAS', {});
  assert.throws(() => lq.complete('NAS', j.id, { labels: { seconds: 0 } }), /required/);
});

test('a paused queue hands out no label jobs', () => {
  lq.enqueue([video(12)]);
  fq.stop();
  assert.equal(lq.queued().length, 0);
  assert.equal(lq.claim('NAS', {}), null);
});
