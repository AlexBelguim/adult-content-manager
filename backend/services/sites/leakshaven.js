/**
 * Leakhaven (leakshaven.com), read from the same public JSON API as the app's scraper
 * (backend/services/scraperService.js):
 *   - api.leakshaven.com/content?count=&sorting=NEWEST&cursor= lists the newest posts, 30 at most per page; the
 *     home grid is this list. A post has one preview picture (media).
 *   - api.leakshaven.com/content?search=<title>&count=1 resolves a post's title to the creator profile it
 *     belongs to (richProfileName), the same search the site runs.
 * A post's + button opens leakshaven.com/?leak=<id>, one of two kinds of page:
 *   - creator: the post belongs to a profile; the page shows it with "Open Creator" → /model/<profile name>.
 *     That link is the one saved. Only the post's own picture is judged: the page's other posts can be of
 *     someone else, even the ones under her name (the site's search mixes people up).
 *   - post: no profile, only the post. Its "Link openen" button costs one of the account's daily keys, so the
 *     scanner never opens it: it saves the post's share link, s.leakshaven.com/<shortCode> (the post's info
 *     dialog shows it), which leads to the post without spending a key.
 * Every post keeps its share link and its ?leak= page either way.
 * The creator profiles (leakshaven.com/models) are listed by api.leakshaven.com/profile/list, and judged the same way.
 */
const { cleanScrapeResult, formatHeight, formatWeight } = require('../../utils/scraperNormalizer');

const SITE = 'https://leakshaven.com';
const API = 'https://api.leakshaven.com';

const modelUrl = (name) => `${SITE}/model/${encodeURIComponent(name)}`;
const isPicture = (url) => /\.(webp|jpe?g|png|gif|avif)(\?|$)/i.test(url || '');

function createLeakshaven(site, http) {
  const pageSize = Math.min(site.pageSize || 30, 30);   // the API answers 400 above 30
  const sorting = site.sorting || 'NEWEST';
  const profiles = new Map();

  return {
    name: site.name,

    /**
     * One page of the newest posts, from cursor (null = the top). The answer's cursorId (the last post's id) goes
     * back as ?cursor= for the next page, as the site's grid does when it is scrolled.
     */
    async listPage(cursor) {
      const query = `count=${pageSize}&sorting=${encodeURIComponent(sorting)}` + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : '');
      const { content = [], cursorId = null } = await http.json(`${API}/content?${query}`);
      const next = content.length && cursorId && cursorId !== cursor ? cursorId : null;
      const posts = content.map(item => ({
        postId: item.id,
        shortCode: item.shortCode || null,
        title: item.title || '',
        postUrl: `${SITE}/?leak=${item.id}`,
        shareUrl: item.shortCode ? `https://s.leakshaven.com/${item.shortCode}` : null,
        createdAt: item.createdAt || null,
        info: { images: item.info?.images ?? null, videos: item.info?.videos ?? null, size_gb: item.info?.size ? Math.round(item.info.size / 1e9) : null, trending: !!item.isTrending },
        image: !item.deleted && isPicture(item.media) ? item.media : null,
        skipReason: item.deleted ? 'deleted' : isPicture(item.media) ? null : `no preview picture (${item.mediaType})`
      }));
      return { posts, next };
    },

    /**
     * What the post's + page is: { kind: 'creator', name, profileId, link } when its title belongs to a creator profile
     * (link = Open Creator), else { kind: 'post', name: title, link: the share link }.
     */
    async page(post) {
      if (!profiles.has(post.title)) {
        try {
          const { richProfileName = null, richProfileId = null } = await http.json(`${API}/content?search=${encodeURIComponent(post.title)}&count=1`);
          profiles.set(post.title, richProfileName && { name: richProfileName, id: richProfileId });
        } catch (err) {
          warn(`  could not look up the profile of "${post.title}": ${err.message}`);
          return { kind: 'unknown', name: post.title, link: post.postUrl };
        }
      }
      const profile = profiles.get(post.title);
      return profile
        ? { kind: 'creator', name: profile.name, profileId: profile.id, link: modelUrl(profile.name) }
        : { kind: 'post', name: post.title, link: post.shareUrl || post.postUrl };
    },

    /**
     * One page of the creator profiles (leakshaven.com/models): api.leakshaven.com/profile/list, 30 a page. Unlike
     * the posts it pages with ?cursorId= (as the models page does when scrolled). A profile comes with one picture and part of its data (aliases, nationality, ethnicity,
     * birth date, socials); profileDetails has the rest.
     */
    async listProfiles(cursor, profileSorting = 'hot') {
      const query = `count=${pageSize}&sorting=${encodeURIComponent(profileSorting)}` + (cursor ? `&cursorId=${encodeURIComponent(cursor)}` : '');
      const { profiles: list = [], cursorId = null, total = null } = await http.json(`${API}/profile/list?${query}`);
      return {
        total,
        next: list.length && cursorId && cursorId !== cursor ? cursorId : null,
        profiles: list.map(p => ({ profileId: p.id, name: p.name, url: modelUrl(p.name), image: isPicture(p.media?.url) ? p.media.url : null, data: p }))
      };
    },

    /** The whole profile, as the model page shows it (the app's scraper reads the same). */
    profileDetails: (profileId) => http.json(`${API}/profile/${encodeURIComponent(profileId)}`),

    toScrapeResult
  };
}

// ── A profile in the app's scrape shape ──
// The same mapping as toScrapeResult in backend/services/scraperService.js, then the app's own cleanScrapeResult,
// so the result can go straight to POST /api/performers/:id/scrape/accept

const titleCase = (s) => s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
const tagLabel = (tag) => titleCase(String(tag).replace(/^(PROFESSION|CATEGORY)_/, '').replace(/_/g, ' '));

function ageFrom(birthDate) {
  const born = new Date(birthDate);
  if (isNaN(born)) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - born.getUTCFullYear();
  if (now.getUTCMonth() < born.getUTCMonth() || (now.getUTCMonth() === born.getUTCMonth() && now.getUTCDate() < born.getUTCDate())) age--;
  return age;
}

function toScrapeResult(data) {
  const e = data.enhanced || {};
  const fake = e.boobsType ? e.boobsType !== 'Natural' : null;
  return cleanScrapeResult({
    name: data.name,
    url: modelUrl(data.name),
    profile: {
      age: e.birthDate ? ageFrom(e.birthDate) : null,
      born: e.birthDate ? e.birthDate.slice(0, 10) : null,
      birthplace: e.placeOfBirth,
      country_flag: e.nationality?.[0]?.toLowerCase(),
      height: e.heightCm ? formatHeight(e.heightCm) : null,
      weight: e.weightKg ? formatWeight(e.weightKg) : null,
      measurements_cup: e.cupSize ? `${e.cupSize}${fake === null ? '' : fake ? ' (Fake)' : ' (Natural)'}` : null,
      measurements_band_size: e.cupSize?.match(/^\d+/)?.[0],
      measurements_fake: fake === null ? null : fake ? 1 : 0,
      hair_color: e.hairColor,
      eye_color: e.eyeColor,
      ethnicity: e.ethnicity === 'Caucasian' ? 'White' : e.ethnicity,
      body_type: e.bodyType,
      orientation: e.sexuality
    },
    aliases: e.alias || [],
    tags: (e.tags || []).map(tagLabel)
  });
}

module.exports = { createLeakshaven };
