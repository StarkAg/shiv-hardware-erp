import React from 'react'
import ReactDOM from 'react-dom/client'
import { RouterProvider, createHashRouter, Navigate } from 'react-router-dom'
import { ConvexProvider, ConvexReactClient } from 'convex/react'
import './index.css'
import { AppLayout } from './components/AppLayout'
import { ConvexSync } from './components/ConvexSync'
import { QuotationBuilder } from './features/quotation/QuotationBuilder'
import { RateManager } from './features/rates/RateManager'
import { Inventory } from './features/inventory/Inventory'
import { Customers } from './features/customers/Customers'
import { QuoteHistory } from './features/quotation/QuoteHistory'
import { QuotationOptions } from './features/quotation/QuotationOptions'
import { PrintDemo } from './features/print/PrintDemo'
import { GuaranteeBuilder } from './features/guarantee/GuaranteeBuilder'
import { BillSelectPage } from './features/guarantee/BillSelectPage'
import { BillBrandCardsPage } from './features/guarantee/BillBrandCardsPage'
import { BillScanner } from './features/scan/BillScanner'
import { Transport } from './features/transport/Transport'
import { BillBuilder } from './features/bills/BillBuilder'
import { startOfflineSync } from './lib/offlineSync'
import { getPrintServerUrl, pullBillsFromServer, pullCatalogFromServer } from './lib/printServer'
import { useStore } from './lib/store'
import { subscribeSyncStream } from './lib/syncStream'
import { convexEnabled, pushBillsToConvex, pushCatalogToConvex } from './lib/convexSync'

// Theme is applied by the inline <script> in index.html before any CSS loads.

function disableMobileZoom() {
  const preventDefault = (event: Event) => event.preventDefault()
  document.addEventListener('gesturestart', preventDefault, { passive: false })
  document.addEventListener('gesturechange', preventDefault, { passive: false })
  document.addEventListener('gestureend', preventDefault, { passive: false })
  document.addEventListener('touchmove', (event) => {
    if (event.touches.length > 1) event.preventDefault()
  }, { passive: false })
  let lastTouchEnd = 0
  document.addEventListener('touchend', (event) => {
    const now = Date.now()
    if (now - lastTouchEnd <= 300) event.preventDefault()
    lastTouchEnd = now
  }, { passive: false })
}

disableMobileZoom()
startOfflineSync()

// ── Startup: pull print-server snapshots (local Wi-Fi) ─────────────────────
pullCatalogFromServer().then((snapshot) => {
  if (!snapshot) return
  const { setHardwareCatalog, setCustomCatalog, setSets } = useStore.getState()
  if (snapshot.hardwareCatalog) setHardwareCatalog(snapshot.hardwareCatalog)
  if (snapshot.customCatalog)   setCustomCatalog(snapshot.customCatalog)
  if (snapshot.sets?.length)    setSets(snapshot.sets)
}).catch(() => { /* print server offline — no-op */ })

pullBillsFromServer().then((serverBills) => {
  if (!serverBills?.length) return
  const local = useStore.getState().bills
  if (serverBills.length >= local.length) {
    // saveBillsSnapshot also pushes to Convex — populates cloud on first run
    useStore.getState().saveBillsSnapshot(serverBills)
  }
}).catch(() => { /* print server offline — no-op */ })

// ── Convex startup push — populate cloud from localStorage ─────────────────
// Runs regardless of print-server state. Safe because all mutations are upserts.
// Delayed 3 s so the print-server pulls above can update the store first.
if (convexEnabled()) {
  setTimeout(() => {
    const s = useStore.getState()
    void pushCatalogToConvex({ hardwareCatalog: s.hardwareCatalog, customCatalog: s.customCatalog, sets: s.sets })
    if (s.bills.length) void pushBillsToConvex(s.bills, s.billSeq)
  }, 3000)
}

// ── SSE: subscribe to real-time changes from the print server ───────────────
// Once the server URL is confirmed, open an EventSource for live push.
// When another device saves bills or catalog, we re-pull and sync locally
// using the loop-safe syncXxxFromRemote actions.
getPrintServerUrl().then((serverUrl) => {
  if (!serverUrl) return
  subscribeSyncStream(serverUrl, {
    onBills: () => {
      pullBillsFromServer().then((bills) => {
        if (!bills?.length) return
        const s = useStore.getState()
        if (bills.length >= s.bills.length) {
          s.syncBillsFromRemote(bills, bills.reduce((m, b) => {
            const n = Number(b.number)
            return Number.isFinite(n) ? Math.max(m, n) : m
          }, 0))
        }
      }).catch(() => {})
    },
    onCatalog: () => {
      pullCatalogFromServer().then((snap) => {
        if (!snap?.hardwareCatalog) return
        useStore.getState().syncCatalogFromRemote(snap)
      }).catch(() => {})
    },
  })
}).catch(() => { /* print server offline — no SSE */ })

// ── Convex ─────────────────────────────────────────────────────────────────
const CONVEX_URL = (import.meta.env.VITE_CONVEX_URL ?? '').trim()
const convex = CONVEX_URL ? new ConvexReactClient(CONVEX_URL) : null

// HashRouter keeps routing working when packaged as a desktop (file://) app.
const router = createHashRouter([
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <Navigate to="/quote-options" replace /> },
      { path: 'quote-options',  element: <QuotationOptions /> },
      { path: 'quote',          element: <QuotationBuilder /> },
      { path: 'quote/:id',      element: <QuotationBuilder /> },
      { path: 'product/:category', element: <QuotationBuilder /> },
      { path: 'history',        element: <QuoteHistory /> },
      { path: 'guarantee/card',        element: <GuaranteeBuilder layout="card" /> },
      { path: 'guarantee/a4',          element: <GuaranteeBuilder layout="a4" /> },
      { path: 'guarantee/select-bill',  element: <BillSelectPage /> },
      { path: 'guarantee/bill/:billId', element: <BillBrandCardsPage /> },
      { path: 'scan',           element: <BillScanner /> },
      { path: 'rates',          element: <RateManager /> },
      { path: 'inventory',      element: <Inventory /> },
      { path: 'customers',      element: <Customers /> },
      { path: 'transport',      element: <Transport /> },
      { path: 'bills',          element: <BillBuilder /> },
      { path: 'bills/:id',      element: <BillBuilder /> },
    ],
  },
  { path: '/demo', element: <PrintDemo /> },
])

const app = convex
  ? (
    <ConvexProvider client={convex}>
      <ConvexSync />
      <RouterProvider router={router} />
    </ConvexProvider>
  )
  : <RouterProvider router={router} />

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {app}
  </React.StrictMode>,
)
