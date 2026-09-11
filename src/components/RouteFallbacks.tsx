import { Navigate, useNavigate, useParams, useRouteError, isRouteErrorResponse } from 'react-router-dom'
import { AlertTriangle, Home, RotateCw } from 'lucide-react'

/**
 * Where a link goes when the page behind it has moved or gone.
 *
 * Without these, React Router shows its own developer page — "Unexpected
 * Application Error", a floppy disk and a note about ErrorBoundary — to
 * whoever is standing at the counter.
 */

/** The voucher chooser is gone; its links open the bill builder instead. */
export function VoucherRedirect() {
  const { kind } = useParams<{ kind: string }>()
  const ok = ['sale', 'purchase', 'receipt', 'payment'].includes(kind ?? '')
  return <Navigate to={ok ? `/bills?new=${kind}` : '/bills'} replace />
}

/** A URL that matches nothing. */
export function NotFound() {
  const navigate = useNavigate()
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 px-4 pt-24 text-center">
      <AlertTriangle size={32} className="text-stone-300 dark:text-stone-600" />
      <div>
        <p className="text-base font-bold text-stone-900 dark:text-white">This page has moved</p>
        <p className="mt-1 text-sm text-muted">
          The link is from an older version of the panel.
        </p>
      </div>
      <button
        onClick={() => navigate('/quote-options')}
        className="flex items-center gap-2 rounded-xl bg-shiv-green px-4 py-2 text-sm font-bold text-stone-950 hover:bg-[#c6a15a]"
      >
        <Home size={15} /> Home
      </button>
    </div>
  )
}

/** Anything that threw on the way to rendering a page. */
export function AppError() {
  const error = useRouteError()
  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : String(error ?? 'Something went wrong')

  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center gap-4 px-4 text-center">
      <AlertTriangle size={32} className="text-danger" />
      <div>
        <p className="text-base font-bold text-stone-900 dark:text-white">The panel hit a problem</p>
        {/* The message is shown rather than hidden: the shop reads it out over
            the phone, and that is usually enough to say what went wrong. */}
        <p className="mt-1 break-words text-sm text-muted">{message}</p>
      </div>
      <div className="flex gap-2">
        <button
          onClick={() => window.location.reload()}
          className="flex items-center gap-2 rounded-xl bg-shiv-green px-4 py-2 text-sm font-bold text-stone-950 hover:bg-[#c6a15a]"
        >
          <RotateCw size={15} /> Reload
        </button>
        <button
          onClick={() => { window.location.hash = '#/quote-options'; window.location.reload() }}
          className="flex items-center gap-2 rounded-xl bg-stone-100 px-4 py-2 text-sm font-semibold text-stone-700 hover:bg-stone-200 dark:bg-white/10 dark:text-stone-200"
        >
          <Home size={15} /> Home
        </button>
      </div>
    </div>
  )
}
