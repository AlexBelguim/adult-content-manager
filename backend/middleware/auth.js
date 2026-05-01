/**
 * Optional Authentication Middleware
 *
 * When APP_SECRET is set in the environment, all /api/* requests
 * require a matching Bearer token, query param, or cookie.
 *
 * If APP_SECRET is NOT set, auth is completely disabled (passthrough).
 *
 * Usage in index.js:
 *   const auth = require('./middleware/auth');
 *   app.use(auth);
 *
 * Client-side:
 *   fetch('/api/...', { headers: { Authorization: `Bearer ${token}` } })
 *   -- or --
 *   fetch('/api/...?token=xxx')
 */

const APP_SECRET = process.env.APP_SECRET;

// Paths that never require auth (even when APP_SECRET is set)
const PUBLIC_PATHS = [
  '/api/health',         // Health check
  '/api/license',        // License validation must work pre-auth
];

module.exports = function authMiddleware(req, res, next) {
  // If no APP_SECRET is configured, auth is disabled entirely
  if (!APP_SECRET) return next();

  // Skip auth for non-API requests (frontend static files)
  if (!req.path.startsWith('/api/')) return next();

  // Skip auth for public paths
  if (PUBLIC_PATHS.some(p => req.path.startsWith(p))) return next();

  // Extract token from multiple sources
  const token = req.headers.authorization?.replace('Bearer ', '')
    || req.query.token
    || req.cookies?.token;

  if (token === APP_SECRET) {
    return next();
  }

  return res.status(401).json({
    error: 'Unauthorized',
    message: 'A valid token is required. Set APP_SECRET and pass it as a Bearer token.'
  });
};
