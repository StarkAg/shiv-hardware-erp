import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { PinGate } from './deviceTrust/PinGate.jsx'

const CONVEX_URL = import.meta.env.VITE_CONVEX_URL || 'https://sensible-panther-176.convex.cloud'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {/* The shop PIN once per device (Shiv_Panel convex/devices.ts). */}
    <PinGate convexUrl={CONVEX_URL} app="Orders">
      <App />
    </PinGate>
  </React.StrictMode>,
)

if ('serviceWorker' in navigator) {
  let refreshing = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return
    refreshing = true
    window.location.reload()
  })
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((reg) => { reg.update() }).catch(() => {})
  })
}
