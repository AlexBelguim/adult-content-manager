/**
 * Every request to a scanned site (its API and its image host) goes through one queue, so the whole run
 * stays at config.requestsPerSecond however many sites and pictures there are.
 *
 * A host that answers with a Cloudflare bot check is cleared through FlareSolverr (config.flareSolverrUrl, see
 * discover/flaresolverr.js) the first time, and read directly after that with the cookies and User-Agent it passed
 * the check with: one cleared host covers its pages and its pictures. A host that checks the connection too (its
 * cookies do not get these requests past it, as on Fapello) has its pages read in FlareSolverr from then on, not
 * tried directly first; its pictures are still fetched directly. Without flareSolverrUrl a bot check is an error
 * like any other 403.
 */
const { say, warn } = require('./runLog');
const fs = require('fs');
const { createFlareSolverr } = require('./flaresolverr');

const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

// A Cloudflare check page, not the answer that was asked for (Cloudflare says so in cf-mitigated)
const CHECK_PAGE = /<title>Just a moment|cf-browser-verification|challenge-platform|__cf_chl_/i;
const isBotCheck = (res, body) =>
  [403, 503].includes(res.status) && (res.headers.get('cf-mitigated') === 'challenge' || CHECK_PAGE.test(body));

function createHttp({ requestsPerSecond, userAgent, flareSolverrUrl }) {
  const gap = 1000 / Math.max(requestsPerSecond, 0.01);
  let next = 0;
  const flare = flareSolverrUrl ? createFlareSolverr({ url: flareSolverrUrl }) : null;
  const cleared = new Map();   // host → { cookie, userAgent }, from FlareSolverr
  const viaFlare = new Set();  // hosts that still show the check with those cookies: their pages go to FlareSolverr
  const asPage = (html) => new Response(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });

  async function turn() {
    const now = Date.now();
    const at = Math.max(now, next);
    next = at + gap;
    if (at > now) await new Promise(resolve => setTimeout(resolve, at - now));
  }

  /** Pass the host's check in FlareSolverr's browser; later requests to the host send what it got. */
  async function clear(url) {
    const host = new URL(url).host;
    if (!cleared.has(host)) say(`  ${host} shows a Cloudflare check: passing it with FlareSolverr`);
    await turn();
    const solved = await flare.get(url);
    if (CHECK_PAGE.test(solved.html)) throw new Error(`FlareSolverr did not get past the Cloudflare check on ${host}`);
    // The clearance is bound to the User-Agent that earned it, so that one goes with it
    cleared.set(host, { cookie: solved.cookies.map(c => `${c.name}=${c.value}`).join('; '), userAgent: solved.userAgent || userAgent });
    return solved;
  }

  async function request(url, headers = {}, { binary = false } = {}) {
    const host = new URL(url).host;
    if (flare && !binary && viaFlare.has(host)) return asPage((await clear(url)).html);
    let res;
    let triedClearing = false;
    let dropped = 0;
    // A site that says "too many requests" (429) or "busy" (503) gets left alone for as long as it asks
    // (Retry-After), else 1, 2, 4, 8 minutes, and the whole queue waits with it
    for (let attempt = 0; ; attempt++) {
      await turn();
      const pass = cleared.get(host);
      try {
        res = await fetch(url, {
          headers: { 'User-Agent': pass?.userAgent || userAgent, ...(pass ? { Cookie: pass.cookie } : {}), ...headers },
          signal: AbortSignal.timeout(30000)
        });
      } catch (err) {
        // A dropped connection or a broken TLS handshake (seen now and then on these hosts) is tried twice more
        if (++dropped > 2) throw new Error(`${host}: ${err.cause?.code || err.message}`);
        warn(`  ${host}: ${err.cause?.code || err.message}, trying again`);
        next = Math.max(next, Date.now() + 5000);
        continue;
      }
      if (res.ok) return res;
      const body = await res.text().catch(() => '');
      if (flare && !triedClearing && isBotCheck(res, body)) {
        triedClearing = true;
        if (pass && !binary && !viaFlare.has(host)) {
          viaFlare.add(host);
          say(`  ${host} still shows the check with FlareSolverr's cookies: its pages go through FlareSolverr`);
        }
        const solved = await clear(url);
        // A page: what FlareSolverr's browser loaded is the page. A picture: FlareSolverr does not hand back
        // bytes, so it is fetched again now that the host is cleared.
        if (!binary) return asPage(solved.html);
        continue;
      }
      if (isBotCheck(res, body)) {
        const err = new Error(`HTTP ${res.status} for ${url.split('?')[0]}: a Cloudflare check${flare ? ' that FlareSolverr\'s clearance did not pass' : ' (set flareSolverrUrl and run FlareSolverr: start-flaresolverr.cmd)'}`);
        err.status = res.status;
        throw err;
      }
      if (![429, 503].includes(res.status) || attempt === 4) {
        const err = new Error(`HTTP ${res.status} for ${url.split('?')[0]}${body ? `: ${body.replace(/\s+/g, ' ').slice(0, 300)}` : ''}`);
        err.status = res.status;
        throw err;
      }
      const asked = Number(res.headers.get('retry-after'));
      const wait = (asked > 0 ? asked : 60 * 2 ** attempt) * 1000;
      warn(`  ${host} answered ${res.status}: waiting ${Math.round(wait / 1000)} s`);
      next = Math.max(next, Date.now() + wait);
    }
  }

  return {
    json: (url, headers) => request(url, { Accept: 'application/json', ...headers }).then(res => res.json()),
    text: (url, headers) => request(url, { Accept: 'text/html', ...headers }).then(res => res.text()),

    /** Whether FlareSolverr is configured and answering (for a warning before a run that needs it). */
    flareAvailable: () => flare ? flare.available() : Promise.resolve(false),

    /** Saves a picture to file; throws when the answer is not an image or is too big. */
    async download(url, file, headers) {
      const res = await request(url, { Accept: 'image/*', ...headers }, { binary: true });
      const type = res.headers.get('content-type') || '';
      if (!type.startsWith('image/')) throw new Error(`not an image (${type || 'no content-type'})`);
      const bytes = Buffer.from(await res.arrayBuffer());
      if (bytes.length > MAX_IMAGE_BYTES) throw new Error(`image too big (${bytes.length} bytes)`);
      fs.writeFileSync(file, bytes);
      return type;
    }
  };
}

module.exports = { createHttp };
