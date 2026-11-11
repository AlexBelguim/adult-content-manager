/**
 * Registers the app's service worker (src/service-worker.js, built to /service-worker.js) and tells the app when a new
 * version is waiting. Production builds only, and not on localhost (the dev sandboxes, rebuilt all the time: a waiting
 * worker would keep serving the old build there), unless REACT_APP_ENABLE_SW=true. On localhost it removes a worker
 * an earlier build installed.
 *
 *   register()             once, from index.js
 *   subscribeUpdate(fn)    fn(registration) when a new worker waits, fn(null) when none does any more; returns unsubscribe
 *   getWaiting()           the registration with a waiting worker, or null
 *   applyUpdate()          the waiting worker takes over and the page reloads once
 *
 * It looks for a new version on load, whenever the page becomes visible again, and every 60 minutes.
 */

const CHECK_EVERY = 60 * 60 * 1000;

let current = null;   // the registration
let waiting = null;   // the registration while a worker waits
const listeners = new Set();

function setWaiting(next) {
  if (next === waiting) return;
  waiting = next;
  listeners.forEach((fn) => {
    try { fn(waiting); } catch (err) { /* a listener's own problem */ }
  });
}

function check() {
  if (current) current.update().catch(() => {});
}

// The caches of the old CDN worker. While they exist, the new worker takes over by itself (the one-time migration in
// service-worker.js), so it is not an update to offer.
const LEGACY = ['pages', 'static-resources'];
function migrating() {
  if (!('caches' in window)) return Promise.resolve(false);
  return Promise.all(LEGACY.map((n) => caches.has(n))).then((has) => has.some(Boolean)).catch(() => false);
}

function track(registration, worker) {
  worker.addEventListener('statechange', () => {
    // the first install has no controller: nothing to update
    if (worker.state === 'installed' && navigator.serviceWorker.controller) {
      migrating().then((skips) => {
        if (!skips && registration.waiting === worker) setWaiting(registration);
      });
    }
    // it took over (here, in another tab, or at once) or was replaced: is anything still waiting
    if (worker.state === 'activated' || worker.state === 'redundant') setWaiting(registration.waiting ? registration : null);
  });
}

function watch(registration) {
  current = registration;
  // a worker that was already waiting when the page loaded (an update that was not applied)
  if (registration.waiting) {
    track(registration, registration.waiting);
    if (navigator.serviceWorker.controller) setWaiting(registration);
  }
  // one already installing before this registration object existed: its updatefound has passed
  if (registration.installing) track(registration, registration.installing);
  registration.addEventListener('updatefound', () => {
    if (registration.installing) track(registration, registration.installing);
  });
}

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]', '::1'];

export function register() {
  const forced = process.env.REACT_APP_ENABLE_SW === 'true';
  if (process.env.NODE_ENV !== 'production' && !forced) return;
  if (!('serviceWorker' in navigator)) return;
  if (!forced && LOCAL_HOSTS.includes(window.location.hostname)) {
    navigator.serviceWorker.getRegistrations()
      .then((list) => Promise.all(list.map((r) => r.unregister())))
      .catch(() => {});
    return;
  }
  const publicUrl = new URL(process.env.PUBLIC_URL, window.location.href);
  if (publicUrl.origin !== window.location.origin) return;   // a worker only works on the page's own origin

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${process.env.PUBLIC_URL}/service-worker.js`)
      .then((registration) => {
        watch(registration);
        check();
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') check();
        });
        setInterval(check, CHECK_EVERY);
      })
      .catch(() => { /* no worker: the app works without one */ });
  });
}

export function subscribeUpdate(fn) {
  listeners.add(fn);
  if (waiting) fn(waiting);
  return () => listeners.delete(fn);
}

export function getWaiting() {
  return waiting;
}

let applying = false;
export function applyUpdate() {
  const worker = waiting && waiting.waiting;
  if (!worker || applying) return;
  applying = true;
  navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), { once: true });
  worker.postMessage({ type: 'SKIP_WAITING' });
}

export function unregister() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.ready.then((registration) => registration.unregister()).catch(() => {});
}
