import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { ArrowRight, FileText, Landmark, Loader2, Printer, RefreshCw } from 'lucide-react'
import { Button, Card } from '../../components/ui'
import { toast } from '../../components/Toast'
import {
  fetchPrinterStatus, setPrintRoute,
  type PrintJob, type PrintRoute, type PrinterStatus, type PrinterStatusSnapshot,
} from '../../lib/printServer'

/**
 * Where the shop's print jobs go, and the printers themselves.
 *
 * For bank PDFs (SBI's) and quotations: the printer, colour or black and
 * white, and a fallback printer for when the first is offline (owner's ask,
 * 26 Nov 2026). Below, every printer online or offline: the print server
 * knocks on a Wi-Fi printer's address, as Windows alone says "Normal" for
 * one switched off. print-server/bank-print.mjs keeps the choices.
 */

const POLL_MS = 10_000

const JOBS: { job: PrintJob; title: string; note: string; icon: ReactNode }[] = [
  { job: 'quotation', title: 'Quotations', note: 'Printed from the Quote screens', icon: <FileText size={18} /> },
  { job: 'bank', title: 'Bank PDFs (SBI)', note: 'Posted in the shop group or saved to Downloads', icon: <Landmark size={18} /> },
]

// The HP LaserJets print black only.
const blackOnly = (name: string) => /laserjet|npi/i.test(name)

function where(p: PrinterStatus) {
  if (p.address) return `Wi-Fi ${p.address}`
  if (/usb/i.test(p.name) || /260x/i.test(p.name)) return 'USB cable'
  return 'On this PC'
}

const label = (p: PrinterStatus) => `${p.name} (${p.online ? 'online' : 'offline'})`

function StateTag({ online }: { online: boolean }) {
  return (
    <span className={`shrink-0 px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-white ${online ? 'bg-[#007a3d]' : 'bg-[#b3202a]'}`}>
      {online ? 'Online' : 'Offline'}
    </span>
  )
}

function Field({ name, children }: { name: string; children: ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-[11px] font-bold uppercase tracking-wide text-[#4c5660]">{name}</span>
      {children}
    </label>
  )
}

const selectClass = 'min-h-11 w-full min-w-0 border-2 border-[#c9cfd5] bg-white px-2 text-sm font-semibold text-[#0e1318] outline-none focus:border-[#0054b4] disabled:opacity-60'

function JobRoute({ title, note, icon, route, printers, busy, onChange }: {
  title: string
  note: string
  icon: ReactNode
  route: PrintRoute
  printers: PrinterStatus[]
  busy: boolean
  onChange: (patch: Partial<PrintRoute>) => void
}) {
  const byName = new Map(printers.map((p) => [p.name, p]))
  const first = byName.get(route.printer)
  const second = route.fallback ? byName.get(route.fallback) : undefined
  // Where a job would go now, as the print server picks it.
  const now = first?.online ? first.name : second?.online ? second.name : null
  const colourShown = route.color && now != null && !blackOnly(now)

  return (
    <div className="border-b border-[#c9cfd5] py-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="text-[#4c5660]">{icon}</span>
        <span className="min-w-0">
          <span className="block text-base font-bold uppercase tracking-wide">{title}</span>
          <span className="block text-xs text-[#4c5660]">{note}</span>
        </span>
        {busy && <Loader2 size={16} className="ml-auto animate-spin text-[#4c5660]" />}
      </div>

      <div className="grid gap-3 sm:grid-cols-[minmax(0,1.4fr)_auto_minmax(0,1.4fr)]">
        <Field name="Printer">
          <select className={selectClass} value={route.printer} disabled={busy} onChange={(e) => onChange({ printer: e.target.value })}>
            {!first && <option value={route.printer}>{route.printer} (not found)</option>}
            {printers.map((p) => <option key={p.name} value={p.name}>{label(p)}</option>)}
          </select>
        </Field>

        <Field name="Print in">
          <div className="flex" role="group" aria-label={`${title}: colour or black and white`}>
            {([true, false] as const).map((c) => (
              <button
                key={String(c)}
                type="button"
                disabled={busy}
                aria-pressed={route.color === c}
                onClick={() => route.color !== c && onChange({ color: c })}
                className={`min-h-11 flex-1 whitespace-nowrap border-2 px-3 text-sm font-bold uppercase tracking-wide ${
                  route.color === c ? 'border-[#0e1318] bg-[#0e1318] text-white' : 'border-[#c9cfd5] bg-[#edf0f3] text-[#0e1318]'
                }`}
              >
                {c ? 'Colour' : 'B&W'}
              </button>
            ))}
          </div>
        </Field>

        <Field name="If offline, print on">
          <select
            className={selectClass}
            value={route.fallback ?? ''}
            disabled={busy}
            onChange={(e) => onChange({ fallback: e.target.value || null })}
          >
            <option value="">No fallback: wait</option>
            {route.fallback && !second && <option value={route.fallback}>{route.fallback} (not found)</option>}
            {printers.filter((p) => p.name !== route.printer).map((p) => <option key={p.name} value={p.name}>{label(p)}</option>)}
          </select>
        </Field>
      </div>

      <p className={`mt-3 flex flex-wrap items-center gap-1.5 text-sm font-semibold ${now ? 'text-[#0e1318]' : 'text-[#b3202a]'}`}>
        <ArrowRight size={16} className="shrink-0" />
        {now == null
          ? 'No printer for it is online now: it will not print until one is back.'
          : now === route.printer
            ? `Prints now on ${now}, ${colourShown ? 'in colour' : 'black and white'}.`
            : `${route.printer} is offline: prints now on ${now}, ${colourShown ? 'in colour' : 'black and white'}.`}
        {route.color && now != null && blackOnly(now) && <span className="font-normal text-[#4c5660]">(This printer prints black only.)</span>}
      </p>
    </div>
  )
}

export function Printers() {
  const [snap, setSnap] = useState<PrinterStatusSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [looking, setLooking] = useState(false)
  const [saving, setSaving] = useState<PrintJob | null>(null)

  const load = useCallback(async (fresh = false) => {
    setLooking(true)
    try {
      setSnap(await fetchPrinterStatus(fresh))
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLooking(false)
    }
  }, [])

  useEffect(() => {
    void load(true)
    const t = setInterval(() => { void load() }, POLL_MS)
    return () => clearInterval(t)
  }, [load])

  async function change(job: PrintJob, title: string, patch: Partial<PrintRoute>) {
    if (saving) return
    setSaving(job)
    try {
      const route = await setPrintRoute(job, patch)
      setSnap((s) => (s ? { ...s, routes: { ...s.routes, [job]: route }, ...(job === 'bank' ? { bankPrinter: route.printer } : {}) } : s))
      toast(`${title}: ${route.printer}, ${route.color ? 'colour' : 'black and white'}${route.fallback ? `, else ${route.fallback}` : ', no fallback'}`)
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error')
    } finally {
      setSaving(null)
    }
  }

  const printers = snap?.printers ?? []
  // A print server from before routes: only the bank printer is known.
  const routes = snap?.routes

  return (
    <div className="mobile-panel-screen flex flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-y-auto p-3 md:p-4">
        <Card className="mx-auto max-w-3xl p-4 text-stone-900">
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-bold uppercase tracking-wide text-muted">Where it prints</h2>
            <Button
              variant="outline"
              onClick={() => void load(true)}
              disabled={looking}
              className="flex items-center gap-2 px-3 py-2 text-sm"
            >
              {looking ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />} Check again
            </Button>
          </div>

          {error && (
            <div className="my-3 border-l-4 border-[#b3202a] bg-[#b3202a]/10 px-3 py-2 text-sm font-semibold text-[#b3202a]">
              Cannot reach the print server: {error}
            </div>
          )}

          {!snap && !error && (
            <div className="flex items-center gap-2 py-6 text-sm text-muted">
              <Loader2 size={16} className="animate-spin" /> Checking the printers…
            </div>
          )}

          {snap && !routes && (
            <p className="my-3 text-sm font-semibold text-[#4c5660]">The print server on the shop PC is older than this screen. Restart it to choose printers here.</p>
          )}

          {routes && (
            <div className="border-t-2 border-[#0e1318]">
              {JOBS.map((j) => (
                <JobRoute
                  key={j.job}
                  title={j.title}
                  note={j.note}
                  icon={j.icon}
                  route={routes[j.job]}
                  printers={printers}
                  busy={saving === j.job}
                  onChange={(patch) => void change(j.job, j.title, patch)}
                />
              ))}
            </div>
          )}

          {snap && (
            <>
              <h2 className="mb-2 mt-6 text-sm font-bold uppercase tracking-wide text-muted">Printers</h2>
              <ul className="border-t-2 border-[#0e1318]">
                {printers.map((p) => {
                  const uses = [
                    p.name === snap.colorPrinter && 'Guarantee cards',
                    ...JOBS.flatMap((j) => (routes?.[j.job]?.printer === p.name ? [j.title] : [])),
                    ...JOBS.flatMap((j) => (routes?.[j.job]?.fallback === p.name ? [`${j.title} if offline`] : [])),
                  ].filter(Boolean)
                  return (
                    <li key={p.name} className="flex items-center gap-3 border-b border-[#c9cfd5] px-2 py-3">
                      <Printer size={20} className="shrink-0 text-[#4c5660]" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-base font-semibold">{p.name}</span>
                        <span className="block truncate text-xs text-[#4c5660]">
                          {where(p)}{blackOnly(p.name) ? ' · Black only' : ''}{uses.length > 0 && ` · ${uses.join(', ')}`}
                        </span>
                        {!p.online && p.reason && <span className="block text-xs font-semibold text-[#b3202a]">{p.reason}</span>}
                      </span>
                      <StateTag online={p.online} />
                    </li>
                  )
                })}
              </ul>
            </>
          )}
        </Card>
      </div>
    </div>
  )
}
