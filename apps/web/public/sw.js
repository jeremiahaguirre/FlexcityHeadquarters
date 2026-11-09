// FlexcityHeadquarters service worker: keeps the app shell and the last
// rosters available on the pool deck when the connection drops.
// Network first, cache as fallback; never caches anything but GETs.
const CACHE = 'fh-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Only the screens and data the deck needs offline; other API reads stay live.
  const api = url.pathname.startsWith('/api/');
  if (api && !url.pathname.startsWith('/api/me/lessons') && !url.pathname.startsWith('/api/me')) return;
  if (url.pathname.startsWith('/api/notifications') || url.pathname.startsWith('/api/auth')) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok && (req.mode === 'navigate' || url.pathname.startsWith('/_next/static/') || api)) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match('/lessons') || Response.error())),
  );
});
