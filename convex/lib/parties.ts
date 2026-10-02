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
import { foldName, properText } from './text'

/**
 * The form two spellings of one name have to agree on.
 *
 * The "M/s" goes too. It is a courtesy the shop writes on firms, not part of
 * anybody's name, and only one of the two ways into the books was adding it —
 * the account form did, a name typed onto a bill did not. So "Pappu Jee,
 * Naisarai" and "M/s Pappu Jee, Naisarai" became two accounts with the balance
 * split between them, which is the whole thing this fold exists to stop.
 */
export const fold = (name: string) => foldName(name)

/**
 * The shop writes a party as "Santosh Singh Ji, Purnimandap" — who they are,
 * then where they are. The books keep those apart, as `name` and `place`, so
 * two Santoshes in two villages stay two accounts and a place can be printed
 * on a bill or left off it.
 *
 * Split on the last comma: a name may well carry one of its own ("Sharma & Co,
 * Prop. Ramesh, Kundru"), and it is the tail that is the village.
 */
export function splitPlace(full: string): { name: string; place?: string } {
  const text = String(full ?? '').trim().replace(/\s+/g, ' ')
  const at = text.lastIndexOf(',')
  if (at < 0) return { name: text }
  const name = text.slice(0, at).trim()
  const place = text.slice(at + 1).trim()
  // "Ramesh," or ", Kundru" is a typo, not a split.
  if (!name || !place) return { name: text }
  return { name, place }
}

/** Every spelling that names this account: the bare name, and name with place. */
const spellingsOf = (l: Doc<'ledgers'>) =>
  l.place ? [fold(l.name), fold(`${l.name}, ${l.place}`)] : [fold(l.name)]

/**
 * The party's account, if the books already have one under any spelling.
 *
 * Written this way so that splitting a name into name and place does not
 * quietly open a second account the next time somebody types the old full
 * spelling: an account answers to both, and to the bare name only when no
 * other account answers to it too. Two Ramesh in two villages must not merge
 * because one of them was typed without a village.
 */
export async function findParty(
  ctx: QueryCtx,
  name: string,
): Promise<Doc<'ledgers'> | null> {
  if (!fold(name)) return null
  return findPartyIn(await ctx.db.query('ledgers').collect(), name)
}

/**
 * findParty against accounts already in hand.
 *
 * For a caller asking about many names at once: reading every account once
 * per name is what ran the cash queue past the read limit.
 */
export function findPartyIn(all: Doc<'ledgers'>[], name: string): Doc<'ledgers'> | null {
  const wanted = fold(name)
  if (!wanted) return null

  const exact = all.filter((l) => spellingsOf(l).includes(wanted))
  if (exact.length === 1) return exact[0]
  // Several answer to it — prefer the one whose full spelling was asked for.
  if (exact.length > 1) {
    return exact.find((l) => l.place && fold(`${l.name}, ${l.place}`) === wanted) ?? exact[0]
  }

  // Asked for "Santosh Singh Ji, Purnimandap" while the books hold the two
  // halves separately, or the other way about.
  const split = splitPlace(name)
  if (split.place) {
    const both = all.find(
      (l) => fold(l.name) === fold(split.name) && fold(l.place ?? '') === fold(split.place!),
    )
    if (both) return both
  }
  return null
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
  // Proper case on the way in, as the account form does it.
  const clean = properText(name)
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
  /**
   * Filed under the whole line as typed — "Santosh Singh Ji, Purnimandap" is
   * one name in this shop's books, not a name and a separate village — and
   * under the same courtesy the account form uses.
   *
   * The form applied "M/s" and this did not, so the same firm ended up with
   * two accounts depending on which door it came in by. One door now.
   */
  // The same test masters.withCourtesy uses, to the character. A looser one
  // here would file "Ms Priya" differently from the account form and open the
  // second account this whole change exists to prevent.
  const courtesy = /^m\/s\b/i.test(clean) ? clean : `M/s ${clean}`
  const filedAs = groupName === 'Sundry Creditors' || groupName === 'Sundry Debtors'
    ? courtesy
    : clean
  return await ctx.db.insert('ledgers', {
    name: filedAs,
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
