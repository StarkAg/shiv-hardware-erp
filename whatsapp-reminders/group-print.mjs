/**
 * WhatsApp group printing, from Railway.
 *
 * The shop's group prints again (owner's ask, 25 Nov 2026), now without the
 * shop PC holding a WhatsApp link: this service (the Shop number, always on)
 * reads the group, and each print goes into the cloud print queue addressed to
 * the shop PC's print server, which watches the queue live and prints at once.
 *
 *   a photo or PDF with "bw" / "cp" in its caption    prints now
 *   a photo or PDF without one                         waits up to 10 minutes for
 *                                                      "bw" / "cp" from the same person
 *   "bw" / "cp" sent as a reply to a photo or PDF      prints that file
 *
 * bw (also "b/w", "black") goes to the HP; cp (also "color", "colour") to the
 * Epson; each falls back to the other on the print server, as before.
 *
 * Environment (Railway variables):
 *   CONVEX_URL           the production deployment (https://sensible-panther-176.convex.cloud)
 *   SHIV_DEVICE_TOKEN    a server key: npx convex run --prod devices:issueServerKey '{"name":"whatsapp-print"}'
 *   PRINT_GROUP_ID       the group to print from (defaults to SHOP_GROUP_ID)
 *   PRINTER_ID           the print server's agent id (shiv-shop-printer)
 *   PRINT_COMMAND_TTL_MS how long a file waits for its bw / cp (10 minutes)
 */
import { readFile, writeFile } from 'node:fs/promises'

const PRINTABLE = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'])
const EXTENSION = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'application/pdf': '.pdf' }
const MAX_FILES_PER_JOB = 20

/** "bw" / "cp" (and their longer spellings) in a caption or message, else null. */
export function printModeOf(text) {
  const clean = String(text ?? '').trim().toLowerCase()
  if (!clean) return null
  if (/\bcp\b/.test(clean) || /\bcolou?r\b/.test(clean)) return 'color'
  if (/\bbw\b/.test(clean) || /\bb\/w\b/.test(clean) || /\bblack\b/.test(clean)) return 'bw'
  return null
}

/** The message inside WhatsApp's wrappers (disappearing, view once, document with caption, edits). */
function contentOf(message) {
  let m = message
  for (let i = 0; i < 6 && m; i += 1) {
    const inner = m.ephemeralMessage?.message
      ?? m.viewOnceMessage?.message
      ?? m.viewOnceMessageV2?.message
      ?? m.viewOnceMessageV2Extension?.message
      ?? m.documentWithCaptionMessage?.message
      ?? m.editedMessage?.message
    if (!inner) break
    m = inner
  }
  return m ?? null
}

/** The printable file a message carries: { kind, mediaType, fileName, caption }, or null. */
export function mediaOf(content) {
  if (!content) return null
  if (content.imageMessage) {
    const mediaType = String(content.imageMessage.mimetype || 'image/jpeg').split(';')[0].trim()
    return { kind: 'imageMessage', mediaType, fileName: null, caption: content.imageMessage.caption ?? '' }
  }
  if (content.documentMessage) {
    const mediaType = String(content.documentMessage.mimetype || '').split(';')[0].trim()
    return { kind: 'documentMessage', mediaType, fileName: content.documentMessage.fileName ?? null, caption: content.documentMessage.caption ?? '' }
  }
  return null
}

const textOf = (content) => content?.conversation ?? content?.extendedTextMessage?.text ?? ''

/** Files waiting for their bw / cp, per sender in the group. */
export function createPendingFiles(ttlMs, now = () => Date.now()) {
  const pending = new Map()
  return {
    add(sender, file) {
      const list = (pending.get(sender) ?? []).filter((e) => now() - e.at <= ttlMs)
      list.push({ file, at: now() })
      pending.set(sender, list)
    },
    take(sender) {
      const list = pending.get(sender) ?? []
      pending.delete(sender)
      return list.filter((e) => now() - e.at <= ttlMs).map((e) => e.file)
    },
    size: () => [...pending.values()].reduce((n, list) => n + list.length, 0),
  }
}

/** Calls a Convex function over its HTTP API, as the server key's device. */
async function convexCall(convexUrl, token, kind, path, args) {
  const res = await fetch(`${convexUrl}/api/${kind}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ path, args, format: 'json' }),
  })
  const json = await res.json().catch(() => null)
  if (!res.ok || json?.status !== 'success') {
    throw new Error(`Convex ${path}: ${json?.errorMessage ?? json?.message ?? `HTTP ${res.status}`}`)
  }
  return json.value
}

export function createGroupPrinter({ env = process.env, dataDir, log, silent }) {
  const convexUrl = String(env.CONVEX_URL || '').replace(/\/+$/, '')
  const token = env.SHIV_DEVICE_TOKEN || ''
  const groupId = env.PRINT_GROUP_ID || env.SHOP_GROUP_ID || ''
  const printerId = env.PRINTER_ID || 'shiv-shop-printer'
  const ttlMs = Math.max(10_000, Number(env.PRINT_COMMAND_TTL_MS) || 10 * 60_000)
  const seenFile = `${dataDir}/print-seen.json`

  const missing = [!convexUrl && 'CONVEX_URL', !token && 'SHIV_DEVICE_TOKEN', !groupId && 'PRINT_GROUP_ID'].filter(Boolean)
  const state = {
    enabled: missing.length === 0,
    groupId: groupId || null,
    printerId,
    missing,
    waiting: 0,
    lastQueued: null,
    lastError: null,
  }
  const pending = createPendingFiles(ttlMs)

  // Message ids already handled, so a catch-up after a reconnect never prints twice.
  let seen = null
  async function seenIds() {
    if (!seen) {
      try { seen = new Set(JSON.parse(await readFile(seenFile, 'utf8'))) } catch { seen = new Set() }
    }
    return seen
  }
  async function markSeen(id) {
    const ids = await seenIds()
    if (ids.has(id)) return false
    ids.add(id)
    if (ids.size > 1000) seen = new Set([...ids].slice(-500))
    await writeFile(seenFile, JSON.stringify([...seen])).catch(() => {})
    return true
  }

  async function download(sock, downloadMediaMessage, key, content, media) {
    const buffer = await downloadMediaMessage(
      { key, message: content }, 'buffer', {}, { reuploadRequest: sock.updateMediaMessage, logger: silent },
    )
    if (!buffer?.length) throw new Error('the file came down empty')
    const name = media.fileName || `whatsapp-${Date.now()}${EXTENSION[media.mediaType] ?? ''}`
    return { name, mediaType: media.mediaType, buffer }
  }

  /** Uploads the files and queues one print job for the shop PC. */
  async function queue(files, mode, sender) {
    // All files up at once, in their order.
    const stored = await Promise.all(files.slice(0, MAX_FILES_PER_JOB).map(async (file) => {
      const uploadUrl = await convexCall(convexUrl, token, 'mutation', 'files:generateUploadUrl', {})
      const res = await fetch(uploadUrl, { method: 'POST', headers: { 'Content-Type': file.mediaType }, body: file.buffer })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.storageId) throw new Error(`upload of ${file.name} failed (HTTP ${res.status})`)
      return { storageId: json.storageId, name: file.name, mediaType: file.mediaType }
    }))
    const id = await convexCall(convexUrl, token, 'mutation', 'printJobs:create', {
      kind: 'raw-file',
      source: 'whatsapp',
      payload: { files: stored, mode },
      copies: 1,
      requestedBy: `WhatsApp group (${String(sender).split('@')[0]})`,
      // Addressed to the print server, so the Counter app does not hold it back.
      assignedPrinterId: printerId,
    })
    state.lastQueued = { at: new Date().toISOString(), id, mode, files: stored.map((f) => f.name) }
    state.lastError = null
    log(`[print] queued ${stored.length} file(s) ${mode} as ${id}`)
    return id
  }

  /** One group message: a file to print or keep, or a bw / cp to act on. */
  async function handle(sock, downloadMediaMessage, msg, type) {
    if (!state.enabled) return
    const jid = msg.key?.remoteJid || ''
    if (jid !== groupId) return
    // An undecrypted stub comes again with the same id; leave its id unseen.
    if (!msg.message) return
    // After a reconnect, only what was sent within the bw / cp window counts.
    if (type === 'append' && Date.now() - Number(msg.messageTimestamp ?? 0) * 1000 > ttlMs) return
    if (!(await markSeen(msg.key.id))) return

    // The Shop phone's own sends are the group's too (fromMe), so they count.
    const sender = msg.key.participant || msg.key.participantAlt || jid
    const content = contentOf(msg.message)
    const media = mediaOf(content)

    try {
      if (media) {
        if (!PRINTABLE.has(media.mediaType)) return
        const file = await download(sock, downloadMediaMessage, msg.key, content, media)
        const mode = printModeOf(media.caption)
        if (mode) await queue([file], mode, sender)
        else {
          pending.add(sender, file)
          log(`[print] ${file.name} waiting for bw / cp`)
        }
        return
      }

      const mode = printModeOf(textOf(content))
      if (!mode) return
      // "bw" / "cp" as a reply to a photo or PDF prints that file.
      const quotedInfo = content?.extendedTextMessage?.contextInfo
      const quoted = contentOf(quotedInfo?.quotedMessage)
      const quotedMedia = mediaOf(quoted)
      if (quotedMedia && PRINTABLE.has(quotedMedia.mediaType)) {
        const key = { remoteJid: jid, id: quotedInfo.stanzaId, participant: quotedInfo.participant }
        const file = await download(sock, downloadMediaMessage, key, quoted, quotedMedia)
        await queue([file], mode, sender)
        return
      }
      const files = pending.take(sender)
      if (files.length) await queue(files, mode, sender)
    } catch (err) {
      state.lastError = { at: new Date().toISOString(), error: String(err?.message ?? err) }
      log('[print] failed:', err?.message ?? err)
    } finally {
      state.waiting = pending.size()
    }
  }

  if (state.enabled) log(`[print] group printing on: ${groupId} -> ${printerId}`)
  else log(`[print] group printing off, missing ${missing.join(', ')}`)

  return { handle, state }
}
