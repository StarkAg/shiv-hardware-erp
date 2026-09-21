import { useMemo, useState } from 'react'
import { useMutation } from 'convex/react'
import { Equal, Search, Trash2, X } from 'lucide-react'
import { api } from '../../../convex/_generated/api'
import { Button, Card, Input } from '../../components/ui'
import { rupees } from '../ledger/lib/format'
import type { ItemRow, PurchasedItem } from '../../lib/profit'

/**
 * Telling the panel what an item is, or what it cost.
 *
 * Three answers, and they are three different statements about the goods.
 *
 *  - The same item. One thing in the godown that the books have under two
 *    names — the 81×30 door sold as "30mm SG 81 X 30" and as "30mm S 81 X 30".
 *    Said once, and they are one item everywhere after that.
 *  - Bought as, so many to one. Not the same thing: a 20 kg drum of Fevicol is
 *    twenty 1 kg packs. The cost follows whatever the supplier charges for the
 *    pack, multiplied.
 *  - A rate typed. For stock bought before the panel, or somewhere it never
 *    saw, where there is no purchase to point at.
 */
export function SetCost({
  item,
  purchases,
  current,
  sameAs,
  onClose,
}: {
  item: ItemRow
  purchases: PurchasedItem[]
  current?: { cost?: number; sameAs?: string; sameAsLabel?: string; per?: number }
  sameAs?: { to: string; toLabel: string }
  onClose: () => void
}) {
  const setCost = useMutation(api.itemCosts.set)
  const clearCost = useMutation(api.itemCosts.clear)
  const setSame = useMutation(api.itemSame.set)
  const clearSame = useMutation(api.itemSame.clear)

  const [find, setFind] = useState('')
  const [picked, setPicked] = useState<PurchasedItem | null>(null)
  const [per, setPer] = useState('1')
  const [typed, setTyped] = useState(current?.cost ? String(current.cost) : '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const matches = useMemo(() => {
    const needle = find.trim().toLowerCase()
    const rows = needle
      ? purchases.filter(
          (p) => p.name.toLowerCase().includes(needle) || p.party.toLowerCase().includes(needle),
        )
      : purchases
    return rows.filter((p) => p.ref !== item.ref).slice(0, 40)
  }, [find, purchases, item.ref])

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true)
    setError('')
    try {
      await work()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  const markSame = (p: PurchasedItem) =>
    run(() =>
      setSame({ from: item.ref, to: p.ref, fromLabel: item.name, toLabel: p.name }),
    )

  const markBoughtAs = (p: PurchasedItem) => {
    const many = Number(per || '1')
    if (!(many > 0)) return setError('How many make one has to be a figure above nil.')
    return run(() =>
      setCost({ ref: item.ref, label: item.name, sameAs: p.ref, sameAsLabel: p.name, per: many }),
    )
  }

  const typeRate = () => {
    const cost = Number(typed)
    if (!(cost > 0)) return setError('A cost has to be a figure above nil.')
    return run(() => setCost({ ref: item.ref, label: item.name, cost }))
  }

  const settled =
    current?.cost !== undefined
      ? `now costed at ${rupees(current.cost)}`
      : current?.sameAs
        ? `now bought as ${current.sameAsLabel}${current.per && current.per !== 1 ? `, ${current.per} to one` : ''}`
        : sameAs
          ? `now the same item as ${sameAs.toLabel}`
          : ''

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <Card className="mt-8 w-full max-w-xl">
        <div onClick={(e) => e.stopPropagation()}>
          <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3 dark:border-white/10">
            <div className="min-w-0">
              <h2 className="truncate text-base font-bold">{item.name}</h2>
              <p className="text-xs text-muted">
                {item.qty} {item.unit || 'Pc'} sold · {rupees(item.sales)}
                {settled && ` · ${settled}`}
              </p>
            </div>
            <button
              className="rounded-lg p-1 text-muted hover:bg-stone-100 dark:hover:bg-white/10"
              onClick={onClose}
              aria-label="Close"
            >
              <X size={18} />
            </button>
          </div>

          <div className="space-y-4 p-4">
            <div>
              <div className="mb-2 text-xs font-semibold uppercase text-muted">
                What you buy it as
              </div>
              <div className="relative">
                <Search
                  size={14}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
                />
                <input
                  autoFocus
                  value={find}
                  onChange={(e) => { setFind(e.target.value); setPicked(null) }}
                  placeholder="Search what you buy"
                  className="w-full rounded-lg border border-stone-300 bg-stone-50 py-2 pl-9 pr-3 text-sm outline-none focus:border-shiv-green focus:ring-2 focus:ring-shiv-green/20 dark:border-white/15 dark:bg-stone-950 dark:text-stone-100"
                />
              </div>

              <div className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-line dark:border-white/10">
                {matches.map((p) => (
                  <div key={p.ref}>
                    <button
                      disabled={busy}
                      onClick={() => setPicked(picked?.ref === p.ref ? null : p)}
                      className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-stone-100 disabled:opacity-50 dark:hover:bg-white/10 ${
                        current?.sameAs === p.ref || sameAs?.to === p.ref ? 'bg-shiv-green/15' : ''
                      }`}
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{p.name}</span>
                        <span className="block truncate text-xs text-muted">
                          {p.party} · {p.date}
                        </span>
                      </span>
                      <span className="shrink-0 text-right text-sm font-semibold tabular-nums">
                        {rupees(p.each)}
                        <span className="block text-[11px] font-normal text-muted">
                          per {p.unit || 'Pc'}
                        </span>
                      </span>
                    </button>

                    {picked?.ref === p.ref && (
                      <div className="flex flex-wrap items-center gap-2 border-y border-line bg-card2 px-3 py-2 dark:border-white/10 dark:bg-white/5">
                        <button
                          disabled={busy}
                          onClick={() => markSame(p)}
                          className="flex items-center gap-1.5 rounded-lg bg-shiv-green px-3 py-1.5 text-xs font-semibold text-stone-950 disabled:opacity-50"
                        >
                          <Equal size={13} /> The same item
                        </button>
                        <span className="text-xs text-muted">or</span>
                        <span className="flex items-center gap-1.5 text-xs">
                          <input
                            type="number"
                            inputMode="decimal"
                            value={per}
                            onChange={(e) => setPer(e.target.value)}
                            className="w-16 rounded-lg border border-stone-300 bg-stone-50 px-2 py-1 text-xs tabular-nums dark:border-white/15 dark:bg-stone-950 dark:text-stone-100"
                          />
                          <span className="text-muted">
                            of those make one {item.unit || 'Pc'}
                          </span>
                          <button
                            disabled={busy}
                            onClick={() => markBoughtAs(p)}
                            className="rounded-lg border border-stone-300 px-2.5 py-1 font-semibold hover:bg-stone-100 disabled:opacity-50 dark:border-white/15 dark:hover:bg-white/10"
                          >
                            Bought as
                          </button>
                        </span>
                      </div>
                    )}
                  </div>
                ))}
                {!matches.length && (
                  <p className="px-3 py-6 text-center text-sm text-muted">
                    Nothing bought by that name.
                  </p>
                )}
              </div>
              <p className="mt-1.5 text-xs text-muted">
                The same item means one thing under two names. Bought as means this is
                made of those — twenty 1 kg packs to a 20 kg drum.
              </p>
            </div>

            <div className="flex items-end gap-2 border-t border-line pt-4 dark:border-white/10">
              <div className="flex-1">
                <Input
                  label={`Or a cost per ${item.unit || 'Pc'}, typed`}
                  type="number"
                  inputMode="decimal"
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  placeholder="0.00"
                  onKeyDown={(e) => e.key === 'Enter' && typeRate()}
                />
              </div>
              <Button onClick={typeRate} disabled={busy || !typed}>Save</Button>
            </div>

            {error && <p className="text-sm font-medium text-shiv-red">{error}</p>}

            {(current?.cost !== undefined || current?.sameAs || sameAs) && (
              <button
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    if (current) await clearCost({ ref: item.ref })
                    if (sameAs) await clearSame({ from: item.ref })
                  })
                }
                className="flex items-center gap-2 text-sm font-medium text-shiv-red hover:underline disabled:opacity-50"
              >
                <Trash2 size={14} /> Back to what the bills say
              </button>
            )}
          </div>
        </div>
      </Card>
    </div>
  )
}
