// BillScanner — point phone camera at a bill, Claude reads the handwriting,
// guarantee card gets auto-filled and sent to the printer.

import { useRef, useState } from 'react'
import { Camera, CheckCircle, Loader, Plus, Printer, Trash2, X, XCircle } from 'lucide-react'
import { useStore } from '../../lib/store'
import type { Customer, GuaranteeDocument, GuaranteeYears, ProductCategory } from '../../lib/types'
import { CATEGORY_LABELS } from '../../lib/types'
import { formatINR } from '../../lib/pricing'
import { PRINT_SERVER_URL } from '../../lib/printServer'
import { GuaranteeCard } from '../print/GuaranteeCard'
import { PrintPreview } from '../print/PrintPreview'
import { Button, PageHeader } from '../../components/ui'

const uid = () => Math.random().toString(36).slice(2, 10)

/** Resize image to maxPx on the longest side, return base64 (no data: prefix). */
function resizeImage(file: File, maxPx = 1000): Promise<string> {
  return new Promise((ok, fail) => {
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, maxPx / Math.max(img.width, img.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.width * scale)
      canvas.height = Math.round(img.height * scale)
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
      ok(canvas.toDataURL('image/jpeg', 0.85).split(',')[1])
    }
    img.onerror = fail
    img.src = URL.createObjectURL(file)
  })
}

type ScanState = 'idle' | 'scanning' | 'done' | 'error'

type ScannedItem = {
  brandName: string
  guaranteeYears?: number
  category?: GuaranteeDocument['category']
  heightInches?: number | null
  heightSoot?: number | null
  widthInches?: number | null
  widthSoot?: number | null
  sizeLabel?: string | null
  qty?: number | null
  amount?: number | null
}

type ScanReviewData = {
  customerName: string
  mobile: string | null
  uid: string | null
  address: string | null
  items: ScannedItem[]
}

const PRODUCT_CATEGORIES: ProductCategory[] = [
  'readymade-door',
  'flush-door',
  'plywood-6',
  'block-board-12',
  'block-board-19',
  'aluminium-door',
  'window-2-track',
  'window-3-track',
]
const GUARANTEE_OPTIONS: GuaranteeYears[] = [0, 1, 3, 5, 7, 10, 15, 20, 25]

function guaranteeYears(value: unknown): GuaranteeYears {
  return [0, 1, 3, 5, 7, 10, 15, 20, 25].includes(Number(value)) ? Number(value) as GuaranteeYears : 0
}

function toNullableNumber(value: unknown): number | null {
  if (value === '' || value == null) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function emptyItem(): ScannedItem {
  return {
    brandName: '',
    category: 'readymade-door',
    heightInches: null,
    heightSoot: 0,
    widthInches: null,
    widthSoot: 0,
    sizeLabel: null,
    qty: 1,
    amount: null,
    guaranteeYears: 0,
  }
}

function scanToDocument(data: ScanReviewData, quotationsLength: number): GuaranteeDocument {
  const primaryItem = data.items?.[0]
  const customer: Customer = {
    id: uid(),
    name: data.customerName ?? '',
    mobile: data.mobile ?? '',
    uid: data.uid ?? '',
    address: data.address ?? '',
  }

  return {
    id: uid(),
    number: `GC-${new Date().getFullYear()}-${String(quotationsLength + 1).padStart(4, '0')}`,
    date: new Date().toISOString(),
    customer,
    category: primaryItem?.category ?? 'readymade-door',
    height: { inches: primaryItem?.heightInches ?? 0, soot: primaryItem?.heightSoot ?? 0 },
    width: { inches: primaryItem?.widthInches ?? 0, soot: primaryItem?.widthSoot ?? 0 },
    qty: primaryItem?.qty ?? 1,
    items: (data.items ?? []).map((it) => ({
      brandName: it.brandName,
      guaranteeYears: guaranteeYears(it.guaranteeYears),
      sizeLabel: it.sizeLabel ?? null,
      amount: it.amount ?? null,
    })),
  }
}

export function BillScanner() {
  const { quotations, upsertCustomer } = useStore()
  const inputRef = useRef<HTMLInputElement>(null)

  const [state, setState] = useState<ScanState>('idle')
  const [preview, setPreview] = useState<string | null>(null)
  const [doc, setDoc] = useState<GuaranteeDocument | null>(null)
  const [rawScan, setRawScan] = useState<ScanReviewData | null>(null)
  const [draftScan, setDraftScan] = useState<ScanReviewData | null>(null)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [learning, setLearning] = useState(false)
  const [learnedMsg, setLearnedMsg] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [showPrint, setShowPrint] = useState(false)

  async function handleCapture(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    // Show the captured photo as preview
    const reader = new FileReader()
    reader.onload = () => setPreview(reader.result as string)
    reader.readAsDataURL(file)

    setState('scanning')
    setErrorMsg('')

    try {
      // Resize to max 1000px before sending — cuts token cost ~70%, text stays readable
      const base64 = await resizeImage(file, 1000)

      const res = await fetch(`${PRINT_SERVER_URL}/scan-bill`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: base64, mediaType: file.type }),
      })

      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.error ?? 'Scan failed')

      const d: ScanReviewData = {
        customerName: json.data.customerName ?? '',
        mobile: json.data.mobile ?? '',
        uid: json.data.uid ?? '',
        address: json.data.address ?? '',
        items: (json.data.items ?? []).map((it: ScannedItem) => ({
          ...emptyItem(),
          ...it,
          guaranteeYears: guaranteeYears(it.guaranteeYears),
          amount: it.amount ?? null,
          qty: it.qty ?? 1,
        })),
      }

      setRawScan(d)
      setDraftScan(d)
      setDoc(null)
      setLearnedMsg('')
      setReviewOpen(true)
      setState('done')
    } catch (err) {
      setState('error')
      setErrorMsg(String(err))
    }
  }

  async function saveReview() {
    if (!draftScan) return
    setLearning(true)
    setErrorMsg('')

    try {
      let finalScan = draftScan
      if (rawScan) {
        const res = await fetch(`${PRINT_SERVER_URL}/scan-bill/learn`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ before: rawScan, after: draftScan }),
        })
        const json = await res.json()
        if (!res.ok || !json.ok) throw new Error(json.error ?? 'Learning failed')
        finalScan = json.data ?? draftScan
        setLearnedMsg(json.learned?.length ? `Learned ${json.learned.length} correction(s)` : 'Saved')
      }

      const guaranteeDoc = scanToDocument(finalScan, quotations.length)
      upsertCustomer(guaranteeDoc.customer)
      setRawScan(finalScan)
      setDraftScan(finalScan)
      setDoc(guaranteeDoc)
      setReviewOpen(false)
    } catch (err) {
      setErrorMsg(String(err))
    } finally {
      setLearning(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="Scan Bill → Guarantee Card"
        subtitle="Point your camera at the handwritten bill"
      />

      <div className="p-4 space-y-4 max-w-lg mx-auto">
        {/* Camera button */}
        <div
          onClick={() => inputRef.current?.click()}
          className="flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-stone-300 bg-stone-50 p-10 cursor-pointer hover:border-shiv-green hover:bg-stone-100 transition dark:border-white/20 dark:bg-white/5"
        >
          <Camera size={40} className="text-stone-400 dark:text-stone-500" />
          <span className="text-base font-semibold text-stone-600 dark:text-stone-300">
            Tap to scan bill
          </span>
          <span className="text-xs text-stone-400 dark:text-stone-500">
            Opens camera · works best in good light
          </span>
          {/* capture="environment" = rear camera on mobile */}
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={handleCapture}
          />
        </div>

        {/* Photo preview */}
        {preview && (
          <img
            src={preview}
            alt="Bill photo"
            className="w-full rounded-xl object-contain max-h-64 border border-stone-200 dark:border-white/10"
          />
        )}

        {/* Status */}
        {state === 'scanning' && (
          <div className="flex items-center gap-3 rounded-xl bg-stone-100 dark:bg-white/5 px-4 py-3">
            <Loader size={20} className="animate-spin text-shiv-green" />
            <span className="text-sm font-medium">Claude is reading the bill…</span>
          </div>
        )}

        {state === 'error' && (
          <div className="flex items-start gap-3 rounded-xl bg-red-50 dark:bg-red-950/30 px-4 py-3">
            <XCircle size={20} className="text-red-500 mt-0.5 shrink-0" />
            <div>
              <div className="text-sm font-semibold text-red-700 dark:text-red-400">Scan failed</div>
              <div className="text-xs text-red-600 dark:text-red-400 mt-0.5">{errorMsg}</div>
            </div>
          </div>
        )}

        {state === 'done' && !doc && draftScan && (
          <div className="flex items-center gap-3 rounded-xl bg-green-50 dark:bg-green-950/30 px-4 py-3">
            <CheckCircle size={20} className="text-green-600 shrink-0" />
            <div>
              <div className="text-sm font-semibold text-green-700 dark:text-green-400">Bill read successfully</div>
              <div className="text-xs text-green-600 dark:text-green-400 mt-0.5">Review and save the extracted details</div>
            </div>
          </div>
        )}

        {state === 'done' && doc && (
          <>
            <div className="flex items-center gap-3 rounded-xl bg-green-50 dark:bg-green-950/30 px-4 py-3">
              <CheckCircle size={20} className="text-green-600 shrink-0" />
              <div>
                <div className="text-sm font-semibold text-green-700 dark:text-green-400">Bill read successfully</div>
                <div className="text-xs text-green-600 dark:text-green-400 mt-0.5">
                  {doc.customer.name || 'Customer'} · {doc.items.length} item(s)
                </div>
              </div>
            </div>

            {learnedMsg && (
              <div className="rounded-xl bg-stone-100 px-4 py-2 text-xs font-medium text-stone-600 dark:bg-white/5 dark:text-stone-300">
                {learnedMsg}
              </div>
            )}

            {/* Extracted summary */}
            <div className="rounded-xl border border-stone-200/90 bg-stone-50 dark:border-white/10 dark:bg-stone-900/90 p-4 space-y-2 text-sm">
              <div><span className="font-semibold text-stone-500">M/s</span> {doc.customer.name || '—'}</div>
              <div><span className="font-semibold text-stone-500">Mobile</span> {doc.customer.mobile || '—'}</div>
              {doc.items.map((it, i) => (
                <div key={i} className="flex justify-between">
                  <span>
                    {it.brandName}
                    {it.sizeLabel ? <span className="text-stone-500"> · {it.sizeLabel}</span> : null}
                  </span>
                  <span className={it.guaranteeYears ? 'text-shiv-red font-semibold' : 'text-stone-600 dark:text-stone-300'}>
                    {it.amount ? `${it.guaranteeYears ? `${it.guaranteeYears} Years · ` : ''}${formatINR(it.amount)}` : it.guaranteeYears ? `${it.guaranteeYears} Years` : '—'}
                  </span>
                </div>
              ))}
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setReviewOpen(true)}
              >
                Edit
              </Button>
              <Button
                className="flex-1 flex items-center justify-center gap-2"
                onClick={() => setShowPrint(true)}
              >
                <Printer size={18} /> Preview &amp; Print Guarantee Card
              </Button>
              <Button
                variant="outline"
                onClick={() => { setState('idle'); setPreview(null); setDoc(null); setRawScan(null); setDraftScan(null); setReviewOpen(false) }}
              >
                Rescan
              </Button>
            </div>
          </>
        )}
      </div>

      {showPrint && doc && (
        <PrintPreview title="Guarantee Card" onClose={() => setShowPrint(false)}>
          <GuaranteeCard document={doc} />
        </PrintPreview>
      )}

      {reviewOpen && draftScan && (
        <ScanReviewModal
          data={draftScan}
          errorMsg={errorMsg}
          saving={learning}
          canClose={Boolean(doc)}
          onChange={setDraftScan}
          onClose={() => setReviewOpen(false)}
          onSave={saveReview}
        />
      )}
    </div>
  )
}

function ScanReviewModal({
  data,
  errorMsg,
  saving,
  canClose,
  onChange,
  onClose,
  onSave,
}: {
  data: ScanReviewData
  errorMsg: string
  saving: boolean
  canClose: boolean
  onChange: (data: ScanReviewData) => void
  onClose: () => void
  onSave: () => void
}) {
  function updateItem(index: number, patch: Partial<ScannedItem>) {
    onChange({
      ...data,
      items: data.items.map((item, i) => i === index ? { ...item, ...patch } : item),
    })
  }

  function removeItem(index: number) {
    onChange({ ...data, items: data.items.filter((_, i) => i !== index) })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 p-0 sm:items-center sm:p-4">
      <div className="flex max-h-[94vh] w-full max-w-4xl flex-col overflow-hidden rounded-t-xl border border-stone-200 bg-stone-50 shadow-2xl dark:border-white/10 dark:bg-stone-950 sm:rounded-xl">
        <div className="flex items-start justify-between gap-3 border-b border-stone-200 px-4 py-3 dark:border-white/10">
          <div>
            <h2 className="text-base font-bold text-stone-950 dark:text-stone-50">Review scanned bill</h2>
            <p className="text-xs font-medium text-stone-500 dark:text-stone-400">Edits saved here are learned for future scans.</p>
          </div>
          {canClose && (
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-2 text-stone-500 hover:bg-stone-100 dark:hover:bg-white/10"
              aria-label="Close"
            >
              <X size={18} />
            </button>
          )}
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          <div className="grid gap-3 md:grid-cols-4">
            <Field label="M/s">
              <input
                value={data.customerName}
                onChange={(e) => onChange({ ...data, customerName: e.target.value })}
                className={inputClass}
              />
            </Field>
            <Field label="Mobile">
              <input
                value={data.mobile ?? ''}
                onChange={(e) => onChange({ ...data, mobile: e.target.value })}
                className={inputClass}
              />
            </Field>
            <Field label="UID">
              <input
                value={data.uid ?? ''}
                onChange={(e) => onChange({ ...data, uid: e.target.value })}
                className={inputClass}
              />
            </Field>
            <Field label="Address">
              <input
                value={data.address ?? ''}
                onChange={(e) => onChange({ ...data, address: e.target.value })}
                className={inputClass}
              />
            </Field>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-bold uppercase text-stone-500 dark:text-stone-400">Items</h3>
              <Button
                type="button"
                variant="outline"
                className="flex items-center gap-1.5 px-3 py-1.5"
                onClick={() => onChange({ ...data, items: [...data.items, emptyItem()] })}
              >
                <Plus size={15} /> Add
              </Button>
            </div>

            {data.items.map((item, index) => (
              <div key={index} className="rounded-lg border border-stone-200 bg-white p-3 dark:border-white/10 dark:bg-white/5">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold text-stone-700 dark:text-stone-200">Item {index + 1}</div>
                  <button
                    type="button"
                    onClick={() => removeItem(index)}
                    className="rounded-lg p-1.5 text-stone-400 hover:bg-red-50 hover:text-shiv-red dark:hover:bg-red-950/30"
                    aria-label={`Remove item ${index + 1}`}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>

                <div className="grid gap-3 md:grid-cols-12">
                  <Field label="Brand / Design" className="md:col-span-5">
                    <input
                      value={item.brandName}
                      onChange={(e) => updateItem(index, { brandName: e.target.value })}
                      className={inputClass}
                    />
                  </Field>
                  <Field label="Category" className="md:col-span-3">
                    <select
                      value={item.category ?? 'readymade-door'}
                      onChange={(e) => updateItem(index, { category: e.target.value as ProductCategory })}
                      className={inputClass}
                    >
                      {PRODUCT_CATEGORIES.map((category) => (
                        <option key={category} value={category}>{CATEGORY_LABELS[category]}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Qty" className="md:col-span-1">
                    <input
                      type="number"
                      min="0"
                      value={item.qty ?? ''}
                      onChange={(e) => updateItem(index, { qty: toNullableNumber(e.target.value) })}
                      className={inputClass}
                    />
                  </Field>
                  <Field label="Amount" className="md:col-span-2">
                    <input
                      type="number"
                      min="0"
                      value={item.amount ?? ''}
                      onChange={(e) => updateItem(index, { amount: toNullableNumber(e.target.value) })}
                      className={inputClass}
                    />
                  </Field>
                  <Field label="Guarantee" className="md:col-span-1">
                    <select
                      value={guaranteeYears(item.guaranteeYears)}
                      onChange={(e) => updateItem(index, { guaranteeYears: guaranteeYears(e.target.value) })}
                      className={inputClass}
                    >
                      {GUARANTEE_OPTIONS.map((years) => (
                        <option key={years} value={years}>{years}</option>
                      ))}
                    </select>
                  </Field>

                  <Field label="Size Label" className="md:col-span-2">
                    <input
                      placeholder="8x4"
                      value={item.sizeLabel ?? ''}
                      onChange={(e) => updateItem(index, { sizeLabel: e.target.value || null })}
                      className={inputClass}
                    />
                  </Field>
                  <Field label="H inches" className="md:col-span-2">
                    <input
                      type="number"
                      min="0"
                      value={item.heightInches ?? ''}
                      onChange={(e) => updateItem(index, { heightInches: toNullableNumber(e.target.value) })}
                      className={inputClass}
                    />
                  </Field>
                  <Field label="H soot" className="md:col-span-2">
                    <input
                      type="number"
                      min="0"
                      max="7"
                      value={item.heightSoot ?? 0}
                      onChange={(e) => updateItem(index, { heightSoot: toNullableNumber(e.target.value) ?? 0 })}
                      className={inputClass}
                    />
                  </Field>
                  <Field label="W inches" className="md:col-span-2">
                    <input
                      type="number"
                      min="0"
                      value={item.widthInches ?? ''}
                      onChange={(e) => updateItem(index, { widthInches: toNullableNumber(e.target.value) })}
                      className={inputClass}
                    />
                  </Field>
                  <Field label="W soot" className="md:col-span-2">
                    <input
                      type="number"
                      min="0"
                      max="7"
                      value={item.widthSoot ?? 0}
                      onChange={(e) => updateItem(index, { widthSoot: toNullableNumber(e.target.value) ?? 0 })}
                      className={inputClass}
                    />
                  </Field>
                </div>
              </div>
            ))}
          </div>

          {errorMsg && (
            <div className="rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-700 dark:bg-red-950/30 dark:text-red-300">
              {errorMsg}
            </div>
          )}
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-stone-200 px-4 py-3 dark:border-white/10 sm:flex-row sm:justify-end">
          {canClose && <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>}
          <Button type="button" onClick={onSave} disabled={saving} className="flex items-center justify-center gap-2">
            {saving ? <Loader size={16} className="animate-spin" /> : <CheckCircle size={16} />}
            Save &amp; Learn
          </Button>
        </div>
      </div>
    </div>
  )
}

const inputClass = 'w-full rounded-lg border border-stone-300 bg-stone-50 px-2.5 py-2 text-sm outline-none focus:border-shiv-green focus:ring-2 focus:ring-shiv-green/20 dark:border-white/15 dark:bg-stone-950 dark:text-stone-100'

function Field({
  label,
  className = '',
  children,
}: {
  label: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-xs font-semibold text-stone-500 dark:text-stone-400">{label}</span>
      {children}
    </label>
  )
}
