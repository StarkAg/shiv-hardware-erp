import { useState, type CSSProperties } from 'react'
import { Copy, Printer, X } from 'lucide-react'
import { Button, Card } from '../../components/ui'
import { toast } from '../../components/Toast'
import { printCardBacksOnServer } from '../../lib/printServer'
import BACKS from './cardBacks.json'

/**
 * The design side of the PVC guarantee cards: the shop's card backs (the same
 * designs as Desktop\Epson\Improved, copied in by scripts/export-card-backs.ps1),
 * one into each slot of the Epson's ID card tray, printed in one pass.
 *
 * The names go on the other side, from the Card screen.
 */

type CardBack = { name: string; file: string; thumb: string; years: number | null }
const ALL = BACKS as CardBack[]
const YEARS = [...new Set(ALL.map((b) => b.years).filter((y): y is number => y != null))].sort((a, b) => a - b)

// Each design is the card plus a 3 mm bleed (60 x 92 mm); shown cropped to the card.
const BLEED_STYLE: CSSProperties = {
  width: `${(60 / 54) * 100}%`,
  height: `${(92 / 86) * 100}%`,
  left: `${-(3 / 54) * 100}%`,
  top: `${-(3 / 86) * 100}%`,
}

function BackImage({ src }: { src: string }) {
  return <img src={`./card-backs/${src}`} alt="" draggable={false} className="absolute max-w-none select-none object-cover" style={BLEED_STYLE} />
}

export function CardBacks() {
  const [slots, setSlots] = useState<(CardBack | null)[]>([null, null])
  const [active, setActive] = useState<0 | 1>(0)
  const [years, setYears] = useState<number | null>(null)
  const [printing, setPrinting] = useState(false)
  // Shiv Counter on the shop PC prints them itself; anywhere else (the
  // website, an older Shiv Counter) they go through the shop PC's print server.
  const printBacks = window.shivDesktop?.printCardBacksDirect
    ?? ((payload: { files: (string | null)[] }) => printCardBacksOnServer(payload.files))
  const shown = years == null ? ALL : ALL.filter((b) => b.years === years)

  function choose(back: CardBack) {
    const next = [...slots]
    next[active] = back
    setSlots(next)
    // Slot 1 filled and slot 2 still empty: the next pick goes to slot 2.
    if (active === 0 && !next[1]) setActive(1)
  }

  function clear(i: 0 | 1) {
    setSlots((s) => s.map((b, j) => (j === i ? null : b)))
    setActive(i)
  }

  async function print() {
    if (printing || (!slots[0] && !slots[1])) return
    const label = slots.map((b) => b?.name).filter(Boolean).join(' + ')
    setPrinting(true)
    toast(`Printing ${label}…`, 'info')
    try {
      const result = await printBacks({ files: slots.map((b) => b?.file ?? null) })
      toast(`Sent ${label} to ${result.printer}`)
    } catch (err) {
      toast(`Print failed: ${err instanceof Error ? err.message : String(err)}`, 'error')
    } finally {
      setPrinting(false)
    }
  }

  const chosen = slots.filter(Boolean).length

  return (
    <div className="mobile-panel-screen flex flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-y-auto p-3 md:p-4">
        <div className="flex flex-col gap-3 lg:grid lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start lg:gap-4">
          <Card className="min-w-0 p-4 text-stone-800 dark:text-stone-100">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-bold uppercase tracking-wide text-muted">
                Card backs <span className="ml-1 normal-case">· pick one for slot {active + 1}</span>
              </h2>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Guarantee period">
                {[null, ...YEARS].map((y) => (
                  <button
                    key={y ?? 'all'}
                    type="button"
                    onClick={() => setYears(y)}
                    className={`min-h-9 rounded-full border px-3 text-xs font-semibold transition ${
                      years === y
                        ? 'border-shiv-green bg-shiv-green text-stone-950'
                        : 'border-stone-300 text-muted hover:border-shiv-green dark:border-white/15'
                    }`}
                  >
                    {y == null ? 'All' : `${y} yr`}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-3">
              {shown.map((back) => {
                const inSlots = slots.flatMap((b, i) => (b?.file === back.file ? [i + 1] : []))
                return (
                  <button
                    key={back.file}
                    type="button"
                    onClick={() => choose(back)}
                    title={`Put ${back.name} in slot ${active + 1}`}
                    className="group flex flex-col items-stretch gap-1.5 text-left"
                  >
                    <span
                      className={`relative block aspect-[54/86] overflow-hidden rounded-md border bg-stone-100 shadow-sm transition dark:bg-white/5 ${
                        inSlots.length ? 'border-shiv-green ring-2 ring-shiv-green/40' : 'border-stone-300 group-hover:border-shiv-green dark:border-white/20'
                      }`}
                    >
                      <BackImage src={back.thumb} />
                      {inSlots.length > 0 && (
                        <span className="absolute right-1 top-1 rounded-full bg-shiv-green px-1.5 py-0.5 text-[10px] font-bold text-stone-950">
                          Slot {inSlots.join(' + ')}
                        </span>
                      )}
                    </span>
                    <span className="truncate text-xs font-semibold">{back.name}</span>
                  </button>
                )
              })}
            </div>
          </Card>

          <aside className="lg:sticky lg:top-0">
            <Card className="p-4 text-stone-800 dark:text-stone-100">
              {/* The two slots side by side, as the cards sit in the tray. */}
              <div className="flex flex-wrap justify-center gap-4">
                {([0, 1] as const).map((i) => {
                  const back = slots[i]
                  return (
                    <div key={i} className="flex flex-col items-center gap-2">
                      <span className="rounded-full bg-stone-100 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-muted dark:bg-white/10 dark:text-stone-300">
                        Slot {i + 1}
                      </span>
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => setActive(i)}
                          aria-label={`Choose the slot ${i + 1} back`}
                          className={`relative flex h-[86mm] w-[54mm] flex-col items-center justify-center overflow-hidden rounded-md border text-center transition ${
                            active === i ? 'border-shiv-green ring-2 ring-shiv-green/40' : 'border-stone-300 dark:border-white/20'
                          } ${back ? 'bg-white' : 'border-2 border-dashed bg-stone-50 text-muted dark:bg-white/5'}`}
                        >
                          {back ? <BackImage src={back.file} /> : (
                            <span className="px-4 text-xs font-semibold">
                              {active === i ? 'Pick a design' : 'Empty — tap, then pick a design'}
                            </span>
                          )}
                        </button>
                        {back && (
                          <button
                            type="button"
                            onClick={() => clear(i)}
                            aria-label={`Empty slot ${i + 1}`}
                            className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full border border-stone-300 bg-white text-muted shadow-sm transition hover:border-red-400 hover:text-danger dark:border-white/20 dark:bg-stone-800 dark:text-stone-300"
                          >
                            <X size={13} />
                          </button>
                        )}
                      </div>
                      <span className="max-w-[54mm] truncate text-xs font-semibold">{back?.name ?? '—'}</span>
                    </div>
                  )
                })}
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
                <Button
                  variant="outline"
                  onClick={() => { setSlots([slots[0], slots[0]]); setActive(1) }}
                  disabled={!slots[0] || slots[1]?.file === slots[0].file}
                  className="flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold"
                >
                  <Copy size={16} /> Same in slot 2
                </Button>
                <Button
                  onClick={print}
                  disabled={!chosen || printing}
                  className="flex min-w-32 items-center justify-center gap-2 rounded-xl px-5 py-3 text-base font-semibold"
                >
                  <Printer size={20} /> {printing ? 'Printing…' : chosen === 2 ? 'Print 2 backs' : 'Print back'}
                </Button>
              </div>
            </Card>
          </aside>
        </div>
      </div>
    </div>
  )
}
