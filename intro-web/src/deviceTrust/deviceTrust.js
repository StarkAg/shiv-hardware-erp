/**
 * This device's place on the shop's trusted list (convex/devices.ts).
 *
 * The shop PIN is asked once; the server answers with a signed token, kept
 * here, and every call to the server carries it. Removed from the list on the
 * Trusted devices page, the device is refused and asks for the PIN again, and
 * only then: a refusal that may be the server's own hiccup (a deploy, a key
 * file it could not read for a moment) is checked before the token is let go.
 *
 * Kept twice, in localStorage and in IndexedDB, and the phone is asked to
 * keep this site's storage for good (`navigator.storage.persist`), so a phone
 * tidying up space does not quietly forget it.
 *
 * One PIN for all the shop's apps on a phone: a trusted app opens another
 * with a one-time pass in the link (`openApp`), which the other app uses
 * (`usePassInLink`) instead of asking.
 *
 * SOURCE: src/lib/deviceTrust/ in Shiv_Panel. The small apps carry copies made
 * by `node scripts/copy-device-trust.mjs`; change it here and run that.
 */

const KEY = 'shiv-device-token'
const DB = 'shiv-device'
const forgotten = new Set()

/** The shop's apps, as the list after the PIN shows them. `app` is the name each gives its PIN screen. */
export const SHOP_APPS = [
  { app: 'Panel', name: 'Panel', url: 'https://shiv-panel.vercel.app/' },
  { app: 'Counter', name: 'Counter', url: 'https://shivhardware-counter.vercel.app/' },
  { app: 'Cash', name: 'Cashier', url: 'https://shivhardware-cash.vercel.app/' },
  { app: 'Accounts', name: 'Shiv Accounts', url: 'https://shivhardware-khata.vercel.app/' },
  { app: 'Workshop', name: 'Workshop', url: 'https://shivhardware-workshop.vercel.app/' },
  { app: 'Workshop Counter', name: 'Workshop Counter', url: 'https://shivhardware-workshop-counter.vercel.app/' },
  { app: 'Mechanic', name: 'Shiv Mechanic', url: 'https://shivhardware-mechanic.vercel.app/' },
  { app: 'Inventory', name: 'Inventory', url: 'https://shivhardware-inventory.vercel.app/' },
  { app: 'Stock', name: 'Stock', url: 'https://shivhardware-stock.vercel.app/' },
  { app: 'Orders', name: 'Orders', url: 'https://order-web-tan.vercel.app/' },
  { app: 'Mica', name: 'Mica Match', url: 'https://shivhardware-mica.vercel.app/' },
  { app: 'Attendance', name: 'Attendance', url: 'https://shivhardware-attendance.vercel.app/' },
  { app: 'Vouchers', name: 'Voucher Bill Shooter', url: 'https://shivhardware-voucher.vercel.app/' },
  { app: 'Sort', name: 'Sort', url: 'https://shivhardware-sort.vercel.app/' },
  { app: 'Print', name: 'Shiv Print', url: 'https://shivhardware-print.vercel.app/' },
  { app: 'Price List', name: 'Price List', url: 'https://shivhardware-prices.vercel.app/' },
]

export function deviceToken() {
  try { return localStorage.getItem(KEY) || null } catch { return null }
}

/** The second copy, in IndexedDB: read, written or cleared. */
function second(mode, value) {
  return new Promise((resolve) => {
    try {
      const open = indexedDB.open(DB, 1)
      open.onupgradeneeded = () => open.result.createObjectStore('keys')
      open.onerror = () => resolve(null)
      open.onsuccess = () => {
        try {
          const tx = open.result.transaction('keys', mode === 'get' ? 'readonly' : 'readwrite')
          const store = tx.objectStore('keys')
          const req = mode === 'get' ? store.get(KEY) : mode === 'put' ? store.put(value, KEY) : store.delete(KEY)
          req.onsuccess = () => resolve(mode === 'get' ? req.result ?? null : true)
          req.onerror = () => resolve(null)
        } catch { resolve(null) }
      }
    } catch { resolve(null) }
  })
}

/** Asks the phone to keep this site's storage for good. Chrome on Android and Windows says yes to an app it knows. */
function holdOn() {
  try { void navigator.storage?.persist?.() } catch { /* not offered here */ }
}

function keep(token) {
  try { localStorage.setItem(KEY, token) } catch { /* the second copy still has it */ }
  void second('put', token)
  holdOn()
}

/**
 * The token, wherever it survived: localStorage, else the IndexedDB copy
 * (put back in localStorage). Null when this app was never trusted here.
 */
export async function recoverToken() {
  const kept = deviceToken()
  if (kept) { holdOn(); void second('put', kept); return kept }
  const copy = await second('get')
  if (typeof copy === 'string' && copy) {
    try { localStorage.setItem(KEY, copy) } catch { /* reads go to the copy */ }
    holdOn()
    return copy
  }
  return null
}

/** Drops the token: the server said this device is no longer trusted. */
export function forgetDevice() {
  try { localStorage.removeItem(KEY) } catch { /* nothing kept */ }
  void second('delete')
  for (const fn of forgotten) fn()
}

export function onForgotten(fn) {
  forgotten.add(fn)
  return () => forgotten.delete(fn)
}

/** "Chrome on Windows · Cash" — what the list calls a device until it is renamed. */
export function deviceName(app) {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent
  const browser = /Electron/.test(ua) ? 'Desktop app'
    : typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.() ? 'Android app'
    : /Edg\//.test(ua) ? 'Edge'
    : /SamsungBrowser/.test(ua) ? 'Samsung Internet'
    : /Firefox\//.test(ua) ? 'Firefox'
    : /Chrome\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) ? 'Safari'
    : 'Browser'
  const os = /iPhone/.test(ua) ? 'iPhone'
    : /iPad/.test(ua) ? 'iPad'
    : /Android/.test(ua) ? 'Android'
    : /Windows/.test(ua) ? 'Windows'
    : /Mac OS X/.test(ua) ? 'Mac'
    : /Linux/.test(ua) ? 'Linux'
    : ''
  return `${browser}${os ? ` on ${os}` : ''} · ${app}`
}

async function call(convexUrl, kind, path, args, token) {
  const res = await fetch(`${convexUrl.replace(/\/+$/, '')}/api/${kind}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ path, args, format: 'json' }),
  })
  const body = await res.json().catch(() => null)
  if (body?.status === 'success') return body.value
  const err = new Error(body?.errorMessage || `The server answered ${res.status}.`)
  err.status = res.status
  throw err
}

/** Gives the PIN; on success the device is trusted from now on. */
export async function trustDevice(convexUrl, pin, app) {
  const res = await call(convexUrl, 'action', 'devices:trust', { pin, name: deviceName(app), app })
  if (!res?.ok) return { ok: false, error: res?.error || 'Not trusted.' }
  keep(res.token)
  return { ok: true }
}

/**
 * Whether the server still trusts this device: true, false (it was removed
 * from the list, or its token can never be read again), or null when it could
 * not be told (offline, or the server busy for a moment).
 *
 * A token the server will not read is asked about a few times over a minute
 * before it counts as false: while a deploy goes out, the server can fail to
 * read every token for a few seconds, and letting the token go then is what
 * used to ask phones for the PIN after an update.
 */
export async function stillTrusted(convexUrl, { patient = false } = {}) {
  const token = deviceToken()
  if (!token) return false
  const tries = patient ? 6 : 1
  for (let i = 0; i < tries; i++) {
    try {
      const me = await call(convexUrl, 'query', 'devices:me', {}, token)
      return !!me?.trusted
    } catch (err) {
      const refused = err?.status === 401 || err?.status === 403
      if (!refused) return null
      if (i === tries - 1) return false
      await new Promise((resolve) => setTimeout(resolve, 10_000))
    }
  }
  return null
}

/**
 * For a ConvexReactClient: every call carries the token. One the server will
 * not take is checked patiently (stillTrusted) and let go only if the device
 * really is off the list; otherwise the client is given it again.
 */
export function authorizeClient(client, convexUrl) {
  let checking = false
  client.setAuth(
    async () => deviceToken(),
    (accepted) => {
      if (accepted || !deviceToken() || checking || !convexUrl) return
      checking = true
      void stillTrusted(convexUrl, { patient: true }).then((ok) => {
        checking = false
        if (ok === false) forgetDevice()
        else authorizeClient(client, convexUrl)
      })
    },
  )
}

/**
 * Opens another of the shop's apps, trusted on this phone without its PIN:
 * a one-time pass is made and carried in the link, after the #. The window is
 * opened first, at the tap, so the phone does not take it for a pop-up.
 */
export async function openApp(convexUrl, target) {
  const win = window.open('', '_blank')
  try {
    const code = await call(convexUrl, 'mutation', 'devices:pass', { app: target.app }, deviceToken())
    const url = `${target.url}#pass=${code}`
    if (win) win.location.href = url
    else window.location.href = url
  } catch {
    if (win) win.location.href = target.url
    else window.location.href = target.url
  }
}

/**
 * A pass in this page's link, from another of the shop's apps, taken out of
 * the address the moment this file loads: before an app's router reads the
 * part after the # as a page, and so it is never bookmarked or shared.
 */
let linkPass = null
try {
  const match = /(?:^|[#&])pass=([0-9a-f]{16,64})/.exec(window.location.hash)
  if (match) {
    linkPass = match[1]
    const rest = window.location.hash.replace(/(^#|&)pass=[0-9a-f]+/, '').replace(/^#?&?/, '')
    history.replaceState(history.state, '', `${window.location.pathname}${window.location.search}${rest ? `#${rest}` : ''}`)
  }
} catch { /* no window: nothing to take */ }

/** Uses up the pass the link came with, to trust this app. True when this app is now trusted. */
export async function usePassInLink(convexUrl, app) {
  const code = linkPass
  linkPass = null
  if (!code) return false
  try {
    const res = await call(convexUrl, 'action', 'devices:trustByPass', { code, name: deviceName(app), app })
    if (!res?.ok) return false
    keep(res.token)
    return true
  } catch {
    return false
  }
}

/** An iPhone or iPad reading this in Safari, not from its Home Screen icon. */
export const inIosSafari = () => {
  if (typeof navigator === 'undefined') return false
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  return ios && !navigator.standalone && !window.matchMedia?.('(display-mode: standalone)').matches
}

/** For a ConvexHttpClient: call before using it, so it carries the current token. */
export function authorizeHttp(client) {
  const token = deviceToken()
  if (token) client.setAuth(token)
  else client.clearAuth()
  return client
}
