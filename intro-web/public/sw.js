// The service worker: enables install, and keeps the app to open with when
// there is no internet. Network-first, so a deploy is picked up immediately.
// Nothing about customers is kept here: the list is read live.
const SW_VERSION = '2026-11-05a-shiv-intro'
const SHELL = `intro-shell-${SW_VERSION}`

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k)))
    await self.clients.claim()
  })())
})

async function shell(request) {
  try {
    const res = await fetch(request)
    if (res.ok) caches.open(SHELL).then((cache) => cache.put(request, res.clone())).catch(() => {})
    return res
  } catch {
    const cache = await caches.open(SHELL)
    const kept = (await cache.match(request)) ?? (request.mode === 'navigate' ? await cache.match('/') : undefined)
    return kept ?? new Response('Offline. Please reconnect and try again.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    })
  }
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (url.origin !== self.location.origin || event.request.method !== 'GET') return
  event.respondWith(shell(event.request))
})
