import React from 'react'
import ReactDOM from 'react-dom/client'
import WorkshopApp from './WorkshopApp.jsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <WorkshopApp />
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
