// FlexcityHeadquarters service worker: keeps the app shell and the last
// rosters available on the pool deck when the connection drops.
// Network first, cache as fallback; never caches anything but GETs.
// v2: v1 also kept people's own pay, documents and HR files on the device; those caches are deleted.
const CACHE = 'fh-v2';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) =>
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  ),
);

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Only what the deck needs offline: who you are and your class rosters. Pay, documents, HR files
  // and everything else stay live and are never written to the device.
  const api = url.pathname.startsWith('/api/');
  if (api && url.pathname !== '/api/me' && !url.pathname.startsWith('/api/me/lessons')) return;
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
