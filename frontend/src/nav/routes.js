/**
 * The route table: every page of the app, its title, its section, its chrome and its parent.
 *
 *   chrome  'library' — the library shell (desktop: app bar + MainPage; phone: PhoneLibrary)
 *           'page'    — app bar on desktop, page bar + bottom navigation on a phone
 *           'bare'    — no chrome at any width; the page draws its own Back
 *   parent  where Back goes when the app did not push the entry (see useBack):
 *           a path, null (a home), or (params, searchParams) => path | null
 *
 * First match wins (react-router matchPath, end true; a pattern ending in '/*' matches its prefix).
 */
import { matchPath } from 'react-router-dom';

const pairwiseRankParent = (params, sp) => {
  const name = sp.get('performerName');
  const basePath = sp.get('basePath');
  if (name && name !== 'Unknown' && basePath) {
    return `/unified-gallery?performer=${encodeURIComponent(name)}&basePath=${encodeURIComponent(basePath)}`;
  }
  return '/ranking-insight';
};

const r = (pattern, title, section, chrome, parent) => ({ pattern, title, section, chrome, parent });

export const ROUTES = Object.freeze([
  r('/', 'Library', 'library', 'library', null),
  r('/filter', 'Library', 'library', 'library', null),
  r('/filter/:performerId', 'Filter', 'library', 'library', '/filter'),
  r('/pairs', 'Library', 'library', 'library', null),
  r('/p/:performerId', 'Gallery', 'library', 'library', '/'),
  r('/unified-gallery', 'Gallery', 'library', 'page', '/'),
  r('/player', 'Player', 'library', 'bare', '/'),
  r('/thumbnail-selector/:performerId', 'Choose thumbnail', 'library', 'bare', '/'),
  r('/local-import', 'Import', 'library', 'page', '/'),
  r('/performer-management', 'Performer Management', 'performers', 'page', '/'),
  r('/hash-results/:runId', 'Duplicates', 'performers', 'page', '/performer-management'),
  r('/discover/watchers/:watcher', 'Discover', 'discover', 'page', '/discover/watchers'),
  r('/discover/*', 'Discover', 'discover', 'page', '/'),
  r('/smart-compare', 'Smart Compare', 'rate', 'page', '/'),
  r('/group-rate', 'Group Rate', 'rate', 'page', '/'),
  r('/pairwise-rank', 'Rank pictures', 'rate', 'bare', pairwiseRankParent),
  r('/ranking-insight', 'Rank pictures', 'rate', 'page', '/'),
  r('/ai-training', 'AI & Training', 'ai', 'page', '/'),
  r('/funpipe', 'Funscripts', 'tools', 'page', '/'),
  r('/scene-editor', 'Scene editor', 'tools', 'bare', '/'),
  r('/vr', 'VR', 'tools', 'bare', '/'),
  r('/jobs', 'Jobs', 'system', 'page', '/'),
  r('/settings', 'Settings', 'system', 'page', '/'),
  r('/settings/:section', 'Settings', 'system', 'page', '/settings')
]);

export const NOT_FOUND = Object.freeze({ pattern: '*', title: 'Page not found', section: null, chrome: 'page', parent: '/' });

/** The route and its params for a pathname, or NOT_FOUND with empty params. */
function find(pathname) {
  const path = pathname || '/';
  for (const route of ROUTES) {
    const m = matchPath({ path: route.pattern, end: true }, path);
    if (m) return { route, params: m.params || {} };
  }
  return { route: NOT_FOUND, params: {} };
}

/** routeOf(pathname) -> { pattern, title, section, chrome, parent } */
export function routeOf(pathname) {
  return find(pathname).route;
}

/** parentOf({ pathname, search }) -> the path Back leads to when nothing can be popped, or null (a home). */
export function parentOf({ pathname, search } = {}) {
  const { route, params } = find(pathname);
  const { parent } = route;
  if (typeof parent === 'function') {
    const sp = new URLSearchParams(search || '');
    return parent(params, sp) ?? null;
  }
  return parent ?? null;
}

export function titleOf(pathname) {
  return routeOf(pathname).title;
}

/** 'library' | 'performers' | 'discover' | 'rate' | 'ai' | 'tools' | 'system' | null */
export function sectionOf(pathname) {
  return routeOf(pathname).section;
}

/**
 * What the library shows at a pathname, or null off the library routes.
 * -> { list: 'gallery' | 'filter' | 'pairs', performerId: string | null, galleryId: string | null }
 */
export function libraryState(pathname) {
  const path = pathname || '/';
  const state = (list, performerId = null, galleryId = null) => ({ list, performerId, galleryId });
  if (matchPath({ path: '/', end: true }, path)) return state('gallery');
  if (matchPath({ path: '/filter', end: true }, path)) return state('filter');
  const f = matchPath({ path: '/filter/:performerId', end: true }, path);
  if (f) return state('filter', f.params.performerId ?? null);
  if (matchPath({ path: '/pairs', end: true }, path)) return state('pairs');
  const g = matchPath({ path: '/p/:performerId', end: true }, path);
  if (g) return state('gallery', null, g.params.performerId ?? null);
  return null;
}
