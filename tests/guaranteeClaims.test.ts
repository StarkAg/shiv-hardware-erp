/// <reference types="vite/client" />
/**
 * Deciding a guarantee claim in the panel.
 *
 * A refusal is the decision most likely to be questioned later, so it is never
 * stored without its reason (which the customer also reads on the card page).
 * The menu badge counts only claims still waiting on the shop.
 */
import { convexTest } from 'convex-test'
import { describe, expect, it } from 'vitest'
import schema from '../convex/schema'
import { api } from '../convex/_generated/api'

const modules = import.meta.glob('../convex/**/*.ts')

async function withClaim() {
  const t = convexTest(schema, modules)
  const id = await t.run(async (ctx) => {
    const photo = await ctx.storage.store(new Blob(['x'], { type: 'image/jpeg' }))
    const cardId = await ctx.db.insert('guaranteeDocuments', {
      localId: 'GC-2026-0001', number: 'GC-2026-0001', token: 'ABCDEFGHJK', customer: {}, document: { items: [] }, createdAt: 1, updatedAt: 1,
    })
    return ctx.db.insert('guaranteeClaims', {
      ref: 'GC-2026-0001-C1', cardId, number: 'GC-2026-0001', name: 'A Customer', phone: '9876543210', email: 'a@b.in',
      address: 'Main Road, Ramgarh', itemIndex: 0, itemLabel: 'Door', doors: 1, issue: 'borer', description: 'Holes near the bottom.',
      cardPhoto: photo, billPhoto: photo, doorPhoto: photo, photos: [photo], status: 'new', createdAt: 1, updatedAt: 1,
    })
  })
  return { t, id }
}

describe('deciding a claim', () => {
  it('will not record a refusal without its reason', async () => {
    const { t, id } = await withClaim()
    await expect(t.mutation(api.guaranteeClaims.setStatus, { id, status: 'rejected', note: '  ' })).rejects.toThrow(/reason/)
    await t.mutation(api.guaranteeClaims.setStatus, { id, status: 'rejected', note: 'Termite damage, not covered.' })
    const claim = await t.run((ctx) => ctx.db.get(id))
    expect(claim).toMatchObject({ status: 'rejected', note: 'Termite damage, not covered.' })
  })

  it('counts only claims still waiting on the shop', async () => {
    const { t, id } = await withClaim()
    expect(await t.query(api.guaranteeClaims.openCount, {})).toBe(1)
    await t.mutation(api.guaranteeClaims.setStatus, { id, status: 'reviewing' })
    expect(await t.query(api.guaranteeClaims.openCount, {})).toBe(1)
    await t.mutation(api.guaranteeClaims.setStatus, { id, status: 'approved', note: 'Replacement on Monday.' })
    expect(await t.query(api.guaranteeClaims.openCount, {})).toBe(0)
  })
})
