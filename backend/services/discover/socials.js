/**
 * The social networks a model links on her page (Fapello, Porn4Fans), as { network: url }: the first link to each.
 * `notHers` drops the site's own links to them (an ad with ?ref=<site>, its own Instagram).
 */
const NETWORKS = { onlyfans: 'onlyfans\\.com', fansly: 'fansly\\.com', instagram: 'instagram\\.com', twitter: '(?:twitter|x)\\.com', tiktok: 'tiktok\\.com', snapchat: 'snapchat\\.com' };

function parseSocials(html, notHers = /$^/) {
  const found = {};
  for (const [key, host] of Object.entries(NETWORKS)) {
    const links = [...html.matchAll(new RegExp(`href="(https?://(?:www\\.)?${host}/[^"]+)"`, 'gi'))].map(m => m[1]);
    const hers = links.find(u => !notHers.test(u));
    if (hers) found[key] = hers;
  }
  return found;
}

/** Text of a piece of HTML: tags gone, the common entities decoded, one line. */
const decode = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

module.exports = { parseSocials, decode };
