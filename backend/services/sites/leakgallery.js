/**
 * Leakgallery (leakgallery.com), read from its pages. The site is an Angular app rendered on the server, and every
 * page carries the API answers it was built from as JSON (<script id="ng-state">), so a page read over plain HTTP
 * gives the data without calling api.leakgallery.com (which wants a short-lived app token):
 *   - /trending-profiles/<period> (12-Hours, Day, …) holds "httpGet:popular/profile/<period>": the trending
 *     profiles, { username, profile_pic, banner_pic }, 40 of them, no paging;
 *   - /<username> holds "httpGet:profile/<username>?…": { profile: { username, seo_name, old_usernames,
 *     subscribers, creator_link, … }, medias: [...] }.
 * A profile is judged on its profile picture and the pictures of her latest posts on her page (medias, file_path on
 * cdn.leakgallery.com; videos left out), together, up to picturesPerPost.
 */
const SITE = 'https://leakgallery.com';

const profileUrl = (username) => `${SITE}/${encodeURIComponent(username)}`;
const isPicture = (url) => /\.(webp|jpe?g|png|gif|avif)(\?|$)/i.test(url || '');
const titleCase = (s) => String(s).replace(/\b\w/g, c => c.toUpperCase());

/** The API answers a page was rendered from: { "<method>:<path>": answer }. */
function pageState(html) {
  const m = html.match(/<script id="ng-state" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) throw new Error('no ng-state in the page: the site changed');
  const state = JSON.parse(m[1]);
  return (prefix) => {
    const key = Object.keys(state).find(k => k.startsWith(prefix));
    return key ? (state[key]?.b ?? state[key]) : null;
  };
}

function createLeakgallery(site, http) {
  const period = site.period || '12-Hours';
  const page = async (path) => pageState(await http.text(`${SITE}${path}`));
  // Her page, read once a run: for her posts' pictures when she is judged, and her profile when she is kept
  const profilePages = new Map();
  const profileAnswer = (username) => {
    if (!profilePages.has(username)) profilePages.set(username, page(`/${encodeURIComponent(username)}`).then(get => get(`httpGet:profile/${username}`)));
    return profilePages.get(username);
  };

  /** Leakgallery's profile in the app's scrape shape: name and aliases (it has no age, height and the like). */
  function toScrapeResult(data) {
    const p = data.profile || data;
    const aliases = [p.seo_name && titleCase(p.seo_name), p.username, ...String(p.old_usernames || '').split(',')]
      .map(a => String(a || '').trim()).filter(Boolean);
    return {
      name: p.seo_name ? titleCase(p.seo_name) : p.username,
      url: profileUrl(p.username),
      profile: {},
      aliases: [...new Map(aliases.map(a => [a.toLowerCase(), a])).values()],
      tags: []
    };
  }

  return {
    name: site.name,

    /** The trending profiles of the period (one page: the site shows 40 and does not page). */
    async listProfiles() {
      const list = (await page(`/trending-profiles/${encodeURIComponent(period)}`))(`httpGet:popular/profile/${period}`) || [];
      return {
        total: list.length,
        next: null,
        profiles: list.filter(p => p.username).map(p => ({
          profileId: p.username, name: p.username, url: profileUrl(p.username),
          image: isPicture(p.profile_pic) ? p.profile_pic : null, data: p
        }))
      };
    },

    /** The whole profile, from her page; shaped like the Leakhaven one ({ name, media: { url } }) for the scanner. */
    /** The pictures of her latest posts (her page lists 40; videos left out), to judge with her profile picture. */
    async profilePictures(p) {
      const medias = (await profileAnswer(p.profileId))?.medias || [];
      return medias.filter(m => !m.is_video && m.file_path && isPicture(m.file_path)).map(m => `https://cdn.leakgallery.com/${m.file_path}`);
    },

    async profileDetails(username) {
      const answer = await profileAnswer(username);
      const p = answer?.profile;
      if (!p) return null;
      return { ...answer, name: toScrapeResult(answer).name, media: { url: p.profile_pic } };
    },

    toScrapeResult
  };
}

module.exports = { createLeakgallery };
