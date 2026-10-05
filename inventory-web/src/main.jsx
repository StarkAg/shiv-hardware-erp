import React from 'react'
import ReactDOM from 'react-dom/client'
import { ConvexProvider, ConvexReactClient } from 'convex/react'
import App from './App.jsx'
import './index.css'
import { startTheme } from './theme'

const stopTheme = startTheme()
if (import.meta.hot) import.meta.hot.dispose(stopTheme)

// Live client, so a count saved on one phone shows on another at once. The URL is
// baked in as a fallback like the sort and cash sites, so a forgotten environment
// variable cannot ship a dead build.
const convex = new ConvexReactClient(
  import.meta.env.VITE_CONVEX_URL || 'https://sensible-panther-176.convex.cloud',
)

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then(registration => {
      const check = () => {
        if (navigator.onLine && document.visibilityState === 'visible') void registration.update().catch(() => undefined)
      }
      addEventListener('online', check)
      document.addEventListener('visibilitychange', check)
      setInterval(check, 60_000)
      check()
    }).catch(() => undefined)
  })
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ConvexProvider client={convex}>
      <App />
    </ConvexProvider>
  </React.StrictMode>,
)
