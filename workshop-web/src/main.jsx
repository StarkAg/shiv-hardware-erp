import React from 'react'
import ReactDOM from 'react-dom/client'
import { ConvexProvider, ConvexReactClient } from 'convex/react'
import App from './App.jsx'
import { PinGate } from './deviceTrust/PinGate.jsx'
import { APP_NAME } from './side.js'
import './index.css'

const CONVEX_URL = import.meta.env.VITE_CONVEX_URL || 'https://sensible-panther-176.convex.cloud'
const convex = new ConvexReactClient(CONVEX_URL)

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ConvexProvider client={convex}>
      {/* Work orders and site measurements: the shop PIN, once on this phone. */}
      <PinGate convexUrl={CONVEX_URL} app={APP_NAME} client={convex}>
        <App />
      </PinGate>
    </ConvexProvider>
  </React.StrictMode>,
)

// On the computer while it is being worked on (npm run dev), no phone copy:
// the kept files would be served instead of the ones just changed, half old
// and half new, and the page comes up blank. Any copy left from before goes.
if (import.meta.env.DEV && 'serviceWorker' in navigator) {
  void navigator.serviceWorker.getRegistrations().then((all) => Promise.all(all.map((r) => r.unregister())))
  if ('caches' in window) void caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('workshop-shell-')).map((k) => caches.delete(k))))
}
if (!import.meta.env.DEV && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}) })
  // The app opens from the phone's copy (public/sw.js). When a newer one has
  // come down, it is put in use the next time the app comes back after ten
  // minutes away, never under a finger. What is still being sent is kept
  // through it (outbox.js).
  let fresh = false
  let away = 0
  navigator.serviceWorker.addEventListener('message', (e) => { if (e.data?.type === 'fresh') fresh = true })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') away = Date.now()
    else if (fresh && away && Date.now() - away > 10 * 60_000) window.location.reload()
  })
}
