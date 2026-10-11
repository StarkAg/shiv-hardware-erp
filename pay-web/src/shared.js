// What the phone's Share menu sent. The service worker puts it aside
// (public/sw.js, same names) and opens the app; the app takes it from here.
const SHARED = 'pay-shared-v1'
const SHARED_PHOTO = '/shared-qr'
const SHARED_TEXT = '/shared-text'

/** The shared photo and text, taken once (a second call finds nothing), or null. */
export async function takeShared() {
  if (!('caches' in window)) return null
  const cache = await caches.open(SHARED)
  const [photo, text] = await Promise.all([cache.match(SHARED_PHOTO), cache.match(SHARED_TEXT)])
  const out = { photo: photo ? await photo.blob() : null, text: text ? await text.text() : '' }
  await Promise.all([cache.delete(SHARED_PHOTO), cache.delete(SHARED_TEXT)])
  return out.photo || out.text ? out : null
}
