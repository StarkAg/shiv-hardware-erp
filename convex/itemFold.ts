import { v } from 'convex/values'
import { internalMutation } from './_generated/server'
import { record } from './lib/history'
import { readBills, writeBills } from './lib/billRows'

/**
 * One item, one entry — by folding the supplier's name into the shop's.
 *
 * The same board is in My Items twice: once as the shop sells it ("12mm SG
 * 8 X 4") and once as SRT bills it ("12mm S 8 X 4"). Two entries means two
 * items, and nothing can tell that what went out was what came in.
 *
 * A customer's bill keeps the name the customer was given — that is not ours
 * to change. A supplier's is: the paper from SRT says what it says whatever
 * the panel calls the line. So the supplier's entry is folded into the shop's,
 * the purchases that used it are re-pointed and renamed, and the supplier's
 * wording is kept on the surviving entry as a spelling that still finds it —
 * so whoever enters the next SRT bill can type what is printed on it.
 *
 * Which entries are one item is not worked out here. Names are not evidence,
 * and a rule that read them would be one person's guess about this shop's
 * goods buried in code. The pairs are handed in, having been looked at.
 *
 * Internal, so only `npx convex run` reaches it. Run with dryRun first: it
 * reports every change and writes nothing. Amounts are never touched.
 */
export const merge = internalMutation({
  args: {
    pairs: v.array(v.object({ keep: v.string(), absorb: v.string() })),
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, { pairs, dryRun }) => {
    const report = {
      merged: [] as string[],
      refused: [] as string[],
      billsChanged: [] as string[],
      linesChanged: 0,
    }

    const store = await ctx.db.query('catalogStore').first()
    if (!store) throw new Error('There is no catalogue to fold.')
    const catalog = [...((store.customCatalog ?? []) as any[])]
    const byId = new Map(catalog.filter((e) => e?.id).map((e) => [String(e.id), e]))
    const bills = await readBills(ctx)

    /**
     * Which entries a customer has been given a bill for.
     *
     * An entry named on a sale or a return is the customer's name for the
     * goods, and folding it away would rewrite a bill someone is holding. The
     * fold goes the other way only, and this is what enforces it.
     */
    const onCustomerBills = new Set<string>()
    for (const bill of bills) {
      const kind = bill?.kind ?? 'sale'
      if (kind !== 'sale' && kind !== 'return') continue
      for (const item of bill.items ?? []) {
        if (item?.customEntryId) onCustomerBills.add(String(item.customEntryId))
      }
    }

    const union = <T,>(a?: T[], b?: T[]) => Array.from(new Set([...(a ?? []), ...(b ?? [])]))
    const rename = new Map<string, { id: string; name: string }>()

    for (const { keep, absorb } of pairs) {
      const into = byId.get(keep)
      const gone = byId.get(absorb)
      if (!into) { report.refused.push(`${absorb}: nothing kept by the id ${keep}`); continue }
      if (!gone) { report.refused.push(`${absorb}: no such entry`); continue }
      if (keep === absorb) { report.refused.push(`${keep}: already itself`); continue }
      if (onCustomerBills.has(absorb)) {
        report.refused.push(`${gone.name}: a customer has a bill naming it`)
        continue
      }

      // The shop's entry keeps its id, its name and the rate a fresh line
      // starts at. It takes the supplier's sizes, brands and rates, so the
      // rate actually paid is still there to be picked on the next purchase,
      // and the supplier's wording as a spelling that finds it.
      const next = {
        ...into,
        sizes: union(into.sizes, gone.sizes),
        brands: union(into.brands, gone.brands),
        rates: union(into.rates, gone.rates),
        alsoKnownAs: union(union(into.alsoKnownAs, gone.alsoKnownAs), [gone.name]).filter(
          (n: string) => n && n !== into.name,
        ),
      }
      if (gone.rate !== undefined && !next.rates.includes(gone.rate)) next.rates.push(gone.rate)
      byId.set(keep, next)
      byId.delete(absorb)
      rename.set(absorb, { id: keep, name: String(into.name) })
      report.merged.push(`${gone.name} → ${into.name}`)
    }

    // The purchases and deliveries that named the folded entry.
    const touched: any[] = []
    for (const bill of bills) {
      const kind = bill?.kind ?? 'sale'
      if (kind === 'sale' || kind === 'return') continue
      let changed = false
      const items = (bill.items ?? []).map((item: any) => {
        const to = item?.customEntryId ? rename.get(String(item.customEntryId)) : undefined
        if (!to) return item
        changed = true
        report.linesChanged += 1
        return { ...item, customEntryId: to.id, description: to.name }
      })
      if (!changed) continue
      report.billsChanged.push(`${kind} ${bill.number}`)
      touched.push({ ...bill, items, updatedAt: Date.now() })
    }

    if (!dryRun) {
      const order = new Map(catalog.map((e, i) => [String(e?.id), i]))
      const customCatalog = [...byId.values()].sort(
        (a, b) => (order.get(String(a.id)) ?? 0) - (order.get(String(b.id)) ?? 0),
      )
      await ctx.db.patch(store._id, { customCatalog, savedAt: Date.now(), version: (store.version ?? 0) + 1 })
      if (touched.length) await writeBills(ctx, touched)
      await record(
        ctx,
        'itemFold.merge',
        `${report.merged.length} supplier items folded into the shop's own, ${report.linesChanged} purchase lines renamed`,
      )
    }

    return { dryRun: !!dryRun, ...report }
  },
})
