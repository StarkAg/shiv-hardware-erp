/**
 * Finding the customer or supplier a document is about.
 *
 * A bill, a drawer note and a voucher all name the party in free text, and the
 * same person gets typed three ways in a week. Matching exactly is what let
 * "M/S Vishal Prasad Ji" and "M/s Vishal Prasad Ji" become two accounts with
 * half a balance each, so the comparison ignores case and spacing: one shop,
 * one spelling — whichever is already in the books wins.
 */
import type { MutationCtx, QueryCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'

/** The form two spellings of one name have to agree on. */
export const fold = (name: string) => name.trim().toLowerCase().replace(/\s+/g, ' ')

/** The party's account, if the books already have one under any spelling. */
export async function findParty(
  ctx: QueryCtx,
  name: string,
): Promise<Doc<'ledgers'> | null> {
  const wanted = fold(name)
  if (!wanted) return null
  const all = await ctx.db.query('ledgers').collect()
  return all.find((l) => fold(l.name) === wanted) ?? null
}

/**
 * The party's account, opened under `group` if they haven't got one.
 *
 * Throws rather than returning null: a document that cannot name its party has
 * nowhere to post, and saving it half-done is how the books drift.
 */
export async function openParty(
  ctx: MutationCtx,
  name: string,
  opts: { phone?: string; group?: string } = {},
): Promise<Id<'ledgers'>> {
  const clean = name.trim()
  if (!clean) throw new Error('No party name on this document.')

  const existing = await findParty(ctx, clean)
  if (existing) {
    // Fill in a phone we didn't have, but never overwrite one already there:
    // the master is not corrected from whatever an old document happened to
    // carry.
    if (opts.phone && !existing.phone) {
      await ctx.db.patch(existing._id, { phone: opts.phone, updatedAt: Date.now() })
    }
    return existing._id
  }

  const groupName = opts.group ?? 'Sundry Debtors'
  const under = await ctx.db
    .query('groups')
    .filter((q) => q.eq(q.field('name'), groupName))
    .first()
  if (!under) throw new Error(`The "${groupName}" group is missing — set up the account masters first.`)

  const now = Date.now()
  return await ctx.db.insert('ledgers', {
    name: clean,
    groupId: under._id,
    ...(opts.phone ? { phone: opts.phone } : {}),
    openingBalance: 0,
    openingSide: groupName === 'Sundry Creditors' ? ('Cr' as const) : ('Dr' as const),
    openingAsOf: now,
    active: true,
    createdAt: now,
    updatedAt: now,
  })
}
