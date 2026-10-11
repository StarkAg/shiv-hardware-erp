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
}
