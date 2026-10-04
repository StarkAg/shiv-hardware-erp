import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Camera, Check, Circle } from 'lucide-react'
import { useAction, useMutation, useQuery } from 'convex/react'
import { anyApi } from 'convex/server'
import type { Id } from '../../../convex/_generated/dataModel'
import { useLedgerTheme } from '../ledger/useLedgerTheme'
import { rupees } from '../ledger/lib/format'
import './BillFlow.css'

type Kind = 'sale' | 'purchase' | 'grn' | 'receipt' | 'payment' | 'unknown'
type Route = 'unset' | 'handover' | 'rack' | 'order' | 'fabrication' | 'mixed'
type Task = 'ordered' | 'picked' | 'mechanicSent' | 'measurementsReturned' | 'materialsHanded' |
  'made' | 'outForDelivery' | 'delivered' | 'goodsOrdered' | 'goodsReceived'
type ReadItem = { desc?: string; qty?: string; rate?: string; amount?: number | null }
type ReadDraft = { kind?: string; party?: string; date?: string; total?: number | null; items?: ReadItem[]; notes?: string }
type Flow = {
  _id: Id<'billFlows'>; flowKey: string; documentKind: Kind; party: string; date: string;
  amount?: number; cashEntryId?: string; voucherId?: string; cashVoucherId?: string;
  billId?: string; jobId?: string; photos: string[]; photoUrls: (string | null)[];
  intakeStatus: string; expectedPhotos?: number; readDraft?: ReadDraft; readError?: string; route: Route;
  tasks: Record<string, boolean>; stage: string; measurements?: string;
  history: { at: number; action: string }[]
}
type Line = { id: string; description: string; qty: string; unit: string; rate: string; amount: string }

const STAGES: Record<string, string> = {
  routing: 'Needs routing', ordering: 'Ordering', picking: 'Picking from racks',
  mechanic: 'With mechanic', materials: 'Raw materials to mechanic',
  workshop: 'In workshop', 'ready-delivery': 'Ready for delivery',
  delivery: 'In delivery', complete: 'Complete', 'goods-due': 'Goods due',
  'bill-to-come': 'Bill to come', cancelled: 'Cancelled',
}
const KINDS: Record<string, string> = {
  sale: 'Customer sale', purchase: 'Purchase bill', grn: 'Goods received',
  receipt: 'Customer receipt', payment: 'Supplier payment', unknown: 'Unclassified',
}
const today = () => new Date().toISOString().slice(0, 10)
const id = () => globalThis.crypto?.randomUUID?.() ?? `line-${Date.now()}-${Math.random()}`
const toNumber = (value: unknown) => Number(String(value ?? '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?/)?.[0]) || 0
const dateText = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : today()

function PhotoStrip({ flow }: { flow: Flow }) {
  const [shown, setShown] = useState<number | null>(null)
  return <>
    {flow.photoUrls.length > 0 && <div className="flow-photos">
      {flow.photoUrls.map((url, at) => url && <button key={`${url}-${at}`} onClick={() => setShown(at)} title={`Open page ${at + 1}`}>
        <img src={url} alt={`Bill page ${at + 1}`} loading="lazy" /><span>{at + 1}</span>
      </button>)}
    </div>}
    {shown !== null && flow.photoUrls[shown] && <div className="flow-photo-modal" role="dialog" aria-modal="true"
      onClick={() => setShown(null)}>
      <button className="flow-photo-close" onClick={() => setShown(null)}>Close ×</button>
      <img src={flow.photoUrls[shown]!} alt={`Bill page ${shown + 1}`} onClick={event => event.stopPropagation()} />
      {flow.photoUrls.length > 1 && <div className="flow-photo-pages" onClick={event => event.stopPropagation()}>
        {flow.photoUrls.map((_, at) => <button key={at} className={at === shown ? 'active' : ''} onClick={() => setShown(at)}>{at + 1}</button>)}
      </div>}
    </div>}
  </>
}

function IntakeEditor({ flow, candidates, onDone }: { flow: Flow; candidates: Flow[]; onDone: () => void }) {
  const read = useAction(anyApi.ai.readFlow)
  const postBill = useMutation(anyApi.billLedger.postBill)
  const convertMoney = useMutation(anyApi.billFlow.convertMoney)
  const linkExisting = useMutation(anyApi.billFlow.linkExisting)
  const [kind, setKind] = useState<Kind>('unknown')
  const [party, setParty] = useState('')
  const [date, setDate] = useState('')
  const [amount, setAmount] = useState('')
  const [lines, setLines] = useState<Line[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [existingId, setExistingId] = useState('')
  const cashIn = flow.documentKind === 'receipt' || flow.documentKind === 'sale'
  const choices: Kind[] = cashIn ? ['sale', 'receipt'] : ['purchase', 'grn', 'payment']

  useEffect(() => {
    const draft = flow.readDraft
    const guess = draft?.kind as Kind | undefined
    setKind(guess && choices.includes(guess) ? guess : flow.documentKind)
    setParty(draft?.party?.trim() || flow.party)
    setDate(dateText(draft?.date || flow.date))
    setAmount(draft?.total != null ? String(draft.total) : '')
    setLines((draft?.items ?? []).map(item => ({
      id: id(), description: item.desc ?? '', qty: String(toNumber(item.qty) || 1),
      unit: (item.qty ?? '').replace(/[\d.,\s]/g, '') || 'Pc',
      rate: item.rate ?? '', amount: item.amount == null ? '' : String(item.amount),
    })))
    setError('')
  }, [flow._id, flow.readDraft]) // eslint-disable-line react-hooks/exhaustive-deps

  const setLine = (rowId: string, field: keyof Line, value: string) =>
    setLines(current => current.map(line => line.id === rowId ? { ...line, [field]: value } : line))

  const convert = async () => {
    setError('')
    if (!party.trim()) return setError('Enter the party name.')
    if (!dateText(date) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return setError('Enter the document date.')
    if (kind !== 'grn' && kind !== 'receipt' && kind !== 'payment' && !(toNumber(amount) > 0)) {
      return setError('Enter the bill total, or choose Goods received if the amount is not known.')
    }
    setBusy(true)
    try {
      if (kind === 'receipt' || kind === 'payment') {
        await convertMoney({ id: flow._id, kind, party: party.trim() })
      } else {
        const items = lines.filter(line => line.description.trim()).map(line => ({
          id: line.id, description: line.description.trim(), qty: toNumber(line.qty) || 1,
          unit: line.unit.trim() || 'Pc', amount: kind === 'grn' ? 0 : toNumber(line.amount),
          rate: toNumber(line.rate),
        }))
        await postBill({
          bill: {
            id: `flow-${flow._id}`, number: '', kind, date,
            customerName: party.trim(), items, total: kind === 'grn' ? 0 : toNumber(amount),
            paid: false, paidAmount: 0, paymentMode: 'cash', notes: flow.readDraft?.notes ?? '',
          },
          attachments: flow.photos.map(storageId => ({ storageId, kind: 'bill' })),
          keepAsBill: true, flowId: flow._id, cashEntryId: flow.cashEntryId,
        })
      }
      onDone()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally { setBusy(false) }
  }

  return <div className="flow-editor">
    <div className="flow-section-head"><h2>Check and convert</h2><button onClick={onDone}>Close</button></div>
    <PhotoStrip flow={flow} />
    <div className="flow-read-row">
      <span>{flow.intakeStatus === 'uploading' ? `Uploading pages ${flow.photos.length}/${flow.expectedPhotos ?? '?'}` :
        flow.intakeStatus === 'reading' ? 'Reading photo…' : flow.intakeStatus === 'ready' ? 'Photo read · check every field' :
        flow.intakeStatus === 'failed' ? `Could not read: ${flow.readError}` : 'Photo waiting to be read'}</span>
      <button disabled={busy || flow.intakeStatus === 'reading' || flow.intakeStatus === 'uploading'} onClick={async () => {
        setBusy(true); setError('')
        try { const result = await read({ id: flow._id }); if (!result.ok) setError(result.error || 'Could not read photo.') }
        catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
        finally { setBusy(false) }
      }}>{flow.intakeStatus === 'ready' ? 'Read again' : 'Read photo'}</button>
    </div>
    <div className="flow-fields">
      <label>Entry type<select value={kind} onChange={event => setKind(event.target.value as Kind)}>
        {choices.map(value => <option key={value} value={value}>{KINDS[value]}</option>)}
      </select></label>
      <label>Party<input value={party} onChange={event => setParty(event.target.value)} /></label>
      <label>Date<input type="date" value={date} onChange={event => setDate(event.target.value)} /></label>
      <label>{kind === 'receipt' || kind === 'payment' ? 'Cashier amount already recorded' : 'Bill total'}
        <input inputMode="decimal" value={kind === 'receipt' || kind === 'payment' ? String(flow.amount ?? '') : amount}
          disabled={kind === 'receipt' || kind === 'payment' || kind === 'grn'}
          onChange={event => setAmount(event.target.value)} /></label>
    </div>
    {!['receipt', 'payment'].includes(kind) && <div className="flow-lines">
      <div className="flow-section-head"><h3>Items</h3><button onClick={() => setLines(current => [...current, { id: id(), description: '', qty: '1', unit: 'Pc', rate: '', amount: '' }])}>Add item</button></div>
      {lines.map(line => <div className="flow-line" key={line.id}>
        <input aria-label="Item" placeholder="Item" value={line.description} onChange={event => setLine(line.id, 'description', event.target.value)} />
        <input aria-label="Quantity" placeholder="Qty" inputMode="decimal" value={line.qty} onChange={event => setLine(line.id, 'qty', event.target.value)} />
        <input aria-label="Unit" placeholder="Pc" value={line.unit} onChange={event => setLine(line.id, 'unit', event.target.value)} />
        <input aria-label="Rate" placeholder="Rate" inputMode="decimal" value={line.rate} onChange={event => setLine(line.id, 'rate', event.target.value)} />
        <input aria-label="Amount" placeholder="Amount" inputMode="decimal" value={line.amount} onChange={event => setLine(line.id, 'amount', event.target.value)} disabled={kind === 'grn'} />
        <button aria-label="Remove item" onClick={() => setLines(current => current.filter(item => item.id !== line.id))}>×</button>
      </div>)}
    </div>}
    {flow.cashEntryId && <p className="flow-hint">Cashier entry {flow.cashEntryId} is already recorded. Converting this photo will link that payment, without recording the money again.</p>}
    {error && <p className="flow-error" role="alert">{error}</p>}
    <button className="flow-primary" disabled={busy} onClick={convert}>{busy ? 'Working…' : `Convert to ${KINDS[kind]}`}</button>
    {candidates.length > 0 && <div className="flow-existing">
      <h3>Bill already entered?</h3>
      <p className="flow-hint">Link this photo and cashier entry to that bill. This does not post another sale or purchase.</p>
      <select value={existingId} onChange={event => setExistingId(event.target.value)}>
        <option value="">Choose an existing bill</option>
        {candidates.map(candidate => <option key={candidate._id} value={candidate._id}>
          {candidate.date} · {candidate.party} · {KINDS[candidate.documentKind]} · {candidate.amount ? rupees(candidate.amount) : 'Amount pending'}
        </option>)}
      </select>
      <button disabled={!existingId || busy} onClick={async () => {
        setBusy(true); setError('')
        try { await linkExisting({ cashFlowId: flow._id, billFlowId: existingId as Id<'billFlows'> }); onDone() }
        catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
        finally { setBusy(false) }
      }}>Link existing bill</button>
    </div>}
  </div>
}

function TaskButton({ label, task, flow }: { label: string; task: Task; flow: Flow }) {
  const mark = useMutation(anyApi.billFlow.mark)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const done = !!flow.tasks[task]
  return <div className="flow-task-wrap">
    <button className={`flow-task ${done ? 'done' : ''}`} disabled={busy} onClick={async () => {
      setBusy(true); setError('')
      try { await mark({ id: flow._id, task, done: !done }) }
      catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
      finally { setBusy(false) }
    }}><span>{done ? <Check size={16} aria-hidden /> : <Circle size={16} aria-hidden />}</span>{label}</button>
    {error && <small className="flow-error">{error}</small>}
  </div>
}

function FlowDetail({ flow, onClose }: { flow: Flow; onClose: () => void }) {
  const setRoute = useMutation(anyApi.billFlow.setRoute)
  const mark = useMutation(anyApi.billFlow.mark)
  const linkJob = useMutation(anyApi.billFlow.linkJob)
  const [jobId, setJobId] = useState(flow.jobId ?? '')
  const [measurements, setMeasurements] = useState(flow.measurements ?? '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { setJobId(flow.jobId ?? ''); setMeasurements(flow.measurements ?? '') }, [flow._id])
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true); setError('')
    try { await work() } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }
  const customer = flow.documentKind === 'sale' || flow.documentKind === 'receipt'
  return <div className="flow-detail">
    <div className="flow-section-head"><h2>{flow.party}</h2><button onClick={onClose}>Close</button></div>
    <div className="flow-meta"><b>{KINDS[flow.documentKind]}</b><span>{flow.date}</span><span>{flow.amount ? rupees(flow.amount) : 'Amount pending'}</span></div>
    <div className="flow-status">{STAGES[flow.stage] ?? flow.stage}</div>
    <PhotoStrip flow={flow} />
    <div className="flow-links">
      {flow.billId && <Link to={`/bills/${flow.billId}`}>Open bill</Link>}
      {flow.voucherId && <Link to={`/bills/voucher/${flow.voucherId}`}>Open voucher</Link>}
      {flow.cashVoucherId && flow.cashVoucherId !== flow.voucherId && <Link to={`/bills/voucher/${flow.cashVoucherId}`}>Cashier voucher</Link>}
      {flow.cashEntryId && <Link to="/cash-review">Cash entry</Link>}
    </div>
    {customer && <>
      <h3>How this bill will be fulfilled</h3>
      <div className="flow-routes">{([
        ['handover', 'Hand over now'], ['rack', 'Pick from racks'], ['order', 'Order then pick'],
        ['fabrication', 'Make to measure'], ['mixed', 'Rack + fabrication'],
      ] as [Route, string][]).map(([route, label]) => <button key={route} className={flow.route === route ? 'active' : ''}
        disabled={busy} onClick={() => run(() => setRoute({ id: flow._id, route }))}>{label}</button>)}</div>
      {flow.route === 'unset' && <p className="flow-hint">Choose a route. Cash sales stay here until someone confirms the goods were handed over.</p>}
      {flow.route === 'order' && <TaskButton flow={flow} task="ordered" label="Items ordered" />}
      {['rack', 'order', 'mixed'].includes(flow.route) && <TaskButton flow={flow} task="picked" label="Items taken from racks" />}
      {['fabrication', 'mixed'].includes(flow.route) && <>
        <h3>Mechanic and workshop</h3>
        <label className="flow-wide-field">Mechanic job reference
          <div><input value={jobId} onChange={event => setJobId(event.target.value)} placeholder="Existing mechanic panel job #" />
            <button onClick={() => run(() => linkJob({ id: flow._id, jobId }))}>Save link</button></div>
        </label>
        <TaskButton flow={flow} task="mechanicSent" label="Bill sent to mechanic" />
        <label className="flow-wide-field">Measurements returned
          <textarea value={measurements} onChange={event => setMeasurements(event.target.value)} placeholder="Sizes and site notes" />
          <button disabled={!measurements.trim()} onClick={() => run(() => mark({ id: flow._id,
            task: 'measurementsReturned', done: true, measurements, jobId }))}>Save measurements</button>
        </label>
        <TaskButton flow={flow} task="materialsHanded" label="Raw materials given to mechanic" />
        <TaskButton flow={flow} task="made" label="Door/window made" />
      </>}
      {flow.route !== 'unset' && <>
        {flow.route !== 'handover' && <TaskButton flow={flow} task="outForDelivery" label="Out for delivery" />}
        <TaskButton flow={flow} task="delivered" label={flow.route === 'handover' ? 'Handed over' : 'Delivered'} />
      </>}
    </>}
    {flow.documentKind === 'purchase' && <>
      <h3>Supplier goods</h3>
      <TaskButton flow={flow} task="goodsOrdered" label="Goods ordered" />
      <TaskButton flow={flow} task="goodsReceived" label="Goods received" />
    </>}
    {flow.documentKind === 'grn' && <p className="flow-hint">Goods are received. Enter the supplier's purchase bill against this GRN to complete its accounting link.</p>}
    {flow.documentKind === 'payment' && <p className="flow-hint">Supplier payment recorded. No goods stage is required for an old balance.</p>}
    {error && <p className="flow-error" role="alert">{error}</p>}
    <h3>History</h3>
    <ol className="flow-history">{[...flow.history].reverse().map((event, at) => <li key={`${event.at}-${at}`}>
      <time>{new Date(event.at).toLocaleString('en-IN')}</time>{event.action}
    </li>)}</ol>
  </div>
}

export function BillFlow() {
  const dark = useLedgerTheme()
  const rows = useQuery(anyApi.billFlow.list, {}) as Flow[] | undefined
  const [tab, setTab] = useState<'intake' | 'flow'>('intake')
  const [filter, setFilter] = useState('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const selected = rows?.find(row => row._id === selectedId)
  const intake = useMemo(() => (rows ?? []).filter(row => row.photos.length &&
    ['uploading', 'waiting', 'reading', 'ready', 'failed'].includes(row.intakeStatus)), [rows])
  const counts = useMemo(() => {
    const result: Record<string, number> = {}
    for (const row of rows ?? []) result[row.stage] = (result[row.stage] || 0) + 1
    return result
  }, [rows])
  const shown = useMemo(() => {
    const list = tab === 'intake' ? intake : rows ?? []
    const query = search.trim().toLowerCase()
    return list.filter(row => (filter === 'all' || tab === 'intake' || row.stage === filter) &&
      (!query || [row.party, row.documentKind, row.date, row.cashEntryId, row.billId].join(' ').toLowerCase().includes(query)))
  }, [tab, intake, rows, filter, search])

  return <div className={`bill-flow ${dark ? 'dark' : ''}`}>
    <header className="flow-head"><div><p>Shiv Hardware · work in progress</p><h1>Bill Flow</h1></div>
      <span>{rows === undefined ? 'Loading…' : `${rows.length} new cards`}</span></header>
    <div className="flow-tabs">
      <button className={tab === 'intake' ? 'active' : ''} onClick={() => { setTab('intake'); setSelectedId(null) }}>Intake <b>{intake.length}</b></button>
      <button className={tab === 'flow' ? 'active' : ''} onClick={() => { setTab('flow'); setSelectedId(null) }}>Flow <b>{rows?.length ?? 0}</b></button>
    </div>
    {tab === 'flow' && <div className="flow-filters">
      {['all', 'routing', 'ordering', 'picking', 'mechanic', 'materials', 'workshop', 'ready-delivery', 'delivery', 'goods-due', 'bill-to-come', 'complete'].map(stage =>
        <button key={stage} className={filter === stage ? 'active' : ''} onClick={() => setFilter(stage)}>
          {stage === 'all' ? 'All' : STAGES[stage]} {stage !== 'all' && !!counts[stage] && <b>{counts[stage]}</b>}
        </button>)}
    </div>}
    <input className="flow-search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Find party, bill, or cashier entry" />
    <div className="flow-layout">
      <div className="flow-list">
        {rows !== undefined && !shown.length && <p className="flow-empty">{tab === 'intake' ? 'No photographed bills waiting to convert.' : 'No bills in this stage.'}</p>}
        {shown.map(row => <button key={row._id} className={`flow-card ${row._id === selectedId ? 'selected' : ''}`}
          onClick={() => setSelectedId(row._id)}>
          <div className="flow-card-top"><span>{KINDS[row.documentKind]}</span><time>{row.date}</time></div>
          <strong>{row.party || 'Party to check'}</strong>
          <div className="flow-card-bottom"><span>{tab === 'intake' ? row.intakeStatus === 'ready' ? 'Ready to check' :
            row.intakeStatus === 'failed' ? 'Read failed · type manually' : 'Needs entry' : STAGES[row.stage] ?? row.stage}</span>
            <b>{row.amount ? rupees(row.amount) : '—'}</b></div>
          {row.photos.length > 0 && <small><Camera size={13} aria-hidden style={{ verticalAlign: '-2px' }} /> {row.photos.length} page{row.photos.length === 1 ? '' : 's'}</small>}
        </button>)}
      </div>
      <div className="flow-panel">{selected ? tab === 'intake' && selected.intakeStatus !== 'converted'
        ? <IntakeEditor key={selected._id} flow={selected} candidates={(rows ?? [])
          .filter(row => row._id !== selected._id && row.voucherId && !row.cashEntryId &&
            (selected.documentKind === 'receipt' ? row.documentKind === 'sale' :
              ['purchase', 'grn'].includes(row.documentKind)))
          .sort((a, b) => Number(b.party.toLowerCase() === selected.party.toLowerCase()) -
            Number(a.party.toLowerCase() === selected.party.toLowerCase()))}
          onDone={() => setSelectedId(null)} />
        : <FlowDetail key={selected._id} flow={selected} onClose={() => setSelectedId(null)} />
        : <div className="flow-empty">Choose a {tab === 'intake' ? 'photo to check and convert' : 'bill to see its next action'}.</div>}</div>
    </div>
  </div>
}
