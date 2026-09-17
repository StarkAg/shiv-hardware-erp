import React from 'react'
import ReactDOM from 'react-dom/client'
import { ConvexProvider, ConvexReactClient } from 'convex/react'
import App from './App.jsx'
import './index.css'

const CONVEX_URL =
  import.meta.env.VITE_CONVEX_URL || 'https://sensible-panther-176.convex.cloud'
const convex = new ConvexReactClient(CONVEX_URL)

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
    <ConvexProvider client={convex}>
      <App />
    </ConvexProvider>
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
