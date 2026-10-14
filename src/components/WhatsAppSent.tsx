import { CheckCheck } from 'lucide-react'

/**
 * The mark on a sale that has gone to the customer's WhatsApp chat
 * (convex/billWhatsApp.ts), with when on hover: in the day book and the
 * party's ledger, beside the voucher number.
 */
export function WhatsAppSent({ at }: { at: number }) {
  const when = new Date(at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
  return (
    <span className="wa-sent" title={`Sent on WhatsApp, ${when}`} aria-label={`Sent on WhatsApp, ${when}`}>
      <CheckCheck size={13} strokeWidth={2.6} aria-hidden="true" />
    </span>
  )
}
