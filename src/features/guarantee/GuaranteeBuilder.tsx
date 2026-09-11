import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Check, Copy, FileText, Printer, Send, Trash2, X } from 'lucide-react'
import { Button, Card, Input } from '../../components/ui'
import { useStore } from '../../lib/store'
import {
  CATEGORY_LABELS,
  type Bill,
  type Brand,
  type Dimension,
  type GuaranteeCardItem,
  type GuaranteeDocument,
  type GuaranteeYears,
  type ProductCategory,
} from '../../lib/types'
import { GuaranteeCardFace } from '../print/GuaranteeCard'
import { enqueueGuaranteeSync } from '../../lib/offlineSync'
import { sendGuaranteeWhatsApp, isWhatsAppNotConnectedError, printOnServer, type ServerPrintPayload } from '../../lib/printServer'
import { WhatsAppLoginModal } from '../../components/WhatsAppLoginModal'

type GuaranteeLayout = 'card' | 'a4'

const blankDim = (): Dimension => ({ inches: 0, soot: 0 })
const uid = () => Math.random().toString(36).slice(2, 10)
// Normalizes however the name was typed (all caps, all lowercase, etc.) to
// Proper Case for the printed/previewed card — e.g. "AJAY KUMAR JEE" -> "Ajay Kumar Jee".
const toProperCase = (s: string) => s.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase())

// No Product/Brand/Years pickers anymore — the Items table's Type column is
// typed freely and matched against every known brand; these are just the
// fallback values used when a row's Type doesn't match one.
const DEFAULT_CATEGORY: ProductCategory = 'readymade-door'
const DEFAULT_YEARS: GuaranteeYears = 10
const DEFAULT_BRAND_LABEL = CATEGORY_LABELS[DEFAULT_CATEGORY]

// One spreadsheet row — Thickness / Type / Length / Height / Pcs / Rate — the
// same shape the shop is used to from Excel. Length/Height are whole inches
// plus an explicit soot (1/8") box, matching how the counter measures doors
// and boards. Each row maps 1:1 onto a GuaranteeCardItem, so the PVC card can
// print several different sizes/brands on one card instead of sharing a
// single document-level size.
type SizeRow = {
  id: string
  thickness: string
  type: string
  length: number | ''
  lengthSoot: number | ''
  height: number | ''
  heightSoot: number | ''
  qty: number | ''
  rate: number | ''
}

const blankRow = (): SizeRow => ({
  id: uid(),
  thickness: '',
  type: '',
  length: '',
  lengthSoot: '',
  height: '',
  heightSoot: '',
  qty: '',
  rate: '',
})
const isRowFilled = (r: SizeRow) =>
  r.type.trim() !== '' ||
  r.thickness.trim() !== '' ||
  r.length !== '' ||
  r.lengthSoot !== '' ||
  r.height !== '' ||
  r.heightSoot !== '' ||
  r.qty !== '' ||
  r.rate !== ''

const rowDim = (inches: number | '', soot: number | ''): Dimension | null =>
  inches !== '' || soot !== '' ? { inches: inches === '' ? 0 : Number(inches), soot: soot === '' ? 0 : Number(soot) } : null

// Editing the last row auto-appends a fresh blank one, so the table always
// has a trailing entry point (like continuing to type in Excel).
function updateSizeRow(setRows: (updater: (prev: SizeRow[]) => SizeRow[]) => void, id: string, patch: Partial<SizeRow>) {
  setRows((prev) => {
    const next = prev.map((r) => (r.id === id ? { ...r, ...patch } : r))
    const last = next[next.length - 1]
    if (last.id === id && isRowFilled(last)) next.push(blankRow())
    return next
  })
}

function removeSizeRow(setRows: (updater: (prev: SizeRow[]) => SizeRow[]) => void, id: string) {
  setRows((prev) => {
    const next = prev.filter((r) => r.id !== id)
    return next.length ? next : [blankRow()]
  })
}

function rowsToItems(rows: SizeRow[], brandOptions: Brand[], fallbackBrand: string, fallbackYears: GuaranteeYears): GuaranteeCardItem[] {
  const filled = rows.filter(isRowFilled)
  // No fake placeholder row when the table is empty — an empty table prints
  // (and previews) with no item line at all.
  if (!filled.length) return []
  return filled.map((row) => {
    const matched = brandOptions.find((b) => b.name.toLowerCase() === row.type.trim().toLowerCase())
    return {
      brandName: row.type.trim() || fallbackBrand,
      guaranteeYears: matched?.guaranteeYears ?? fallbackYears,
      thickness: row.thickness.trim() || null,
      height: rowDim(row.length, row.lengthSoot),
      width: rowDim(row.height, row.heightSoot),
      qty: row.qty !== '' ? Number(row.qty) : null,
      amount: row.rate !== '' ? Number(row.rate) : null,
    }
  })
}

export function GuaranteeBuilder({ layout }: { layout: GuaranteeLayout }) {
  const { sets, bills, saveGuarantee, nextGuaranteeNumber } = useStore()
  const navigate = useNavigate()
  const location = useLocation()
  // Each Save or Print mints a fresh GC-YYYY-NNNN ref number from the store sequence,
  // so every card becomes a permanent entry in the History tab and gets a stable QR.
  const [ref, setRef] = useState<{ number: string; id: string }>(() => {
    const number = `GC-${new Date().getFullYear()}-${Date.now().toString().slice(-5)}`
    return { number, id: number }
  })
  const [customer, setCustomer] = useState({ id: uid(), name: '', mobile: '', uid: '', address: '' })
  const [rows, setRows] = useState<SizeRow[]>(() => [blankRow()])
  const [savedToast, setSavedToast] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [showWhatsAppLogin, setShowWhatsAppLogin] = useState(false)

  // Slot 2: an independent second card printed in the same tray pass.
  // Ticking it on reveals its own small set of fields plus its own table.
  const [secondCardOn, setSecondCardOn] = useState(false)
  const [customer2, setCustomer2] = useState({ id: uid(), name: '', mobile: '', uid: '', address: '' })
  const [rows2, setRows2] = useState<SizeRow[]>(() => [blankRow()])

  // Unfiltered brand list — the Items table's Type column can match any known
  // brand regardless of category, since there's no Product picker anymore.
  const brandOptions = sets[0]?.brands ?? []
  const hasRows = rows.some(isRowFilled)

  // Mint a new card number from the store sequence. Refreshing on every
  // save/print means each click becomes a permanent record (matching what
  // the shop would do physically with a fresh-stamped card).
  function mintFreshRef() {
    const number = nextGuaranteeNumber()
    setRef({ number, id: number })
    return { number, id: number }
  }

  // On entry: reopen a saved guarantee (from History) or import a selected bill.
  useEffect(() => {
    const state = location.state as { selectedBillId?: string; reopenGuarantee?: GuaranteeDocument } | null
    if (state?.reopenGuarantee) {
      importGuarantee(state.reopenGuarantee)
      window.history.replaceState({}, '')
      return
    }
    if (state?.selectedBillId) {
      const bill = bills.find((b) => b.id === state.selectedBillId)
      if (bill) importBill(bill)
      window.history.replaceState({}, '')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Load a saved card back into the form so it can be viewed, edited or reprinted.
  function importGuarantee(g: GuaranteeDocument) {
    setRef({ number: g.number, id: g.id })
    setCustomer({
      id: g.customer.id || uid(),
      name: g.customer.name || '',
      mobile: g.customer.mobile || '',
      uid: g.customer.uid || '',
      address: g.customer.address || '',
    })
    const imported: SizeRow[] = g.items.map((it) => ({
      id: uid(),
      thickness: it.thickness || '',
      type: it.brandName || '',
      length: it.height?.inches ?? '',
      lengthSoot: it.height?.soot ?? '',
      height: it.width?.inches ?? '',
      heightSoot: it.width?.soot ?? '',
      qty: it.qty ?? '',
      rate: it.amount ?? '',
    }))
    setRows(imported.length ? [...imported, blankRow()] : [blankRow()])
  }

  function importBill(bill: Bill) {
    setCustomer((c) => ({
      ...c,
      name: bill.customerName || c.name,
      mobile: bill.customerPhone || c.mobile,
      uid: bill.customerUid || c.uid,
    }))

    // Bill sizes are decimal inches (e.g. 4.5) — split into whole inches + soot.
    const splitDecimalInches = (val: number) => {
      const inches = Math.floor(val)
      const soot = Math.round((val - inches) * 8)
      return { inches, soot }
    }

    const imported: SizeRow[] = bill.items
      .filter((it) => it.category && (it.heightIn ?? 0) > 0 && (it.widthIn ?? 0) > 0)
      .map((it) => {
        const length = splitDecimalInches(it.heightIn!)
        const height = splitDecimalInches(it.widthIn!)
        return {
          id: uid(),
          thickness: '',
          type: it.brandName || '',
          length: length.inches,
          lengthSoot: length.soot,
          height: height.inches,
          heightSoot: height.soot,
          qty: it.qty,
          rate: it.amount || '',
        }
      })

    if (imported.length) setRows((prev) => [...prev.filter(isRowFilled), ...imported, blankRow()])
  }

  function buildGuaranteeDoc(uuid = ref): GuaranteeDocument {
    const filled = rows.filter(isRowFilled)
    const primary = filled[0]
    return {
      id: uuid.id,
      number: uuid.number,
      date: new Date().toISOString(),
      customer: { ...customer, name: toProperCase(customer.name) },
      category: DEFAULT_CATEGORY,
      height: (primary && rowDim(primary.length, primary.lengthSoot)) ?? blankDim(),
      width: (primary && rowDim(primary.height, primary.heightSoot)) ?? blankDim(),
      qty: primary && primary.qty !== '' ? Number(primary.qty) : 1,
      items: rowsToItems(rows, brandOptions, DEFAULT_BRAND_LABEL, DEFAULT_YEARS),
    }
  }

  function buildSecondDoc(uuid = ref): GuaranteeDocument {
    const filled = rows2.filter(isRowFilled)
    const primary = filled[0]
    return {
      id: `${uuid.id}-2`,
      number: uuid.number,
      date: new Date().toISOString(),
      customer: { ...customer2, name: toProperCase(customer2.name) },
      category: DEFAULT_CATEGORY,
      height: (primary && rowDim(primary.length, primary.lengthSoot)) ?? blankDim(),
      width: (primary && rowDim(primary.height, primary.heightSoot)) ?? blankDim(),
      qty: primary && primary.qty !== '' ? Number(primary.qty) : 1,
      items: rowsToItems(rows2, brandOptions, DEFAULT_BRAND_LABEL, DEFAULT_YEARS),
    }
  }

  const doc = buildGuaranteeDoc()
  const doc2 = buildSecondDoc()

  // Save (and enqueue for sync) both cards under a freshly minted ref. The QR
  // points to /guarantee/<number> on the print server, which only resolves once
  // the card has been stored locally and pushed to the server.
  function persistCards(minted: { number: string; id: string }) {
    const freshDoc = buildGuaranteeDoc(minted)
    saveGuarantee(freshDoc)
    enqueueGuaranteeSync(freshDoc)
    if (secondCardOn) {
      const freshDoc2 = buildSecondDoc(minted)
      saveGuarantee(freshDoc2)
      enqueueGuaranteeSync(freshDoc2)
    }
  }

  // WhatsApp the customer(s) that their card is being processed. Best-effort:
  // the outcome is shown in the toast and a failure never blocks anything. The
  // per-mobile cooldown on the server means Print-after-Generate won't double-send.
  async function notifyCustomers(minted: { number: string; id: string }) {
    const recipients = [
      { mobile: customer.mobile.trim(), name: customer.name.trim() },
      ...(secondCardOn ? [{ mobile: customer2.mobile.trim(), name: customer2.name.trim() }] : []),
    ].filter((r) => r.mobile)
    const seen = new Set<string>()
    const uniqueRecipients = recipients.filter((r) => (seen.has(r.mobile) ? false : seen.add(r.mobile)))

    if (uniqueRecipients.length === 0) {
      setSavedToast(`Saved ${minted.number} · no mobile — WhatsApp skipped`)
      window.setTimeout(() => setSavedToast(null), 2600)
      return
    }

    setGenerating(true)
    setSavedToast(`Saved ${minted.number} · sending WhatsApp…`)
    let sent = 0
    let firstError = ''
    let notConnected = false
    for (const r of uniqueRecipients) {
      try {
        const result = await sendGuaranteeWhatsApp(r.mobile, r.name)
        if (!result.skipped) sent += 1
      } catch (err) {
        if (!firstError) firstError = err instanceof Error ? err.message : String(err)
        if (isWhatsAppNotConnectedError(err)) notConnected = true
      }
    }
    setGenerating(false)
    if (notConnected) {
      setSavedToast(`Saved ${minted.number} · WhatsApp needs login — scan the QR`)
      setShowWhatsAppLogin(true)
    } else if (firstError) {
      setSavedToast(`Saved ${minted.number} · WhatsApp failed: ${firstError}`)
    } else if (sent > 0) {
      setSavedToast(`Saved ${minted.number} · WhatsApp sent`)
    } else {
      setSavedToast(`Saved ${minted.number} · customer already notified`)
    }
    window.setTimeout(() => setSavedToast(null), 4000)
  }

  // Print = save + WhatsApp the customer + send STRAIGHT to the printer (no preview).
  async function printCard() {
    if (generating) return
    const minted = mintFreshRef()
    persistCards(minted)
    // Save + WhatsApp (shows its own toast; opens the QR login if WhatsApp is down).
    await notifyCustomers(minted)

    const printDoc = buildGuaranteeDoc(minted)
    const payload: ServerPrintPayload = layout === 'card'
      ? {
          kind: 'guarantee',
          document: printDoc,
          layout,
          slot: 1,
          ...(secondCardOn ? { documents: [printDoc, buildSecondDoc(minted)] } : {}),
        }
      : { kind: 'guarantee', document: printDoc, layout }

    setSavedToast(`Printing ${minted.number}…`)
    try {
      const result = await printOnServer(payload)
      setSavedToast(`Sent ${minted.number} to ${result.printer}`)
    } catch (err) {
      setSavedToast(`Print failed: ${err instanceof Error ? err.message : String(err)}`)
    }
    window.setTimeout(() => setSavedToast(null), 4500)
  }

  // Generate = save the card(s) + WhatsApp the customer (no print).
  async function generateCard() {
    if (generating) return
    const minted = mintFreshRef()
    persistCards(minted)
    await notifyCustomers(minted)
  }

  return (
    <div className="mobile-panel-screen flex flex-col overflow-hidden">
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3 md:p-4">
        {savedToast && (
          <div className="no-print fixed left-1/2 top-3 z-40 -translate-x-1/2 rounded-full bg-shiv-green px-4 py-1.5 text-sm font-semibold text-stone-900 shadow-lg" role="status">
            {savedToast}
          </div>
        )}
        <div className="no-print flex flex-wrap items-center justify-center gap-3">
          <Button onClick={generateCard} disabled={!hasRows || generating} className="flex min-w-32 items-center justify-center gap-2 rounded-xl px-5 py-3 text-base font-semibold">
            <Send size={20} /> {generating ? 'Generating…' : 'Generate'}
          </Button>
          <Button onClick={printCard} disabled={!hasRows || generating} className="flex min-w-32 items-center justify-center gap-2 rounded-xl px-5 py-3 text-base font-semibold">
            <Printer size={20} /> Print
          </Button>
          <button
            onClick={() => navigate('/guarantee/select-bill', { state: { returnTo: `/guarantee/${layout}` } })}
            className="flex min-w-32 items-center justify-center gap-2 rounded-xl border border-stone-300 bg-stone-50 px-5 py-3 text-base font-semibold text-stone-700 shadow-sm transition hover:border-shiv-green hover:bg-stone-100 dark:border-white/15 dark:bg-white/5 dark:text-stone-100 dark:hover:bg-white/10"
          >
            <FileText size={20} /> Select Bill
          </button>
        </div>
        <div className="no-print text-center text-xs font-semibold uppercase tracking-wide text-muted">
          Next Ref No: <span className="ml-1 rounded bg-stone-100 px-2 py-0.5 font-mono text-sm text-stone-700 dark:bg-white/10 dark:text-stone-200">{ref.number}</span>
        </div>

        <Card className="shrink-0 p-4 text-stone-800 dark:text-stone-100">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-muted">Customer</h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <Input label="M/s (Name)" value={customer.name} onChange={(e) => setCustomer({ ...customer, name: e.target.value })} />
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-muted">Mobile</span>
              <input
                type="tel"
                inputMode="numeric"
                maxLength={10}
                value={customer.mobile}
                onChange={(e) => {
                  const value = e.target.value.replace(/\D/g, '').slice(0, 10)
                  setCustomer({ ...customer, mobile: value })
                }}
                className={`w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 transition ${
                  customer.mobile.length === 10
                    ? 'border-green-500 bg-green-50 focus:border-green-600 focus:ring-green-600/20 dark:border-green-600 dark:bg-green-950/30'
                    : 'border-stone-300 bg-stone-50 focus:border-shiv-green focus:ring-shiv-green/20 dark:border-white/15 dark:bg-stone-950'
                } dark:text-stone-100`}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-muted">UID</span>
              <input
                type="text"
                inputMode="text"
                maxLength={12}
                value={customer.uid}
                onChange={(e) => {
                  const value = e.target.value.toUpperCase().slice(0, 12)
                  setCustomer({ ...customer, uid: value })
                }}
                className={`w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 transition ${
                  customer.uid.length === 12
                    ? 'border-green-500 bg-green-50 focus:border-green-600 focus:ring-green-600/20 dark:border-green-600 dark:bg-green-950/30'
                    : 'border-stone-300 bg-stone-50 focus:border-shiv-green focus:ring-shiv-green/20 dark:border-white/15 dark:bg-stone-950'
                } dark:text-stone-100`}
              />
            </label>
          </div>
        </Card>

        <Card className="min-h-0 shrink-0 overflow-hidden text-stone-800 dark:text-stone-100">
          <div className="border-b border-stone-100 px-4 py-2 text-sm font-bold uppercase tracking-wide text-muted dark:border-white/10">
            Items
          </div>
          <SizeTable rows={rows} setRows={setRows} brandOptions={brandOptions} datalistId="type-options-1" />
        </Card>

        {layout === 'card' && (
          <Card className="shrink-0 p-4 text-stone-800 dark:text-stone-100">
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-muted">Print Preview</h2>
            <div className="flex flex-wrap items-start justify-center gap-6">
              <div className="flex flex-col items-center gap-2">
                <span className="rounded-full bg-stone-100 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-muted dark:bg-white/10 dark:text-stone-300">
                  Slot 1
                </span>
                <div className="relative h-[86mm] w-[54mm] overflow-hidden rounded-md border border-stone-300 bg-white shadow-sm dark:border-white/20">
                  <GuaranteeCardFace document={doc} />
                </div>
              </div>

              <div className="flex flex-col items-center gap-2">
                <span className="rounded-full bg-stone-100 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-muted dark:bg-white/10 dark:text-stone-300">
                  Slot 2
                </span>
                {secondCardOn ? (
                  <div className="relative">
                    <div className="relative h-[86mm] w-[54mm] overflow-hidden rounded-md border border-stone-300 bg-white shadow-sm dark:border-white/20">
                      <GuaranteeCardFace document={doc2} />
                    </div>
                    <button
                      type="button"
                      onClick={() => setSecondCardOn(false)}
                      aria-label="Remove slot 2 card"
                      className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full border border-stone-300 bg-white text-muted shadow-sm transition hover:border-red-400 hover:text-danger dark:border-white/20 dark:bg-stone-800 dark:text-stone-300"
                    >
                      <X size={13} />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setSecondCardOn(true)}
                    className="flex h-[86mm] w-[54mm] flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed border-stone-300 bg-stone-50 text-muted transition hover:border-shiv-green hover:text-shiv-green dark:border-white/15 dark:bg-white/5"
                  >
                    <span className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-current">
                      <Check size={16} />
                    </span>
                    <span className="text-xs font-semibold">Add 2nd card</span>
                  </button>
                )}
              </div>
            </div>

            {secondCardOn && (
              <div className="mt-4 border-t border-stone-100 pt-4 dark:border-white/10">
                <h3 className="mb-3 text-xs font-bold uppercase tracking-wide text-muted">Slot 2 Details</h3>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  <Input label="M/s (Name)" value={customer2.name} onChange={(e) => setCustomer2({ ...customer2, name: e.target.value })} />
                  <label className="block">
                    <span className="mb-1 block text-xs font-semibold text-muted">Mobile</span>
                    <input
                      type="tel"
                      inputMode="numeric"
                      maxLength={10}
                      value={customer2.mobile}
                      onChange={(e) => setCustomer2({ ...customer2, mobile: e.target.value.replace(/\D/g, '').slice(0, 10) })}
                      className="w-full rounded-lg border border-stone-300 bg-stone-50 px-3 py-2 text-sm outline-none focus:border-shiv-green focus:ring-2 focus:ring-shiv-green/20 dark:border-white/15 dark:bg-stone-950 dark:text-stone-100"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-semibold text-muted">UID</span>
                    <input
                      type="text"
                      maxLength={12}
                      value={customer2.uid}
                      onChange={(e) => setCustomer2({ ...customer2, uid: e.target.value.toUpperCase().slice(0, 12) })}
                      className="w-full rounded-lg border border-stone-300 bg-stone-50 px-3 py-2 text-sm outline-none focus:border-shiv-green focus:ring-2 focus:ring-shiv-green/20 dark:border-white/15 dark:bg-stone-950 dark:text-stone-100"
                    />
                  </label>
                </div>
                <div className="mt-3">
                  <SizeTable rows={rows2} setRows={setRows2} brandOptions={brandOptions} datalistId="type-options-2" />
                </div>
              </div>
            )}
          </Card>
        )}
      </div>

      <WhatsAppLoginModal open={showWhatsAppLogin} onClose={() => setShowWhatsAppLogin(false)} />
    </div>
  )
}

function SizeTable({
  rows,
  setRows,
  brandOptions,
  datalistId,
}: {
  rows: SizeRow[]
  setRows: (updater: (prev: SizeRow[]) => SizeRow[]) => void
  brandOptions: Brand[]
  datalistId: string
}) {
  const cellClass =
    'w-full rounded border border-transparent bg-transparent px-2 py-1.5 text-sm text-stone-800 outline-none transition focus:border-shiv-green focus:bg-white dark:text-stone-100 dark:focus:bg-stone-950'
  const sootClass =
    'w-10 shrink-0 rounded border border-transparent bg-transparent px-1 py-1.5 text-sm text-muted outline-none transition focus:border-shiv-green focus:bg-white  dark:focus:bg-stone-950'

  // Copy the last filled row into a new row (same size/brand for the next door),
  // keeping a trailing blank so the table still grows as you type. When nothing
  // is filled yet there's nothing to copy, so just ensure a blank row exists.
  function duplicateRow() {
    setRows((prev) => {
      const filled = prev.filter(isRowFilled)
      if (filled.length === 0) return [blankRow()]
      const source = filled[filled.length - 1]
      return [...filled, { ...source, id: uid() }, blankRow()]
    })
  }

  const rowActionClass =
    'mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-stone-300 bg-stone-50/60 px-3 py-2 text-xs font-semibold text-stone-600 transition hover:border-shiv-green hover:bg-stone-100 hover:text-stone-800 dark:border-white/15 dark:bg-white/5 dark:text-stone-300 dark:hover:bg-white/10 dark:hover:text-stone-100'

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-stone-200 bg-stone-100 text-xs font-bold uppercase tracking-wide text-muted dark:border-white/10 dark:bg-white/5">
            <th className="px-2 py-2 text-left">Thickness</th>
            <th className="px-2 py-2 text-left">Type</th>
            <th className="px-2 py-2 text-right">Length</th>
            <th className="px-2 py-2 text-right">Height</th>
            <th className="px-2 py-2 text-right">Pcs</th>
            <th className="px-2 py-2 text-right">Rate</th>
            <th className="w-9 px-1 py-2" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-stone-100 last:border-b-0 dark:border-white/5">
              <td className="p-0.5">
                <input
                  value={row.thickness}
                  placeholder="—"
                  onChange={(e) => updateSizeRow(setRows, row.id, { thickness: e.target.value })}
                  className={cellClass}
                />
              </td>
              <td className="p-0.5">
                <input
                  list={datalistId}
                  value={row.type}
                  placeholder="Brand"
                  onChange={(e) => updateSizeRow(setRows, row.id, { type: e.target.value })}
                  className={cellClass}
                />
              </td>
              <td className="p-0.5">
                <div className="flex items-center gap-0.5">
                  <input
                    type="number"
                    value={row.length}
                    placeholder="0"
                    onFocus={(e) => e.currentTarget.select()}
                    onChange={(e) => updateSizeRow(setRows, row.id, { length: e.target.value === '' ? '' : Number(e.target.value) })}
                    className={`${cellClass} text-right`}
                  />
                  <input
                    type="number"
                    min={0}
                    max={7}
                    value={row.lengthSoot}
                    placeholder="0"
                    title="Soot (1/8 inch)"
                    onFocus={(e) => e.currentTarget.select()}
                    onChange={(e) =>
                      updateSizeRow(setRows, row.id, {
                        lengthSoot: e.target.value === '' ? '' : Math.min(7, Math.max(0, Number(e.target.value))),
                      })
                    }
                    className={`${sootClass} text-right`}
                  />
                  <span className="shrink-0 text-xs text-muted">/8</span>
                </div>
              </td>
              <td className="p-0.5">
                <div className="flex items-center gap-0.5">
                  <input
                    type="number"
                    value={row.height}
                    placeholder="0"
                    onFocus={(e) => e.currentTarget.select()}
                    onChange={(e) => updateSizeRow(setRows, row.id, { height: e.target.value === '' ? '' : Number(e.target.value) })}
                    className={`${cellClass} text-right`}
                  />
                  <input
                    type="number"
                    min={0}
                    max={7}
                    value={row.heightSoot}
                    placeholder="0"
                    title="Soot (1/8 inch)"
                    onFocus={(e) => e.currentTarget.select()}
                    onChange={(e) =>
                      updateSizeRow(setRows, row.id, {
                        heightSoot: e.target.value === '' ? '' : Math.min(7, Math.max(0, Number(e.target.value))),
                      })
                    }
                    className={`${sootClass} text-right`}
                  />
                  <span className="shrink-0 text-xs text-muted">/8</span>
                </div>
              </td>
              <td className="p-0.5">
                <input
                  type="number"
                  min={1}
                  value={row.qty}
                  placeholder="1"
                  onFocus={(e) => e.currentTarget.select()}
                  onChange={(e) => updateSizeRow(setRows, row.id, { qty: e.target.value === '' ? '' : Number(e.target.value) })}
                  className={`${cellClass} text-right`}
                />
              </td>
              <td className="p-0.5">
                <input
                  type="number"
                  value={row.rate}
                  placeholder="0"
                  onFocus={(e) => e.currentTarget.select()}
                  onChange={(e) => updateSizeRow(setRows, row.id, { rate: e.target.value === '' ? '' : Number(e.target.value) })}
                  className={`${cellClass} text-right`}
                />
              </td>
              <td className="p-0.5 text-center">
                {rows.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeSizeRow(setRows, row.id)}
                    aria-label="Remove row"
                    className="rounded p-1 text-muted transition hover:bg-red-50 hover:text-danger dark:hover:bg-red-950/30"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <datalist id={datalistId}>
        {brandOptions.map((b) => (
          <option key={b.id} value={b.name} />
        ))}
      </datalist>
      <button type="button" onClick={duplicateRow} className={rowActionClass}>
        <Copy size={15} /> Duplicate last row
      </button>
    </div>
  )
}
