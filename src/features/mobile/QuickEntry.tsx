import { useLive } from '../ledger/lib/cache'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery } from 'convex/react'
import { BanknoteArrowDown, BanknoteArrowUp, Camera, Check, ChevronLeft, ContactRound, ImagePlus, Search } from 'lucide-react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { useUploader } from '../ledger/lib/upload'
import { rupees } from '../ledger/lib/format'
import { confirmPostingDate } from '../../lib/dateCheck'

type Mode = 'ledger' | 'photo' | 'payment'
type Party = {
  _id: Id<'ledgers'>; name: string; groupName: string; phone?: string; place?: string; aadhaar?: string
}
type Bill = {
  id: string; number: string; customerName: string; kind?: string; date: string; total: number;
  voucherId?: string; attachments?: { storageId: string }[]; updatedAt?: number
}
type DayRow = { vchLabel: string; vchType: string; partyLedgerId: string; amount: number; refNo?: string }

const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const dateMs = (date: string) => Date.parse(`${date}T00:00:00Z`)
const newReference = () => `MOBILE-${crypto.randomUUID().slice(0, 8).toUpperCase()}`
const button = 'min-h-12 w-full rounded-xl bg-shiv-green px-4 py-3 text-base font-bold text-stone-950 disabled:cursor-wait disabled:opacity-60'
const field = 'w-full rounded-xl border border-stone-300 bg-white px-3 py-3 text-base text-stone-950 outline-none focus:border-shiv-green dark:border-white/20 dark:bg-stone-900 dark:text-white'
const label = 'block space-y-1 text-sm font-semibold text-stone-700 dark:text-stone-200'

function PartyPicker({ parties, selected, onSelect }: {
  parties: Party[]; selected: Party | null; onSelect: (party: Party | null) => void
}) {
  const [search, setSearch] = useState('')
  const found = useMemo(() => {
    const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean)
    if (!words.length) return []
    return parties.filter(p => words.every(word => `${p.name} ${p.place ?? ''} ${p.phone ?? ''}`.toLowerCase().includes(word))).slice(0, 12)
  }, [parties, search])
  if (selected) return <div className="flex items-center justify-between gap-3 rounded-xl border border-stone-200 bg-white p-4 dark:border-white/10 dark:bg-white/5">
    <div className="min-w-0"><p className="font-bold">{selected.name}</p><p className="text-xs text-stone-500">{selected.groupName === 'Sundry Creditors' ? 'Supplier' : 'Customer'}{selected.phone ? ` · ${selected.phone}` : ''}</p></div>
    <button type="button" className="shrink-0 text-sm font-semibold text-emerald-700 underline dark:text-shiv-green" onClick={() => { onSelect(null); setSearch('') }}>Change</button>
  </div>
  return <div className="space-y-2">
    <label className="flex items-center gap-2 rounded-xl border border-stone-300 bg-white px-3 dark:border-white/20 dark:bg-stone-900">
      <Search size={18} className="text-stone-500" aria-hidden="true" />
      <input className="min-h-12 min-w-0 flex-1 bg-transparent text-base outline-none" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search name or phone" autoComplete="off" />
    </label>
    {search.trim() && <div className="max-h-64 overflow-y-auto rounded-xl border border-stone-200 bg-white dark:border-white/10 dark:bg-stone-900">
      {found.length ? found.map(p => <button type="button" key={p._id} onClick={() => onSelect(p)} className="block min-h-12 w-full border-b border-stone-100 px-3 py-2 text-left last:border-0 dark:border-white/10">
        <span className="block font-semibold">{p.name}</span><span className="text-xs text-stone-500">{p.groupName === 'Sundry Creditors' ? 'Supplier' : 'Customer'}{p.place ? ` · ${p.place}` : ''}</span>
      </button>) : <p className="p-3 text-sm text-stone-500">No matching account. Check the spelling in Account Masters.</p>}
    </div>}
  </div>
}

export function QuickEntry() {
  const [mode, setMode] = useState<Mode>('ledger')
  const [party, setParty] = useState<Party | null>(null)
  const [bill, setBill] = useState<Bill | null>(null)
  const [billSearch, setBillSearch] = useState('')
  const [name, setName] = useState('')
  const [place, setPlace] = useState('')
  const [phone, setPhone] = useState('')
  const [aadhaar, setAadhaar] = useState('')
  const [photos, setPhotos] = useState<File[]>([])
  const [uploadedIds, setUploadedIds] = useState<Id<'_storage'>[]>([])
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(today)
  const [accountId, setAccountId] = useState('')
  const [reference, setReference] = useState('')
  const [generatedReference, setGeneratedReference] = useState(newReference)
  const [note, setNote] = useState('')
  const [proofs, setProofs] = useState<File[]>([])
  const [proofIds, setProofIds] = useState<Id<'_storage'>[]>([])
  const [similarOkay, setSimilarOkay] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const masters = useLive(api.masters.all, {}, 'masters') as { ledgers: Party[] } | undefined
  const billData = useQuery(api.bills.get, {}) as { bills: Bill[] } | null | undefined
  const from = dateMs(date)
  const day = useQuery(api.reports.dayBook, mode === 'payment' && Number.isFinite(from) ? { from, to: from + 86_399_999 } : 'skip') as DayRow[] | undefined
  const updateLedger = useMutation(api.masters.updateLedger)
  const addImages = useMutation(api.bills.addImages)
  const createReceipt = useMutation(api.vouchers.createReceipt)
  const createPayment = useMutation(api.vouchers.createPayment)
  const upload = useUploader()
  const parties = useMemo(() => (masters?.ledgers ?? []).filter(p => ['Sundry Debtors', 'Sundry Creditors'].includes(p.groupName)), [masters])
  const accounts = useMemo(() => (masters?.ledgers ?? []).filter(p => ['Cash-in-Hand', 'Bank Accounts'].includes(p.groupName)), [masters])
  const bills = useMemo(() => (billData?.bills ?? []).filter(b => b.voucherId && b.kind !== 'quotation').sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)), [billData])
  const billResults = useMemo(() => {
    const q = billSearch.trim().toLowerCase()
    return q ? bills.filter(b => `${b.number} ${b.customerName} ${b.date}`.toLowerCase().includes(q)).slice(0, 12) : []
  }, [bills, billSearch])
  const paymentKind = party?.groupName === 'Sundry Creditors' ? 'payment' : 'receipt'
  const paymentRef = reference.trim() || generatedReference
  const sameRef = day?.find(row => row.refNo === paymentRef)
  const similar = day?.filter(row => row.partyLedgerId === party?._id && row.vchType.toLowerCase() === paymentKind && Number(row.amount) === Number(amount) && Number(amount) > 0) ?? []

  useEffect(() => {
    setName(party?.name ?? '')
    setPlace(party?.place ?? '')
    setPhone(party?.phone ?? '')
    setAadhaar('')
    setAccountId('')
    setSimilarOkay(false)
    setAmount('')
    setReference('')
    setNote('')
    setProofs([])
    setProofIds([])
    setGeneratedReference(newReference())
  }, [party?._id])

  const switchMode = (next: Mode) => { setMode(next); setParty(null); setBill(null); setError(''); setSuccess('') }
  const run = async (work: () => Promise<string>) => {
    setBusy(true); setError(''); setSuccess('')
    try { setSuccess(await work()) }
    catch (cause) { setError(cause instanceof Error ? cause.message.replace(/^.*Uncaught Error:\s*/s, '').split('\n')[0] : String(cause)) }
    finally { setBusy(false) }
  }
  const saveLedger = () => run(async () => {
    if (!party) throw Error('Choose a customer or supplier.')
    if (!name.trim()) throw Error('Enter the account name.')
    const digits = aadhaar.replace(/\D/g, '')
    if (aadhaar && digits.length !== 12) throw Error('Aadhaar needs 12 digits.')
    await updateLedger({ id: party._id, name: name.trim(), place: place.trim(), phone: phone.trim(), ...(digits ? { aadhaar: digits } : {}) })
    setAadhaar('')
    return 'Ledger details saved. Existing bills use the updated account name.'
  })
  const savePhotos = () => run(async () => {
    if (!bill) throw Error('Choose the bill that should receive these photos.')
    if (!photos.length || photos.length > 12) throw Error('Choose 1 to 12 photos.')
    if (photos.some(file => !file.type.startsWith('image/'))) throw Error('Choose image files only.')
    const ids = uploadedIds.length ? uploadedIds : await upload(photos) as Id<'_storage'>[]
    setUploadedIds(ids)
    const result = await addImages({ billId: bill.id, storageIds: ids })
    setPhotos([]); setUploadedIds([])
    return `${result.added} photo${result.added === 1 ? '' : 's'} added to bill ${bill.number}. The bill and its voucher now show the same photos.`
  })
  const savePayment = () => run(async () => {
    if (!party) throw Error('Choose a customer or supplier.')
    const value = Number(amount)
    if (!Number.isFinite(value) || value <= 0 || Math.abs(Math.round(value * 100) - value * 100) > 0.000001) throw Error('Enter an amount with at most two decimals.')
    if (!Number.isFinite(from)) throw Error('Choose a valid date.')
    if (!confirmPostingDate(from)) throw Error('Not saved. Check the date.')
    if (proofs.length > 12 || proofs.some(file => !file.type.startsWith('image/'))) throw Error('Choose at most 12 image proof files.')
    const account = accounts.find(row => row._id === accountId)
    if (!account) throw Error('Choose the Cash or Bank account for this money.')
    if (sameRef) throw Error(`${sameRef.vchLabel} already uses this reference. Check Day Book before entering it again.`)
    if (similar.length && !similarOkay) throw Error('A same-day entry for this party and amount exists. Review it, then choose Record another payment if this is separate.')
    const ids = proofs.length ? (proofIds.length ? proofIds : await upload(proofs) as Id<'_storage'>[]) : []
    setProofIds(ids)
    const attachments = ids.map(storageId => ({ storageId, kind: 'receipt' as const }))
    const args = { date: from, partyLedgerId: party._id, amount: value, refNo: paymentRef,
      narration: note.trim() || undefined, attachments }
    if (paymentKind === 'payment') await createPayment({ ...args, paidFromLedgerId: account._id })
    else await createReceipt({ ...args, receivedIntoLedgerId: account._id })
    const message = `${paymentKind === 'payment' ? 'Supplier payment' : 'Customer receipt'} of ${rupees(value)} saved under ${party.name}. Reference: ${paymentRef}.`
    setAmount(''); setReference(''); setNote(''); setProofs([]); setProofIds([]); setSimilarOkay(false); setGeneratedReference(newReference())
    return message
  })

  return <div className="min-h-screen bg-stone-50 pb-20 text-stone-950 dark:bg-stone-950 dark:text-white">
    <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-stone-200 bg-stone-50/95 px-4 py-3 backdrop-blur dark:border-white/10 dark:bg-stone-950/95">
      <Link to="/m" aria-label="Back to mobile books" className="rounded-lg p-2 text-stone-600 dark:text-stone-300"><ChevronLeft size={21} /></Link>
      <div><h1 className="text-base font-bold">Quick entry</h1><p className="text-xs text-stone-500">Save to Shiv Panel from your phone</p></div>
    </header>
    <main className="mx-auto max-w-md space-y-5 px-4 pt-5">
      <div className="grid grid-cols-3 gap-2" role="tablist" aria-label="Quick entry action">
        {([
          ['ledger', ContactRound, 'Ledger'], ['photo', ImagePlus, 'Bill photo'], ['payment', BanknoteArrowDown, 'Money'],
        ] as const).map(([id, Icon, title]) => <button key={id} type="button" role="tab" aria-selected={mode === id} onClick={() => switchMode(id)}
          className={`flex min-h-20 flex-col items-center justify-center gap-1 rounded-xl border px-1 text-xs font-bold ${mode === id ? 'border-shiv-green bg-shiv-green/20' : 'border-stone-200 bg-white dark:border-white/10 dark:bg-white/5'}`}>
          <Icon size={22} aria-hidden="true" />{title}
        </button>)}
      </div>

      {mode === 'ledger' && <section className="space-y-4">
        <div><h2 className="text-lg font-bold">Update ledger</h2><p className="text-sm text-stone-500">Find the existing account, then change only its details.</p></div>
        <PartyPicker parties={parties} selected={party} onSelect={setParty} />
        {party && <form className="space-y-4" onSubmit={event => { event.preventDefault(); void saveLedger() }}>
          <label className={label}>Account name<input className={field} value={name} onChange={event => setName(event.target.value)} /></label>
          <label className={label}>Place<input className={field} value={place} onChange={event => setPlace(event.target.value)} /></label>
          <label className={label}>Phone<input className={field} inputMode="tel" autoComplete="tel" value={phone} onChange={event => setPhone(event.target.value)} /></label>
          <label className={label}>Aadhaar number<input className={field} inputMode="numeric" type="password" autoComplete="off" value={aadhaar} onChange={event => setAadhaar(event.target.value)} placeholder={party.aadhaar ? 'Saved; enter only to replace' : '12 digits, if available'} /></label>
          <button className={button} disabled={busy}>{busy ? 'Saving...' : 'Save ledger details'}</button>
        </form>}
      </section>}

      {mode === 'photo' && <section className="space-y-4">
        <div><h2 className="text-lg font-bold">Add photo to a bill</h2><p className="text-sm text-stone-500">Choose a posted bill. Photos go onto that bill and its voucher.</p></div>
        {bill ? <div className="flex items-center justify-between rounded-xl border border-stone-200 bg-white p-4 dark:border-white/10 dark:bg-white/5">
          <div><p className="font-bold">Bill {bill.number} · {bill.customerName}</p><p className="text-xs text-stone-500">{bill.date} · {rupees(bill.total)} · {bill.attachments?.length ?? 0} saved photos</p></div>
          <button className="text-sm font-semibold text-emerald-700 underline dark:text-shiv-green" onClick={() => { setBill(null); setPhotos([]); setUploadedIds([]) }}>Change</button>
        </div> : <div className="space-y-2">
          <label className="flex items-center gap-2 rounded-xl border border-stone-300 bg-white px-3 dark:border-white/20 dark:bg-stone-900"><Search size={18} className="text-stone-500" aria-hidden="true" />
            <input className="min-h-12 min-w-0 flex-1 bg-transparent text-base outline-none" value={billSearch} onChange={event => setBillSearch(event.target.value)} placeholder="Search bill number or party" /></label>
          {billSearch.trim() && <div className="max-h-64 overflow-y-auto rounded-xl border border-stone-200 bg-white dark:border-white/10 dark:bg-stone-900">
            {billResults.length ? billResults.map(row => <button type="button" key={row.id} className="block min-h-12 w-full border-b border-stone-100 px-3 py-2 text-left last:border-0 dark:border-white/10" onClick={() => { setBill(row); setPhotos([]); setUploadedIds([]) }}>
              <span className="block font-semibold">Bill {row.number} · {row.customerName}</span><span className="text-xs text-stone-500">{row.date} · {rupees(row.total)}</span>
            </button>) : <p className="p-3 text-sm text-stone-500">No posted bill found.</p>}
          </div>}
        </div>}
        {bill && <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <label className="flex min-h-16 cursor-pointer flex-col items-center justify-center rounded-xl border border-stone-300 bg-white text-sm font-semibold dark:border-white/20 dark:bg-white/5"><Camera size={21} aria-hidden="true" />Take photo
              <input className="sr-only" type="file" accept="image/*" capture="environment" onChange={event => { setPhotos(current => [...current, ...Array.from(event.target.files ?? [])]); setUploadedIds([]); event.target.value = '' }} /></label>
            <label className="flex min-h-16 cursor-pointer flex-col items-center justify-center rounded-xl border border-stone-300 bg-white text-sm font-semibold dark:border-white/20 dark:bg-white/5"><ImagePlus size={21} aria-hidden="true" />Choose photos
              <input className="sr-only" type="file" accept="image/*" multiple onChange={event => { setPhotos(current => [...current, ...Array.from(event.target.files ?? [])]); setUploadedIds([]); event.target.value = '' }} /></label>
          </div>
          {!!photos.length && <div className="rounded-xl bg-stone-200/60 p-3 text-sm dark:bg-white/10"><p>{photos.length} photo{photos.length === 1 ? '' : 's'} selected</p><ul className="mt-1 list-inside list-disc text-xs text-stone-500">{photos.map((file, index) => <li key={`${file.name}-${index}`}>{file.name}</li>)}</ul><button className="mt-2 text-sm font-semibold underline" onClick={() => { setPhotos([]); setUploadedIds([]) }}>Clear photos</button></div>}
          <button className={button} disabled={busy || !photos.length || photos.length > 12} onClick={() => void savePhotos()}>{busy ? 'Uploading...' : 'Add photos to bill'}</button>
          {photos.length > 12 && <p className="text-sm text-red-700">Choose at most 12 photos.</p>}
        </div>}
      </section>}

      {mode === 'payment' && <section className="space-y-4">
        <div><h2 className="text-lg font-bold">Record money</h2><p className="text-sm text-stone-500">A customer creates a receipt. A supplier creates a payment.</p></div>
        <PartyPicker parties={parties} selected={party} onSelect={setParty} />
        {party && <form className="space-y-4" onSubmit={event => { event.preventDefault(); void savePayment() }}>
          <div className="flex items-center gap-2 rounded-xl bg-stone-200/70 p-3 text-sm font-semibold dark:bg-white/10">{paymentKind === 'payment' ? <BanknoteArrowUp size={18} /> : <BanknoteArrowDown size={18} />}{paymentKind === 'payment' ? 'Pay supplier' : 'Receive from customer'}</div>
          <div className="grid grid-cols-2 gap-3"><label className={label}>Amount<input className={field} inputMode="decimal" value={amount} onChange={event => { setAmount(event.target.value); setSimilarOkay(false) }} placeholder="0.00" required /></label>
            <label className={label}>Date<input className={field} type="date" value={date} onChange={event => { setDate(event.target.value); setSimilarOkay(false) }} required /></label></div>
          <label className={label}>{paymentKind === 'payment' ? 'Paid from' : 'Received into'}<select className={field} value={accountId} onChange={event => setAccountId(event.target.value)} required>
            <option value="">Choose Cash or Bank</option>{accounts.map(row => <option key={row._id} value={row._id}>{row.name}</option>)}
          </select></label>
          <label className={label}>Transaction reference<input className={field} value={reference} onChange={event => setReference(event.target.value)} placeholder={`Optional; uses ${generatedReference}`} /></label>
          <label className={label}>Note<input className={field} value={note} onChange={event => setNote(event.target.value)} placeholder="Bill number or reason, if useful" /></label>
          <label className="block cursor-pointer rounded-xl border border-dashed border-stone-300 p-4 text-center text-sm font-semibold dark:border-white/20">Attach payment proof, if any
            <input className="sr-only" type="file" accept="image/*" multiple onChange={event => { setProofs(Array.from(event.target.files ?? [])); setProofIds([]) }} /></label>
          {!!proofs.length && <p className="text-sm text-stone-500">{proofs.length} proof photo{proofs.length === 1 ? '' : 's'} selected</p>}
          {!!similar.length && <label className="flex gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-900/20 dark:text-amber-200"><input type="checkbox" checked={similarOkay} onChange={event => setSimilarOkay(event.target.checked)} />A {paymentKind} for this party and amount already exists on this date ({similar.map(row => row.vchLabel).join(', ')}). Record another separate transaction.</label>}
          <button className={button} disabled={busy || day === undefined || Boolean(sameRef) || (!!similar.length && !similarOkay)}>{busy ? 'Saving...' : paymentKind === 'payment' ? 'Record supplier payment' : 'Record customer receipt'}</button>
          <p className="text-xs text-stone-500">This records money in the selected Cash or Bank account. It does not create another sale or purchase.</p>
        </form>}
      </section>}

      {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800 dark:bg-red-900/25 dark:text-red-200">{error}</p>}
      {success && <div role="status" className="flex items-start gap-2 rounded-xl bg-emerald-50 p-3 text-sm font-semibold text-emerald-900 dark:bg-emerald-900/25 dark:text-emerald-100"><Check size={19} className="shrink-0" aria-hidden="true" />{success}</div>}
    </main>
  </div>
}
