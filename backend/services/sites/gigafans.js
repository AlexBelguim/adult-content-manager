/**
 * GigaFans (gigafans.net), read from its API. The page is a static shell that loads every post at once from
 * /api/v34/posts (the version is in the page's data-api-endpoint): { success, posts: [{ id, slug, title, description,
 * date, image, … }] }, all of them (thousands), newest first. A post is a creator's pack: the title is her name
 * between bows ("🎀🎀 Name 🎀🎀"), the description its size ("52 GB"), the image one picture (/uploads/<hash>.jpg).
 * The list is read once a run and paged here; a post's link is the site's own share link (#post-<id>), as it has no
 * page of its own and no creator pages.
 */
const SITE = 'https://www.gigafans.net';
const API = `${SITE}/api/v34/posts`;

const isPicture = (url) => /\.(webp|jpe?g|png|gif|avif)(\?|$)/i.test(url || '');
// The bows and other decoration around the name
const nameOf = (title) => String(title || '').normalize('NFKC').replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').trim();
// The page's own id for a post's card, which its share link points at
const cardId = (id) => String(id).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '');

function createGigafans(site, http) {
  const pageSize = site.pageSize || 60;
  let all = null;
  const posts = () => (all ??= http.json(API).then(answer => {
    if (!Array.isArray(answer?.posts)) throw new Error('no posts in the API answer: the site changed');
    return answer.posts;
  }));

  return {
    name: site.name,

    /** One page of the list; the cursor is where it starts (null = the newest). */
    async listPage(cursor) {
      const from = Number(cursor) || 0;
      const list = await posts();
      const page = list.slice(from, from + pageSize).filter(p => p.id).map(p => {
        const image = p.image && isPicture(p.image) ? new URL(p.image, SITE).href : null;
        return {
          postId: p.id,
          shortCode: p.slug || null,
          title: nameOf(p.title) || p.slug,
          postUrl: `${SITE}/#post-${cardId(p.id)}`,
          shareUrl: null,
          createdAt: p.date || null,
          info: { size: String(p.description || '').match(/[\d.]+\s*[KMGT]B/i)?.[0] || null, downloads: p.downloads ?? null },
          image,
          skipReason: image ? null : 'no picture'
        };
      });
      return { posts: page, next: from + pageSize < list.length ? from + pageSize : null };
    },

    /** A post is one pack with no creator page behind it: its share link is the link. */
    async page(post) {
      return { kind: 'post', name: post.title, link: post.postUrl };
    }
  };
}

module.exports = { createGigafans };
