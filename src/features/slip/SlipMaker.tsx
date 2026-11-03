import { useEffect, useState } from 'react'
import { ImageDown, Plus, Printer, RotateCcw, X } from 'lucide-react'
import { Button, Input, Page, PageHeader } from '../../components/ui'
import { toast } from '../../components/Toast'
import { elementToJpeg, shareJpeg } from '../../lib/shareImage'
import SlipPaper from './SlipPaper'
import {
  amountFromRate,
  DEFAULT_NOTE,
  FIRST_SLIP,
  newRow,
  nextNumber,
  printedRows,
  slipFigure,
  slipTotal,
  stampedNumber,
  type Slip,
  type SlipRow,
} from './slip'

const DRAFT_KEY = 'shiv.slip.draft'

function readDraft(): Slip {
  try {
    const saved = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null') as Slip | null
    if (saved && Array.isArray(saved.rows)) return saved
  } catch {
    // A draft that will not read is no worse than no draft.
  }
  return FIRST_SLIP
}

const cellClass = 'px-2 py-1.5'

/** Makes a bill on the shop's own handwritten slip: for the customer, not the books. */
export function SlipMaker() {
  const [slip, setSlip] = useState<Slip>(readDraft)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(slip))
    } catch {
      // Private window or full storage: the slip on screen still works.
    }
  }, [slip])

  const setField = (field: 'number' | 'previous' | 'note', value: string) =>
    setSlip((current) => ({ ...current, [field]: value }))

  const setRow = (id: string, patch: Partial<SlipRow>) =>
    setSlip((current) => ({
      ...current,
      rows: current.rows.map((row) => {
        if (row.id !== id) return row
        const next = { ...row, ...patch }
        // Typing an amount by hand ends the rate; a rate keeps the amount worked out.
        if ('amount' in patch) next.rate = ''
        else if (next.rate.trim() && ('qty' in patch || 'rate' in patch)) next.amount = amountFromRate(next.qty, next.rate)
        return next
      }),
    }))

  const addRow = () => setSlip((current) => ({ ...current, rows: [...current.rows, newRow()] }))

  const removeRow = (id: string) =>
    setSlip((current) => {
      const rows = current.rows.filter((row) => row.id !== id)
      return { ...current, rows: rows.length ? rows : [newRow()] }
    })

  const startNew = () => {
    if (printedRows(slip.rows).length && !window.confirm('Clear this slip and start the next number?')) return
    setSlip({ number: nextNumber(slip.number), previous: '', note: DEFAULT_NOTE, rows: [newRow()] })
  }

  const saveImage = async () => {
    setBusy(true)
    try {
      // The wrapper takes the white the picture maker paints on its outermost element, not the paper.
      const blob = await elementToJpeg(<div><SlipPaper slip={slip} /></div>, { scale: 3, quality: 0.95 })
      const how = await shareJpeg(blob, `slip-${stampedNumber(slip.number)}.jpg`)
      if (how === 'saved') toast('Slip saved as a picture')
    } catch {
      toast('Could not make the picture', 'error')
    } finally {
      setBusy(false)
    }
  }

  const print = () => {
    document.body.classList.add('printing-slip')
    window.addEventListener('afterprint', () => document.body.classList.remove('printing-slip'), { once: true })
    window.print()
  }

  return (
    <>
      <PageHeader
        title="Slip"
        subtitle="Written the way the shop's slip is. Not entered in the books."
        actions={
          <>
            <Button variant="outline" onClick={startNew}><RotateCcw />New slip</Button>
            <Button variant="outline" onClick={print}><Printer />Print</Button>
            <Button onClick={saveImage} disabled={busy}><ImageDown />{busy ? 'Making...' : 'Save image'}</Button>
          </>
        }
      />
      <Page>
        <div className="flex flex-wrap items-start gap-6">
          <div className="min-w-[520px] flex-1 space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <Input label="Slip no." inputMode="numeric" value={slip.number} onChange={(e) => setField('number', e.target.value)} />
              <Input label="Previous balance" inputMode="decimal" value={slip.previous} onChange={(e) => setField('previous', e.target.value)} />
              <Input label="Written beside the total" value={slip.note} onChange={(e) => setField('note', e.target.value)} />
            </div>

            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-semibold text-muted">
                  <th className="pb-1 font-semibold">Item</th>
                  <th className="w-16 pb-1 font-semibold">Qty</th>
                  <th className="w-24 pb-1 font-semibold">Unit</th>
                  <th className="w-20 pb-1 font-semibold">Rate</th>
                  <th className="w-24 pb-1 font-semibold">Amount</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {slip.rows.map((row, index) => (
                  <tr key={row.id}>
                    <td className="py-0.5 pr-1">
                      <Input className={cellClass} autoFocus={index > 0 && index === slip.rows.length - 1 && !row.item} value={row.item} onChange={(e) => setRow(row.id, { item: e.target.value })} />
                    </td>
                    <td className="py-0.5 pr-1">
                      <Input className={cellClass} inputMode="decimal" value={row.qty} onChange={(e) => setRow(row.id, { qty: e.target.value })} />
                    </td>
                    <td className="py-0.5 pr-1">
                      <Input className={cellClass} list="slip-units" value={row.unit} onChange={(e) => setRow(row.id, { unit: e.target.value })} />
                    </td>
                    <td className="py-0.5 pr-1">
                      <Input className={cellClass} inputMode="decimal" value={row.rate} onChange={(e) => setRow(row.id, { rate: e.target.value })} />
                    </td>
                    <td className="py-0.5 pr-1">
                      <Input
                        className={cellClass}
                        inputMode="decimal"
                        value={row.amount}
                        onChange={(e) => setRow(row.id, { amount: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && index === slip.rows.length - 1) addRow()
                        }}
                      />
                    </td>
                    <td className="py-0.5 text-right">
                      <button
                        type="button"
                        aria-label={`Remove ${row.item || 'row'}`}
                        onClick={() => removeRow(row.id)}
                        className="inline-flex h-8 w-8 items-center justify-center text-muted hover:text-shiv-red"
                      >
                        <X size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <datalist id="slip-units">
              <option value="Pc" />
              <option value="Set" />
              <option value="Kg" />
              <option value="Mtr" />
              <option value="Box" />
              <option value="Pkt" />
            </datalist>

            <div className="flex items-center justify-between">
              <Button variant="outline" onClick={addRow}><Plus />Add item</Button>
              <div className="text-right">
                <div className="text-xs font-semibold text-muted">Total</div>
                <div className="text-xl font-bold tabular-nums">{slipFigure(slipTotal(slip))}</div>
              </div>
            </div>
          </div>

          <div className="sticky top-4 shrink-0">
            <SlipPaper slip={slip} />
          </div>
        </div>
      </Page>
    </>
  )
}
