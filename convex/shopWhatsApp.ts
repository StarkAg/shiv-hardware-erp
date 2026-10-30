import { ConvexError, v } from 'convex/values'
import { action } from './lib/guarded'

/**
 * The Shop WhatsApp (79705 50954), on Railway (whatsapp-reminders/server.mjs).
 *
 * The panel used to reach it through the print server on the shop PC, so a
 * statement could only go to a customer with the PC on. It is called from
 * here instead: only a trusted device gets this far, and the key the service
 * asks for stays in this deployment's variables, never in the panel's
 * JavaScript, which anyone can read.
 *
 * Convex variables: SHOP_WHATSAPP_URL (the service's address), SHOP_WHATSAPP_KEY
 * (its SEND_KEY).
 */
async function call(path: string, body?: unknown) {
  const base = (process.env.SHOP_WHATSAPP_URL ?? '').replace(/\/+$/, '')
  const key = process.env.SHOP_WHATSAPP_KEY ?? ''
  if (!base || !key) throw new ConvexError('The Shop WhatsApp is not set up (SHOP_WHATSAPP_URL, SHOP_WHATSAPP_KEY).')
  let res: Response
  try {
    res = await fetch(`${base}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', 'x-shop-key': key },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  } catch {
    throw new ConvexError('Cannot reach the Shop WhatsApp service.')
  }
  const json = await res.json().catch(() => null) as any
  if (!res.ok || !json?.ok) throw new ConvexError(json?.error ?? `The Shop WhatsApp answered HTTP ${res.status}.`)
  return json
}

/** The link, and the QR to scan while it needs one. */
export const status = action({
  args: {},
  handler: async () => {
    const s = await call('/status')
    return { status: String(s.status), qrDataUrl: s.qrDataUrl ?? null, readyAt: s.readyAt ?? null, lastError: s.lastError ?? null, me: s.me ?? null }
  },
})

/** A file or photo into a customer's chat, or the shop's group (`mobile: 'group'`). */
export const sendDocument = action({
  args: { mobile: v.string(), fileName: v.string(), mimetype: v.string(), data: v.string(), caption: v.optional(v.string()) },
  handler: async (_ctx, args) => {
    const r = await call('/send-document', args)
    return { jid: String(r.jid) }
  },
})

/** "Your guarantee card is ready", once per card. */
export const notifyGuarantee = action({
  args: { mobile: v.string(), name: v.optional(v.string()), number: v.optional(v.string()) },
  handler: async (_ctx, args) => {
    const r = await call('/notify-guarantee', args)
    return { ok: true as const, jid: String(r.jid), message: String(r.message ?? ''), skipped: Boolean(r.skipped) }
  },
})
