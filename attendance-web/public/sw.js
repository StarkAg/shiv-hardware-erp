// Minimal service worker — enables install; network-first (attendance is live data).
// Bump SW_VERSION on deploys that must force every client onto the newest app shell.
const SW_VERSION = '2026-08-02-1'

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Drop any previously cached shell so no stale version can survive an update.
    const keys = await caches.keys()
    await Promise.all(keys.map((k) => caches.delete(k)))
    await self.clients.claim()
    // Force every open window (incl. old ones without update logic) onto the new shell.
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const client of clients) {
      try { await client.navigate(client.url) } catch { /* ignore */ }
    }
  })())
})
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return
  event.respondWith((async () => {
    try {
      return await fetch(event.request)
    } catch {
      const cachedResponse = await caches.match(event.request)
      // respondWith() must always receive a Response. Safari reports an error
      // when a network miss has no matching cached response.
      return cachedResponse ?? new Response('Offline. Please reconnect and try again.', {
        status: 503,
        statusText: 'Service Unavailable',
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-store',
        },
      })
    }
  })())
})
