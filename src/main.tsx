import React from 'react'
import ReactDOM from 'react-dom/client'
import { RouterProvider, createHashRouter, Navigate } from 'react-router-dom'
import './index.css'
import { AppLayout } from './components/AppLayout'
import { QuotationBuilder } from './features/quotation/QuotationBuilder'
import { RateManager } from './features/rates/RateManager'
import { Inventory } from './features/inventory/Inventory'
import { Customers } from './features/customers/Customers'
import { QuoteHistory } from './features/quotation/QuoteHistory'
import { QuotationOptions } from './features/quotation/QuotationOptions'
import { PrintDemo } from './features/print/PrintDemo'
import { GuaranteeBuilder } from './features/guarantee/GuaranteeBuilder'
import { BillScanner } from './features/scan/BillScanner'
import { Transport } from './features/transport/Transport'
import { BillBuilder } from './features/bills/BillBuilder'
import { startOfflineSync } from './lib/offlineSync'
import { pullCatalogFromServer } from './lib/printServer'
import { useStore } from './lib/store'

// Theme is applied by the inline <script> in index.html before any CSS loads.

function disableMobileZoom() {
  const preventDefault = (event: Event) => event.preventDefault()

  document.addEventListener('gesturestart', preventDefault, { passive: false })
  document.addEventListener('gesturechange', preventDefault, { passive: false })
  document.addEventListener('gestureend', preventDefault, { passive: false })

  document.addEventListener(
    'touchmove',
    (event) => {
      if (event.touches.length > 1) event.preventDefault()
    },
    { passive: false },
  )

  let lastTouchEnd = 0
  document.addEventListener(
    'touchend',
    (event) => {
      const now = Date.now()
      if (now - lastTouchEnd <= 300) event.preventDefault()
      lastTouchEnd = now
    },
    { passive: false },
  )
}

disableMobileZoom()
startOfflineSync()

// On startup: try to pull catalog from print server and merge into local store.
// Only overwrites if the server has a snapshot (acts as cross-device backup).
pullCatalogFromServer().then((snapshot) => {
  if (!snapshot) return
  const { setHardwareCatalog, setCustomCatalog, setSets } = useStore.getState()
  if (snapshot.hardwareCatalog) setHardwareCatalog(snapshot.hardwareCatalog)
  if (snapshot.customCatalog)   setCustomCatalog(snapshot.customCatalog)
  if (snapshot.sets?.length)    setSets(snapshot.sets)
}).catch(() => { /* print server offline — no-op */ })

// HashRouter keeps routing working when packaged as a desktop (file://) app.
const router = createHashRouter([
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <Navigate to="/quote-options" replace /> },
      { path: 'quote-options', element: <QuotationOptions /> },
      { path: 'quote', element: <QuotationBuilder /> },
      { path: 'quote/:id', element: <QuotationBuilder /> },
      { path: 'product/:category', element: <QuotationBuilder /> },
      { path: 'history', element: <QuoteHistory /> },
      { path: 'guarantee/card', element: <GuaranteeBuilder layout="card" /> },
      { path: 'guarantee/a4', element: <GuaranteeBuilder layout="a4" /> },
      { path: 'scan', element: <BillScanner /> },
      { path: 'rates', element: <RateManager /> },
      { path: 'inventory', element: <Inventory /> },
      { path: 'customers', element: <Customers /> },
      { path: 'transport', element: <Transport /> },
      { path: 'bills', element: <BillBuilder /> },
      { path: 'bills/:id', element: <BillBuilder /> },
    ],
  },
  // Standalone (no sidebar) visual preview of the generated sheets.
  { path: '/demo', element: <PrintDemo /> },
])

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
)
