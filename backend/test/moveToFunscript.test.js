/**
 * The player's "Move to funscript folder" (POST /api/scenes/video/move-to-funscript): the video goes to
 * <its folder>/funscript/<name>/ with its scripts and sidecars, and its labels, tags and ratings follow it
 * (services/movedFile). Runs against a database and a library made here.
 */
const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const express = require('express');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acm-move-funscript-'));
const root = path.join(dir, 'library');
const vids = path.join(root, 'after filter performer', 'Someone', 'vids');
fs.mkdirSync(vids, { recursive: true });
process.env.DB_PATH = path.join(dir, 'app.db');

const db = require('../db');
db.prepare('INSERT INTO folders (path) VALUES (?)').run(root);

const app = express();
app.use(express.json());
app.use('/api/scenes', require('../routes/scenes'));
const server = http.createServer(app).listen(0);
const post = async (body) => {
  const r = await fetch(`http://127.0.0.1:${server.address().port}/api/scenes/video/move-to-funscript`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  return { status: r.status, body: await r.json() };
};

after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  // npm test's --test-force-exit kills the process at once: work the move left in libuv's threadpool crashed it
  // (0xC0000409) when it had no moment to finish
  await new Promise((resolve) => setTimeout(resolve, 300));
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the video, its scripts and sidecars move; its labels, tags and ratings follow', async () => {
  const video = path.join(vids, 'clip.mp4');
  for (const f of ['clip.mp4', 'clip.funscript', 'clip.mp4.labels.json', 'clip.mp4.motion.json', 'clip10.mp4']) fs.writeFileSync(path.join(vids, f), 'x');
  db.prepare("INSERT INTO video_labels (file_path, seconds, scenes, exposure) VALUES (?, 10, '[]', '[]')").run(video);
  db.prepare("INSERT INTO file_tags (file_path, tag) VALUES (?, 'solo')").run(video);

  const r = await post({ videoPath: video });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const target = path.join(vids, 'funscript', 'clip');
  assert.equal(r.body.newVideoPath, path.join(target, 'clip.mp4'));
  assert.deepEqual(fs.readdirSync(target).sort(), ['clip.funscript', 'clip.mp4', 'clip.mp4.labels.json', 'clip.mp4.motion.json']);
  assert.ok(fs.existsSync(path.join(vids, 'clip10.mp4')), 'another video with a longer name stays');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM video_labels WHERE file_path = ?').get(r.body.newVideoPath).n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM file_tags WHERE file_path = ?').get(r.body.newVideoPath).n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM video_labels WHERE file_path = ?').get(video).n, 0);

  const again = await post({ videoPath: r.body.newVideoPath });
  assert.equal(again.status, 409, 'one in a funscript folder already is refused');
});

test('a file outside the library is refused', async () => {
  const outside = path.join(dir, 'elsewhere.mp4');
  fs.writeFileSync(outside, 'x');
  assert.equal((await post({ videoPath: outside })).status, 400);
  assert.ok(fs.existsSync(outside));
});
