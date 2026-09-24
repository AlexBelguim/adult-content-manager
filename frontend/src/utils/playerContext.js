/**
 * Player navigation contract (docs/redesign/SPEC.md).
 *
 * The player is a real route: /player?ctx=<id>&i=<index>. The opener saves the
 * list it is showing (already filtered + sorted) and navigates to playerUrl().
 * /player?path=<file> works without a context: single item, Back = history.back().
 *
 * ctx = { title, backUrl, items: [MediaItem, …] }
 */

const KEY_PREFIX = 'playerCtx:';

const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'avif', 'jfif', 'heic', 'tiff', 'svg'];

// Same-tab fallback for when sessionStorage is full or unavailable.
const memory = new Map();

const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

function storedKeys() {
  const keys = [];
  for (let i = 0; i < sessionStorage.length; i += 1) {
    const k = sessionStorage.key(i);
    if (k && k.startsWith(KEY_PREFIX)) keys.push(k);
  }
  // ids start with a base-36 timestamp, so a plain sort is oldest-first
  return keys.sort();
}

function write(id, ctx) {
  memory.set(id, ctx);
  const key = KEY_PREFIX + id;
  const json = JSON.stringify(ctx);
  try {
    sessionStorage.setItem(key, json);
    return;
  } catch (e) {
    // Quota: drop older player lists, oldest first, and retry.
  }
  try {
    const old = storedKeys().filter((k) => k !== key);
    while (old.length) {
      sessionStorage.removeItem(old.shift());
      try {
        sessionStorage.setItem(key, json);
        return;
      } catch (e) {
        // keep pruning
      }
    }
  } catch (e) {
    // sessionStorage unavailable — the in-memory copy still serves this tab
  }
}

/** Save a list for the player to walk through. Returns the ctx id. */
export function savePlayerContext(ctx) {
  const id = newId();
  write(id, {
    title: ctx?.title || '',
    backUrl: ctx?.backUrl || '',
    items: Array.isArray(ctx?.items) ? ctx.items : []
  });
  return id;
}

/** Replace a stored list (the player does this after deleting a file). */
export function updatePlayerContext(id, ctx) {
  if (!id || !ctx) return;
  write(id, ctx);
}

/** Load a list by id. Returns null when it is unknown or unreadable. */
export function loadPlayerContext(id) {
  if (!id) return null;
  if (memory.has(id)) return memory.get(id);
  try {
    const raw = sessionStorage.getItem(KEY_PREFIX + id);
    if (!raw) return null;
    const ctx = JSON.parse(raw);
    if (!ctx || !Array.isArray(ctx.items)) return null;
    memory.set(id, ctx);
    return ctx;
  } catch (e) {
    return null;
  }
}

/** URL of the player page for item `index` of context `id`. */
export function playerUrl(id, index = 0) {
  return `/player?ctx=${encodeURIComponent(id)}&i=${Math.max(0, Number(index) || 0)}`;
}

/** Build a MediaItem from nothing but a file path (the /player?path= case). */
export function mediaItemFromPath(path) {
  const name = String(path).split(/[\\/]/).pop() || String(path);
  const ext = (name.split('.').pop() || '').toLowerCase();
  const isImage = IMAGE_EXT.includes(ext);
  const q = encodeURIComponent(path);
  let type = 'image';
  if (!isImage) type = /funscript/i.test(path) ? 'funscript_video' : 'video';
  return {
    path,
    name,
    type,
    url: `/api/files/raw?path=${q}`,
    thumbnail: isImage ? `/api/files/preview?path=${q}` : `/api/files/video-thumbnail?path=${q}`
  };
}
