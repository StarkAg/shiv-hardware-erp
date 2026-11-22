/// <reference types="vite/client" />
import { convexTest } from './trustedConvex'
import { convexTest as untrusted } from 'convex-test'
import { describe, expect, it } from 'vitest'
import schema from '../convex/schema'
import { api } from '../convex/_generated/api'

const modules = import.meta.glob('../convex/**/*.ts')
const ramesh = { name: '  Ramesh   Kumar ', place: ' Ramgarh ', phone: '+91 98765-43210' }

/** The counter, and the Samsung's app as the phone-only device it is. */
async function shop() {
  const bare = untrusted(schema, modules)
  const id = await bare.run((ctx) => ctx.db.insert('trustedDevices', {
    name: 'Samsung', app: 'shiv-intro', kind: 'device', createdAt: 1, lastSeenAt: 1,
  }))
  return { bare, phone: bare.withIdentity({ subject: String(id) }), deviceId: id }
}

describe('Shiv Intro', () => {
  it('Save keeps the name, the place and a clean 10-digit number', async () => {
    const c = convexTest(schema, modules)
    await c.mutation(api.shivIntro.save, ramesh)
    const rows = await c.run((ctx) => ctx.db.query('introContacts').collect())
    expect(rows).toMatchObject([{ name: 'Ramesh Kumar', place: 'Ramgarh', phone: '9876543210', saveStatus: 'waiting' }])
    expect(rows[0].sendStatus).toBeUndefined()
  })

  it('Save and Send are separate jobs on one customer', async () => {
    const c = convexTest(schema, modules)
    await c.mutation(api.shivIntro.save, ramesh)
    expect(await c.query(api.shivIntro.toSend, {})).toEqual([])
    await c.mutation(api.shivIntro.send, ramesh)
    const rows = await c.run((ctx) => ctx.db.query('introContacts').collect())
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ saveStatus: 'waiting', sendStatus: 'requested' })
    expect(await c.query(api.shivIntro.toSend, {})).toMatchObject([{ phone: '9876543210', name: 'Ramesh Kumar' }])
  })

  it('refuses a missing name or a bad number', async () => {
    const c = convexTest(schema, modules)
    await expect(c.mutation(api.shivIntro.save, { ...ramesh, name: ' ' })).rejects.toThrow()
    await expect(c.mutation(api.shivIntro.send, { ...ramesh, phone: '12345' })).rejects.toThrow()
  })

  it('the same customer is not sent the card twice unless asked', async () => {
    const c = convexTest(schema, modules)
    const id = await c.mutation(api.shivIntro.send, ramesh)
    expect(await c.mutation(api.shivIntro.claimSend, { id })).toBe(true)
    expect(await c.mutation(api.shivIntro.claimSend, { id })).toBe(false)
    await c.mutation(api.shivIntro.recordSend, { id, status: 'sent' })
    await expect(c.mutation(api.shivIntro.send, ramesh)).rejects.toThrow(/already sent/)
    await c.mutation(api.shivIntro.send, { ...ramesh, again: true })
    expect(await c.query(api.shivIntro.toSend, {})).toHaveLength(1)
  })

  it('Send needs only the number, and keeps what was ticked in order', async () => {
    const c = convexTest(schema, modules)
    await c.mutation(api.shivIntro.send, { phone: '98765 43210', what: ['harsh', 'card'] })
    expect(await c.query(api.shivIntro.toSend, {})).toEqual([
      expect.objectContaining({ name: '9876543210', phone: '9876543210', what: ['card', 'harsh'] }),
    ])
    await expect(c.mutation(api.shivIntro.save, { phone: '9876543210' })).rejects.toThrow(/name/)
    await expect(c.mutation(api.shivIntro.send, { phone: '9876500000', what: [] })).rejects.toThrow(/Tick/)
  })

  it('a QR can go again and again; a second card needs asking', async () => {
    const c = convexTest(schema, modules)
    const id = await c.mutation(api.shivIntro.send, { phone: '9876543210', what: ['card'] })
    await c.mutation(api.shivIntro.claimSend, { id })
    await c.mutation(api.shivIntro.recordSend, { id, status: 'sent' })
    for (let i = 0; i < 2; i++) {
      await c.mutation(api.shivIntro.send, { phone: '9876543210', what: ['shop'] })
      await c.mutation(api.shivIntro.claimSend, { id })
      await c.mutation(api.shivIntro.recordSend, { id, status: 'sent' })
    }
    await expect(c.mutation(api.shivIntro.send, { phone: '9876543210', what: ['card', 'harsh'] })).rejects.toThrow(/already sent/)
  })

  it('a name typed earlier is kept when Send has none', async () => {
    const c = convexTest(schema, modules)
    await c.mutation(api.shivIntro.save, ramesh)
    await c.mutation(api.shivIntro.send, { phone: '9876543210', what: ['shop'] })
    const rows = await c.run((ctx) => ctx.db.query('introContacts').collect())
    expect(rows[0]).toMatchObject({ name: 'Ramesh Kumar', place: 'Ramgarh', sendWhat: ['shop'] })
  })

  it('a send already on its way is not asked for again', async () => {
    const c = convexTest(schema, modules)
    const id = await c.mutation(api.shivIntro.send, ramesh)
    await c.mutation(api.shivIntro.claimSend, { id })
    await c.mutation(api.shivIntro.send, { ...ramesh, again: true })
    expect(await c.query(api.shivIntro.toSend, {})).toEqual([])
  })
})

describe('the main phone', () => {
  const asPhone = async () => {
    const s = await shop()
    const add = (args = ramesh) => s.bare.run(async (ctx) => {
      const now = Date.now()
      return ctx.db.insert('introContacts', { name: args.name.trim().replace(/\s+/g, ' '), place: args.place.trim(), phone: '9876543210', saveStatus: 'waiting', askedAt: now, createdAt: now, updatedAt: now })
    })
    return { ...s, add }
  }

  it('hears what to save, and stops hearing it once it answers', async () => {
    const { phone, add } = await asPhone()
    const id = await add()
    expect(await phone.query(api.shivIntro.waiting, {})).toEqual([{ id, name: 'Ramesh Kumar, Ramgarh', phone: '9876543210' }])
    await phone.mutation(api.shivIntro.report, { id, result: 'saved' })
    await phone.mutation(api.shivIntro.report, { id, result: 'failed', error: 'late' })
    expect(await phone.query(api.shivIntro.waiting, {})).toEqual([])
  })

  it('checking in shows on the page', async () => {
    const { phone, deviceId, bare } = await asPhone()
    await phone.mutation(api.shivIntro.seen, {})
    const device = await bare.run((ctx) => ctx.db.get(deviceId))
    expect(device!.lastSeenAt).toBeGreaterThan(1)
  })

  it('cannot reach anything else: books, customers or other devices', async () => {
    const { phone } = await asPhone()
    await expect(phone.query(api.shivIntro.recent, {})).rejects.toThrow()
    await expect(phone.query(api.devices.list, {})).rejects.toThrow()
    await expect(phone.query(api.reports.trialBalance, {})).rejects.toThrow()
    await expect(phone.mutation(api.shivIntro.save, ramesh)).rejects.toThrow()
  })

  it('an ordinary device cannot act as the phone, and nobody at all gets in', async () => {
    const { bare } = await asPhone()
    const c = convexTest(schema, modules)
    await expect(c.query(api.shivIntro.waiting, {})).rejects.toThrow()
    await expect(bare.query(api.shivIntro.waiting, {})).rejects.toThrow()
    await expect(bare.mutation(api.shivIntro.save, ramesh)).rejects.toThrow()
  })
})
