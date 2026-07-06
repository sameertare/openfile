/**
 * PawnPrint service worker — runtime caching so the app (including the ~7MB Stockfish engine)
 * works offline after the first visit. No build-time precache list: Vite's content-hashed
 * filenames change on every build, so instead every same-origin GET is cached the first time
 * it's fetched and served from cache on later visits, including offline.
 *
 * HTML documents are NOT content-hashed (unlike the JS/CSS/image assets they reference), so their
 * URL stays the same across deploys — caching them stale-while-revalidate would keep serving a
 * page from before the latest deploy until a second visit. Instead they go network-first: fetch
 * fresh whenever online (falling back to the cached copy only when offline), while every other
 * same-origin asset keeps the fast cache-first-then-revalidate behavior.
 *
 * Never cached: non-GET requests, cross-origin requests (lichess, etc.), and this app's own
 * /api/ calls — those need a real network round-trip and already have their own error handling
 * for when the network isn't there.
 */

// Bump this on any change to this file's caching behavior, to drop old caches on activate.
const CACHE_NAME = 'pawnprint-v2';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.includes('/api/')) {
    return; // let the browser handle it normally — network only
  }

  const isDocument = req.mode === 'navigate' || req.destination === 'document';

  if (isDocument) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        try {
          const fresh = await fetch(req);
          if (fresh.ok) cache.put(req, fresh.clone());
          return fresh;
        } catch {
          const cached = await cache.match(req);
          return cached || new Response('Offline and not cached yet.', { status: 503, statusText: 'Offline' });
        }
      })
    );
    return;
  }

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(req);
      const networkFetch = fetch(req)
        .then((res) => {
          if (res.ok) cache.put(req, res.clone());
          return res;
        })
        .catch(() => null);

      if (cached) {
        // Serve the cached copy immediately; refresh it in the background for next time.
        event.waitUntil(networkFetch);
        return cached;
      }
      const fresh = await networkFetch;
      return fresh || new Response('Offline and not cached yet.', { status: 503, statusText: 'Offline' });
    })
  );
});
