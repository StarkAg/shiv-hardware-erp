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

// "Printed ✓" (or why not), pushed by the print server on the shop PC once a
// shared print is done — shown with Shiv Print closed.
self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch { data = { title: 'Shiv Print', body: event.data?.text() ?? '' } }
  event.waitUntil(self.registration.showNotification(data.title || 'Shiv Print', {
    body: data.body || '',
    tag: data.tag,
    renotify: true,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
  }))
})

// A tap on it opens Shiv Print, where the job's line says the same.
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil((async () => {
    const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    if (open[0]) return open[0].focus()
    return self.clients.openWindow('/')
  })())
})
