/**
 * FlareSolverr client — gets past a site's Cloudflare bot check ("Just a moment…").
 *
 * FlareSolverr is a separate service (start-flaresolverr.cmd runs the Windows build, docker-compose.yml the image). It drives a
 * real browser that passes the check and hands back the page HTML, the clearance cookies and the exact User-Agent
 * it used. discover/http.js uses this to clear a host once and then read that host directly with those cookies, so any
 * site adapter behind Cloudflare works without the adapter knowing about it. Nothing here runs unless
 * `flareSolverrUrl` is configured and a site actually answers with a bot check.
 *
 * API: https://github.com/FlareSolverr/FlareSolverr
 */

function createFlareSolverr({ url, maxTimeout = 60000 }) {
  async function post(body, timeoutMs) {
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (err) {
      throw new Error(`FlareSolverr unreachable at ${url}: ${err.message} (is it running? start-flaresolverr.cmd, or docker-compose.yml)`);
    }
    if (!res.ok) throw new Error(`FlareSolverr HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
    const data = await res.json();
    if (data.status !== 'ok') throw new Error(`FlareSolverr: ${data.message || JSON.stringify(data).slice(0, 200)}`);
    return data;
  }

  return {
    endpoint: url,

    /** Is FlareSolverr answering? */
    async available() {
      try { await post({ cmd: 'sessions.list' }, 5000); return true; } catch { return false; }
    },

    /**
     * Pass the check for `target` and return { status, html, cookies, userAgent, url }. FlareSolverr enforces
     * `maxTimeout` itself; the extra 10 s only covers a host that never answers, which would otherwise hang.
     */
    async get(target, timeout = maxTimeout) {
      const { solution: s } = await post({ cmd: 'request.get', url: target, maxTimeout: timeout }, timeout + 10000);
      return { status: s.status, html: s.response || '', cookies: s.cookies || [], userAgent: s.userAgent || '', url: s.url };
    }
  };
}

module.exports = { createFlareSolverr };
