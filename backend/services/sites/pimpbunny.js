/**
 * PimpBunny (pimpbunny.com/onlyfans-creators/?sort_by=added_date), read from its pages (a KVS site, server-rendered):
 *   - /onlyfans-creators/?sort_by=<sort>, then /onlyfans-creators/2/?sort_by=<sort>, …: the creators, the newest
 *     added first, a card per creator (ui-card-model): her page (/onlyfans-creators/<slug>/), name and picture
 *     (data-original: lazy-loaded; the file names have spaces). Every other card is an ad that links out
 *     (a.pur.agency); only the cards linking a creator page count. A card is a post here, judged on her picture.
 *   - a creator's page has her name and counts, no aliases or socials (its only X link is the site's own), so a
 *     kept creator's link is her page and nothing more is read.
 */
const { decode } = require('../discover/socials');

const SITE = 'https://pimpbunny.com';

const creatorUrl = (slug) => `${SITE}/onlyfans-creators/${slug}/`;
const isPicture = (url) => /\.(webp|jpe?g|png|gif|avif)(\?|$)/i.test(url || '');

/** The creator cards of a list page (the ads among them left out). */
function parseCards(html) {
  return html.split('ui-card-model__').slice(1).map(card => {
    const link = card.match(/<a [^>]*href="https:\/\/pimpbunny\.com\/onlyfans-creators\/([^/"?#]+)\/"/);
    if (!link || /^\d+$/.test(link[1])) return null;
    const picture = card.match(/\bdata-original="([^"]+)"/)?.[1];
    const videos = card.match(/<div>(\d+) videos?<\/div>/)?.[1];
    return {
      slug: link[1],
      name: decode(card.match(/class="text-truncate">([\s\S]*?)<\/div>/)?.[1] || card.match(/\balt="([^"]*)"/)?.[1]) || link[1],
      picture: isPicture(picture) ? encodeURI(picture) : null,
      videos: videos ? Number(videos) : null
    };
  }).filter(Boolean);
}

function createPimpbunny(site, http) {
  const sort = new URL(site.url || `${SITE}/onlyfans-creators/?sort_by=added_date`).searchParams.get('sort_by') || 'added_date';
  const listing = (page) => `${SITE}/onlyfans-creators/${page > 1 ? `${page}/` : ''}?sort_by=${encodeURIComponent(sort)}`;

  return {
    name: site.name,

    /** One list page; the cursor is the page number (null = the first), the next one is there when the page links it. */
    async listPage(cursor) {
      const page = Number(cursor) || 1;
      const html = await http.text(listing(page));
      const cards = parseCards(html);
      if (!cards.length && !html.includes('ui-card-model__')) throw new Error('no creator list in the page: the site changed');
      const posts = cards.map(c => ({
        postId: c.slug,
        shortCode: null,
        title: c.name,
        postUrl: creatorUrl(c.slug),
        shareUrl: null,
        createdAt: null,
        info: { videos: c.videos },
        image: c.picture,
        skipReason: c.picture ? null : 'no picture'
      }));
      const next = html.includes(`/onlyfans-creators/${page + 1}/?sort_by=`) ? page + 1 : null;
      return { posts, next };
    },

    /** A card is always a creator: her page is the link (it has nothing more to read). */
    async page(post) {
      return { kind: 'creator', name: post.title, link: post.postUrl };
    }
  };
}

module.exports = { createPimpbunny };
