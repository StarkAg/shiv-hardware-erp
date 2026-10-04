import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Check, Copy, FileText, Plus, Printer, Save, Send, Trash2, X } from 'lucide-react'
import { Button, Card, Input } from '../../components/ui'
import { mintCardToken } from '../../lib/cardToken'
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
import { fetchLatestGuaranteeSeq } from '../../lib/convexSync'
import { sendGuaranteeWhatsApp, isWhatsAppNotConnectedError, printOnServer, type ServerPrintPayload } from '../../lib/printServer'
import { WhatsAppLoginModal } from '../../components/WhatsAppLoginModal'
import { toast } from '../../components/Toast'

type GuaranteeLayout = 'card' | 'a4'

const blankDim = (): Dimension => ({ inches: 0, soot: 0 })
const uid = () => Math.random().toString(36).slice(2, 10)
/** A date as YYYY-MM-DD in local time (the value a date input holds). */
const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
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
  /** Chosen guarantee; '' follows the brand's years from Rates. */
  years: GuaranteeYears | ''
}

// The periods offered in the Guarantee column: every period the shop's PVC
// cards carry (Milton Super 5, Signature 7, Signature Gold 10, Gold Club 20…).
// Wax-seal images (assets/seals, used on the A4 sheet) exist for 1/3/7/10/25.
const SEAL_YEARS: GuaranteeYears[] = [1, 3, 5, 7, 10, 20, 25]

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
  years: '',
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

/** A row's guarantee: the one chosen in the row, else its brand's, else the default. */
function rowYears(row: SizeRow, brandOptions: Brand[], fallbackYears: GuaranteeYears): GuaranteeYears {
  if (row.years !== '') return row.years
  const matched = brandOptions.find((b) => b.name.toLowerCase() === row.type.trim().toLowerCase())
  return matched?.guaranteeYears ?? fallbackYears
}

/**
 * The distinct guarantee periods on a card's filled rows, in row order. A PVC
 * card is pre-printed with ONE guarantee seal (e.g. SRT Signature "7 YEAR"),
 * so a card may only carry items of one period; another period is another card.
 */
function cardYears(rows: SizeRow[], brandOptions: Brand[]): GuaranteeYears[] {
  return [...new Set(rows.filter(isRowFilled).map((r) => rowYears(r, brandOptions, DEFAULT_YEARS)))]
}

function rowsToItems(rows: SizeRow[], brandOptions: Brand[], fallbackBrand: string, fallbackYears: GuaranteeYears): GuaranteeCardItem[] {
  const filled = rows.filter(isRowFilled)
  // No fake placeholder row when the table is empty — an empty table prints
  // (and previews) with no item line at all.
  if (!filled.length) return []
  return filled.map((row) => {
    return {
      brandName: row.type.trim() || fallbackBrand,
      guaranteeYears: rowYears(row, brandOptions, fallbackYears),
      thickness: row.thickness.trim() || null,
      height: rowDim(row.length, row.lengthSoot),
      width: rowDim(row.height, row.heightSoot),
      qty: row.qty !== '' ? Number(row.qty) : null,
      amount: row.rate !== '' ? Number(row.rate) : null,
    }
  })
}

/** One card's identity: its GC number and the QR secret that opens it online. */
type CardRef = { number: string; id: string; token: string }
/** A Print/Generate click: slot 1's ref, plus slot 2's own ref when it's on. */
type MintedRefs = CardRef & { second: CardRef | null }

export function GuaranteeBuilder({ layout }: { layout: GuaranteeLayout }) {
  const { sets, bills, saveGuarantee, nextGuaranteeNumber, raiseGuaranteeSeq } = useStore()
  const navigate = useNavigate()
  const location = useLocation()
  // Each Save or Print mints a fresh GC-YYYY-NNNN ref number from the store sequence,
  // so every card becomes a permanent entry in the History tab and gets a stable QR.
  const [ref, setRef] = useState<CardRef>(() => {
    const number = `GC-${new Date().getFullYear()}-${Date.now().toString().slice(-5)}`
    return { number, id: number, token: mintCardToken() }
  })
  // The slot-2 card is its own card: its own number and its own QR secret.
  // (It used to share slot 1's, so both cards' QRs were identical and the
  // online view could only ever open one of them.)
  const [ref2, setRef2] = useState<CardRef>(() => {
    const number = `GC-${new Date().getFullYear()}-${(Date.now() + 1).toString().slice(-5)}`
    return { number, id: number, token: mintCardToken() }
  })
  const [customer, setCustomer] = useState({ id: uid(), name: '', mobile: '', uid: '', address: '' })
  const [rows, setRows] = useState<SizeRow[]>(() => [blankRow()])
  const [generating, setGenerating] = useState(false)
  const [showWhatsAppLogin, setShowWhatsAppLogin] = useState(false)

  // Slot 2: an independent second card printed in the same tray pass.
  // Ticking it on reveals its own small set of fields plus its own table.
  const [secondCardOn, setSecondCardOn] = useState(false)
  // Which card the form is showing (card layout): one form, two tabs.
  const [tab, setTab] = useState<1 | 2>(1)
  const onCard2 = layout === 'card' && secondCardOn && tab === 2
  const [customer2, setCustomer2] = useState({ id: uid(), name: '', mobile: '', uid: '', address: '' })
  const [rows2, setRows2] = useState<SizeRow[]>(() => [blankRow()])

  // Editing a saved card (History → Edit): it keeps its number, QR secret and
  // date — the card in the customer's hand must keep opening — so Save never
  // mints a new number, and a reprint carries the very same QR.
  const [editing, setEditing] = useState<GuaranteeDocument | null>(null)

  // The date printed on the card(s): today unless changed (a card made for an
  // earlier sale is dated the sale's day). Editing starts from the card's own.
  const [cardDate, setCardDate] = useState(() => localDay(new Date()))
  const cardDateIso = () => new Date(`${cardDate}T12:00:00`).toISOString()

  // Unfiltered brand list — the Items table's Type column can match any known
  // brand regardless of category, since there's no Product picker anymore.
  const brandOptions = sets[0]?.brands ?? []
  const hasRows = rows.some(isRowFilled)

  // One guarantee period per PVC card (its seal is pre-printed). A card whose
  // items carry two periods can't be printed as-is: split it, or fix the rows.
  const years1 = cardYears(rows, brandOptions)
  const years2 = secondCardOn ? cardYears(rows2, brandOptions) : []
  const mixedCard: 0 | 1 | 2 = layout !== 'card' ? 0 : years1.length > 1 ? 1 : years2.length > 1 ? 2 : 0
  // Auto-split only the simple case: card 1 holds two periods and slot 2 is free.
  const canSplit = mixedCard === 1 && years1.length === 2 && !editing && !(secondCardOn && rows2.some(isRowFilled))

  /** Move card 1's items of its second period onto Card 2, same customer. */
  function splitByYears() {
    const keep = years1[0]
    const moving = rows.filter((r) => isRowFilled(r) && rowYears(r, brandOptions, DEFAULT_YEARS) !== keep)
    setRows((prev) => {
      const stay = prev.filter((r) => !moving.includes(r))
      return stay.length && !isRowFilled(stay[stay.length - 1]) ? stay : [...stay, blankRow()]
    })
    setRows2([...moving.map((r) => ({ ...r, id: uid() })), blankRow()])
    setCustomer2({ ...customer, id: uid() })
    setSecondCardOn(true)
    setTab(2)
    toast(`Moved the ${years1[1]}-year items to Card 2`)
  }

  // Mint a new card number from the store sequence. Refreshing on every
  // save/print means each click becomes a permanent record (matching what
  // the shop would do physically with a fresh-stamped card).
  /**
   * Numbers are counted on each device, so before minting one, catch up with
   * the highest the shop has already saved — a fresh install or a second
   * counter would otherwise reissue GC-YYYY-0001 (it did, 2026-10-02). Capped
   * at 2.5s so being offline never holds up a print; the local counter stands.
   */
  async function catchUpGuaranteeSeq() {
    const latest = await Promise.race([
      fetchLatestGuaranteeSeq(new Date().getFullYear()),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 2500)),
    ])
    if (latest != null) raiseGuaranteeSeq(latest)
  }
  useEffect(() => { void catchUpGuaranteeSeq() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function mintFreshRef(): MintedRefs {
    const number = nextGuaranteeNumber()
    // A fresh card is a fresh secret. The QR is printed from this, so it has to
    // exist before the card is drawn, not after it is saved.
    const next = { number, id: number, token: mintCardToken() }
    setRef(next)
    // Slot 2 takes the number after slot 1's, with a secret of its own.
    let second: CardRef | null = null
    if (secondCardOn) {
      const number2 = nextGuaranteeNumber(1)
      second = { number: number2, id: number2, token: mintCardToken() }
      setRef2(second)
    }
    return { ...next, second }
  }

  /** "GC-2026-0012" or "GC-2026-0012 + 0013" for toasts. */
  const mintedLabel = (m: MintedRefs) =>
    m.second ? `${m.number} + ${m.second.number.split('-').pop()}` : m.number

  // On entry: reopen a saved guarantee (from History) or import a selected bill.
  useEffect(() => {
    const state = location.state as { selectedBillId?: string; reopenGuarantee?: GuaranteeDocument; editGuarantee?: GuaranteeDocument } | null
    if (state?.editGuarantee) {
      importGuarantee(state.editGuarantee)
      setEditing(state.editGuarantee)
      setCardDate(localDay(new Date(state.editGuarantee.date)))
      setSecondCardOn(false)
      setTab(1)
      window.history.replaceState({}, '')
      return
    }
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
    // Its own secret, not a new one: the card in the customer's hand is
    // printed with this and a reprint has to match it.
    setRef({ number: g.number, id: g.id, token: g.token ?? mintCardToken() })
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
      years: it.guaranteeYears ?? '',
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
          years: '' as const,
        }
      })

    if (imported.length) setRows((prev) => [...prev.filter(isRowFilled), ...imported, blankRow()])
  }

  function buildGuaranteeDoc(uuid: CardRef = ref): GuaranteeDocument {
    const filled = rows.filter(isRowFilled)
    const primary = filled[0]
    return {
      id: uuid.id,
      number: uuid.number,
      token: uuid.token,
      date: cardDateIso(),
      updatedAt: Date.now(),
      customer: { ...customer, name: toProperCase(customer.name) },
      category: DEFAULT_CATEGORY,
      height: (primary && rowDim(primary.length, primary.lengthSoot)) ?? blankDim(),
      width: (primary && rowDim(primary.height, primary.heightSoot)) ?? blankDim(),
      qty: primary && primary.qty !== '' ? Number(primary.qty) : 1,
      items: rowsToItems(rows, brandOptions, DEFAULT_BRAND_LABEL, DEFAULT_YEARS),
    }
  }

  function buildSecondDoc(uuid: CardRef = ref2): GuaranteeDocument {
    const filled = rows2.filter(isRowFilled)
    const primary = filled[0]
    return {
      id: uuid.id,
      number: uuid.number,
      token: uuid.token,
      date: cardDateIso(),
      updatedAt: Date.now(),
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

  // Save (and enqueue for sync) each card under its freshly minted ref. The QR
  // opens <site>/<number>?k=<token>, which only resolves once the card has
  // been pushed to Convex.
  function persistCards(minted: MintedRefs) {
    const freshDoc = buildGuaranteeDoc(minted)
    saveGuarantee(freshDoc)
    enqueueGuaranteeSync(freshDoc)
    if (minted.second) {
      const freshDoc2 = buildSecondDoc(minted.second)
      saveGuarantee(freshDoc2)
      enqueueGuaranteeSync(freshDoc2)
    }
  }

  // WhatsApp the customer(s) that their card is being processed. Best-effort:
  // the outcome is shown in the toast and a failure never blocks anything. The
  // per-mobile cooldown on the server means Print-after-Generate won't double-send.
  async function notifyCustomers(minted: MintedRefs) {
    const label = mintedLabel(minted)
    const recipients = [
      { mobile: customer.mobile.trim(), name: customer.name.trim() },
      ...(secondCardOn ? [{ mobile: customer2.mobile.trim(), name: customer2.name.trim() }] : []),
    ].filter((r) => r.mobile)
    const seen = new Set<string>()
    const uniqueRecipients = recipients.filter((r) => (seen.has(r.mobile) ? false : seen.add(r.mobile)))

    if (uniqueRecipients.length === 0) {
      toast(`Saved ${label} · no mobile, WhatsApp skipped`)
      return
    }

    setGenerating(true)
    toast(`Saved ${label} · sending WhatsApp…`, 'info')
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
      toast(`Saved ${label} · WhatsApp needs login`, 'error')
      setShowWhatsAppLogin(true)
    } else if (firstError) {
      toast(`Saved ${label} · WhatsApp failed: ${firstError}`, 'error')
    } else if (sent > 0) {
      toast(`Saved ${label} · WhatsApp sent`)
    } else {
      toast(`Saved ${label} · customer already notified`)
    }
  }

  // Print = save the card(s) + print + WhatsApp the customer.
  //
  // Desktop app, PVC card: straight to the Epson on this PC (no print server),
  // then WhatsApp via the server best-effort — the card still prints if it's
  // down. Anywhere else: the shop print server, which also sends the WhatsApp.
  const printDirect = layout === 'card' ? window.shivDesktop?.printGuaranteeCardsDirect : undefined

  /** Print one or two cards (slot 1, slot 2); true when the job was sent. */
  async function sendToPrinter(printDocs: GuaranteeDocument[], label: string): Promise<boolean> {
    toast(`Printing ${label}…`, 'info')
    try {
      if (printDirect) {
        const result = await printDirect({ documents: printDocs, slot: 1 })
        toast(`Sent ${label} to ${result.printer}`)
        return true
      }
      const [printDoc, printDoc2] = printDocs
      const payload: ServerPrintPayload = layout === 'card'
        ? { kind: 'guarantee', document: printDoc, layout, slot: 1, ...(printDoc2 ? { documents: printDocs } : {}) }
        : { kind: 'guarantee', document: printDoc, layout }
      const result = await printOnServer(payload)
      toast(`Sent ${label} to ${result.printer}`)
      return true
    } catch (err) {
      toast(`Print failed: ${err instanceof Error ? err.message : String(err)}`, 'error')
      return false
    }
  }

  async function printCard() {
    if (generating) return
    setGenerating(true)
    await catchUpGuaranteeSeq()
    const minted = mintFreshRef()
    const label = mintedLabel(minted)
    persistCards(minted)

    const printDocs = [buildGuaranteeDoc(minted), ...(minted.second ? [buildSecondDoc(minted.second)] : [])]
    const sent = await sendToPrinter(printDocs, label)
    setGenerating(false)
    // The print server WhatsApps the customer itself; direct printing doesn't.
    if (sent && printDirect) await notifyCustomers(minted)
  }

  // ── Edit mode ──────────────────────────────────────────────────────────────
  /** The edited card: same number, secret and date; synced to Convex in place. */
  function saveEdit(): GuaranteeDocument {
    const edited = buildGuaranteeDoc(ref)
    saveGuarantee(edited)
    enqueueGuaranteeSync(edited)
    return edited
  }

  function saveChanges() {
    if (!editing || generating) return
    const edited = saveEdit()
    toast(`Saved changes to ${edited.number}`)
    navigate('/guarantee/history')
  }

  async function saveAndPrint() {
    if (!editing || generating) return
    setGenerating(true)
    const edited = saveEdit()
    const sent = await sendToPrinter([edited], edited.number)
    setGenerating(false)
    if (sent) navigate('/guarantee/history')
  }

  // Generate = save the card(s) + WhatsApp the customer (no print).
  async function generateCard() {
    if (generating) return
    setGenerating(true)
    await catchUpGuaranteeSeq()
    setGenerating(false)
    const minted = mintFreshRef()
    persistCards(minted)
    await notifyCustomers(minted)
  }

  return (
    <div className="mobile-panel-screen flex flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-y-auto p-3 md:p-4">
        {/* Card layout from 1024px: the form scrolls on the left, the print preview
            (slot 1 above slot 2) stays put on the right. Narrower, it sits below. */}
        <div className={layout === 'card' ? 'flex flex-col gap-3 lg:grid lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start lg:gap-4' : 'flex flex-col gap-3'}>
          <div className="flex min-w-0 flex-col gap-3">
            {editing ? (
              <div className="no-print flex flex-wrap items-center justify-center gap-3">
                <Button onClick={saveChanges} disabled={!hasRows || generating || mixedCard > 0} data-enter-submit className="flex min-w-32 items-center justify-center gap-2 rounded-xl px-5 py-3 text-base font-semibold">
                  <Save size={20} /> Save changes
                </Button>
                <Button variant="outline" onClick={saveAndPrint} disabled={!hasRows || generating || mixedCard > 0} className="flex min-w-32 items-center justify-center gap-2 rounded-xl px-5 py-3 text-base font-semibold">
                  <Printer size={20} /> {generating ? 'Printing…' : 'Save & Print'}
                </Button>
                <Button variant="ghost" onClick={() => navigate('/guarantee/history')} disabled={generating} className="flex items-center justify-center gap-2 rounded-xl px-5 py-3 text-base font-semibold">
                  <X size={20} /> Cancel
                </Button>
              </div>
            ) : (
              <div className="no-print flex flex-wrap items-center justify-center gap-3">
                <Button onClick={generateCard} disabled={!hasRows || generating || mixedCard > 0} className="flex min-w-32 items-center justify-center gap-2 rounded-xl px-5 py-3 text-base font-semibold">
                  <Send size={20} /> {generating ? 'Generating…' : 'Generate'}
                </Button>
                <Button onClick={printCard} disabled={!hasRows || generating || mixedCard > 0} data-enter-submit className="flex min-w-32 items-center justify-center gap-2 rounded-xl px-5 py-3 text-base font-semibold">
                  <Printer size={20} /> Print
                </Button>
                <button
                  onClick={() => navigate('/guarantee/select-bill', { state: { returnTo: `/guarantee/${layout}` } })}
                  className="flex min-w-32 items-center justify-center gap-2 rounded-xl border border-stone-300 bg-stone-50 px-5 py-3 text-base font-semibold text-stone-700 shadow-sm transition hover:border-shiv-green hover:bg-stone-100 dark:border-white/15 dark:bg-white/5 dark:text-stone-100 dark:hover:bg-white/10"
                >
                  <FileText size={20} /> Select Bill
                </button>
              </div>
            )}
            <div className="no-print text-center text-xs font-semibold uppercase tracking-wide text-muted">
              {editing ? 'Editing' : 'Next Ref No:'} <span className="ml-1 rounded bg-stone-100 px-2 py-0.5 font-mono text-sm text-stone-700 dark:bg-white/10 dark:text-stone-200">{ref.number}</span>
              {editing && <span className="ml-2 normal-case">· same number & QR</span>}
              <label className="ml-3 inline-flex items-center gap-1.5">
                Date
                <input
                  type="date"
                  aria-label="Card date"
                  value={cardDate}
                  onChange={(e) => e.target.value && setCardDate(e.target.value)}
                  className="rounded border border-stone-300 bg-white px-1.5 py-0.5 font-mono text-sm normal-case text-stone-700 dark:border-white/15 dark:bg-white/10 dark:text-stone-200"
                />
              </label>
              {secondCardOn && (
                <span className="ml-2">Slot 2: <span className="ml-1 rounded bg-stone-100 px-2 py-0.5 font-mono text-sm text-stone-700 dark:bg-white/10 dark:text-stone-200">{ref2.number}</span></span>
              )}
            </div>

            {mixedCard > 0 && (
              <div className="no-print flex flex-wrap items-center gap-3 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
                <span className="min-w-0 flex-1">
                  <b>Card {mixedCard} has items with {(mixedCard === 1 ? years1 : years2).join(' and ')} years guarantee.</b>{' '}
                  One PVC card carries one guarantee seal, so each period needs its own card.
                  {!canSplit && ' Change or remove the rows of the other period (print them as a separate card).'}
                </span>
                {canSplit && (
                  <Button onClick={splitByYears} className="flex items-center gap-1.5">
                    <Copy size={15} /> Move {years1[1]}-year items to Card 2
                  </Button>
                )}
              </div>
            )}

            {layout === 'card' && (
              <div className="no-print flex flex-wrap items-center gap-2" role="tablist" aria-label="Cards in this tray pass">
                <CardTab title="Card 1" name={customer.name} years={years1} active={!onCard2} onSelect={() => setTab(1)} />
                {editing ? null : secondCardOn ? (
                  <CardTab
                    title="Card 2"
                    name={customer2.name}
                    years={years2}
                    active={onCard2}
                    onSelect={() => setTab(2)}
                    onRemove={() => { setSecondCardOn(false); setTab(1) }}
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => { setSecondCardOn(true); setTab(2) }}
                    className="flex items-center gap-1.5 rounded-xl border-2 border-dashed border-stone-300 px-4 py-2 text-sm font-semibold text-muted transition hover:border-shiv-green hover:text-shiv-green dark:border-white/15"
                  >
                    <Plus size={15} /> Card 2
                  </button>
                )}
              </div>
            )}

            <Card className="shrink-0 p-4 text-stone-800 dark:text-stone-100">
              <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-muted">Customer</h2>
              {onCard2
                ? <CustomerFields key="c2" value={customer2} onChange={setCustomer2} />
                : <CustomerFields key="c1" value={customer} onChange={setCustomer} />}
            </Card>

            <Card className="min-h-0 shrink-0 overflow-hidden text-stone-800 dark:text-stone-100">
              <div className="border-b border-stone-100 px-4 py-2 text-sm font-bold uppercase tracking-wide text-muted dark:border-white/10">
                Items
              </div>
              {onCard2
                ? <SizeTable key="t2" rows={rows2} setRows={setRows2} brandOptions={brandOptions} datalistId="type-options-2" />
                : <SizeTable key="t1" rows={rows} setRows={setRows} brandOptions={brandOptions} datalistId="type-options-1" />}
            </Card>
          </div>

          {layout === 'card' && (
            <aside className="lg:sticky lg:top-0 lg:max-h-[calc(100dvh-5rem)] lg:overflow-y-auto">
                <Card className="shrink-0 p-4 text-stone-800 dark:text-stone-100">
                  {/* Slot 1 above slot 2. Stacked, the two 86 mm cards can be taller than
                      the window, so the panel (the <aside>) scrolls on its own rather
                      than cutting slot 2 off. */}
                  <div className="flex flex-col items-center gap-4">
                    <div className="flex flex-col items-center gap-2">
                      <span className="rounded-full bg-stone-100 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-muted dark:bg-white/10 dark:text-stone-300">
                        Slot 1
                      </span>
                      <button
                        type="button"
                        onClick={() => setTab(1)}
                        aria-label="Edit card 1"
                        className={`relative h-[86mm] w-[54mm] overflow-hidden rounded-md border bg-white text-left shadow-sm transition ${
                          !onCard2 ? 'border-shiv-green ring-2 ring-shiv-green/40' : 'border-stone-300 dark:border-white/20'
                        }`}
                      >
                        <GuaranteeCardFace document={doc} />
                      </button>
                    </div>

                    {!editing && <div className="flex flex-col items-center gap-2">
                      <span className="rounded-full bg-stone-100 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-muted dark:bg-white/10 dark:text-stone-300">
                        Slot 2
                      </span>
                      {secondCardOn ? (
                        <div className="relative">
                          <button
                            type="button"
                            onClick={() => setTab(2)}
                            aria-label="Edit card 2"
                            className={`relative h-[86mm] w-[54mm] overflow-hidden rounded-md border bg-white text-left shadow-sm transition ${
                              onCard2 ? 'border-shiv-green ring-2 ring-shiv-green/40' : 'border-stone-300 dark:border-white/20'
                            }`}
                          >
                            <GuaranteeCardFace document={doc2} />
                          </button>
                          <button
                            type="button"
                            onClick={() => { setSecondCardOn(false); setTab(1) }}
                            aria-label="Remove slot 2 card"
                            className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full border border-stone-300 bg-white text-muted shadow-sm transition hover:border-red-400 hover:text-danger dark:border-white/20 dark:bg-stone-800 dark:text-stone-300"
                          >
                            <X size={13} />
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => { setSecondCardOn(true); setTab(2) }}
                          className="flex h-[86mm] w-[54mm] flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed border-stone-300 bg-stone-50 text-muted transition hover:border-shiv-green hover:text-shiv-green dark:border-white/15 dark:bg-white/5"
                        >
                          <span className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-current">
                            <Check size={16} />
                          </span>
                          <span className="text-xs font-semibold">Add 2nd card</span>
                        </button>
                      )}
                    </div>}
                  </div>

                </Card>
            </aside>
          )}
        </div>
      </div>

      <WhatsAppLoginModal open={showWhatsAppLogin} onClose={() => setShowWhatsAppLogin(false)} />
    </div>
  )
}

type CustomerInfo = { id: string; name: string; mobile: string; uid: string; address: string }

/** Name, mobile and UID for one card; the same fields for card 1 and card 2. */
function CustomerFields({ value, onChange }: { value: CustomerInfo; onChange: (next: CustomerInfo) => void }) {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      <Input label="M/s (Name)" value={value.name} onChange={(e) => onChange({ ...value, name: e.target.value })} />
      <label className="block">
        <span className="mb-1 block text-xs font-semibold text-muted">Mobile</span>
        <input
          type="tel"
          inputMode="numeric"
          maxLength={10}
          value={value.mobile}
          onChange={(e) => {
            const typed = e.target.value.replace(/\D/g, '').slice(0, 10)
            onChange({ ...value, mobile: typed })
          }}
          className={`w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 transition ${
            value.mobile.length === 10
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
          value={value.uid}
          onChange={(e) => {
            const typed = e.target.value.toUpperCase().slice(0, 12)
            onChange({ ...value, uid: typed })
          }}
          className={`w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 transition ${
            value.uid.length === 12
              ? 'border-green-500 bg-green-50 focus:border-green-600 focus:ring-green-600/20 dark:border-green-600 dark:bg-green-950/30'
              : 'border-stone-300 bg-stone-50 focus:border-shiv-green focus:ring-shiv-green/20 dark:border-white/15 dark:bg-stone-950'
          } dark:text-stone-100`}
        />
      </label>
    </div>
  )
}

/** One tab of the Card 1 / Card 2 switch, labelled with its customer once typed. */
function CardTab({ title, name, years = [], active, onSelect, onRemove }: {
  title: string
  name: string
  /** The card's guarantee period(s): one is right, two means it must be split. */
  years?: GuaranteeYears[]
  active: boolean
  onSelect: () => void
  onRemove?: () => void
}) {
  return (
    <div
      className={`flex items-center rounded-xl border transition ${
        active
          ? 'border-shiv-green bg-white shadow-sm dark:bg-stone-900'
          : 'border-stone-300 bg-stone-50 dark:border-white/15 dark:bg-white/5'
      }`}
    >
      <button type="button" role="tab" aria-selected={active} onClick={onSelect} className="flex items-baseline gap-2 py-2 pl-4 pr-3 text-left">
        <span className={`text-sm font-bold ${active ? 'text-stone-900 dark:text-stone-50' : 'text-muted'}`}>{title}</span>
        <span className="max-w-40 truncate text-xs text-muted">{name.trim() || '—'}</span>
        {years.length > 0 && (
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${years.length > 1 ? 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300' : 'bg-stone-100 text-stone-700 dark:bg-white/10 dark:text-stone-200'}`}>
            {years.map((y) => (y ? `${y} yr` : 'no gty')).join(' + ')}
          </span>
        )}
      </button>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${title}`}
          className="mr-1.5 flex h-6 w-6 items-center justify-center rounded-full text-muted transition hover:bg-red-50 hover:text-danger dark:hover:bg-red-950/30"
        >
          <X size={13} />
        </button>
      )}
    </div>
  )
}

function GuaranteeSelect({
  value,
  onChange,
  className,
}: {
  value: GuaranteeYears
  onChange: (years: GuaranteeYears) => void
  className: string
}) {
  // A brand set in Rates to a year with no seal (5, 15…) still shows as its own option.
  const options = SEAL_YEARS.includes(value) || value === 0 ? SEAL_YEARS : [...SEAL_YEARS, value].sort((a, b) => a - b)
  return (
    <select
      value={value}
      onChange={(e) => onChange(Number(e.target.value) as GuaranteeYears)}
      className={`${className} cursor-pointer ${value ? 'font-semibold text-shiv-red' : 'text-muted'}`}
      aria-label="Guarantee"
    >
      <option value={0}>None</option>
      {options.map((y) => (
        <option key={y} value={y}>{y} {y === 1 ? 'year' : 'years'}</option>
      ))}
    </select>
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
    'w-full min-w-0 rounded border border-stone-200 bg-transparent px-2 py-1.5 text-sm text-stone-800 outline-none transition focus:border-shiv-green focus:bg-white md:border-transparent dark:border-white/10 dark:text-stone-100 dark:focus:bg-stone-950 md:dark:border-transparent'
  const sootClass =
    'w-9 shrink-0 rounded border border-stone-200 bg-transparent px-1 py-1.5 text-sm text-muted outline-none transition focus:border-shiv-green focus:bg-white md:border-transparent dark:border-white/10 dark:focus:bg-stone-950 md:dark:border-transparent'

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

  // A grid rather than a table so nothing forces a minimum width: on a wide screen
  // it lines up as columns under one header; on a phone each row stacks into a
  // small labelled block instead of scrolling sideways.
  const gridCols =
    'md:grid-cols-[3.75rem_minmax(0,1.5fr)_minmax(0,1.25fr)_minmax(0,1.25fr)_3.25rem_minmax(0,0.9fr)_minmax(0,1fr)_2rem]'
  const labelClass = 'mb-0.5 block px-0.5 text-[10px] font-bold uppercase tracking-wide text-muted md:hidden'

  // Arrow keys move between cells like Excel. The cell under the caret is found from
  // the DOM (row = child of the grid, column = its nth input or select), so this keeps
  // working when columns change. Up/Down in a number box move rows instead of nudging
  // the number; Left/Right in a text box only leave it from its start or end (or when
  // all of it is selected, as it is on arrival); and while a brand is half typed,
  // Up/Down are left to the Type column's suggestion list.
  const grid = useRef<HTMLDivElement>(null)
  function moveWithArrows(e: KeyboardEvent<HTMLDivElement>) {
    const vertical = e.key === 'ArrowUp' || e.key === 'ArrowDown'
    if (!vertical && e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
    const el = e.target
    if (!(el instanceof HTMLInputElement || el instanceof HTMLSelectElement)) return
    const rowEls = Array.from(grid.current?.children ?? []) as HTMLElement[]
    const cellsOf = (row?: HTMLElement) => (row ? Array.from(row.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select')) : [])
    const r = rowEls.findIndex((row) => row.contains(el))
    if (r < 0) return
    const c = cellsOf(rowEls[r]).indexOf(el)

    let target: HTMLInputElement | HTMLSelectElement | undefined
    if (vertical) {
      if (el instanceof HTMLInputElement && el.list) {
        const typed = el.value.trim().toLowerCase()
        if (typed && !brandOptions.some((b) => b.name.toLowerCase() === typed)) return
      }
      target = cellsOf(rowEls[r + (e.key === 'ArrowDown' ? 1 : -1)])[c]
    } else {
      const left = e.key === 'ArrowLeft'
      if (el instanceof HTMLInputElement && el.type !== 'number') {
        const { selectionStart: from, selectionEnd: to, value } = el
        const all = from === 0 && to === value.length
        const edge = left ? from === 0 && to === 0 : from === value.length && to === value.length
        if (from !== null && !all && !edge) return
      }
      target = cellsOf(rowEls[r])[c + (left ? -1 : 1)]
    }
    if (!target) return
    e.preventDefault()
    target.focus()
    if (target instanceof HTMLInputElement) target.select()
  }

  return (
    <div>
      <div
        className={`hidden gap-1 border-b border-stone-200 bg-stone-100 px-1 py-2 text-xs font-bold uppercase tracking-wide text-muted md:grid dark:border-white/10 dark:bg-white/5 ${gridCols}`}
      >
        <span className="px-2">Thickness</span>
        <span className="px-2">Type</span>
        <span className="px-2 text-right">Length</span>
        <span className="px-2 text-right">Height</span>
        <span className="px-2 text-right">Pcs</span>
        <span className="px-2 text-right">Rate</span>
        <span className="px-2">Guarantee</span>
        <span />
      </div>
      <div ref={grid} onKeyDown={moveWithArrows} className="flex flex-col gap-2 md:gap-0">
        {rows.map((row) => (
          <div
            key={row.id}
            className={`relative grid grid-cols-6 gap-x-2 gap-y-1.5 rounded-lg border border-stone-200 p-2 pr-9 md:items-center md:gap-1 md:rounded-none md:border-0 md:border-b md:border-stone-100 md:p-0.5 md:pr-0.5 md:last:border-b-0 dark:border-white/10 md:dark:border-white/5 ${gridCols}`}
          >
            <label className="col-span-2 min-w-0 md:col-span-1">
              <span className={labelClass}>Thickness</span>
              <input
                value={row.thickness}
                placeholder="—"
                onChange={(e) => updateSizeRow(setRows, row.id, { thickness: e.target.value })}
                className={cellClass}
              />
            </label>
            <label className="col-span-4 min-w-0 md:col-span-1">
              <span className={labelClass}>Type</span>
              <input
                list={datalistId}
                value={row.type}
                placeholder="Brand"
                onChange={(e) => updateSizeRow(setRows, row.id, { type: e.target.value })}
                className={cellClass}
              />
            </label>
            <div className="col-span-3 min-w-0 md:col-span-1">
              <span className={labelClass}>Length</span>
              <div className="flex items-center gap-0.5">
                <input
                  type="number"
                  value={row.length}
                  placeholder="0"
                  aria-label="Length"
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
                  aria-label="Length soot"
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
            </div>
            <div className="col-span-3 min-w-0 md:col-span-1">
              <span className={labelClass}>Height</span>
              <div className="flex items-center gap-0.5">
                <input
                  type="number"
                  value={row.height}
                  placeholder="0"
                  aria-label="Height"
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
                  aria-label="Height soot"
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
            </div>
            <label className="col-span-2 min-w-0 md:col-span-1">
              <span className={labelClass}>Pcs</span>
              <input
                type="number"
                min={1}
                value={row.qty}
                placeholder="1"
                onFocus={(e) => e.currentTarget.select()}
                onChange={(e) => updateSizeRow(setRows, row.id, { qty: e.target.value === '' ? '' : Number(e.target.value) })}
                className={`${cellClass} text-right`}
              />
            </label>
            <label className="col-span-2 min-w-0 md:col-span-1">
              <span className={labelClass}>Rate</span>
              <input
                type="number"
                value={row.rate}
                placeholder="0"
                onFocus={(e) => e.currentTarget.select()}
                onChange={(e) => updateSizeRow(setRows, row.id, { rate: e.target.value === '' ? '' : Number(e.target.value) })}
                className={`${cellClass} text-right`}
              />
            </label>
            <div className="col-span-2 min-w-0 md:col-span-1">
              <span className={labelClass}>Guarantee</span>
              <GuaranteeSelect
                value={rowYears(row, brandOptions, DEFAULT_YEARS)}
                onChange={(years) => updateSizeRow(setRows, row.id, { years })}
                className={cellClass}
              />
            </div>
            <div className="absolute right-1 top-1 md:static md:text-center">
              {rows.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeSizeRow(setRows, row.id)}
                  aria-label="Remove row"
                  className="rounded p-1.5 text-muted transition hover:bg-red-50 hover:text-danger md:p-1 dark:hover:bg-red-950/30"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
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
