/* ForiForeign service worker.
 *
 * The installed home-screen app must never run yesterday's build. Three rules make that
 * true: the shell is always fetched from the network first, a new worker takes over the
 * moment it installs instead of waiting for every tab to close, and the open page is
 * told when that happens so it can reload itself.
 */
const C = 'ff-v3';

self.addEventListener('install', e => {
  e.waitUntil(caches.open(C).then(c => c.addAll(['/'])).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== C).map(k => caches.delete(k)));
    // Take control of already-open tabs and the installed app window right now, rather
    // than on the next cold start, which on a phone may be days away.
    await self.clients.claim();
    const cl = await self.clients.matchAll({ type: 'window' });
    cl.forEach(c => c.postMessage({ type: 'FF_SW_UPDATED' }));
  })());
});

self.addEventListener('message', e => {
  if (e.data && e.data.type === 'FF_SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.pathname.startsWith('/api') || u.pathname.startsWith('/auth')) return;
  /* Network first, always. The cache exists only so the app opens offline; it must never
     be the reason someone sees an old build. */
  e.respondWith(
    fetch(e.request).then(r => {
      const cp = r.clone();
      caches.open(C).then(c => c.put(e.request, cp)).catch(() => {});
      return r;
    }).catch(() => caches.match(e.request))
  );
});
