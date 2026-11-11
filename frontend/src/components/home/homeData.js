/**
 * The Gallery home's data, kept at module level so a remount (Back from her gallery, Filter and back) shows the list
 * at once and only revalidates in the background. The grid is never rebuilt: a reload keeps the old object for every
 * row that did not change, and one performer is patched in place.
 *
 *   useGalleryPerformers() -> { performers (null = never loaded), error, failures (count of failed loads), loading, reload, patch, remove, refreshOne }
 *   useGenres(root)        -> { genres (null = not loaded for this root), error, loading, reload }
 *
 * Socket `performers_updated`: a rating or a thumbnail is patched in place, anything else reloads (debounced 1s).
 */
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { socketService } from '../../services/SocketService';

// ── a tiny store ─────────────────────────────────────────────
function makeStore(initial, { onFirst, onLast } = {}) {
  let state = initial;
  const listeners = new Set();
  return {
    get: () => state,
    set(changes) {
      state = { ...state, ...changes };
      listeners.forEach(l => l());
    },
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1 && onFirst) onFirst();
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && onLast) onLast();
      };
    }
  };
}

async function errorOf(res) {
  const data = await res.json().catch(() => null);
  return (data && typeof data.error === 'string' && data.error) || `The server answered ${res.status}`;
}

const messageOf = (err) => (err && err.message) || String(err || 'The request failed');

/** Fetches a JSON array; resolves { list } or { error } (never throws). */
async function fetchList(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return { error: await errorOf(res) };
    const data = await res.json().catch(() => undefined);
    if (!Array.isArray(data)) return { error: 'The server sent something unexpected' };
    return { list: data };
  } catch (err) {
    return { error: messageOf(err) };
  }
}

/** Same own fields, all === */
function sameRow(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every(k => Object.prototype.hasOwnProperty.call(b, k) && a[k] === b[k]);
}

/** The fresh list, reusing the old object of every row that did not change (by id). */
function keepUnchanged(prev, fresh) {
  if (!Array.isArray(prev) || !prev.length) return fresh;
  const old = new Map(prev.map(p => [p.id, p]));
  let same = prev.length === fresh.length;
  const out = fresh.map((row, i) => {
    const before = old.get(row.id);
    const keep = before && sameRow(before, row) ? before : row;
    if (same && prev[i] !== keep) same = false;
    return keep;
  });
  return same ? prev : out;
}

// ── performers ───────────────────────────────────────────────
let reloadTimer = null;

function onPerformersUpdated(d) {
  if (d && d.type === 'rating_updated' && d.performerId) {
    patch(d.performerId, { performer_rating: d.rating ?? null });
  } else if (d && d.type === 'thumbnail_updated' && d.performerId && d.thumbnail) {
    patch(d.performerId, { thumbnail: d.thumbnail });
  } else {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => { reloadTimer = null; reload(); }, 1000);
  }
}

// failures counts failed loads, so a view can tell a new failure from one that was there before it mounted
const performers = makeStore({ performers: null, error: null, failures: 0, loading: false }, {
  onFirst() {
    socketService.connect();
    socketService.on('performers_updated', onPerformersUpdated);
  },
  onLast() {
    socketService.off('performers_updated', onPerformersUpdated);
    clearTimeout(reloadTimer);
    reloadTimer = null;
  }
});

let inFlight = null;

/** Fetches the gallery list. Deduped; never throws. On an error the shown list is kept. */
export function reload() {
  if (inFlight) return inFlight;
  performers.set({ loading: true });
  inFlight = (async () => {
    const { list, error } = await fetchList('/api/performers/gallery');
    if (error) performers.set({ error, failures: performers.get().failures + 1, loading: false });
    else performers.set({ performers: keepUnchanged(performers.get().performers, list), error: null, loading: false });
  })().finally(() => { inFlight = null; });
  return inFlight;
}

const sameId = (a, b) => a != null && b != null && String(a) === String(b);

function replaceRow(id, make) {
  const list = performers.get().performers;
  if (!Array.isArray(list)) return;
  const i = list.findIndex(p => sameId(p.id, id));
  if (i < 0) return;
  const next = list.slice();
  next[i] = make(list[i]);
  performers.set({ performers: next });
}

/** Changes one row in place (nothing when she is not in the list). */
export function patch(id, changes) {
  replaceRow(id, row => ({ ...row, ...changes }));
}

/** Takes one row out. */
export function remove(id) {
  const list = performers.get().performers;
  if (!Array.isArray(list) || !list.some(p => sameId(p.id, id))) return;
  performers.set({ performers: list.filter(p => !sameId(p.id, id)) });
}

/** Reloads one performer: gone (404, moved back to Filter, blacklisted) -> removed, else her row is updated. Throws on other failures. */
export async function refreshOne(id) {
  const res = await fetch(`/api/performers/${encodeURIComponent(id)}`);
  if (res.status === 404) { remove(id); return; }
  if (!res.ok) throw new Error(await errorOf(res));
  const fresh = await res.json().catch(() => null);
  if (!fresh || typeof fresh !== 'object') throw new Error('The server sent something unexpected');
  if (fresh.moved_to_after !== 1 || fresh.blacklisted === 1) { remove(id); return; }
  replaceRow(id, old => ({ ...old, ...fresh }));
}

export function useGalleryPerformers() {
  const state = useSyncExternalStore(performers.subscribe, performers.get, performers.get);
  useEffect(() => { reload(); }, []);
  return { performers: state.performers, error: state.error, failures: state.failures, loading: state.loading, reload, patch, remove, refreshOne };
}

// ── genres ───────────────────────────────────────────────────
const genres = makeStore({ root: null, genres: null, error: null, loading: false });
let genresFlight = null;   // { root, promise }

function reloadGenres(root) {
  if (!root) return Promise.resolve();
  if (genresFlight && genresFlight.root === root) return genresFlight.promise;
  genres.set(genres.get().root !== root ? { root, genres: null, error: null, loading: true } : { loading: true });
  const promise = (async () => {
    const { list, error } = await fetchList(`/api/content/genres?basePath=${encodeURIComponent(root)}`);
    if (genres.get().root !== root) return;   // the root changed meanwhile
    if (error) genres.set({ error, loading: false });
    else genres.set({ genres: list, error: null, loading: false });
  })().finally(() => { if (genresFlight && genresFlight.promise === promise) genresFlight = null; });
  genresFlight = { root, promise };
  return promise;
}

export function useGenres(root) {
  const state = useSyncExternalStore(genres.subscribe, genres.get, genres.get);
  useEffect(() => { if (root) reloadGenres(root); }, [root]);
  const again = useCallback(() => reloadGenres(root), [root]);
  const mine = !!root && state.root === root;
  return {
    genres: mine ? state.genres : null,
    error: mine ? state.error : null,
    loading: mine ? state.loading : !!root,
    reload: again
  };
}
