// The VR screen's server calls. Everything is a GET except:
//   POST /api/files/dimensions  read-only: picture / video sizes for the band's layout
//   POST /api/filter/action     a keep or delete decision (only on the user's A / B / throw / button)
//   POST /api/filter/undo       undo the last decision (only on the user's X / Undo button)
// The decision body is the one the app's Filter page sends (components/PerformerFilterView.js).

const RAW_VIDEO_RE = /\.(mp4|webm|m4v)$/i; // played as they are; anything else goes through stream-video
const enc = encodeURIComponent;

async function errorOf(r) {
  try { const j = await r.json(); if (j && j.error) return j.error; } catch { /* not json */ }
  return `HTTP ${r.status}`;
}
async function getJson(url, opts) {
  const r = await fetch(url, opts);
  if (!r.ok) throw new Error(await errorOf(r));
  return r.json();
}
async function postJson(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  if (!r.ok) throw new Error(await errorOf(r));
  return r.json().catch(() => ({}));
}
/** the path inside a "/api/files/raw?path=..." url (genre lists give urls, not paths) */
const pathOfUrl = (u) => { try { return new URL(u, window.location.origin).searchParams.get('path') || ''; } catch { return ''; } };

export const api = {
  rawUrl: (p) => `/api/files/raw?path=${enc(p)}`,
  thumbUrl: (p, max) => `/api/files/thumb?path=${enc(p)}&max=${max}`,
  videoThumbUrl: (p) => `/api/files/video-thumbnail?path=${enc(p)}`,
  /** where a video plays from: as it is for formats the browser plays, converted otherwise (optionally from start s) */
  videoSrc: (p, start = 0) => (RAW_VIDEO_RE.test(p)
    ? `/api/files/raw?path=${enc(p)}`
    : `/api/files/stream-video?path=${enc(p)}${start > 0 ? `&start=${start.toFixed(2)}` : ''}`),
  videoSeekable: (p) => RAW_VIDEO_RE.test(p),

  /** the gallery: performers after filtering */
  performers: () => getJson('/api/performers/gallery').then((a) => (Array.isArray(a) ? a : [])),
  /** performers still to filter */
  filterPerformers: () => getJson('/api/performers/filter?limit=1000&offset=0').then((j) => (j && j.performers) || []),
  /** how many of her pictures or videos are still to decide */
  toDecide: (id, type) => getJson(`/api/filter/files/${id}?type=${type}&limit=1&offset=0&hideKept=true`).then((j) => j.total || 0),
  /** her files still to decide, one page: { files: [{ path, name, width, height, size, modified, type }], total } */
  filterFiles: (id, { type = 'pics', limit = 200, offset = 0, sortBy = 'name', sortOrder = 'asc' } = {}) =>
    getJson(`/api/filter/files/${id}?type=${type}&sortBy=${sortBy}&sortOrder=${sortOrder}&limit=${limit}&offset=${offset}&hideKept=true`)
      .then((j) => ({ files: j.files || [], total: j.total || 0 })),
  /** her gallery: [{ path, name, width, height, size, modified }] */
  pictures: (id) => getJson(`/api/performers/${id}/gallery/images?fast=true`).then((j) => j.pics || []),
  videos: (id) => getJson(`/api/performers/${id}/gallery/videos?fast=true`).then((j) => j.vids || []),
  /** the library's base folder (the first one) */
  basePath: () => getJson('/api/folders').then((f) => (Array.isArray(f) && f[0] && f[0].path) || null),
  /** genres: [{ name, pics, vids, funscripts, size }] (a recursive scan the first time: can take a while) */
  genres: (bp) => getJson(`/api/content/genres?basePath=${enc(bp)}&fast=true`).then((a) => (Array.isArray(a) ? a : [])),
  /** a genre's pictures and videos, as { pics: [{ path, name, size, modified }], vids: [...] } */
  genre: async (name, bp) => {
    const j = await getJson(`/api/content/genre/${enc(name)}?basePath=${enc(bp)}`);
    const conv = (x) => ({ path: pathOfUrl(x.url), name: x.name, size: x.size || 0, modified: Date.parse(x.modified) || 0 });
    return { pics: (j.pics || []).map(conv).filter((x) => x.path), vids: (j.vids || []).map(conv).filter((x) => x.path) };
  },
  /** sizes for paths: { [path]: [w, h] } (read-only) */
  dims: (paths) => (paths.length ? postJson('/api/files/dimensions', { paths }).then((j) => (j && j.dims) || {}) : Promise.resolve({})),
  videoDuration: (p) => getJson(`/api/files/video-duration?path=${enc(p)}`).then((j) => Number(j.duration) || 0),

  /** a keep or delete decision, exactly as the app's Filter page sends it */
  decide: (performerId, filePath, action) => postJson('/api/filter/action', { performerId, filePath, action }),
  undo: () => postJson('/api/filter/undo', {}),
};

/** run fn over items, at most n at a time */
export async function pool(items, n, fn) {
  let i = 0;
  const worker = async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
}
