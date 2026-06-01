import React from 'react'
import ReactDOM from 'react-dom/client'
import { RouterProvider, createHashRouter, Navigate } from 'react-router-dom'
import './index.css'
import { AppLayout } from './components/AppLayout'
import { QuotationBuilder } from './features/quotation/QuotationBuilder'
import { RateManager } from './features/rates/RateManager'
import { Customers } from './features/customers/Customers'
import { QuoteHistory } from './features/quotation/QuoteHistory'
import { PrintDemo } from './features/print/PrintDemo'

document.documentElement.classList.toggle('dark', localStorage.getItem('shiv-panel:theme') === 'dark')

// HashRouter keeps routing working when packaged as a desktop (file://) app.
const router = createHashRouter([
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <Navigate to="/quote" replace /> },
      { path: 'quote', element: <QuotationBuilder /> },
      { path: 'quote/:id', element: <QuotationBuilder /> },
      { path: 'product/:category', element: <QuotationBuilder /> },
      { path: 'history', element: <QuoteHistory /> },
      { path: 'rates', element: <RateManager /> },
      { path: 'customers', element: <Customers /> },
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
