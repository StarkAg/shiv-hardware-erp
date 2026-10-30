import { DeliveryList, GuaranteeList } from './features/bills/MarkedSales'
import { WorkOrders } from './features/bills/WorkOrders'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { RouterProvider, createHashRouter, Navigate } from 'react-router-dom'
import { ConvexProvider, ConvexReactClient } from 'convex/react'
import { setShopWhatsAppClient } from './lib/shopWhatsApp'
import { PinGate } from './lib/deviceTrust/PinGate.jsx'
import './index.css'
import { AppLayout } from './components/AppLayout'
import { ConvexSync } from './components/ConvexSync'
import { startBillPhotoOutbox } from './lib/billPhotoOutbox'
import { startPostOutbox } from './lib/postOutbox'
import { BillBuilder } from './features/bills/BillBuilder'
import { Home } from './features/home/Home'
import { AppError, NotFound, VoucherRedirect, MovedToCounter } from './components/RouteFallbacks'
import { startOfflineSync } from './lib/offlineSync'
import { startProperInputs } from './lib/properInputs'
import { hydrateStore, useStore } from './lib/store'
import { convexEnabled, pushBillsToConvex } from './lib/convexSync'
import { isStaleBuild, reloadForNewBuild, watchForNewBuild } from './lib/staleBuild'

watchForNewBuild()

/**
 * Each screen is its own file, not part of the panel's first download. The
 * panel used to arrive as one 717 kB file holding every screen and the PDF
 * reader, all of it parsed before the first one could draw. Home and the bill
 * editor, opened all day, come with the panel.
 *
 * But a screen fetched only when it is first clicked left the page blank
 * while it came down — the "wait" that made the panel feel like a website.
 * So once the panel is up and idle, every screen is fetched in the
 * background (preloadPages), and a screen already here draws at once with no
 * blank frame at all.
 */
const preloads: (() => Promise<unknown>)[] = []

function page<K extends string>(load: () => Promise<{ [k in K]: unknown }>, name: K) {
  let ready: React.ComponentType | null = null
  const fetchIt = async () => {
    const C = (await load())[name] as React.ComponentType
    ready = C
    return C
  }
  preloads.push(() => fetchIt().catch(() => undefined))
  const Lazy = React.lazy(async () => {
    try {
      return { default: await fetchIt() }
    } catch (error) {
      // A screen from before the last deploy: reload onto the new one.
      // The promise is left hanging while the page reloads, so no error flashes.
      if (isStaleBuild(error) && reloadForNewBuild()) return new Promise<never>(() => {})
      throw error
    }
  })
  return () => {
    const Ready = ready
    return Ready ? <Ready /> : <React.Suspense fallback={null}><Lazy /></React.Suspense>
  }
}

/** Every screen, fetched one after another while nothing else is happening. */
function preloadPages() {
  const idle = (fn: () => void) =>
    'requestIdleCallback' in window ? window.requestIdleCallback(fn, { timeout: 3000 }) : setTimeout(fn, 1500)
  idle(async () => {
    for (const fetchIt of preloads) await fetchIt()
  })
}
const PrintDemo = page(() => import('./features/print/PrintDemo'), 'PrintDemo')
const GuaranteeClaims = page(() => import('./features/guarantee/GuaranteeClaims'), 'GuaranteeClaims')
const Ledger = page(() => import('./features/ledger/Ledger'), 'Ledger')
const Profit = page(() => import('./features/profit/Profit'), 'Profit')
const LedgersPage = page(() => import('./features/ledger/LedgersPage'), 'LedgersPage')
const BillTrash = page(() => import('./features/bills/BillTrash'), 'BillTrash')
const QuotationList = page(() => import('./features/bills/QuotationList'), 'QuotationList')
const PrinterQueue = page(() => import('./features/print/PrinterQueue'), 'PrinterQueue')
const CashReview = page(() => import('./features/cash/CashReview'), 'CashReview')
const PdfViewer = page(() => import('./features/pdf/PdfViewer'), 'PdfViewer')
const MobileView = page(() => import('./features/mobile/MobileView'), 'MobileView')
const QuickEntry = page(() => import('./features/mobile/QuickEntry'), 'QuickEntry')
const DayPaper = page(() => import('./features/paper/DayPaper'), 'DayPaper')
const Receive = page(() => import('./features/receive/Receive'), 'Receive')
const BillFlow = page(() => import('./features/flow/BillFlow'), 'BillFlow')
const TrustedDevices = page(() => import('./features/devices/TrustedDevices'), 'TrustedDevices')
const WhatsAppBills = page(() => import('./features/whatsapp/WhatsAppBills'), 'WhatsAppBills')

// Theme is applied by the inline <script> in index.html before any CSS loads.

// Pinch zoom is allowed (see index.html). Double-tap zoom is not: the CSS
// `touch-action: manipulation` on the page stops it without blocking a pinch.
startOfflineSync()
// Proper case in every text box, codes in capitals — see lib/properInputs.
startProperInputs()
// This device's quotation customers and units, brought to the same rule once.

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
// The price list is not pushed here: a device sends only what it changed, and
// only after the server has told it which version it is working from.
if (convexEnabled()) {
  void hydrateStore().then(() => setTimeout(() => {
    const s = useStore.getState()
    // Never a bill the books refused — the same rule as every other push.
    const bills = s.bills.filter((b) => !b.postError && !b.pendingPost)
    if (bills.length) void pushBillsToConvex(bills, s.billSeq)
  }, 3000))
}

// ── Convex ─────────────────────────────────────────────────────────────────
const CONVEX_URL = (import.meta.env.VITE_CONVEX_URL ?? '').trim()
const convex = CONVEX_URL ? new ConvexReactClient(CONVEX_URL) : null
setShopWhatsAppClient(convex)

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
    window.location.hash.startsWith('#/bill-flow') || window.location.hash.startsWith('#/quick')

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
  { path: '/quick', element: <QuickEntry />, errorElement: <AppError /> },
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
      // Claims customers file from a guarantee card's QR page.
      { path: 'guarantee/claims', element: <GuaranteeClaims /> },
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
      // Sales switched to "Order" / "Guarantee card" in the sale form.
      { path: 'work-list',      element: <WorkOrders /> },
      { path: 'delivery',       element: <DeliveryList /> },
      { path: 'guarantee/list', element: <GuaranteeList /> },
      { path: 'cash-review',    element: <CashReview /> },
      { path: 'trash',          element: <BillTrash /> },
      { path: 'devices',        element: <TrustedDevices /> },
      // Sale bills to the customer's WhatsApp: what is waiting, what went.
      { path: 'whatsapp',       element: <WhatsAppBills /> },
      { path: 'printer-queue',  element: <PrinterQueue /> },
      // The quotation half's own customer list. Not the books' party list —
      // these are people who may only ever have had a quotation. Named for
      // what it is in the menu until the two lists are actually merged.
      // Links from older versions of the panel, kept working rather than 404.
      { path: 'voucher/:kind',  element: <VoucherRedirect /> },
      // The quotation and guarantee screens moved to the counter on 2026-09-11.
      ...['quote-options', 'quote/*', 'quote', 'product/*', 'history/*', 'history', 'guarantee/card',
        'guarantee/a4', 'guarantee/history/*', 'guarantee/select-bill', 'guarantee/bill/*', 'inventory/*',
        'inventory', 'rates/*', 'rates', 'transport/*', 'transport', 'customers']
        .map((path) => ({ path, element: <MovedToCounter /> })),
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

// Bill photos saved after their bill: send what is waiting, and keep at it.
startBillPhotoOutbox()

const app = convex
  ? (
    <ConvexProvider client={convex}>
      {/* The shop PIN once per device; nothing reaches the server before it. */}
      <PinGate convexUrl={CONVEX_URL} app="Panel" client={convex}>
        <ConvexSync />
        <RouterProvider router={router} future={{ v7_startTransition: true }} />
      </PinGate>
    </ConvexProvider>
  )
  : <RouterProvider router={router} future={{ v7_startTransition: true }} />

// Drawn once this device's copy is read from IndexedDB, so nothing on screen
// (or synced) starts from the empty defaults. A failed read draws anyway.
void hydrateStore().catch(() => undefined).then(() => {
  useStore.getState().normalizeCustomerNames()
  // Bills saved on this PC and waiting for the books: send them, and keep at it.
  startPostOutbox()
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      {app}
    </React.StrictMode>,
  )
  preloadPages()
})
