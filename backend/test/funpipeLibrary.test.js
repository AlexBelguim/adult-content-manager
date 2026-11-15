/**
 * The Funscript page's performer rows: per performer, her videos, how many are labelled, how many sit in her
 * funscript folder and how many of those have no script yet. Runs against a database made here.
 */
const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acm-funpipe-library-'));
process.env.DB_PATH = path.join(dir, 'app.db');

const db = require('../db');
const { performerSummary } = require('../routes/funpipe')._internal;

after(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const addPerformer = (name, { after = 0, vids = 0, blacklisted = 0 } = {}) =>
  db.prepare('INSERT INTO performers (name, moved_to_after, vids_count, blacklisted) VALUES (?, ?, ?, ?)')
    .run(name, after, vids, blacklisted).lastInsertRowid;
const label = (p) => db.prepare(
  "INSERT INTO video_labels (file_path, seconds, model, scenes, exposure) VALUES (?, 60, 'm', '[]', '[]')"
).run(p);
const row = (performerId, p, funscripts = [], status = funscripts.length ? 'external' : 'no_script') =>
  ({ performerId, path: p, funscripts, status });

test('counts each performer the way Performer Management does', () => {
  const ann = addPerformer('Ann', { after: 1, vids: 5 });
  const bea = addPerformer('Bea', { vids: 2 });
  addPerformer('Empty');
  addPerformer('Gone', { vids: 3, blacklisted: 1 });

  const annVid = (n) => `/media/after filter performer/Ann/vids/funscript/v${n}/v${n}.mp4`;
  label(annVid(1));
  label('/media/after filter performer/Ann/vids/other.mp4');
  label('/media/before filter performer/Bea/vids/x.mp4');
  label('/media/before filter performer/Ann/vids/old.mp4');   // labelled while she was still "before": not hers now

  const rows = [
    row(ann, annVid(1), ['v1.funscript'], 'needs_review'),
    row(ann, annVid(2)),
    row(ann, annVid(3), [], 'incomplete')
  ];
  const { performers, labelled } = performerSummary(rows);
  const by = Object.fromEntries(performers.map(p => [p.name, p]));

  assert.deepEqual(Object.keys(by).sort(), ['Ann', 'Bea'], 'blacklisted and empty performers are left out');
  assert.deepEqual(
    { videos: by.Ann.videos, labelled: by.Ann.labelled, unlabelled: by.Ann.unlabelled, funscript: by.Ann.funscript, noScript: by.Ann.noScript, where: by.Ann.where },
    { videos: 5, labelled: 2, unlabelled: 3, funscript: 3, noScript: 2, where: 'after' }
  );
  assert.deepEqual(by.Ann.counts, { needs_review: 1, no_script: 1, incomplete: 1 });
  assert.deepEqual(
    { videos: by.Bea.videos, labelled: by.Bea.labelled, funscript: by.Bea.funscript, noScript: by.Bea.noScript },
    { videos: 2, labelled: 1, funscript: 0, noScript: 0 }
  );
  assert.ok(labelled.has(annVid(1).toLowerCase()));
  assert.ok(!labelled.has(annVid(2).toLowerCase()));
});

test('a stale video count never goes below her funscript folder, nor unlabelled below zero', () => {
  const cat = addPerformer('Cat', { vids: 0 });
  for (let i = 0; i < 3; i++) label(`/media/before filter performer/Cat/vids/c${i}.mp4`);
  const { performers } = performerSummary([row(cat, '/media/before filter performer/Cat/vids/funscript/a/a.mp4')]);
  const c = performers.find(p => p.name === 'Cat');
  assert.equal(c.videos, 1);
  assert.equal(c.labelled, 1);
  assert.equal(c.unlabelled, 0);
});
