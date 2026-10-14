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
    // A stage sent with a new job, as an older app does, is not used.
    const second = await t.mutation(api.workshop.create, { stage: 'assemble', photos: [await photo()] })
    let jobs = await t.query(api.workshop.list, {})
    expect(jobs.map((j) => j.number).sort()).toEqual([1, 2])
    let job = jobs.find((j) => j.id === first)!
    expect(job).toMatchObject({ title: 'Sanjay Mahto, Korambe', status: 'open', workshopSeenAt: 0 })
    expect(job.messages).toHaveLength(1)
    // The photo that opens a job is the shop's visit order.
    expect(job.messages[0]).toMatchObject({ from: 'shop', step: 'visit', text: '' })
    expect(job.messages[0].photos[0]).toMatchObject({ storageId: order })
    expect(job.messages[0].photos[0].url).toBeTruthy()
    // New to the workshop, not to the shop that sent it.
    const newTo = (j: typeof job, side: 'shop' | 'workshop') =>
      j.messages.filter((m) => m.from !== side && m.at > (side === 'shop' ? j.shopSeenAt : j.workshopSeenAt)).length
    expect([newTo(job, 'workshop'), newTo(job, 'shop')]).toEqual([1, 0])

    // Every job starts at measurement; no step is picked.
    expect(jobs.map((j) => [j.number, j.stage]).sort()).toEqual([[1, 'measurement'], [2, 'measurement']])

    // The workshop opens it, then answers with the measurements.
    await t.mutation(api.workshop.seen, { jobId: first, side: 'workshop' })
    await expect(t.mutation(api.workshop.send, { jobId: first, from: 'workshop', photos: [], text: '   ' })).rejects.toThrow('photo')
    const measured = await photo()
    await t.mutation(api.workshop.send, { jobId: first, from: 'workshop', photos: [measured], text: 'Two doors' })
    job = (await t.query(api.workshop.list, {})).find((j) => j.id === first)!
    // What was typed with it is not kept: nothing in a thread is free text, from either side.
    expect(job.messages.map((m) => [m.from, m.step, m.photos.length, m.text])).toEqual([['shop', 'visit', 1, ''], ['workshop', 'measurement', 1, '']])
    await expect(t.mutation(api.workshop.send, { jobId: first, from: 'workshop', photos: [], text: 'Two doors' })).rejects.toThrow('photo of the measurements')
    await expect(t.mutation(api.workshop.send, { jobId: second, from: 'shop', photos: [], text: 'Call before going' })).rejects.toThrow('Add a photo')
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

  it('moves a job through its steps, each done by the side whose turn it is, with no skipping and no going back', async () => {
    const t = convexTest(schema, modules)
    const photo = () => t.run((ctx) => ctx.storage.store(new Blob(['photo'], { type: 'image/jpeg' })))
    const id = await t.mutation(api.workshop.create, { photos: [await photo()] })
    const job = async () => (await t.query(api.workshop.list, {})).find((j) => j.id === id)!
    const send = (args: Record<string, unknown>) => t.mutation(api.workshop.send, { jobId: id, photos: [], ...args } as never)
    const when = Date.parse('2026-10-14T10:30:00+05:30')

    // 1. Measurement, the workshop's. Until it is measured the shop can add to the visit order.
    await send({ from: 'shop', photos: [await photo()] })
    expect(await job()).toMatchObject({ stage: 'measurement', status: 'open' })
    // Nothing from a later step can be done first: no step is skipped.
    await expect(send({ from: 'workshop', photos: [await photo()], step: 'fitting' })).rejects.toThrow('comes later')
    await expect(send({ from: 'shop', photos: [await photo()], step: 'quotation' })).rejects.toThrow('comes later')
    await expect(send({ from: 'workshop', boards: 2 })).rejects.toThrow('being assembled')
    await expect(send({ from: 'workshop', complete: true })).rejects.toThrow('being assembled')
    await expect(send({ from: 'shop', visitAt: when, callPhone: '8340785465' })).rejects.toThrow('once the work is complete')
    expect(await job()).toMatchObject({ stage: 'measurement' })
    await send({ from: 'workshop', photos: [await photo()], step: 'measurement' })
    expect(await job()).toMatchObject({ stage: 'quotation' })

    // Measured: there is no going back to the measurements or to the visit order.
    await expect(send({ from: 'workshop', photos: [await photo()], step: 'measurement' })).rejects.toThrow('already done')
    await expect(send({ from: 'workshop', photos: [await photo()] })).rejects.toThrow('the shop')
    await expect(send({ from: 'shop', photos: [await photo()], step: 'visit' })).rejects.toThrow('already done')
    expect((await job()).messages).toHaveLength(3)

    // 2. The work order, the shop's, with the boards it asks for.
    await send({ from: 'shop', photos: [await photo()], boards: 8 })
    expect(await job()).toMatchObject({ stage: 'assemble', boardsTotal: 8, boardsMade: null })
    await expect(send({ from: 'shop', photos: [await photo()], step: 'quotation' })).rejects.toThrow('already done')
    await expect(send({ from: 'shop', photos: [await photo()] })).rejects.toThrow('already done')

    // 3. Assembling: the work status as often as wanted, then Complete.
    await send({ from: 'workshop', boards: 3 })
    await send({ from: 'workshop', boards: 6.9 })
    expect(await job()).toMatchObject({ stage: 'assemble', boardsMade: 6 })
    await expect(send({ from: 'workshop', boards: -1 })).rejects.toThrow('number of pieces')
    // A photo of the work in hand is kept as work status; it is Complete that ends the step.
    await send({ from: 'workshop', photos: [await photo()], step: 'assemble' })
    expect(await job()).toMatchObject({ stage: 'assemble' })
    await send({ from: 'workshop', complete: true })
    expect(await job()).toMatchObject({ stage: 'goahead', status: 'open' })
    await expect(send({ from: 'workshop', complete: true })).rejects.toThrow('being assembled')
    await expect(send({ from: 'workshop', boards: 7 })).rejects.toThrow('being assembled')

    // 4. The go-ahead, the shop's: when to go and whom to ring. Both are needed, and it is given once.
    await expect(send({ from: 'shop', visitAt: when, callPhone: '12' })).rejects.toThrow('which number')
    await expect(send({ from: 'shop', visitAt: 0, callPhone: '8340785465' })).rejects.toThrow('when to visit')
    await send({ from: 'shop', visitAt: when, callPhone: '83407 85465' })
    expect(await job()).toMatchObject({ stage: 'fitting', visitAt: when, callPhone: '8340785465' })
    await expect(send({ from: 'shop', visitAt: when + 3600_000, callPhone: '9000000000' })).rejects.toThrow('already given')
    expect(await job()).toMatchObject({ stage: 'fitting', visitAt: when })

    // 5. Fitted: finished, and nothing more is added.
    await send({ from: 'workshop', photos: [await photo()], step: 'fitting' })
    expect(await job()).toMatchObject({ stage: 'fitting', status: 'done' })
    await expect(send({ from: 'workshop', photos: [await photo()], step: 'fitting' })).rejects.toThrow('finished')
    await expect(send({ from: 'shop', photos: [await photo()] })).rejects.toThrow('finished')
    expect((await job()).messages.map((m) => [m.step, m.boards, m.complete, m.visitAt ? 'visit' : null])).toEqual([
      ['visit', null, false, null], ['visit', null, false, null],
      ['measurement', null, false, null],
      ['quotation', 8, false, null],
      ['assemble', 3, false, null], ['assemble', 6, false, null], ['assemble', null, false, null], ['assemble', null, true, null],
      ['goahead', null, false, 'visit'],
      ['fitting', null, false, null],
    ])
  })

  it('orders in what is not to be assembled, and with both waits for Complete and Arrived', async () => {
    const t = convexTest(schema, modules)
    const photo = () => t.run((ctx) => ctx.storage.store(new Blob(['photo'], { type: 'image/jpeg' })))
    const when = Date.parse('2026-10-14T10:30:00+05:30')
    const toWorkOrder = async () => {
      const id = await t.mutation(api.workshop.create, { photos: [await photo()] })
      await t.mutation(api.workshop.send, { jobId: id, from: 'workshop', photos: [await photo()], step: 'measurement' })
      return id
    }
    const job = async (id: string) => (await t.query(api.workshop.list, {})).find((j) => j.id === id)!
    const send = (id: string, args: Record<string, unknown>) => t.mutation(api.workshop.send, { jobId: id, photos: [], ...args } as never)

    // A work order asks for something: neither ticked is refused.
    const order = await toWorkOrder()
    await expect(send(order, { from: 'shop', photos: [await photo()], assemble: false, order: false })).rejects.toThrow('Tick')
    expect(await job(order)).toMatchObject({ stage: 'quotation' })

    // Only ordered in: nothing for the workshop to assemble, the shop says Arrived and the go-ahead is next.
    await send(order, { from: 'shop', photos: [await photo()], assemble: false, order: true })
    expect(await job(order)).toMatchObject({ stage: 'assemble', needsAssemble: false, needsOrder: true, arrived: false })
    await expect(send(order, { from: 'workshop', boards: 2 })).rejects.toThrow('being assembled')
    await expect(send(order, { from: 'workshop', complete: true })).rejects.toThrow('being assembled')
    await expect(send(order, { from: 'workshop', photos: [await photo()], step: 'assemble' })).rejects.toThrow('not to be assembled')
    await expect(send(order, { from: 'shop', visitAt: when, callPhone: '8340785465' })).rejects.toThrow('once the work is complete')
    // Arrived, with the challan's photo.
    await send(order, { from: 'shop', photos: [await photo()], arrived: true })
    expect(await job(order)).toMatchObject({ stage: 'goahead', arrived: true })
    await expect(send(order, { from: 'shop', arrived: true })).rejects.toThrow('Nothing is being ordered')
    expect((await job(order)).messages.slice(-2).map((m) => [m.step, m.assemble, m.order, m.arrived, m.photos.length])).toEqual([
      ['quotation', false, true, false, 1], ['arrived', null, null, true, 1],
    ])

    // Both, side by side: Complete first waits for Arrived.
    const both = await toWorkOrder()
    await send(both, { from: 'shop', photos: [await photo()], boards: 4, assemble: true, order: true })
    expect(await job(both)).toMatchObject({ stage: 'assemble', needsAssemble: true, needsOrder: true })
    await send(both, { from: 'workshop', boards: 4 })
    await send(both, { from: 'workshop', complete: true })
    expect(await job(both)).toMatchObject({ stage: 'assemble', assembled: true, arrived: false })
    await expect(send(both, { from: 'workshop', complete: true })).rejects.toThrow('already complete')
    await expect(send(both, { from: 'workshop', boards: 5 })).rejects.toThrow('being assembled')
    await send(both, { from: 'shop', arrived: true })
    expect(await job(both)).toMatchObject({ stage: 'goahead' })

    // And Arrived first waits for Complete.
    const other = await toWorkOrder()
    await send(other, { from: 'shop', photos: [await photo()], assemble: true, order: true })
    await send(other, { from: 'shop', arrived: true })
    expect(await job(other)).toMatchObject({ stage: 'assemble', arrived: true, assembled: false })
    await send(other, { from: 'workshop', complete: true })
    expect(await job(other)).toMatchObject({ stage: 'goahead' })

    // A work order sent by an app from before the ticks is to be assembled.
    const old = await toWorkOrder()
    await send(old, { from: 'shop', photos: [await photo()], boards: 2 })
    expect(await job(old)).toMatchObject({ stage: 'assemble', needsAssemble: true, needsOrder: false })

    // The ticks changed while assembling: a part to order after all, then
    // assembling found not needed once it has arrived, which moves it on.
    await t.mutation(api.workshop.setNeeds, { jobId: old, assemble: true, order: true })
    expect(await job(old)).toMatchObject({ stage: 'assemble', needsOrder: true })
    await expect(t.mutation(api.workshop.setNeeds, { jobId: old, assemble: false, order: false })).rejects.toThrow('Tick')
    await send(old, { from: 'shop', arrived: true })
    expect(await job(old)).toMatchObject({ stage: 'assemble' })
    await t.mutation(api.workshop.setNeeds, { jobId: old, assemble: false, order: true })
    expect(await job(old)).toMatchObject({ stage: 'goahead' })
    await expect(t.mutation(api.workshop.setNeeds, { jobId: old, assemble: true, order: true })).rejects.toThrow('only while')
  })

  it('refuses a photo that never uploaded', async () => {
    const t = convexTest(schema, modules)
    const real = await t.run((ctx) => ctx.storage.store(new Blob(['x'], { type: 'image/jpeg' })))
    await t.run((ctx) => ctx.storage.delete(real))
    await expect(t.mutation(api.workshop.create, { photos: [real] })).rejects.toThrow('did not upload')
  })
})
