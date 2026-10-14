import React from 'react'
import ReactDOM from 'react-dom/client'
import { ConvexProvider, ConvexReactClient } from 'convex/react'
import App from './App.jsx'
import { PinGate } from './deviceTrust/PinGate.jsx'
import './index.css'

// The shop's one deployment, baked in as a fallback like the other sites, so a
// forgotten environment variable cannot ship a dead build.
const CONVEX_URL = import.meta.env.VITE_CONVEX_URL || 'https://sensible-panther-176.convex.cloud'
const convex = new ConvexReactClient(CONVEX_URL)

// Installed, the app checks for a new deploy whenever it comes back to the front.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then((registration) => {
      const check = () => {
        if (navigator.onLine && document.visibilityState === 'visible') void registration.update().catch(() => undefined)
      }
      document.addEventListener('visibilitychange', check)
      addEventListener('online', check)
      check()
    }).catch(() => undefined)
  })
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ConvexProvider client={convex}>
      {/* The shop PIN once per device (Shiv_Panel convex/devices.ts): the net
          rates are what the shop pays, not for a customer's eyes. */}
      <PinGate convexUrl={CONVEX_URL} app="Price List" client={convex}>
        <App />
      </PinGate>
    </ConvexProvider>
  </React.StrictMode>,
)
