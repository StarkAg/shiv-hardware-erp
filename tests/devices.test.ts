/**
 * The trusted-device lock (audit #1): the shop PIN once per device, then the
 * device is on the list; off the list, nothing answers it.
 */
import { convexTest as untrusted } from 'convex-test'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import schema from '../convex/schema'
import { api, internal } from '../convex/_generated/api'

const modules = import.meta.glob('../convex/**/*.ts')

beforeEach(() => { vi.stubEnv('DEVICE_PIN', '26112003') })
afterEach(() => { vi.unstubAllEnvs() })

async function trustedAs(t: ReturnType<typeof untrusted>, name = 'Counter PC') {
  const res = await t.mutation(internal.devices.register, { pin: '26112003', name, app: 'panel', kind: 'device' })
  if (!res.ok) throw new Error(res.error)
  return { id: res.id, as: t.withIdentity({ subject: res.id }) }
}

describe('a device that is not trusted', () => {
  test('is refused by the books, the bills and the masters', async () => {
    const t = untrusted(schema, modules)
    for (const call of [
      () => t.query(api.bills.get, {}),
      () => t.query(api.masters.all, {}),
      () => t.mutation(api.billLedger.postBill, { bill: { id: 'x', customerName: 'A', total: 1, date: '2026-10-01', items: [] } } as any),
    ]) {
      await expect(call()).rejects.toMatchObject({ data: { code: 'untrusted' } })
    }
  })

  test('is told so, which is how an app knows to ask for the PIN', async () => {
    const t = untrusted(schema, modules)
    expect(await t.query(api.devices.me, {})).toEqual({ trusted: false })
  })

  test('still reaches the four guarantee-card functions a customer uses', async () => {
    const t = untrusted(schema, modules)
    expect(await t.query(api.documents.getGuaranteeByNumber, { number: 'GC-2026-0001', token: 'x' })).toBeNull()
    expect(await t.query(api.guaranteeClaims.forCard, { number: 'GC-2026-0001', token: 'x' })).toEqual([])
    await expect(t.mutation(api.guaranteeClaims.uploadUrl, { number: 'GC-2026-0001', token: 'x' }))
      .rejects.not.toMatchObject({ data: { code: 'untrusted' } })
  })
})

describe('the PIN', () => {
  test('the right one puts the device on the list', async () => {
    const t = untrusted(schema, modules)
    const { as } = await trustedAs(t)
    expect(await as.query(api.devices.me, {})).toMatchObject({ trusted: true, name: 'Counter PC' })
    expect(await as.query(api.bills.get, {})).toBeNull()
    expect((await as.query(api.devices.list, {}))[0]).toMatchObject({ name: 'Counter PC', isThis: true })
  })

  test('a wrong one gets nothing, and ten in a row pause trusting', async () => {
    const t = untrusted(schema, modules)
    for (let i = 0; i < 10; i++) {
      expect(await t.mutation(internal.devices.register, { pin: '0000', name: 'X', app: 'panel', kind: 'device' }))
        .toEqual({ ok: false, error: 'Wrong PIN.' })
    }
    expect(await t.mutation(internal.devices.register, { pin: '26112003', name: 'X', app: 'panel', kind: 'device' }))
      .toMatchObject({ ok: false, error: expect.stringContaining('Too many') })
  })
})

describe('the list', () => {
  test('a device can be renamed', async () => {
    const t = untrusted(schema, modules)
    const { id, as } = await trustedAs(t, 'Chrome on Windows')
    await as.mutation(api.devices.rename, { id: id as any, name: 'Counter PC' })
    expect((await as.query(api.devices.list, {}))[0].name).toBe('Counter PC')
  })

  test('removing asks the PIN, and the removed device is refused at once', async () => {
    const t = untrusted(schema, modules)
    const owner = await trustedAs(t, 'Counter PC')
    const phone = await trustedAs(t, 'Old phone')
    await expect(owner.as.mutation(api.devices.remove, { id: phone.id as any, pin: '1234' })).rejects.toThrow('Wrong PIN')
    await owner.as.mutation(api.devices.remove, { id: phone.id as any, pin: '26112003' })
    await expect(phone.as.query(api.bills.get, {})).rejects.toMatchObject({ data: { code: 'untrusted' } })
    expect(await phone.as.query(api.devices.me, {})).toEqual({ trusted: false })
  })
})
