import React from 'react'
import ReactDOM from 'react-dom/client'
import { RouterProvider, createHashRouter, Navigate } from 'react-router-dom'
import { ConvexProvider, ConvexReactClient } from 'convex/react'
import './index.css'
import { AppLayout } from './components/AppLayout'
import { ConvexSync } from './components/ConvexSync'
import { PrintDemo } from './features/print/PrintDemo'
import { Ledger } from './features/ledger/Ledger'
import { Profit } from './features/profit/Profit'
import { LedgersPage } from './features/ledger/LedgersPage'
import { BillBuilder } from './features/bills/BillBuilder'
import { BillTrash } from './features/bills/BillTrash'
import { QuotationList } from './features/bills/QuotationList'
import { PrinterQueue } from './features/print/PrinterQueue'
import { CashReview } from './features/cash/CashReview'
import { CashPending } from './features/cash/CashPending'
import { Home } from './features/home/Home'
import { PdfViewer } from './features/pdf/PdfViewer'
import { MobileView } from './features/mobile/MobileView'
import { DayPaper } from './features/paper/DayPaper'
import { Receive } from './features/receive/Receive'
import { BillFlow } from './features/flow/BillFlow'
import { AppError, NotFound, VoucherRedirect } from './components/RouteFallbacks'
import { startOfflineSync } from './lib/offlineSync'
import { startProperInputs } from './lib/properInputs'
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
// Proper case in every text box, codes in capitals — see lib/properInputs.
startProperInputs()
// This device's quotation customers and units, brought to the same rule once.
useStore.getState().normalizeCustomerNames()

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

/**
 * A phone opening the website gets the books to read, not the counter.
 *
 * Only the browser: the desktop and Android apps are the shop's own tools and
 * keep the full panel. "Full panel" on the phone screen opts out for the
 * session, so the next visit opens read-only again.
 */
function PhoneGate() {
  const w = window as unknown as { shivDesktop?: unknown; Capacitor?: { isNativePlatform?: () => boolean } }
  const phone =
    !!convex &&
    !w.shivDesktop &&
    !w.Capacitor?.isNativePlatform?.() &&
    window.matchMedia('(max-width: 767px) and (pointer: coarse)').matches
  let optedOut = false
  try { optedOut = sessionStorage.getItem('shiv-panel:full-panel') === '1' } catch { /* ignore */ }

  /**
   * The one screen whose whole purpose is a phone in someone's hand.
   *
   * The gate exists so a customer opening the website gets the books to read
   * rather than the counter's controls. The camera is the exception: it is a
   * phone screen by definition, and sending it to the read-only view meant the
   * shop's own link opened the wrong thing. Sorting the backlog has its own
   * site now and never reaches this router at all.
   */
  const forThePhone = new URLSearchParams(window.location.search).has('capture') ||
    window.location.hash.startsWith('#/bill-flow')

  return phone && !optedOut && !forThePhone ? <Navigate to="/m" replace /> : <AppLayout />
}

// HashRouter keeps routing working when packaged as a desktop (file://) app.
/**
 * A scroll over an amount box scrolls the page, never the amount.
 *
 * The browser's own behaviour is to nudge a focused number field up or down
 * with the wheel — so reaching for the trackpad after typing ₹13,000 quietly
 * saved ₹12,997. The field lets go of focus before the wheel reaches it, the
 * figure stays as typed, and the page scrolls as the hand meant it to.
 */
document.addEventListener(
  'wheel',
  (e) => {
    const field = document.activeElement
    if (field instanceof HTMLInputElement && field.type === 'number' && e.target === field) {
      field.blur()
    }
  },
  { passive: true, capture: true },
)

const router = createHashRouter([
  { path: '/m', element: <MobileView />, errorElement: <AppError /> },
  // Staff at the door, on a phone: a delivery in, with the challan photo.
  { path: '/receive', element: <Receive />, errorElement: <AppError /> },
  {
    path: '/',
    element: <PhoneGate />,
    errorElement: <AppError />,
    children: [
      { index: true, element: <Navigate to="/home" replace /> },
      { path: 'home',           element: <Home /> },
      { path: 'bill-flow',      element: <BillFlow /> },
      { path: 'paper',          element: <DayPaper /> },
      { path: 'ledgers',        element: <LedgersPage /> },
      { path: 'ledgers/:tab',   element: <LedgersPage /> },
      { path: 'ledger',         element: <Ledger /> },
      { path: 'ledger/trash',   element: <Navigate to="/trash" replace /> },
      { path: 'profit',         element: <Profit /> },
      { path: 'ledger/:tab',    element: <Ledger /> },
      { path: 'ledger/:tab/:partyId', element: <Ledger /> },
      /**
       * The day book has its own address.
       *
       * It shared /bills with the voucher being written, so "Day Book" in the
       * sidebar pointed at the screen you were already on and the builder
       * simply stayed put. Which of the two you get was local state the URL
       * could not say — so a link, a refresh and the back button all
       * disagreed. One address, one screen.
       */
      { path: 'day',            element: <BillBuilder /> },
      { path: 'bills',          element: <BillBuilder /> },
      // Editing a voucher that has no bill behind it — the ledger's own
      // entries and the ones approved from a photograph.
      { path: 'bills/voucher/:voucherId', element: <BillBuilder /> },
      { path: 'bills/:id',      element: <BillBuilder /> },
      // Every quotation given, open and sold.
      { path: 'quotations',     element: <QuotationList /> },
      { path: 'cash-review',    element: <CashReview /> },
      // The accounting side of the drawer: notes still needing an account.
      // Deliberately not in the menu — cash and the books are kept apart.
      { path: 'cash-pending',   element: <CashPending /> },
      { path: 'trash',          element: <BillTrash /> },
      { path: 'printer-queue',  element: <PrinterQueue /> },
      // The quotation half's own customer list. Not the books' party list —
      // these are people who may only ever have had a quotation. Named for
      // what it is in the menu until the two lists are actually merged.
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
