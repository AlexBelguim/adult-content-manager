/**
 * Discover's results, in the app's database (the discover_* tables, migration 018). One row per scanned post, keyed by
 * site + post id so a post is only judged once; the creator profiles (judgment and data); how far back each site's backlog
 * scan got; the Duplicates decisions, Keep / Delete / Checked / Remove on a performer, what the profile page is still to be
 * told, and the Upload tab's entries.
 *
 * Site ids are stored as text: better-sqlite3 binds every JS number as a float, and a numeric id would come out as "123.0".
 */
const db = require('../../db');

const COLUMNS = ['site', 'post_id', 'short_code', 'title', 'post_url', 'share_url', 'page_kind', 'performer_name', 'saved_link',
  'image_url', 'image_path', 'image_paths', 'score', 'kept', 'skip_reason', 'waiting', 'model', 'info', 'posted_at', 'scanned_at'];
const toList = (json) => { try { return json ? JSON.parse(json) : null; } catch { return null; } };
const now = () => new Date().toISOString();
const id = (v) => (v == null ? v : String(v));

const has = db.prepare('SELECT 1 FROM discover_posts WHERE site = ? AND post_id = ?');
const hasAny = db.prepare('SELECT 1 FROM discover_posts WHERE site = ? LIMIT 1');
const insert = db.prepare(`INSERT OR REPLACE INTO discover_posts (${COLUMNS.join(', ')}) VALUES (${COLUMNS.map((c) => '@' + c).join(', ')})`);

const parsePost = (row) => ({ ...row, info: row.info ? JSON.parse(row.info) : null, image_paths: toList(row.image_paths) });
const parseProfile = (row) => ({ ...row, scrape: row.scrape ? JSON.parse(row.scrape) : null, image_paths: toList(row.image_paths) });

const statusPut = () => db.prepare(`INSERT INTO discover_performer_status (member, status, at) VALUES (?, ?, ?)
  ON CONFLICT(member) DO UPDATE SET status = excluded.status, at = excluded.at`);
const decisionPut = () => db.prepare(`INSERT INTO discover_performer_decisions (member, decision, at) VALUES (?, ?, ?)
  ON CONFLICT(member) DO UPDATE SET decision = excluded.decision, at = excluded.at`);

const store = {
  seen: (site, postId) => !!has.get(site, id(postId)),
  /** When a post was first recorded, or null when it never was */
  seenAt: (site, postId) => db.prepare('SELECT scanned_at FROM discover_posts WHERE site = ? AND post_id = ?').get(site, id(postId))?.scanned_at ?? null,
  /** When the last watch scan of a site that read down to the posts it had began: the posts recorded before it are behind it */
  watchMark: (site) => store.setting(`watchMark:${site}`, null),
  setWatchMark: (site, iso) => store.setSetting(`watchMark:${site}`, iso),
  /** Whether the site was scanned before (any post of it recorded) */
  scanned: (site) => !!hasAny.get(site),
  save: (row) => insert.run({
    ...Object.fromEntries(COLUMNS.map((c) => [c, row[c] ?? null])),
    post_id: id(row.post_id),
    waiting: row.waiting ? 1 : 0,
    info: row.info ? JSON.stringify(row.info) : null,
    image_paths: row.image_paths?.length > 1 ? JSON.stringify(row.image_paths) : null,
    scanned_at: row.scanned_at || now(),   // kept when a post is judged again (Re-judge): when it was found
  }),
  profile: (site, profileId) => {
    const row = db.prepare('SELECT * FROM discover_profiles WHERE site = ? AND profile_id = ?').get(site, id(profileId));
    return row ? parseProfile(row) : null;
  },
  saveProfileJudgment: (row) => db.prepare(`
    INSERT INTO discover_profiles (site, profile_id, name, url, image_url, image_path, image_paths, score, kept, waiting, model, judged_at)
    VALUES (@site, @profile_id, @name, @url, @image_url, @image_path, @image_paths, @score, @kept, @waiting, @model, @judged_at)
    ON CONFLICT(site, profile_id) DO UPDATE SET name = excluded.name, url = excluded.url, image_url = excluded.image_url,
      image_path = excluded.image_path, image_paths = excluded.image_paths, score = excluded.score, kept = excluded.kept,
      waiting = excluded.waiting, model = excluded.model, judged_at = excluded.judged_at
  `).run({
    site: row.site, profile_id: id(row.profile_id), name: row.name ?? null, url: row.url ?? null, image_url: row.image_url ?? null, image_path: row.image_path ?? null,
    image_paths: row.image_paths?.length > 1 ? JSON.stringify(row.image_paths) : null, score: row.score ?? null, kept: row.kept ?? null,
    waiting: row.waiting ? 1 : 0, model: row.model ?? null, judged_at: row.judged_at || now(),
  }),
  saveProfileData: ({ site, profile_id, name, url, image_url = null, scrape, full }) => db.prepare(`
    INSERT INTO discover_profiles (site, profile_id, name, url, image_url, scrape, full, data_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(site, profile_id) DO UPDATE SET name = excluded.name, url = excluded.url,
      image_url = COALESCE(discover_profiles.image_url, excluded.image_url), scrape = excluded.scrape, full = excluded.full, data_at = excluded.data_at
  `).run(site, id(profile_id), name ?? null, url ?? null, image_url, JSON.stringify(scrape), full ? 1 : 0, now()),
  allProfiles: () => db.prepare('SELECT * FROM discover_profiles ORDER BY name').all().map(parseProfile),
  /** A watcher ran just now: found = what it judged or skipped, error = why it stopped (null when it went fine) */
  setChecked: (watcher, found, error = null) => db.prepare(`
    INSERT INTO discover_watcher_checks (watcher, checked_at, found, error) VALUES (?, ?, ?, ?)
    ON CONFLICT(watcher) DO UPDATE SET checked_at = excluded.checked_at, found = excluded.found, error = excluded.error
  `).run(watcher, now(), found, error),
  /** Two performers combined (kind 'same') or kept apart ('apart'), by a member key of each; the latest wins. */
  setLink: (a, b, kind) => store.putLink(a, b, kind, now()),
  /** A link as it was (Undo): its own time kept */
  putLink: (a, b, kind, at) => {
    const [x, y] = [a, b].sort();
    db.prepare(`INSERT INTO discover_performer_links (a, b, kind, at) VALUES (?, ?, ?, ?)
      ON CONFLICT(a, b) DO UPDATE SET kind = excluded.kind, at = excluded.at`).run(x, y, kind, at || now());
  },
  link: (a, b) => {
    const [x, y] = [a, b].sort();
    return db.prepare('SELECT a, b, kind, at FROM discover_performer_links WHERE a = ? AND b = ?').get(x, y) || null;
  },
  deleteLink: (a, b) => {
    const [x, y] = [a, b].sort();
    db.prepare('DELETE FROM discover_performer_links WHERE a = ? AND b = ?').run(x, y);
  },
  links: () => db.prepare('SELECT a, b, kind, at FROM discover_performer_links').all(),
  /** Keep or drop, on each of the performer's members (a member who joins later inherits it through the others). */
  decide: (memberKeys, decision) => {
    const at = now();
    const put = decisionPut();
    db.transaction(() => { for (const m of memberKeys) put.run(m, decision, at); })();
  },
  /** Decisions as they were (Undo): decision null takes the row away, else it is put back with its own time */
  restoreDecisions: (rows) => {
    const put = decisionPut();
    const del = db.prepare('DELETE FROM discover_performer_decisions WHERE member = ?');
    db.transaction(() => {
      for (const r of rows) {
        if (r.decision == null) del.run(r.member);
        else put.run(r.member, r.decision, r.at || now());
      }
    })();
  },
  decisions: () => Object.fromEntries(db.prepare('SELECT * FROM discover_performer_decisions').all().map((r) => [r.member, { decision: r.decision, at: r.at }])),
  savePool: (signature, score, images, model) => db.prepare(`INSERT INTO discover_pool_scores (signature, score, images, model, scored_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(signature) DO UPDATE SET score = excluded.score, images = excluded.images, model = excluded.model, scored_at = excluded.scored_at`)
    .run(signature, score, images, model ?? null, now()),
  clearPools: () => db.exec('DELETE FROM discover_pool_scores'),
  /** The pool scores of every other model than this one (Re-judge: they are scored again with it) */
  clearPoolsExcept: (model) => db.prepare('DELETE FROM discover_pool_scores WHERE model IS NOT ?').run(model ?? null),
  /** Keep / Delete / Checked / Remove on each of a performer's members now; a member found later has no row (an update). */
  setStatus: (memberKeys, status) => {
    const at = now();
    const put = statusPut();
    db.transaction(() => { for (const m of memberKeys) put.run(m, status, at); })();
  },
  /** Put back: no Keep / Delete / Checked / Remove on these members any more */
  clearStatus: (memberKeys) => {
    const del = db.prepare('DELETE FROM discover_performer_status WHERE member = ?');
    db.transaction(() => { for (const m of memberKeys) del.run(m); })();
  },
  /** The rows as they were before a click (Undo): status null takes the row away, else it is put back with its own time */
  restoreStatus: (rows) => {
    const put = statusPut();
    const del = db.prepare('DELETE FROM discover_performer_status WHERE member = ?');
    db.transaction(() => {
      for (const r of rows) {
        if (r.status == null) del.run(r.member);
        else put.run(r.member, r.status, r.at || now());
      }
    })();
  },
  statuses: () => Object.fromEntries(db.prepare('SELECT * FROM discover_performer_status').all().map((r) => [r.member, { status: r.status, at: r.at }])),
  /** Queue an event for the profile page; a dedupe key queued before is left alone. Returns the new event's id, or null when it was not new. */
  enqueue: (kind, dedupe, payload) => {
    const r = db.prepare('INSERT OR IGNORE INTO discover_events (dedupe, kind, payload, created_at) VALUES (?, ?, ?, ?)').run(dedupe, kind, JSON.stringify(payload), now());
    return r.changes > 0 ? Number(r.lastInsertRowid) : null;
  },
  eventById: (eventId) => db.prepare('SELECT id, kind, dedupe, created_at, sent_at, error FROM discover_events WHERE id = ?').get(eventId) || null,
  /** The verdict ('keep', 'delete', 'superwrong') of the last keep or delete queued for a performer before an event; null without one */
  lastVerdict: (key, beforeId) => {
    const rows = db.prepare("SELECT payload FROM discover_events WHERE kind IN ('keep', 'delete') AND id < ? ORDER BY id DESC LIMIT 500").all(beforeId);
    for (const r of rows) {
      let p = null;
      try { p = JSON.parse(r.payload); } catch { continue; }
      if (p?.key === key) return p.verdict || p.event || null;
    }
    return null;
  },
  /** Takes an event out of the outbox, only while it is not sent yet; returns whether it did */
  deleteEvent: (eventId) => db.prepare('DELETE FROM discover_events WHERE id = ? AND sent_at IS NULL').run(eventId).changes > 0,
  pendingEvents: () => db.prepare('SELECT * FROM discover_events WHERE sent_at IS NULL ORDER BY id').all().map((r) => ({ ...r, payload: JSON.parse(r.payload) })),
  outboxCounts: () => {
    const c = db.prepare('SELECT COUNT(*) AS queued, SUM(error IS NOT NULL) AS failing FROM discover_events WHERE sent_at IS NULL').get();
    return { queued: c.queued, failing: c.failing || 0 };
  },
  markSent: (eventId, answer = null) => db.prepare('UPDATE discover_events SET sent_at = ?, error = NULL, answer = ? WHERE id = ?').run(now(), answer ? String(answer).slice(0, 2000) : null, eventId),
  markFailed: (eventId, error) => db.prepare('UPDATE discover_events SET error = ? WHERE id = ?').run(String(error).slice(0, 500), eventId),
  saveUpload: (u) => db.prepare(`INSERT INTO discover_uploads (id, name, kind, files, score, model, created_at, scored_at, sent_at)
    VALUES (@id, @name, @kind, @files, @score, @model, @created_at, @scored_at, @sent_at)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, kind = excluded.kind, files = excluded.files, score = excluded.score,
      model = excluded.model, scored_at = excluded.scored_at, sent_at = excluded.sent_at`)
    .run({ id: u.id, kind: u.kind, name: u.name ?? null, score: u.score ?? null, model: u.model ?? null, scored_at: u.scored_at ?? null, sent_at: u.sent_at ?? null, created_at: u.created_at || now(), files: JSON.stringify(u.files || []) }),
  upload: (uploadId) => { const r = db.prepare('SELECT * FROM discover_uploads WHERE id = ?').get(uploadId); return r ? { ...r, files: JSON.parse(r.files) } : null; },
  allUploads: () => db.prepare('SELECT * FROM discover_uploads ORDER BY created_at DESC').all().map((r) => ({ ...r, files: JSON.parse(r.files) })),
  deleteUpload: (uploadId) => db.prepare('DELETE FROM discover_uploads WHERE id = ?').run(uploadId),
  uploadCount: () => db.prepare('SELECT COUNT(*) AS n FROM discover_uploads').get().n,
  /**
   * How each upload was last sent, by its id: { verdict: 'keep' | 'delete' | null (undecided), merged }. merged: the profile
   * page had her already and took her in as undecided, whatever the verdict (the applied event's answer says so).
   */
  uploadVerdicts: () => new Map(db.prepare(`SELECT dedupe, json_extract(payload, '$.verdict') AS verdict,
      CASE WHEN json_valid(answer) THEN json_extract(answer, '$.result') END AS result
    FROM discover_events WHERE kind = 'upload' ORDER BY id`).all()
    .map((r) => [String(r.dedupe).split(':')[1], { verdict: r.verdict ?? null, merged: r.result === 'merged' }])),
  /** Whether an upload's "upload" event still waits for the profile page: it reads her pictures from the upload's folder */
  uploadSending: (uploadId) => !!db.prepare("SELECT 1 FROM discover_events WHERE kind = 'upload' AND sent_at IS NULL AND dedupe LIKE ? LIMIT 1")
    .get(`upload:${uploadId}:%`),
  setting: (key, fallback = null) => { const r = db.prepare('SELECT value FROM discover_settings WHERE key = ?').get(key); return r ? JSON.parse(r.value) : fallback; },
  setSetting: (key, value) => db.prepare('INSERT INTO discover_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(value)),
  pools: () => Object.fromEntries(db.prepare('SELECT signature, score, model FROM discover_pool_scores').all().map((r) => [r.signature, { score: r.score, model: r.model }])),
  checks: () => Object.fromEntries(db.prepare('SELECT * FROM discover_watcher_checks').all().map((r) => [r.watcher, { checked_at: r.checked_at, found: r.found, error: r.error }])),
  backlog: (site) => db.prepare('SELECT cursor, pages FROM discover_backlog WHERE site = ?').get(site) || { cursor: null, pages: 0 },
  setBacklog: (site, cursor, pages) => db.prepare(`
    INSERT INTO discover_backlog (site, cursor, pages, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(site) DO UPDATE SET cursor = excluded.cursor, pages = excluded.pages, updated_at = excluded.updated_at
  `).run(site, cursor ?? null, pages, now()),
  allPosts: () => db.prepare('SELECT * FROM discover_posts ORDER BY scanned_at').all().map(parsePost),
  /** What is saved but not judged yet: nobody could when it was found */
  waitingPosts: () => db.prepare('SELECT * FROM discover_posts WHERE waiting = 1 ORDER BY scanned_at').all().map(parsePost),
  waitingProfiles: () => db.prepare('SELECT * FROM discover_profiles WHERE waiting = 1').all().map(parseProfile),
  /** Skipped for a passing reason (a picture or page that did not load): tried again by the next runs, up to 3 times */
  retryPosts: () => db.prepare("SELECT * FROM discover_posts WHERE score IS NULL AND waiting = 0 AND info LIKE '%\"retry\"%' ORDER BY scanned_at").all()
    .map(parsePost).filter((p) => p.info?.retry),
};

module.exports = store;
