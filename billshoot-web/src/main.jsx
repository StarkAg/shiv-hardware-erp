import React from 'react'
import ReactDOM from 'react-dom/client'
import { ConvexProvider, ConvexReactClient } from 'convex/react'
import App from './App.jsx'
import { PinGate } from './deviceTrust/PinGate.jsx'
import { CONVEX_URL } from './send.js'
import './index.css'

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

const convex = new ConvexReactClient(CONVEX_URL)

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ConvexProvider client={convex}>
      {/* The shop PIN once per device (Shiv_Panel convex/devices.ts): sending to the group needs it. */}
      <PinGate convexUrl={CONVEX_URL} app="Bill Shoot" client={convex}>
        <App />
      </PinGate>
    </ConvexProvider>
  </React.StrictMode>,
)
