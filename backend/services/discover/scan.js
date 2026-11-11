/**
 * A Discover run (the keep scanner, in the app): the watchers read their sites, each post's pictures are saved to the cache
 * and judged with the P model, and everything is recorded once with its score; a kept one also gets its link. A posts
 * watcher reads a site's newest posts, a profiles watcher its creator profiles. Run again later, it judges only what it has
 * not seen. judge.js says who judges; while nobody can, posts are saved as waiting and the next run judges them.
 */
const fs = require('fs');
const path = require('path');
const { createHttp } = require('./http');
const { createJudge } = require('./judge');
const { poolOf } = require('./same');
const { loadLibrary } = require('./library');
const { buildResults, storedState } = require('./results');
const { sendQueued, runEvents } = require('./events');
const { WATCHERS, LIMITS, flareSolverrUrl } = require('./watchers');
const { CACHE, rel, abs } = require('./paths');
const { say, warn, stopped } = require('./runLog');
const store = require('./store');
const { createLeakshaven } = require('../sites/leakshaven');
const { createLeakgallery } = require('../sites/leakgallery');
const { createFapello } = require('../sites/fapello');
const { createKvsAlbums } = require('../sites/kvs-albums');
const { createPorn4fans } = require('../sites/porn4fans');
const { createPimpbunny } = require('../sites/pimpbunny');
const { createGigafans } = require('../sites/gigafans');

const ADAPTERS = { leakshaven: createLeakshaven, leakgallery: createLeakgallery, fapello: createFapello, 'kvs-albums': createKvsAlbums, porn4fans: createPorn4fans, pimpbunny: createPimpbunny, gigafans: createGigafans };

/** The keep line; a setting of its own */
const threshold = () => store.setting('threshold', 50);

// How many times a post skipped for a passing reason is tried in all
const RETRIES = 3;

// A file or folder name; trailing dots and spaces go
const slug = (s) => String(s || 'unknown').normalize('NFKC').replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(0, 60).replace(/[. ]+$/, '') || 'unknown';
const extOf = (url) => (url.split('?')[0].match(/\.(webp|jpe?g|png|gif|avif)$/i)?.[1] || 'jpg').toLowerCase();

/**
 * Saves a post's or profile's pictures as <base>.<ext>, <base>-2.<ext>, …, and returns the files. The first (the
 * cover) must come; another one that fails is left out. P judges them together, as it judges a performer's gallery.
 */
async function downloadPictures(http, urls, dir, base) {
  fs.mkdirSync(dir, { recursive: true });
  const files = [];
  for (const [i, url] of urls.entries()) {
    const file = path.join(dir, `${base}${i ? `-${i + 1}` : ''}.${extOf(url)}`);
    try {
      if (!fs.existsSync(file)) await http.download(url, file);
      files.push(file);
    } catch (err) {
      if (!i) throw err;
      warn(`  picture ${i + 1} of ${urls.length} failed: ${err.message}`);
    }
  }
  return files;
}

/** A post's own pictures (its card's, its album's), up to picturesPerPost, saved in the cache. */
function downloadPost(http, site, post, performer) {
  const urls = [...new Set([post.image, ...(post.images || []), ...(performer?.images || [])].filter(Boolean))].slice(0, LIMITS.picturesPerPost);
  return downloadPictures(http, urls, path.join(CACHE, site.name, slug(post.title)), slug(post.postId));
}

/**
 * Judges the posts not judged yet; returns this run's counts. A watch scan starts at the newest post and stops at
 * the first post it had recorded before the last watch scan that read down to the posts it had (its mark, per site:
 * when that scan began; the listings are newest first), below which everything was judged then. A post recorded after
 * the mark (by a run cut short, a pause) is passed over, so the posts below it are still read. A backlog scan goes on
 * from the oldest page any backlog scan reached, further into the past, past what it judged before; a site read to the
 * end of its listing is done (backlogDone) and left out of the later ones.
 *
 * A watch scan of a site scanned before goes all the way down to there, however many posts came in since (a long
 * pause, the NAS off overnight), so nothing between two scans is left out. maxPages and maxPosts bound a site's
 * first scan, a backlog scan, and a run given limits; such a run cut short leaves the posts below its last one to the
 * backlog. Should the posts it judged before be gone from the listing (the site changed), it stops after watchMaxPages.
 */
async function scan({ sites, judge, http, backlog = false, limits = {} }) {
  let budget = limits.maxPosts ?? LIMITS.maxPosts ?? Infinity;
  const counts = { kept: 0, rejected: 0, skipped: 0, seen: 0, waiting: 0 };

  for (const site of sites) {
    if (stopped()) break;
    if (backlog && store.setting(`backlogDone:${site.name}`, null)) { say(`\n[${site.name}] older posts: all read`); continue; }
    const adapter = ADAPTERS[site.adapter]?.(site, http);
    if (!adapter) { warn(`No adapter "${site.adapter}" for site ${site.name}`); continue; }
    const start = backlog ? store.backlog(site.name) : { cursor: null, pages: 0 };
    // Where a watch scan stops: a post recorded before the mark
    const mark = backlog ? null : store.watchMark(site.name);
    const siteStart = new Date().toISOString();
    let read = 0;   // pages read: a site never reached (the run's posts used up) records no check
    let cursor = start.cursor;
    const firstPage = new Set();
    const catchUp = !backlog && store.scanned(site.name);
    const maxPages = catchUp && !limits.maxPages ? LIMITS.watchMaxPages : (limits.maxPages ?? LIMITS.maxPages);
    const counted = !catchUp || limits.maxPosts;   // this site's posts use up the run's maxPosts
    const judgedNow = new Set();
    let caughtUp = false;

    // One site failing (down, changed, its FlareSolverr not running) leaves the other sites to run
    try {
      let page = 0;
      for (; page < maxPages && (!counted || budget > 0) && !stopped(); page++) {
        say(`\n[${site.name}] ${backlog ? `backlog page ${start.pages + page + 1}` : `page ${page + 1}`}`);
        const { posts, next } = await adapter.listPage(cursor);
        read++;
        if (!posts.length) {
          // A site scanned before always has posts on top: none means the site (or its page) changed
          if (!backlog && page === 0 && store.scanned(site.name)) throw new Error('the first page shows no posts: the site may have changed');
          say('  no posts');
          break;
        }
        // An adapter whose next page is the first one again would judge the top forever
        if (page > 0 && posts.every((p) => firstPage.has(p.postId))) throw new Error(`[${site.name}] the next page repeats the first: the adapter does not page.`);
        if (page === 0) posts.forEach((p) => firstPage.add(p.postId));

        let lastScan = null;
        for (const post of posts) {
          if (stopped()) break;
          // Listings paged by number shift down while they are read (a new post pushes the last one of a page to
          // the top of the next): a post judged earlier in this run is passed over, only one from before stops it
          if (judgedNow.has(post.postId)) continue;
          if (backlog) {
            if (store.seen(site.name, post.postId)) { counts.seen++; continue; }
          } else {
            const at = store.seenAt(site.name, post.postId);
            if (at) {
              if (mark == null || at <= mark) { lastScan = post; break; }
              counts.seen++;   // recorded by a run that did not get down to the last scan: go on below it
              continue;
            }
          }
          judgedNow.add(post.postId);
          if (counted && budget <= 0) break;
          if (counted) budget--;
          const row = { site: site.name, post_id: post.postId, short_code: post.shortCode, title: post.title, post_url: post.postUrl, share_url: post.shareUrl, performer_name: post.title, info: post.info, posted_at: post.createdAt, image_url: post.image };
          const skip = (reason, extra = {}) => { store.save({ ...row, ...extra, skip_reason: reason }); counts.skipped++; };
          // A passing failure (a picture or page that did not load): the next runs try it again, up to 3 times (retrySkipped)
          const skipForNow = (reason, message, extra = {}, performer = null) => skip(`${reason}: ${message} (tried 1 of ${RETRIES})`,
            { ...extra, info: { ...row.info, retry: { attempts: 1, post, performer } } });
          if (!post.image) { skip(post.skipReason || 'no picture'); continue; }

          // An adapter whose listing does not say who a post is of (an album: the models its page links) is asked
          // first; a post of nobody is skipped before its picture, so it never becomes a performer
          let performer = null;
          if (adapter.resolve) {
            try {
              performer = await adapter.resolve(post);
            } catch (err) {
              warn(`  ${post.title}: page could not be read: ${err.message}`);
              skipForNow('page could not be read', err.message);
              continue;
            }
            if (!performer) { skip('no performer linked on its page'); say(`        -  ${post.title}  (no performer linked)`); continue; }
            row.performer_name = performer.name;
          }

          // Only the post's own pictures (its card's, its album's): the other posts on a creator page, even ones under
          // her name, can be of someone else. Up to picturesPerPost of them, judged together.
          let files;
          try {
            files = await downloadPost(http, site, post, performer);
          } catch (err) {
            warn(`  ${post.title}: picture failed: ${err.message}`);
            skipForNow('picture download failed', err.message, {}, performer);
            continue;
          }

          let score;
          try {
            ({ score } = await judge.score(files));
          } catch (err) {
            if (err.waiting) {
              // What a later run needs to finish it: the post as the listing gave it
              store.save({ ...row, info: { ...row.info, judged_on: files.length, post, performer }, image_path: rel(files[0]), image_paths: files.map(rel), waiting: 1 });
              counts.waiting++;
              continue;
            }
            warn(`  ${post.title}: could not judge the pictures: ${err.message}`);
            skipForNow('picture could not be read', err.message, { image_path: rel(files[0]) }, performer);
            continue;
          }
          const target = await saveJudged({ site, adapter, post, performer, row, files, score, judge });
          counts[score >= judge.threshold ? 'kept' : 'rejected']++;
          say(`  ${score >= judge.threshold ? 'KEEP' : '    '} ${score.toFixed(1).padStart(5)}  ${post.title}${files.length > 1 ? ` (${files.length} pictures)` : ''}${target ? `  → ${target.kind}: ${target.link}` : ''}`);
        }

        if (stopped()) break;
        if (lastScan) {
          counts.seen++;
          say(`  caught up with the last scan (at "${lastScan.title}")`);
          caughtUp = true;
          break;
        }
        // A page cut short by maxPosts is read again next time; at the end of the listing this site's older posts are all read
        if (backlog && budget > 0) {
          if (next) store.setBacklog(site.name, next, start.pages + page + 1);
          else {
            store.setBacklog(site.name, null, 0);
            store.setSetting(`backlogDone:${site.name}`, new Date().toISOString());
          }
        }
        if (!next) { say('  end of the listing'); caughtUp = true; break; }
        cursor = next;
      }
      if (catchUp && !caughtUp && page >= maxPages) warn(`  [${site.name}] stopped after ${page} pages before reaching the last scan: the posts in between are for the backlog (Older posts)`);
      // Read down to the last scan (or the end): what is recorded from now on is behind the next watch scan's stop. A run cut
      // short keeps the old mark.
      if (!backlog && caughtUp && !stopped()) store.setWatchMark(site.name, siteStart);
      if (site.id && read) store.setChecked(site.id, judgedNow.size);
    } catch (err) {
      if (site.id) store.setChecked(site.id, judgedNow.size, err.message);
      if (sites.length === 1) throw err;
      warn(`\n[${site.name}] stopped: ${err.message}`);
    }
  }
  return counts;
}

/** A judged post as it is recorded, with its link when kept. Returns where a kept post leads. */
async function saveJudged({ site, adapter, post, performer, row, files, score, judge }) {
  const kept = score >= judge.threshold;
  const target = kept ? await adapter.page(post, performer) : null;
  if (!kept && !LIMITS.keepRejectedImages) for (const f of files) fs.rmSync(f, { force: true });
  const keepFiles = kept || LIMITS.keepRejectedImages;
  store.save({
    ...row,
    info: { ...row.info, judged_on: files.length, post: undefined, performer: undefined },
    page_kind: target?.kind ?? null,
    performer_name: target?.name ?? row.performer_name,
    saved_link: target?.link ?? null,
    image_path: keepFiles ? rel(files[0]) : null,
    image_paths: keepFiles ? files.map(rel) : null,
    score,
    kept: kept ? 1 : 0,
    model: judge.file,
  });
  if (target?.profileId) await saveCreatorData({ site, adapter, profileId: target.profileId });
  return target;
}

/** Judges what was saved while nobody could. Stops at the first post that has to wait again. */
async function judgeWaiting({ sites, judge, http }) {
  const counts = { kept: 0, rejected: 0, skipped: 0, seen: 0, waiting: 0 };
  const watcherOf = (name, kind) => sites.find((s) => s.name === name && (s.kind || 'posts') === kind) || WATCHERS.find((s) => s.name === name && s.kind === kind);
  const posts = store.waitingPosts(), profiles = store.waitingProfiles();
  if (!posts.length && !profiles.length) return counts;
  say(`Judging what was waiting: ${posts.length} posts, ${profiles.length} profiles`);
  const pictures = (x) => (x.image_paths || [x.image_path]).filter(Boolean).map(abs).filter((f) => fs.existsSync(f));
  for (const row of posts) {
    if (stopped()) return counts;
    const site = watcherOf(row.site, 'posts');
    const adapter = site && ADAPTERS[site.adapter]?.(site, http);
    const files = pictures(row);
    if (!adapter || !files.length) {
      store.save({ ...row, waiting: 0, skip_reason: 'its pictures are gone' });
      counts.skipped++;
      continue;
    }
    const post = row.info?.post || { title: row.title, postUrl: row.post_url, shareUrl: row.share_url, postId: row.post_id };
    try {
      const { score } = await judge.score(files);
      await saveJudged({ site, adapter, post, performer: row.info?.performer || null, row: { ...row, waiting: 0 }, files, score, judge });
      counts[score >= judge.threshold ? 'kept' : 'rejected']++;
    } catch (err) {
      if (err.waiting) { counts.waiting = posts.length; return counts; }
      store.save({ ...row, waiting: 0, skip_reason: `picture could not be read: ${err.message}` });
      counts.skipped++;
    }
  }
  for (const p of profiles) {
    if (stopped()) return counts;
    const files = pictures(p);
    if (!files.length) {
      // Its pictures are gone: no longer waiting, not judged, so the next profiles scan judges it again
      store.saveProfileJudgment({ ...p, waiting: 0, score: null, kept: null, image_path: null, image_paths: null, judged_at: null });
      counts.skipped++;
      continue;
    }
    try {
      const { score } = await judge.score(files);
      const kept = score >= judge.threshold;
      store.saveProfileJudgment({ ...p, score, kept: kept ? 1 : 0, waiting: 0, model: judge.file, judged_at: null });
      counts[kept ? 'kept' : 'rejected']++;
      const site = watcherOf(p.site, 'profiles');
      if (kept && site) await saveCreatorData({ site, adapter: ADAPTERS[site.adapter]?.(site, http), profileId: p.profile_id });
    } catch (err) {
      if (err.waiting) { counts.waiting = profiles.length; return counts; }
      warn(`  ${p.name}: ${err.message}`);
    }
  }
  return counts;
}

/**
 * Tries again the posts skipped for a passing reason (a picture or page that did not load, a picture P could not read), up
 * to RETRIES times in all; after that the reason says it gave up. A post nobody can judge right now ends the pass and stays
 * as it is for the next run.
 */
async function retrySkipped({ sites, judge, http }) {
  const counts = { kept: 0, rejected: 0, skipped: 0, seen: 0, waiting: 0 };
  const names = new Set(sites.map((s) => s.name));
  const rows = store.retryPosts().filter((r) => names.has(r.site));
  if (!rows.length) return counts;
  say(`Trying again what did not load: ${rows.length} post${rows.length > 1 ? 's' : ''}`);
  for (const row of rows) {
    if (stopped()) return counts;
    const site = sites.find((s) => s.name === row.site);
    const adapter = ADAPTERS[site.adapter]?.(site, http);
    if (!adapter) continue;
    const { retry, ...info } = row.info;
    const post = retry.post || { postId: row.post_id, title: row.title, postUrl: row.post_url, shareUrl: row.share_url, image: row.image_url };
    let performer = retry.performer || null;
    // Another failure: counted, and given up on at the last try
    const failed = (reason, err) => {
      const attempts = (retry.attempts || 1) + 1;
      const last = attempts >= RETRIES;
      warn(`  ${post.title}: ${reason}: ${err.message}${last ? ' (gave up)' : ''}`);
      store.save({
        ...row,
        info: last ? info : { ...info, retry: { ...retry, attempts } },
        skip_reason: `${reason}: ${err.message} (${last ? `gave up after ${RETRIES} tries` : `tried ${attempts} of ${RETRIES}`})`,
      });
      counts.skipped++;
    };
    if (adapter.resolve && !performer) {
      try {
        performer = await adapter.resolve(post);
      } catch (err) { failed('page could not be read', err); continue; }
      if (!performer) { store.save({ ...row, info, skip_reason: 'no performer linked on its page' }); counts.skipped++; continue; }
    }
    let files;
    try {
      files = await downloadPost(http, site, post, performer);
    } catch (err) { failed('picture download failed', err); continue; }
    let score;
    try {
      ({ score } = await judge.score(files));
    } catch (err) {
      if (err.waiting) { counts.waiting++; return counts; }
      failed('picture could not be read', err);
      continue;
    }
    const base = { ...row, info, skip_reason: null, waiting: 0, performer_name: performer?.name ?? row.performer_name };
    const target = await saveJudged({ site, adapter, post, performer, row: base, files, score, judge });
    counts[score >= judge.threshold ? 'kept' : 'rejected']++;
    say(`  ${score >= judge.threshold ? 'KEEP' : '    '} ${score.toFixed(1).padStart(5)}  ${post.title}${target ? `  → ${target.kind}: ${target.link}` : ''}`);
  }
  return counts;
}

/** Saves a creator's whole profile for the profile page, unless it was saved in the last 30 days. */
async function saveCreatorData({ site, adapter, profileId, fallback = null }) {
  const have = store.profile(site.name, profileId);
  if (have?.full && Date.now() - new Date(have.data_at) < 30 * 864e5) return;
  try {
    const data = await adapter.profileDetails(profileId);
    if (!data?.name) throw new Error('empty profile');
    const scrape = adapter.toScrapeResult(data);
    store.saveProfileData({ site: site.name, profile_id: profileId, name: data.name, url: scrape.url, image_url: data.media?.url, scrape, full: true });
  } catch (err) {
    if (fallback) store.saveProfileData({ site: site.name, profile_id: profileId, ...fallback, full: false });
    warn(`  profile ${profileId}: ${err.message}`);
  }
}

/**
 * Judges the creator profiles (leakshaven.com/models) on their profile picture and saves their data. Every profile
 * keeps what the profile list gives; the whole profile is read for the kept ones (details 'kept') or for all
 * (details 'all'). A profile judged before is skipped, so a stopped run goes on where it was.
 */
async function scanProfiles({ sites, judge, http, details = 'kept', maxProfiles = Infinity }) {
  const counts = { kept: 0, rejected: 0, skipped: 0, seen: 0, waiting: 0 };
  let budget = maxProfiles;
  let failure = null;   // one site failing leaves the others to run; a run of that site alone stops with its error
  for (const site of sites) {
    if (stopped()) break;
    const adapter = ADAPTERS[site.adapter]?.(site, http);
    if (!adapter?.listProfiles) continue;
    const dir = path.join(CACHE, site.name, '_profiles');
    fs.mkdirSync(dir, { recursive: true });
    // Where the last run got to in the list: a stopped run goes on from there instead of reading every page again
    // (the list API throttles a quick walk). A finished pass starts over at the top, for the new profiles.
    const at = `${site.name}:profiles`;
    let { cursor, pages: done } = store.backlog(at);
    if (cursor) say(`Going on from profiles page ${done + 1}`);
    let found = 0;
    try {
      for (let page = done + 1; budget > 0 && !stopped(); page++) {
        const { profiles, next, total } = await adapter.listProfiles(cursor, site.profileSorting);
        say(`\n[${site.name}] profiles page ${page}${total ? ` of ${Math.ceil(total / 30)}` : ''}`);
        for (const p of profiles) {
          if (stopped()) break;
          const have = store.profile(site.name, p.profileId);
          if (have?.score != null || have?.waiting) {
            // Judged before; with details 'all' a profile that has only the list's data gets its whole profile now
            if (details === 'all' && !have.full) await saveCreatorData({ site, adapter, profileId: p.profileId });
            counts.seen++;
            continue;
          }
          if (budget <= 0) break;
          budget--;
          found++;
          const base = { site: site.name, profile_id: p.profileId, name: p.name, url: p.url };
          const listData = { name: p.name, url: p.url, image_url: p.image, scrape: adapter.toScrapeResult(p.data) };
          if (!p.image) { store.saveProfileData({ ...base, ...listData, full: false }); counts.skipped++; continue; }

          // Her profile picture, and the pictures of her own posts when the adapter can list them (Leakgallery: her
          // page's latest posts), up to picturesPerPost, judged together
          let more = [];
          if (adapter.profilePictures) {
            try { more = await adapter.profilePictures(p); } catch (err) { warn(`  ${p.name}: her posts' pictures: ${err.message}`); }
          }
          const urls = [...new Set([p.image, ...more])].slice(0, LIMITS.picturesPerPost);
          let files, score;
          try {
            files = await downloadPictures(http, urls, dir, `${slug(p.name)}-${String(p.profileId).slice(0, 8)}`);
            ({ score } = await judge.score(files));
          } catch (err) {
            store.saveProfileData({ ...base, ...listData, full: false });
            if (err.waiting) {
              store.saveProfileJudgment({ ...base, image_url: p.image, image_path: rel(files[0]), image_paths: files.map(rel), waiting: 1, judged_at: new Date().toISOString() });
              counts.waiting++;
              continue;
            }
            warn(`  ${p.name}: ${err.message}`);
            counts.skipped++;
            continue;
          }
          const kept = score >= judge.threshold;
          if (!kept && !LIMITS.keepRejectedImages) for (const f of files) fs.rmSync(f, { force: true });
          const keepFiles = kept || LIMITS.keepRejectedImages;
          store.saveProfileJudgment({ ...base, image_url: p.image, image_path: keepFiles ? rel(files[0]) : null, image_paths: keepFiles ? files.map(rel) : null, score, kept: kept ? 1 : 0, model: judge.file });
          if (kept || details === 'all') await saveCreatorData({ site, adapter, profileId: p.profileId, fallback: listData });
          else store.saveProfileData({ ...base, ...listData, full: false });
          counts[kept ? 'kept' : 'rejected']++;
          say(`  ${kept ? 'KEEP' : '    '} ${score.toFixed(1).padStart(5)}  ${p.name}${files.length > 1 ? ` (${files.length} pictures)` : ''}`);
        }
        if (stopped()) break;
        if (budget > 0) store.setBacklog(at, next, next ? page : 0);   // a page cut short by maxProfiles is read again
        if (!next) { say('  end of the profiles'); break; }
        cursor = next;
      }
    } catch (err) {
      if (site.id) store.setChecked(site.id, found, err.message);
      warn(`\n[${site.name}] profiles stopped: ${err.message}`);
      failure = err;
      continue;
    }
    if (site.id) store.setChecked(site.id, found);
  }
  if (failure && sites.length === 1) throw failure;
  return counts;
}

/** The results as they stand, with everything the store holds */
const currentResults = (library = loadLibrary()) => buildResults(store.allPosts(), library, { threshold: threshold(), watchers: WATCHERS, ...storedState(store) }, store.allProfiles());

/**
 * The P model on all of a performer's pictures together (what it was fitted for: a performer's gallery), for every
 * performer with two or more cached pictures whose pictures have no pool score yet (a new member, a combine). Her
 * score stays her best single one; a liked performer whose pool falls below the line shows in Duplicates.
 */
async function scorePools({ library, judge }) {
  const pending = currentResults(library).everyone.filter((g) => g.pool_pending);
  if (!pending.length) return;
  say(`\nPictures together: ${pending.length} performer${pending.length > 1 ? 's' : ''} to score`);
  let fell = 0;
  for (const g of pending) {
    if (stopped()) return;
    const pool = poolOf(g.members);
    const images = pool.images.map(abs).filter((f) => fs.existsSync(f));
    if (images.length < 2) continue;
    try {
      const { score } = await judge.score(images);
      store.savePool(pool.signature, score, images.length, judge.file);
      if (g.kept && score < judge.threshold) fell++;
    } catch (err) {
      if (err.waiting) return;
      warn(`  ${g.names[0]}: ${err.message}`);
    }
  }
  say(`  done${fell ? `; ${fell} liked performer${fell > 1 ? 's' : ''} below the line together (Duplicates: keep or drop)` : ''}`);
}

/**
 * Judges every cached picture again with the current model (after the model was retrained). What the current model judged
 * already is left alone, so a paused Re-judge goes on with the ones left. Returns { counts, finished }: finished when it got
 * through all of them (not paused, nobody away).
 */
async function rescore({ sites, judge, http }) {
  const counts = { kept: 0, rejected: 0, skipped: 0, seen: 0, waiting: 0 };
  const adapters = Object.fromEntries(sites.map((s) => [s.name, ADAPTERS[s.adapter]?.(s, http)]));
  const pictures = (x) => (x.image_paths || [x.image_path]).filter(Boolean).map(abs).filter((f) => fs.existsSync(f));   // all it was judged on
  const away = () => { say('Re-judge: nobody can judge right now, stopped'); return { counts, finished: false }; };
  for (const post of store.allPosts().filter((p) => p.score != null && pictures(p).length)) {
    if (stopped()) return { counts, finished: false };
    if (post.model === judge.file) { counts.seen++; continue; }
    try {
      const { score } = await judge.score(pictures(post));
      const kept = score >= judge.threshold;
      let target = null;
      if (kept && !post.page_kind) target = await adapters[post.site]?.page({ postId: post.post_id, title: post.title, postUrl: post.post_url, shareUrl: post.share_url });
      store.save({
        ...post,
        score,
        kept: kept ? 1 : 0,
        model: judge.file,
        page_kind: kept ? target?.kind ?? post.page_kind : null,
        performer_name: target?.name ?? post.performer_name,
        saved_link: kept ? target?.link ?? post.saved_link : null,
      });
      counts[kept ? 'kept' : 'rejected']++;
      say(`  ${kept ? 'KEEP' : '    '} ${score.toFixed(1).padStart(5)}  ${post.title}${post.score != null ? `  (was ${post.score.toFixed(1)})` : ''}`);
    } catch (err) {
      if (err.waiting) return away();
      warn(`  ${post.title}: ${err.message}`);
    }
  }
  for (const p of store.allProfiles().filter((x) => x.score != null && pictures(x).length)) {
    if (stopped()) return { counts, finished: false };
    if (p.model === judge.file) { counts.seen++; continue; }
    try {
      const { score } = await judge.score(pictures(p));
      const kept = score >= judge.threshold;
      store.saveProfileJudgment({ ...p, score, kept: kept ? 1 : 0, model: judge.file });
      counts[kept ? 'kept' : 'rejected']++;
      say(`  ${kept ? 'KEEP' : '    '} ${score.toFixed(1).padStart(5)}  profile ${p.name}  (was ${p.score?.toFixed(1)})`);
    } catch (err) {
      if (err.waiting) return away();
      warn(`  profile ${p.name}: ${err.message}`);
    }
  }
  return { counts, finished: !stopped() };
}

/**
 * The posts watchers an Older posts run reads, in the order it reads them: the ones not read to the end yet, starting with
 * the one after where the last run started (backlogNext), so every site gets its turn at the run's posts.
 */
function backlogSites(watchers = WATCHERS) {
  const list = watchers.filter((w) => w.kind === 'posts' && w.enabled !== false && w.watch !== false && !store.setting(`backlogDone:${w.name}`, null));
  if (!list.length) return [];
  const start = (Number(store.setting('backlogNext', 0)) || 0) % list.length;
  return [...list.slice(start), ...list.slice(0, start)];
}

/**
 * One run. mode: scan (the watchers on watch), watcher (one, options.watcher), profiles (the profiles watchers), backlog
 * (older posts), rescore (every cached picture again), pools (the pictures together alone). Whatever stops the reading, the
 * steps after it (the pictures together, the profile page's events) still run; then the run ends with that error.
 */
async function run(mode = 'scan', options = {}) {
  const chosen = WATCHERS.filter((w) => w.enabled !== false && (mode !== 'watcher' || w.id === options.watcher));
  if (mode === 'watcher' && !chosen.length) throw new Error(`No watcher "${options.watcher}"`);
  const onWatch = mode === 'scan';
  const pick = (kind) => chosen.filter((w) => w.kind === kind && (!onWatch || w.watch !== false));
  const postWatchers = mode === 'profiles' ? [] : mode === 'backlog' ? backlogSites(chosen) : pick('posts');
  const profileWatchers = mode === 'backlog' ? [] : pick('profiles');
  const library = loadLibrary();
  say(`Library: ${library.size} performers`);

  const judge = createJudge({ threshold: options.threshold ?? threshold() });
  await judge.prepare();
  const http = createHttp({ ...LIMITS, flareSolverrUrl: flareSolverrUrl() });
  const needFlare = [...postWatchers, ...profileWatchers].filter((w) => w.flaresolverr);
  if (needFlare.length && !(await http.flareAvailable())) {
    warn(`FlareSolverr is not answering at ${flareSolverrUrl()}: ${needFlare.map((w) => w.label).join(', ')} will stop at the Cloudflare check.`);
  }
  const counts = { kept: 0, rejected: 0, skipped: 0, seen: 0, waiting: 0 };
  const add = (c) => { for (const k in counts) counts[k] += c[k]; };
  let failure = null;
  try {
    if (mode === 'rescore') {
      const done = await rescore({ sites: chosen, judge, http });
      add(done.counts);
      // the pictures together of the other models, judged again below with the new scores' model, once every picture was
      if (done.finished) store.clearPoolsExcept(judge.file);
    } else if (mode !== 'pools') {
      add(await judgeWaiting({ sites: chosen, judge, http }));
      if (postWatchers.length) add(await retrySkipped({ sites: postWatchers, judge, http }));
      const limits = { maxPages: options.maxPages, maxPosts: options.maxPosts };
      if (mode === 'backlog') {
        if (!postWatchers.length) say('Older posts: every site was read to the end');
        // the next Older posts run starts with the site after this one
        else store.setSetting('backlogNext', ((Number(store.setting('backlogNext', 0)) || 0) % postWatchers.length + 1) % postWatchers.length);
      }
      if (postWatchers.length) add(await scan({ sites: postWatchers, judge, http, backlog: mode === 'backlog', limits }));
      if (profileWatchers.length) add(await scanProfiles({ sites: profileWatchers, judge, http, details: options.profileDetails || 'kept', maxProfiles: options.maxProfiles ?? Infinity }));
    }
  } catch (err) {
    failure = err;
  }
  if (mode !== 'pools') say(`\nThis run: ${counts.kept} kept, ${counts.rejected} not kept, ${counts.skipped} skipped, ${counts.seen} already judged${counts.waiting ? `, ${counts.waiting} waiting for P` : ''}`);
  try {
    await scorePools({ library, judge });
  } catch (err) {
    warn(`Pictures together: ${err.message}`);
  }
  say(judge.summary());
  let updates = 0;
  try {
    ({ updates } = runEvents(currentResults(library).everyone));
  } catch (err) {
    warn(`Profile page updates: ${err.message}`);
  }
  try {
    const { sent, failed } = await sendQueued();
    if (updates || sent || failed) say(`Profile page: ${updates} update${updates === 1 ? '' : 's'}; ${sent} sent${failed ? `, ${failed} not (tried again next run)` : ''}`);
  } catch (err) {
    warn(`Profile page: ${err.message}`);
  }
  if (failure) throw failure;
  return { counts, secondsPerPicture: judge.secondsPerPicture() };
}

module.exports = { run, scan, judgeWaiting, retrySkipped, currentResults, threshold, backlogSites, ADAPTERS };
