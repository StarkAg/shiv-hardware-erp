// Network first: the figures are live. The app shell and its lettering are
// kept so it still opens on a weak line. Bump SW_VERSION to drop old shells.
const SW_VERSION = '2026-10-23-1'
const SHELL = `shiv-money-${SW_VERSION}`

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== SHELL) await caches.delete(key)
    await self.clients.claim()
  })())
})
self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return
  event.respondWith((async () => {
    try {
      const res = await fetch(req)
      if (res.ok) { const cache = await caches.open(SHELL); cache.put(req, res.clone()) }
      return res
    } catch {
      const hit = await caches.match(req)
      return hit ?? new Response('Offline. Reconnect and try again.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
    }
  })())
})
