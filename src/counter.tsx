import { GuaranteeList } from './features/bills/MarkedSales'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { RouterProvider, createHashRouter, Navigate } from 'react-router-dom'
import { ConvexProvider, ConvexReactClient } from 'convex/react'
import { PinGate } from './lib/deviceTrust/PinGate.jsx'
import './index.css'
// The Signs look over the shared screens (DESIGN.md); the panel keeps its own.
import './counter-signs.css'
import { CounterLayout } from './components/CounterLayout'
import { ConvexSync } from './components/ConvexSync'
import { QuotationBuilder } from './features/quotation/QuotationBuilder'
import { QuotationOptions } from './features/quotation/QuotationOptions'
import { QuoteHistory } from './features/quotation/QuoteHistory'
import { GuaranteeBuilder } from './features/guarantee/GuaranteeBuilder'
import { GuaranteeHistory } from './features/guarantee/GuaranteeHistory'
import { GuaranteeClaims } from './features/guarantee/GuaranteeClaims'
import { BillSelectPage } from './features/guarantee/BillSelectPage'
import { BillBrandCardsPage } from './features/guarantee/BillBrandCardsPage'
import { CardBacks } from './features/guarantee/CardBacks'
import { Inventory } from './features/inventory/Inventory'
import { RateManager } from './features/rates/RateManager'
import { AluminiumCosting } from './features/rates/AluminiumCosting'
import { Transport } from './features/transport/Transport'
import { Customers } from './features/customers/Customers'
import { AppError, HOME, NotFound } from './components/RouteFallbacks'

import { startProperInputs } from './lib/properInputs'
import { startEnterFlow } from './lib/enterFlow'
import { startOfflineSync } from './lib/offlineSync'
import { hydrateStore, useStore } from './lib/store'
import { watchForNewBuild } from './lib/staleBuild'

// The PDF and print code still load on first use; a tab from before a deploy reloads.
watchForNewBuild()

// A sign is white: no dark mode on the counter, whatever the panel was set to.
document.documentElement.classList.remove('dark')

// The counter opens on the quotation chooser; the recovery screens' Home
// button goes there, not to the panel's /home.
HOME.path = '/quote-options'

/**
 * The counter, as its own site.
 *
 * Everything a customer is standing in front of you for: a quotation, a
 * guarantee card, what a sheet costs, what the toto charges. None of it posts
 * to an account, which is why it can live apart from the books at all.
 *
 * The same `src/` as the panel — this is a second entry point of one project,
 * not a second copy of it.
 */

startProperInputs()
// Enter walks every form box to box and lands on Print — see lib/enterFlow.
startEnterFlow()
// Retry cards/quotations whose cloud save failed (as the panel's main.tsx does).
// Without it a failed save sat in the queue until the next card was made.
startOfflineSync()

// Installed on a phone (Add to Home Screen) it opens at once and survives a
// bad signal. Only on the website: the desktop app loads from disk.
if (import.meta.env.PROD && 'serviceWorker' in navigator && location.protocol === 'https:') {
  addEventListener('load', () => {
    navigator.serviceWorker.register('/counter-sw.js', { updateViaCache: 'none' }).catch(() => undefined)
  })
}

const CONVEX_URL = (import.meta.env.VITE_CONVEX_URL ?? '').trim()
const convex = CONVEX_URL ? new ConvexReactClient(CONVEX_URL) : null

// Same wheel rule as the panel: a trackpad nudge must never change an amount.
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
  {
    path: '/',
    element: <CounterLayout />,
    errorElement: <AppError />,
    children: [
      { index: true, element: <Navigate to="/quote-options" replace /> },
      { path: 'quote-options', element: <QuotationOptions /> },
      { path: 'quote', element: <QuotationBuilder /> },
      { path: 'quote/:id', element: <QuotationBuilder /> },
      { path: 'product/:category', element: <QuotationBuilder /> },
      { path: 'history', element: <QuoteHistory /> },
      { path: 'history/:id', element: <QuoteHistory /> },
      { path: 'guarantee/card', element: <GuaranteeBuilder layout="card" /> },
      { path: 'guarantee/a4', element: <GuaranteeBuilder layout="a4" /> },
      { path: 'guarantee/backs', element: <CardBacks /> },
      { path: 'guarantee/history', element: <GuaranteeHistory /> },
      { path: 'guarantee/history/:id', element: <GuaranteeHistory /> },
      { path: 'guarantee/claims', element: <GuaranteeClaims cardLinks /> },
      { path: 'guarantee/list', element: <GuaranteeList /> },
      { path: 'guarantee/select-bill', element: <BillSelectPage /> },
      { path: 'guarantee/bill/:billId', element: <BillBrandCardsPage /> },
      // The catalogue and its rates are what a quotation is built out of, so
      // they live beside it rather than with the books.
      { path: 'inventory', element: <Inventory /> },
      { path: 'inventory/:tab', element: <Inventory /> },
      { path: 'inventory/:tab/:openId', element: <Inventory /> },
      { path: 'rates', element: <RateManager /> },
      { path: 'rates/:category', element: <RateManager /> },
      { path: 'aluminium-rates', element: <AluminiumCosting /> },
      { path: 'aluminium-rates/:product', element: <AluminiumCosting /> },
      { path: 'transport', element: <Transport /> },
      { path: 'transport/:view', element: <Transport /> },
      { path: 'customers', element: <Customers /> },
      { path: '*', element: <NotFound /> },
    ],
  },
], { future: { v7_relativeSplatPath: true } })

/**
 * <ConvexSync> is not optional here.
 *
 * The quotation catalogue — every item, rate and brand set a quotation is built
 * from — lives in the Zustand store, and this is the only thing that fills it
 * from Convex. Without it the counter opens with an empty product list and no
 * way to know why, which is exactly how it shipped the first time.
 */
const app = convex
  ? (
    <ConvexProvider client={convex}>
      {/* The shop PIN once per device; nothing reaches the server before it. */}
      <PinGate convexUrl={CONVEX_URL} app="Counter" client={convex}>
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
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>{app}</React.StrictMode>,
  )
})
