// Shiv Print: catches files shared to it from Android's share menu, and sends
// them to the shop's printer by itself.
//
// Android hands a share to this app as a POST to /share, which opens a window.
// A static site cannot take a POST, so the worker does — and, when the app has
// been opened once on this phone (so the worker holds the shop key, see
// src/workerStore.js), it answers with a page that closes at once and goes on
// sending the files in the background: shrunk to print size, uploaded, put in
// the print queue with colour left to the shop PC ("auto"). The phone hears
// how it went as notifications: "Sent", then "Printing…" and "Printed ✓" from
// the print server.
//
// Without the key, with "Print as soon as shared" off, or when sending fails,
// the files go into a cache and the app opens on /?shared=1 to pick them up.
const SHARED = 'shiv-print-shared'
const PRINT_LONG_SIDE = 3000

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

/* ── what the app left for the worker (src/workerStore.js) ─────────────── */

function kv(key) {
  return new Promise((resolve) => {
    const req = indexedDB.open('shiv-print', 1)
    req.onupgradeneeded = () => req.result.createObjectStore('kv')
    req.onerror = () => resolve(undefined)
    req.onsuccess = () => {
      try {
        const get = req.result.transaction('kv').objectStore('kv').get(key)
        get.onsuccess = () => { resolve(get.result); req.result.close() }
        get.onerror = () => { resolve(undefined); req.result.close() }
      } catch { resolve(undefined) }
    }
  })
}

/* ── sending ───────────────────────────────────────────────────────────── */

async function call(convexUrl, token, path, args) {
  const res = await fetch(`${convexUrl.replace(/\/+$/, '')}/api/mutation`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ path, args, format: 'json' }),
  })
  const body = await res.json().catch(() => ({}))
  if (body.status === 'success') return body.value
  const data = body.errorData
  const err = new Error((typeof data === 'string' ? data : data?.message) || body.errorMessage || `The shop did not answer (${res.status})`)
  err.untrusted = data?.code === 'untrusted'
  throw err
}

/** A photo as big as a printed page needs, as a JPEG; anything else as it is. */
async function forPrint(file) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 1_200_000 || typeof OffscreenCanvas === 'undefined') return file
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    const scale = Math.min(1, PRINT_LONG_SIDE / Math.max(bitmap.width, bitmap.height))
    const canvas = new OffscreenCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale))
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close?.()
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.88 })
    if (blob.size >= file.size) return file
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' })
  } catch {
    return file
  }
}

async function pushAddress() {
  try {
    const sub = await self.registration.pushManager.getSubscription()
    const json = sub?.toJSON()
    return json?.endpoint && json.keys?.p256dh && json.keys?.auth
      ? { endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } }
      : null
  } catch {
    return null
  }
}

function notify(title, body, extra = {}) {
  return self.registration.showNotification(title, {
    body, icon: '/icon-192.png', badge: '/icon-192.png', ...extra,
  }).catch(() => undefined)
}

async function stash(files) {
  const cache = await caches.open(SHARED)
  for (const key of await cache.keys()) await cache.delete(key)
  let i = 0
  for (const file of files) {
    i += 1
    await cache.put(`/shared/${i}`, new Response(file, {
      headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name || `file-${i}`) },
    }))
  }
}

async function sendInBackground(files, convexUrl, token) {
  const label = files.length === 1 ? files[0].name : `${files.length} files`
  try {
    const [uploaded, address] = await Promise.all([
      Promise.all(files.map(async (original) => {
        const file = await forPrint(original)
        const url = await call(convexUrl, token, 'files:generateUploadUrl', {})
        const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': file.type }, body: file })
        if (!res.ok) throw new Error(`${original.name} did not upload`)
        const { storageId } = await res.json()
        return { storageId, name: file.name, mediaType: file.type }
      })),
      pushAddress(),
    ])
    const id = await call(convexUrl, token, 'printJobs:sendFiles', {
      files: uploaded, mode: 'auto', copies: 1, ...(address ? { notify: address } : {}),
    })
    await notify('Sent to the shop', `${label} — colour decided at the shop`, { tag: String(id) })
  } catch (err) {
    // Kept, so a tap on the notification opens the app with them, ready to send again.
    await stash(files)
    await notify(
      err.untrusted ? 'Shiv Print needs the PIN' : 'Not sent',
      err.untrusted ? 'Open Shiv Print and enter the shop PIN, then share again.' : `${label}: ${err.message}. Tap to try again.`,
      { tag: 'shiv-print-error', data: { open: '/?shared=1' } },
    )
  }
}

// The page the share opens: a moment's "Sending ✓" so it is seen to have
// worked, then gone, while the worker sends.
const SHOWN_MS = 700
const CLOSE_PAGE = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#b98f4b"><title>Shiv Print</title>
<style>html,body{height:100%;margin:0;background:#f4f1ea;color:#1c1917;font:700 18px system-ui,sans-serif;display:grid;place-items:center;text-align:center}
@media (prefers-color-scheme:dark){html,body{background:#15140f;color:#f5f5f4}}
.mark{position:relative;width:84px;height:84px;margin:0 auto 14px}.mark img{width:84px;height:84px;border-radius:20px}
.tick{position:absolute;right:-8px;bottom:-8px;width:36px;height:36px;border-radius:50%;background:#15803d;display:grid;place-items:center;box-shadow:0 0 0 4px #f4f1ea;animation:pop .28s ease-out}
.tick svg{width:20px;height:20px}small{display:block;margin-top:6px;font-weight:500;font-size:13px;opacity:.65}
@keyframes pop{from{transform:scale(.4);opacity:0}to{transform:scale(1);opacity:1}}</style></head>
<body><div><div class="mark"><img src="/icon-192.png" alt=""><span class="tick"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></span></div>
Sending to the shop<small>Your phone will say when it has printed</small></div>
<script>setTimeout(function(){window.close();setTimeout(function(){history.length>1&&history.back()},300)},${SHOWN_MS})</script></body></html>`

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (event.request.method !== 'POST' || url.pathname !== '/share') return
  event.respondWith((async () => {
    const form = await event.request.formData()
    const files = form.getAll('files').filter((f) => f && typeof f === 'object' && f.size > 0)
    const [token, convexUrl, auto] = await Promise.all([kv('token'), kv('convexUrl'), kv('auto')])
    if (!files.length || !token || !convexUrl || auto === false) {
      await stash(files)
      return Response.redirect('/?shared=1', 303)
    }
    // Kept alive until the files are sent, after the window has gone.
    event.waitUntil(sendInBackground(files, convexUrl, token))
    return new Response(CLOSE_PAGE, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
  })())
})

/* ── notifications ─────────────────────────────────────────────────────── */

// "Printing…" and "Printed ✓" (or why not), pushed by the print server on the
// shop PC — shown with Shiv Print closed.
self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch { data = { title: 'Shiv Print', body: event.data?.text() ?? '' } }
  event.waitUntil(notify(data.title || 'Shiv Print', data.body || '', { tag: data.tag, renotify: true }))
})

// A tap opens Shiv Print — with the files ready to send again after a failure.
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = event.notification.data?.open || '/'
  event.waitUntil((async () => {
    const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    if (open[0] && target === '/') return open[0].focus()
    return self.clients.openWindow(target)
  })())
})
