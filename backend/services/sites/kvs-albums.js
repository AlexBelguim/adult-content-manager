/**
 * Photo albums of a KVS site (Kernel Video Sharing: thothub.vip, thothd.com), read from its pages. One adapter for
 * every such site; the watcher's "url" is the site's album list (https://<host>/albums/):
 *   - /albums/, /albums/2/, …: the newest albums first (sort_by post_date), a card per album: its page
 *     (/album/<id>/<slug>/ or /albums/<id>/<slug>/, by site), title, preview picture (data-original: lazy-loaded)
 *     and photo count. A card is a post here.
 *   - an album's page names the models in it as links to their model page (/albums/models/<slug>/, a star chip
 *     with the name). Only an album with such a link is kept track of: its page is read before its picture, an
 *     album that names nobody is skipped (no picture, no performer), one that does is judged on its preview and
 *     its performer is the model, with her model page as the link. The model pages are only her album lists (no
 *     socials, no details), so nothing more is read.
 *   - the album page also links its photos full size (/get_image/…, Thothub) when the site shows them to everyone:
 *     the album is judged on its preview and those together (up to picturesPerPost). ThotHD keeps its photos private
 *     (only 84×150 thumbnails show), so it is judged on its preview alone.
 */
const { decode } = require('../discover/socials');

const isPicture = (url) => /\.(webp|jpe?g|png|gif|avif)(\?|$)/i.test(url || '');
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Names compared without case, accents or punctuation ("Angel Polikarpova" in "angel-polikarpova-pink-undies")
const plain = (s) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');

function createKvsAlbums(site, http) {
  const list = new URL(site.url);   // https://<host>/albums/
  const origin = escape(list.origin);
  const listing = (page) => page > 1 ? new URL(`${page}/`, list).href : list.href;

  /** The album cards of a list page: each starts at its link, and runs to the next one. */
  function parseCards(html) {
    const heads = [...html.matchAll(new RegExp(`<a href="(${origin}/albums?/(\\d+)/[^"/]+/)" title="([^"]*)"`, 'g'))];
    return heads.map((m, i) => {
      const card = html.slice(m.index, heads[i + 1]?.index ?? html.length);
      const picture = [...card.matchAll(/\b(?:data-original|src)="([^"]+)"/g)].map(x => x[1]).find(isPicture) || null;
      const photos = card.match(/(\d+)\s*photos/i)?.[1] ?? card.match(/icon-picture[\s\S]*?<\/i>\s*(\d+)/)?.[1];
      return { url: m[1], id: m[2], title: decode(m[3]), picture, photos: photos ? Number(photos) : null };
    });
  }

  /** The models an album's page links (star chips): [{ slug, name, link }]. */
  /** The album's photos, full size, when the page links them to everyone (get_image links; private ones are not). */
  const parsePhotos = (html) => [...new Set([...html.matchAll(new RegExp(`href="(${origin}/get_image/[^"]+)"`, 'g'))].map(m => m[1].replace(/&amp;/g, '&')))];

  function parseModels(html) {
    const links = [...html.matchAll(new RegExp(`<a[^>]+href="(${origin}/(?:albums/)?models/([^"/?#]+)/)"[^>]*>([\\s\\S]*?)</a>`, 'g'))];
    return [...new Map(links.map(m => [m[2], { slug: m[2], name: decode(m[3]) || m[2], link: m[1] }])).values()];
  }

  const resolved = new Map();   // album id → its performer (or null), read once per run

  return {
    name: site.name,

    /** One list page; the cursor is the page number (null = /albums/), the next one is there when the page links it. */
    async listPage(cursor) {
      const page = Number(cursor) || 1;
      const html = await http.text(listing(page));
      const cards = parseCards(html);
      if (!cards.length && !html.includes('list_albums')) throw new Error('no album list in the page: the site changed');
      const posts = cards.map(c => ({
        postId: c.id,
        shortCode: null,
        title: c.title,
        postUrl: c.url,
        shareUrl: null,
        createdAt: null,
        info: { images: c.photos },
        image: c.picture,
        skipReason: c.picture ? null : 'no preview picture'
      }));
      // Plain links (/albums/2/) on some sites, ajax ones (data-parameters "…;from:2") on others
      const next = html.includes(`/albums/${page + 1}/"`) || html.includes(`;from:${page + 1}"`) ? page + 1 : null;
      return { posts, next };
    },

    /**
     * Who the album is of: the model it links, or null when it links none (the album is then skipped). An album
     * that names several gets the one whose name is in its title, the longest such name ("Angel Polikarpova Pink
     * Undies" links "Pink" and "Angel Polikarpova"), else the first.
     */
    async resolve(post) {
      if (resolved.has(post.postId)) return resolved.get(post.postId);
      const html = await http.text(post.postUrl);
      const models = parseModels(html);
      const inTitle = plain(`${post.title} ${post.postUrl}`);
      const named = models.filter(m => [m.name, m.slug].some(n => plain(n) && inTitle.includes(plain(n))))
        .sort((a, b) => plain(b.name).length - plain(a.name).length);
      const model = named[0] || models[0];
      const performer = model ? { name: model.name, link: model.link, images: parsePhotos(html) } : null;
      resolved.set(post.postId, performer);
      return performer;
    },

    /** A kept album is its model's: her model page is the link. */
    async page(post, performer) {
      performer ??= await this.resolve(post);
      return performer ? { kind: 'creator', name: performer.name, link: performer.link } : { kind: 'post', name: post.title, link: post.postUrl };
    }
  };
}

module.exports = { createKvsAlbums };
