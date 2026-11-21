// No offline copy any more (Tony, 21 Nov 2026): the app always opens fresh
// from the site, so a deploy is in use the moment it is opened.
//
// This worker is only here to take away the one phones already have: when a
// phone next opens the app, its old worker finds this newer one, which throws
// away every copy kept (the app's files and the photos), takes itself off, and
// reloads the open windows from the site.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil((async () => {
  const keys = await caches.keys()
  await Promise.all(keys.map((k) => caches.delete(k)))
  await self.registration.unregister()
  for (const client of await self.clients.matchAll({ type: 'window' })) client.navigate(client.url)
})()))
