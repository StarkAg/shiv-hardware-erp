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

// No offline copy (Tony, 21 Nov 2026): nothing is kept on the device, so
// every open is the newest app. A worker or copies left from before are taken
// away here as well as by public/sw.js, whichever comes first.
if ('serviceWorker' in navigator) {
  void navigator.serviceWorker.getRegistrations().then((all) => Promise.all(all.map((r) => r.unregister()))).catch(() => {})
}
if ('caches' in window) {
  void caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))).catch(() => {})
}
