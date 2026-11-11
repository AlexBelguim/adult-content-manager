/**
 * Import: server-folder imports and browser uploads move files into "before filter performer" without ever
 * overwriting, report what they did, and each upload reads and removes only its own temp folder.
 * Runs on a database and folders made here: nothing real is touched.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(process.env.IMPORT_TEST_DIR || os.tmpdir(), 'acm-import-'));
process.env.DB_PATH = path.join(dir, 'app.db');
process.env.DATA_PATH = path.join(dir, 'data');

const db = require('../db');
const guard = require('../services/importGuard');
const { localImportPerformer, uploadImportPerformer } = require('../services/uploadImporter');
const queue = require('../services/uploadQueue');

const media = path.join(dir, 'media');
for (const sub of ['before upload', 'before filter performer', 'after filter performer']) fs.mkdirSync(path.join(media, sub), { recursive: true });
const folderId = db.prepare('INSERT INTO folders (path) VALUES (?)').run(media).lastInsertRowid;

const before = (...p) => path.join(media, 'before upload', ...p);
const performer = (...p) => path.join(media, 'before filter performer', ...p);
const write = (file, content) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); };
const exists = (p) => fs.existsSync(p);
const read = (p) => fs.readFileSync(p, 'utf8');

async function codeOf(promise) {
  try { await promise; } catch (e) { return e.code; }
  return null;
}

async function waitFor(jobId, timeout = 10000) {
  const t0 = Date.now();
  for (;;) {
    const job = queue.getQueueStatus().queue.find(j => j.id === jobId);
    if (job && (job.status === 'completed' || job.status === 'error')) return job;
    if (Date.now() - t0 > timeout) throw new Error(`Job ${jobId} did not finish: ${job && job.status}`);
    await new Promise(r => setTimeout(r, 20));
  }
}

// An upload as the browser leaves it: batches of temp files, each with its manifest
function stageUpload(uploadId, batches) {
  const tmp = path.join(media, '.temp-uploads', uploadId);
  fs.mkdirSync(tmp, { recursive: true });
  batches.forEach((files, i) => {
    const manifest = { index: i, files: [], at: new Date().toISOString() };
    files.forEach(([rel, content], seq) => {
      const temp = `b${i}-${seq}-${guard.safeBase(path.posix.basename(rel))}`;
      if (content !== null) fs.writeFileSync(path.join(tmp, temp), content);
      manifest.files.push({ temp, rel, size: content === null ? 0 : Buffer.byteLength(content) });
    });
    fs.writeFileSync(path.join(tmp, `batch-${i}.json`), JSON.stringify(manifest));
  });
  return tmp;
}

test('the name rules and the match', () => {
  assert.equal(guard.performerNameError('  '), 'Type a name');
  assert.ok(guard.performerNameError('../x'));
  assert.ok(guard.performerNameError('a\\b'));
  assert.ok(guard.performerNameError('.hidden'));
  assert.ok(guard.performerNameError('a\u0001b'));
  assert.ok(guard.performerNameError('x'.repeat(201)));
  assert.equal(guard.performerNameError(' Jane Doe '), null);

  assert.equal(guard.safeRel('a\\..\\b/./c//d.jpg'), 'a/b/c/d.jpg');
  assert.equal(guard.safeRel('../../etc/passwd'), 'etc/passwd');
  assert.ok(guard.safeRel(`${'d/'.repeat(300)}end.jpg`).endsWith('end.jpg'));
  assert.ok(guard.safeRel(`${'d/'.repeat(300)}end.jpg`).length <= 400);
  assert.equal(guard.safeBase('ä:b*c.jpg'), '__b_c.jpg');
  assert.equal(guard.kindOf('A.JPG'), 'image');
  assert.equal(guard.kindOf('x.funscript'), 'funscript');
  assert.equal(guard.kindOf('x.heic'), null);
  assert.ok(guard.isJunk('Thumbs.db') && guard.isJunk('._a.jpg') && guard.isJunk('.DS_Store'));

  const id = db.prepare("INSERT INTO performers (name, folder_id, moved_to_after, aliases, pics_count, vids_count) VALUES ('Mia Real', ?, 1, '[\"Mimi\"]', 12, 3)").run(folderId).lastInsertRowid;
  assert.deepEqual(guard.resolveImportName(' mimi '), {
    kind: 'existing', input: 'mimi', name: 'Mia Real', by: 'alias', performerId: Number(id), location: 'after',
    pics: 12, vids: 3, reason: null, blacklistedAt: null
  });
  assert.equal(guard.resolveImportName('mia real').by, 'name');
  assert.equal(guard.resolveImportName('Nobody Yet').kind, 'new');
  assert.equal(guard.resolveImportName('..').kind, 'invalid');

  assert.equal(guard.resolveLibrary().id, folderId);
  assert.equal(guard.resolveLibrary(media + path.sep).id, folderId);
  assert.equal(guard.resolveLibrary(path.join(dir, 'elsewhere')), null);
});

test('same-named files in two sub-folders: one imported, one renamed', async () => {
  write(before('Sets', 'set1', '001.jpg'), 'first');
  write(before('Sets', 'set2', '001.jpg'), 'second');
  const r = await localImportPerformer('Sets', 'Sets', media, null, false);
  assert.equal(r.report.imported, 1);
  assert.equal(r.report.renamed, 1);
  assert.deepEqual(r.report.lists.renamed, [{ from: 'set2/001.jpg', to: 'pics/001 (2).jpg' }]);
  assert.equal(read(performer('Sets', 'pics', '001.jpg')), 'first');
  assert.equal(read(performer('Sets', 'pics', '001 (2).jpg')), 'second');
  assert.equal(exists(before('Sets')), false);
  assert.equal(r.report.leftIn, null);
  assert.equal(r.pics_count, 2);
  assert.equal(db.prepare("SELECT pics_count FROM performers WHERE name = 'Sets'").get().pics_count, 2);
});

test('an identical file is skipped and its source copy removed', async () => {
  write(performer('Ident', 'pics', 'same.jpg'), 'same bytes');
  write(before('Ident', 'same.jpg'), 'same bytes');
  write(before('Ident', 'new.jpg'), 'new bytes');
  const r = await localImportPerformer('Ident', 'Ident', media, null, false);
  assert.equal(r.report.identical, 1);
  assert.equal(r.report.imported, 1);
  assert.deepEqual(r.report.lists.identical, [{ from: 'same.jpg', same: 'pics/same.jpg' }]);
  assert.equal(exists(before('Ident')), false);
  assert.deepEqual(fs.readdirSync(performer('Ident', 'pics')).sort(), ['new.jpg', 'same.jpg']);
});

test('unsupported files stay in the source, which is kept', async () => {
  write(before('Heic', 'a.jpg'), 'a');
  write(before('Heic', 'b.heic'), 'b');
  const r = await localImportPerformer('Heic', 'Heic', media, null, false);
  assert.equal(r.report.unsupported, 1);
  assert.deepEqual(r.report.lists.unsupported, [{ from: 'b.heic', ext: '.heic' }]);
  assert.equal(exists(before('Heic', 'b.heic')), true);
  assert.equal(exists(before('Heic', 'a.jpg')), false);
  assert.equal(r.report.leftIn, 'before upload/Heic');
});

test('a hidden file keeps the folder', async () => {
  write(before('Hidden', 'a.jpg'), 'a');
  write(before('Hidden', '.note'), 'keep me');
  const r = await localImportPerformer('Hidden', 'Hidden', media, null, false);
  assert.equal(r.report.imported, 1);
  assert.equal(read(before('Hidden', '.note')), 'keep me');
  assert.equal(r.report.leftIn, 'before upload/Hidden');
});

test('a folder with only junk left is removed', async () => {
  write(before('Junk', 'a.jpg'), 'a');
  write(before('Junk', 'Thumbs.db'), 'x');
  write(before('Junk', 'sub', '.DS_Store'), 'x');
  fs.mkdirSync(before('Junk', 'empty'));
  const r = await localImportPerformer('Junk', 'Junk', media, null, false);
  assert.equal(r.report.imported, 1);
  assert.equal(r.report.unsupported, 0);
  assert.equal(exists(before('Junk')), false);
  assert.equal(r.report.leftIn, null);

  write(before('OnlyJunk', 'desktop.ini'), 'x');
  const empty = await localImportPerformer('OnlyJunk', 'OnlyJunk', media, null, false);
  assert.equal(empty.alreadyEmpty, true);
  assert.equal(exists(before('OnlyJunk')), false);
});

test('an existing cover is kept', async () => {
  const cover = performer('Covered', 'pics', 'cover.jpg');
  write(cover, 'cover');
  db.prepare("INSERT INTO performers (name, folder_id, moved_to_after, thumbnail) VALUES ('Covered', ?, 0, ?)").run(folderId, cover);
  db.prepare("INSERT INTO performer_file_cache (performer_id, type, data) SELECT id, 'pics', '[]' FROM performers WHERE name = 'Covered'").run();
  write(before('Covered', 'aaa.jpg'), 'a');
  const r = await localImportPerformer('Covered', 'covered', media, null, false);
  assert.equal(r.name, 'Covered');
  assert.equal(r.isUpdate, true);
  assert.equal(r.report.coverKept, true);
  assert.deepEqual(r.report.matched, { by: 'name', performerId: r.id });
  assert.equal(db.prepare('SELECT thumbnail FROM performers WHERE id = ?').get(r.id).thumbnail, cover);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM performer_file_cache WHERE performer_id = ?').get(r.id).n, 0);
});

test('a video and its funscript go to vids/funscript/<stem>/', async () => {
  write(before('Fun', 'clip.mp4'), 'video');
  write(before('Fun', 'clip.funscript'), '{}');
  write(before('Fun', 'other.mp4'), 'other');
  write(before('Fun', 'lone.funscript'), '{}');
  const r = await localImportPerformer('Fun', 'Fun', media, null, false);
  assert.equal(r.report.imported, 4);
  assert.equal(exists(performer('Fun', 'vids', 'funscript', 'clip', 'clip.mp4')), true);
  assert.equal(exists(performer('Fun', 'vids', 'funscript', 'clip', 'clip.funscript')), true);
  assert.equal(exists(performer('Fun', 'vids', 'other.mp4')), true);
  assert.equal(exists(performer('Fun', 'vids', 'funscript', 'lone', 'lone.funscript')), true);
  assert.equal(r.funscript_vids_count, 1);
});

test('a blacklisted name is refused before any file moves', async () => {
  db.prepare("INSERT INTO performers (name, folder_id, moved_to_after, blacklisted, blacklist_reason) VALUES ('Banned', ?, 1, 1, 'no')").run(folderId);
  write(before('Banned', 'a.jpg'), 'a');
  assert.equal(guard.resolveImportName('banned').kind, 'blacklisted');
  assert.equal(await codeOf(localImportPerformer('Banned', 'Banned', media, null, false)), 'blacklisted');
  assert.equal(await codeOf(queue.addLocalImportToQueue({ folderName: 'Banned', performerName: 'Banned', basePath: media })), 'blacklisted');
  assert.equal(exists(before('Banned', 'a.jpg')), true);
  assert.equal(exists(performer('Banned')), false);
});

test('an unknown library is refused before any file moves', async () => {
  write(before('Lost', 'a.jpg'), 'a');
  assert.equal(await codeOf(localImportPerformer('Lost', 'Lost', path.join(dir, 'not-a-library'), null, false)), 'unknown-library');
  assert.equal(await codeOf(uploadImportPerformer('Lost', path.join(dir, 'not-a-library'), [{ path: before('Lost', 'a.jpg'), originalname: 'a.jpg', rel: 'a.jpg' }], null, false)), 'unknown-library');
  assert.equal(exists(before('Lost', 'a.jpg')), true);
});

test('names that leave their folder are refused', async () => {
  write(before('Plain', 'a.jpg'), 'a');
  assert.equal(await codeOf(queue.addLocalImportToQueue({ folderName: 'Plain', performerName: '../x', basePath: media })), 'invalid');
  assert.equal(await codeOf(queue.addLocalImportToQueue({ folderName: '../after filter performer', performerName: 'x', basePath: media })), 'invalid');
  assert.equal(await codeOf(queue.addLocalImportToQueue({ folderName: 'Not There', performerName: 'x', basePath: media })), 'missing');
  assert.equal(await codeOf(localImportPerformer('../before filter performer', 'x', media, null, false)), 'invalid');
  assert.equal(await codeOf(uploadImportPerformer('../x', media, [{ path: before('Plain', 'a.jpg'), originalname: 'a.jpg', rel: 'a.jpg' }], null, false)), 'invalid');
  assert.equal(exists(before('Plain', 'a.jpg')), true);
  assert.equal(await guard.folderNameError(media, 'Plain'), null);
  assert.ok(await guard.folderNameError(media, '..'));
});

test('a folder cannot be queued twice', async () => {
  write(before('Twice', 'a.jpg'), 'a');
  const first = await queue.addLocalImportToQueue({ folderName: 'Twice', performerName: 'Twice', basePath: media });
  assert.ok(queue.activeJobFor({ libPath: media, folderName: 'Twice' }));
  assert.equal(await codeOf(queue.addLocalImportToQueue({ folderName: 'Twice', performerName: 'Twice', basePath: media })), 'queued');
  const job = await waitFor(first.jobId);
  assert.equal(job.status, 'completed');
  assert.equal(job.kind, 'local');
  assert.equal(job.report.imported, 1);
  assert.equal(queue.activeJobFor({ libPath: media, folderName: 'Twice' }), null);
});

test('two uploads: each imports only its own files and removes only its own folder', async () => {
  const loose = path.join(media, '.temp-uploads', '1700000000000-abc-old.jpg');
  write(loose, 'old scheme');
  const tmpA = stageUpload('upload-aaaaaa1', [[['A set/1.jpg', 'a1'], ['A set/2.jpg', 'a2']], [['clip.mp4', 'v'], ['clip.funscript', '{}'], ['notes.txt', 't']]]);
  const tmpB = stageUpload('upload-bbbbbb2', [[['1.jpg', 'b1']]]);

  const a = await queue.addToQueue({ uploadId: 'upload-aaaaaa1', performerName: 'Up A', totalFiles: 5, totalBatches: 2, sourceLabel: 'A set', basePath: media });
  assert.equal(a.files, 5);
  const again = await queue.addToQueue({ uploadId: 'upload-aaaaaa1', performerName: 'Up A', totalFiles: 5, totalBatches: 2, basePath: media });
  assert.deepEqual(again, { jobId: a.jobId, existing: true });
  const ja = await waitFor(a.jobId);
  assert.equal(ja.status, 'completed', ja.error);
  assert.equal(exists(tmpA), false);
  assert.equal(exists(tmpB), true);
  assert.equal(exists(loose), true);
  assert.equal(ja.report.imported, 4);
  assert.equal(ja.report.unsupported, 1);
  assert.deepEqual(fs.readdirSync(performer('Up A', 'pics')).sort(), ['1.jpg', '2.jpg']);
  assert.equal(exists(performer('Up A', 'vids', 'funscript', 'clip', 'clip.funscript')), true);
  assert.equal(ja.kind, 'upload');
  assert.equal(ja.sourceLabel, 'A set');

  const b = await queue.addToQueue({ uploadId: 'upload-bbbbbb2', performerName: 'Up B', totalFiles: 1, totalBatches: 1, basePath: media });
  const jb = await waitFor(b.jobId);
  assert.equal(jb.status, 'completed', jb.error);
  assert.deepEqual(fs.readdirSync(performer('Up B', 'pics')), ['1.jpg']);
  assert.equal(read(performer('Up B', 'pics', '1.jpg')), 'b1');
  assert.equal(exists(tmpB), false);
  assert.equal(exists(loose), true);
});

test('a hand-over with a missing batch or a wrong count is refused', async () => {
  const tmp = stageUpload('upload-cccccc3', [[['1.jpg', 'c1']], [['2.jpg', 'c2']], [['3.jpg', 'c3']]]);
  fs.rmSync(path.join(tmp, 'batch-1.json'));
  let err = await queue.addToQueue({ uploadId: 'upload-cccccc3', performerName: 'Up C', totalFiles: 3, totalBatches: 3, basePath: media }).catch(e => e);
  assert.equal(err.status, 409);
  assert.equal(err.code, 'missing-batches');
  assert.deepEqual(err.missing, [1]);

  err = await queue.addToQueue({ uploadId: 'upload-cccccc3', performerName: 'Up C', totalFiles: 3, totalBatches: 1, basePath: media }).catch(e => e);
  assert.equal(err.code, 'count-mismatch');
  assert.deepEqual([err.have, err.want], [1, 3]);

  err = await queue.addToQueue({ uploadId: 'upload-nope000', performerName: 'Up C', totalFiles: 1, totalBatches: 2, basePath: media }).catch(e => e);
  assert.equal(err.code, 'missing-batches');
  assert.deepEqual(err.missing, [0, 1]);

  err = await queue.addToQueue({ uploadId: 'bad id', performerName: 'Up C', totalFiles: 1, totalBatches: 1, basePath: media }).catch(e => e);
  assert.equal(err.status, 400);
  assert.equal(queue.getQueueStatus().queue.some(j => j.uploadId === 'upload-cccccc3'), false);
});

test('a failed upload keeps its temp folder, runs again on retry, and removing it removes the folder', async () => {
  // The manifest names a file that is not there: nothing can be moved, so the job fails
  const tmp = stageUpload('upload-dddddd4', [[['gone.jpg', null]]]);
  const d = await queue.addToQueue({ uploadId: 'upload-dddddd4', performerName: 'Up D', totalFiles: 1, totalBatches: 1, basePath: media });
  let job = await waitFor(d.jobId);
  assert.equal(job.status, 'error');
  assert.equal(job.report.failed, 1);
  assert.equal(exists(tmp), true);
  assert.equal(exists(performer('Up D')), false);
  assert.equal(queue.jobForUpload('upload-dddddd4'), null);

  const retried = await queue.retryJob(d.jobId);
  assert.deepEqual(retried, { success: true, jobId: d.jobId });
  job = await waitFor(d.jobId);
  assert.equal(job.status, 'error');

  // Now the file is there: a retry imports it and removes the folder
  fs.writeFileSync(path.join(tmp, 'b0-0-gone.jpg'), 'here now');
  await queue.retryJob(d.jobId);
  job = await waitFor(d.jobId);
  assert.equal(job.status, 'completed', job.error);
  assert.equal(exists(tmp), false);
  assert.equal((await queue.retryJob(d.jobId)).code, 'not-failed');

  const tmpE = stageUpload('upload-eeeeee5', [[['x.jpg', null]]]);
  const e = await queue.addToQueue({ uploadId: 'upload-eeeeee5', performerName: 'Up E', totalFiles: 1, totalBatches: 1, basePath: media });
  assert.equal((await waitFor(e.jobId)).status, 'error');
  assert.deepEqual(queue.removeJob(e.jobId), { success: true });
  for (let i = 0; i < 50 && exists(tmpE); i++) await new Promise(r => setTimeout(r, 20));
  assert.equal(exists(tmpE), false);
});

test('a failed local import can be retried while its folder is there', async () => {
  write(before('Retry', 'a.jpg'), 'a');
  const q = await queue.addLocalImportToQueue({ folderName: 'Retry', performerName: 'Retry', basePath: media });
  // Blacklisted after it was queued: the job refuses when it runs
  db.prepare("INSERT INTO performers (name, folder_id, moved_to_after, blacklisted) VALUES ('Retry', ?, 1, 1)").run(folderId);
  let job = await waitFor(q.jobId);
  assert.equal(job.status, 'error');
  assert.equal(exists(before('Retry', 'a.jpg')), true);
  db.prepare("UPDATE performers SET blacklisted = 0 WHERE name = 'Retry'").run();
  assert.equal((await queue.retryJob(q.jobId)).success, true);
  job = await waitFor(q.jobId);
  assert.equal(job.status, 'completed', job.error);
  assert.equal(exists(before('Retry')), false);
});

test('the start-up sweep removes only old upload folders without a job', async () => {
  const old = path.join(media, '.temp-uploads', 'upload-oldold9');
  const fresh = path.join(media, '.temp-uploads', 'upload-fresh99');
  write(path.join(old, 'b0-0-a.jpg'), 'a');
  write(path.join(fresh, 'b0-0-a.jpg'), 'a');
  const past = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
  fs.utimesSync(path.join(old, 'b0-0-a.jpg'), past, past);
  fs.utimesSync(old, past, past);
  const r = await queue.sweepTempUploads();
  assert.equal(r.removed, 1);
  assert.equal(exists(old), false);
  assert.equal(exists(fresh), true);
  assert.equal(exists(path.join(media, '.temp-uploads', '1700000000000-abc-old.jpg')), true);
});

test('countOther counts unsupported files without hidden entries and junk', async () => {
  write(before('Other', 'a.jpg'), 'a');
  write(before('Other', 'b.heic'), 'bb');
  write(before('Other', 'sub', 'c.ts'), 'ccc');
  write(before('Other', 'Thumbs.db'), 'x');
  write(before('Other', '.hidden', 'd.heic'), 'x');
  const other = await guard.countOther(before('Other'));
  assert.equal(other.count, 2);
  assert.equal(other.bytes, 5);
  assert.deepEqual(other.exts.sort(), ['.heic', '.ts']);
});

test('an upload file that cannot be moved stays on the server, the job fails, and a retry moves only what is left', async () => {
  // b.jpg's temp file is missing on the first run, so it fails while a.jpg is placed
  const tmp = stageUpload('upload-keep001', [[['a.jpg', 'aaa'], ['b.jpg', null]]]);
  const k = await queue.addToQueue({ uploadId: 'upload-keep001', performerName: 'Keep', totalFiles: 2, totalBatches: 1, basePath: media });
  let job = await waitFor(k.jobId);
  assert.equal(job.status, 'error');
  assert.equal(job.report.imported, 1);
  assert.equal(job.report.failed, 1);
  assert.equal(job.report.leftIn, '.temp-uploads/upload-keep001');
  assert.equal(exists(tmp), true);
  assert.equal(exists(path.join(tmp, 'job.json')), true);
  assert.equal(exists(performer('Keep', 'pics', 'a.jpg')), true);

  fs.writeFileSync(path.join(tmp, 'b0-1-b.jpg'), 'bbb');
  assert.equal((await queue.retryJob(k.jobId)).success, true);
  job = await waitFor(k.jobId);
  assert.equal(job.status, 'completed', job.error);
  assert.equal(job.report.imported, 1);
  assert.equal(job.report.failed, 0);
  assert.equal(exists(performer('Keep', 'pics', 'b.jpg')), true);
  assert.equal(exists(performer('Keep', 'pics', 'a (2).jpg')), false);
  assert.equal(exists(tmp), false);
});

test('a handed-over upload comes back after a restart as a failed job, is never swept, and a retry finishes it', async () => {
  // As a restart leaves it: the file was moved already, the manifest and job.json are still there, the queue is empty
  const tmp = stageUpload('upload-back001', [[['c.jpg', null]]]);
  write(performer('Back', 'pics', 'c.jpg'), 'ccc');
  fs.writeFileSync(path.join(tmp, 'job.json'), JSON.stringify({ id: 'job-1-back', performerName: 'Back', requestedName: 'Back', totalFiles: 1, createHashes: false }));
  const past = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
  for (const name of fs.readdirSync(tmp)) fs.utimesSync(path.join(tmp, name), past, past);
  fs.utimesSync(tmp, past, past);

  await queue.sweepTempUploads();
  assert.equal(exists(tmp), true);
  let job = queue.getQueueStatus().queue.find(j => j.id === 'job-1-back');
  assert.equal(job.status, 'error');
  assert.equal(job.kind, 'upload');
  assert.equal(job.error, 'The server restarted during this import');

  assert.equal((await queue.retryJob('job-1-back')).success, true);
  job = await waitFor('job-1-back');
  assert.equal(job.status, 'completed', job.error);
  assert.equal(job.report.failed, 0);
  assert.ok(db.prepare("SELECT id FROM performers WHERE name = 'Back'").get());
  assert.equal(exists(tmp), false);
});

test('removing a job that is not there answers not-found', () => {
  assert.deepEqual(queue.removeJob('job-none'), { success: false, status: 404, code: 'not-found', error: 'This import is no longer in the queue' });
});

test('a pair does not join a folder that holds another script of its name', async () => {
  write(performer('Pair2', 'vids', 'funscript', 'clip', 'clip.funscript'), 'old');
  write(before('Pair2', 'clip.mp4'), 'video');
  write(before('Pair2', 'clip.funscript'), 'new');
  const r = await localImportPerformer('Pair2', 'Pair2', media, null, false);
  assert.equal(r.report.failed, 0);
  assert.equal(read(performer('Pair2', 'vids', 'funscript', 'clip', 'clip.funscript')), 'old');
  assert.equal(read(performer('Pair2', 'vids', 'funscript', 'clip (2)', 'clip.mp4')), 'video');
  assert.equal(read(performer('Pair2', 'vids', 'funscript', 'clip (2)', 'clip.funscript')), 'new');
});
