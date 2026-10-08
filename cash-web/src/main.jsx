import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { PinGate } from './deviceTrust/PinGate.jsx'

const CONVEX_URL = import.meta.env.VITE_CONVEX_URL || 'https://sensible-panther-176.convex.cloud'
import './index.css'

// No backend client here: the cash book is local-first and keeps everything in
// this device's storage until the flow is settled in the shop.
// A scroll over an amount box scrolls the page, never the amount: the box
// lets go of focus before the wheel can nudge the figure it holds.
document.addEventListener(
  'wheel',
  (e) => {
    const field = document.activeElement
    if (field instanceof HTMLInputElement && field.type === 'number' && e.target === field) field.blur()
  },
  { passive: true, capture: true },
)

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {/* The shop PIN once per device (Shiv_Panel convex/devices.ts). */}
    <PinGate convexUrl={CONVEX_URL} app="Cash">
      <App />
    </PinGate>
  </React.StrictMode>,
)

if ('serviceWorker' in navigator) {
  // When a new service worker takes control, reload once so the newest app shell loads.
  let refreshing = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return
    refreshing = true
    window.location.reload()
  })
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((reg) => {
      reg.update() // check for a newer worker on every load
    }).catch(() => {})
  })
}
