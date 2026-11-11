/**
 * The Gallery home's state in the URL (replace, never push): tab, q, sort, the filter groups, gq, gsort.
 * The overlay `show` (the slideshow) is pushed by useOverlay and kept untouched here; `filters` (the old filter
 * drawer's overlay) is still kept out of the stored query, so an old link does not bring it back.
 *
 * The last home query (without the overlays) is kept in sessionStorage 'acm.home.query' and put back when `/` is
 * reached with an empty search (the logo, Back), or from the sidebar's View list (state.libraryView 'performers' or
 * 'genres', with no more than the tab in the URL): then on the tab that was clicked. The last performer sort is also
 * kept in localStorage 'galleryPerformerSortBy', as the default when the URL has none.
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import { readFilters, writeFilters, isSort, isGenreSort, DEFAULT_SORT } from './filterModel';

const SESSION_KEY = 'acm.home.query';
const SORT_KEY = 'galleryPerformerSortBy';
const OVERLAYS = ['filters', 'show'];

const searchOf = (params) => { const s = params.toString(); return s ? `?${s}` : ''; };

function storedSort() {
  try {
    const v = window.localStorage.getItem(SORT_KEY);
    return isSort(v) ? v : null;
  } catch {
    return null;
  }
}

function storeSort(id) {
  try { window.localStorage.setItem(SORT_KEY, id); } catch { /* storage off */ }
}

function readSession() {
  try { return window.sessionStorage.getItem(SESSION_KEY) || ''; } catch { return ''; }
}

function writeSession(search) {
  try { window.sessionStorage.setItem(SESSION_KEY, search); } catch { /* storage off */ }
}

/** The search without the overlay params ('' when nothing is left). */
function withoutOverlays(search) {
  const params = new URLSearchParams(search);
  OVERLAYS.forEach(k => params.delete(k));
  return searchOf(params);
}

export default function useHomeQuery() {
  const location = useLocation();
  const navigate = useNavigate();
  const here = useRef(location);
  here.current = location;
  const nav = useRef(navigate);
  nav.current = navigate;

  const query = useMemo(() => {
    const params = new URLSearchParams(location.search);
    const sortParam = params.get('sort');
    const gsortParam = params.get('gsort');
    return {
      tab: params.get('tab') === 'genres' ? 'genres' : 'performers',
      q: params.get('q') || '',
      sort: isSort(sortParam) ? sortParam : (storedSort() || DEFAULT_SORT),
      filters: readFilters(params),
      gq: params.get('gq') || '',
      gsort: isGenreSort(gsortParam) ? gsortParam : 'name-asc'
    };
  }, [location.search]);

  const set = useCallback((changes = {}) => {
    const loc = here.current;
    const params = new URLSearchParams(loc.search);
    const has = (k) => Object.prototype.hasOwnProperty.call(changes, k);
    if (has('tab')) {
      if (changes.tab === 'genres') params.set('tab', 'genres'); else params.delete('tab');
    }
    for (const k of ['q', 'gq']) {
      if (!has(k)) continue;
      const v = changes[k] == null ? '' : String(changes[k]);
      if (v === '') params.delete(k); else params.set(k, v);
    }
    if (has('sort')) {
      const id = isSort(changes.sort) ? changes.sort : DEFAULT_SORT;
      if (id === DEFAULT_SORT) params.delete('sort'); else params.set('sort', id);
      storeSort(id);
    }
    if (has('gsort')) {
      const id = isGenreSort(changes.gsort) ? changes.gsort : 'name-asc';
      if (id === 'name-asc') params.delete('gsort'); else params.set('gsort', id);
    }
    if (has('filters')) writeFilters(params, changes.filters || {});
    const search = searchOf(params);
    if (search === loc.search) return;
    here.current = { ...loc, search };
    nav.current({ pathname: loc.pathname, search, hash: loc.hash }, { replace: true, state: loc.state });
  }, []);

  // On the first mount only: an empty search on `/` gets the last query back (a View list click: on its tab).
  const restored = useRef(false);
  const skipSave = useRef(false);
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    const loc = here.current;
    if (loc.pathname !== '/') return;
    const view = loc.state?.libraryView;
    const tabOnly = [...new URLSearchParams(loc.search).keys()].every(k => k === 'tab');
    if (!(loc.search === '' || ((view === 'performers' || view === 'genres') && tabOnly))) return;
    const saved = readSession();
    if (!saved || saved === '?') return;
    const params = new URLSearchParams(saved);
    if (view === 'genres') params.set('tab', 'genres');
    else if (view === 'performers') params.delete('tab');
    const search = searchOf(params);
    if (search === loc.search) return;
    skipSave.current = true;   // do not store the search this mount started with
    here.current = { ...loc, search };
    nav.current({ pathname: loc.pathname, search, hash: loc.hash }, { replace: true, state: loc.state });
  }, []);

  // Keep the last home query for the session.
  useEffect(() => {
    if (location.pathname !== '/') return;
    if (skipSave.current) { skipSave.current = false; return; }
    writeSession(withoutOverlays(location.search));
  }, [location.pathname, location.search]);

  return { ...query, set };
}

/** How this mount was reached (POP, PUSH, REPLACE), as it was on the first render. */
export function useMountNavType() {
  const type = useNavigationType();
  const first = useRef(type);
  return first.current;
}
