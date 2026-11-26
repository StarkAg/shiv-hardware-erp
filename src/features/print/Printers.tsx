import { useCallback, useEffect, useState } from 'react'
import { Check, Landmark, Loader2, Printer, RefreshCw } from 'lucide-react'
import { Button, Card } from '../../components/ui'
import { toast } from '../../components/Toast'
import { fetchPrinterStatus, setBankPrinter, type PrinterStatus, type PrinterStatusSnapshot } from '../../lib/printServer'

/**
 * The shop's printers, each online or offline (the print server knocks on a
 * Wi-Fi printer's address, as Windows alone says "Normal" for one switched
 * off), and which one SBI's PDFs print on: tap a printer to send them there.
 * print-server/bank-print.mjs keeps the choice.
 */

const POLL_MS = 10_000

function where(p: PrinterStatus) {
  if (p.address) return `Wi-Fi ${p.address}`
  if (/usb/i.test(p.name) || /260x/i.test(p.name)) return 'USB cable'
  return 'On this PC'
}

export function Printers() {
  const [snap, setSnap] = useState<PrinterStatusSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [looking, setLooking] = useState(false)
  const [saving, setSaving] = useState<string | null>(null)

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

  async function choose(p: PrinterStatus) {
    if (saving || snap?.bankPrinter === p.name) return
    setSaving(p.name)
    try {
      const name = await setBankPrinter(p.name)
      setSnap((s) => (s ? { ...s, bankPrinter: name } : s))
      toast(p.online ? `Bank PDFs now print on ${p.name}` : `Bank PDFs set to ${p.name}. It is offline now: they go to the other printer until it is back.`, p.online ? 'ok' : 'info')
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error')
    } finally {
      setSaving(null)
    }
  }

  const printers = snap?.printers ?? []

  return (
    <div className="mobile-panel-screen flex flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-y-auto p-3 md:p-4">
        <Card className="mx-auto max-w-3xl p-4 text-stone-900">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-bold uppercase tracking-wide text-muted">Printers</h2>
            <Button
              variant="outline"
              onClick={() => void load(true)}
              disabled={looking}
              className="flex items-center gap-2 px-3 py-2 text-sm"
            >
              {looking ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />} Check again
            </Button>
          </div>

          <p className="mb-3 flex items-center gap-2 text-sm text-muted">
            <Landmark size={16} className="shrink-0" />
            Bank PDFs (SBI) print black and white on the printer marked below. Tap another printer to send them there.
          </p>

          {error && (
            <div className="mb-3 border-l-4 border-[#b3202a] bg-[#b3202a]/10 px-3 py-2 text-sm font-semibold text-[#b3202a]">
              Cannot reach the print server: {error}
            </div>
          )}

          {!snap && !error && (
            <div className="flex items-center gap-2 py-6 text-sm text-muted">
              <Loader2 size={16} className="animate-spin" /> Checking the printers…
            </div>
          )}

          <ul className="border-t-2 border-[#0e1318]">
            {printers.map((p) => {
              const bank = snap?.bankPrinter === p.name
              const roles = [
                p.name === snap?.colorPrinter && 'Colour and cards',
                p.name === snap?.bwPrinter && 'Black and white',
              ].filter(Boolean)
              return (
                <li key={p.name} className="border-b border-[#c9cfd5]">
                  <button
                    type="button"
                    onClick={() => void choose(p)}
                    disabled={Boolean(saving)}
                    aria-pressed={bank}
                    title={bank ? 'Bank PDFs print here' : `Print bank PDFs on ${p.name}`}
                    className={`flex w-full items-center gap-3 px-2 py-3 text-left transition ${bank ? 'bg-[#edf0f3]' : 'hover:bg-[#edf0f3]/60'}`}
                  >
                    <span
                      className={`flex h-7 w-7 shrink-0 items-center justify-center border-2 ${bank ? 'border-[#0e1318] bg-[#0e1318] text-white' : 'border-[#c9cfd5] bg-white'}`}
                      aria-hidden
                    >
                      {saving === p.name ? <Loader2 size={15} className="animate-spin text-[#0e1318]" /> : bank ? <Check size={16} strokeWidth={3} /> : null}
                    </span>
                    <Printer size={20} className="shrink-0 text-[#4c5660]" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-base font-semibold">{p.name}</span>
                      <span className="block truncate text-xs text-[#4c5660]">
                        {where(p)}
                        {roles.length > 0 && ` · ${roles.join(', ')}`}
                        {bank && ' · Bank PDFs print here'}
                      </span>
                      {!p.online && p.reason && <span className="block text-xs font-semibold text-[#b3202a]">{p.reason}</span>}
                    </span>
                    <span
                      className={`shrink-0 px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-white ${p.online ? 'bg-[#007a3d]' : 'bg-[#b3202a]'}`}
                    >
                      {p.online ? 'Online' : 'Offline'}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </Card>
      </div>
    </div>
  )
}
