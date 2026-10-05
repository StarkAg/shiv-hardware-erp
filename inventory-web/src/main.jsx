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

if ('serviceWorker' in navigator) {
  addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then(async registration => {
      const active = (await navigator.serviceWorker.ready).active
      const resources = performance.getEntriesByType('resource')
        .map(entry => entry.name)
        .filter(url => new URL(url).origin === location.origin)
      active?.postMessage({ type: 'cache-shell', urls: ['/', '/index.html', ...resources] })
      void registration.update()
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
