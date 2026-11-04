/**
 * Shiv Print: files shared from a phone go to the shop's print queue, reach
 * the print server as links, and leave storage once printed.
 */
import { describe, expect, test } from 'vitest'
import schema from '../convex/schema'
import { api } from '../convex/_generated/api'
import { convexTest } from './trustedConvex'

const modules = import.meta.glob('../convex/**/*.ts')

async function stored(t: ReturnType<typeof convexTest>, type = 'application/pdf') {
  return t.run((ctx) => ctx.storage.store(new Blob(['%PDF-1.4'], { type })))
}

describe('printing a shared file', () => {
  test('queues it with its colour choice and the device that sent it', async () => {
    const t = convexTest(schema, modules)
    const storageId = await stored(t)
    const id = await t.mutation(api.printJobs.sendFiles, {
      files: [{ storageId, name: 'bill.pdf', mediaType: 'application/pdf' }], mode: 'bw', copies: 2,
    })
    const job = await t.run((ctx) => ctx.db.get(id))
    expect(job).toMatchObject({ kind: 'raw-file', status: 'pending', copies: 2, requestedBy: 'Test counter', payload: { mode: 'bw' } })
  })

  test('refuses what the printer cannot print', async () => {
    const t = convexTest(schema, modules)
    const storageId = await stored(t, 'application/zip')
    await expect(t.mutation(api.printJobs.sendFiles, {
      files: [{ storageId, name: 'a.zip', mediaType: 'application/zip' }], mode: 'bw',
    })).rejects.toThrow('only PDFs and photos')
  })

  test('the print server gets a link to each file, and the file goes once printed', async () => {
    const t = convexTest(schema, modules)
    const storageId = await stored(t, 'image/jpeg')
    const id = await t.mutation(api.printJobs.sendFiles, {
      files: [{ storageId, name: 'photo.jpg', mediaType: 'image/jpeg' }], mode: 'color',
    })
    const [claimed] = await t.mutation(api.printJobs.claimNext, { printerId: 'shop' })
    expect(claimed.payload.files[0].url).toMatch(/^https?:/)
    await t.mutation(api.printJobs.complete, { id, printerId: 'shop' })
    expect(await t.run((ctx) => ctx.db.system.get(storageId))).toBeNull()
    expect((await t.query(api.printJobs.getById, { id }))?.status).toBe('printed')
  })

  test('one upload sent twice is one job', async () => {
    const t = convexTest(schema, modules)
    const storageId = await stored(t, 'image/jpeg')
    const files = [{ storageId, name: 'photo.jpg', mediaType: 'image/jpeg' }]
    const first = await t.mutation(api.printJobs.sendFiles, { files, mode: 'auto' })
    const second = await t.mutation(api.printJobs.sendFiles, { files, mode: 'auto' })
    expect(second).toBe(first)
    const [claimed] = await t.mutation(api.printJobs.claimNext, { printerId: 'shop' })
    await t.mutation(api.printJobs.complete, { id: claimed._id, printerId: 'shop' })
    // The repeat may arrive after the file has printed and gone.
    expect(await t.mutation(api.printJobs.sendFiles, { files, mode: 'auto' })).toBe(first)
  })
})

describe('the Counter app printing a shared photo', () => {
  const app = 'counter-app:test'

  async function photo(t: ReturnType<typeof convexTest>, type = 'image/jpeg') {
    const storageId = await stored(t, type)
    return t.mutation(api.printJobs.sendFiles, { files: [{ storageId, name: 'file', mediaType: type }], mode: 'auto' })
  }

  test('while it is open, the print server leaves a new photo for it', async () => {
    const t = convexTest(schema, modules)
    await t.mutation(api.printJobs.counterAppHere, { printerId: app })
    const id = await photo(t)
    expect(await t.mutation(api.printJobs.claimNext, { printerId: 'shop' })).toEqual([])
    const job = await t.mutation(api.printJobs.claimForApp, { printerId: app })
    expect(job).toMatchObject({ _id: id, kind: 'photos', mode: 'auto' })
    expect(job?.kind === 'photos' && job.files[0].url).toMatch(/^https?:/)
  })

  test('with it shut, the print server takes the photo at once', async () => {
    const t = convexTest(schema, modules)
    const id = await photo(t)
    const [claimed] = await t.mutation(api.printJobs.claimNext, { printerId: 'shop' })
    expect(claimed._id).toBe(id)
  })

  test('a PDF stays with the print server', async () => {
    const t = convexTest(schema, modules)
    await t.mutation(api.printJobs.counterAppHere, { printerId: app })
    const id = await photo(t, 'application/pdf')
    expect(await t.mutation(api.printJobs.claimForApp, { printerId: app })).toBeNull()
    const [claimed] = await t.mutation(api.printJobs.claimNext, { printerId: 'shop' })
    expect(claimed._id).toBe(id)
  })

  test('a photo it hands back goes to the print server and does not come back to it', async () => {
    const t = convexTest(schema, modules)
    await t.mutation(api.printJobs.counterAppHere, { printerId: app })
    const id = await photo(t)
    await t.mutation(api.printJobs.claimForApp, { printerId: app })
    await t.mutation(api.printJobs.releaseToServer, { id, printerId: app })
    expect(await t.mutation(api.printJobs.claimForApp, { printerId: app })).toBeNull()
    const [claimed] = await t.mutation(api.printJobs.claimNext, { printerId: 'shop' })
    expect(claimed._id).toBe(id)
  })
})
