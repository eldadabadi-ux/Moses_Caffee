self.addEventListener('install', () => { self.skipWaiting(); });

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try { await self.clients.claim(); } catch (_) {}
    try {
      const names = await caches.keys();
      await Promise.all(names.map((n) => caches.delete(n)));
    } catch (_) {}
  })());
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const isNav = event.request.mode === 'navigate';
  event.respondWith(
    fetch(event.request, { cache: isNav ? 'no-store' : 'default' })
      .catch(() => new Response('', { status: 503 }))
  );
});
