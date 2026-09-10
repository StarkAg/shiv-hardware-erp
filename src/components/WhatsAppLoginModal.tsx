import { useEffect, useRef, useState } from 'react'
import { X, RefreshCw, CheckCircle2, Smartphone } from 'lucide-react'
import { fetchWhatsAppStatus, type WhatsAppWebStatus } from '../lib/printServer'

/**
 * Shows the shop WhatsApp connection status and, when the account is logged out
 * or awaiting a scan, the QR code to re-link it — polled live from the print
 * server so the QR refreshes and the dialog auto-closes once connected.
 */
export function WhatsAppLoginModal({
  open,
  onClose,
  onReady,
}: {
  open: boolean
  onClose: () => void
  onReady?: () => void
}) {
  const [state, setState] = useState<WhatsAppWebStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const readyFired = useRef(false)

  useEffect(() => {
    if (!open) return
    readyFired.current = false
    let cancelled = false

    async function poll() {
      try {
        const status = await fetchWhatsAppStatus()
        if (cancelled) return
        setState(status)
        setError(null)
        if (status.status === 'ready' && !readyFired.current) {
          readyFired.current = true
          onReady?.()
          // Give the user a beat to see "Connected" before closing.
          window.setTimeout(() => { if (!cancelled) onClose() }, 1400)
        }
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
      }
    }

    poll()
    const timer = window.setInterval(poll, 2500)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [open, onClose, onReady])

  if (!open) return null

  const status = state?.status ?? 'starting'
  const qr = state?.qrDataUrl ?? null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl dark:bg-stone-900">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-base font-bold text-stone-800 dark:text-stone-100">
            <Smartphone size={18} /> WhatsApp Login
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-full p-1.5 text-stone-400 transition hover:bg-stone-100 hover:text-stone-700 dark:hover:bg-white/10 dark:hover:text-stone-100"
          >
            <X size={18} />
          </button>
        </div>

        {error ? (
          <div className="rounded-xl bg-red-50 p-4 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
            <p className="font-semibold">Can't reach the print server</p>
            <p className="mt-1 text-xs opacity-90">{error}</p>
            <p className="mt-2 text-xs opacity-90">Start it on the shop computer and use the same Wi-Fi.</p>
          </div>
        ) : status === 'ready' ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <CheckCircle2 size={40} className="text-shiv-green" />
            <p className="text-sm font-semibold text-stone-800 dark:text-stone-100">WhatsApp is connected</p>
          </div>
        ) : qr ? (
          <div className="flex flex-col items-center gap-3 text-center">
            <img
              src={qr}
              alt="WhatsApp QR code"
              className="h-56 w-56 rounded-lg border border-stone-200 bg-white p-2 dark:border-white/10"
            />
            <ol className="text-left text-xs text-stone-600 dark:text-stone-300">
              <li>1. Open WhatsApp on the shop phone.</li>
              <li>2. Tap <b>⋮ / Settings → Linked devices</b>.</li>
              <li>3. Tap <b>Link a device</b> and scan this code.</li>
            </ol>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <RefreshCw size={32} className="animate-spin text-stone-400" />
            <p className="text-sm font-medium text-stone-700 dark:text-stone-200">
              {status === 'logged_out'
                ? 'Logged out — generating a new QR…'
                : status === 'reconnecting'
                  ? 'Reconnecting…'
                  : status === 'disabled'
                    ? 'WhatsApp auto-print is disabled on the server.'
                    : 'Preparing WhatsApp…'}
            </p>
            <p className="text-xs text-stone-400">The QR will appear here in a moment.</p>
          </div>
        )}

        <p className="mt-4 text-center text-[11px] uppercase tracking-wide text-stone-400">
          Status: {status}
        </p>
      </div>
    </div>
  )
}
