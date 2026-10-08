const PREFIX = 'shiv-mica-shell-'
const CACHE = `${PREFIX}__BUILD_VERSION__`
const CORE = [/* __BUILD_ASSETS__ */]

self.addEventListener('install', event => {
  // Download the complete new app before replacing the working offline copy.
  event.waitUntil(caches.open(CACHE).then(cache =>
    cache.addAll(CORE.map(url => new Request(url, { cache: 'reload' })))
  ).then(() => self.skipWaiting()))
})

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const previous = (await caches.keys()).filter(key => key.startsWith(PREFIX) && key !== CACHE)
    await Promise.all(previous.map(key => caches.delete(key)))
    await self.clients.claim()

    // The chip list lives in the shop's database, so nothing local is lost.
    if (previous.length) {
      const windows = await self.clients.matchAll({ type: 'window' })
      // Navigation fetches wait for activation; awaiting them here deadlocks it.
      for (const client of windows) void client.navigate(client.url).catch(() => undefined)
    }
  })())
})

self.addEventListener('fetch', event => {
  const request = event.request
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== self.location.origin) return
  if (url.pathname === '/sw.js') return
  event.respondWith((async () => {
    const cache = await caches.open(CACHE)
    if (request.mode === 'navigate') {
      try {
        const response = await fetch(request, { cache: 'no-store' })
        if (response.ok) return response
      } catch { /* Use the fully downloaded shell while offline. */ }
      return await cache.match('/index.html') ?? Response.error()
    }
    const cached = await cache.match(request)
    if (cached) return cached
    try {
      const response = await fetch(request)
      if (response.ok && url.pathname.startsWith('/assets/')) await cache.put(request, response.clone())
      return response
    } catch { return Response.error() }
  })())
})
