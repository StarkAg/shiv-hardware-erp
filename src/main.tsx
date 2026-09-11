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
import { GuaranteeHistory } from './features/guarantee/GuaranteeHistory'
import { BillSelectPage } from './features/guarantee/BillSelectPage'
import { BillBrandCardsPage } from './features/guarantee/BillBrandCardsPage'
import { BillScanner } from './features/scan/BillScanner'
import { Transport } from './features/transport/Transport'
import { Ledger } from './features/ledger/Ledger'
import { LedgersPage } from './features/ledger/LedgersPage'
import { BillBuilder } from './features/bills/BillBuilder'
import { BillTrash } from './features/bills/BillTrash'
import { CashReview } from './features/cash/CashReview'
import { PrinterQueue } from './features/print/PrinterQueue'
import { PdfViewer } from './features/pdf/PdfViewer'
import { AppError, NotFound, VoucherRedirect } from './components/RouteFallbacks'
import { startOfflineSync } from './lib/offlineSync'
import { useStore } from './lib/store'
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

// ── Startup ────────────────────────────────────────────────────────────────
// The panel used to open by asking a print server on the shop's Wi-Fi for the
// bills, the catalogue and the guarantee cards, and to hold an SSE stream open
// for changes. Convex carries all three now, live, from anywhere — so the
// panel no longer needs anything on the local network to start, and does not
// go looking for it. With the server switched off that search was four rounds
// of refused connections and a thousand-address subnet scan, every load.
//
// Printing goes through the browser. The print server still exists for the
// thermal printer, but nothing reaches for it on its own any more.

// First run on a device that has bills locally but has never pushed them up.
if (convexEnabled()) {
  setTimeout(() => {
    const s = useStore.getState()
    if (s.hardwareCatalog || s.customCatalog?.length || s.sets?.length) {
      void pushCatalogToConvex({ hardwareCatalog: s.hardwareCatalog, customCatalog: s.customCatalog, sets: s.sets })
    }
    if (s.bills.length) void pushBillsToConvex(s.bills, s.billSeq)
  }, 3000)
}

// ── Convex ─────────────────────────────────────────────────────────────────
const CONVEX_URL = (import.meta.env.VITE_CONVEX_URL ?? '').trim()
const convex = CONVEX_URL ? new ConvexReactClient(CONVEX_URL) : null

// HashRouter keeps routing working when packaged as a desktop (file://) app.
const router = createHashRouter([
  {
    path: '/',
    element: <AppLayout />,
    errorElement: <AppError />,
    children: [
      { index: true, element: <Navigate to="/quote-options" replace /> },
      { path: 'quote-options',  element: <QuotationOptions /> },
      { path: 'quote',          element: <QuotationBuilder /> },
      { path: 'quote/:id',      element: <QuotationBuilder /> },
      { path: 'product/:category', element: <QuotationBuilder /> },
      { path: 'history',        element: <QuoteHistory /> },
      { path: 'history/:id',    element: <QuoteHistory /> },
      { path: 'guarantee/card',        element: <GuaranteeBuilder layout="card" /> },
      { path: 'guarantee/a4',          element: <GuaranteeBuilder layout="a4" /> },
      { path: 'guarantee/history',     element: <GuaranteeHistory /> },
      { path: 'guarantee/history/:id', element: <GuaranteeHistory /> },
      { path: 'guarantee/select-bill',  element: <BillSelectPage /> },
      { path: 'guarantee/bill/:billId', element: <BillBrandCardsPage /> },
      { path: 'scan',           element: <BillScanner /> },
      { path: 'rates',          element: <RateManager /> },
      { path: 'rates/:category', element: <RateManager /> },
      { path: 'inventory',      element: <Inventory /> },
      { path: 'inventory/:tab', element: <Inventory /> },
      { path: 'inventory/:tab/:openId', element: <Inventory /> },
      { path: 'customers',      element: <Customers /> },
      { path: 'transport',      element: <Transport /> },
      { path: 'transport/:view', element: <Transport /> },
      { path: 'ledgers',        element: <LedgersPage /> },
      { path: 'ledgers/:tab',   element: <LedgersPage /> },
      { path: 'ledger',         element: <Ledger /> },
      { path: 'ledger/trash',   element: <Navigate to="/trash" replace /> },
      { path: 'ledger/:tab',    element: <Ledger /> },
      { path: 'ledger/:tab/:partyId', element: <Ledger /> },
      { path: 'bills',          element: <BillBuilder /> },
      // Editing a voucher that has no bill behind it — the ledger's own
      // entries and the ones approved from a photograph.
      { path: 'bills/voucher/:voucherId', element: <BillBuilder /> },
      { path: 'bills/:id',      element: <BillBuilder /> },
      { path: 'cash-review',    element: <CashReview /> },
      { path: 'trash',          element: <BillTrash /> },
      { path: 'printer-queue',  element: <PrinterQueue /> },
      // Links from older versions of the panel, kept working rather than 404.
      { path: 'voucher/:kind',  element: <VoucherRedirect /> },
      { path: 'pdf-viewer',     element: <PdfViewer /> },
      { path: '*',              element: <NotFound /> },
    ],
  },
  { path: '/demo', element: <PrintDemo /> },
], {
  // Opt in early to what v7 does by default, which also silences the warnings
  // it prints on every start.
  future: { v7_relativeSplatPath: true },
})

const app = convex
  ? (
    <ConvexProvider client={convex}>
      <ConvexSync />
      <RouterProvider router={router} future={{ v7_startTransition: true }} />
    </ConvexProvider>
  )
  : <RouterProvider router={router} future={{ v7_startTransition: true }} />

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {app}
  </React.StrictMode>,
)
