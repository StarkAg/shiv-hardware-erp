import React from 'react'
import ReactDOM from 'react-dom/client'
import { ConvexProvider, ConvexReactClient } from 'convex/react'
import App from './App.jsx'
import { PinGate } from './deviceTrust/PinGate.jsx'
import './style.css'

const CONVEX_URL = import.meta.env.VITE_CONVEX_URL || 'https://sensible-panther-176.convex.cloud'
const convex = new ConvexReactClient(CONVEX_URL)

// The worker is what lets Android list this app under Share, and takes the
// files shared to it (public/sw.js).
if ('serviceWorker' in navigator) {
  addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => undefined) })
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ConvexProvider client={convex}>
      {/* The shop PIN once per device (Shiv_Panel convex/devices.ts). */}
      <PinGate convexUrl={CONVEX_URL} app="Print" client={convex}>
        <App />
      </PinGate>
    </ConvexProvider>
  </React.StrictMode>,
)
