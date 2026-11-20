/**
 * The customer's screen: the second display of the counter POS, facing the
 * customer, showing the bill as it is typed.
 *
 * The bill form (BillBuilder) says what is on it; the customer screen
 * (features/customer/CustomerScreen, at #/customer) shows it. Three ways
 * across, all carrying the same message, so it works wherever it is opened:
 *
 *   - the desktop app: through Electron, which opens the customer window on
 *     the second monitor by itself (electron/main.cjs);
 *   - two windows of one browser (the demo on any PC, a tablet beside the
 *     till on the same machine): a BroadcastChannel;
 *   - a customer window opened after the bill was started: the last message,
 *     kept in localStorage.
 *
 * Nothing is sent to a server. The screen only shows what this PC's bill
 * form tells it.
 */
import type { BillItem } from './types'
import { anyApi } from 'convex/server'
import { inPosApp } from './posApp'

export type CustomerLine = {
  id: string
  description: string
  qty: number
  unit: string
  /** Per piece, when the line has one. */
  rate?: number
  amount: number
  /** Discount, GST, round-off: worked out, shown in the foot of the bill. */
  worked?: boolean
}

export type CustomerScreenState =
  | { mode: 'idle' }
  | { mode: 'bill'; number: string; customerName: string; lines: CustomerLine[]; total: number; paid: number; quotation: boolean }
  | { mode: 'thanks'; total: number; customerName: string }

const CHANNEL = 'shiv-customer-screen'
const KEPT = 'shiv-customer-screen:last'

let channel: BroadcastChannel | null = null
const open = () => {
  if (channel || typeof BroadcastChannel === 'undefined') return channel
  try { channel = new BroadcastChannel(CHANNEL) } catch { channel = null }
  return channel
}

let lastSent = ''

/** Puts `state` on the customer's screen. Sending the same thing twice is free. */
export function showOnCustomerScreen(state: CustomerScreenState) {
  const json = JSON.stringify(state)
  if (json === lastSent) return
  lastSent = json
  try { localStorage.setItem(KEPT, json) } catch { /* private window */ }
  try { open()?.postMessage(state) } catch { /* closed */ }
  try { window.shivDesktop?.customerScreen?.send(state) } catch { /* old shell */ }
  // The phone POS has no screen of its own facing the customer: it sends the
  // bill through the cloud to the counter's (convex/customerScreen.ts).
  if (inPosApp) toCloud(state)
}

/** How long a bill put in the cloud by the phone is still worth showing. */
export const PHONE_FRESH_MS = 10 * 60_000

let cloudNext: CustomerScreenState | null = null
let cloudBusy = false

/**
 * One call at a time, always the newest state: a fast typist's keystrokes
 * collapse into whatever is on the form when the last call answers, and an
 * older line can never land after a newer one.
 */
function toCloud(state: CustomerScreenState) {
  cloudNext = state
  if (cloudBusy) return
  cloudBusy = true
  void (async () => {
    try {
      const { convexHttp, withTimeout } = await import('./convexSync')
      while (cloudNext) {
        const sending = cloudNext
        cloudNext = null
        const client = convexHttp()
        if (!client) break
        try {
          await withTimeout(client.mutation(anyApi.customerScreen.show, { state: sending, from: 'phone' }), 8000)
        } catch { /* no signal: the next change tries again */ }
      }
    } finally {
      cloudBusy = false
    }
  })()
}

/** What the customer screen should show right now, from wherever it comes. */
export function onCustomerScreen(show: (state: CustomerScreenState) => void): () => void {
  try {
    const kept = localStorage.getItem(KEPT)
    if (kept) show(JSON.parse(kept))
  } catch { /* nothing kept */ }
  const ch = open()
  const fromChannel = (e: MessageEvent) => show(e.data as CustomerScreenState)
  ch?.addEventListener('message', fromChannel)
  const fromStorage = (e: StorageEvent) => {
    if (e.key === KEPT && e.newValue) {
      try { show(JSON.parse(e.newValue)) } catch { /* torn write */ }
    }
  }
  window.addEventListener('storage', fromStorage)
  const stopDesktop = window.shivDesktop?.customerScreen?.onState((s) => show(s as CustomerScreenState))
  return () => {
    ch?.removeEventListener('message', fromChannel)
    window.removeEventListener('storage', fromStorage)
    stopDesktop?.()
  }
}

/** A bill form's lines as the customer reads them. Empty lines are left out. */
export function customerLines(items: BillItem[]): CustomerLine[] {
  return items
    .filter((i) => (i.description ?? '').trim() || Number(i.amount))
    .map((i) => {
      const qty = Number(i.qty) || 0
      const amount = Number(i.amount) || 0
      const worked = Boolean(i.auto || i.isRoundup || i.isDiscount)
      const rate = !worked && !i.amountOnly && qty > 0 && amount ? Math.round((amount / qty) * 100) / 100 : undefined
      return {
        id: i.id,
        description: i.isRoundup || i.isDiscount ? (i.description || 'Roundup') : i.description,
        qty: worked || i.amountOnly ? 0 : qty,
        unit: i.unit ?? '',
        rate,
        amount,
        worked,
      }
    })
}
