/**
 * The library's list modes and the phone's remembered one (localStorage 'acm.phone.libraryMode').
 */
const KEY = 'acm.phone.libraryMode';
const PATHS = { gallery: '/', filter: '/filter', pairs: '/pairs' };

/** listPath('gallery' | 'filter' | 'pairs') -> '/' | '/filter' | '/pairs' */
export function listPath(list) {
  return PATHS[list] || '/';
}

export function rememberLibraryMode(list) {
  if (!PATHS[list]) return;
  try {
    localStorage.setItem(KEY, list);
  } catch {
    // storage blocked: the phone starts in the gallery
  }
}

function savedLibraryMode() {
  try {
    const v = localStorage.getItem(KEY);
    return PATHS[v] ? v : null;
  } catch {
    return null;
  }
}

/** Where the phone's Library tab goes: the last list mode, else the gallery. */
export function libraryHomePath() {
  return listPath(savedLibraryMode() || 'gallery');
}
