/**
 * Discover: the keep scanner in the app (frontend/src/pages/DiscoverPage.js, services/discover/).
 *
 * - GET  /api/discovery/summary          — totals, watchers, the runs, what judges and what Older posts reads next
 * - GET  /api/discovery/performers       — ?view=all|liked|kept|decided|everyone|duplicates &q &sort &new &data &pics &hideHand &kind
 *                                          &watcher &offset &limit: Performers, Liked, Kept, Decided, Duplicates, one watcher's
 * - GET  /api/discovery/performer        — ?key=<member key or performer id>: one performer
 * - GET  /api/discovery/watcher/:id      — ?list=all|above|below|skipped|waiting &q &sort &offset &limit: what a watcher read
 * - GET  /api/discovery/export/profile-data — ?only=liked|kept: the profiles' data, without scores
 * - GET  /api/discovery/cache/*          — a cached picture
 * - POST /api/discovery/scan             — { mode, watcher }: start a run
 * - POST /api/discovery/pause            — { slot: hand|timer } (hand when left out): stop a run between two posts
 * - POST /api/discovery/watch            — { on, minutes }: the timer
 * - POST /api/discovery/settings         — { threshold }
 * - POST /api/discovery/duplicates       — { action: combine|apart, a, b } | { action: keep|drop, members } and their Undo:
 *                                          { action: unlink, a, b, previous } | { action: unlink, member } (Take apart) |
 *                                          { action: relink, links } | { action: restore, rows }
 * - POST /api/discovery/performer-status — { group, status: kept|deleted|checked|removed|undecided, superWrong }
 * - POST /api/discovery/performer-status/undo — { group, rows, event }: the undo the decision answered with
 * - GET  /api/discovery/add-performer/preview — ?group=: her name and folder as Add performer would make them
 * - POST /api/discovery/add-performer    — { group, name }: an app performer with no files and her Leakhaven link
 * - POST /api/discovery/performers       — the contract in services/discover/verdicts.js (pictures as bytes only)
 * - /api/discovery/uploads...            — the Upload tab; POST /uploads/:id/send { name, verdict: keep|delete|auto },
 *                                          POST /uploads/bulk { ids, action: delete|send|send-verdict }
 */
const express = require('express');
const crypto = require('crypto');
const fs = require('fs-extra');
const path = require('path');
const db = require('../db');
const { WATCHERS } = require('../services/discover/watchers');
const { CACHE, abs, rel, cacheUrl } = require('../services/discover/paths');
const { profileDataExport } = require('../services/discover/results');
const { siteLink } = require('../services/discover/links');
const { loadLibrary, rememberLibraryNames } = require('../services/discover/library');
const { decide, isApplying, performerPayload, queueUndecide, sendQueued } = require('../services/discover/events');
const { applyEvent } = require('../services/discover/verdicts');
const { currentModel } = require('../services/discover/judge');
const { MAX_UPLOAD_BYTES, PICTURE_TYPES, judge, moveFiles, newUploadId, uploadDir, send: sendUpload, remove: removeUpload, notSending } = require('../services/discover/uploads');
const { currentResults: buildCurrent, threshold, backlogSites } = require('../services/discover/scan');
const runner = require('../services/discover/runner');
const store = require('../services/discover/store');

const router = express.Router();

/** An async handler whose failure answers as JSON (its status, or 500), not as an unhandled rejection */
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch((err) => res.status(err.status || 500).json({ error: err.message }));

// The results, built once and kept until something changes them (a run's end, a decision, the line, Duplicates, the library's
// performers: who is "in the library"). While a run goes it writes all the time: they are built again at most every 20 s then.
const REBUILD_MS = 20000;
let cache = { results: null, at: 0, library: null };
const running = () => runner.slots.job.running || runner.slots.watchJob.running;
const librarySignature = () => {
  const r = db.prepare(`SELECT COUNT(*) AS n, MAX(id) AS m, SUM(LENGTH(COALESCE(name, '')) + LENGTH(COALESCE(aliases, '')) + LENGTH(COALESCE(leakshaven_url, ''))
    + LENGTH(COALESCE(leakshaven_search_name, '')) + LENGTH(COALESCE(leakshaven_alias, ''))) AS l FROM performers`).get();
  return `${r.n}:${r.m}:${r.l}`;
};
function currentResults() {
  const library = librarySignature();
  if (!cache.results || cache.library !== library || (running() && Date.now() - cache.at > REBUILD_MS)) cache = { results: buildCurrent(), at: Date.now(), library };
  return cache.results;
}
const fresh = () => { cache.results = null; };
runner.onChange(fresh);

// The profile page is told in the background: a click does not wait for it (what is not sent shows in the outbox counts)
const sendLater = () => { sendQueued().catch(() => {}); };

/** The cached picture's URL on this server, or null: the page never loads a picture from the site itself */
function imageUrl(post) {
  return post?.image_path && fs.existsSync(abs(post.image_path)) ? cacheUrl(post.image_path) : null;
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

/** A member as the page shows it: its picture on this server, its links as the page opens them */
const memberView = (m) => ({ ...m, image: imageUrl(m), link: siteLink(m.link), saved_link: siteLink(m.saved_link ?? null) });

/** A performer (or a Duplicates item) as the page shows it; the stored links stay as they are */
function groupView(item) {
  const out = { ...item, image: imageUrl(item.members?.[0] || item) };
  for (const k of ['saved_link', 'url']) if (out[k]) out[k] = siteLink(out[k]);
  if (item.members) out.members = item.members.map(memberView);
  if (item.groups) out.groups = item.groups.map((g) => ({ ...g, image: imageUrl(g.members[0]), members: g.members.map(memberView) }));
  return out;
}

/** One page (?offset=&limit=, 60 by default, 200 at most), each item as view(item) makes it */
function page(list, query, view = groupView) {
  const offset = Math.max(0, Math.floor(Number(query.offset)) || 0);
  const limit = Math.min(200, Math.max(1, Math.floor(Number(query.limit)) || 60));
  return { total: list.length, offset, items: list.slice(offset, offset + limit).map(view) };
}

const pct = (part, whole) => (whole ? Math.min(100, Math.round((part / whole) * 100)) : 0);

/** A watcher as the page shows it: its stats, how many of its performers are to decide, and where it goes on from */
function watcherView(w, toDecide) {
  const out = { ...w, to_decide: toDecide.get(w.source) || 0 };
  // Where a profiles watcher goes on from: the page of the list it got to
  if (w.kind === 'profiles') out.resume_page = store.backlog(`${w.site}:profiles`).pages;
  // When Older posts read a posts watcher's site to the end
  else out.backlog_done = store.setting(`backlogDone:${w.site}`, null);
  return out;
}

/** How many performers to decide each source has (a performer found by two watchers counts for both) */
function toDecideBySource(results) {
  const counts = new Map();
  for (const g of results.performers) for (const s of g.sources || []) counts.set(s, (counts.get(s) || 0) + 1);
  return counts;
}

router.get('/summary', (req, res) => {
  const results = currentResults();
  const { run, totals } = results;
  const model = currentModel();
  // Re-judge: what was last judged by another model than the current one
  const other = (x) => x.score != null && x.model !== model;
  const rejudge = { posts: [...results.kept, ...results.notKept].filter(other).length, profiles: results.profiles.filter(other).length, model };
  const toDecide = toDecideBySource(results);
  res.json({
    run: { ...run, current_model: model },
    totals: { ...totals, rejudge },
    watchers: results.watchers.map((w) => watcherView(w, toDecide)),
    threshold: threshold(),
    outbox: store.outboxCounts(),
    uploads: store.uploadCount(),
    // The site an Older posts run starts with; null when every site was read to the end
    backlog: { next: backlogSites()[0]?.label ?? null },
    ...runner.status(),
  });
});

const findGroup = (key) => (key ? currentResults().everyone.find((x) => x.id === key || x.members.some((m) => m.key === key)) : null);
/** As findGroup, for a change: while a run goes the cached results can miss her newest finds, so they are built again first */
const findGroupNow = (key) => { if (running()) fresh(); return findGroup(key); };
const findWatcher = (id) => WATCHERS.find((w) => w.id === id) || null;

/** The performers of a view: all (Performers, to decide), liked, kept, decided, everyone, duplicates */
function viewList(results, view) {
  if (view === 'liked') return results.liked;
  if (view === 'kept') return results.keptList;
  if (view === 'decided') return results.decided;
  if (view === 'everyone') return results.everyone;
  if (view === 'duplicates') return results.same;
  return results.performers;
}

/** The filters of ?new, ?data, ?pics, ?hideHand, ?kind and the search */
function filtered(list, q) {
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
  return matching(list, q.q, (g) => [...g.names, ...(g.data?.aliases || [])]);
}

// Performers (to decide), Liked (something above the line), Kept (decided Keep), Decided (deleted, removed, checked with
// nothing new), everyone, or Duplicates (to decide: pairs that may be one performer, liked performers below the line
// together), a page at a time. ?watcher=: only the performers that watcher found, with the count of each of its views.
router.get('/performers', (req, res) => {
  const q = req.query;
  const results = currentResults();
  let list = viewList(results, q.view);
  let counts;
  if (q.watcher) {
    const w = findWatcher(q.watcher);
    if (!w) return res.status(404).json({ error: 'no such watcher' });
    const source = `${w.name}:${w.kind}`;
    const mine = (g) => !!g.sources?.includes(source);
    list = q.view === 'duplicates' ? list.filter((d) => d.groups.some(mine)) : list.filter(mine);
    // The counts after the search and filters, before the view: what each of the watcher's views would show
    const base = filtered(results.everyone.filter(mine), { ...q, view: 'everyone' });
    const inside = (xs) => { const set = new Set(xs); return base.filter((g) => set.has(g)).length; };
    counts = { decide: inside(results.performers), kept: inside(results.keptList), decided: inside(results.decided), all: base.length };
  }
  list = sorted(filtered(list, q), q.sort, { score: (g) => g.best_score, newest: (g) => g.last_seen, name: (g) => g.names[0] });
  // Duplicates: the liked performers below the line together first, before they simply stay liked; by score, the biggest fall
  // (best picture against all together) first
  if (q.view === 'duplicates') {
    const fallen = list.filter((d) => d.kind === 'fallen');
    if ((q.sort || 'score') === 'score') fallen.sort((a, b) => (b.groups[0].best_score - b.groups[0].pool_score) - (a.groups[0].best_score - a.groups[0].pool_score));
    list = [...fallen, ...list.filter((d) => d.kind !== 'fallen')];
  }
  res.json({ ...page(list, q), ...(counts ? { counts } : {}) });
});

// One performer, by a member key or her id: the drawer opened from a link, a reload, or a row of what a watcher read
router.get('/performer', (req, res) => {
  const g = findGroup(String(req.query.key || ''));
  if (!g) return res.status(404).json({ error: 'no such performer' });
  res.json({ item: page([g], { limit: 1 }).items[0] });
});

/** A post or profile of a watcher, as a row of "What it read" */
function readRow(x) {
  const profile = x.profile_id != null;
  return {
    kind: profile ? 'profile' : 'post',
    // the row's own id, never empty: the page tells its rows apart by it (a skipped or waiting post has no member key)
    id: profile ? `profile:${x.site}:${x.profile_id}` : `post:${x.site}:${x.post_id}`,
    // her member key: a judged post or any profile is a performer's find; a skipped or waiting post is nobody's yet
    key: profile ? `profile:${x.site}:${x.profile_id}` : x.score != null ? `post:${x.site}:${x.post_id}` : null,
    name: profile ? x.name : x.performer_name || x.title,
    title: x.title ?? null,
    performer_name: x.performer_name ?? null,
    score: x.score,
    above: !!x.kept,
    skip_reason: x.skip_reason ?? null,
    waiting: !!x.waiting,
    posted_at: x.posted_at ?? null,
    found_at: x.scanned_at || x.judged_at || x.data_at || null,
    link: siteLink(x.saved_link || x.url || x.share_url || x.post_url || null),
    share_url: x.share_url ?? null,
    image: imageUrl(x),
  };
}

const READ_LISTS = ['all', 'above', 'below', 'skipped', 'waiting'];

// What a watcher read: its posts (or profiles) above and below the line, skipped and waiting, a page at a time
router.get('/watcher/:id', (req, res) => {
  const watcher = findWatcher(req.params.id);
  if (!watcher) return res.status(404).json({ error: 'no such watcher' });
  const results = currentResults();
  let lists;
  if (watcher.kind === 'profiles') {
    // A profile not judged (yet): its picture failed, or saved for its data only; waiting: nobody could judge it
    const mine = results.profiles.filter((p) => p.site === watcher.name);
    lists = {
      above: mine.filter((p) => p.score != null && p.kept), below: mine.filter((p) => p.score != null && !p.kept),
      skipped: mine.filter((p) => p.score == null && !p.waiting), waiting: mine.filter((p) => p.waiting),
    };
  } else {
    const bySite = (k) => results[k].filter((p) => p.site === watcher.name);
    lists = { above: bySite('kept'), below: bySite('notKept'), skipped: bySite('skipped'), waiting: bySite('waiting') };
  }
  lists.all = [...lists.above, ...lists.below, ...lists.skipped, ...lists.waiting];
  const asked = { kept: 'above', notKept: 'below' }[req.query.list] || req.query.list;   // the old names still work
  const which = READ_LISTS.includes(asked) ? asked : 'all';
  const list = sorted(matching(lists[which], req.query.q, (p) => [p.name, p.title, p.performer_name, ...(p.scrape?.aliases || [])]), req.query.sort || 'newest',
    { score: (p) => p.score, newest: (p) => p.scanned_at || p.judged_at || p.data_at || p.posted_at, name: (p) => p.name || p.performer_name || p.title });
  const stats = results.watchers.find((w) => w.id === watcher.id);
  res.json({
    watcher: stats ? watcherView(stats, toDecideBySource(results)) : null,
    counts: Object.fromEntries(READ_LISTS.map((k) => [k, lists[k].length])),
    ...page(list, req.query, readRow),
  });
});

// The profiles' data for the profile page, without scores or keep labels. ?only=liked: the profiles of the liked performers
// (something above the line); ?only=kept: the profiles of the Kept tab's performers.
router.get('/export/profile-data', (req, res) => {
  const which = ['liked', 'kept'].includes(req.query.only) ? req.query.only : null;
  const results = which ? currentResults() : null;
  const groups = which === 'liked' ? results.liked : which === 'kept' ? results.keptList : null;
  // by site and id: two sites can use the same id
  const only = groups && groups.flatMap((g) => g.members.filter((m) => m.type === 'profile').map((m) => `${m.site}:${m.id}`));
  res.set('Content-Disposition', `attachment; filename="discover-profiles-${which || 'all'}-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json(profileDataExport(store.allProfiles(), only));
});

router.get(/^\/cache\/(.+)$/, (req, res) => {
  const file = path.resolve(CACHE, req.params[0]);
  if (file !== CACHE && !file.startsWith(CACHE + path.sep)) return res.status(403).json({ error: 'outside the cache' });
  if (!fs.existsSync(file)) return res.status(404).end();
  res.set('Cache-Control', 'max-age=3600').sendFile(file);
});

// A run by hand: the watchers on watch (scan), one watcher, the profiles watchers, older posts, Re-judge, or the pictures
// together. Only the watcher is taken from the page: limits and the line are the server's own.
router.post('/scan', (req, res) => {
  const body = req.body || {};
  const mode = ['rescore', 'backlog', 'profiles', 'watcher', 'pools'].includes(body.mode) ? body.mode : 'scan';
  if (mode === 'watcher' && !findWatcher(body.watcher)) return res.status(404).json({ error: 'no such watcher' });
  const options = mode === 'watcher' ? { watcher: body.watcher } : {};
  if (runner.startScan(mode, options)) return res.status(202).json(runner.status());
  res.status(409).json({ error: 'a scan is already running', ...runner.status() });
});

// Pause: the run started by hand (also with no body: the Jobs page), or { slot: 'timer' } the timer's
router.post('/pause', (req, res) => {
  const slot = req.body?.slot === 'timer' ? 'timer' : 'hand';
  if (!runner.pause(slot)) return res.status(409).json({ error: 'nothing to pause', ...runner.status() });
  res.json(runner.status());
});

router.post('/watch', (req, res) => {
  const { on } = req.body || {};
  const minutes = req.body?.minutes == null ? null : Number(req.body.minutes);
  const badMinutes = minutes != null && !(Number.isInteger(minutes) && minutes >= 5 && minutes <= 1440);
  if (typeof on !== 'boolean' || badMinutes) return res.status(400).json({ error: 'on: true or false; minutes: 5 to 1440' });
  runner.setWatch(on, minutes);
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

const isKey = (k) => typeof k === 'string' && k.length > 0 && k.length <= 500;

// Duplicates: combine two performers or keep them apart (a and b: a member key of each), keep or drop a liked performer whose
// pictures together fell below the line (members: her member keys). Each answers with its undo: unlink (a combine or apart
// as it was before), restore (the keep / drop rows as they were). Take apart (unlink with member) takes every combine of one
// member away; relink puts them back. A combine is a new pool of pictures: a pools run scores it now (when a run is going,
// that run does it at its end).
router.post('/duplicates', (req, res) => {
  const { action, a, b, members, member, previous, links, rows } = req.body || {};
  const extra = {};
  if (action === 'combine' || action === 'apart') {
    if (!isKey(a) || !isKey(b) || a === b) return res.status(400).json({ error: 'a and b: a member of each performer' });
    extra.undo = { action: 'unlink', a, b, previous: store.link(a, b)?.kind ?? null };
    store.setLink(a, b, action === 'combine' ? 'same' : 'apart');
  } else if (action === 'keep' || action === 'drop') {
    if (!Array.isArray(members) || !members.length || !members.every(isKey)) return res.status(400).json({ error: 'members: the performer\'s member keys' });
    const decisions = store.decisions();
    extra.undo = { action: 'restore', rows: members.map((m) => ({ member: m, decision: decisions[m]?.decision ?? null, at: decisions[m]?.at ?? null })) };
    store.decide(members, action);
  } else if (action === 'unlink' && member != null) {
    if (!isKey(member)) return res.status(400).json({ error: 'member: a member key' });
    const taken = store.links().filter((l) => l.kind === 'same' && (l.a === member || l.b === member));
    for (const l of taken) store.deleteLink(l.a, l.b);
    extra.removed = taken.length;
    extra.undo = { action: 'relink', links: taken };
  } else if (action === 'unlink') {
    if (!isKey(a) || !isKey(b) || a === b) return res.status(400).json({ error: 'a and b: a member of each performer' });
    if (previous == null) store.deleteLink(a, b);
    else if (previous === 'same' || previous === 'apart') store.setLink(a, b, previous);
    else return res.status(400).json({ error: 'previous: same, apart or null' });
  } else if (action === 'relink') {
    if (!Array.isArray(links)) return res.status(400).json({ error: 'links: the links Take apart answered with' });
    for (const l of links) if (l && isKey(l.a) && isKey(l.b) && l.a !== l.b && ['same', 'apart'].includes(l.kind)) store.putLink(l.a, l.b, l.kind, typeof l.at === 'string' ? l.at : null);
  } else if (action === 'restore') {
    if (!Array.isArray(rows)) return res.status(400).json({ error: 'rows: the rows Keep or Drop answered with' });
    store.restoreDecisions(rows.filter((r) => r && isKey(r.member) && (r.decision == null || ['keep', 'drop'].includes(r.decision)))
      .map((r) => ({ member: r.member, decision: r.decision ?? null, at: typeof r.at === 'string' ? r.at : null })));
  } else return res.status(400).json({ error: 'action: combine, apart, keep, drop, unlink, relink or restore' });
  fresh();
  if (action === 'combine' || action === 'relink') runner.startScan('pools');
  res.json({ ...runner.status(), ...extra });
});

const STATUSES = ['kept', 'deleted', 'checked', 'removed'];

// Keep / Delete on a performer (Performers, Liked), Checked on a kept one (Kept), Remove on any, undecided (Put back): Keep
// and Delete reach the profile page and P's training; Remove only takes her off this page. Answers with the undo: her rows
// as they were before, and the event this queued for the profile page.
router.post('/performer-status', (req, res) => {
  const { group, status, superWrong } = req.body || {};
  if (![...STATUSES, 'undecided'].includes(status)) return res.status(400).json({ error: 'status: kept, deleted, checked, removed or undecided' });
  const g = findGroupNow(group);
  if (!g) return res.status(404).json({ error: 'no such performer' });
  const statuses = store.statuses();
  const rows = g.members.map((m) => ({ member: m.key, status: statuses[m.key]?.status ?? null, at: statuses[m.key]?.at ?? null }));
  const { event } = decide(g, status, { superWrong: status === 'deleted' && !!superWrong });   // Super wrong: a Delete P got badly wrong
  fresh();
  sendLater();
  res.json({ ok: true, group: g.id, status, undo: { group: g.id, rows, event } });
});

// Undo of a decision: her rows exactly as they were. The event the click queued is taken back when it was not sent yet;
// once sent, the profile page is told what she is again (keep, delete, or undecided).
router.post('/performer-status/undo', (req, res) => {
  const { group, rows, event } = req.body || {};
  if (!Array.isArray(rows)) return res.status(400).json({ error: 'rows: the undo the decision answered with' });
  const g = findGroupNow(group);
  if (!g) return res.status(404).json({ error: 'no such performer' });
  const keys = new Set(g.members.map((m) => m.key));
  const back = rows.filter((r) => r && keys.has(r.member) && (r.status == null || STATUSES.includes(r.status)))
    .map((r) => ({ member: r.member, status: r.status ?? null, at: r.status != null && typeof r.at === 'string' ? r.at : null }));
  store.restoreStatus(back);
  const previous = back.filter((r) => r.status).sort((x, y) => String(y.at).localeCompare(String(x.at)))[0]?.status ?? null;
  const ev = Number.isInteger(event) ? store.eventById(event) : null;
  if (ev) {
    const takenBack = !ev.sent_at && !isApplying(ev.id) && store.deleteEvent(ev.id);
    if (!takenBack) {
      // what she was before the click: the verdict of the keep / delete before it (Super wrong stays Super wrong) and her
      // update mark (found again), which the click's event cleared on the profile page
      fresh();
      const back = findGroup(g.id) || findGroup(group) || g;
      const now = { ...back, update: null, new_finds: [] };
      const before = store.lastVerdict(g.id, ev.id);
      if (previous === 'kept' || previous === 'checked') store.enqueue('keep', `keep:${g.id}:${Date.now()}`, performerPayload(now, 'keep', { verdict: 'keep' }));
      else if (previous === 'deleted') store.enqueue('delete', `delete:${g.id}:${Date.now()}`, performerPayload(now, 'delete', { verdict: before === 'superwrong' ? 'superwrong' : 'delete' }));
      else queueUndecide(g);
      if ((previous === 'kept' || previous === 'checked' || previous === 'deleted') && (back.update === 'red' || back.update === 'green')) {
        store.enqueue('update', `update-undo:${g.id}:${Date.now()}`, performerPayload(back, 'update'));
      }
    }
  }
  fresh();
  sendLater();
  res.json({ ok: true, group: g.id, status: previous });
});

/** A name as a folder name: no characters Windows refuses, no trailing dots or spaces; '' when nothing is left */
function cleanFolderName(s) {
  const name = String(s || '').normalize('NFKC').replace(/[<>:"/\\|?*\u0000-\u001F]/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/[. ]+$/, '').slice(0, 120).trim();
  return name === '.' || name === '..' ? '' : name;
}

/** Her Leakhaven model page, from a Leakhaven profile of hers or any Leakhaven link she has; null without one */
function leakshavenLink(g) {
  const profile = g.members.find((m) => m.type === 'profile' && /leakshaven\.com/.test(m.link || ''));
  const model = /[?&]q=([^&#]+)|\/model\/([^/?#]+)/.exec(profile?.link || g.links.find((l) => /leakshaven\.com/.test(l)) || '');
  return model ? `https://leakshaven.com/model/${model[1] || model[2]}` : null;
}

const firstFolder = () => db.prepare('SELECT id, path FROM folders ORDER BY id LIMIT 1').get() || null;
const libraryMatch = (g, ...names) => loadLibrary().performer(...names, ...g.names, ...(g.data?.aliases || []));

// What Add performer would make: her name (to change before adding), the folder, her Leakhaven link
router.get('/add-performer/preview', (req, res) => {
  const g = findGroup(String(req.query.group || ''));
  if (!g) return res.status(404).json({ error: 'no such performer' });
  const folder = firstFolder();
  if (!folder) return res.status(409).json({ error: 'the library has no media folder yet' });
  const name = cleanFolderName(g.names[0]);
  const had = libraryMatch(g, name);
  res.json({
    name, raw_name: g.names[0], folder, folder_path: path.join(folder.path, 'before filter performer', name),
    leakshaven_url: leakshavenLink(g), in_library: had ? { id: had.id, name: had.name } : null,
  });
});

// Add performer: an app performer with no files yet, in the first media folder, and her Leakhaven link, so the Leakhaven
// update checks follow her. Her folder is made with her row, or the library's scan would call her an orphan; when the folder
// can't be made the row goes too.
router.post('/add-performer', (req, res) => {
  const g = findGroupNow(req.body?.group);
  if (!g) return res.status(404).json({ error: 'no such performer' });
  const name = cleanFolderName(req.body?.name || g.names[0]);
  if (!name) return res.status(400).json({ error: 'name: her name is needed' });
  // her own names first: that is her in the library; a typed name that is someone else's is only a name taken
  const hers = loadLibrary().performer(...g.names, ...(g.data?.aliases || []));
  if (hers) return res.status(409).json({ error: `${hers.name} is in the library already`, performer_id: hers.id, name: hers.name, matched_on: 'her names' });
  const taken = loadLibrary().performer(name);
  if (taken) return res.status(409).json({ error: `${taken.name} is another performer in the library: choose another name`, performer_id: taken.id, name: taken.name, matched_on: 'typed' });
  const folder = firstFolder();
  if (!folder) return res.status(409).json({ error: 'the library has no media folder yet' });
  const link = leakshavenLink(g);
  const folderPath = path.join(folder.path, 'before filter performer', name);
  // the name she had on Discover stays as an alias when another one was given
  const aliases = [...new Set([...(g.data?.aliases || []), ...(g.names[0] !== name ? [g.names[0]] : [])])];
  let id;
  try {
    db.transaction(() => {
      id = Number(db.prepare('INSERT INTO performers (name, folder_id, aliases, leakshaven_url, scraped_source) VALUES (?, ?, ?, ?, ?)')
        .run(name, folder.id, JSON.stringify(aliases), link, link ? 'leakhaven' : null).lastInsertRowid);
      fs.ensureDirSync(folderPath);   // throws: the row is not kept
    })();
  } catch (err) {
    return res.status(500).json({ error: `could not add her: ${err.message}` });
  }
  // her Discover names point at the new performer whatever their length, so the next results still see her in the library
  rememberLibraryNames([g.names[0], name], id);
  fresh();
  res.json({ ok: true, performer_id: id, name, leakshaven_url: link, folder_path: folderPath });
});

// The contract of services/discover/verdicts.js. "files" is for this server's own events: a caller can't name a file here,
// and pictures given as URLs are not fetched (only the bytes count).
router.post('/performers', wrap(async (req, res) => {
  const { files, ...payload } = req.body || {};
  res.json(await applyEvent(payload));
}));

// ── Uploads ──
const MAX_FILES = 500;
/**
 * An entry as the page shows it. sent_verdict: what it was last sent with, 'keep', 'delete' or null (undecided);
 * sent_merged: the profile page had her already and took her in as undecided, so no verdict counted (sent_verdict null).
 */
const uploadView = (u, verdicts = store.uploadVerdicts()) => {
  const sent = u.sent_at ? verdicts.get(u.id) : null;
  return {
    ...u, files: u.files.map((f) => ({ ...f, image: cacheUrl(f.file) })), image: u.files[0] ? cacheUrl(u.files[0].file) : null,
    sent_verdict: sent && !sent.merged ? sent.verdict : null, sent_merged: !!sent?.merged,
  };
};

/** Whether the bytes are a picture: JPEG, PNG, GIF, WebP or AVIF, by their first bytes */
function isPicture(b) {
  if (!b || b.length < 12) return false;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return true;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return true;
  if (b.toString('latin1', 0, 4) === 'GIF8') return true;
  if (b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return true;
  return b.toString('latin1', 4, 8) === 'ftyp';
}

router.get('/uploads', (req, res) => {
  const all = store.allUploads();
  const list = matching(all, req.query.q, (u) => [u.name, ...u.files.map((f) => f.name)]);
  const items = sorted(list, req.query.sort || 'score', { score: (u) => u.score, newest: (u) => u.created_at, name: (u) => u.name || '' });
  // the entries with pictures that were never judged: "Judge n not judged"
  const notJudged = all.filter((u) => u.scored_at == null && u.files.length > 0).slice(0, MAX_FILES).map((u) => u.id);
  const verdicts = store.uploadVerdicts();
  res.json({ ...page(items, req.query, (u) => uploadView(u, verdicts)), not_judged_ids: notJudged });
});

router.post('/uploads', (req, res) => {
  const { name, kind } = req.body || {};
  if (!['performer', 'picture'].includes(kind)) return res.status(400).json({ error: 'kind: performer or picture' });
  const u = { id: newUploadId(), name: String(name || '').trim().slice(0, 200) || null, kind, files: [] };
  store.saveUpload(u);
  res.json(uploadView(store.upload(u.id)));
});

// Merge: the chosen entries become one performer (her name: the one given, or the first entry's), to be judged again. The
// new entry is saved before the old ones go, so a failure halfway loses no picture.
router.post('/uploads/merge', (req, res) => {
  const { ids, name } = req.body || {};
  const chosen = [...new Set((Array.isArray(ids) ? ids : []).map(String))].map((id) => store.upload(id)).filter(Boolean);
  if (chosen.length < 2) return res.status(400).json({ error: 'choose two or more' });
  // its pictures move: a send still on its way would find none
  const sending = chosen.find((e) => store.uploadSending(e.id));
  if (sending) return res.status(409).json({ error: `${sending.name || 'one of them'}: still on its way to the profile page, try again once it is there`, reason: 'sending' });
  const u = { id: newUploadId(), name: String(name || '').trim().slice(0, 200) || chosen.find((e) => e.name)?.name || null, kind: 'performer', files: [] };
  store.saveUpload(u);
  for (const e of chosen) {
    u.files.push(...moveFiles(e.files, u.id));
    store.saveUpload(u);
  }
  db.transaction(() => { for (const e of chosen) store.deleteUpload(e.id); })();
  for (const e of chosen) fs.removeSync(uploadDir(e.id));
  res.json(uploadView(store.upload(u.id)));
});

// Bulk, on the chosen entries: delete (here only, nothing goes to the profile page), send (undecided) or send-verdict (keep
// at or above the line, delete below). What can't be done is skipped with its reason: already sent, no name, unscored,
// gone, or sending (a delete while its send is still on its way to the profile page).
// → { results: [{ id, result: deleted|sent|skipped, verdict?, reason? }], deleted, sent, keep, delete, skipped: { reason: n } }
const BULK = ['delete', 'send', 'send-verdict'];
router.post('/uploads/bulk', (req, res) => {
  const { ids, action } = req.body || {};
  if (!BULK.includes(action)) return res.status(400).json({ error: `action: ${BULK.join(', ')}` });
  const chosen = [...new Set((Array.isArray(ids) ? ids : []).map(String))];
  if (!chosen.length) return res.status(400).json({ error: 'ids: choose one or more' });
  if (chosen.length > MAX_FILES) return res.status(400).json({ error: `at most ${MAX_FILES} at a time` });
  const results = [];
  for (const id of chosen) {
    const u = /^u[a-z0-9]+$/.test(id) ? store.upload(id) : null;
    if (!u) { results.push({ id, result: 'skipped', reason: 'gone' }); continue; }
    try {
      if (action === 'delete') {
        removeUpload(id);   // refused while a send of it is on its way: the profile page reads her pictures from here
        results.push({ id, result: 'deleted' });
        continue;
      }
      const { verdict } = sendUpload(u, { verdict: action === 'send-verdict' ? 'auto' : null });
      results.push({ id, result: 'sent', verdict });
    } catch (err) {
      if (!err.reason) throw err;
      results.push({ id, result: 'skipped', reason: err.reason });
    }
  }
  const count = (fn) => results.filter(fn).length;
  const skipped = {};
  for (const r of results) if (r.result === 'skipped') skipped[r.reason] = (skipped[r.reason] || 0) + 1;
  const sent = count((r) => r.result === 'sent');
  if (sent) sendLater();
  res.json({
    results, deleted: count((r) => r.result === 'deleted'), sent,
    keep: count((r) => r.verdict === 'keep'), delete: count((r) => r.verdict === 'delete'), skipped,
  });
});

router.param('uploadId', (req, res, next, id) => {
  req.upload = /^u[a-z0-9]+$/.test(id) ? store.upload(id) : null;
  if (!req.upload) return res.status(404).json({ error: 'no such upload' });
  next();
});

// One picture per request, its bytes as the body, its file name in ?name=
router.post('/uploads/:uploadId/files', express.raw({ type: () => true, limit: MAX_UPLOAD_BYTES }), (req, res) => {
  const ext = PICTURE_TYPES[String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase()];
  if (!ext) return res.status(415).json({ error: 'pictures only: JPEG, PNG, WebP, GIF or AVIF' });
  // read again now: the pictures of a folder come in one after another, each request its own
  const u = store.upload(req.upload.id);
  if (!u) return res.status(404).json({ error: 'no such upload' });
  if (u.kind === 'picture' && u.files.length) return res.status(409).json({ error: 'a picture entry holds one picture' });
  if (u.files.length >= MAX_FILES) return res.status(409).json({ error: `an entry holds at most ${MAX_FILES} pictures` });
  if (!req.body?.length) return res.status(400).json({ error: 'empty picture' });
  if (!isPicture(req.body)) return res.status(415).json({ error: 'not a picture' });
  const dir = uploadDir(u.id);
  fs.ensureDirSync(dir);
  const file = path.join(dir, `${u.files.length + 1}-${Date.now().toString(36)}-${crypto.randomBytes(2).toString('hex')}.${ext}`);
  fs.writeFileSync(file, req.body);
  const original = String(req.query.name || path.basename(file)).slice(0, 300);
  u.files.push({ file: rel(file), name: original, score: null });
  if (u.kind === 'picture' && !u.name) u.name = original.replace(/\.[^.]+$/, '');
  store.saveUpload({ ...u, score: null, scored_at: null });
  res.json(uploadView(store.upload(u.id)));
});

router.post('/uploads/:uploadId/score', wrap(async (req, res) => {
  const u = req.upload;
  if (!u.files.length) return res.status(400).json({ error: 'no pictures yet' });
  let judged;
  try {
    judged = await judge(u);
  } catch (err) {
    return res.status(err.waiting ? 503 : 502).json({ error: `P model: ${err.message}` });
  }
  // P can take minutes: what happened to the entry meanwhile stands. Removed or merged: it stays gone; other pictures
  // now: this score is not theirs; renamed or sent: only the scores are written
  const now = store.upload(u.id);
  if (!now) return res.status(404).json({ error: 'removed while P judged it' });
  const files = (list) => JSON.stringify(list.map((f) => f.file));
  if (files(now.files) !== files(u.files)) return res.status(409).json({ error: 'its pictures changed while P judged it: judge it again' });
  store.saveUpload({ ...now, files: judged.files, score: judged.score, model: judged.model, scored_at: judged.scored_at });
  res.json(uploadView(store.upload(u.id)));
}));

// Split: every picture becomes an entry of its own, with the score it already has alone. The new entries are saved before
// the old one goes.
router.post('/uploads/:uploadId/split', (req, res) => {
  const u = req.upload;
  if (u.files.length < 2) return res.status(400).json({ error: 'one picture: nothing to split' });
  try { notSending(u.id); } catch (err) { return res.status(err.status).json({ error: err.message, reason: err.reason }); }
  const made = [];
  for (const f of u.files) {
    const one = { id: newUploadId(), name: f.name.replace(/\.[^.]+$/, ''), kind: 'picture', model: u.model };
    one.files = moveFiles([f], one.id);
    if (!one.files.length) { fs.removeSync(uploadDir(one.id)); continue; }   // its file is gone
    one.score = f.score ?? null;
    one.scored_at = f.score != null ? u.scored_at : null;
    store.saveUpload(one);
    made.push(one.id);
  }
  db.transaction(() => store.deleteUpload(u.id))();
  fs.removeSync(uploadDir(u.id));
  res.json({ ids: made });
});

// Send to the profile page (the "upload" event), under the name given or the entry's; once per set of pictures. verdict:
// none (undecided), keep, delete, or auto: keep at or above the line, delete below (400 when it has no score)
router.post('/uploads/:uploadId/send', (req, res) => {
  try {
    const { upload } = sendUpload(req.upload, { name: req.body?.name, verdict: req.body?.verdict });
    sendLater();
    res.json(uploadView(upload));
  } catch (err) {
    if (!err.reason) throw err;
    res.status(err.status).json({ error: err.message, reason: err.reason });
  }
});

router.patch('/uploads/:uploadId', (req, res) => {
  store.saveUpload({ ...req.upload, name: String(req.body?.name || '').trim().slice(0, 200) || null });
  res.json(uploadView(store.upload(req.upload.id)));
});

// Remove: the entry and its files, nothing sent anywhere
router.delete('/uploads/:uploadId', (req, res) => {
  try {
    removeUpload(req.upload.id);
  } catch (err) {
    if (!err.reason) throw err;
    return res.status(err.status).json({ error: err.message, reason: err.reason });
  }
  res.json({ ok: true });
});

// A body refused before a route saw it: an upload over the limit answers as one, not as a server error
router.use((err, req, res, next) => {
  if (!err.status) return next(err);
  res.status(err.status).json({ error: err.status === 413 ? `over ${MAX_UPLOAD_BYTES / 1024 / 1024} MB` : err.message });
});

module.exports = router;
