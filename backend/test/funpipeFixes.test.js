/**
 * Review fixes in the funpipe queue and routes: an uploaded script never loses the one already beside the video,
 * "reviewed" counts the editor's picks, and the funscripts route lists and deletes only a video's own scripts.
 * Runs against a database and a library made here: nothing of the real ones is touched.
 */
const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acm-funpipe-fixes-'));
const root = path.join(dir, 'library');
const vids = path.join(root, 'after filter performer', 'Someone', 'vids', 'funscript', 'set_1');
fs.mkdirSync(vids, { recursive: true });
process.env.DB_PATH = path.join(dir, 'app.db');

const db = require('../db');
const q = require('../services/funpipeQueue');
const { editsAreMeaningful } = require('../routes/funpipe')._internal;
const { videoScripts } = require('../services/fileTrash');

db.prepare('INSERT INTO folders (path) VALUES (?)').run(root);

const video = path.join(vids, 'set_1.mp4');
fs.writeFileSync(video, 'not really a video');
const script = path.join(vids, 'set_1.funscript');
const upload = (body) => q.writeSidecar(video, '.funscript', Readable.from([JSON.stringify(body)]));
const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const clean = () => {
  for (const f of fs.readdirSync(vids)) if (f.endsWith('.funscript') || f.endsWith('.bak')) fs.rmSync(path.join(vids, f));
};

after(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('an upload with no script beside the video just lands', async () => {
  clean();
  const r = await upload({ author: 'funpipe', actions: [1] });
  assert.equal(r.status, 200);
  assert.deepEqual(read(script).actions, [1]);
  assert.deepEqual(fs.readdirSync(vids).filter(f => f !== 'set_1.mp4'), ['set_1.funscript']);
});

test("a human's script is moved to .human.funscript, then to a dated name", async () => {
  clean();
  fs.writeFileSync(script, JSON.stringify({ author: 'me', actions: ['mine'] }));
  assert.equal((await upload({ author: 'funpipe', actions: [2] })).status, 200);
  assert.deepEqual(read(path.join(vids, 'set_1.human.funscript')).actions, ['mine']);
  assert.deepEqual(read(script).actions, [2]);

  fs.writeFileSync(script, 'not json');   // unreadable counts as a human's too
  assert.equal((await upload({ author: 'funpipe', actions: [3] })).status, 200);
  const dated = fs.readdirSync(vids).filter(f => /^set_1\.human\.\d{8}-\d{6}\.funscript$/.test(f));
  assert.equal(dated.length, 1);
  assert.equal(fs.readFileSync(path.join(vids, dated[0]), 'utf8'), 'not json');
  assert.deepEqual(read(path.join(vids, 'set_1.human.funscript')).actions, ['mine']);
  assert.deepEqual(read(script).actions, [3]);
});

test("funpipe's own script is backed up to .funscript.bak", async () => {
  clean();
  fs.writeFileSync(script, JSON.stringify({ author: 'funpipe', actions: ['old'] }));
  assert.equal((await upload({ author: 'funpipe', actions: ['new'] })).status, 200);
  assert.deepEqual(read(`${script}.bak`).actions, ['old']);
  assert.deepEqual(read(script).actions, ['new']);
  assert.ok(!fs.existsSync(path.join(vids, 'set_1.human.funscript')));
});

test("scenetest's script goes to \"(auto)\", replacing an earlier one, never to .human", async () => {
  clean();
  const auto = path.join(vids, 'set_1 (auto).funscript');
  fs.writeFileSync(auto, JSON.stringify({ author: 'scenetest+funpipe', actions: ['older'] }));
  fs.writeFileSync(script, JSON.stringify({ author: 'scenetest+funpipe', actions: ['scenetest'] }));
  assert.equal((await upload({ author: 'funpipe', actions: [4] })).status, 200);
  assert.deepEqual(read(auto).actions, ['scenetest']);
  assert.deepEqual(read(script).actions, [4]);
  assert.ok(!fs.existsSync(path.join(vids, 'set_1.human.funscript')));
});

test("the review editor's script is kept as .reviewed.funscript, then a dated name", async () => {
  clean();
  fs.writeFileSync(script, JSON.stringify({ author: 'funpipe-review', actions: ['fixed'] }));
  assert.equal((await upload({ author: 'funpipe', actions: [5] })).status, 200);
  assert.deepEqual(read(path.join(vids, 'set_1.reviewed.funscript')).actions, ['fixed']);
  assert.deepEqual(read(script).actions, [5]);

  fs.writeFileSync(script, JSON.stringify({ author: 'funpipe-review', actions: ['fixed again'] }));
  assert.equal((await upload({ author: 'funpipe', actions: [6] })).status, 200);
  const dated = fs.readdirSync(vids).filter(f => /^set_1\.reviewed\.\d{8}-\d{6}\.funscript$/.test(f));
  assert.equal(dated.length, 1);
  assert.deepEqual(read(path.join(vids, dated[0])).actions, ['fixed again']);
  assert.deepEqual(read(path.join(vids, 'set_1.reviewed.funscript')).actions, ['fixed']);
  assert.ok(!fs.existsSync(path.join(vids, 'set_1.human.funscript')));
});

test('keeping a script aside only copies it: the video keeps its script until the new one replaces it', async () => {
  clean();
  for (const author of ['me', 'scenetest+funpipe', 'funpipe-review', 'funpipe']) {
    fs.writeFileSync(script, JSON.stringify({ author, actions: [author] }));
    const kept = await q.keepExistingScript(script);
    assert.deepEqual(read(kept).actions, [author]);
    assert.deepEqual(read(script).actions, [author]);
  }
  assert.equal(await q.keepExistingScript(path.join(vids, 'none.funscript')), null);
});

test('.vjepa.npz is a sidecar a worker may write', () => {
  assert.equal(q.sidecarFile(video, '.vjepa.npz'), `${video}.vjepa.npz`);
});

test('reviewed counts picks that are not implicit', async () => {
  const edits = path.join(dir, 'x.edits.json');
  const check = (e) => { fs.writeFileSync(edits, JSON.stringify(e)); return editsAreMeaningful(edits); };
  assert.equal(await check({ picks: [{ t: 3, type: 'group', group: 1 }] }), true);
  assert.equal(await check({ picks: [{ t: 0, type: 'idle', implicit: true }] }), false);
  assert.equal(await check({ picks: [], windows: {} }), false);
  assert.equal(await check({ range_marks: [{ t: 1 }] }), true);
});

// The funscripts route lists through fileTrash.videoScripts (its delete moves to .trash and checks the script is
// the video's own: fileTrash's tests). Here: the names the queue keeps aside next to a video.
test('the funscripts route lists only this video\'s scripts', async () => {
  clean();
  for (const f of ['set_1.funscript', 'set_1.human.funscript', 'set_1 (auto).funscript', 'set_10.funscript',
    'set_1.funscript.bak', 'set_1x.funscript']) fs.writeFileSync(path.join(vids, f), '{}');
  const names = (await videoScripts(video)).map(s => s.name).sort();
  // "<stem> (auto).funscript" (scenetest's) is not listed: the route takes <stem>.funscript and <stem>.<axis>.funscript
  assert.deepEqual(names, ['set_1.funscript', 'set_1.human.funscript']);
});
