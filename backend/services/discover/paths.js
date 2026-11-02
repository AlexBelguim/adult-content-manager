/**
 * Where Discover keeps its files: <data>/discover/cache/<site>/<title>/ for the pictures it judged, cache/uploads/<id>/
 * for the Upload tab's. The database holds paths relative to the cache, so it reads the same on the NAS and on a test copy.
 */
const path = require('path');
const config = require('../../config');

const ROOT = path.join(config.dataPath, 'discover');
const CACHE = path.join(ROOT, 'cache');

/** A cached file's path as stored */
const rel = (file) => (file ? path.relative(CACHE, file).split(path.sep).join('/') : file);
/** A stored path as a file */
const abs = (file) => (file ? path.join(CACHE, file) : file);
/** Its address on this server, or null when it isn't under the cache */
const cacheUrl = (file) => (file && !file.startsWith('..') ? `/api/discovery/cache/${file.split('/').map(encodeURIComponent).join('/')}` : null);

module.exports = { ROOT, CACHE, rel, abs, cacheUrl };
