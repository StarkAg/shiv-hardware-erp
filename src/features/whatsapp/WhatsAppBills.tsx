import { Fragment, useEffect, useMemo, useState } from 'react'
import { Check, Eye, RotateCcw, Send, X } from 'lucide-react'
import { useMutation, useQuery } from 'convex/react'
import { Link } from 'react-router-dom'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { useLive } from '../ledger/lib/cache'
import { useStore } from '../../lib/store'
import { useLedgerTheme } from '../ledger/useLedgerTheme'
import Confirm from '../ledger/components/Confirm'
import { TableSkeleton } from '../ledger/components/Skeleton'
import BillViewerUntyped from '../ledger/components/BillViewer'
import VoucherBillPreviewUntyped from '../ledger/components/VoucherBillPreview'
import type { Bill } from '../../lib/types'
import '../ledger/ledger.css'

/** The Railway service holding the owner's WhatsApp link (whatsapp-bills/). */
const SERVICE = 'https://whatsapp-bills-production.up.railway.app'

const when = (ms: number) => new Date(ms).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
/** Whether it is the sender's hours, India time: outside them a bill waits for the morning. */
const inHours = (hours: number[] = [9, 21]) => {
  const hour = new Date(Date.now() + 19_800_000).getUTCHours()
  return hour >= hours[0] && hour < hours[1]
}
const rupees = (n: number | null) => (n == null ? '—' : `₹${Math.round(n).toLocaleString('en-IN')}`)
const STATUS: Record<string, string> = { sent: 'Sent', skipped: 'Not sent', failed: 'Failed' }

// The ledger's viewers are plain JSX.
const BillViewer = BillViewerUntyped as unknown as (props: {
  voucher: unknown
  onClose: () => void
  toolsBefore?: React.ReactNode
}) => JSX.Element
const VoucherBillPreview = VoucherBillPreviewUntyped as unknown as (props: {
  bill: Bill
  onClose: () => void
  actions?: React.ReactNode
}) => JSX.Element

type Waiting = { voucherId: Id<'vouchers'>; label: string; name: string; amount: number | null; needsRecipient: boolean; canSend: boolean }

/**
 * The bill as it will go: its own photos, or the typed bill drawn as it
 * prints. Send from here asks the same question as Send in the row.
 */
function SeeBill({ row, onSend, onClose }: { row: Waiting; onSend: () => void; onClose: () => void }) {
  const what = useQuery(api.billWhatsApp.preview, { voucherId: row.voucherId })
  const send = (
    <button type="button" className="btn" onClick={onSend} disabled={!row.canSend}>
      <Send size={15} aria-hidden="true" /> Send
    </button>
  )
  if (what === undefined) return null
  if (what?.photos.length) {
    return (
      <BillViewer
        voucher={{ vchLabel: row.label, party: row.name, amount: row.amount, attachmentUrls: what.photos }}
        onClose={onClose}
        toolsBefore={send}
      />
    )
  }
  if (what?.bill) return <VoucherBillPreview bill={what.bill as Bill} onClose={onClose} actions={send} />
  return (
    <Confirm title={`${row.label} has nothing to show`} body="No photo and no typed bill: it would not be sent." confirmLabel="Close" onClose={onClose} onConfirm={onClose} />
  )
}

/**
 * A customer's sales from before the automatic sending, found by name and
 * sent one at a time with Send now. Nothing here is ever sent on its own.
 */
function OlderBills({ linked, onSee, onSend }: {
  linked: boolean
  onSee: (row: Waiting) => void
  onSend: (row: { voucherId: Id<'vouchers'>; label: string; name: string; needsRecipient: boolean; sentAt: number | null }) => void
}) {
  const masters = useLive(api.masters.all, {}, 'masters') as { ledgers?: { _id: Id<'ledgers'>; name: string; phone?: string; groupName: string }[] } | undefined
  const [find, setFind] = useState('')
  const [party, setParty] = useState<{ id: Id<'ledgers'>; name: string } | null>(null)
  const bills = useQuery(api.billWhatsApp.older, party ? { partyLedgerId: party.id } : 'skip')
  const matches = useMemo(() => {
    const words = find.trim().toLowerCase().split(/\s+/).filter(Boolean)
    if (!words.length) return []
    return (masters?.ledgers ?? [])
      .filter((l) => l.groupName === 'Sundry Debtors' && words.every((w) => l.name.toLowerCase().includes(w) || (l.phone ?? '').includes(w)))
      .slice(0, 8)
  }, [masters, find])
  const STATE: Record<string, string> = { sent: 'Sent', requested: inHours() ? 'Sending now' : 'Goes at 9 am', failed: 'Failed', skipped: 'Not sent' }

  return (
    <>
      <h2 className="sectiontitle">Older bills and receipts</h2>
      <div className="toolbar">
        <input
          className="partysearch"
          type="text"
          value={find}
          onChange={(e) => { setFind(e.target.value); setParty(null) }}
          placeholder="Customer name or phone"
          aria-label="Find a customer"
        />
      </div>
      {!party && matches.length > 0 && (
        <div className="table-wrap"><div className="scroller">
          <table className="ledger"><tbody>
            {matches.map((l) => (
              <tr key={l._id} className="clickable" onClick={() => { setParty({ id: l._id, name: l.name }); setFind(l.name.replace(/^m\/s\.?\s+/i, '')) }}>
                <td className="particulars">{l.name.replace(/^m\/s\.?\s+/i, '')}<div className="ref">{l.phone || 'No phone'}</div></td>
              </tr>
            ))}
          </tbody></table>
        </div></div>
      )}
      {party && (bills === undefined ? <TableSkeleton cols={5} rows={3} wide={1} /> : (
        <div className="table-wrap"><div className="scroller">
          <table className="ledger">
            <thead><tr><th className="w-no">Vch</th><th>Date</th><th className="num">Amount</th><th>WhatsApp</th><th className="w-acts" /></tr></thead>
            <tbody>
              {bills.map((b) => {
                const noPhone = !b.needsRecipient && !/\d{10}/.test(b.phone.replace(/\D/g, ''))
                const held = !b.final ? 'Waiting for its amount' : !b.hasPicture ? 'No photo to send' : noPhone ? 'No mobile number on the account' : null
                const row: Waiting = { voucherId: b.voucherId, label: b.label, name: b.name, amount: b.amount, needsRecipient: b.needsRecipient, canSend: !held && b.status !== 'requested' && linked }
                return (
                  <tr key={b.voucherId}>
                    <td className="mono entryno" data-label="Vch"><Link className="link plain" to={`/bills/voucher/${b.voucherId}`}>{b.label}</Link></td>
                    <td className="ref" data-label="Date">{new Date(b.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
                    <td className="num" data-label="Amount">{rupees(b.amount)}</td>
                    <td data-label="WhatsApp">
                      {held ? <span className="warn">{held}</span>
                        : b.status ? <span className={b.status === 'sent' ? 'credit' : 'warn'}>{b.markedSent ? 'Marked sent' : STATE[b.status]}{b.at ? ` · ${when(b.at)}` : ''}</span>
                        : 'Not sent'}
                    </td>
                    <td className="rowacts">
                      <button className="xbtn" title="See the bill" aria-label={`See ${b.label}`} onClick={() => onSee(row)}>
                        <Eye size={14} aria-hidden="true" />
                      </button>
                      <button className="xbtn" title={b.status === 'sent' ? 'Send again' : 'Send this bill now'} aria-label={`Send ${b.label} now`}
                        disabled={!row.canSend}
                        onClick={() => onSend({ voucherId: b.voucherId, label: b.label, name: b.name, needsRecipient: b.needsRecipient, sentAt: b.status === 'sent' ? b.at : null })}>
                        <Send size={14} aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                )
              })}
              {bills.length === 0 && <tr><td colSpan={5} className="particulars">No bills or receipts for {party.name}.</td></tr>}
            </tbody>
          </table>
        </div></div>
      ))}
    </>
  )
}

type Quote = { billId: string; label: string; name: string; phone: string; date: string; amount: number | null; status: string | null; at: number | null; reason: string; markedSent: boolean }

/** A quotation as it will go: its photos, or drawn as it prints. */
function SeeQuote({ quote, canSend, onSend, onClose }: { quote: Quote; canSend: boolean; onSend: () => void; onClose: () => void }) {
  const what = useQuery(api.billWhatsApp.quotePreview, { billId: quote.billId })
  const send = (
    <button type="button" className="btn" onClick={onSend} disabled={!canSend}>
      <Send size={15} aria-hidden="true" /> Send
    </button>
  )
  if (what === undefined) return null
  if (what?.photos.length) {
    return <BillViewer voucher={{ vchLabel: quote.label, party: quote.name, amount: quote.amount, attachmentUrls: what.photos }} onClose={onClose} toolsBefore={send} />
  }
  if (what?.bill) return <VoucherBillPreview bill={what.bill as unknown as Bill} onClose={onClose} actions={send} />
  return <Confirm title={`${quote.label} is no longer open`} body="It was deleted or sold, so it is not sent." confirmLabel="Close" onClose={onClose} onConfirm={onClose} />
}

/**
 * The open quotations, sent one at a time by hand: never on their own. The
 * newest few show; the find box reaches the rest.
 */
function Quotations({ linked, open, onError }: { linked: boolean; open: boolean; onError: (message: string) => void }) {
  const quotes = useLive(api.billWhatsApp.quotes, {}, 'whatsapp-quotes') as Quote[] | undefined
  const requestQuote = useMutation(api.billWhatsApp.requestQuote)
  const markQuoteSent = useMutation(api.billWhatsApp.markQuoteSent)
  const [find, setFind] = useState('')
  const [seeing, setSeeing] = useState<Quote | null>(null)
  const [sending, setSending] = useState<Quote | null>(null)
  const [marking, setMarking] = useState<Quote | null>(null)
  const deleteBill = useStore((s) => s.deleteBill)
  const [deleting, setDeleting] = useState<Quote | null>(null)
  const STATE: Record<string, string> = { sent: 'Sent', requested: open ? 'Sending now' : 'Goes at 9 am', failed: 'Failed', skipped: 'Not sent' }
  // Still to send on top; sent or marked sent below them, the latest few
  // unless something is being looked for.
  const { toSend, done } = useMemo(() => {
    const words = find.trim().toLowerCase().split(/\s+/).filter(Boolean)
    const all = (quotes ?? []).filter((q) => words.every((w) => [q.name, q.phone, q.label].some((s) => s.toLowerCase().includes(w))))
    const sent = all.filter((q) => q.status === 'sent').sort((a, b) => (b.at ?? 0) - (a.at ?? 0))
    return { toSend: all.filter((q) => q.status !== 'sent'), done: words.length ? sent : sent.slice(0, 5) }
  }, [quotes, find])
  const shown = [...toSend, ...done]
  const hasPhone = (q: Quote) => /\d{10}/.test(q.phone.replace(/\D/g, ''))

  return (
    <>
      <h2 className="sectiontitle">Quotations</h2>
      <div className="toolbar">
        <input className="partysearch" type="text" value={find} onChange={(e) => setFind(e.target.value)}
          placeholder="Customer, phone or QTN number" aria-label="Find a quotation" />
      </div>
      {quotes === undefined ? <TableSkeleton cols={5} rows={3} wide={1} /> : (
        <div className="table-wrap"><div className="scroller">
          <table className="ledger">
            <thead><tr><th className="w-no">Quotation</th><th>Customer</th><th>Date</th><th className="num">Amount</th><th>WhatsApp</th><th className="w-acts" /></tr></thead>
            <tbody>
              {shown.length > 0 && toSend.length === 0 && !find.trim() && <tr><td colSpan={6} className="particulars">Nothing to send: every open quotation has gone.</td></tr>}
              {shown.map((q, i) => (
                <Fragment key={q.billId}>
                {i === toSend.length && <tr className="grouprow"><td colSpan={6}>Sent</td></tr>}
                <tr>
                  <td className="mono entryno" data-label="Quotation"><Link className="link plain" to={`/bills/${q.billId}`}>{q.label}</Link></td>
                  <td className="particulars" data-label="Customer">{q.name || '—'}<div className="ref">{q.phone || 'No phone: asked when sending'}</div></td>
                  <td className="ref" data-label="Date">{new Date(q.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
                  <td className="num" data-label="Amount">{rupees(q.amount)}</td>
                  <td data-label="WhatsApp">
                    {q.status ? <span className={q.status === 'sent' ? 'credit' : 'warn'}>{q.markedSent ? 'Marked sent' : STATE[q.status]}{q.at ? ` · ${when(q.at)}` : ''}{q.status !== 'sent' && q.reason ? `: ${q.reason}` : ''}</span> : 'Not sent'}
                  </td>
                  <td className="rowacts">
                    <button className="xbtn" title="See the quotation" aria-label={`See ${q.label}`} onClick={() => setSeeing(q)}>
                      <Eye size={14} aria-hidden="true" />
                    </button>
                    <button className="xbtn" title={q.status === 'sent' ? 'Send again' : 'Send this quotation'} aria-label={`Send ${q.label}`}
                      disabled={!linked || q.status === 'requested'} onClick={() => setSending(q)}>
                      <Send size={14} aria-hidden="true" />
                    </button>
                    <button className="xbtn" title="Mark as already sent" aria-label={`Mark ${q.label} as already sent`}
                      disabled={q.status === 'requested' || q.status === 'sent'} onClick={() => setMarking(q)}>
                      <Check size={14} aria-hidden="true" />
                    </button>
                    <button className="xbtn del" title="Delete this quotation" aria-label={`Delete ${q.label}`}
                      disabled={q.status === 'requested'} onClick={() => setDeleting(q)}>
                      <X size={14} aria-hidden="true" />
                    </button>
                  </td>
                </tr>
                </Fragment>
              ))}
              {shown.length === 0 && <tr><td colSpan={6} className="particulars">{find.trim() ? 'No quotation matches that.' : 'No open quotations.'}</td></tr>}            </tbody>
          </table>
        </div></div>
      )}
      {seeing && (
        <SeeQuote quote={seeing} canSend={linked && seeing.status !== 'requested'} onClose={() => setSeeing(null)}
          onSend={() => { const q = seeing; setSeeing(null); setSending(q) }} />
      )}
      {sending && (
        <Confirm
          title={`Send ${sending.label} ${open ? 'now' : 'at 9 am'}?`}
          body={`It goes to ${sending.name || 'the customer'}'s WhatsApp${hasPhone(sending) ? ` (${sending.phone})` : ''} ${open ? 'now' : 'at 9 am'}, as the quotation page alone.${sending.status === 'sent' && sending.at ? ` It was already sent on ${when(sending.at)}.` : ''}`}
          confirmLabel={open ? 'Send now' : 'Send at 9 am'}
          ask={hasPhone(sending) ? undefined : { label: 'Customer WhatsApp number' }}
          toggle={{ label: 'New number: send the smile, folded hands and card first' }}
          onClose={() => setSending(null)}
          onConfirm={async (phone, newNumber) => {
            const { billId } = sending
            setSending(null)
            try { await requestQuote({ billId, ...(phone.trim() ? { phone } : {}), ...(newNumber ? { newNumber } : {}) }) } catch (err) { onError(err instanceof Error ? err.message : String(err)) }
          }}
        />
      )}
      {deleting && (
        <Confirm
          title={`Delete ${deleting.label}?`}
          body={`The quotation for ${deleting.name || 'this customer'} goes to the bill trash, where it can be restored.`}
          confirmLabel="Delete"
          danger
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            const { billId } = deleting
            setDeleting(null)
            if (!(await deleteBill(billId))) onError('Not deleted: the books could not be reached. Try again.')
          }}
        />
      )}
      {marking && (
        <Confirm
          title={`Mark ${marking.label} as already sent?`}
          body={`This records that it was shared with ${marking.name || 'the customer'} outside this sender. Nothing is sent.`}
          confirmLabel="Mark sent"
          onClose={() => setMarking(null)}
          onConfirm={async () => {
            const { billId } = marking
            setMarking(null)
            try { await markQuoteSent({ billId }) } catch (err) { onError(err instanceof Error ? err.message : String(err)) }
          }}
        />
      )}
    </>
  )
}

type Link = { status: string; me: string | null; hours?: number[]; dailyMax?: number; restMin?: number } | null

/** Whether the owner's WhatsApp is linked on the service: asked every half minute. */
function useLink(): Link | undefined {
  const [link, setLink] = useState<Link | undefined>(undefined)
  useEffect(() => {
    let live = true
    const ask = () => fetch(`${SERVICE}/health`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => { if (live) setLink(j) })
      .catch(() => { if (live) setLink(null) })
    void ask()
    const timer = setInterval(ask, 30_000)
    return () => { live = false; clearInterval(timer) }
  }, [])
  return link
}

/**
 * Sale bills to the customer's WhatsApp (convex/billWhatsApp.ts): whether the
 * owner's WhatsApp is linked and sending is on, the bills still to go and
 * what holds one back, and what went lately. A bill can be sent again.
 */
export function WhatsAppBills() {
  const dark = useLedgerTheme()
  const queue = useLive(api.billWhatsApp.queue, {}, 'whatsapp-queue')
  const link = useLink()
  const setOn = useMutation(api.billWhatsApp.setOn)
  const sendAgain = useMutation(api.billWhatsApp.sendAgain)
  const requestNow = useMutation(api.billWhatsApp.requestNow)
  const markSent = useMutation(api.billWhatsApp.markSent)
  const [again, setAgain] = useState<{ voucherId: Id<'vouchers'>; label: string; name: string } | null>(null)
  const [sendingNow, setSendingNow] = useState<{ voucherId: Id<'vouchers'>; label: string; name: string; needsRecipient: boolean; sentAt?: number | null } | null>(null)
  const [seeing, setSeeing] = useState<Waiting | null>(null)
  const [markingSent, setMarkingSent] = useState<{ voucherId: Id<'vouchers'>; label: string; name: string } | null>(null)
  const [switching, setSwitching] = useState(false)
  const [error, setError] = useState('')

  const linked = link?.status === 'ready'
  const open = inHours(link?.hours)
  const linkLine = link === undefined ? 'Checking the WhatsApp link…'
    : link === null ? 'The WhatsApp service is not answering'
    : linked ? `Linked to +${link.me}`
    : link.status === 'qr' ? 'Not linked: scan the QR on the login page'
    : 'Reconnecting'
  const rules = link?.hours ? `${link.hours.join('–')} h, at most ${link.dailyMax} a day, ${link.restMin} min after the last save` : ''

  return (
    <div className={`ledger-root min-h-screen ${dark ? 'dark' : ''}`}>
      <div className="app">
        <h1 className="pagetitle">WhatsApp bills</h1>
        <div className="toolbar">
          <div className="count">
            <span className={linked ? 'credit' : 'warn'}>{linkLine}</span>
            {queue && <> · Sending {queue.on ? `on since ${when(queue.from!)}` : 'off'}</>}
            {rules && <div className="ref">{rules}</div>}
          </div>
          <div className="actions">
            {queue && (
              <button className={`btn ${queue.on ? 'ghost' : ''}`} onClick={() => setSwitching(true)}>
                {queue.on ? 'Switch off' : 'Switch on'}
              </button>
            )}
          </div>
        </div>
        {error && <p className="error" role="alert">{error}</p>}

        <h2 className="sectiontitle">To send</h2>
        {queue === undefined ? <TableSkeleton cols={6} rows={3} wide={1} /> : (
          <div className="table-wrap"><div className="scroller">
            <table className="ledger">
              <thead><tr><th className="w-no">Vch</th><th>Party</th><th className="num">Amount</th><th>Saved</th><th>Waiting</th><th className="w-acts" /></tr></thead>
              <tbody>
                {queue.waiting.map((w) => (
                  <tr key={w.voucherId} className={w.held ? 'unpriced' : undefined}>
                    <td className="mono entryno" data-label="Vch"><Link className="link plain" to={`/bills/voucher/${w.voucherId}`} title={`Open ${w.label}`}>{w.label}</Link></td>
                    <td className="particulars" data-label="Party"><Link className="link plain" to={`/ledger/customers/${w.partyLedgerId}`} title={`Open ${w.name}'s ledger`}>{w.name}</Link><div className="ref">{w.needsRecipient ? 'Ask for WhatsApp number when sending' : w.phone || 'No phone'}</div></td>
                    <td className="num" data-label="Amount">{rupees(w.amount)}</td>
                    <td className="ref" data-label="Saved">{when(w.savedAt)}</td>
                    <td data-label="Waiting">
                      {w.held ? <span className="warn">{w.held}</span>
                        : w.requested ? (open ? <span className="credit">Sending now</span> : <span className="warn">Goes at 9 am</span>)
                        : w.tries ? <span className="warn">Trying again ({w.tries} of 3): {w.lastError}</span>
                        : !queue.on ? 'Sending is off'
                        : !linked ? 'WhatsApp not linked'
                        : !open ? 'Goes at 9 am'
                        : 'Next to go'}
                    </td>
                    <td className="rowacts">
                      <button className="xbtn" title="See the bill" aria-label={`See ${w.label}`}
                        onClick={() => setSeeing({ voucherId: w.voucherId, label: w.label, name: w.name, amount: w.amount, needsRecipient: w.needsRecipient, canSend: !w.held && !w.requested && linked })}>
                        <Eye size={14} aria-hidden="true" />
                      </button>
                      <button className="xbtn" title={w.requested ? 'This bill is being sent' : 'Send this bill now'} aria-label={`Send ${w.label} now`}
                        disabled={!!w.held || !!w.requested || !linked}
                        onClick={() => setSendingNow({ voucherId: w.voucherId, label: w.label, name: w.name, needsRecipient: w.needsRecipient })}>
                        <Send size={14} aria-hidden="true" />
                      </button>
                      <button className="xbtn" title="Mark as already sent" aria-label={`Mark ${w.label} as already sent`}
                        disabled={!!w.held || !!w.requested}
                        onClick={() => setMarkingSent({ voucherId: w.voucherId, label: w.label, name: w.name })}>
                        <Check size={14} aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                ))}
                {queue.waiting.length === 0 && <tr><td colSpan={6} className="particulars">Nothing waiting.</td></tr>}
              </tbody>
            </table>
          </div></div>
        )}

        <Quotations linked={linked} open={open} onError={setError} />

        <OlderBills linked={linked} onSee={setSeeing} onSend={setSendingNow} />

        <h2 className="sectiontitle">Lately</h2>
        {queue && (
          <div className="table-wrap"><div className="scroller">
            <table className="ledger">
              <thead><tr><th className="w-no">Vch</th><th>Party</th><th className="num">Amount</th><th>When</th><th>What happened</th><th className="w-acts" /></tr></thead>
              <tbody>
                {queue.recent.map((r) => (
                  <tr key={r.voucherId} className={r.status === 'sent' ? undefined : 'unposted'}>
                    <td className="mono entryno" data-label="Vch">{r.label}</td>
                    <td className="particulars" data-label="Party">{r.name || '—'}</td>
                    <td className="num" data-label="Amount">{rupees(r.amount)}</td>
                    <td className="ref" data-label="When">{when(r.at)}</td>
                    <td data-label="What happened">
                      {r.status === 'sent' ? <span className="credit">{r.markedSent ? 'Marked sent' : 'Sent'}</span> : <span className="warn">{STATUS[r.status]}{r.reason ? `: ${r.reason}` : ''}</span>}
                    </td>
                    <td className="rowacts">
                      <button className="xbtn" title="Send again" aria-label={`Send ${r.label} again`} onClick={() => setAgain({ voucherId: r.voucherId, label: r.label, name: r.name })}>
                        <RotateCcw size={14} aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                ))}
                {queue.recent.length === 0 && <tr><td colSpan={6} className="particulars">Nothing sent yet.</td></tr>}
              </tbody>
            </table>
          </div></div>
        )}

        {again && (
          <Confirm
            title={`Send ${again.label} again?`}
            body={`It goes to ${again.name || 'the customer'}'s WhatsApp once more: the pages, then the note.`}
            confirmLabel="Send again"
            onClose={() => setAgain(null)}
            onConfirm={async () => {
              const { voucherId } = again
              setAgain(null)
              try { await sendAgain({ voucherId }) } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
            }}
          />
        )}
        {seeing && (
          <SeeBill
            row={seeing}
            onClose={() => setSeeing(null)}
            onSend={() => {
              const { voucherId, label, name, needsRecipient } = seeing
              setSeeing(null)
              setSendingNow({ voucherId, label, name, needsRecipient })
            }}
          />
        )}
        {sendingNow && (
          <Confirm
            title={`Send ${sendingNow.label} ${open ? 'now' : 'at 9 am'}?`}
            body={sendingNow.sentAt
              ? `It was already sent on ${when(sendingNow.sentAt)}. It will go to ${sendingNow.name || 'the customer'}'s WhatsApp again ${open ? 'now' : 'at 9 am'}.`
              : `It will go to ${sendingNow.name || 'the customer'}'s WhatsApp ${open ? 'now' : 'at 9 am'}. Automatic sending stays off.`}
            confirmLabel={open ? 'Send now' : 'Send at 9 am'}
            ask={sendingNow.needsRecipient ? { label: 'Customer WhatsApp number' } : undefined}
            toggle={{ label: 'New number: send the smile, folded hands and card first' }}
            onClose={() => setSendingNow(null)}
            onConfirm={async (phone, newNumber) => {
              const { voucherId } = sendingNow
              setSendingNow(null)
              try { await requestNow({ voucherId, ...(phone.trim() ? { phone } : {}), ...(newNumber ? { newNumber } : {}) }) } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
            }}
          />
        )}
        {markingSent && (
          <Confirm
            title={`Mark ${markingSent.label} as already sent?`}
            body={`This removes it from the queue and records that it was shared with ${markingSent.name || 'the customer'} outside this sender.`}
            confirmLabel="Mark sent"
            onClose={() => setMarkingSent(null)}
            onConfirm={async () => {
              const { voucherId } = markingSent
              setMarkingSent(null)
              try { await markSent({ voucherId }) } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
            }}
          />
        )}
        {switching && queue && (
          <Confirm
            title={queue.on ? 'Switch off WhatsApp bills?' : 'Switch on WhatsApp bills?'}
            body={queue.on
              ? 'No more bills go until it is switched on again.'
              : 'Each sale saved from now on goes to the customer’s WhatsApp.'}
            confirmLabel={queue.on ? 'Switch off' : 'Switch on'}
            onClose={() => setSwitching(false)}
            onConfirm={async () => {
              setSwitching(false)
              try { await setOn({ on: !queue.on }) } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
            }}
          />
        )}
      </div>
    </div>
  )
}
