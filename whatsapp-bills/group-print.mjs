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
 *   an SBI PDF (SBIDocument_*.pdf), no caption needed  prints now, black and white
 *                                                      (PRINT_AUTO_NAMES)
 *
 *   "order" in a photo's caption, as a reply    typed out (not printed) by Claude on the shop
 *   to a photo, or after a photo by the same    PC and posted back as a reply, "<item> - <qty>"
 *   person                                      lines (print-server/order-read.mjs, 27 Nov 2026)
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
 *   PRINT_AUTO_CHATS     chats where every photo and PDF prints at once, no bw / cp:
 *                        "chat name or id=bw|color" split by ";" (see parseAutoChats)
 *
 * The same file is in whatsapp-reminders/ (the Shop number: the shop group)
 * and whatsapp-bills/ (Tony's number: the supplier chats it is in). Change
 * one, copy it to the other.
 */
import { readFile, writeFile } from 'node:fs/promises'

const PRINTABLE = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'])
const EXTENSION = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'application/pdf': '.pdf' }
const MAX_FILES_PER_JOB = 20

/**
 * Files that print as soon as they are posted, with no bw / cp, by name:
 * PRINT_AUTO_NAMES, "pattern=mode" pairs split by ";", * and ? wildcards,
 * case does not matter. Default: SBI's PDFs, black and white (owner's ask,
 * 25 Nov 2026). "off" for none.
 */
export const DEFAULT_AUTO_NAMES = 'SBIDocument_*.pdf=bw'
export function parseAutoNames(value) {
  const text = String(value ?? DEFAULT_AUTO_NAMES).trim()
  if (!text || /^(off|false|no|0)$/i.test(text)) return []
  return text.split(';').map((entry) => {
    const [pattern, mode = 'bw'] = entry.split('=').map((s) => s.trim())
    if (!pattern) return null
    const body = pattern.split('').map((c) => (c === '*' ? '.*' : c === '?' ? '.' : c.replace(/[.+^${}()|[\]\\]/g, '\\$&'))).join('')
    return { match: new RegExp(`^${body}$`, 'i'), mode: mode.toLowerCase() === 'color' ? 'color' : 'bw' }
  }).filter(Boolean)
}

/** A chat's name as compared: case, spaces and punctuation do not matter. */
export const chatKey = (name) => String(name ?? '').toLowerCase().replace(/[^a-z0-9@.]+/g, '')

/**
 * Chats where every photo and PDF prints as soon as it comes, with no bw / cp,
 * such as a supplier's chat of paper bills: "chat=mode" pairs split by ";",
 * where chat is the group's name (as WhatsApp shows it) or its id
 * (...@g.us), and mode bw or color (default bw). Add ",paper" to the mode to
 * print only photos that look like a sheet of paper (the print server checks,
 * print-server/paper-check.mjs; PDFs always print). "off" or empty for none.
 */
export function parseAutoChats(value) {
  const text = String(value ?? '').trim()
  if (!text || /^(off|false|no|0)$/i.test(text)) return []
  return text.split(';').map((entry) => {
    const at = entry.lastIndexOf('=')
    const chat = (at > 0 ? entry.slice(0, at) : entry).trim()
    const words = (at > 0 ? entry.slice(at + 1) : 'bw').toLowerCase().split(',').map((s) => s.trim())
    if (!chat) return null
    const color = words.some((w) => w === 'color' || w === 'colour' || w === 'cp')
    return { chat, key: chatKey(chat), mode: color ? 'color' : 'bw', onlyPaper: words.includes('paper') }
  }).filter(Boolean)
}

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

/** "order" in a caption or message: the photo is to be typed out (order-read.mjs). */
export const isOrderText = (text) => /\border\b/i.test(String(text ?? ''))

const textOf = (content) => content?.conversation ?? content?.extendedTextMessage?.text ?? ''

/**
 * Files waiting for their bw / cp, per sender in the group. A sender is all the
 * ids WhatsApp gives the same person (a private @lid id and the phone number):
 * one message can come with one and the next with the other, and a photo filed
 * under the first was missed by the "order" sent under the second, which then
 * typed out an older photo (27 Nov 2026).
 */
export function createPendingFiles(ttlMs, now = () => Date.now()) {
  let entries = []
  const idsOf = (sender) => (Array.isArray(sender) ? sender : [sender]).filter(Boolean)
  const fresh = () => (entries = entries.filter((e) => now() - e.at <= ttlMs))
  const mine = (sender) => {
    const ids = idsOf(sender)
    return fresh().filter((e) => e.ids.some((id) => ids.includes(id)))
  }
  return {
    add(sender, file) {
      fresh()
      entries.push({ ids: idsOf(sender), file, at: now() })
    },
    /** The files waiting, left waiting (a bw / cp may still come for them). */
    peek(sender) {
      return mine(sender).map((e) => e.file)
    },
    take(sender) {
      const list = mine(sender)
      entries = entries.filter((e) => !list.includes(e))
      return list.map((e) => e.file)
    },
    size: () => fresh().length,
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

/**
 * `shopGroup: false` reads no bw / cp group, only the auto-print chats
 * (whatsapp-bills: Tony is in the shop group too, which the Shop number prints).
 *
 * `typeOut(file, replyTo)`: reads an "order" photo here, on Railway, and posts
 * the lines (whatsapp-reminders, order-read.mjs), so it works with the shop PC
 * off. It resolves false when it cannot (no Claude token): the photo then goes
 * to the shop PC as before.
 */
export function createGroupPrinter({ env = process.env, dataDir, log, silent, shopGroup = true, typeOut = null }) {
  const convexUrl = String(env.CONVEX_URL || '').replace(/\/+$/, '')
  const token = env.SHIV_DEVICE_TOKEN || ''
  const groupId = shopGroup ? env.PRINT_GROUP_ID || env.SHOP_GROUP_ID || '' : ''
  const printerId = env.PRINTER_ID || 'shiv-shop-printer'
  const ttlMs = Math.max(10_000, Number(env.PRINT_COMMAND_TTL_MS) || 10 * 60_000)
  const autoNames = parseAutoNames(env.PRINT_AUTO_NAMES)
  const autoModeOf = (fileName) => (fileName ? autoNames.find((a) => a.match.test(fileName))?.mode ?? null : null)
  const autoChats = parseAutoChats(env.PRINT_AUTO_CHATS)
  const seenFile = `${dataDir}/print-seen.json`

  const missing = [
    !convexUrl && 'CONVEX_URL', !token && 'SHIV_DEVICE_TOKEN',
    !groupId && !autoChats.length && (shopGroup ? 'PRINT_GROUP_ID' : 'PRINT_AUTO_CHATS'),
  ].filter(Boolean)
  const state = {
    enabled: missing.length === 0,
    groupId: groupId || null,
    autoChats: autoChats.map((a) => ({ chat: a.chat, mode: a.mode, onlyPaper: a.onlyPaper, id: null })),
    printerId,
    missing,
    waiting: 0,
    lastQueued: null,
    lastError: null,
  }

  // A group's name, looked up once per group (a group renamed is looked up again after a day).
  const names = new Map()
  async function chatName(sock, jid) {
    const hit = names.get(jid)
    if (hit && Date.now() - hit.at < 24 * 3600_000) return hit.name
    let name = ''
    if (jid.endsWith('@g.us')) name = (await sock.groupMetadata(jid).catch(() => null))?.subject ?? ''
    names.set(jid, { name, at: Date.now() })
    return name
  }
  // Saved contact names (the phone's address book), as WhatsApp sends them:
  // a one-to-one chat such as a supplier's is named only there (27 Nov 2026).
  const contactNames = new Map()
  function noteContacts(list) {
    for (const c of Array.isArray(list) ? list : []) {
      const name = c?.name || c?.verifiedName || ''
      if (!name) continue
      for (const id of [c.id, c.lid, c.phoneNumber, c.jid].filter(Boolean)) contactNames.set(String(id), name)
    }
  }
  const numberOf = (id) => String(id ?? '').split('@')[0].split(':')[0]

  /** The auto-print chat this message's chat is, by id, number or name, else null. */
  async function autoChatFor(sock, jid, alt = '') {
    if (!autoChats.length || !jid) return null
    // A private-id (@lid) chat with no number sent along: ask WhatsApp's own lid -> number map.
    if (!alt && jid.endsWith('@lid')) alt = (await sock.signalRepository?.lidMapping?.getPNForLID?.(jid).catch(() => null)) || ''
    const ids = [jid, alt].filter(Boolean)
    // By id, or a one-to-one chat by its phone number ("919876543210=bw,paper").
    const byId = autoChats.find((a) => ids.some((id) => a.key === chatKey(id) || (/^\d{10,15}$/.test(a.key) && numberOf(id).endsWith(a.key))))
    if (byId) return byId
    if (!jid.endsWith('@g.us')) {
      const name = ids.map((id) => contactNames.get(id)).find(Boolean)
      const found = name ? autoChats.find((a) => a.key === chatKey(name)) ?? null : null
      if (found) {
        const shown = state.autoChats.find((a) => a.chat === found.chat)
        if (shown && shown.id !== jid) { shown.id = jid; log(`[print] auto-print chat "${found.chat}" is ${jid}`) }
      }
      return found
    }
    const key = chatKey(await chatName(sock, jid))
    const found = key ? autoChats.find((a) => a.key === key) ?? null : null
    if (found) {
      const shown = state.autoChats.find((a) => a.chat === found.chat)
      if (shown && shown.id !== jid) {
        shown.id = jid
        log(`[print] auto-print chat "${found.chat}" is ${jid}`)
      }
    }
    return found
  }
  const pending = createPendingFiles(ttlMs)
  // An "order" that came before its photo had downloaded, per sender (2 minutes).
  const orderAsked = createPendingFiles(2 * 60_000)

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
  async function queue(files, mode, sender, from = 'WhatsApp group', extra = {}) {
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
      payload: { files: stored, mode, ...extra },
      copies: 1,
      requestedBy: `${from} (${String(sender).split('@')[0]})`,
      // Addressed to the print server, so the Counter app does not hold it back.
      assignedPrinterId: printerId,
    })
    state.lastQueued = { at: new Date().toISOString(), id, mode, files: stored.map((f) => f.name) }
    state.lastError = null
    log(`[print] queued ${stored.length} file(s) ${mode} as ${id}`)
    return id
  }

  /** Types out a photo here when it can, else queues it for the shop PC; either way the lines come back as a reply to it. */
  async function queueOrder(file, replyTo, sender) {
    if (typeOut && (await typeOut(file, replyTo).catch((err) => {
      log(`[print] ${file.name} could not be typed out here, to the shop PC: ${err?.message ?? err}`)
      return false
    }))) return
    await queue([file], 'bw', sender, 'WhatsApp group order', { readOrder: true, replyTo })
    log(`[print] ${file.name} queued to be typed out (order)`)
  }

  /** One group message: a file to print or keep, or a bw / cp to act on. */
  async function handle(sock, downloadMediaMessage, msg, type) {
    if (!state.enabled) return
    const jid = msg.key?.remoteJid || ''
    // An undecrypted stub comes again with the same id; leave its id unseen.
    if (!msg.message) return
    const content = contentOf(msg.message)
    const media = mediaOf(content)
    // An auto-print chat: only its photos and PDFs matter, so only those look its name up.
    const auto = jid !== groupId && media && PRINTABLE.has(media.mediaType)
      ? await autoChatFor(sock, jid, msg.key?.remoteJidAlt || '').catch(() => null)
      : null
    // A photo or PDF in a one-to-one chat that is not set to auto-print: say
    // which chat, so a supplier's can be set by its number (PRINT_AUTO_CHATS).
    if (!auto && media && PRINTABLE.has(media.mediaType) && autoChats.length && !jid.endsWith('@g.us') && jid !== groupId) {
      log(`[print] not an auto-print chat: ${jid}${msg.key?.remoteJidAlt ? ` (${msg.key.remoteJidAlt})` : ''}${contactNames.get(jid) ? ` "${contactNames.get(jid)}"` : ''}`)
    }
    if (jid !== groupId && !auto) return
    // After a reconnect, only what was sent within the bw / cp window counts.
    if (type === 'append' && Date.now() - Number(msg.messageTimestamp ?? 0) * 1000 > ttlMs) return
    if (!(await markSeen(msg.key.id))) return

    // The Shop phone's own sends are the group's too (fromMe), so they count.
    const sender = msg.key.participant || msg.key.participantAlt || jid
    // Every id this person comes under, for the files waiting (createPendingFiles).
    const senderIds = [msg.key.participant, msg.key.participantAlt].filter(Boolean)
    if (!senderIds.length) senderIds.push(jid)

    try {
      if (auto) {
        // Every photo and PDF prints at once, in the chat's mode (a bw / cp caption still wins).
        const file = await download(sock, downloadMediaMessage, msg.key, content, media)
        await queue([file], printModeOf(media.caption) ?? auto.mode, sender, `WhatsApp ${auto.chat}`, auto.onlyPaper ? { onlyPaper: true } : {})
        return
      }
      if (media) {
        if (!PRINTABLE.has(media.mediaType)) return
        const file = await download(sock, downloadMediaMessage, msg.key, content, media)
        file.replyTo = { id: msg.key.id, participant: sender }
        // "order" under a photo: typed out; printed too only if the caption also says bw / cp.
        if (isOrderText(media.caption) && media.mediaType.startsWith('image/')) {
          await queueOrder(file, file.replyTo, sender)
          const printMode = printModeOf(media.caption)
          if (printMode) await queue([file], printMode, sender)
          return
        }
        // A bw / cp in the caption wins; else a file named for printing (an SBI PDF) prints as it is.
        const mode = printModeOf(media.caption) ?? autoModeOf(media.fileName)
        if (mode) await queue([file], mode, sender)
        else if (media.mediaType.startsWith('image/') && orderAsked.take(senderIds).length) {
          // "order" got here before this photo had downloaded: it was for this photo.
          file.typedOut = Date.now()
          pending.add(senderIds, file)
          await queueOrder(file, file.replyTo, sender)
        } else {
          pending.add(senderIds, file)
          log(`[print] ${file.name} waiting for bw / cp`)
        }
        return
      }

      const text = textOf(content)
      if (isOrderText(text) && !printModeOf(text)) {
        // "order" as a reply to a photo, else after this person's last photo.
        const info = content?.extendedTextMessage?.contextInfo
        const q = contentOf(info?.quotedMessage)
        const qMedia = mediaOf(q)
        if (qMedia && qMedia.mediaType.startsWith('image/')) {
          const key = { remoteJid: jid, id: info.stanzaId, participant: info.participant }
          const file = await download(sock, downloadMediaMessage, key, q, qMedia)
          await queueOrder(file, { id: info.stanzaId, participant: info.participant || sender }, sender)
          return
        }
        // A photo already typed out is not typed out again.
        const last = pending.peek(senderIds).filter((f) => f.mediaType.startsWith('image/') && !f.typedOut).at(-1)
        if (last) {
          last.typedOut = Date.now()
          await queueOrder(last, last.replyTo, sender)
        } else if (pending.peek(senderIds).some((f) => f.typedOut && Date.now() - f.typedOut < 60_000)) {
          // A second "order" just after this person's photo was typed out: already done.
          log(`[print] "order" again from ${senderIds.join(' / ')}, its photo was just typed out`)
        } else {
          // A photo and "order" sent together can come in the other way round:
          // the next photo from this person within 2 minutes is the one.
          orderAsked.add(senderIds, true)
          log(`[print] "order" with no photo yet from ${senderIds.join(' / ')}, waiting for it`)
        }
        return
      }
      const mode = printModeOf(text)
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
      const files = pending.take(senderIds)
      if (files.length) await queue(files, mode, sender)
    } catch (err) {
      state.lastError = { at: new Date().toISOString(), error: String(err?.message ?? err) }
      log('[print] failed:', err?.message ?? err)
    } finally {
      state.waiting = pending.size()
    }
  }

  if (state.enabled) {
    if (groupId) log(`[print] group printing on: ${groupId} -> ${printerId}`)
    for (const a of autoChats) log(`[print] auto-print chat: "${a.chat}" ${a.mode}${a.onlyPaper ? " (paper slips only)" : ""} -> ${printerId}`)
  }
  else log(`[print] group printing off, missing ${missing.join(', ')}`)

  return { handle, state, noteContacts }
}
