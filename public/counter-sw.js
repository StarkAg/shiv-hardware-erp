// The counter, installed on a phone, opens at once and keeps working on a bad
// signal: pages come from the network when it answers and from the last copy
// when it does not; the build's hashed files are kept once fetched, since a
// new build brings new names. Nothing here holds quotations — those live in
// the app and the shop's database.
const CACHE = 'shiv-counter-v1'

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key)
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== self.location.origin) return
  if (url.pathname === '/counter-sw.js') return

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE)
      try {
        const response = await fetch(request, { cache: 'no-store' })
        if (response.ok) await cache.put('/', response.clone())
        return response
      } catch {
        return (await cache.match('/')) ?? Response.error()
      }
    })())
    return
  }

  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/counter/')) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE)
      const hit = await cache.match(request)
      if (hit) return hit
      const response = await fetch(request)
      if (response.ok) await cache.put(request, response.clone())
      return response
    })())
  }
})
