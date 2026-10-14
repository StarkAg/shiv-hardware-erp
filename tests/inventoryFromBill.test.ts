import { convexTest } from './trustedConvex'
import { describe, expect, it } from 'vitest'
import schema from '../convex/schema'
import { api } from '../convex/_generated/api'

const modules = import.meta.glob('../convex/**/*.ts')

describe('an item written into a bill joins the stock list', () => {
  it('starts with nothing on the shelf, so the bill that named it takes it below nil', async () => {
    const t = convexTest(schema, modules)
    const stock = async (ref: string) => (await t.query(api.inventory.seedList, {})).find((row: any) => row.ref === ref) as any

    // Written as a sheet, it is filed as one; written twice, it is the same item.
    const made = await t.mutation(api.inventory.addFromBill, { name: '  9mm  Century  7×4 ' })
    expect(made).toMatchObject({ name: '9mm Century 7 x 4', added: true })
    expect(await t.mutation(api.inventory.addFromBill, { name: '9MM century 7 x 4' })).toMatchObject({ ref: made.ref, added: false })
    expect(await stock(made.ref)).toMatchObject({ name: '9mm Century 7 x 4', stock: 0, category: 'ply' })

    // Anything else is kept under the name it was written with.
    const glue = await t.mutation(api.inventory.addFromBill, { name: 'Fevicol Marine 5 Kg' })
    expect(await stock(glue.ref)).toMatchObject({ name: 'Fevicol Marine 5 Kg', stock: 0, category: 'other' })

    // A sale of last week names it: seven off a shelf that has none is seven owed.
    await t.mutation(api.bills.save, {
      billSeq: 1,
      bills: [{ id: 'b1', number: '1', kind: 'sale', date: '2026-10-03', customerName: 'Sanjay', items: [], total: 0, updatedAt: 1000, voucherId: 'v-b1',
        stock: [{ ref: made.ref, name: made.name, qty: 7 }, { ref: glue.ref, name: glue.name, qty: 2 }] }],
    })
    expect((await stock(made.ref)).stock).toBe(-7)
    expect((await stock(glue.ref)).stock).toBe(-2)

    // One the list already has is answered with that item, not made again.
    const seeded = (await t.query(api.inventory.seedList, {}) as any[]).find((row) => row.ref.startsWith('seed:'))
    expect(await t.mutation(api.inventory.addFromBill, { name: seeded.name })).toMatchObject({ ref: seeded.ref, added: false })

    await expect(t.mutation(api.inventory.addFromBill, { name: '   ' })).rejects.toThrow('name')
  })
})
