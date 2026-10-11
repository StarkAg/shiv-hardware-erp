// The service worker: enables install, takes what the phone's Share menu
// sends, and keeps the app to open with when there is no internet.
//
//   - A share arrives as a POST to /share (see share_target in the manifest).
//     Only this worker can read it: the photo (or text) is put aside in the
//     phone's own store and the app is opened to pick it up. Nothing is sent
//     anywhere; the QR is read on the phone.
//   - The app itself is network-first, so a deploy is picked up immediately;
//     the last copy is kept only to open with when there is no internet.
const SW_VERSION = '2026-10-11b-qr-pay'
const SHELL = `pay-shell-${SW_VERSION}`
// Same names as src/shared.js.
const SHARED = 'pay-shared-v1'
const SHARED_PHOTO = '/shared-qr'
const SHARED_TEXT = '/shared-text'

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(keys.filter((k) => k !== SHARED && k !== SHELL).map((k) => caches.delete(k)))
    await self.clients.claim()
  })())
})

/** What the Share menu sent: put aside, then the app is opened on it. */
async function receive(request) {
  try {
    const form = await request.formData()
    const photo = form.getAll('qr').find((f) => f instanceof File && f.size > 0)
    const text = ['text', 'url', 'title'].map((k) => form.get(k)).filter((v) => typeof v === 'string' && v).join('\n')
    const cache = await caches.open(SHARED)
    await Promise.all([cache.delete(SHARED_PHOTO), cache.delete(SHARED_TEXT)])
    if (photo) await cache.put(SHARED_PHOTO, new Response(photo, { headers: { 'Content-Type': photo.type || 'image/jpeg' } }))
    if (text) await cache.put(SHARED_TEXT, new Response(text, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } }))
  } catch { /* the app says nothing came through */ }
  return Response.redirect('/?shared=1', 303)
}

/** The app's own files: the network's copy, and the last one kept to open with when there is no internet. */
async function shell(request) {
  try {
    const res = await fetch(request)
    if (res.ok) caches.open(SHELL).then((cache) => cache.put(request, res.clone())).catch(() => {})
    return res
  } catch {
    const cache = await caches.open(SHELL)
    const kept = (await cache.match(request)) ?? (request.mode === 'navigate' ? await cache.match('/') : undefined)
    // respondWith() must always receive a Response. Safari reports an error
    // when a network miss has no matching cached response.
    return kept ?? new Response('Offline. Please reconnect and try again.', {
      status: 503,
      statusText: 'Service Unavailable',
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    })
  }
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (url.origin !== self.location.origin) return
  if (event.request.method === 'POST' && url.pathname === '/share') event.respondWith(receive(event.request))
  else if (event.request.method === 'GET') event.respondWith(shell(event.request))
})
