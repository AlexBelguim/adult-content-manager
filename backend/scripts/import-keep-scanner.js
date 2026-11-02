/**
 * Discover: carries the standalone keep scanner's results into the app, once, after the first deploy with Discover.
 *
 *   node backend/scripts/import-keep-scanner.js <folder>   [--dry-run]
 *
 * <folder> holds the scanner's results.db (with its -wal and -shm) and its cache/ folder as they were on the PC. On the NAS:
 * copy them into data/discover-import, then, with the scanner stopped, run this in the container with /app/data/discover-import.
 *
 * Copies the posts, profiles, watcher checks, the Duplicates decisions and combines, the pool scores and how far each backlog
 * got into the discover_* tables, and moves the pictures into <data>/discover/cache. Nothing already here is overwritten, so
 * running it twice changes nothing. Paths are rewritten from the PC's to the cache's, and the pool scores' keys with them.
 * performer_status, app_outbox and uploads were empty when this was written; any rows there are carried over too.
 */
const crypto = require('crypto');
const path = require('path');
const fs = require('fs-extra');
const Database = require('better-sqlite3');
const { CACHE } = require('../services/discover/paths');
const db = require('../db');
const { poolOf } = require('../services/discover/same');

const sign = (images) => crypto.createHash('sha1').update(images.join('\n')).digest('hex');

function run(folder, { dryRun = false } = {}) {
  const dbFile = path.join(folder, 'results.db');
  if (!fs.existsSync(dbFile)) throw new Error(`No results.db in ${folder}`);
  const old = new Database(dbFile, { readonly: true });
  const rows = (table) => old.prepare(`SELECT * FROM ${table}`).all();
  const posts = rows('posts'), profiles = rows('profiles');
  // The scanner moved house while it ran, so its rows hold more than one cache folder, with either slash. What counts is the
  // part after /cache/; the path as it was is kept per picture, for the pool scores' keys.
  const asItWas = new Map();
  const relOf = (p) => {
    if (!p) return p;
    const r = p.replace(/^.*[\\/]cache[\\/]/, '').split('\\').join('/');
    asItWas.set(r, p);
    return r;
  };
  const relList = (json) => (json ? JSON.stringify(JSON.parse(json).map(relOf)) : null);
  const counts = { posts: 0, profiles: 0, checks: 0, links: 0, decisions: 0, statuses: 0, pools: 0, backlog: 0, events: 0, uploads: 0 };

  const copy = (table, list, map, key) => {
    if (!list.length) return;
    const cols = Object.keys(map(list[0]));
    const put = db.prepare(`INSERT OR IGNORE INTO ${table} (${cols.join(', ')}) VALUES (${cols.map((c) => `@${c}`).join(', ')})`);
    for (const r of list) counts[key] += put.run(map(r)).changes;
  };

  const apply = db.transaction(() => {
    copy('discover_posts', posts, (p) => ({
      site: p.site, post_id: String(p.post_id), short_code: p.short_code, title: p.title, post_url: p.post_url, share_url: p.share_url, page_kind: p.page_kind,
      performer_name: p.performer_name, saved_link: p.saved_link, image_url: p.image_url, image_path: relOf(p.image_path), image_paths: relList(p.image_paths),
      score: p.score, kept: p.kept, skip_reason: p.skip_reason, model: p.model, info: p.info, posted_at: p.posted_at, scanned_at: p.scanned_at,
    }), 'posts');
    copy('discover_profiles', profiles, (p) => ({
      site: p.site, profile_id: String(p.profile_id), name: p.name, url: p.url, image_url: p.image_url, image_path: relOf(p.image_path), image_paths: relList(p.image_paths),
      score: p.score, kept: p.kept, model: p.model, judged_at: p.judged_at, scrape: p.scrape, full: p.full, data_at: p.data_at,
    }), 'profiles');
    copy('discover_watcher_checks', rows('watcher_checks'), (r) => ({ watcher: r.watcher, checked_at: r.checked_at, found: r.found, error: r.error }), 'checks');
    copy('discover_performer_links', rows('performer_links'), (r) => ({ a: r.a, b: r.b, kind: r.kind, at: r.at }), 'links');
    copy('discover_performer_decisions', rows('performer_decisions'), (r) => ({ member: r.member, decision: r.decision, at: r.at }), 'decisions');
    copy('discover_performer_status', rows('performer_status'), (r) => ({ member: r.member, status: r.status, at: r.at }), 'statuses');
    copy('discover_backlog', rows('backlog'), (r) => ({ site: r.site, cursor: r.cursor, pages: r.pages, updated_at: r.updated_at }), 'backlog');
    copy('discover_events', rows('app_outbox'), (r) => ({ dedupe: r.dedupe, kind: r.kind, payload: r.payload, created_at: r.created_at, sent_at: r.sent_at, error: r.error, answer: r.answer }), 'events');
    copy('discover_uploads', rows('uploads'), (u) => ({
      id: u.id, name: u.name, kind: u.kind, score: u.score, model: u.model, created_at: u.created_at, scored_at: u.scored_at, sent_at: u.sent_at,
      files: JSON.stringify(JSON.parse(u.files).map((f) => ({ ...f, file: relOf(f.file) }))),
    }), 'uploads');

    // A pool score's key is the hash of its picture paths: found by the performers' pictures, before and after the rewrite
    const oldPools = new Map(rows('pool_scores').map((r) => [r.signature, r]));
    const seen = new Set();
    for (const images of poolsOfGroups()) {
      const pool = oldPools.get(sign(images.map((p) => asItWas.get(p) || p).sort()));
      const signature = sign(images);
      if (!pool || seen.has(signature)) continue;
      seen.add(signature);
      counts.pools += db.prepare('INSERT OR IGNORE INTO discover_pool_scores (signature, score, images, model, scored_at) VALUES (?, ?, ?, ?, ?)')
        .run(signature, pool.score, pool.images, pool.model, pool.scored_at).changes;
    }
    if (dryRun) throw Object.assign(new Error('dry run'), { dryRun: true });
  });

  try {
    apply();
  } catch (err) {
    if (!err.dryRun) throw err;
  } finally {
    old.close();
  }

  // The pictures: moved when the import folder is on the same disk as the cache, else copied
  const from = path.join(folder, 'cache');
  let pictures = 0;
  if (!dryRun && fs.existsSync(from)) {
    fs.ensureDirSync(CACHE);
    for (const site of fs.readdirSync(from)) {
      const src = path.join(from, site), dst = path.join(CACHE, site);
      fs.copySync(src, dst, { overwrite: false, errorOnExist: false, filter: (f) => { if (fs.statSync(f).isFile()) pictures++; return true; } });
    }
  }
  return { ...counts, pictures };
}

/** The picture lists of every performer as the page groups them, for the pool scores' keys */
function poolsOfGroups() {
  const { currentResults } = require('../services/discover/scan');
  return currentResults().everyone.map((g) => poolOf(g.members)?.images).filter(Boolean);
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const folder = args.find((a) => !a.startsWith('--'));
  if (!folder) {
    console.error('node backend/scripts/import-keep-scanner.js <folder with results.db and cache/> [--dry-run]');
    process.exit(1);
  }
  const outcome = run(path.resolve(folder), { dryRun: args.includes('--dry-run') });
  console.log(args.includes('--dry-run') ? 'Dry run, nothing written:' : 'Imported:', outcome);
}

module.exports = { run };
