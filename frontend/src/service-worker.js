/* eslint-disable no-restricted-globals */
/**
 * Darkroom's service worker. Hand-written: no imports, no Workbox runtime, nothing from a CDN.
 *
 * The CRA build (react-scripts 5, Workbox InjectManifest) compiles this file to build/service-worker.js and puts the
 * precache list in place of the manifest token below: [{ url, revision }] for index.html and the hashed bundles. Every
 * build with other files gets another VERSION, so another shell cache; the new worker waits until the app's
 * "Update ready" notice asks it to take over (SKIP_WAITING).
 *
 *   /api/files/preview                            cache first, in a thumbnail cache of 600 entries (resized previews)
 *   other /api/                                   not handled (always the network). /api/files/cached-image is too:
 *                                                 it sends the full-size original, and its ?checkOnly=true answer is JSON
 *                                                 that must stay fresh; HTTP caching covers it.
 *   app pages (no extension)                      the precached index.html, else the network, else offline.html
 *   static pages (/profile.html)                  the network, else the cache, else offline.html
 *   the shell's files                             from the cache; everything else from the network, not stored
 */

const MANIFEST = self.__WB_MANIFEST || [];

// djb2 over the list: a short name that changes whenever a file of the build does
const VERSION = (() => {
  const text = JSON.stringify(MANIFEST);
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
})();
const SHELL = 'darkroom-shell-' + VERSION;
const THUMBS = 'darkroom-thumbs-v1';
const THUMBS_MAX = 600;
const THUMB_PATHS = ['/api/files/preview'];

// public/ files the shell needs that the build does not list; cached when they can be, one failing stops nothing
const EXTRAS = ['/handy.js', '/handy-control.js', '/manifest.json', '/darkroom-tokens.css', '/offline.html',
  '/favicon.ico', '/logo.svg', '/logo192.png', '/logo512.png'];

// the caches of the Workbox worker that came from the CDN before this one
const LEGACY = ['pages', 'static-resources', 'images', 'google-fonts-webfonts'];

const abs = (url) => new URL(url, self.registration.scope).href;
const INDEX = abs((MANIFEST.find((e) => /(^|\/)index\.html$/.test(e.url)) || { url: '/index.html' }).url);
const OFFLINE = abs('/offline.html');
const EXTRA_URLS = new Set(EXTRAS.map(abs));
const SHELL_URLS = new Set([...MANIFEST.map((e) => abs(e.url)), ...EXTRA_URLS]);   // what the shell cache can hold

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    await cache.addAll(MANIFEST.map((e) => new Request(e.url, { cache: 'reload' })));
    for (const url of EXTRAS) {
      try {
        const res = await fetch(new Request(url, { cache: 'reload' }));
        if (res.ok) await cache.put(url, res);
      } catch (err) { /* best effort */ }
    }
    // one time only: a page still run by the old CDN worker gets this one at once, so it is never left on that worker
    if (await caches.has('pages') || await caches.has('static-resources')) await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter((n) => (n.startsWith('darkroom-shell-') && n !== SHELL) || LEGACY.includes(n) || n.startsWith('workbox-precache'))
      .map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

async function trimThumbs(cache) {
  const keys = await cache.keys();   // oldest first
  const extra = keys.length - THUMBS_MAX;
  for (let i = 0; i < extra; i++) await cache.delete(keys[i]);
}

async function thumb(event) {
  const cache = await caches.open(THUMBS);
  const hit = await cache.match(event.request);
  if (hit) return hit;
  const res = await fetch(event.request);
  if (res.status === 200 && res.type === 'basic') {
    const copy = res.clone();
    event.waitUntil(cache.put(event.request, copy).then(() => trimThumbs(cache)).catch(() => {}));
  }
  return res;
}

async function fromCache(url) {
  const cache = await caches.open(SHELL);
  return cache.match(url);
}

async function appPage(request) {
  const shell = await fromCache(INDEX);
  if (shell) return shell;
  try {
    return await fetch(request);
  } catch (err) {
    return (await fromCache(OFFLINE)) || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
  }
}

async function staticPage(request) {
  try {
    return await fetch(request);
  } catch (err) {
    return (await caches.match(request)) || (await fromCache(OFFLINE))
      || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
  }
}

async function shellFile(event) {
  const cache = await caches.open(SHELL);
  const hit = await cache.match(event.request);
  if (!hit) return fetch(event.request);   // an extra that could not be cached at install
  // the public/ files are not in the build's list, so a change to one alone gives no new VERSION: refresh them behind
  if (EXTRA_URLS.has(event.request.url)) {
    event.waitUntil(fetch(event.request, { cache: 'no-cache' })
      .then((res) => (res.ok ? cache.put(event.request, res) : null))
      .catch(() => {}));
  }
  return hit;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (THUMB_PATHS.includes(url.pathname)) return event.respondWith(thumb(event));
  if (url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    const last = url.pathname.split('/').pop();
    return event.respondWith(/\.[a-z0-9]+$/i.test(last) ? staticPage(request) : appPage(request));
  }
  if (SHELL_URLS.has(request.url)) event.respondWith(shellFile(event));
  // anything else (socket.io, media, other files): the network, not stored
});
