import { existsSync, mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
// @ts-expect-error plain ESM module without types
import { keepSentMessages, memoryCache, useSqliteAuthState } from '../whatsapp-reminders/auth-store.mjs'

// The same Baileys the services run (7.0.0-rc14), from the print server's install.
const baileys = await import('../print-server/node_modules/@whiskeysockets/baileys/lib/index.js')
const quiet = () => {}

describe('WhatsApp login in SQLite', () => {
  it('takes over an old file login without a new scan, and keeps it across a restart', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'auth-'))
    // The login as the services hold it today: a folder of JSON files.
    const old = await baileys.useMultiFileAuthState(dir)
    old.state.creds.me = { id: '917970550954:12@s.whatsapp.net', name: 'Shop' }
    old.state.creds.registered = true
    await old.saveCreds()
    await old.state.keys.set({
      session: { '917970550954.0': Buffer.from('session-bytes') },
      'pre-key': { 7: { public: Buffer.from('pub'), private: Buffer.from('priv') } },
      'app-state-sync-key': { AAAA: baileys.proto.Message.AppStateSyncKeyData.fromObject({ keyData: Buffer.from('k'), timestamp: 5 }) },
    })

    const a = await useSqliteAuthState(dir, baileys, quiet)
    expect(a.store).toBe('sqlite')
    expect(a.state.creds.me.id).toBe('917970550954:12@s.whatsapp.net')
    expect(a.state.creds.registered).toBe(true)
    // Keys come from the old files the first time, and are copied in.
    const s = await a.state.keys.get('session', ['917970550954.0', 'nobody.0'])
    expect(Buffer.from(s['917970550954.0']).toString()).toBe('session-bytes')
    expect(s['nobody.0']).toBeUndefined()
    const ask = await a.state.keys.get('app-state-sync-key', ['AAAA'])
    expect(Buffer.from(ask.AAAA.keyData).toString()).toBe('k')

    // A used pre-key deleted here goes from the old files too: it cannot come back.
    await a.state.keys.set({ 'pre-key': { 7: null }, session: { 'new.0': Buffer.from('fresh') } })
    expect((await a.state.keys.get('pre-key', ['7']))['7']).toBeUndefined()
    expect(readdirSync(dir).some((f) => f.startsWith('pre-key-7'))).toBe(false)

    // Creds change, are saved, and a "restart" reads them back from the database.
    a.state.creds.me.name = 'Shiv Hardware'
    await a.saveCreds()
    a.close()
    const b = await useSqliteAuthState(dir, baileys, quiet)
    expect(b.state.creds.me.name).toBe('Shiv Hardware')
    expect(Buffer.from((await b.state.keys.get('session', ['new.0']))['new.0']).toString()).toBe('fresh')
    b.close()
    expect(existsSync(join(dir, 'session.db'))).toBe(true)
  })

  it('starts a fresh login in an empty folder (after a logout put the old one aside)', async () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'auth-')), 'auth')
    const a = await useSqliteAuthState(dir, baileys, quiet)
    expect(a.state.creds.registered).toBe(false)
    expect(a.state.creds.noiseKey?.private).toBeTruthy()
    await a.saveCreds()
    a.close()
    const b = await useSqliteAuthState(dir, baileys, quiet)
    // The same freshly made identity, not a new one each start.
    expect(Buffer.from(b.state.creds.noiseKey.public).equals(Buffer.from(a.state.creds.noiseKey.public))).toBe(true)
    b.close()
  })
})

describe('resend support', () => {
  it('keeps what was sent, for WhatsApp to ask again', async () => {
    const store = new Map()
    const sock = { sendMessage: async (jid: string, content: unknown) => ({ key: { id: `id-${jid}` }, message: { conversation: String((content as { text: string }).text) } }) }
    keepSentMessages(sock, store, 2)
    await sock.sendMessage('a', { text: 'one' })
    await sock.sendMessage('b', { text: 'two' })
    await sock.sendMessage('c', { text: 'three' })
    expect([...store.keys()]).toEqual(['id-b', 'id-c'])
    expect(store.get('id-c')).toEqual({ conversation: 'three' })
  })

  it('counts retries in a cache that forgets', () => {
    const cache = memoryCache(1000)
    cache.set('m1', 2)
    expect(cache.get('m1')).toBe(2)
    cache.del('m1')
    expect(cache.get('m1')).toBeUndefined()
  })
})
