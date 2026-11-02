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

const ADAPTERS = { leakshaven: createLeakshaven, leakgallery: createLeakgallery, fapello: createFapello, 'kvs-albums': createKvsAlbums, porn4fans: createPorn4fans, pimpbunny: createPimpbunny };

/** The keep line; a setting of its own */
const threshold = () => store.setting('threshold', 50);

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

/**
 * Judges the posts not judged yet; returns this run's counts. A watch scan starts at the newest post and stops at
 * the first post it had judged before: the newest one of the last scan (the listings are newest first), below
 * which everything was judged then. A backlog scan goes on from the oldest page any backlog scan reached, further
 * into the past, past what it judged before.
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
    const adapter = ADAPTERS[site.adapter]?.(site, http);
    if (!adapter) { warn(`No adapter "${site.adapter}" for site ${site.name}`); continue; }
    const start = backlog ? store.backlog(site.name) : { cursor: null, pages: 0 };
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
        if (!posts.length) { say('  no posts'); break; }
        // An adapter whose next page is the first one again would judge the top forever
        if (page > 0 && posts.every((p) => firstPage.has(p.postId))) throw new Error(`[${site.name}] the next page repeats the first: the adapter does not page.`);
        if (page === 0) posts.forEach((p) => firstPage.add(p.postId));

        let lastScan = null;
        for (const post of posts) {
          if (stopped()) break;
          // Listings paged by number shift down while they are read (a new post pushes the last one of a page to
          // the top of the next): a post judged earlier in this run is passed over, only one from before stops it
          if (judgedNow.has(post.postId)) continue;
          if (store.seen(site.name, post.postId)) {
            if (!backlog) { lastScan = post; break; }
            counts.seen++;
            continue;
          }
          judgedNow.add(post.postId);
          if (counted && budget <= 0) break;
          if (counted) budget--;
          const row = { site: site.name, post_id: post.postId, short_code: post.shortCode, title: post.title, post_url: post.postUrl, share_url: post.shareUrl, performer_name: post.title, info: post.info, posted_at: post.createdAt, image_url: post.image };
          const skip = (reason, extra = {}) => { store.save({ ...row, ...extra, skip_reason: reason }); counts.skipped++; };
          if (!post.image) { skip(post.skipReason || 'no picture'); continue; }

          // An adapter whose listing does not say who a post is of (an album: the models its page links) is asked
          // first; a post of nobody is skipped before its picture, so it never becomes a performer
          let performer = null;
          if (adapter.resolve) {
            try {
              performer = await adapter.resolve(post);
            } catch (err) {
              warn(`  ${post.title}: page could not be read: ${err.message}`);
              skip(`page could not be read: ${err.message}`);
              continue;
            }
            if (!performer) { skip('no performer linked on its page'); say(`        -  ${post.title}  (no performer linked)`); continue; }
            row.performer_name = performer.name;
          }

          // Only the post's own pictures (its card's, its album's): the other posts on a creator page, even ones under
          // her name, can be of someone else. Up to picturesPerPost of them, judged together.
          const urls = [...new Set([post.image, ...(post.images || []), ...(performer?.images || [])].filter(Boolean))].slice(0, LIMITS.picturesPerPost);
          const dir = path.join(CACHE, site.name, slug(post.title));
          let files;
          try {
            files = await downloadPictures(http, urls, dir, slug(post.postId));
          } catch (err) {
            warn(`  ${post.title}: picture failed: ${err.message}`);
            skip(`picture download failed: ${err.message}`);
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
            skip(`picture could not be read: ${err.message}`, { image_path: rel(files[0]) });
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
        if (backlog && budget > 0) store.setBacklog(site.name, next, start.pages + page + 1);   // a page cut short by maxPosts is read again next time
        if (!next) { say('  end of the listing'); caughtUp = true; break; }
        cursor = next;
      }
      if (catchUp && !caughtUp && page >= maxPages) warn(`  [${site.name}] stopped after ${page} pages before reaching the last scan: the posts in between are for the backlog (Older posts)`);
      if (site.id) store.setChecked(site.id, judgedNow.size);
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
    if (!files.length) continue;
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
  for (const site of sites) {
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
      throw err;
    }
    if (site.id) store.setChecked(site.id, found);
  }
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

/** Judges every cached picture again with the current model (after the model was retrained). */
async function rescore({ sites, judge, http }) {
  const counts = { kept: 0, rejected: 0, skipped: 0, seen: 0, waiting: 0 };
  const adapters = Object.fromEntries(sites.map((s) => [s.name, ADAPTERS[s.adapter]?.(s, http)]));
  const pictures = (x) => (x.image_paths || [x.image_path]).filter(Boolean).map(abs).filter((f) => fs.existsSync(f));   // all it was judged on
  for (const post of store.allPosts().filter((p) => p.score != null && pictures(p).length)) {
    if (stopped()) return counts;
    const { score } = await judge.score(pictures(post));
    const kept = score >= judge.threshold;
    let target = null;
    if (kept && !post.page_kind) target = await adapters[post.site]?.page({ title: post.title, postUrl: post.post_url, shareUrl: post.share_url });
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
  }
  for (const p of store.allProfiles().filter((x) => x.score != null && pictures(x).length)) {
    if (stopped()) return counts;
    const { score } = await judge.score(pictures(p));
    const kept = score >= judge.threshold;
    store.saveProfileJudgment({ ...p, score, kept: kept ? 1 : 0, model: judge.file });
    counts[kept ? 'kept' : 'rejected']++;
    say(`  ${kept ? 'KEEP' : '    '} ${score.toFixed(1).padStart(5)}  profile ${p.name}  (was ${p.score?.toFixed(1)})`);
  }
  return counts;
}

/**
 * One run. mode: scan (the watchers on watch), watcher (one, options.watcher), profiles (the profiles watchers), backlog
 * (older posts), rescore (every cached picture again), pools (the pictures together alone).
 */
async function run(mode = 'scan', options = {}) {
  const chosen = WATCHERS.filter((w) => w.enabled !== false && (mode !== 'watcher' || w.id === options.watcher));
  if (mode === 'watcher' && !chosen.length) throw new Error(`No watcher "${options.watcher}"`);
  const onWatch = mode === 'scan';
  const pick = (kind) => chosen.filter((w) => w.kind === kind && (!onWatch || w.watch !== false));
  const postWatchers = mode === 'profiles' ? [] : pick('posts');
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
  if (mode === 'rescore') {
    add(await rescore({ sites: chosen, judge, http }));
    store.clearPools();   // the pictures together, judged again below with the new scores' model
  } else if (mode !== 'pools') {
    add(await judgeWaiting({ sites: chosen, judge, http }));
    const limits = { maxPages: options.maxPages, maxPosts: options.maxPosts };
    if (postWatchers.length) add(await scan({ sites: postWatchers, judge, http, backlog: mode === 'backlog', limits }));
    if (profileWatchers.length) add(await scanProfiles({ sites: profileWatchers, judge, http, details: options.profileDetails || 'kept', maxProfiles: options.maxProfiles ?? Infinity }));
  }
  if (mode !== 'pools') say(`\nThis run: ${counts.kept} kept, ${counts.rejected} not kept, ${counts.skipped} skipped, ${counts.seen} already judged${counts.waiting ? `, ${counts.waiting} waiting for P` : ''}`);
  await scorePools({ library, judge });
  say(judge.summary());
  const results = currentResults(library);
  const { updates } = runEvents(results.everyone);
  const { sent, failed } = await sendQueued();
  if (updates || sent || failed) say(`Profile page: ${updates} update${updates === 1 ? '' : 's'}; ${sent} sent${failed ? `, ${failed} not (tried again next run)` : ''}`);
  return { counts, secondsPerPicture: judge.secondsPerPicture() };
}

module.exports = { run, scan, judgeWaiting, currentResults, threshold, ADAPTERS };
