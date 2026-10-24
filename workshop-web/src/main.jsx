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

if ('serviceWorker' in navigator) {
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
