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
    const second = await t.mutation(api.workshop.create, { stage: 'assemble', photos: [await photo()] })
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

    // A new order is at measurement unless the counter put it elsewhere, and either side moves it on.
    expect(job.stage).toBe('measurement')
    expect(jobs.find((j) => j.id === second)!.stage).toBe('assemble')
    await t.mutation(api.workshop.setStage, { jobId: second, stage: 'fitting' })
    expect((await t.query(api.workshop.list, {})).map((j) => [j.number, j.stage]).sort()).toEqual([[1, 'measurement'], [2, 'fitting']])

    // The workshop opens it, then answers with the measurements.
    await t.mutation(api.workshop.seen, { jobId: first, side: 'workshop' })
    await expect(t.mutation(api.workshop.send, { jobId: first, from: 'workshop', photos: [], text: '   ' })).rejects.toThrow('photo')
    const measured = await photo()
    await t.mutation(api.workshop.send, { jobId: first, from: 'workshop', photos: [measured], text: 'Two doors' })
    job = (await t.query(api.workshop.list, {})).find((j) => j.id === first)!
    // What the workshop typed with it is not kept: its answer is the photo.
    expect(job.messages.map((m) => [m.from, m.photos.length, m.text])).toEqual([['shop', 1, ''], ['workshop', 1, '']])
    await expect(t.mutation(api.workshop.send, { jobId: first, from: 'workshop', photos: [], text: 'Two doors' })).rejects.toThrow('photo of the measurements')
    // The counter can still write a line.
    await t.mutation(api.workshop.send, { jobId: second, from: 'shop', photos: [], text: 'Call before going' })
    expect((await t.query(api.workshop.list, {})).find((j) => j.id === second)!.messages.at(-1)).toMatchObject({ from: 'shop', text: 'Call before going' })
    expect([newTo(job, 'workshop'), newTo(job, 'shop')]).toEqual([0, 1])
    await t.mutation(api.workshop.seen, { jobId: first, side: 'shop' })
    job = (await t.query(api.workshop.list, {})).find((j) => j.id === first)!
    expect(newTo(job, 'shop')).toBe(0)

    // Done moves it off the open list; it and its thread stay.
    await t.mutation(api.workshop.setStatus, { jobId: first, status: 'done' })
    jobs = await t.query(api.workshop.list, {})
    expect(jobs.find((j) => j.id === first)).toMatchObject({ status: 'done' })
    expect(jobs.find((j) => j.id === first)!.messages).toHaveLength(2)

    // A message is taken out only with the delete PIN.
    const [sent, replied] = jobs.find((j) => j.id === first)!.messages
    process.env.WORKSHOP_DELETE_PIN = '4321'
    await expect(t.mutation(api.workshop.removeMessage, { jobId: first, messageId: replied.id, pin: '1234' })).rejects.toThrow('Wrong PIN')
    await expect(t.mutation(api.workshop.removeMessage, { jobId: first, messageId: replied.id, pin: '' })).rejects.toThrow('Wrong PIN')
    await expect(t.mutation(api.workshop.removeMessage, { jobId: first, messageId: replied.id, pin: '43210' })).rejects.toThrow('Wrong PIN')
    expect((await t.query(api.workshop.list, {})).find((j) => j.id === first)!.messages).toHaveLength(2)
    // With it, the message and its photo go; the rest of the thread stays.
    await t.mutation(api.workshop.removeMessage, { jobId: first, messageId: replied.id, pin: '4321' })
    expect((await t.query(api.workshop.list, {})).find((j) => j.id === first)!.messages.map((m) => m.id)).toEqual([sent.id])
    expect(await t.run((ctx) => ctx.storage.getUrl(measured))).toBeNull()
    expect(await t.run((ctx) => ctx.storage.getUrl(order))).toBeTruthy()
    // The last message out takes the thread with it.
    await t.mutation(api.workshop.removeMessage, { jobId: first, messageId: sent.id, pin: '4321' })
    jobs = await t.query(api.workshop.list, {})
    expect(jobs.map((j) => j.id)).toEqual([second])
    expect(await t.run((ctx) => ctx.storage.getUrl(order))).toBeNull()
    // And with no PIN set on the deployment, nothing can be deleted at all.
    delete process.env.WORKSHOP_DELETE_PIN
    const only = jobs[0].messages[0]
    await expect(t.mutation(api.workshop.removeMessage, { jobId: second, messageId: only.id, pin: '4321' })).rejects.toThrow('No delete PIN')
    // The next order does not take the removed one's number.
    const third = await t.mutation(api.workshop.create, { photos: [await photo()] })
    expect((await t.query(api.workshop.list, {})).find((j) => j.id === third)!.number).toBe(3)
  })

  it('takes a whole work order off the list, with every photo in it, only with the delete PIN', async () => {
    const t = convexTest(schema, modules)
    const photo = () => t.run((ctx) => ctx.storage.store(new Blob(['photo'], { type: 'image/jpeg' })))
    const [order, measured, other] = [await photo(), await photo(), await photo()]
    const gone = await t.mutation(api.workshop.create, { title: 'Sanjay Mahto', photos: [order] })
    await t.mutation(api.workshop.send, { jobId: gone, from: 'workshop', photos: [measured], text: 'Two doors' })
    const kept = await t.mutation(api.workshop.create, { photos: [other] })

    // No PIN on the deployment, or the wrong one: it stays, photos and all.
    delete process.env.WORKSHOP_DELETE_PIN
    await expect(t.mutation(api.workshop.remove, { jobId: gone, pin: '4321' })).rejects.toThrow('No delete PIN')
    process.env.WORKSHOP_DELETE_PIN = '4321'
    await expect(t.mutation(api.workshop.remove, { jobId: gone, pin: '1234' })).rejects.toThrow('Wrong PIN')
    await expect(t.mutation(api.workshop.remove, { jobId: gone, pin: '' })).rejects.toThrow('Wrong PIN')
    expect((await t.query(api.workshop.list, {})).map((j) => j.id).sort()).toEqual([gone, kept].sort())
    expect(await t.run((ctx) => ctx.storage.getUrl(measured))).toBeTruthy()

    // With it, the job and both sides' photos go; the other job is not touched.
    await t.mutation(api.workshop.remove, { jobId: gone, pin: '4321' })
    expect((await t.query(api.workshop.list, {})).map((j) => j.id)).toEqual([kept])
    expect(await t.run((ctx) => ctx.storage.getUrl(order))).toBeNull()
    expect(await t.run((ctx) => ctx.storage.getUrl(measured))).toBeNull()
    expect(await t.run((ctx) => ctx.storage.getUrl(other))).toBeTruthy()
    // Asked again, from a phone that still shows it: nothing to do, and no error.
    await t.mutation(api.workshop.remove, { jobId: gone, pin: '4321' })
    delete process.env.WORKSHOP_DELETE_PIN
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

  it('moves a job on, a step at a time, as each side photographs its step', async () => {
    const t = convexTest(schema, modules)
    const photo = () => t.run((ctx) => ctx.storage.store(new Blob(['photo'], { type: 'image/jpeg' })))
    const id = await t.mutation(api.workshop.create, { photos: [await photo()] })
    const job = async () => (await t.query(api.workshop.list, {})).find((j) => j.id === id)!
    const steps = async () => (await job()).messages.map((m) => m.step)

    // The shop's photo while the workshop is still to measure moves nothing.
    await t.mutation(api.workshop.send, { jobId: id, from: 'shop', photos: [await photo()] })
    expect(await job()).toMatchObject({ stage: 'measurement', status: 'open' })
    // The workshop cannot do a later step first: a photo named for it is kept, and moves nothing.
    await t.mutation(api.workshop.send, { jobId: id, from: 'workshop', photos: [await photo()], step: 'fitting' })
    expect(await job()).toMatchObject({ stage: 'measurement' })

    // Measured: the job is the shop's, for the work order.
    await t.mutation(api.workshop.send, { jobId: id, from: 'workshop', photos: [await photo()], step: 'measurement' })
    expect(await job()).toMatchObject({ stage: 'quotation', status: 'open' })
    // Another measurement photo afterwards is added to the measurement, and moves nothing.
    await t.mutation(api.workshop.send, { jobId: id, from: 'workshop', photos: [await photo()], step: 'measurement' })
    expect(await job()).toMatchObject({ stage: 'quotation' })
    // A line from the shop is not the work order.
    await t.mutation(api.workshop.send, { jobId: id, from: 'shop', photos: [], text: 'Making it now' })
    expect(await job()).toMatchObject({ stage: 'quotation' })

    // The work order's photo sends it to the workshop to assemble.
    await t.mutation(api.workshop.send, { jobId: id, from: 'shop', photos: [await photo()] })
    expect(await job()).toMatchObject({ stage: 'assemble', status: 'open' })
    await t.mutation(api.workshop.send, { jobId: id, from: 'workshop', photos: [await photo()], step: 'assemble' })
    expect(await job()).toMatchObject({ stage: 'fitting', status: 'open' })
    // Fitted: finished.
    await t.mutation(api.workshop.send, { jobId: id, from: 'workshop', photos: [await photo()], step: 'fitting' })
    expect(await job()).toMatchObject({ stage: 'fitting', status: 'done' })
    expect(await steps()).toEqual([null, null, 'fitting', 'measurement', 'measurement', null, 'quotation', 'assemble', 'fitting'])
  })

  it('refuses a photo that never uploaded', async () => {
    const t = convexTest(schema, modules)
    const real = await t.run((ctx) => ctx.storage.store(new Blob(['x'], { type: 'image/jpeg' })))
    await t.run((ctx) => ctx.storage.delete(real))
    await expect(t.mutation(api.workshop.create, { photos: [real] })).rejects.toThrow('did not upload')
  })
})
