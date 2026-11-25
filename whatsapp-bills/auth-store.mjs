/**
 * The WhatsApp login kept in one SQLite database instead of a folder of JSON
 * files (owner's ask, 25 Nov 2026, following baileys.wiki "Save and restore
 * WhatsApp sessions": useMultiFileAuthState is "not recommended for deployment
 * in production"). Every save is one transaction, so a crash or a redeploy in
 * the middle of one can never leave a half-written login behind.
 *
 * The same file is in whatsapp-reminders/ and whatsapp-bills/: keep both alike.
 *
 * Moving over needs no new scan. The database sits inside the old login
 * folder (AUTH_DIR/session.db). While a value is not in it yet, it is read
 * from the old files and copied in; a key deleted here is deleted there too,
 * so an old file never brings a used key back. Putting the folder aside, as a
 * logout does, takes the database with it.
 *
 * Node's own SQLite (node:sqlite, Node 22.13 and later) is used, so there is
 * nothing to install. If it cannot be opened, the old file store is used
 * instead and the service says so, rather than going down.
 */
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

export async function useSqliteAuthState(authDir, baileys, log = console.log) {
  const { initAuthCreds, BufferJSON, proto, useMultiFileAuthState } = baileys
  mkdirSync(authDir, { recursive: true })

  let DatabaseSync
  try {
    ({ DatabaseSync } = await import('node:sqlite'))
  } catch (err) {
    log(`[auth] SQLite not available (${err?.message ?? err}); keeping the login in files`)
    return { ...(await useMultiFileAuthState(authDir)), store: 'files' }
  }

  const db = new DatabaseSync(join(authDir, 'session.db'))
  db.exec(`PRAGMA journal_mode = WAL;
    PRAGMA synchronous = FULL;
    CREATE TABLE IF NOT EXISTS auth (type TEXT NOT NULL, id TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (type, id));`)
  const getRow = db.prepare('SELECT value FROM auth WHERE type = ? AND id = ?')
  const putRow = db.prepare('INSERT INTO auth (type, id, value) VALUES (?, ?, ?) ON CONFLICT (type, id) DO UPDATE SET value = excluded.value')
  const delRow = db.prepare('DELETE FROM auth WHERE type = ? AND id = ?')
  const read = (type, id) => {
    const row = getRow.get(type, id)
    return row ? JSON.parse(row.value, BufferJSON.reviver) : undefined
  }
  const write = (type, id, value) => putRow.run(type, id, JSON.stringify(value, BufferJSON.replacer))
  const inTransaction = (fn) => {
    db.exec('BEGIN IMMEDIATE')
    try {
      fn()
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  }

  // The old file store, only where it really holds a login.
  const legacy = existsSync(join(authDir, 'creds.json')) ? await useMultiFileAuthState(authDir) : null

  let creds = read('creds', 'creds')
  if (!creds && legacy) {
    creds = legacy.state.creds
    write('creds', 'creds', creds)
    log('[auth] login copied from the old files into session.db')
  }
  if (!creds) creds = initAuthCreds()

  const keys = {
    async get(type, ids) {
      const data = {}
      const missing = []
      for (const id of ids) {
        let value = read(type, id)
        if (value === undefined) { missing.push(id); continue }
        if (type === 'app-state-sync-key' && value) value = proto.Message.AppStateSyncKeyData.fromObject(value)
        data[id] = value
      }
      if (missing.length && legacy) {
        const old = await legacy.state.keys.get(type, missing)
        const found = missing.filter((id) => old[id] != null)
        if (found.length) inTransaction(() => { for (const id of found) write(type, id, old[id]) })
        for (const id of found) data[id] = old[id]
      }
      return data
    },
    async set(data) {
      const gone = {}
      inTransaction(() => {
        for (const type of Object.keys(data)) {
          for (const [id, value] of Object.entries(data[type] ?? {})) {
            if (value) write(type, id, value)
            else {
              delRow.run(type, id)
              ;(gone[type] ??= {})[id] = null
            }
          }
        }
      })
      // A key deleted here goes from the old files too, so it cannot come back.
      if (legacy && Object.keys(gone).length) await legacy.state.keys.set(gone).catch(() => {})
    },
  }

  return {
    state: { creds, keys },
    saveCreds: async () => { write('creds', 'creds', creds) },
    close: () => { try { db.close() } catch { /* closed */ } },
    store: 'sqlite',
  }
}

/**
 * A small in-memory cache with the shape Baileys asks for (CacheStore), for
 * msgRetryCounterCache, so a message WhatsApp asks to have re-sent is retried
 * a bounded number of times (baileys.wiki, Troubleshooting).
 */
export function memoryCache(ttlMs = 10 * 60_000, max = 2000) {
  const map = new Map()
  return {
    get(key) {
      const e = map.get(key)
      if (!e) return undefined
      if (Date.now() > e.until) { map.delete(key); return undefined }
      return e.value
    },
    set(key, value) {
      map.set(key, { value, until: Date.now() + ttlMs })
      if (map.size > max) map.delete(map.keys().next().value)
    },
    del(key) { map.delete(key) },
    flushAll() { map.clear() },
  }
}

/**
 * Messages this device sent, kept so WhatsApp's retry asks can be answered
 * (getMessage); without them the other side sees "this message can take a
 * while" (baileys.wiki, Troubleshooting). The socket's sendMessage is wrapped,
 * so every send is kept without touching the code that sends.
 */
export function keepSentMessages(sock, store, max = 500) {
  const send = sock.sendMessage.bind(sock)
  sock.sendMessage = async (...args) => {
    const sent = await send(...args)
    if (sent?.key?.id && sent.message) {
      store.set(sent.key.id, sent.message)
      if (store.size > max) store.delete(store.keys().next().value)
    }
    return sent
  }
}
