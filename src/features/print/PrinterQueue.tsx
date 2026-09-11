import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Loader2, Printer, RefreshCw, Trash2, WifiOff } from 'lucide-react'
import { PageHeader, Button, Card } from '../../components/ui'
import { fetchPrintQueue, cancelPrintJob, type PrintQueuePrinter, type PrintQueueSnapshot } from '../../lib/printServer'

const POLL_MS = 4000

/** Turn a CUPS/Windows alert string into a short, human label. */
function describeAlert(alert: string): { label: string; jam: boolean } {
  const a = alert.toLowerCase()
  if (a.includes('jam')) return { label: 'Paper jam — clear it on the printer', jam: true }
  if (a.includes('media-empty') || a.includes('paperout') || a.includes('paper-out')) return { label: 'Out of paper', jam: true }
  if (a.includes('toner') || a.includes('marker-supply-empty')) return { label: 'Ink/toner empty', jam: true }
  if (a.includes('marker-supply-low')) return { label: 'Ink/toner low', jam: false }
  if (a.includes('offline') || a.includes('shutdown')) return { label: 'Printer offline', jam: true }
  if (a.includes('door') || a.includes('cover')) return { label: 'Door/cover open', jam: true }
  return { label: alert, jam: false }
}

function stateBadge(state: string) {
  const s = state.toLowerCase()
  if (s.includes('print')) return { text: 'Printing', cls: 'bg-shiv-green/20 text-amber-900 dark:text-amber-200' }
  if (s.includes('stop') || s.includes('disabl')) return { text: 'Stopped', cls: 'bg-shiv-red/15 text-shiv-red' }
  return { text: 'Idle', cls: 'bg-stone-200 text-stone-600 dark:bg-white/10 dark:text-stone-300' }
}

function PrinterCard({ printer, onCancel, busyId }: {
  printer: PrintQueuePrinter
  onCancel: (job: { jobId: string; printer: string; number: number }) => void
  busyId: string | null
}) {
  const badge = stateBadge(printer.state)
  const alert = printer.alert ? describeAlert(printer.alert) : null

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-stone-200/80 px-4 py-3 dark:border-white/10">
        <div className="flex min-w-0 items-center gap-2">
          <Printer size={18} className="shrink-0 text-muted" />
          <span className="truncate text-sm font-semibold text-stone-900 dark:text-stone-100">
            {printer.name.replace(/_/g, ' ').replace(/\s+\[?[0-9A-F]{6}\]?$/i, '').trim()}
          </span>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${badge.cls}`}>{badge.text}</span>
      </div>

      {alert && (
        <div className={`flex items-center gap-2 px-4 py-2 text-xs font-semibold ${alert.jam ? 'bg-shiv-red/10 text-shiv-red' : 'bg-amber-400/15 text-amber-700 dark:text-amber-300'}`}>
          <AlertTriangle size={14} className="shrink-0" />
          {alert.label}
        </div>
      )}

      {printer.jobs.length === 0 ? (
        <div className="px-4 py-3 text-xs text-muted">No jobs in queue.</div>
      ) : (
        <ul className="divide-y divide-stone-200/70 dark:divide-white/5">
          {printer.jobs.map((job) => (
            <li key={job.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-stone-800 dark:text-stone-100">
                  #{job.number} · Quotation/Document
                </div>
                <div className="truncate text-xs text-muted">
                  {job.sizeKb ? `${job.sizeKb} KB` : ''}{job.when ? ` · ${job.when}` : ''}
                </div>
              </div>
              <Button
                variant="danger"
                className="shrink-0 px-2.5 py-1.5"
                disabled={busyId === job.id}
                onClick={() => onCancel({ jobId: job.id, printer: job.printer, number: job.number })}
              >
                {busyId === job.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

export function PrinterQueue() {
  const [snapshot, setSnapshot] = useState<PrintQueueSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const timer = useRef<number | null>(null)

  const load = useCallback(async () => {
    try {
      const data = await fetchPrintQueue()
      setSnapshot(data)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    timer.current = window.setInterval(load, POLL_MS)
    return () => {
      if (timer.current) window.clearInterval(timer.current)
    }
  }, [load])

  async function handleCancel(job: { jobId: string; printer: string; number: number }) {
    setBusyId(job.jobId)
    try {
      await cancelPrintJob(job)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyId(null)
    }
  }

  const printers = snapshot?.printers ?? []
  const activeJobs = snapshot?.jobs.length ?? 0
  const withJobs = printers.filter((p) => p.jobs.length > 0 || p.alert)
  const idle = printers.filter((p) => p.jobs.length === 0 && !p.alert)

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Printer Queue"
        subtitle={snapshot ? `${activeJobs} job${activeJobs === 1 ? '' : 's'} in queue · ${printers.length} printer${printers.length === 1 ? '' : 's'}` : 'Live status from the shop print server'}
        actions={
          <Button variant="outline" onClick={() => { setLoading(true); void load() }} disabled={loading}>
            <span className="flex items-center gap-2">
              <RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> Refresh
            </span>
          </Button>
        }
      />

      <div className="flex-1 overflow-y-auto p-3 sm:p-4 md:p-6">
        {error && (
          <Card className="mb-4 flex items-center gap-3 border-shiv-red/30 px-4 py-3 text-sm text-shiv-red">
            <WifiOff size={18} className="shrink-0" />
            <div>
              <div className="font-semibold">Can’t reach the print server</div>
              <div className="text-xs opacity-80">{error}</div>
              <div className="mt-1 text-xs opacity-80">Start it on the shop computer and stay on the same Wi-Fi.</div>
            </div>
          </Card>
        )}

        {loading && !snapshot ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted">
            <Loader2 size={18} className="animate-spin" /> Reading printer queue…
          </div>
        ) : printers.length === 0 && !error ? (
          <div className="py-16 text-center text-sm text-muted">No printers found on the shop computer.</div>
        ) : (
          <div className="space-y-5">
            {withJobs.length > 0 && (
              <div className="grid gap-3 sm:grid-cols-2">
                {withJobs.map((p) => (
                  <PrinterCard key={p.name} printer={p} onCancel={handleCancel} busyId={busyId} />
                ))}
              </div>
            )}

            {idle.length > 0 && (
              <div>
                <div className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted">Idle printers</div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {idle.map((p) => (
                    <PrinterCard key={p.name} printer={p} onCancel={handleCancel} busyId={busyId} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
