import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
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

ReactDOM.createRoot(document.getElementById('root')).render(<React.StrictMode><App /></React.StrictMode>)
