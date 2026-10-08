// Shiv Print: catches files shared to it from Android's share menu.
//
// Android hands a share to this app as a POST to /share. A static site cannot
// take a POST, so the worker takes it: the files go into a cache, and the app
// opens on /?shared=1 and picks them up from there. Nothing else is cached —
// printing needs the internet anyway.
const SHARED = 'shiv-print-shared'

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (event.request.method !== 'POST' || url.pathname !== '/share') return
  event.respondWith((async () => {
    const form = await event.request.formData()
    const files = form.getAll('files').filter((f) => f && typeof f === 'object' && f.size > 0)
    const cache = await caches.open(SHARED)
    for (const key of await cache.keys()) await cache.delete(key)
    let i = 0
    for (const file of files) {
      i += 1
      await cache.put(`/shared/${i}`, new Response(file, {
        headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name || `file-${i}`) },
      }))
    }
    return Response.redirect('/?shared=1', 303)
  })())
})
