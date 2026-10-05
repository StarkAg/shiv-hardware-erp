const CACHE = 'shiv-inventory-shell-v1'
const CORE = ['/', '/index.html', '/manifest.webmanifest', '/icon.svg', '/icon-192.png', '/icon-512.png']

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(CORE)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()))
})

self.addEventListener('message', event => {
  if (event.data?.type !== 'cache-shell') return
  const urls = (event.data.urls ?? []).filter(url => {
    try { return new URL(url, self.location.origin).origin === self.location.origin } catch { return false }
  })
  event.waitUntil(caches.open(CACHE).then(cache => Promise.all(urls.map(url => cache.add(url).catch(() => undefined)))))
})

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return
  event.respondWith(caches.match(event.request).then(cached => cached ?? fetch(event.request).then(response => {
    if (response.ok) caches.open(CACHE).then(cache => cache.put(event.request, response.clone()))
    return response
  }).catch(() => event.request.mode === 'navigate' ? caches.match('/index.html') : Response.error())))
})
