/**
 * OpenFile service worker — runtime caching so the app (including the ~7MB Stockfish engine)
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
const CACHE_NAME = 'openfile-v1';

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

// How long a navigation waits for the network before falling back to the cached page. "Offline"
// isn't the only failure mode that matters here — the venue this app is explicitly built for (a
// tournament hall on saturated wifi) more often produces a connection that accepts the request and
// then stalls, which `fetch` will sit on for the browser's own timeout (tens of seconds) without
// ever rejecting. Without this bound, network-first means the page hangs on a white screen in
// exactly the situation the offline cache exists for.
const DOC_NETWORK_TIMEOUT_MS = 4000;

/** cache.put() rejects on a 206 Partial Content response and on QuotaExceededError (plausible here
 *  — the cached engine alone is ~7MB). Both were previously floating promises, surfacing as
 *  unhandled rejections in the SW rather than being ignored as intended. Caching is best-effort by
 *  design, so swallow the failure and let the response through untouched either way. */
function cachePut(cache, req, res) {
  if (!res.ok || res.status === 206) return;
  cache.put(req, res.clone()).catch(() => {});
}

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
        const network = fetch(req).then((fresh) => {
          cachePut(cache, req, fresh);
          return fresh;
        });
        try {
          // Race the network against the timeout, but only let the timeout win when there's
          // actually something cached to fall back to — with no cached copy, a slow response is
          // still infinitely better than an error page, so keep waiting for it.
          const cached = await cache.match(req);
          if (!cached) return await network;
          const timeout = new Promise((resolve) => setTimeout(() => resolve(null), DOC_NETWORK_TIMEOUT_MS));
          const winner = await Promise.race([network.catch(() => null), timeout]);
          if (winner) return winner;
          // Timed out or failed — serve the cached page now and keep the request alive so the
          // fresh copy still lands in the cache for next time.
          event.waitUntil(network.catch(() => {}));
          return cached;
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
          cachePut(cache, req, res);
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
