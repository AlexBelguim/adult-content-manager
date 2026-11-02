/**
 * Discover: the routes, a real scan and what reaches the profile page and P's training. Runs on a database and a data folder made
 * here, with stand-ins on loopback for a site, acm-gpu and the NAS's CPU service: nothing real is touched.
 */
const { after, before, beforeEach, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acm-discovery-'));
process.env.DB_PATH = path.join(dir, 'app.db');
process.env.DATA_PATH = path.join(dir, 'data');
process.env.FLARESOLVERR_URL = 'http://127.0.0.1:9/v1';
const PROFILE = path.join(process.env.DATA_PATH, 'profile');
fs.mkdirSync(PROFILE, { recursive: true });

const express = require('express');
const sharp = require('sharp');
const Database = require('better-sqlite3');
const db = require('../db');
const { WATCHERS, LIMITS } = require('../services/discover/watchers');
const { ADAPTERS } = require('../services/discover/scan');
const runner = require('../services/discover/runner');
const { CACHE } = require('../services/discover/paths');
const { run: importResults } = require('../scripts/import-keep-scanner');

const stub = { gpu: 'up', cpu: 'up', gpuCalls: 0, cpuCalls: 0, weightsSeen: null, picture: null, siteBase: null, posts: [] };
const WEIGHTS = { coef: [0.1, 0.2], intercept: -1, backbone: 'clip', model: 'performer_keep.pt' };
let base, servers = [];

const listen = (handler) => new Promise((resolve) => {
  const s = http.createServer(handler).listen(0, '127.0.0.1', () => { servers.push(s); resolve(`http://127.0.0.1:${s.address().port}`); });
});
const readJson = (req) => new Promise((resolve) => {
  let data = '';
  req.on('data', (c) => { data += c; });
  req.on('end', () => resolve(data ? JSON.parse(data) : {}));
});
const reply = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
// a picture named high-... scores 80, any other 20; several together score their mean
const score = (names) => names.reduce((s, n) => s + (/high/.test(n) ? 80 : 20), 0) / names.length;

const api = async (method, url, body) => {
  const res = await fetch(`${base}${url}`, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const get = (url) => api('GET', url).then((r) => r.body);
const post = (url, body = {}) => api('POST', url, body);

async function runScan(body = {}) {
  const started = await post('/api/discovery/scan', body);
  assert.equal(started.status, 202);
  for (let i = 0; i < 200; i++) {
    const s = await get('/api/discovery/summary');
    if (!s.job.running) return s;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('the scan did not end');
}

const aPost = (id, title = id) => ({ postId: id, title, postUrl: `${stub.siteBase}/post/${id}`, shareUrl: null, image: `${stub.siteBase}/pic/${id}.jpg`, createdAt: '2026-11-01T00:00:00Z', info: {} });
const performerNamed = async (name, view = '') => (await get(`/api/discovery/performers?q=${encodeURIComponent(name)}${view && `&view=${view}`}`)).items.find((g) => g.names.includes(name));
const labels = () => { const f = path.join(PROFILE, 'alex_labels.json'); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {}; };
const eventsOf = (kind) => db.prepare('SELECT * FROM discover_events WHERE kind = ?').all(kind);

before(async () => {
  stub.picture = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#884422' } }).jpeg().toBuffer();
  stub.siteBase = await listen((req, res) => {
    res.writeHead(200, { 'Content-Type': 'image/jpeg' });
    res.end(stub.picture);
  });
  const judge = (who) => async (req, res) => {
    if (stub[who] === 'down') return req.socket.destroy();
    if (req.url === '/performer_keep/weights') return reply(res, 200, WEIGHTS);
    const body = await readJson(req);
    stub[`${who}Calls`]++;
    if (who === 'cpu') stub.weightsSeen = body.weights || null;
    reply(res, 200, { score: score(body.names), model: 'performer_keep.pt', used: body.images.length, failed: [] });
  };
  process.env.AI_SERVER_URL = await listen(judge('gpu'));
  process.env.P_CPU_URL = await listen(judge('cpu'));

  Object.assign(LIMITS, { requestsPerSecond: 1000 });
  WATCHERS.length = 0;
  WATCHERS.push({ id: 'stand-in-new', label: 'Stand-in new', name: 'standin', adapter: 'standin', kind: 'posts', url: 'http://site/', watch: true });
  ADAPTERS.standin = () => ({
    name: 'standin',
    listPage: async () => ({ posts: stub.posts, next: null }),
    page: async (p) => ({ kind: 'post', name: p.title, link: `https://leakshaven.com/model/${encodeURIComponent(p.title)}` }),
  });

  const app = express();
  app.use(express.json({ limit: '50mb' }));
  app.use('/api/discovery', require('../routes/discovery'));
  app.use('/api/profile', require('../routes/profile'));
  app.use('/api/jobs', require('../routes/jobs'));
  base = await listen(app);
});

after(() => {
  for (const s of servers) s.close();
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  Object.assign(stub, { gpu: 'up', cpu: 'up', gpuCalls: 0, cpuCalls: 0, weightsSeen: null, posts: [] });
});

test('a scan judges new posts on acm-gpu, keeps what is over the line and never judges a post twice', async () => {
  stub.posts = [aPost('high-anna', 'Anna High'), aPost('low-bea', 'Bea Low')];
  const s = await runScan();
  assert.equal(s.job.exitCode, 0, s.job.log.join('\n'));
  assert.equal(stub.gpuCalls, 2);
  assert.equal(stub.cpuCalls, 0);
  assert.equal((await performerNamed('Anna High')).best_score, 80);
  assert.equal((await get('/api/discovery/performers?view=liked&q=Bea')).total, 0);
  assert.equal((await get('/api/discovery/performers?q=Bea')).total, 1);
  assert.match((await performerNamed('Anna High')).image, /^\/api\/discovery\/cache\//);

  await runScan();
  assert.equal(stub.gpuCalls, 2, 'nothing new, nothing judged');
  const w = (await get('/api/discovery/summary')).watchers[0];
  assert.equal(w.checked, 2);
  assert.ok(w.last_checked);
});

test('with the PC off the NAS\'s CPU service judges, with P\'s numbers from acm-gpu', async () => {
  stub.posts = [aPost('high-cara', 'Cara High')];
  await runScan();   // saves the weights while acm-gpu answers (and judges Cara there)
  stub.gpu = 'down';
  stub.posts = [aPost('high-dee', 'Dee High'), ...stub.posts];
  const s = await runScan();
  assert.equal(stub.cpuCalls, 1);
  assert.deepEqual(stub.weightsSeen, WEIGHTS);
  assert.equal(typeof s.job.secondsPerPicture, 'number');
  assert.equal((await performerNamed('Dee High')).best_score, 80);
});

test('the seconds a picture on the NAS\'s CPU stay after a run that didn\'t use it', async () => {
  stub.gpu = 'down';
  stub.posts = [aPost('high-zoe', 'Zoe High')];
  const onCpu = await runScan();
  assert.equal(typeof onCpu.job.secondsPerPicture, 'number');
  stub.gpu = 'up';
  stub.posts = [aPost('high-zia', 'Zia High'), ...stub.posts];
  const onGpu = await runScan();
  assert.equal(onGpu.job.secondsPerPicture, onCpu.job.secondsPerPicture);
});

test('with nobody to judge a post waits, and a later run judges it and finds its link', async () => {
  stub.gpu = 'down';
  stub.cpu = 'down';
  stub.posts = [aPost('high-erin', 'Erin High')];
  let s = await runScan();
  assert.equal(s.job.exitCode, 0, 'a scan does not stop for this');
  assert.equal(s.totals.waiting, 1);
  assert.equal(await performerNamed('Erin High'), undefined, 'not a performer until judged');
  assert.equal(db.prepare("SELECT waiting FROM discover_posts WHERE post_id = 'high-erin'").get().waiting, 1);

  stub.gpu = 'up';
  s = await runScan();
  assert.equal(s.totals.waiting, 0);
  const row = db.prepare("SELECT * FROM discover_posts WHERE post_id = 'high-erin'").get();
  assert.equal(row.kept, 1);
  assert.equal(row.waiting, 0);
  assert.ok(row.saved_link);
  assert.equal(JSON.parse(row.info).post, undefined, 'the saved listing goes once it is judged');
});

test('Keep puts a new performer on the profile page as a Discover verdict in Discover\'s round, with her pictures for training', async () => {
  stub.posts = [aPost('high-fay', 'Fay High')];
  await runScan();
  const g = await performerNamed('Fay High');
  const r = await post('/api/discovery/performer-status', { group: g.id, status: 'kept' });
  assert.equal(r.status, 200);
  assert.equal(r.body.failed, 0);

  assert.equal(await performerNamed('Fay High'), undefined, 'off Performers');
  assert.ok(await performerNamed('Fay High', 'kept'), 'on Kept');
  const label = labels()['discover/fayhigh'];
  assert.equal(label.verdict, 'keep');
  assert.equal(label.source, 'discover');
  assert.equal(label.round, 1);

  const card = (await get('/api/profile/performers')).find((p) => p.slug === 'fayhigh');
  assert.equal(card.label, 'keep');
  assert.equal(card.origin, 'scanner');
  assert.equal((await get('/api/profile/training')).verdicts['discover/fayhigh'], 'keep');
  const rounds = await get('/api/profile/rounds');
  assert.equal(rounds.rounds.discover[0].keep, 1);
  const rec = (await get('/api/profile/collection')).records.find((x) => x.slug === 'fayhigh');
  assert.equal(rec.site, 'discover');
  assert.equal(rec.pictures.length, 1);
  const pic = await fetch(`${base}/api/profile/full?site=discover&slug=fayhigh&file=${rec.pictures[0]}`);
  assert.equal(pic.status, 200);
  assert.equal((await fetch(`${base}/api/profile/thumb?site=discover&slug=fayhigh`)).status, 200);
});

test('a new round of Discover takes the next verdicts; Super wrong is a heavier delete', async () => {
  await api('PUT', '/api/profile/rounds', { start: 'discover' });
  stub.posts = [aPost('high-gia', 'Gia High')];
  await runScan();
  const g = await performerNamed('Gia High');
  await post('/api/discovery/performer-status', { group: g.id, status: 'deleted', superWrong: true });
  const label = labels()['discover/giahigh'];
  assert.equal(label.verdict, 'superwrong');
  assert.equal(label.round, 2);
});

test('found again: a deleted performer comes back red, once; a kept and checked one green', async () => {
  // the same title joins them into one performer, so the second post is a new find of hers
  stub.posts = [aPost('high-hana1', 'Hana High'), aPost('high-ivy1', 'Ivy High')];
  await runScan();
  await post('/api/discovery/performer-status', { group: (await performerNamed('Hana High')).id, status: 'deleted' });
  await post('/api/discovery/performer-status', { group: (await performerNamed('Ivy High')).id, status: 'kept' });
  await post('/api/discovery/performer-status', { group: (await performerNamed('Ivy High', 'kept')).id, status: 'checked' });
  assert.equal(await performerNamed('Hana High'), undefined);
  assert.equal(await performerNamed('Ivy High', 'kept'), undefined, 'checked: off Kept');

  stub.posts = [aPost('high-hana2', 'Hana High'), aPost('high-ivy2', 'Ivy High'), ...stub.posts];
  await runScan();
  assert.equal((await performerNamed('Hana High')).update, 'red');
  assert.equal((await performerNamed('Ivy High', 'kept')).update, 'green');
  const updates = eventsOf('update').length;
  await runScan();
  assert.equal(eventsOf('update').length, updates, 'told once per set of new finds');
  const marks = Object.fromEntries((await get('/api/profile/performers')).filter((p) => p.update_mark).map((p) => [p.slug, p.update_mark]));
  assert.equal(marks.hanahigh, 'red');
  assert.equal(marks.ivyhigh, 'green');
});

test('Remove takes a performer off Discover and tells the profile page nothing', async () => {
  stub.posts = [aPost('high-jade1', 'Jade High')];
  await runScan();
  const before_ = db.prepare('SELECT COUNT(*) AS n FROM discover_events').get().n;
  const r = await post('/api/discovery/performer-status', { group: (await performerNamed('Jade High')).id, status: 'removed' });
  assert.equal(r.status, 200);
  assert.equal(await performerNamed('Jade High'), undefined);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM discover_events').get().n, before_, 'no event');
  assert.equal(labels()['discover/jadehigh'], undefined, 'no verdict');
  assert.equal((await get('/api/profile/performers')).find((p) => p.slug === 'jadehigh'), undefined, 'not on the profile page');

  stub.posts = [aPost('high-jade2', 'Jade High'), ...stub.posts];
  await runScan();
  const again = await performerNamed('Jade High');
  assert.equal(again.update, 'again', 'back, plainly');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM discover_events').get().n, before_, 'still nothing sent');
});

test('POST /performers: a performer the profile page already has is merged and set undecided, whatever the event', async () => {
  fs.writeFileSync(path.join(PROFILE, 'babepedia.jsonl'), `${JSON.stringify({ site: 'babepedia', slug: 'kira_had', name: 'Kira Had', url: 'u', pictures: ['1.jpg'], fields: {} })}\n`);
  fs.writeFileSync(path.join(PROFILE, 'alex_labels.json'), JSON.stringify({ ...labels(), 'babepedia/kira_had': { verdict: 'delete', source: 'profile', round: 1 } }));
  const picture = { name: 'a.jpg', type: 'image/jpeg', data: stub.picture.toString('base64') };
  const r = await post('/api/discovery/performers', { event: 'keep', key: 'post:x:kira', members: ['post:x:kira'], name: 'kira had', aliases: ['K'], links: ['https://x/kira'], pictures: [picture], verdict: 'keep', best_score: 70 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.result, 'merged');
  assert.equal(r.body.status, 'undecided');
  assert.equal(labels()['babepedia/kira_had'], undefined, 'her verdict there is cleared');
  const entry = db.prepare("SELECT * FROM discover_entries WHERE key = 'post:x:kira'").get();
  assert.equal(entry.merged_into, 'babepedia/kira_had');
  assert.equal(JSON.parse(entry.was_verdict).verdict, 'delete', 'and kept');
  const card = (await get('/api/profile/performers')).find((p) => p.slug === 'kira_had');
  assert.equal(card.pictures, 2, 'her picture joined the record');
  assert.equal(card.origin, 'scanner');
  const file = (await get('/api/profile/performer?site=babepedia&slug=kira_had')).pictures[1];
  assert.equal((await fetch(`${base}/api/profile/full?site=babepedia&slug=kira_had&file=${file}`)).status, 200);

  const twice = await post('/api/discovery/performers', { event: 'delete', key: 'post:x:kira', name: 'kira had', verdict: 'delete' });
  assert.equal(twice.body.result, 'merged');
  assert.equal(twice.body.status, 'undecided');
  assert.equal(labels()['babepedia/kira_had'], undefined);
});

test('POST /performers: her scrape data reaches the profile page\'s filters', async () => {
  const r = await post('/api/discovery/performers', { event: 'keep', key: 'post:x:nina', name: 'Nina Data', verdict: 'keep', links: ['https://leakshaven.com/model/Nina%20Data'],
    profile: { name: 'Nina Data', profile: { born: '2003-06-01', hair_color: 'Brown', ethnicity: 'White', measurements_cup: '34C (Natural)' }, aliases: [], tags: [] } });
  assert.equal(r.body.result, 'created');
  const card = (await get('/api/profile/performers')).find((p) => p.slug === 'ninadata');
  assert.equal(card.hair, 'brown');
  assert.equal(card.ethnicity, 'caucasian');
  assert.equal(card.cup, 'C');
  assert.equal(card.natural, 'natural');
  assert.equal(card.age, new Date().getFullYear() - 2003);
  const detail = await get('/api/profile/performer?site=discover&slug=ninadata');
  assert.equal(detail.url, 'https://leakshaven.com/model/Nina%20Data');
  assert.equal(detail.label.verdict, 'keep');
});

test('POST /performers: a library performer is found by name and by her Leakhaven link, and lands undecided', async () => {
  const folder = db.prepare("INSERT INTO folders (path) VALUES (?)").run(path.join(dir, 'library')).lastInsertRowid;
  const id = db.prepare("INSERT INTO performers (name, folder_id, leakshaven_url) VALUES ('Lena Lib', ?, 'https://leakshaven.com/model/LenaL')").run(folder).lastInsertRowid;
  const byName = await post('/api/discovery/performers', { event: 'delete', key: 'post:x:lena1', name: 'Lena Lib', verdict: 'delete' });
  assert.equal(byName.body.result, 'merged');
  assert.equal(byName.body.performer_id, Number(id));
  assert.equal(byName.body.status, 'undecided');
  const byLink = await post('/api/discovery/performers', { event: 'keep', key: 'post:x:lena2', name: 'Somebody Else', links: ['https://leakshaven.com/?q=LenaL'], verdict: 'keep' });
  assert.equal(byLink.body.result, 'merged');
  assert.equal(byLink.body.performer_id, Number(id));
  const again = await post('/api/discovery/performers', { event: 'keep', key: 'post:x:lena1', name: 'Lena Lib', verdict: 'keep' });
  assert.equal(again.body.status, 'undecided', 'she is decided on the profile page, every time');
  assert.equal(again.body.performer_id, Number(id));
  assert.equal(labels()['discover/lenalib'], undefined);
});

test('POST /performers: refuses what it can\'t use and can\'t be made to read a file of this server', async () => {
  assert.equal((await post('/api/discovery/performers', { event: 'nope', key: 'k', name: 'n' })).status, 400);
  assert.equal((await post('/api/discovery/performers', { event: 'keep', name: 'n' })).status, 400);
  assert.equal((await post('/api/discovery/performers', { event: 'keep', key: 'k' })).status, 400);
  assert.equal((await post('/api/discovery/performers', { event: 'keep', key: 'k', name: 'n', verdict: 'love' })).status, 400);

  const secret = path.join(CACHE, 'secret.jpg');
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(secret, stub.picture);
  const r = await post('/api/discovery/performers', { event: 'keep', key: 'post:x:mona', name: 'Mona Files', files: ['secret.jpg'], pictures: ['file:///etc/passwd'], verdict: 'keep' });
  assert.equal(r.status, 200);
  assert.equal(r.body.result, 'created');
  assert.deepEqual(JSON.parse(db.prepare("SELECT pictures FROM discover_entries WHERE key = 'post:x:mona'").get().pictures), []);
});

test('Upload: judged, sent as undecided; Remove sends nothing and takes the files', async () => {
  const upload = (await post('/api/discovery/uploads', { name: 'Nell Up', kind: 'performer' })).body;
  const add = (name, type = 'image/jpeg') => fetch(`${base}/api/discovery/uploads/${upload.id}/files?name=${name}`, { method: 'POST', headers: { 'Content-Type': type }, body: stub.picture });
  assert.equal((await add('high-1.jpg')).status, 200);
  assert.equal((await add('notes.txt', 'text/plain')).status, 415);
  await add('high-2.jpg');
  const judged = await post(`/api/discovery/uploads/${upload.id}/score`);
  assert.equal(judged.status, 200, JSON.stringify(judged.body));
  assert.equal(judged.body.files.length, 2);
  assert.equal(judged.body.score, 20, 'stored under their own names, so the stand-in scores them low');

  const sent = await post(`/api/discovery/uploads/${upload.id}/send`);
  assert.equal(sent.status, 200);
  assert.equal(sent.body.failed, 0);
  const card = (await get('/api/profile/performers')).find((p) => p.name === 'Nell Up');
  assert.equal(card.origin, 'upload');
  assert.equal(card.label, null);
  assert.equal(card.pictures, 1, 'the same picture twice is one file');

  const other = (await post('/api/discovery/uploads', { name: 'Olga Gone', kind: 'performer' })).body;
  await fetch(`${base}/api/discovery/uploads/${other.id}/files?name=a.jpg`, { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: stub.picture });
  const events = db.prepare('SELECT COUNT(*) AS n FROM discover_events').get().n;
  assert.equal((await api('DELETE', `/api/discovery/uploads/${other.id}`)).status, 200);
  assert.equal(fs.existsSync(path.join(CACHE, 'uploads', other.id)), false);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM discover_events').get().n, events);
  assert.equal((await get('/api/profile/performers')).find((p) => p.name === 'Olga Gone'), undefined);
  assert.equal((await post('/api/discovery/uploads/uNOPE/score')).status, 404);
  const big = (await post('/api/discovery/uploads', { kind: 'picture' })).body;
  const tooBig = await fetch(`${base}/api/discovery/uploads/${big.id}/files?name=big.jpg`, { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: Buffer.alloc(26 * 1024 * 1024) });
  assert.equal(tooBig.status, 413);
});

test('Upload: while nobody can judge it says so and the entry stays', async () => {
  stub.gpu = 'down';
  stub.cpu = 'down';
  const upload = (await post('/api/discovery/uploads', { kind: 'picture' })).body;
  await fetch(`${base}/api/discovery/uploads/${upload.id}/files?name=high.jpg`, { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: stub.picture });
  const r = await post(`/api/discovery/uploads/${upload.id}/score`);
  assert.equal(r.status, 503);
  assert.equal((await get('/api/discovery/uploads')).items.find((u) => u.id === upload.id).files.length, 1);
});

test('Duplicates: Combine joins two performers, Not the same keeps them apart, Keep / Drop decide the liked', async () => {
  stub.posts = [aPost('high-pia', 'Pia High'), aPost('high-pia2', 'Piahigh Other'), aPost('high-rae', 'Rae High'), aPost('high-sue', 'Sue High')];
  await runScan();
  const [a, b, c] = await Promise.all(['Pia High', 'Rae High', 'Sue High'].map((n) => performerNamed(n)));
  assert.equal((await post('/api/discovery/duplicates', { action: 'combine', a: a.id, b: a.id })).status, 400);
  assert.equal((await post('/api/discovery/duplicates', { action: 'nonsense' })).status, 400);
  assert.equal((await post('/api/discovery/duplicates', { action: 'combine', a: a.id, b: b.id })).status, 200);
  const joined = await performerNamed('Pia High');
  assert.ok(joined.names.includes('Rae High'));
  assert.equal(joined.members.length, 2);
  await new Promise((r) => setTimeout(r, 200));   // the pools run a combine starts
  assert.equal((await post('/api/discovery/duplicates', { action: 'drop', members: c.members.map((m) => m.key) })).status, 200);
  assert.equal((await get('/api/discovery/performers?view=liked&q=Sue')).total, 0, 'dropped: no longer liked');
});

test('a pair with a hidden performer leaves both the list and its count', async () => {
  const s0 = (await get('/api/discovery/summary')).totals;
  stub.posts = [aPost('high-amy', 'Amy Rose'), aPost('high-amy2', 'Amyrose')];
  await runScan();
  const s1 = (await get('/api/discovery/summary')).totals;
  assert.equal(s1.duplicates_pairs, s0.duplicates_pairs + 1);
  await post('/api/discovery/performer-status', { group: (await performerNamed('Amy Rose')).id, status: 'removed' });
  const s2 = (await get('/api/discovery/summary')).totals;
  assert.equal(s2.duplicates_pairs, s0.duplicates_pairs);
  assert.equal(s2.duplicates_fallen, s0.duplicates_fallen);
  assert.equal(s2.duplicates, s0.duplicates);
});

test('Add performer: a library performer with no files, her folder and her Leakhaven link; once', async () => {
  stub.posts = [aPost('high-tess', 'Tess High')];
  await runScan();
  const g = await performerNamed('Tess High');
  const r = await post('/api/discovery/add-performer', { group: g.id });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const row = db.prepare('SELECT * FROM performers WHERE id = ?').get(r.body.performer_id);
  assert.equal(row.leakshaven_url, 'https://leakshaven.com/model/Tess%20High');
  assert.equal(row.folder_id, db.prepare('SELECT id FROM folders ORDER BY id LIMIT 1').get().id);
  assert.ok(fs.existsSync(path.join(dir, 'library', 'before filter performer', 'Tess High')), 'or the library would call her an orphan');
  assert.equal((await post('/api/discovery/add-performer', { group: g.id })).status, 409);
  assert.equal((await performerNamed('Tess High')).in_library, 'Tess High');
  assert.equal((await post('/api/discovery/add-performer', { group: 'nobody' })).status, 404);
});

test('runs: one by hand at a time, and Pause stops it between two posts', async () => {
  stub.posts = Array.from({ length: 30 }, (_, i) => aPost(`high-una${i}`));
  const first = await post('/api/discovery/scan');
  const second = await post('/api/discovery/scan');
  assert.equal(first.status, 202);
  assert.equal(second.status, 409);
  assert.equal((await post('/api/discovery/pause')).status, 200);
  let s;
  for (let i = 0; i < 200; i++) {
    s = await get('/api/discovery/summary');
    if (!s.job.running) break;
    await new Promise((r) => setTimeout(r, 25));
  }
  assert.equal(s.job.running, false);
  assert.equal(s.job.paused, true);
  assert.ok(db.prepare("SELECT COUNT(*) AS n FROM discover_posts WHERE post_id LIKE 'high-una%'").get().n < 30, 'stopped before the end');
  assert.equal((await post('/api/discovery/pause')).status, 409, 'nothing to pause');
});

test('the timer stays off until it is switched on, and stays on across a restart of the app', async () => {
  assert.equal((await post('/api/discovery/watch', { on: false })).status, 200);

  assert.equal((await get('/api/discovery/summary')).watch.on, false);
  const on = await post('/api/discovery/watch', { on: true, minutes: 30 });
  assert.equal(on.body.watch.on, true);
  assert.equal(on.body.watch.minutes, 30);
  for (let i = 0; i < 100 && (await get('/api/discovery/summary')).watchJob.running; i++) await new Promise((r) => setTimeout(r, 25));
  const started = (await get('/api/discovery/summary')).watchJob.startedAt;
  await post('/api/discovery/watch', { on: true, minutes: 40 });
  assert.equal((await get('/api/discovery/summary')).watchJob.startedAt, started, 'other minutes start no run');
  await post('/api/discovery/watch', { on: true, minutes: 30 });
  for (let i = 0; i < 100 && (await get('/api/discovery/summary')).watchJob.running; i++) await new Promise((r) => setTimeout(r, 25));
  assert.deepEqual(db.prepare("SELECT value FROM discover_settings WHERE key = 'watch'").get(), { value: JSON.stringify({ on: true, minutes: 30 }) });

  // what a restart does: the setting read back
  runner.setWatch(false);
  db.prepare("UPDATE discover_settings SET value = ? WHERE key = 'watch'").run(JSON.stringify({ on: true, minutes: 30 }));
  runner.resume();
  const resumed = (await get('/api/discovery/summary')).watch;
  assert.equal(resumed.on, true);
  assert.equal(resumed.minutes, 30);
  assert.ok(resumed.nextAt > Date.now(), 'it first runs a little later, not during startup');
  runner.setWatch(false);
  assert.equal((await post('/api/discovery/scan', { mode: 'watcher', watcher: 'nobody' })).status, 409);
});

test('settings, the cache and the Jobs page', async () => {
  assert.equal((await post('/api/discovery/settings', { threshold: 500 })).status, 400);
  assert.equal((await post('/api/discovery/settings', { threshold: 60 })).body.threshold, 60);
  await post('/api/discovery/settings', { threshold: 50 });
  assert.notEqual((await fetch(`${base}/api/discovery/cache/..%2f..%2fapp.db`)).status, 200);
  assert.equal((await fetch(`${base}/api/discovery/cache/nothing.jpg`)).status, 404);
  stub.posts = [aPost('high-vera', 'Vera High')];
  await runScan();
  const jobs = (await get('/api/jobs')).filter((j) => j.type === 'discover' && j.sourceId === 'hand');
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].status, 'done');
  assert.equal(jobs[0].link, '/discover');
  assert.equal((await get('/api/discovery/watcher/nobody')) && (await api('GET', '/api/discovery/watcher/nobody')).status, 404);
  assert.ok((await get('/api/discovery/watcher/stand-in-new')).total > 0);
});

test('the import carries the old results over once, nothing overwritten, paths and pool keys rewritten', async () => {
  const crypto = require('crypto');
  const from = path.join(dir, 'import');
  fs.mkdirSync(path.join(from, 'cache', 'fapello', 'Wren'), { recursive: true });
  fs.writeFileSync(path.join(from, 'cache', 'fapello', 'Wren', 'a.jpg'), stub.picture);
  const old = new Database(path.join(from, 'results.db'));
  old.exec(`
    CREATE TABLE posts (site TEXT, post_id TEXT, short_code TEXT, title TEXT, post_url TEXT, share_url TEXT, page_kind TEXT, performer_name TEXT, saved_link TEXT, image_url TEXT,
      image_path TEXT, image_paths TEXT, score REAL, kept INTEGER, skip_reason TEXT, model TEXT, info TEXT, posted_at TEXT, scanned_at TEXT);
    CREATE TABLE profiles (site TEXT, profile_id TEXT, name TEXT, url TEXT, image_url TEXT, image_path TEXT, image_paths TEXT, score REAL, kept INTEGER, model TEXT, judged_at TEXT, scrape TEXT, full INTEGER, data_at TEXT);
    CREATE TABLE watcher_checks (watcher TEXT, checked_at TEXT, found INTEGER, error TEXT);
    CREATE TABLE performer_links (a TEXT, b TEXT, kind TEXT, at TEXT);
    CREATE TABLE performer_decisions (member TEXT, decision TEXT, at TEXT);
    CREATE TABLE performer_status (member TEXT, status TEXT, at TEXT);
    CREATE TABLE backlog (site TEXT, cursor TEXT, pages INTEGER, updated_at TEXT);
    CREATE TABLE app_outbox (dedupe TEXT, kind TEXT, payload TEXT, created_at TEXT, sent_at TEXT, error TEXT, answer TEXT);
    CREATE TABLE uploads (id TEXT, name TEXT, kind TEXT, files TEXT, score REAL, model TEXT, created_at TEXT, scored_at TEXT, sent_at TEXT);
    CREATE TABLE pool_scores (signature TEXT, score REAL, images INTEGER, model TEXT, scored_at TEXT);
  `);
  const pic = (site, name) => `C:\\old\\cache\\${site}\\Wren\\${name}`;
  const mixed = 'F:/git/keep-scanner/cache/fapello/Wren/b.jpg';
  old.prepare('INSERT INTO posts (site, post_id, title, performer_name, image_path, image_paths, score, kept, scanned_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run('fapello', 'wren-1', 'Wren Old', 'Wren Old', pic('fapello', 'a.jpg'), JSON.stringify([pic('fapello', 'a.jpg'), mixed]), 77, 1, '2026-10-28T00:00:00Z');
  old.prepare('INSERT INTO pool_scores VALUES (?, 66, 2, ?, ?)').run(crypto.createHash('sha1').update([pic('fapello', 'a.jpg'), mixed].sort().join('\n')).digest('hex'), 'm', 'now');
  old.prepare("INSERT INTO performer_decisions VALUES ('post:fapello:wren-1', 'keep', 'now')").run();
  old.close();

  const dry = importResults(from, { dryRun: true });
  assert.equal(dry.posts, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM discover_posts WHERE post_id = 'wren-1'").get().n, 0, 'a dry run writes nothing');

  const first = importResults(from);
  assert.equal(first.posts, 1);
  assert.equal(first.decisions, 1);
  assert.equal(first.pictures, 1);
  assert.equal(importResults(from).posts, 0, 'run twice, nothing changes');
  const row = db.prepare("SELECT * FROM discover_posts WHERE post_id = 'wren-1'").get();
  assert.equal(row.image_path, 'fapello/Wren/a.jpg');
  assert.deepEqual(JSON.parse(row.image_paths), ['fapello/Wren/a.jpg', 'fapello/Wren/b.jpg']);
  assert.ok(fs.existsSync(path.join(CACHE, 'fapello', 'Wren', 'a.jpg')));
  await runScan();   // the page's results are rebuilt after a run
  assert.equal((await performerNamed('Wren Old')).best_score, 77);
});
