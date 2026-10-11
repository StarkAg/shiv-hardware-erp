import { convexTest } from './trustedConvex'
import { describe, expect, it } from 'vitest'
import schema from '../convex/schema'
import { api } from '../convex/_generated/api'

const modules = import.meta.glob('../convex/**/*.ts')

describe('workshop: a work order as a chat in photos', () => {
  it('goes from the counter to the workshop and back, each side told what is new', async () => {
    const t = convexTest(schema, modules)
    const photo = () => t.run((ctx) => ctx.storage.store(new Blob(['photo'], { type: 'image/jpeg' })))
    const order = await photo()

    // No photo, no order: the photo is the order.
    await expect(t.mutation(api.workshop.create, { photos: [] })).rejects.toThrow('photo')

    const first = await t.mutation(api.workshop.create, { title: '  Sanjay  Mahto,  Korambe ', photos: [order] })
    const second = await t.mutation(api.workshop.create, { photos: [await photo()] })
    let jobs = await t.query(api.workshop.list, {})
    expect(jobs.map((j) => j.number).sort()).toEqual([1, 2])
    let job = jobs.find((j) => j.id === first)!
    expect(job).toMatchObject({ title: 'Sanjay Mahto, Korambe', status: 'open', workshopSeenAt: 0 })
    expect(job.messages).toHaveLength(1)
    expect(job.messages[0]).toMatchObject({ from: 'shop', text: '' })
    expect(job.messages[0].photos[0]).toMatchObject({ storageId: order })
    expect(job.messages[0].photos[0].url).toBeTruthy()
    // New to the workshop, not to the shop that sent it.
    const newTo = (j: typeof job, side: 'shop' | 'workshop') =>
      j.messages.filter((m) => m.from !== side && m.at > (side === 'shop' ? j.shopSeenAt : j.workshopSeenAt)).length
    expect([newTo(job, 'workshop'), newTo(job, 'shop')]).toEqual([1, 0])

    // The workshop opens it, then answers with the measurements.
    await t.mutation(api.workshop.seen, { jobId: first, side: 'workshop' })
    await expect(t.mutation(api.workshop.send, { jobId: first, from: 'workshop', photos: [], text: '   ' })).rejects.toThrow('photo')
    const measured = await photo()
    await t.mutation(api.workshop.send, { jobId: first, from: 'workshop', photos: [measured], text: 'Two doors' })
    job = (await t.query(api.workshop.list, {})).find((j) => j.id === first)!
    expect(job.messages.map((m) => [m.from, m.photos.length, m.text])).toEqual([['shop', 1, ''], ['workshop', 1, 'Two doors']])
    expect([newTo(job, 'workshop'), newTo(job, 'shop')]).toEqual([0, 1])
    await t.mutation(api.workshop.seen, { jobId: first, side: 'shop' })
    job = (await t.query(api.workshop.list, {})).find((j) => j.id === first)!
    expect(newTo(job, 'shop')).toBe(0)

    // Done moves it off the open list; it and its thread stay.
    await t.mutation(api.workshop.setStatus, { jobId: first, status: 'done' })
    jobs = await t.query(api.workshop.list, {})
    expect(jobs.find((j) => j.id === first)).toMatchObject({ status: 'done' })
    expect(jobs.find((j) => j.id === first)!.messages).toHaveLength(2)

    // A job made by mistake goes, and its photos with it.
    await t.mutation(api.workshop.remove, { jobId: first })
    jobs = await t.query(api.workshop.list, {})
    expect(jobs.map((j) => j.id)).toEqual([second])
    expect(await t.run((ctx) => ctx.storage.getUrl(order))).toBeNull()
    expect(await t.run((ctx) => ctx.storage.getUrl(measured))).toBeNull()
    // The next order does not take the removed one's number.
    const third = await t.mutation(api.workshop.create, { photos: [await photo()] })
    expect((await t.query(api.workshop.list, {})).find((j) => j.id === third)!.number).toBe(3)
  })

  it('takes the customer from the books, and follows a correction made in the panel', async () => {
    const t = convexTest(schema, modules)
    const photo = () => t.run((ctx) => ctx.storage.store(new Blob(['photo'], { type: 'image/jpeg' })))
    const { sanjay, supplier } = await t.run(async (ctx) => {
      const debtors = await ctx.db.insert('groups', { name: 'Sundry Debtors', nature: 'asset', normalSide: 'Dr', sort: 0 })
      const creditors = await ctx.db.insert('groups', { name: 'Sundry Creditors', nature: 'liability', normalSide: 'Cr', sort: 1 })
      const account = { openingBalance: 0, openingSide: 'Dr' as const, openingAsOf: 1, active: true, createdAt: 1, updatedAt: 1 }
      return {
        sanjay: await ctx.db.insert('ledgers', { ...account, name: 'M/s Sanjay Mahto Ji, Korambe', groupId: debtors, phone: '8340785465', place: 'Korambe', aadhaar: '123412341234' }),
        supplier: await ctx.db.insert('ledgers', { ...account, name: 'M/s Ply Supplier', groupId: creditors }),
      }
    })

    // The picker: customers only, and nothing but the name, place and phone.
    expect(await t.query(api.workshop.customers, {})).toEqual([{ id: sanjay, name: 'Sanjay Mahto Ji, Korambe', place: 'Korambe', phone: '8340785465' }])

    const id = await t.mutation(api.workshop.create, { ledgerId: sanjay, photos: [await photo()] })
    const job = async () => (await t.query(api.workshop.list, {})).find((j) => j.id === id)!
    expect(await job()).toMatchObject({ title: 'Sanjay Mahto Ji, Korambe', phone: '8340785465', place: 'Korambe', ledgerId: sanjay })

    // The phone is corrected in the panel: the job shows the new one.
    await t.run((ctx) => ctx.db.patch(sanjay, { phone: '9000000000' }))
    expect((await job()).phone).toBe('9000000000')

    // Moved to a typed name, then back to the account.
    await t.mutation(api.workshop.setCustomer, { jobId: id, title: 'Walk-in, Ghutwa' })
    expect(await job()).toMatchObject({ title: 'Walk-in, Ghutwa', phone: '', ledgerId: null })
    await t.mutation(api.workshop.setCustomer, { jobId: id, ledgerId: sanjay })
    expect(await job()).toMatchObject({ title: 'Sanjay Mahto Ji, Korambe', ledgerId: sanjay })

    // The account goes: the job keeps the name it was sent with.
    await t.run((ctx) => ctx.db.delete(sanjay))
    expect(await job()).toMatchObject({ title: 'Sanjay Mahto Ji, Korambe', phone: '', ledgerId: null })
    await expect(t.mutation(api.workshop.create, { ledgerId: sanjay, photos: [await photo()] })).rejects.toThrow('no longer in the books')
    void supplier
  })

  it('refuses a photo that never uploaded', async () => {
    const t = convexTest(schema, modules)
    const real = await t.run((ctx) => ctx.storage.store(new Blob(['x'], { type: 'image/jpeg' })))
    await t.run((ctx) => ctx.storage.delete(real))
    await expect(t.mutation(api.workshop.create, { photos: [real] })).rejects.toThrow('did not upload')
  })
})
