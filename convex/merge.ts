import { v, ConvexError } from 'convex/values'
import { internalMutation } from './_generated/server'
import type { MutationCtx } from './_generated/server'
import type { Doc } from './_generated/dataModel'
import { round2 } from './lib/money'
import { record } from './lib/history'

/**
 * Two accounts the shop has said are one party, made one.
 *
 * `mergeDuplicateParties` finds duplicates by name on its own; this merges the
 * pairs named — "M/s W/B" into "M/s WB" — because which accounts are the same
 * person is the shop's call, not a spelling rule's.
 *
 * Everything that points at the absorbed account is pointed at the kept one:
 * voucher lines, vouchers, the bin (a deleted voucher and its lines, so a
 * restore lands on an account that exists), statements on file, lessons,
 * scanned bill lines, cash entries, and the bills and binned bills that
 * remember the account. The two opening balances are added together, a
 * phone, place, GSTIN or Aadhaar only the absorbed one had is kept, and the
 * absorbed account is deleted.
 *
 * Accounts on two sides of the books are refused: a customer and a supplier
 * of one name are two accounts on purpose. Run with dryRun first.
 */

const signedOpening = (l: Doc<'ledgers'>) => (l.openingSide === 'Cr' ? -l.openingBalance : l.openingBalance)

async function account(ctx: MutationCtx, ref: string): Promise<Doc<'ledgers'>> {
  const id = ctx.db.normalizeId('ledgers', ref)
  const byId = id ? await ctx.db.get(id) : null
  if (byId) return byId
  const byName = await ctx.db
    .query('ledgers')
    .withIndex('by_name', (q) => q.eq('name', ref))
    .unique()
  if (!byName) throw new ConvexError(`No account "${ref}".`)
  return byName
}

export const accounts = internalMutation({
  args: {
    pairs: v.array(v.object({ keep: v.string(), absorb: v.string() })),
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, { pairs, dryRun }) => {
    const merged: Record<string, unknown>[] = []
    const remap = new Map<string, string>()

    for (const pair of pairs) {
      const keep = await account(ctx, pair.keep)
      const gone = await account(ctx, pair.absorb)
      if (keep._id === gone._id) throw new ConvexError(`"${keep.name}" cannot be merged into itself.`)
      if (keep.groupId !== gone.groupId) {
        throw new ConvexError(`"${keep.name}" and "${gone.name}" are on different sides of the books.`)
      }

      const moved = { entries: 0, vouchers: 0, trash: 0, papers: 0, billLines: 0, cash: 0, lessons: 0 }

      for (const row of await ctx.db.query('voucherEntries').collect()) {
        if (row.ledgerId !== gone._id) continue
        moved.entries++
        if (!dryRun) await ctx.db.patch(row._id, { ledgerId: keep._id })
      }
      for (const row of await ctx.db.query('vouchers').collect()) {
        if (row.partyLedgerId !== gone._id) continue
        moved.vouchers++
        if (!dryRun) await ctx.db.patch(row._id, { partyLedgerId: keep._id })
      }
      for (const row of await ctx.db.query('trash').collect()) {
        const hit = row.partyLedgerId === gone._id || row.entries.some((e) => e.ledgerId === gone._id)
        if (!hit) continue
        moved.trash++
        if (!dryRun) {
          await ctx.db.patch(row._id, {
            partyLedgerId: row.partyLedgerId === gone._id ? keep._id : row.partyLedgerId,
            entries: row.entries.map((e) => (e.ledgerId === gone._id ? { ...e, ledgerId: keep._id } : e)),
          })
        }
      }
      for (const row of await ctx.db.query('papers').collect()) {
        if (row.ledgerId !== gone._id) continue
        moved.papers++
        if (!dryRun) await ctx.db.patch(row._id, { ledgerId: keep._id })
      }
      for (const row of await ctx.db.query('billLines').collect()) {
        if (row.partyLedgerId !== gone._id) continue
        moved.billLines++
        if (!dryRun) await ctx.db.patch(row._id, { partyLedgerId: keep._id })
      }
      for (const row of await ctx.db.query('cashEntries').collect()) {
        if (row.ledgerId !== gone._id) continue
        moved.cash++
        if (!dryRun) await ctx.db.patch(row._id, { ledgerId: keep._id })
      }
      for (const row of await ctx.db.query('lessons').collect()) {
        if (row.ledgerId !== gone._id) continue
        moved.lessons++
        if (!dryRun) await ctx.db.patch(row._id, { ledgerId: keep._id })
      }

      // An opening balance on either is the party's money.
      const opening = round2(signedOpening(keep) + signedOpening(gone))
      merged.push({
        kept: keep.name,
        absorbed: gone.name,
        ...moved,
        opening: `${Math.abs(opening)} ${opening < 0 ? 'Cr' : 'Dr'}`,
      })
      remap.set(gone._id as string, keep._id as string)

      if (dryRun) continue
      await ctx.db.patch(keep._id, {
        openingBalance: Math.abs(opening),
        openingSide: opening < 0 ? ('Cr' as const) : ('Dr' as const),
        ...(!keep.phone && gone.phone ? { phone: gone.phone } : {}),
        ...(!keep.place && gone.place ? { place: gone.place } : {}),
        ...(!keep.gstin && gone.gstin ? { gstin: gone.gstin } : {}),
        ...(!keep.aadhaar && gone.aadhaar ? { aadhaar: gone.aadhaar } : {}),
        updatedAt: Date.now(),
      })
      await ctx.db.delete(gone._id)
    }

    if (!dryRun && remap.size) {
      const now = Date.now()
      // The counter's copy of a bill remembers its account; it follows, stamped
      // newer so a device holding the old copy takes this one.
      const store = await ctx.db.query('billsStore').first()
      if (store) {
        let changed = false
        const bills = (store.bills ?? []).map((b: any) => {
          if (!b?.ledgerId || !remap.has(b.ledgerId)) return b
          changed = true
          return { ...b, ledgerId: remap.get(b.ledgerId), updatedAt: now }
        })
        if (changed) await ctx.db.patch(store._id, { bills, savedAt: now })
      }
      for (const row of await ctx.db.query('billsTrash').collect()) {
        const ledgerId = row.bill?.ledgerId
        if (ledgerId && remap.has(ledgerId)) {
          await ctx.db.patch(row._id, { bill: { ...row.bill, ledgerId: remap.get(ledgerId) } })
        }
      }
      await record(
        ctx,
        'ledger.merge-duplicates',
        `Merged ${merged.map((m) => `${m.absorbed} into ${m.kept}`).join('; ')}`,
        { detail: merged },
      )
    }

    return { dryRun: Boolean(dryRun), merged }
  },
})
