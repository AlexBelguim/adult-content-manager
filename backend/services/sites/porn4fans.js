/**
 * Porn4Fans (www.porn4fans.com/models/?p=date_of_first_video), read from its pages (a KVS site, server-rendered):
 *   - /models/?p=<sort>, then /models/2/?p=<sort>, …: the models, newest first by the date of their first video, a
 *     card per model (<div class="model-item">): her page (/models/<slug>/), name, picture (contents/models/<id>/…)
 *     and counts. A card is a post here, judged on her picture.
 *   - /models/<slug>/: her page: name (h1.model-title), aliases (the bio list, comma-separated), country (its flag,
 *     flags/<cc>.svg) and the socials she links (OnlyFans, Instagram, …) among the site's ad links. Read for the
 *     kept models.
 */
const { parseSocials, decode } = require('../discover/socials');

const SITE = 'https://www.porn4fans.com';

const modelUrl = (slug) => `${SITE}/models/${slug}/`;
const isPicture = (url) => /\.(webp|jpe?g|png|gif|avif)(\?|$)/i.test(url || '');
const titleCase = (s) => s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());

/** The model cards of a list page: each is a model-item block, up to the next one. */
function parseCards(html) {
  const blocks = html.split('<div class="model-item">').slice(1);
  return blocks.map(block => {
    const link = block.match(/<a href="https:\/\/www\.porn4fans\.com\/models\/([^/"?#]+)\/" title="([^"]*)"/);
    if (!link) return null;
    const picture = [...block.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/g)].map(m => m[1]).find(u => isPicture(u) && u.includes('/contents/models/')) || null;
    const count = (label) => {
      const n = block.match(new RegExp(`model-info-first">(\\d+)</span>\\s*<span class="model-info-last">${label}`))?.[1];
      return n == null ? null : Number(n);
    };
    return { slug: link[1], name: decode(link[2]), picture, videos: count('Videos'), photos: count('Photos'), country: block.match(/flags\/([a-z]{2})\.svg/)?.[1] || null };
  }).filter(Boolean);
}

function createPorn4fans(site, http) {
  const sort = site.sort || new URL(site.url || `${SITE}/models/?p=date_of_first_video`).searchParams.get('p') || 'date_of_first_video';
  const listing = (page) => `${SITE}/models/${page > 1 ? `${page}/` : ''}?p=${encodeURIComponent(sort)}`;

  function toScrapeResult(data) {
    const aliases = [data.name, ...(data.aliases || [])].filter(Boolean);
    return {
      name: data.name,
      url: data.url,
      profile: data.country ? { country_flag: data.country } : {},
      aliases: [...new Map(aliases.map(a => [a.toLowerCase(), a])).values()],
      tags: [],
      socials: data.socials || {}
    };
  }

  return {
    name: site.name,

    /** One list page; the cursor is the page number (null = the first), the next one is there when the page links it. */
    async listPage(cursor) {
      const page = Number(cursor) || 1;
      const html = await http.text(listing(page));
      const cards = parseCards(html);
      if (!cards.length && !html.includes('models_list')) throw new Error('no model list in the page: the site changed');
      const posts = cards.map(c => ({
        postId: c.slug,
        shortCode: null,
        title: c.name,
        postUrl: modelUrl(c.slug),
        shareUrl: null,
        createdAt: null,
        info: { videos: c.videos, images: c.photos, country: c.country },
        image: c.picture,
        skipReason: c.picture ? null : 'no picture'
      }));
      const next = html.includes(`/models/${page + 1}/?p=`) || html.includes(`;from:${page + 1}"`) ? page + 1 : null;
      return { posts, next };
    },

    /** A card is always a model: her page is the link, and her slug the profile whose data is saved. */
    async page(post) {
      const slug = post.postId || post.postUrl?.match(/\/models\/([^/?#]+)\//)?.[1];
      return { kind: 'creator', name: post.title, profileId: slug, link: modelUrl(slug) };
    },

    /** Her page: name, aliases, country and socials; shaped like the others ({ name, media: { url } }). */
    async profileDetails(slug) {
      const html = await http.text(modelUrl(slug));
      const name = decode(html.match(/<h1 class="model-title">([\s\S]*?)<\/h1>/)?.[1]);
      if (!name) return null;
      const aliasText = decode(html.match(/<ul class="bio-list">([\s\S]*?)<\/ul>/)?.[1]);
      const aliases = aliasText.split(',').map(a => a.trim()).filter(a => a && a.toLowerCase() !== name.toLowerCase());
      const picture = html.match(/<div class="model-info-img">\s*<img\b[^>]*\bsrc="([^"]+)"/)?.[1] || null;
      const country = html.match(/flag-model-page">\s*<img src="[^"]*flags\/([a-z]{2})\.svg"/)?.[1] || null;
      const countryName = decode(html.match(/flag-model-page">[\s\S]*?<\/span>([^<]*)<\/div>/)?.[1]) || null;
      return { name, url: modelUrl(slug), aliases, country, countryName: countryName && titleCase(countryName), socials: parseSocials(html), media: { url: isPicture(picture) ? picture : null } };
    },

    toScrapeResult
  };
}

module.exports = { createPorn4fans };
