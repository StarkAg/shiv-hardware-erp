import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { PinGate } from './deviceTrust/PinGate.jsx'

const CONVEX_URL = import.meta.env.VITE_CONVEX_URL || 'https://sensible-panther-176.convex.cloud'
import './index.css'

// No service worker: every write here has to re-read the shared catalog row
// before it saves, so an offline copy of this panel could only do damage.
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {/* The shop PIN once per device (Shiv_Panel convex/devices.ts). */}
    <PinGate convexUrl={CONVEX_URL} app="Stock">
      <App />
    </PinGate>
  </React.StrictMode>,
)
