/**
 * "Printed" on the phone, with Shiv Print closed.
 *
 * The phone signs up for web-push messages with the shop PC's public key and
 * sends its address along with each print (convex/printJobs.ts sendFiles,
 * `notify`); the print server pushes the outcome to that address when it is
 * done (print-server/server.mjs tellPhone), and the worker shows it
 * (public/sw.js).
 */

// The print server's public web-push key (its private half is in
// print-server/.env.local). Public by design.
const VAPID_PUBLIC_KEY = 'BI-CsJ7KXI8l1f1VxSWdx0_z274YXfYyqdD86K7tr3U8s48b0S9U3j4bAMXEszQoltFhJWky85CY_JOJsXfWZEA'

const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

/**
 * An iPhone gives a web app notifications only once it is on the Home Screen
 * (Share → Add to Home Screen) and opened from there.
 */
const iPhoneNotInstalled = () =>
  /iPhone|iPad|iPod/.test(navigator.userAgent) && !(matchMedia('(display-mode: standalone)').matches || navigator.standalone)

export const notificationsState = () => (iPhoneNotInstalled() ? 'install-first' : supported() ? Notification.permission : 'unsupported')

function keyBytes(base64) {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0))
}

/** Asks once (it must follow a tap); true when the phone will be told. */
export async function turnOnNotifications() {
  if (!supported()) return false
  const answer = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission
  return answer === 'granted' && Boolean(await pushAddress())
}

/** This phone's push address, signing up if it has none yet; null when notifications are off. */
export async function pushAddress() {
  if (!supported() || Notification.permission !== 'granted') return null
  try {
    const registration = await navigator.serviceWorker.ready
    const sub = await registration.pushManager.getSubscription()
      ?? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC_KEY) })
    const json = sub.toJSON()
    return json.endpoint && json.keys?.p256dh && json.keys?.auth
      ? { endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } }
      : null
  } catch {
    return null
  }
}

/** A notification shown at once, by this phone itself ("Sent to the shop"). */
export async function showLocal(title, body, tag) {
  if (!supported() || Notification.permission !== 'granted') return
  try {
    const registration = await navigator.serviceWorker.ready
    await registration.showNotification(title, { body, tag, icon: '/icon-192.png', badge: '/icon-192.png' })
  } catch { /* nothing shown */ }
}
