/**
 * Discover: the keep scanner in the app (frontend/src/pages/DiscoverPage.js, services/discover/).
 *
 * - GET  /api/discovery/summary          — totals, watchers, the runs and what judges
 * - GET  /api/discovery/performers       — ?view=&q=&sort=&new=&data=&pics=&hideHand=&kind=&offset=&limit=: Performers, Liked, Kept, Duplicates
 * - GET  /api/discovery/watcher/:id      — ?list=kept|notKept|skipped: one watcher's posts or profiles
 * - GET  /api/discovery/export/profile-data — ?only=liked|kept: the profiles' data, without scores
 * - GET  /api/discovery/cache/*          — a cached picture
 * - POST /api/discovery/scan             — { mode, watcher, maxPosts, maxProfiles, threshold, profileDetails }: start a run
 * - POST /api/discovery/pause            — stop the run started by hand
 * - POST /api/discovery/watch            — { on, minutes }: the timer
 * - POST /api/discovery/settings         — { threshold }
 * - POST /api/discovery/duplicates       — { action: combine|apart, a, b } or { action: keep|drop, members }
 * - POST /api/discovery/performer-status — { group, status: kept|deleted|checked|removed, superWrong }
 * - POST /api/discovery/add-performer    — { group }: an app performer with no files and her Leakhaven link
 * - POST /api/discovery/performers       — the contract in services/discover/verdicts.js
 * - /api/discovery/uploads...            — the Upload tab
 */
const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const db = require('../db');
const { WATCHERS } = require('../services/discover/watchers');
const { CACHE, abs, rel, cacheUrl } = require('../services/discover/paths');
const { profileDataExport } = require('../services/discover/results');
const { siteLink } = require('../services/discover/links');
const { loadLibrary } = require('../services/discover/library');
const { decide, sendQueued, uploadPayload } = require('../services/discover/events');
const { applyEvent } = require('../services/discover/verdicts');
const { MAX_UPLOAD_BYTES, PICTURE_TYPES, judge, moveFiles, newUploadId, uploadDir } = require('../services/discover/uploads');
const { currentResults: buildCurrent, threshold } = require('../services/discover/scan');
const runner = require('../services/discover/runner');
const store = require('../services/discover/store');

const router = express.Router();

// Rebuilt at most every few seconds: a scan writes while the page reads
let cache = { at: 0, results: null };
function currentResults() {
  if (!cache.results || Date.now() - cache.at > 5000) cache = { at: Date.now(), results: buildCurrent() };
  return cache.results;
}
const fresh = () => { cache.at = 0; };
runner.onChange(fresh);

/** The cached picture's URL on this server, or the site's own when it is not cached. */
function imageUrl(post) {
  if (post.image_path && fs.existsSync(abs(post.image_path))) return cacheUrl(post.image_path);
  return post.image_url;
}

/** The items whose names hold q (any case). */
function matching(list, q, names) {
  const needle = String(q || '').trim().toLowerCase();
  return needle ? list.filter((x) => names(x).some((n) => String(n || '').toLowerCase().includes(needle))) : list;
}

/** Sorted by score (high first, the default), newest first, or name. */
function sorted(list, sort, keys) {
  const key = keys[sort] || keys.score;
  const out = list.slice();
  if (sort === 'name') return out.sort((a, b) => String(key(a)).localeCompare(String(key(b))));
  if (sort === 'scoreAsc') return out.sort((a, b) => (keys.score(a) ?? 101) - (keys.score(b) ?? 101));
  return out.sort((a, b) => (sort === 'newest' ? String(key(b) || '').localeCompare(String(key(a) || '')) : (key(b) ?? -1) - (key(a) ?? -1)));
}

/** One page (?offset=&limit=, 60 by default) with the pictures as URLs on this server; members(x) for grouped items. */
function page(list, query, members = null) {
  const offset = Math.max(0, Number(query.offset) || 0);
  const limit = Math.min(200, Math.max(1, Number(query.limit) || 60));
  const items = list.slice(offset, offset + limit).map((item) => {
    const out = { ...item, image: imageUrl(item.members?.[0] || item) };
    // The links as the page opens them (Leakhaven: its search); the stored ones stay as they are
    for (const k of ['saved_link', 'url']) if (out[k]) out[k] = siteLink(out[k]);
    if (members) out.members = members(item).map((m) => ({ ...m, image: imageUrl(m) }));
    if (out.groups) out.groups = out.groups.map((g) => ({ ...g, image: imageUrl(g.members[0]), members: g.members.map((m) => ({ ...m, image: imageUrl(m) })) }));
    return out;
  });
  return { total: list.length, offset, items };
}

router.get('/summary', (req, res) => {
  const { run, totals, watchers } = currentResults();
  // Where a profiles watcher goes on from: the page of the list it got to
  const withPlace = watchers.map((w) => (w.kind === 'profiles' ? { ...w, resume_page: store.backlog(`${w.site}:profiles`).pages } : w));
  res.json({ run, totals, watchers: withPlace, threshold: threshold(), outbox: store.outboxCounts(), uploads: store.uploadCount(), ...runner.status() });
});

// Performers (everyone), Liked (something kept), Kept (decided) or Duplicates (to decide: pairs that may be one performer,
// liked performers below the line together), a page at a time
router.get('/performers', (req, res) => {
  const q = req.query;
  const results = currentResults();
  let list = q.view === 'liked' ? results.liked : q.view === 'duplicates' ? results.same : q.view === 'kept' ? results.keptList : results.performers;
  if (q.new === '1') list = list.filter((g) => !g.in_library);
  if (q.data === '1') list = list.filter((g) => g.data);
  // Only the performers with 3 or more pictures to look at (judged on several, or found more than once)
  if (q.pics === '1') list = list.filter((g) => (g.pictures ?? 0) >= 3);
  // Leave out the performers found only by the watchers that run by hand (Leakhaven models: every creator on the site); one
  // also found anywhere else (a post, another site, a combine) stays
  if (q.hideHand === '1') {
    const byHand = new Set(WATCHERS.filter((w) => w.watch === false).map((w) => `${w.name}:${w.kind}`));
    list = list.filter((g) => !g.sources?.length || !g.sources.every((s) => byHand.has(s)));
  }
  const kind = q.view === 'duplicates' && q.kind;
  if (kind === 'fallen' || kind === 'pair') list = list.filter((d) => d.kind === kind);
  list = sorted(matching(list, q.q, (g) => [...g.names, ...(g.data?.aliases || [])]), q.sort, { score: (g) => g.best_score, newest: (g) => g.last_seen, name: (g) => g.names[0] });
  // Duplicates: the liked performers below the line together first, before they simply stay liked; by score, the biggest fall
  // (best picture against all together) first
  if (q.view === 'duplicates') {
    const fallen = list.filter((d) => d.kind === 'fallen');
    if ((q.sort || 'score') === 'score') fallen.sort((a, b) => (b.groups[0].best_score - b.groups[0].pool_score) - (a.groups[0].best_score - a.groups[0].pool_score));
    list = [...fallen, ...list.filter((d) => d.kind !== 'fallen')];
  }
  res.json(page(list, q, (g) => g.members));
});

// One watcher's kept, not kept or skipped posts (or profiles), a page at a time
router.get('/watcher/:id', (req, res) => {
  const watcher = WATCHERS.find((w) => w.id === req.params.id);
  if (!watcher) return res.status(404).json({ error: 'no such watcher' });
  const results = currentResults();
  let lists;
  if (watcher.kind === 'profiles') {
    // A profile not judged (yet): saved by a watch scan for a kept post, or its picture failed
    const mine = results.profiles.filter((p) => p.site === watcher.name);
    lists = { kept: mine.filter((p) => p.score != null && p.kept), notKept: mine.filter((p) => p.score != null && !p.kept), skipped: mine.filter((p) => p.score == null) };
  } else {
    lists = Object.fromEntries(['kept', 'notKept', 'skipped'].map((k) => [k, results[k].filter((p) => p.site === watcher.name)]));
  }
  const which = ['kept', 'notKept', 'skipped'].includes(req.query.list) ? req.query.list : 'kept';
  const list = sorted(matching(lists[which], req.query.q, (p) => [p.name, p.title, p.performer_name, ...(p.scrape?.aliases || [])]), req.query.sort,
    { score: (p) => p.score, newest: (p) => p.posted_at || p.judged_at || p.scanned_at, name: (p) => p.name || p.title });
  res.json({ watcher: results.watchers.find((w) => w.id === watcher.id), counts: { kept: lists.kept.length, notKept: lists.notKept.length, skipped: lists.skipped.length }, ...page(list, req.query) });
});

// The profiles' data for the profile page, without scores or keep labels. ?only=liked: the profiles of the liked performers
// (a kept profile, or the creator of a kept post); ?only=kept: the kept profiles.
router.get('/export/profile-data', (req, res) => {
  const profiles = store.allProfiles();
  const which = req.query.only;
  const only = which === 'liked' ? currentResults().liked.flatMap((g) => g.members.filter((m) => m.type === 'profile').map((m) => m.id))
    : which === 'kept' ? profiles.filter((p) => p.kept).map((p) => p.profile_id) : null;
  res.set('Content-Disposition', `attachment; filename="leakhaven-profiles-${only ? `${which}-` : ''}${new Date().toISOString().slice(0, 10)}.json"`);
  res.json(profileDataExport(profiles, only));
});

router.get(/^\/cache\/(.+)$/, (req, res) => {
  const file = path.resolve(CACHE, req.params[0]);
  if (path.relative(CACHE, file).startsWith('..')) return res.status(403).json({ error: 'outside the cache' });
  if (!fs.existsSync(file)) return res.status(404).end();
  res.set('Cache-Control', 'max-age=3600').sendFile(file);
});

router.post('/scan', (req, res) => {
  const body = req.body || {};
  const mode = ['rescore', 'backlog', 'profiles', 'watcher', 'pools'].includes(body.mode) ? body.mode : 'scan';
  const options = {
    watcher: body.watcher, maxPosts: Number(body.maxPosts) || undefined, maxProfiles: Number(body.maxProfiles) || undefined, profileDetails: ['kept', 'all'].includes(body.profileDetails) ? body.profileDetails : undefined,
    threshold: body.threshold != null && body.threshold !== '' ? Number(body.threshold) : undefined,
  };
  if (runner.startScan(mode, options)) return res.status(202).json(runner.status());
  res.status(409).json({ error: 'a scan is already running', ...runner.status() });
});

router.post('/pause', (req, res) => {
  if (!runner.pause()) return res.status(409).json({ error: 'nothing to pause', ...runner.status() });
  res.json(runner.status());
});

router.post('/watch', (req, res) => {
  runner.setWatch(req.body?.on, req.body?.minutes);
  res.json(runner.status());
});

router.post('/settings', (req, res) => {
  const t = Number(req.body?.threshold);
  if ('threshold' in (req.body || {})) {
    if (!Number.isFinite(t) || t < 0 || t > 100) return res.status(400).json({ error: 'threshold: 0 to 100' });
    store.setSetting('threshold', t);
    fresh();
  }
  res.json({ threshold: threshold() });
});

// Duplicates: combine two performers or keep them apart (a and b: a member key of each), keep or drop a liked performer whose
// pictures together fell below the line (members: her member keys). A combine is a new pool of pictures: a pools run scores it
// now (when a run is going, that run does it at its end).
router.post('/duplicates', (req, res) => {
  const { action, a, b, members } = req.body || {};
  if (action === 'combine' || action === 'apart') {
    if (!a || !b || a === b) return res.status(400).json({ error: 'a and b: a member of each performer' });
    store.setLink(a, b, action === 'combine' ? 'same' : 'apart');
  } else if (action === 'keep' || action === 'drop') {
    if (!Array.isArray(members) || !members.length) return res.status(400).json({ error: 'members: the performer\'s member keys' });
    store.decide(members, action);
  } else return res.status(400).json({ error: 'action: combine, apart, keep or drop' });
  fresh();
  if (action === 'combine') runner.startScan('pools');
  res.json(runner.status());
});

const findGroup = (group) => currentResults().everyone.find((x) => x.id === group || x.members.some((m) => m.key === group));

// Keep / Delete on a performer (Performers, Liked), Checked on a kept one (Kept), Remove on any: Keep and Delete reach the
// profile page and P's training; Remove only takes her off this page
router.post('/performer-status', async (req, res) => {
  const { group, status, superWrong } = req.body || {};
  if (!['kept', 'deleted', 'checked', 'removed'].includes(status)) return res.status(400).json({ error: 'status: kept, deleted, checked or removed' });
  const g = findGroup(group);
  if (!g) return res.status(404).json({ error: 'no such performer' });
  decide(g, status, { superWrong: status === 'deleted' && !!superWrong });   // Super wrong: a Delete P got badly wrong
  fresh();
  const { failed } = await sendQueued();
  res.json({ ok: true, group: g.id, status, failed });
});

// Add performer: an app performer with no files yet, in the first media folder, and her Leakhaven link, so the Leakhaven
// update checks follow her. Her folder is made, or the library's scan would call her an orphan.
router.post('/add-performer', (req, res) => {
  const g = findGroup(req.body?.group);
  if (!g) return res.status(404).json({ error: 'no such performer' });
  const name = g.names[0];
  const had = loadLibrary().performer(...g.names, ...(g.data?.aliases || []));
  if (had) return res.status(409).json({ error: `${had.name} is in the library already`, performer_id: had.id });
  const folder = db.prepare('SELECT id, path FROM folders ORDER BY id LIMIT 1').get();
  if (!folder) return res.status(409).json({ error: 'the library has no media folder yet' });
  const profile = g.members.find((m) => m.type === 'profile' && /leakshaven\.com/.test(m.link || ''));
  const model = /[?&]q=([^&#]+)|\/model\/([^/?#]+)/.exec(profile?.link || g.links.find((l) => /leakshaven\.com/.test(l)) || '');
  const link = model ? `https://leakshaven.com/model/${model[1] || model[2]}` : null;
  fs.ensureDirSync(path.join(folder.path, 'before filter performer', name));
  const r = db.prepare('INSERT INTO performers (name, folder_id, aliases, leakshaven_url, scraped_source) VALUES (?, ?, ?, ?, ?)')
    .run(name, folder.id, JSON.stringify(g.data?.aliases || []), link, link ? 'leakhaven' : null);
  fresh();
  res.json({ ok: true, performer_id: Number(r.lastInsertRowid), name, leakshaven_url: link });
});

// The contract of services/discover/verdicts.js. "files" is for this server's own events: a caller can't name a file here.
router.post('/performers', async (req, res) => {
  const { files, ...payload } = req.body || {};
  try {
    res.json(await applyEvent(payload));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ── Uploads ──
const uploadView = (u) => ({ ...u, files: u.files.map((f) => ({ ...f, image: cacheUrl(f.file) })), image: u.files[0] ? cacheUrl(u.files[0].file) : null });

router.get('/uploads', (req, res) => {
  const list = matching(store.allUploads(), req.query.q, (u) => [u.name, ...u.files.map((f) => f.name)]);
  const items = sorted(list, req.query.sort || 'score', { score: (u) => u.score, newest: (u) => u.created_at, name: (u) => u.name || '' }).map(uploadView);
  res.json({ total: items.length, items });
});

router.post('/uploads', (req, res) => {
  const { name, kind } = req.body || {};
  if (!['performer', 'picture'].includes(kind)) return res.status(400).json({ error: 'kind: performer or picture' });
  const u = { id: newUploadId(), name: String(name || '').trim().slice(0, 200) || null, kind, files: [] };
  store.saveUpload(u);
  res.json(uploadView(store.upload(u.id)));
});

// Merge: the chosen entries become one performer (her name: the one given, or the first entry's), to be judged again
router.post('/uploads/merge', (req, res) => {
  const { ids, name } = req.body || {};
  const chosen = (Array.isArray(ids) ? ids : []).map((id) => store.upload(String(id))).filter(Boolean);
  if (chosen.length < 2) return res.status(400).json({ error: 'choose two or more' });
  const u = { id: newUploadId(), name: String(name || '').trim() || chosen.find((e) => e.name)?.name || null, kind: 'performer', files: [] };
  for (const e of chosen) {
    u.files.push(...moveFiles(e.files, u.id));
    fs.removeSync(uploadDir(e.id));
    store.deleteUpload(e.id);
  }
  store.saveUpload(u);
  res.json(uploadView(store.upload(u.id)));
});

router.param('uploadId', (req, res, next, id) => {
  req.upload = /^u[a-z0-9]+$/.test(id) ? store.upload(id) : null;
  if (!req.upload) return res.status(404).json({ error: 'no such upload' });
  next();
});

// One picture per request, its bytes as the body, its file name in ?name=
router.post('/uploads/:uploadId/files', express.raw({ type: () => true, limit: MAX_UPLOAD_BYTES }), (req, res) => {
  const u = req.upload;
  const ext = PICTURE_TYPES[String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase()];
  if (!ext) return res.status(415).json({ error: 'pictures only: JPEG, PNG, WebP, GIF or AVIF' });
  if (u.kind === 'picture' && u.files.length) return res.status(409).json({ error: 'a picture entry holds one picture' });
  if (!req.body?.length) return res.status(400).json({ error: 'empty picture' });
  const dir = uploadDir(u.id);
  fs.ensureDirSync(dir);
  const file = path.join(dir, `${u.files.length + 1}-${Date.now().toString(36)}.${ext}`);
  fs.writeFileSync(file, req.body);
  const original = String(req.query.name || path.basename(file)).slice(0, 300);
  u.files.push({ file: rel(file), name: original, score: null });
  if (u.kind === 'picture' && !u.name) u.name = original.replace(/\.[^.]+$/, '');
  store.saveUpload({ ...u, score: null, scored_at: null });
  res.json(uploadView(store.upload(u.id)));
});

router.post('/uploads/:uploadId/score', async (req, res) => {
  const u = req.upload;
  if (!u.files.length) return res.status(400).json({ error: 'no pictures yet' });
  try {
    store.saveUpload(await judge(u));
  } catch (err) {
    return res.status(err.waiting ? 503 : 502).json({ error: `P model: ${err.message}` });
  }
  res.json(uploadView(store.upload(u.id)));
});

// Split: every picture becomes an entry of its own, with the score it already has alone
router.post('/uploads/:uploadId/split', (req, res) => {
  const u = req.upload;
  if (u.files.length < 2) return res.status(400).json({ error: 'one picture: nothing to split' });
  const made = u.files.map((f) => {
    const one = { id: newUploadId(), name: f.name.replace(/\.[^.]+$/, ''), kind: 'picture', model: u.model };
    one.files = moveFiles([f], one.id);
    one.score = f.score ?? null;
    one.scored_at = f.score != null ? u.scored_at : null;
    store.saveUpload(one);
    return one.id;
  });
  fs.removeSync(uploadDir(u.id));
  store.deleteUpload(u.id);
  res.json({ ids: made });
});

// Send to the profile page as undecided (the "upload" event)
router.post('/uploads/:uploadId/send', async (req, res) => {
  const u = req.upload;
  if (!u.files.length) return res.status(400).json({ error: 'no pictures yet' });
  store.enqueue('upload', `upload:${u.id}:${Date.now()}`, uploadPayload(u));
  store.saveUpload({ ...u, sent_at: new Date().toISOString() });
  const { failed } = await sendQueued();
  res.json({ ...uploadView(store.upload(u.id)), failed });
});

router.patch('/uploads/:uploadId', (req, res) => {
  store.saveUpload({ ...req.upload, name: String(req.body?.name || '').trim().slice(0, 200) || null });
  res.json(uploadView(store.upload(req.upload.id)));
});

// Remove: the entry and its files, nothing sent anywhere
router.delete('/uploads/:uploadId', (req, res) => {
  fs.removeSync(uploadDir(req.upload.id));
  store.deleteUpload(req.upload.id);
  res.json({ ok: true });
});

// A body refused before a route saw it: an upload over the limit answers as one, not as a server error
router.use((err, req, res, next) => {
  if (!err.status) return next(err);
  res.status(err.status).json({ error: err.status === 413 ? `over ${MAX_UPLOAD_BYTES / 1024 / 1024} MB` : err.message });
});

module.exports = router;
