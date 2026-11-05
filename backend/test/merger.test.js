/**
 * Merging performers: two records for one "before" folder (what imports used to create when the "after" row of the
 * name existed) merge in the database only, keep every file, and leave no hash copy of a live file behind; a merge of
 * two folders moves the files and their hashes. Runs on a database and folders made here: nothing real is touched.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acm-merger-'));
process.env.DB_PATH = path.join(dir, 'app.db');
process.env.DATA_PATH = path.join(dir, 'data');

const db = require('../db');
require('../routes/ranking'); // creates image_elo_scores, as the server does when it loads
const merger = require('../services/merger');

const media = path.join(dir, 'media');
const folderId = db.prepare('INSERT INTO folders (path) VALUES (?)').run(media).lastInsertRowid;
const addPerformer = (name, after) => db.prepare('INSERT INTO performers (name, folder_id, moved_to_after) VALUES (?, ?, ?)')
  .run(name, folderId, after ? 1 : 0).lastInsertRowid;
const addHash = (id, file, hash, deleted = 0) => db.prepare(
  'INSERT INTO performer_file_hashes (performer_id, file_path, exact_hash, deleted_flag) VALUES (?, ?, ?, ?)'
).run(id, file, hash, deleted);
const writePics = (folder, name, files) => {
  const pics = path.join(media, folder, name, 'pics');
  fs.mkdirSync(pics, { recursive: true });
  for (const f of files) fs.writeFileSync(path.join(pics, f), f);
  return pics;
};
const hashesOf = (id) => db.prepare('SELECT file_path, exact_hash, deleted_flag FROM performer_file_hashes WHERE performer_id = ? ORDER BY file_path').all(id);

test('two records for one folder merge without touching the files', async () => {
  const pics = writePics('before filter performer', 'Eva', ['new (1).jpg', 'new (2).jpg', 'new (3).jpg']);
  addPerformer('Eva', true);
  const old = addPerformer('Eva', false);
  const current = addPerformer('Eva', false);
  // The old record knew the same pictures under their old names, and one that is gone
  addHash(old, path.join(pics, 'old 1.jpg'), 'h1');
  addHash(old, path.join(pics, 'old 2.jpg'), 'h2');
  addHash(old, path.join(pics, 'gone.jpg'), 'h9');
  for (const [i, h] of [[1, 'h1'], [2, 'h2'], [3, 'h3']]) addHash(current, path.join(pics, `new (${i}).jpg`), h);
  db.prepare('INSERT INTO filter_actions (performer_id, file_path, action) VALUES (?, ?, ?)').run(old, path.join(pics, 'new (3).jpg'), 'keep');
  db.prepare('INSERT INTO hash_runs (run_id, source_performer_id, target_performer_id, status) VALUES (?, ?, ?, ?)').run('old-run', old, old, 'completed');

  const merged = await merger.mergeDuplicateRecords();

  assert.deepEqual(merged, [{ name: 'Eva', kept: Number(current), merged: [Number(old)] }]);
  assert.deepEqual(fs.readdirSync(pics).sort(), ['new (1).jpg', 'new (2).jpg', 'new (3).jpg']);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM performers WHERE name = 'Eva' AND moved_to_after = 0").get().n, 1);
  assert.equal(db.prepare('SELECT pics_count FROM performers WHERE id = ?').get(current).pics_count, 3);
  // Live files keep their hashes; the old copies of them are gone; the vanished file stays as deleted history
  assert.deepEqual(hashesOf(current).map(h => [path.basename(h.file_path), h.exact_hash, h.deleted_flag]), [
    ['gone.jpg', 'h9', 1], ['new (1).jpg', 'h1', 0], ['new (2).jpg', 'h2', 0], ['new (3).jpg', 'h3', 0],
  ]);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM filter_actions WHERE performer_id = ?').get(current).n, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM hash_runs WHERE run_id = 'old-run'").get().n, 0);
  assert.deepEqual(await merger.mergeDuplicateRecords(), []);
});

test('merging two folders moves the files and their hashes', async () => {
  const fromPics = writePics('before filter performer', 'Mia B', ['a.jpg']);
  const toPics = writePics('before filter performer', 'Mia', ['b.jpg']);
  const source = addPerformer('Mia B', false);
  const target = addPerformer('Mia', false);
  addHash(source, path.join(fromPics, 'a.jpg'), 'ha');
  addHash(target, path.join(toPics, 'b.jpg'), 'hb');

  await merger.mergePerformers(source, target);

  assert.equal(fs.existsSync(path.join(media, 'before filter performer', 'Mia B')), false);
  assert.deepEqual(fs.readdirSync(toPics).sort(), ['a.jpg', 'b.jpg']);
  assert.deepEqual(hashesOf(target).map(h => [h.file_path, h.deleted_flag]), [
    [path.join(toPics, 'a.jpg'), 0], [path.join(toPics, 'b.jpg'), 0],
  ]);
  assert.deepEqual(JSON.parse(db.prepare('SELECT aliases FROM performers WHERE id = ?').get(target).aliases), ['Mia B']);
});
