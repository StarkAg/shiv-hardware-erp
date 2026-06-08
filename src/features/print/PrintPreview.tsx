import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Printer, X } from 'lucide-react'
import { printOnServer, type ServerPrintPayload } from '../../lib/printServer'
import { CLOUD_API_URL, createCloudPrintJob, getCloudPrintJob, type CloudPrintJob } from '../../lib/cloudApi'

// A4 in CSS px at 96dpi.
const A4_W = 794
const A4_H = 1123
const CLOUD_PRINT_POLL_MS = 2_000
const CLOUD_PRINT_WATCH_MS = 2 * 60_000

function wait(ms: number) {
  return new Promise(resolve => window.setTimeout(resolve, ms))
}

function describeCloudPrintJob(job: CloudPrintJob) {
  switch (job.status) {
    case 'pending':
      return 'Shop print queued. Waiting for shop printer...'
    case 'claimed':
      return `Shop printer picked it up${job.claimedBy ? ` (${job.claimedBy})` : ''}.`
    case 'printing':
      return 'Printing at shop...'
    case 'printed':
      return 'Printed at shop.'
    case 'failed':
      return `Shop print failed${job.error ? `: ${job.error}` : '.'}`
    case 'cancelled':
      return 'Shop print cancelled.'
    default:
      return `Shop print status: ${job.status}`
  }
}

function isFinalCloudPrintStatus(status: CloudPrintJob['status']) {
  return status === 'printed' || status === 'failed' || status === 'cancelled'
}

// Full-screen preview overlay. The A4 sheet is scaled to fit the screen (no
// scrolling); printing still uses the true A4 size via @media print rules.
export function PrintPreview({
  title,
  onClose,
  serverPrint,
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
  const cloudStatusWatchId = useRef(0)
  const canCloudPrint = Boolean(CLOUD_API_URL && serverPrint)

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

  useEffect(() => {
    return () => {
      cloudStatusWatchId.current += 1
    }
  }, [])

  async function watchCloudPrintJob(id: string) {
    const watchId = ++cloudStatusWatchId.current
    const deadline = Date.now() + CLOUD_PRINT_WATCH_MS

    setPrintStatusTone('info')
    setPrintStatus(`Shop print queued (${id}). Waiting for shop printer...`)

    while (Date.now() < deadline) {
      await wait(CLOUD_PRINT_POLL_MS)
      if (cloudStatusWatchId.current !== watchId) return

      try {
        const { job } = await getCloudPrintJob(id)
        if (cloudStatusWatchId.current !== watchId) return

        setPrintStatusTone(job.status === 'failed' || job.status === 'cancelled' ? 'error' : 'success')
        setPrintStatus(`${describeCloudPrintJob(job)} (${id})`)
        if (isFinalCloudPrintStatus(job.status)) return
      } catch (err) {
        setPrintStatusTone('error')
        setPrintStatus(`Shop print queued (${id}), but status check failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    if (cloudStatusWatchId.current === watchId) {
      setPrintStatusTone('info')
      setPrintStatus(`Shop print queued (${id}). No final status yet.`)
    }
  }

  async function print() {
    if (!window.shivDesktop?.printCurrentPage && !serverPrint) {
      window.print()
      return
    }

    setPrinting(true)
    setPrintStatus('')
    setPrintStatusTone('success')
    try {
      if (window.shivDesktop?.printCurrentPage) {
        await window.shivDesktop.printCurrentPage({ copies: 1 })
      } else if (serverPrint) {
        const result = await printOnServer(serverPrint)
        setPrintStatusTone('success')
        setPrintStatus(`Sent to ${result.printer}${result.jobId ? ` (${result.jobId})` : ''}.`)
      }
    } catch (err) {
      if (serverPrint && canCloudPrint) {
        try {
          const result = serverPrint.kind === 'quotation'
            ? await createCloudPrintJob({ kind: 'quotation', quote: serverPrint.quote, source: 'web' })
            : serverPrint.kind === 'guarantee'
              ? await createCloudPrintJob({
                  kind: 'guarantee',
                  document: serverPrint.document,
                  layout: serverPrint.layout,
                  source: 'web',
                })
              : await createCloudPrintJob({ kind: 'quotation', quote: serverPrint.bill as never, source: 'web' })
          void watchCloudPrintJob(result.id)
          return
        } catch (cloudErr) {
          alert(`Print failed locally and cloud queue failed: ${cloudErr instanceof Error ? cloudErr.message : String(cloudErr)}`)
          return
        }
      }

      alert(`Print failed: ${err instanceof Error ? err.message : String(err)}`)
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
