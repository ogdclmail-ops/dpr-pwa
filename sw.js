// Minimal service worker -- just enough to satisfy PWA install criteria.
//
// Strategy: NETWORK-FIRST. Always try to fetch the latest version; only
// fall back to the cached copy if the device is offline. The previous
// version did the opposite (cache-first), which meant once a file was
// cached, updates were invisible forever -- a real bug, not a caching
// quirk. This app depends on live Supabase data anyway, so there's no
// real benefit to an offline-first shell; freshness matters more here.
const CACHE_NAME = 'field-production-shell-v2';
const SHELL_FILES = ['./', './index.html', './styles.css', './app.js', './config.js', './manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Never cache Supabase requests -- production data must always be live.
  if (event.request.url.includes('supabase.co')) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
