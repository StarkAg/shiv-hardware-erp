import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
// @ts-expect-error plain .mjs module
import { createGroupPrinter, isOrderText } from '../whatsapp-reminders/group-print.mjs'
// @ts-expect-error plain .mjs module
import { orderLines, readFailure } from '../print-server/order-read.mjs'

describe('isOrderText', () => {
  it('finds the word order in a caption or message', () => {
    expect(isOrderText('order')).toBe(true)
    expect(isOrderText('Order bw')).toBe(true)
    expect(isOrderText('pls ORDER this')).toBe(true)
  })
  it('ignores other words and empty text', () => {
    expect(isOrderText('orders')).toBe(false)
    expect(isOrderText('border')).toBe(false)
    expect(isOrderText('')).toBe(false)
    expect(isOrderText(undefined)).toBe(false)
  })
})

describe('orderLines', () => {
  it('keeps item lines and strips bullets, numbering and markdown', () => {
    expect(orderLines('- 19mm S 7x4 - 1 pc\n2. Fevicol Marine - 4 kg\n\n**Polyfix - 1 pc**\n')).toEqual([
      '19mm S 7x4 - 1 pc',
      'Fevicol Marine - 4 kg',
      'Polyfix - 1 pc',
    ])
  })
  it('gives nothing for NONE', () => {
    expect(orderLines('NONE')).toEqual([])
    expect(orderLines('  \n')).toEqual([])
  })
})

describe('readFailure', () => {
  it('never posts the command line, and says a timeout plainly', () => {
    const timeout = Object.assign(new Error('Command failed: claude.exe -p Read the image file C:\\Temp\\shiv-order-x\\order.jpg. It is a photo'), { killed: true, signal: 'SIGTERM' })
    expect(readFailure(timeout, '', '', 180_000)).toBe('Claude took longer than 180 s')
    const exited = Object.assign(new Error('Command failed: claude.exe -p ...'), { code: 1 })
    expect(readFailure(exited, '', '')).toBe('Claude stopped (exit code 1)')
    expect(readFailure(exited, '', 'Command failed: claude.exe -p order')).toBe('Claude stopped (exit code 1)')
  })
  it('keeps what Claude said, without the word order', () => {
    const exited = Object.assign(new Error('Command failed'), { code: 1 })
    expect(readFailure(exited, '\nAPI Error: overloaded for this order\nmore', '')).toBe('API Error: overloaded for this slip')
    expect(readFailure(Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' }))).toBe('Claude Code is not installed here')
  })
})

describe('order photos in the shop group', () => {
  const GROUP = 'shop@g.us'
  let n = 0
  const photo = (from: string, caption = '') => ({
    key: { remoteJid: GROUP, id: `photo${++n}`, participant: from },
    message: { imageMessage: { mimetype: 'image/jpeg', caption } },
    messageTimestamp: Math.floor(Date.now() / 1000),
  })
  const text = (from: string, body: string) => ({
    key: { remoteJid: GROUP, id: `text${++n}`, participant: from },
    message: { conversation: body },
    messageTimestamp: Math.floor(Date.now() / 1000),
  })
  const reply = (from: string, body: string, to: { key: { id: string; participant: string } }) => ({
    key: { remoteJid: GROUP, id: `text${++n}`, participant: from },
    message: { extendedTextMessage: { text: body, contextInfo: { stanzaId: to.key.id, participant: to.key.participant, quotedMessage: { imageMessage: { mimetype: 'image/jpeg' } } } } },
    messageTimestamp: Math.floor(Date.now() / 1000),
  })

  async function setup() {
    const dataDir = await mkdtemp(join(tmpdir(), 'order-test-'))
    const read: string[] = []
    const printer = createGroupPrinter({
      env: { CONVEX_URL: 'https://x.convex.cloud', SHIV_DEVICE_TOKEN: 't', PRINT_GROUP_ID: GROUP },
      dataDir, log: () => {}, silent: {},
      typeOut: async (_file: unknown, replyTo: { id: string }) => { read.push(replyTo.id); return true },
    })
    const download = async () => Buffer.from('jpeg')
    const send = (msg: unknown) => printer.handle({}, download, msg, 'notify')
    return { read, send }
  }

  it('a second "order" after a captioned photo is not a new ask', async () => {
    const { read, send } = await setup()
    const first = photo('a@s', 'order')
    await send(first)
    await send(text('a@s', 'order'))
    // The next photo without a caption waits for bw / cp; it is not typed out.
    await send(photo('a@s'))
    expect(read).toEqual([first.key.id])
  })

  it('a photo asked for by reply is not typed out again by a plain "order"', async () => {
    const { read, send } = await setup()
    const p = photo('a@s')
    await send(p)
    await send(reply('a@s', 'order', p))
    await send(text('a@s', 'order'))
    expect(read).toEqual([p.key.id])
  })

  it('"order" after an uncaptioned photo types it out, and a newer photo still can be', async () => {
    const { read, send } = await setup()
    const p1 = photo('a@s')
    await send(p1)
    await send(text('a@s', 'order'))
    const p2 = photo('a@s')
    await send(p2)
    await send(text('a@s', 'order'))
    expect(read).toEqual([p1.key.id, p2.key.id])
  })

  it('"order" before its photo still waits for that photo', async () => {
    const { read, send } = await setup()
    await send(text('b@s', 'order'))
    const p = photo('b@s')
    await send(p)
    expect(read).toEqual([p.key.id])
  })
})
