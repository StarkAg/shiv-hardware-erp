import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
// @ts-expect-error plain ESM module without types
import { createGroupPrinter, createPendingFiles, parseAutoChats, printModeOf } from '../whatsapp-reminders/group-print.mjs'

const GROUP = '120363396348781660@g.us'
const SENDER = '919999999999@s.whatsapp.net'
const silent = { level: 'silent', trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {}, child() { return silent } }

describe('printModeOf', () => {
  it('reads bw and cp the way the group always has', () => {
    expect(printModeOf('bw')).toBe('bw')
    expect(printModeOf('B/W please')).toBe('bw')
    expect(printModeOf('black')).toBe('bw')
    expect(printModeOf('cp')).toBe('color')
    expect(printModeOf('Colour 2')).toBe('color')
    expect(printModeOf('color')).toBe('color')
    expect(printModeOf('bwx')).toBeNull()
    expect(printModeOf('hello')).toBeNull()
    expect(printModeOf('')).toBeNull()
  })
})

describe('createPendingFiles', () => {
  it('drops files older than the window', () => {
    let now = 0
    const p = createPendingFiles(1000, () => now)
    p.add('a', 'old')
    now = 1500
    p.add('a', 'new')
    expect(p.take('a')).toEqual(['new'])
    expect(p.take('a')).toEqual([])
  })

  it('finds a file by any of the sender ids', () => {
    const p = createPendingFiles(1000, () => 0)
    p.add(['1@lid', '91@s.whatsapp.net'], 'photo')
    expect(p.peek(['91@s.whatsapp.net'])).toEqual(['photo'])
    expect(p.take('1@lid')).toEqual(['photo'])
    expect(p.size()).toBe(0)
  })
})

describe('group printing', () => {
  let calls: { url: string; body: any }[]
  let jobs: any[]

  beforeEach(() => {
    calls = []
    jobs = []
    let n = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: any) => {
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body
      calls.push({ url, body })
      const ok = (value: unknown) => new Response(JSON.stringify(value), { status: 200 })
      if (url.endsWith('/api/mutation') && body.path === 'files:generateUploadUrl') return ok({ status: 'success', value: `https://upload/${++n}` })
      if (url.startsWith('https://upload/')) return ok({ storageId: `kg${url.split('/').pop()}` })
      if (url.endsWith('/api/mutation') && body.path === 'printJobs:create') { jobs.push(body.args); return ok({ status: 'success', value: `job${jobs.length}` }) }
      return new Response('{}', { status: 404 })
    }))
  })
  afterEach(() => vi.unstubAllGlobals())

  function setup(env: Record<string, string> = {}) {
    const dataDir = mkdtempSync(join(tmpdir(), 'group-print-'))
    const printer = createGroupPrinter({
      env: { CONVEX_URL: 'https://convex.test', SHIV_DEVICE_TOKEN: 'tok', PRINT_GROUP_ID: GROUP, ...env },
      dataDir, log: () => {}, silent,
    })
    const download = vi.fn(async () => Buffer.from('photo-bytes'))
    const sock = { updateMediaMessage: vi.fn() }
    let id = 0
    const msg = (message: any, extra: any = {}) => ({
      key: { remoteJid: GROUP, id: `m${++id}`, participant: SENDER, ...extra },
      messageTimestamp: Math.floor(Date.now() / 1000),
      message,
    })
    const send = (m: any, type = 'notify') => printer.handle(sock, download, m, type)
    return { printer, download, msg, send }
  }

  it('prints a photo captioned cp straight away, addressed to the print server', async () => {
    const { send, msg } = setup()
    await send(msg({ imageMessage: { mimetype: 'image/jpeg', caption: 'cp' } }))
    expect(jobs).toHaveLength(1)
    expect(jobs[0]).toMatchObject({
      kind: 'raw-file', source: 'whatsapp', copies: 1, assignedPrinterId: 'shiv-shop-printer',
      payload: { mode: 'color', files: [{ storageId: 'kg1', mediaType: 'image/jpeg' }] },
    })
    const upload = calls.find((c) => c.url === 'https://upload/1')
    expect(upload?.body).toEqual(Buffer.from('photo-bytes'))
  })

  it('types out the photo that comes just after its "order"', async () => {
    const { send, msg } = setup()
    await send(msg({ conversation: 'Order' }))
    expect(jobs).toHaveLength(0)
    await send(msg({ imageMessage: { mimetype: 'image/jpeg' } }))
    expect(jobs).toHaveLength(1)
    expect(jobs[0].payload).toMatchObject({ readOrder: true, replyTo: { id: 'm2' } })
    // The next plain photo just waits, as before.
    await send(msg({ imageMessage: { mimetype: 'image/jpeg' } }))
    expect(jobs).toHaveLength(1)
  })

  it('keeps uncaptioned files until the same sender says bw, then prints them as one job', async () => {
    const { send, msg } = setup()
    await send(msg({ imageMessage: { mimetype: 'image/jpeg' } }))
    await send(msg({ documentWithCaptionMessage: { message: { documentMessage: { mimetype: 'application/pdf', fileName: 'bill.pdf' } } } }))
    expect(jobs).toHaveLength(0)
    await send(msg({ conversation: 'bw' }, { participant: '918888888888@s.whatsapp.net' }))
    expect(jobs).toHaveLength(0)
    await send(msg({ conversation: 'bw' }))
    expect(jobs).toHaveLength(1)
    expect(jobs[0].payload.mode).toBe('bw')
    expect(jobs[0].payload.files.map((f: any) => f.name)).toEqual([expect.stringMatching(/\.jpg$/), 'bill.pdf'])
  })

  it('prints the photo a bw reply points at', async () => {
    const { send, msg, download } = setup()
    await send(msg({ extendedTextMessage: { text: 'bw', contextInfo: { stanzaId: 'orig', participant: SENDER, quotedMessage: { imageMessage: { mimetype: 'image/jpeg' } } } } }))
    expect(jobs).toHaveLength(1)
    expect(download.mock.calls[0][0].key.id).toBe('orig')
  })

  it('ignores other chats, other file types, repeats and old catch-up', async () => {
    const { send, msg } = setup()
    await send(msg({ imageMessage: { mimetype: 'image/jpeg', caption: 'cp' } }, { remoteJid: 'other@g.us' }))
    await send(msg({ documentMessage: { mimetype: 'application/zip', caption: 'bw' } }))
    const once = msg({ imageMessage: { mimetype: 'image/jpeg', caption: 'bw' } })
    await send(once)
    await send(once, 'append')
    const old = { ...msg({ imageMessage: { mimetype: 'image/jpeg', caption: 'bw' } }), messageTimestamp: 1 }
    await send(old, 'append')
    expect(jobs).toHaveLength(1)
  })

  it('prints an SBI PDF the moment it is posted, black and white, with no bw / cp', async () => {
    const { send, msg } = setup()
    await send(msg({ documentMessage: { mimetype: 'application/pdf', fileName: 'SBIDocument_25_Nov_2026.pdf' } }))
    expect(jobs).toHaveLength(1)
    expect(jobs[0].payload).toMatchObject({ mode: 'bw', files: [{ name: 'SBIDocument_25_Nov_2026.pdf', mediaType: 'application/pdf' }] })
    // Any other PDF still waits for its bw / cp.
    await send(msg({ documentMessage: { mimetype: 'application/pdf', fileName: 'quotation.pdf' } }))
    expect(jobs).toHaveLength(1)
    // A caption still decides: cp on an SBI PDF prints in colour.
    await send(msg({ documentWithCaptionMessage: { message: { documentMessage: { mimetype: 'application/pdf', fileName: 'sbidocument_1.PDF', caption: 'cp' } } } }))
    expect(jobs.at(-1).payload.mode).toBe('color')
  })

  it('takes other names to print from PRINT_AUTO_NAMES, and none with "off"', async () => {
    const custom = setup({ PRINT_AUTO_NAMES: 'Statement_*.pdf=bw; *receipt*.pdf=color' })
    await custom.send(custom.msg({ documentMessage: { mimetype: 'application/pdf', fileName: 'UPI receipt 41.pdf' } }))
    await custom.send(custom.msg({ documentMessage: { mimetype: 'application/pdf', fileName: 'SBIDocument_1.pdf' } }))
    expect(jobs.map((j) => j.payload.mode)).toEqual(['color'])
    const off = setup({ PRINT_AUTO_NAMES: 'off' })
    await off.send(off.msg({ documentMessage: { mimetype: 'application/pdf', fileName: 'SBIDocument_2.pdf' } }))
    expect(jobs).toHaveLength(1)
  })

  it('stays off without its settings', async () => {
    const { printer, send, msg } = setup({ SHIV_DEVICE_TOKEN: '' })
    expect(printer.state.enabled).toBe(false)
    expect(printer.state.missing).toEqual(['SHIV_DEVICE_TOKEN'])
    await send(msg({ imageMessage: { mimetype: 'image/jpeg', caption: 'cp' } }))
    expect(jobs).toHaveLength(0)
  })
})

describe('auto-print chats (a supplier chat of paper bills)', () => {
  const SUPPLIER = '120363000000000001@g.us'
  const OTHER = '120363000000000002@g.us'
  let jobs: any[]

  beforeEach(() => {
    jobs = []
    let n = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: any) => {
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body
      const ok = (value: unknown) => new Response(JSON.stringify(value), { status: 200 })
      if (url.endsWith('/api/mutation') && body.path === 'files:generateUploadUrl') return ok({ status: 'success', value: `https://upload/${++n}` })
      if (url.startsWith('https://upload/')) return ok({ storageId: `kg${url.split('/').pop()}` })
      if (url.endsWith('/api/mutation') && body.path === 'printJobs:create') { jobs.push(body.args); return ok({ status: 'success', value: `job${jobs.length}` }) }
      return new Response('{}', { status: 404 })
    }))
  })
  afterEach(() => vi.unstubAllGlobals())

  function setup(env: Record<string, string> = {}) {
    const printer = createGroupPrinter({
      env: { CONVEX_URL: 'https://convex.test', SHIV_DEVICE_TOKEN: 'tok', SHOP_GROUP_ID: GROUP, PRINT_AUTO_CHATS: 'Simran Ply Rajan Rnc Pulkari Sunmica=bw', ...env },
      dataDir: mkdtempSync(join(tmpdir(), 'auto-print-')), log: () => {}, silent, shopGroup: false,
    })
    const subjects: Record<string, string> = { [SUPPLIER]: 'Simran Ply  Rajan Rnc Pulkari Sunmica', [OTHER]: 'Family', [GROUP]: 'Shiv Hardware' }
    const sock = { updateMediaMessage: vi.fn(), groupMetadata: vi.fn(async (jid: string) => ({ subject: subjects[jid] })) }
    const download = vi.fn(async () => Buffer.from('photo-bytes'))
    let id = 0
    const msg = (jid: string, message: any) => ({
      key: { remoteJid: jid, id: `a${++id}`, participant: SENDER },
      messageTimestamp: Math.floor(Date.now() / 1000),
      message,
    })
    return { printer, sock, send: (m: any) => printer.handle(sock, download, m, 'notify'), msg }
  }

  it('reads the chats from the setting, by name or id, bw unless said', () => {
    expect(parseAutoChats('Simran Ply=bw; 120363000000000009@g.us=cp ;Other')).toEqual([
      { chat: 'Simran Ply', key: 'simranply', mode: 'bw', onlyPaper: false },
      { chat: '120363000000000009@g.us', key: '120363000000000009@g.us', mode: 'color', onlyPaper: false },
      { chat: 'Other', key: 'other', mode: 'bw', onlyPaper: false },
    ])
    expect(parseAutoChats('Simran Ply=bw,paper')[0]).toMatchObject({ mode: 'bw', onlyPaper: true })
    expect(parseAutoChats('off')).toEqual([])
    expect(parseAutoChats(undefined)).toEqual([])
  })

  it('prints every photo in the supplier chat at once, black and white, no bw needed', async () => {
    const { send, msg, printer } = setup()
    await send(msg(SUPPLIER, { imageMessage: { mimetype: 'image/jpeg' } }))
    expect(jobs).toHaveLength(1)
    expect(jobs[0]).toMatchObject({ kind: 'raw-file', payload: { mode: 'bw' }, assignedPrinterId: 'shiv-shop-printer' })
    expect(jobs[0].requestedBy).toContain('Simran Ply Rajan Rnc Pulkari Sunmica')
    expect(printer.state.autoChats[0].id).toBe(SUPPLIER)
  })

  it('marks a paper-only chat\'s jobs for the print server\'s paper check', async () => {
    const { send, msg } = setup({ PRINT_AUTO_CHATS: 'Simran Ply Rajan Rnc Pulkari Sunmica=bw,paper' })
    await send(msg(SUPPLIER, { imageMessage: { mimetype: 'image/jpeg' } }))
    expect(jobs[0].payload).toMatchObject({ mode: 'bw', onlyPaper: true })
  })

  it('leaves other chats, text, and the shop group alone', async () => {
    const { send, msg } = setup()
    await send(msg(OTHER, { imageMessage: { mimetype: 'image/jpeg', caption: 'bw' } }))
    await send(msg(SUPPLIER, { conversation: 'bw' }))
    await send(msg(GROUP, { imageMessage: { mimetype: 'image/jpeg', caption: 'bw' } }))
    expect(jobs).toHaveLength(0)
  })

  it('prints a message only once', async () => {
    const { send, msg } = setup()
    const m = msg(SUPPLIER, { imageMessage: { mimetype: 'image/jpeg' } })
    await send(m)
    await send(m)
    expect(jobs).toHaveLength(1)
  })
})
