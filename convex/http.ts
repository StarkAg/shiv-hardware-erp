import { httpRouter } from 'convex/server'
import { httpAction } from './_generated/server'
import { internal } from './_generated/api'

/**
 * WhatsApp Cloud API webhook.
 *
 * Meta's send call only ever returns "accepted" — whether a message actually
 * reached the customer arrives here, minutes later, as a status callback. This
 * endpoint is also the only way to see customer replies, which matter because
 * any inbound message opens a 24-hour window in which the shop may reply in
 * free-form text instead of a paid template.
 *
 * Callback URL:  https://<deployment>.convex.site/whatsapp/webhook
 * Verify token:  WHATSAPP_VERIFY_TOKEN (Convex env var, must match the value
 *                typed into the Meta dashboard)
 */

const http = httpRouter()

/**
 * The public half of the key device tokens are signed with. Convex reads it
 * here to check a token (auth.config.ts). DEVICE_JWKS is set with the key
 * pair; see convex/deviceKeys.ts.
 */
http.route({
  path: '/.well-known/jwks.json',
  method: 'GET',
  handler: httpAction(async () => new Response(process.env.DEVICE_JWKS ?? '{"keys":[]}', {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' },
  })),
})

// Meta calls this once when you save the callback URL. It must echo back
// hub.challenge as PLAIN TEXT — returning JSON or a redirect fails the check.
http.route({
  path: '/whatsapp/webhook',
  method: 'GET',
  handler: httpAction(async (_ctx, request) => {
    const url = new URL(request.url)
    const mode = url.searchParams.get('hub.mode')
    const token = url.searchParams.get('hub.verify_token')
    const challenge = url.searchParams.get('hub.challenge') ?? ''

    if (mode === 'subscribe' && token && token === process.env.WHATSAPP_VERIFY_TOKEN) {
      return new Response(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } })
    }
    return new Response('Forbidden', { status: 403 })
  }),
})

http.route({
  path: '/whatsapp/webhook',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const body = await request.json().catch(() => null)

    // Always 200 back, even on a payload we don't understand. Meta retries any
    // non-200 with backoff and eventually disables the subscription.
    if (!body) return new Response('ok', { status: 200 })

    try {
      for (const entry of body.entry ?? []) {
        for (const change of entry.changes ?? []) {
          const value = change.value ?? {}

          for (const status of value.statuses ?? []) {
            await ctx.runMutation(internal.whatsapp.recordStatus, {
              messageId: String(status.id ?? ''),
              status: String(status.status ?? ''),
              failureReason: status.errors?.[0]?.title
                ? String(status.errors[0].title)
                : undefined,
            })
          }

          for (const message of value.messages ?? []) {
            await ctx.runMutation(internal.whatsapp.recordInbound, {
              from: String(message.from ?? ''),
              text: message.text?.body ? String(message.text.body) : undefined,
              messageId: message.id ? String(message.id) : undefined,
            })
          }
        }
      }
    } catch {
      // Swallow — a malformed entry must not cost us the subscription.
    }

    return new Response('ok', { status: 200 })
  }),
})

/**
 * Contact backups from the Contact Fixer app (convex/contactBackups.ts).
 * Both routes want `Authorization: Bearer <CONTACTS_BACKUP_KEY>`.
 */
const backupKeyOk = (request: Request) => {
  const want = process.env.CONTACTS_BACKUP_KEY
  const got = (request.headers.get('Authorization') ?? '').replace(/^Bearer /, '')
  if (!want || got.length !== want.length) return false
  let diff = 0
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ got.charCodeAt(i)
  return diff === 0
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

http.route({
  path: '/contacts-backup',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    if (!backupKeyOk(request)) return json({ error: 'Not allowed' }, 401)
    const contacts = Number(request.headers.get('X-Contacts'))
    const numbers = Number(request.headers.get('X-Numbers'))
    const blob = await request.blob()
    if (!blob.size || !Number.isFinite(contacts) || !Number.isFinite(numbers)) {
      return json({ error: 'Empty backup' }, 400)
    }
    const file = await ctx.storage.store(blob)
    const result = await ctx.runMutation(internal.contactBackups.save, {
      file,
      bytes: blob.size,
      contacts,
      numbers,
      device: request.headers.get('X-Device') ?? undefined,
    })
    return json({ ok: true, ...result })
  }),
})

http.route({
  path: '/contacts-backup/latest',
  method: 'GET',
  handler: httpAction(async (ctx, request) => {
    if (!backupKeyOk(request)) return json({ error: 'Not allowed' }, 401)
    const row = await ctx.runQuery(internal.contactBackups.latest, {})
    const blob = row && (await ctx.storage.get(row.file))
    if (!row || !blob) return json({ error: 'No backup yet' }, 404)
    return new Response(blob, {
      headers: {
        'Content-Type': 'application/gzip',
        'X-Backup-At': String(row.at),
        'X-Contacts': String(row.contacts),
      },
    })
  }),
})

export default http
