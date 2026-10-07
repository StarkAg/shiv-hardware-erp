import { useEffect, useMemo, useRef, useState } from 'react'
import AttachmentViewer from '../../components/AttachmentViewer'
import { Link } from 'react-router-dom'
import { useMutation, useQuery } from 'convex/react'
import { Camera, Check, ChevronLeft, Minus, PackageCheck, Plus, Search, X } from 'lucide-react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { foldName } from '../../../convex/lib/text'
import { newId, readNote, type Known, type Line } from './readNote'
import { useUploader } from '../ledger/lib/upload'
import { CheckedBy } from '../bills/Deliveries'
import { DEFAULT_PAYMENT_MODE } from '../../lib/types'

/**
 * Goods Received, on the phone.
 *
 * Made for whoever is standing by the tempo: pick the supplier, photograph the
 * challan, tap what came — the supplier's usual items are already on screen —
 * or write it the way it would be said, "15 Sunmica, 10 hinges", and say who
 * counted it. It saves a Goods Received Note, which shows on the supplier's
 * account and on Bills to Come until the bill arrives.
 */

type Supplier = { _id: Id<'ledgers'>; name: string; place: string; phone: string; last: number }

const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const tile = 'rounded-xl border border-stone-200 bg-white p-3 text-left shadow-sm transition active:scale-[0.98] dark:border-white/10 dark:bg-white/5'
const section = 'space-y-2'
const heading = 'text-xs font-bold uppercase tracking-[0.12em] text-stone-500'

export function Receive() {
  const suppliers = useQuery(api.receipts.suppliers, {}) as Supplier[] | undefined
  const [supplier, setSupplier] = useState<Supplier | null>(null)
  const [find, setFind] = useState('')
  const known = useQuery(api.receipts.forSupplier, supplier ? { ledgerId: supplier._id } : 'skip') as
    | { usual: (Known & { times: number })[]; items: (Known & { id: string })[] }
    | null
    | undefined
  const [photos, setPhotos] = useState<File[]>([])
  const [viewing, setViewing] = useState<number | null>(null)
  const [lines, setLines] = useState<Line[]>([])
  const [note, setNote] = useState('')
  const [itemFind, setItemFind] = useState('')
  const [by, setBy] = useState('')
  const [challan, setChallan] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState<{ voucherId: string; party: string; lines: Line[] } | null>(null)
  const camera = useRef<HTMLInputElement>(null)
  const upload = useUploader()
  const postBill = useMutation(api.billLedger.postBill)
  const savedVoucher = useQuery(api.vouchers.detail, saved ? ({ id: saved.voucherId } as never) : 'skip') as
    | { vchLabel?: string }
    | null
    | undefined

  // One object URL per photo, not one per render.
  const previews = useMemo(() => photos.map((f) => URL.createObjectURL(f)), [photos])
  useEffect(() => () => previews.forEach(url => URL.revokeObjectURL(url)), [previews])

  const everything: Known[] = useMemo(
    () => [...(known?.usual ?? []), ...(known?.items ?? [])],
    [known],
  )

  const shownSuppliers = useMemo(() => {
    const q = foldName(find)
    const list = suppliers ?? []
    return q ? list.filter((s) => foldName(`${s.name} ${s.place} ${s.phone}`).includes(q)) : list.slice(0, 8)
  }, [suppliers, find])

  const itemResults = useMemo(() => {
    const q = foldName(itemFind)
    if (!q) return []
    return (known?.items ?? []).filter((i) => foldName(i.name).includes(q)).slice(0, 12)
  }, [known, itemFind])

  const add = (item: Known, qty?: number) =>
    setLines((ls) => {
      const at = ls.findIndex((l) => foldName(l.name) === foldName(item.name))
      if (at >= 0) {
        const next = [...ls]
        next[at] = { ...next[at], qty: next[at].qty + (qty ?? 1) }
        return next
      }
      return [...ls, { key: newId(), name: item.name, qty: qty ?? (item.lastQty || 1), unit: item.unit || 'Pc' }]
    })

  const setQty = (key: string, qty: number) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, qty: Math.max(0, Math.round(qty * 100) / 100) } : l)))

  const takeNote = () => {
    const read = readNote(note, everything)
    if (!read.length) return
    for (const l of read) add({ name: l.name, unit: l.unit }, l.qty)
    setNote('')
  }

  const reset = () => {
    setSupplier(null)
    setFind('')
    setPhotos([])
    setLines([])
    setNote('')
    setItemFind('')
    setChallan('')
    setError('')
    setSaved(null)
  }

  const save = async () => {
    setError('')
    if (!supplier) return setError('Pick the supplier first.')
    // Whatever is still in the note box counts too.
    const pending = note.trim() ? readNote(note, everything) : []
    const all = [...lines, ...pending].filter((l) => l.qty > 0)
    if (!all.length && !photos.length) return setError('Tap what came, write it in the note, or photograph the challan.')
    if (!by) return setError('Say who checked the goods.')
    setBusy(true)
    try {
      const ids: string[] = photos.length ? await upload(photos) : []
      const res = await postBill({
        bill: {
          id: newId(),
          number: '',
          kind: 'grn',
          date: today(),
          customerName: supplier.name,
          ref: challan.trim() || undefined,
          receivedBy: by,
          items: all.map((l) => ({ id: newId(), description: l.name, qty: l.qty, unit: l.unit, amount: 0 })),
          total: 0,
          paid: false,
          paymentMode: DEFAULT_PAYMENT_MODE,
        },
        attachments: ids.map((storageId) => ({ storageId: storageId as Id<'_storage'>, kind: 'challan' as const })),
      })
      setSaved({ voucherId: String(res.voucherId), party: supplier.name, lines: all })
      setNote('')
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^.*Uncaught Error:\s*/s, '').split('\n')[0] : String(e))
    } finally {
      setBusy(false)
    }
    return undefined
  }

  const shell = 'min-h-screen bg-stone-50 text-stone-900 dark:bg-stone-950 dark:text-stone-100'

  if (saved) {
    return (
      <div className={shell}>
        <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-green-600 text-white">
            <Check size={30} />
          </div>
          <div>
            <p className="text-lg font-bold">{savedVoucher?.vchLabel ?? 'Goods Received'} saved</p>
            <p className="text-sm text-stone-500">{saved.party}</p>
          </div>
          {saved.lines.length > 0 && (
            <ul className="w-full rounded-xl border border-stone-200 bg-white p-3 text-left text-sm dark:border-white/10 dark:bg-white/5">
              {saved.lines.map((l) => (
                <li key={l.key} className="flex justify-between py-0.5">
                  <span>{l.name}</span>
                  <span className="font-semibold tabular-nums">{l.qty} {l.unit}</span>
                </li>
              ))}
            </ul>
          )}
          <button onClick={reset} className="w-full rounded-xl bg-shiv-green py-3 text-base font-bold text-stone-950">
            Receive another delivery
          </button>
        </main>
      </div>
    )
  }

  return (
    <div className={shell}>
      {viewing !== null && <AttachmentViewer title="Challan photos" initialIndex={viewing}
        attachments={photos.map((file, index) => ({ url: previews[index], name: file.name, contentType: file.type }))}
        onClose={() => setViewing(null)} />}
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-stone-200 bg-stone-50/95 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur dark:border-white/10 dark:bg-stone-950/95">
        <Link to="/m" aria-label="Back" className="-ml-1 p-1 text-stone-500"><ChevronLeft size={20} /></Link>
        <PackageCheck size={20} className="text-shiv-green" aria-hidden="true" />
        <div>
          <h1 className="text-base font-bold leading-tight">Goods Received</h1>
          <p className="text-[11px] text-stone-500">
            {new Date().toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' })}
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-md space-y-6 px-4 pb-32 pt-4">
        {/* Supplier */}
        <section className={section}>
          <h2 className={heading}>1 · Supplier</h2>
          {supplier ? (
            <div className={`${tile} flex items-center justify-between`}>
              <div>
                <p className="font-bold">{supplier.name}</p>
                {supplier.place && <p className="text-xs text-stone-500">{supplier.place}</p>}
              </div>
              <button onClick={() => { setSupplier(null); setLines([]) }} className="text-sm font-semibold text-stone-500 underline">
                Change
              </button>
            </div>
          ) : (
            <>
              <label className="flex items-center gap-2 rounded-xl border border-stone-300 bg-white px-3 py-2.5 dark:border-white/15 dark:bg-white/5">
                <Search size={16} className="text-stone-400" aria-hidden="true" />
                <input
                  value={find}
                  onChange={(e) => setFind(e.target.value)}
                  placeholder="Search supplier"
                  className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-stone-400"
                />
              </label>
              {suppliers === undefined && <p className="text-sm text-stone-500">Loading suppliers…</p>}
              <div className="grid grid-cols-1 gap-2">
                {shownSuppliers.map((s) => (
                  <button key={s._id} onClick={() => setSupplier(s)} className={tile}>
                    <span className="block font-semibold">{s.name}</span>
                    {s.place && <span className="block text-xs text-stone-500">{s.place}</span>}
                  </button>
                ))}
                {suppliers && shownSuppliers.length === 0 && (
                  <p className="text-sm text-stone-500">No supplier by that name. Ask the counter to open the account first.</p>
                )}
              </div>
            </>
          )}
        </section>

        {supplier && (
          <>
            {/* Photo */}
            <section className={section}>
              <h2 className={heading}>2 · Challan photo</h2>
              <input
                ref={camera}
                type="file"
                accept="image/*"
                capture="environment"
                multiple
                hidden
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? [])
                  if (files.length) setPhotos((p) => [...p, ...files])
                  e.target.value = ''
                }}
              />
              <div className="flex flex-wrap gap-2">
                {photos.map((f, i) => (
                  <div key={`${f.name}-${i}`} className="relative h-20 w-20 overflow-hidden rounded-lg border border-stone-200 dark:border-white/10">
                    <button type="button" className="h-full w-full" aria-label={'Preview challan photo ' + (i + 1)} onClick={() => setViewing(i)}>
                      <img src={previews[i]} alt="" className="h-full w-full object-cover" />
                    </button>
                    <button
                      onClick={() => setPhotos((p) => p.filter((_, n) => n !== i))}
                      aria-label="Remove photo"
                      className="absolute right-0.5 top-0.5 rounded-full bg-black/60 p-0.5 text-white"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
                <button
                  onClick={() => camera.current?.click()}
                  className="flex h-20 min-w-[5rem] flex-1 items-center justify-center gap-2 rounded-lg border-2 border-dashed border-stone-300 text-sm font-semibold text-stone-600 dark:border-white/20 dark:text-stone-300"
                >
                  <Camera size={18} /> {photos.length ? 'Another page' : 'Photograph challan'}
                </button>
              </div>
            </section>

            {/* What came */}
            <section className={section}>
              <h2 className={heading}>3 · What came</h2>

              <div className="flex gap-2">
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); takeNote() } }}
                  placeholder="Write it: 15 Sunmica, 10 hinges"
                  className="min-w-0 flex-1 rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-base outline-none dark:border-white/15 dark:bg-white/5"
                />
                <button
                  onClick={takeNote}
                  disabled={!note.trim()}
                  className="rounded-xl bg-stone-800 px-4 text-sm font-bold text-white disabled:opacity-40 dark:bg-stone-700"
                >
                  Add
                </button>
              </div>

              {(known?.usual?.length ?? 0) > 0 && (
                <>
                  <p className="pt-1 text-xs text-stone-500">Usually from {supplier.name} — tap to add</p>
                  <div className="grid grid-cols-2 gap-2">
                    {known!.usual.slice(0, 12).map((i) => (
                      <button key={i.name} onClick={() => add(i)} className={tile}>
                        <span className="block text-sm font-semibold leading-tight">{i.name}</span>
                        <span className="block text-[11px] text-stone-500">
                          last {i.lastQty || 1} {i.unit}
                        </span>
                      </button>
                    ))}
                  </div>
                </>
              )}

              <label className="flex items-center gap-2 rounded-xl border border-stone-300 bg-white px-3 py-2 dark:border-white/15 dark:bg-white/5">
                <Search size={15} className="text-stone-400" aria-hidden="true" />
                <input
                  value={itemFind}
                  onChange={(e) => setItemFind(e.target.value)}
                  placeholder="Find any item"
                  className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-stone-400"
                />
              </label>
              {itemResults.length > 0 && (
                <div className="divide-y divide-stone-200 overflow-hidden rounded-xl border border-stone-200 bg-white dark:divide-white/10 dark:border-white/10 dark:bg-white/5">
                  {itemResults.map((i) => (
                    <button
                      key={`${i.id}-${i.name}`}
                      onClick={() => { add(i, 1); setItemFind('') }}
                      className="flex w-full items-center justify-between px-3 py-2.5 text-left text-sm"
                    >
                      <span>{i.name}</span>
                      <span className="text-xs text-stone-500">{i.unit}</span>
                    </button>
                  ))}
                </div>
              )}

              {lines.length > 0 && (
                <ul className="divide-y divide-stone-200 overflow-hidden rounded-xl border border-shiv-green/50 bg-white dark:divide-white/10 dark:bg-white/5">
                  {lines.map((l) => (
                    <li key={l.key} className="flex items-center gap-2 px-3 py-2">
                      <span className="min-w-0 flex-1 text-sm font-semibold leading-tight">{l.name}</span>
                      <button onClick={() => setQty(l.key, l.qty - 1)} aria-label={`One less ${l.name}`} className="rounded-lg bg-stone-100 p-2 dark:bg-white/10">
                        <Minus size={14} />
                      </button>
                      <input
                        type="number"
                        inputMode="decimal"
                        value={l.qty}
                        onChange={(e) => setQty(l.key, Number(e.target.value) || 0)}
                        aria-label={`${l.name} quantity`}
                        className="w-14 rounded-lg border border-stone-200 bg-transparent py-1.5 text-center text-base font-bold tabular-nums dark:border-white/10"
                      />
                      <button onClick={() => setQty(l.key, l.qty + 1)} aria-label={`One more ${l.name}`} className="rounded-lg bg-stone-100 p-2 dark:bg-white/10">
                        <Plus size={14} />
                      </button>
                      <span className="w-10 text-xs text-stone-500">{l.unit}</span>
                      <button onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} aria-label={`Remove ${l.name}`} className="p-1 text-stone-400">
                        <X size={16} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Who and challan number */}
            <section className={section}>
              <h2 className={heading}>4 · Checked by</h2>
              <CheckedBy value={by} onChange={setBy} />
              <input
                value={challan}
                onChange={(e) => setChallan(e.target.value)}
                placeholder="Challan no. (optional)"
                className="mt-2 w-full rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-base outline-none dark:border-white/15 dark:bg-white/5"
              />
            </section>
          </>
        )}
      </main>

      {supplier && (
        <footer className="fixed inset-x-0 bottom-0 border-t border-stone-200 bg-stone-50/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur dark:border-white/10 dark:bg-stone-950/95">
          <div className="mx-auto max-w-md space-y-2">
            {error && <p role="alert" className="text-sm font-semibold text-red-600 dark:text-red-400">{error}</p>}
            <button
              onClick={save}
              disabled={busy}
              className="w-full rounded-xl bg-shiv-green py-3.5 text-base font-bold text-stone-950 disabled:opacity-60"
            >
              {busy ? 'Saving…' : `Save · ${lines.length || (note.trim() ? '…' : 0)} item${lines.length === 1 ? '' : 's'}`}
            </button>
          </div>
        </footer>
      )}
    </div>
  )
}
