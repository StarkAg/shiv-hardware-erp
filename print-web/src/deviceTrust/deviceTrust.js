/**
 * This device's place on the shop's trusted list (convex/devices.ts).
 *
 * The shop PIN is asked once; the server answers with a signed token, kept
 * here, and every call to the server carries it. Removed from the list on the
 * Trusted devices page, the device is refused and asks for the PIN again.
 *
 * SOURCE: src/lib/deviceTrust/ in Shiv_Panel. The small apps carry copies made
 * by `node scripts/copy-device-trust.mjs`; change it here and run that.
 */

const KEY = 'shiv-device-token'
const forgotten = new Set()

export function deviceToken() {
  try { return localStorage.getItem(KEY) || null } catch { return null }
}

function keep(token) {
  try { localStorage.setItem(KEY, token) } catch { /* the token then lasts this visit only */ }
}

/** Drops the token: the server said this device is no longer trusted. */
export function forgetDevice() {
  try { localStorage.removeItem(KEY) } catch { /* nothing kept */ }
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
  throw new Error(body?.errorMessage || `The server answered ${res.status}.`)
}

/** Gives the PIN; on success the device is trusted from now on. */
export async function trustDevice(convexUrl, pin, app) {
  const res = await call(convexUrl, 'action', 'devices:trust', { pin, name: deviceName(app), app })
  if (!res?.ok) return { ok: false, error: res?.error || 'Not trusted.' }
  keep(res.token)
  return { ok: true }
}

/** Whether the server still trusts this device: true, false, or null when it could not be asked. */
export async function stillTrusted(convexUrl) {
  const token = deviceToken()
  if (!token) return false
  try {
    const me = await call(convexUrl, 'query', 'devices:me', {}, token)
    return !!me?.trusted
  } catch {
    // Offline or the token is not accepted at all. A token the server rejects
    // outright (a new key) is caught by the client's own auth callback.
    return null
  }
}

/** For a ConvexReactClient: every call carries the token; a rejected one is dropped. */
export function authorizeClient(client) {
  client.setAuth(
    async () => deviceToken(),
    (accepted) => { if (!accepted && deviceToken()) forgetDevice() },
  )
}

/** For a ConvexHttpClient: call before using it, so it carries the current token. */
export function authorizeHttp(client) {
  const token = deviceToken()
  if (token) client.setAuth(token)
  else client.clearAuth()
  return client
}
