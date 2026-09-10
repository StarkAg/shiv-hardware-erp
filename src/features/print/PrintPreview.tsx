import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Printer, X } from 'lucide-react'
import type { ServerPrintPayload } from '../../lib/printServer'

// A4 in CSS px at 96dpi.
const A4_W = 794
const A4_H = 1123
// Full-screen preview overlay. The A4 sheet is scaled to fit the screen (no
// scrolling); printing still uses the true A4 size via @media print rules.
export function PrintPreview({
  title,
  onClose,
  // Accepted and ignored: callers still describe what they are printing, and
  // it costs nothing to keep the shape for when a printer path needs it again.
  serverPrint: _serverPrint,
  children,
}: {
  title: string
  onClose: () => void
  serverPrint?: ServerPrintPayload
  children: ReactNode
}) {
  const areaRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  const [printing, setPrinting] = useState(false)
  const [printStatus, setPrintStatus] = useState('')
  const [printStatusTone, setPrintStatusTone] = useState<'success' | 'error' | 'info'>('success')

  useLayoutEffect(() => {
    const el = areaRef.current
    if (!el) return
    const fit = () => {
      const pad = 32
      const s = Math.min((el.clientWidth - pad) / A4_W, (el.clientHeight - pad) / A4_H, 1)
      setScale(s > 0 ? s : 1)
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Esc closes the preview.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    const previousBodyOverflow = document.body.style.overflow
    const previousHtmlOverflow = document.documentElement.style.overflow

    document.body.style.overflow = 'hidden'
    document.documentElement.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = previousBodyOverflow
      document.documentElement.style.overflow = previousHtmlOverflow
    }
  }, [])

  async function print() {
    // The browser prints, and nothing on the shop's Wi-Fi has to be switched on
    // for it to work. The packaged desktop app keeps its own path because it
    // drives the printer directly rather than through a server.
    if (!window.shivDesktop?.printCurrentPage) {
      window.print()
      return
    }

    setPrinting(true)
    setPrintStatus('')
    setPrintStatusTone('success')
    try {
      await window.shivDesktop.printCurrentPage({ copies: 1 })
    } catch (err) {
      // Fall back to the browser rather than leaving the shop with nothing.
      setPrintStatusTone('error')
      setPrintStatus(`Desktop print failed: ${err instanceof Error ? err.message : String(err)} — printing through the browser.`)
      window.print()
    } finally {
      setPrinting(false)
    }
  }

  const printStatusClass = printStatusTone === 'error'
    ? 'text-red-300'
    : printStatusTone === 'info'
      ? 'text-blue-200'
      : 'text-green-300'

  return (
    <div className="fixed inset-0 z-50 flex flex-col overflow-hidden overscroll-none bg-slate-800/95">
      <div className="no-print flex shrink-0 flex-col gap-2 bg-slate-900 px-3 pb-[calc(0.5rem+env(safe-area-inset-bottom))] pt-2 text-white sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-3">
        <div>
          <div className="font-semibold leading-tight">Print preview - {title}</div>
          {printStatus && <div className={`mt-0.5 text-xs font-medium ${printStatusClass}`}>{printStatus}</div>}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={print}
            disabled={printing}
            className="flex items-center gap-1.5 rounded-lg bg-shiv-green px-3 py-2 text-sm font-semibold text-stone-950 hover:bg-[#c6a15a] sm:px-4"
          >
            <Printer size={16} /> {printing ? 'Sending' : 'Print'}
          </button>
          <button
            onClick={onClose}
            className="flex items-center gap-1.5 rounded-lg bg-slate-700 px-3 py-2 text-sm hover:bg-slate-600 sm:px-4"
          >
            <X size={16} /> Close
          </button>
        </div>
      </div>

      {/* Fit-to-screen preview: scaled, no scrollbars */}
      <div ref={areaRef} className="flex flex-1 items-start justify-center overflow-hidden p-2 sm:p-4">
        <div
          className="preview-scale"
          style={{ ['--preview-scale' as string]: scale, width: A4_W, height: A4_H }}
        >
          <div className="print-root">{children}</div>
        </div>
      </div>
    </div>
  )
}
