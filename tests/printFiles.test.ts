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
})
