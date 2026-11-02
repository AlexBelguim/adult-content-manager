/**
 * Fapello (fapello.com/new/), read from its pages. The site is behind a Cloudflare bot check, which discover/http.js
 * passes with FlareSolverr (config flareSolverrUrl); after that its pages are plain server-rendered HTML:
 *   - /new/, then /new-2/, /new-3/, … ("Next Page"): a card per new model, with her page (fapello.com/<slug>/,
 *     the name link), a feed id (fapello.com/feed/<id>/, the share button) and up to three pictures from her
 *     folder (<img class="… img_feed" alt="<name>">). A card is a post here, judged on its pictures together.
 *   - /<slug>/: her page. The <title> is "<name> / <alias> / <alias> Nude Leaks OnlyFans - Fapello", and her
 *     socials are plain onlyfans.com / instagram.com / twitter.com / tiktok.com links next to the site's ad and
 *     Telegram links; her picture is the first one from her folder (content/<a>/<b>/<slug>/). Read for the kept
 *     models: the socials are what tells a real creator from a reupload.
 */
const { parseSocials, decode } = require('../discover/socials');

const SITE = 'https://fapello.com';

const modelUrl = (slug) => `${SITE}/${slug}/`;
const isPicture = (url) => /\.(webp|jpe?g|png|gif|avif)(\?|$)/i.test(url || '');
// The site's own links to the networks (its ads carry ?ref=fapello) are not hers; its Telegram is no network here
const NOT_HERS = /[?&]ref=fapello/i;

/** The pictures of the img_feed tags in this piece of a page, in order. */
const feedPictures = (html) => [...html.matchAll(/<img\b[^>]*\bimg_feed\b[^>]*>/gi)]
  .map(m => m[0].match(/\bsrc="([^"]+)"/)?.[1]).filter(isPicture);

/** The model cards of a /new/ page: each starts at her name link, and runs to the next one. */
function parseCards(html) {
  const heads = [...html.matchAll(/<a href="https:\/\/fapello\.com\/([^/"?#]+)\/">\s*<span class="block capitalize[^"]*">([\s\S]*?)<\/span>/g)];
  return heads.map((m, i) => {
    const card = html.slice(m.index, heads[i + 1]?.index ?? html.length);
    return { slug: m[1], name: decode(m[2]), feedId: card.match(/fapello\.com\/feed\/(\d+)\//)?.[1] || null, pictures: feedPictures(card) };
  });
}

function createFapello(site, http) {
  const listing = (page) => page > 1 ? `${SITE}/new-${page}/` : `${SITE}/new/`;

  function toScrapeResult(data) {
    const aliases = [data.name, ...(data.aliases || [])].filter(Boolean);
    return {
      name: data.name,
      url: data.url,
      profile: {},
      aliases: [...new Map(aliases.map(a => [a.toLowerCase(), a])).values()],
      tags: [],
      socials: data.socials || {}
    };
  }

  return {
    name: site.name,

    /** One /new/ page; the cursor is the page number (null = /new/), the next one is there when the page links it. */
    async listPage(cursor) {
      const page = Number(cursor) || 1;
      const html = await http.text(listing(page));
      const cards = parseCards(html);
      if (!cards.length && !/<title>[^<]*Fapello/i.test(html)) throw new Error('no model cards in the page: the site changed');
      const posts = cards.map(c => ({
        postId: c.slug,
        shortCode: c.feedId,
        title: c.name,
        postUrl: modelUrl(c.slug),
        shareUrl: c.feedId ? `${SITE}/feed/${c.feedId}/` : null,
        createdAt: null,
        info: { images: c.pictures.length },
        image: c.pictures[0] || null,
        images: c.pictures,   // all the card's pictures, from her folder: judged together
        skipReason: c.pictures.length ? null : 'no preview picture'
      }));
      const next = html.includes(`${SITE}/new-${page + 1}/`) ? page + 1 : null;
      return { posts, next };
    },

    /** A card is always a model: her page is the link, and her slug the profile whose data is saved. */
    async page(post) {
      const slug = post.postId || post.postUrl?.match(/fapello\.com\/([^/?#]+)\//)?.[1];
      return { kind: 'creator', name: post.title, profileId: slug, link: modelUrl(slug) };
    },

    /** Her page: name, aliases (the title's other names) and socials; shaped like the others ({ name, media: { url } }). */
    async profileDetails(slug) {
      const html = await http.text(modelUrl(slug));
      const title = decode(html.match(/<title>([\s\S]*?)<\/title>/i)?.[1]);
      const names = title.replace(/\s+Nude Leaks\b.*$/i, '').replace(/\s+-\s+Fapello$/i, '').split(' / ').map(s => s.trim()).filter(Boolean);
      if (!names.length) return null;
      // Her picture: the first from her own folder (the page's header avatar); the side lists show other models
      const picture = [...html.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/gi)].map(m => m[1]).find(u => u.includes(`/${slug}/`) && isPicture(u)) || null;
      return { name: names[0], url: modelUrl(slug), aliases: names.slice(1), socials: parseSocials(html, NOT_HERS), media: { url: picture } };
    },

    toScrapeResult
  };
}

module.exports = { createFapello };
