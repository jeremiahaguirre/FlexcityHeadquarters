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

// Push notifications. The server sends only a short title and body (never sensitive details);
// tapping opens the screen it's about, reusing an open window when there is one.
self.addEventListener('push', (event) => {
  let n = { title: 'FlexcityHeadquarters', body: '', link: '/', tag: 'fh', urgent: false };
  try {
    n = { ...n, ...event.data.json() };
  } catch {}
  event.waitUntil(
    self.registration.showNotification(n.title, {
      body: n.body,
      tag: n.tag,
      renotify: n.urgent,
      requireInteraction: n.urgent,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      vibrate: n.urgent ? [300, 100, 300, 100, 300] : [100],
      data: { link: n.link },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const raw = (event.notification.data && event.notification.data.link) || '/';
  // Only places inside the app.
  const target = new URL(raw.startsWith('/') && !raw.startsWith('//') ? raw : '/', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const open = list.find((c) => new URL(c.url).origin === self.location.origin);
      if (open) return open.focus().then((c) => (c && 'navigate' in c ? c.navigate(target) : undefined));
      return self.clients.openWindow(target);
    }),
  );
});

// When the browser rotates the push keys, the app sends the new subscription the next time it opens
// (the worker has no sign-in of its own, by design).
