// Keep only this app's static shell. Customer orders and drafts are stored by
// the app; cross-origin requests, including Convex, are never cached here.
const CACHE = 'shiv-mechanic-v1'
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(['/', '/index.html', '/icon-192.png', '/manifest.webmanifest'])))
  // An update waits until the existing app closes, preserving unsent input.
})
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith('shiv-mechanic-') && key !== CACHE) await caches.delete(key)
    await self.clients.claim()
  })())
})
self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return
  event.respondWith((async () => {
    const cache = await caches.open(CACHE)
    try {
      const response = await fetch(request)
      if (response.ok && (request.mode === 'navigate' || ['script', 'style', 'image', 'manifest', 'font'].includes(request.destination))) {
        await cache.put(request, response.clone())
      }
      return response
    } catch {
      return (await cache.match(request)) || (request.mode === 'navigate' && await cache.match('/index.html'))
        || new Response('Reconnect to load this file.', { status: 503 })
    }
  })())
})
