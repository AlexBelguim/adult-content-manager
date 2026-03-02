/* eslint-disable no-restricted-globals */

// Import Workbox from CDN
importScripts('https://storage.googleapis.com/workbox-cdn/releases/6.4.1/workbox-sw.js');

if (workbox) {
    console.log(`Workbox is loaded`);

    // Force strict PWA caching
    workbox.core.skipWaiting();
    workbox.core.clientsClaim();

    // Cache the underlying font files with a cache-first strategy for 1 year.
    workbox.routing.registerRoute(
        ({ url }) => url.origin === 'https://fonts.gstatic.com',
        new workbox.strategies.CacheFirst({
            cacheName: 'google-fonts-webfonts',
            plugins: [
                new workbox.cacheableResponse.CacheableResponsePlugin({
                    statuses: [0, 200],
                }),
                new workbox.expiration.ExpirationPlugin({
                    maxAgeSeconds: 60 * 60 * 24 * 365,
                    maxEntries: 30,
                }),
            ],
        })
    );

    // Cache JS and CSS files (Application Shell)
    // We use StaleWhileRevalidate so updates are fetched in bg but app loads fast
    workbox.routing.registerRoute(
        ({ request }) => request.destination === 'script' || request.destination === 'style',
        new workbox.strategies.StaleWhileRevalidate({
            cacheName: 'static-resources',
        })
    );

    // Cache images with a Cache First strategy
    workbox.routing.registerRoute(
        // Match common image extensions and your specific API image endpoints
        ({ url, request }) => {
            return (
                request.destination === 'image' ||
                url.pathname.includes('/api/files/image') ||
                url.pathname.includes('/api/files/cached_image')
            );
        },
        new workbox.strategies.CacheFirst({
            cacheName: 'images',
            plugins: [
                new workbox.expiration.ExpirationPlugin({
                    maxEntries: 1000, // Increased to store 1000 thumbnails
                    maxAgeSeconds: 60 * 24 * 60 * 60, // 60 Days
                }),
                new workbox.cacheableResponse.CacheableResponsePlugin({
                    statuses: [0, 200],
                }),
            ],
        })
    );

    // Cache Navigation (Page refreshes / Entry points) -> index.html
    workbox.routing.registerRoute(
        ({ request }) => request.mode === 'navigate',
        new workbox.strategies.NetworkFirst({
            cacheName: 'pages',
            networkTimeoutSeconds: 3,
            plugins: [
                new workbox.cacheableResponse.CacheableResponsePlugin({
                    statuses: [200],
                }),
            ]
        })
    );

} else {
    console.log(`Workbox didn't load`);
}
