import { useEffect, useState } from 'react'
import { RotateCcw, Send } from 'lucide-react'
import { useMutation } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { useLive } from '../ledger/lib/cache'
import { useLedgerTheme } from '../ledger/useLedgerTheme'
import Confirm from '../ledger/components/Confirm'
import { TableSkeleton } from '../ledger/components/Skeleton'
import '../ledger/ledger.css'

/** The Railway service holding the owner's WhatsApp link (whatsapp-bills/). */
const SERVICE = 'https://whatsapp-bills-production.up.railway.app'

const when = (ms: number) => new Date(ms).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
const rupees = (n: number | null) => (n == null ? '—' : `₹${Math.round(n).toLocaleString('en-IN')}`)
const STATUS: Record<string, string> = { sent: 'Sent', skipped: 'Not sent', failed: 'Failed' }

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
  const [again, setAgain] = useState<{ voucherId: Id<'vouchers'>; label: string; name: string } | null>(null)
  const [sendingNow, setSendingNow] = useState<{ voucherId: Id<'vouchers'>; label: string; name: string } | null>(null)
  const [switching, setSwitching] = useState(false)
  const [error, setError] = useState('')

  const linked = link?.status === 'ready'
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
                    <td className="mono entryno" data-label="Vch">{w.label}</td>
                    <td className="particulars" data-label="Party">{w.name}<div className="ref">{w.phone || 'No phone'}</div></td>
                    <td className="num" data-label="Amount">{rupees(w.amount)}</td>
                    <td className="ref" data-label="Saved">{when(w.savedAt)}</td>
                    <td data-label="Waiting">
                      {w.held ? <span className="warn">{w.held}</span>
                        : w.requested ? <span className="credit">Sending now</span>
                        : w.tries ? <span className="warn">Trying again ({w.tries} of 3): {w.lastError}</span>
                        : !queue.on ? 'Sending is off'
                        : !linked ? 'WhatsApp not linked'
                        : 'Next to go'}
                    </td>
                    <td className="rowacts">
                      <button className="xbtn" title={w.requested ? 'This bill is being sent' : 'Send this bill now'} aria-label={`Send ${w.label} now`}
                        disabled={!!w.held || !!w.requested || !linked}
                        onClick={() => setSendingNow({ voucherId: w.voucherId, label: w.label, name: w.name })}>
                        <Send size={14} aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                ))}
                {queue.waiting.length === 0 && <tr><td colSpan={6} className="particulars">Nothing waiting.</td></tr>}
              </tbody>
            </table>
          </div></div>
        )}

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
                      {r.status === 'sent' ? <span className="credit">Sent</span> : <span className="warn">{STATUS[r.status]}{r.reason ? `: ${r.reason}` : ''}</span>}
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
        {sendingNow && (
          <Confirm
            title={`Send ${sendingNow.label} now?`}
            body={`It will go to ${sendingNow.name || 'the customer'}'s WhatsApp now. Automatic sending stays off.`}
            confirmLabel="Send now"
            onClose={() => setSendingNow(null)}
            onConfirm={async () => {
              const { voucherId } = sendingNow
              setSendingNow(null)
              try { await requestNow({ voucherId }) } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
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
