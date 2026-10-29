/**
 * LAN and Tailscale only: nothing in ACM answers the internet.
 *
 * Every request is refused (403, nothing else said) unless it comes from this
 * machine, the home network or Tailscale:
 *   127.0.0.0/8, ::1                         this machine
 *   10/8, 172.16/12, 192.168/16, 169.254/16  the LAN (and Docker's own networks, 172.x)
 *   100.64.0.0/10, fd7a:115c:a1e0::/48       Tailscale
 *   fc00::/7, fe80::/10                      the LAN's own IPv6
 * The socket's address is what counts, never X-Forwarded-For (anyone can send
 * that). A reverse proxy or tunnel on the NAS connects from a LAN address, so
 * this doesn't stop one; it stops a published port reaching the world.
 * LAN_ONLY=0 turns it off.
 */

const v4 = (ip) => ip.split('.').map(Number);

function nearby(raw) {
  let ip = String(raw || '').toLowerCase();
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  if (ip.includes('.')) {
    const [a, b] = v4(ip);
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
  }
  return ip === '::1' || ip.startsWith('fd7a:115c:a1e0:') || /^f[cd][0-9a-f]{2}:/.test(ip) || /^fe[89ab][0-9a-f]:/.test(ip);
}

function lanOnly(req, res, next) {
  if (process.env.LAN_ONLY === '0' || nearby(req.socket?.remoteAddress)) return next();
  res.status(403).end();
}

module.exports = lanOnly;
module.exports.nearby = nearby;
