import { v } from 'convex/values'
import { internalMutation } from './_generated/server'
import { foldName, properText } from './lib/text'
import { tidyBill } from './lib/billText'
import { tidyCatalog } from './catalog'
import { withCourtesy } from './masters'

/**
 * One pass that brings what is already stored in line with the naming rule.
 *
 *   - account names: proper case, codes in capitals, "M/s" on parties;
 *   - bills: party names, item names and units;
 *   - My Items and the hardware catalogue: names and units;
 *   - quotation customers: proper case, and one record per person where the
 *     same name was saved more than once.
 *
 * Amounts are never touched. Run with dryRun first: it reports every change
 * and writes nothing. Internal, so only `npx convex run` can reach it.
 */
export const everything = internalMutation({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (ctx, { dryRun }) => {
    const now = Date.now()
    const report = {
      ledgers: [] as string[],
      ledgerClashes: [] as string[],
      bills: [] as string[],
      catalog: [] as string[],
      customersRenamed: [] as string[],
      customersMerged: [] as string[],
    }

    // ── Accounts ──────────────────────────────────────────────────────────
    const groups = await ctx.db.query('groups').collect()
    const groupName = new Map(groups.map((g) => [g._id as string, g.name]))
    const ledgers = await ctx.db.query('ledgers').collect()
    const planned = new Map<string, string>()
    for (const l of ledgers) {
      const next = withCourtesy(l.name, groupName.get(l.groupId as string))
      if (next !== l.name) planned.set(l._id as string, next)
    }
    for (const l of ledgers) {
      const next = planned.get(l._id as string)
      if (!next) continue
      // Two accounts must never end up answering to one name.
      const clash = ledgers.find(
        (o) => o._id !== l._id && (planned.get(o._id as string) ?? o.name) === next,
      )
      if (clash) {
        report.ledgerClashes.push(`${l.name} → ${next} (already ${clash.name})`)
        continue
      }
      report.ledgers.push(`${l.name} → ${next}`)
      if (!dryRun) await ctx.db.patch(l._id, { name: next, updatedAt: now })
    }

    // ── Bills ─────────────────────────────────────────────────────────────
    const store = await ctx.db.query('billsStore').first()
    if (store) {
      let changed = 0
      const bills = (store.bills ?? []).map((b: any) => {
        const tidy = tidyBill(b)
        if (JSON.stringify(tidy) === JSON.stringify(b)) return b
        changed++
        const notes: string[] = []
        if (tidy.customerName !== b.customerName) notes.push(`"${b.customerName}" → "${tidy.customerName}"`)
        ;(b.items ?? []).forEach((item: any, i: number) => {
          const after = tidy.items?.[i]
          if (!after) return
          if (after.description !== item.description) notes.push(`"${item.description}" → "${after.description}"`)
          if (after.unit !== item.unit) notes.push(`${item.unit} → ${after.unit}`)
        })
        report.bills.push(`#${b.number}: ${notes.join('; ')}`)
        // Stamped newer, so a device holding the old copy takes this one.
        return { ...tidy, updatedAt: now }
      })
      if (changed && !dryRun) await ctx.db.patch(store._id, { bills, savedAt: now })
    }

    // ── My Items and hardware catalogue ───────────────────────────────────
    const catalog = await ctx.db.query('catalogStore').first()
    if (catalog) {
      const tidy = tidyCatalog({
        hardwareCatalog: catalog.hardwareCatalog,
        customCatalog: catalog.customCatalog ?? [],
        sets: catalog.sets ?? [],
      })
      ;(catalog.customCatalog ?? []).forEach((e: any, i: number) => {
        const after = tidy.customCatalog[i]
        if (!after) return
        if (after.name !== e.name) report.catalog.push(`"${e.name}" → "${after.name}"`)
        if (after.unit !== e.unit) report.catalog.push(`${e.name}: ${e.unit} → ${after.unit}`)
      })
      for (const [key, e] of Object.entries(catalog.hardwareCatalog ?? {})) {
        const after = (tidy.hardwareCatalog as Record<string, any>)[key]
        if ((e as any)?.unit !== after?.unit) report.catalog.push(`${key}: ${(e as any)?.unit} → ${after?.unit}`)
      }
      if (report.catalog.length && !dryRun) {
        await ctx.db.patch(catalog._id, {
          customCatalog: tidy.customCatalog,
          hardwareCatalog: tidy.hardwareCatalog,
          savedAt: now,
        })
      }
    }

    // ── Quotation customers ───────────────────────────────────────────────
    const customers = await ctx.db.query('customers').collect()
    const byPerson = new Map<string, typeof customers>()
    for (const c of customers) {
      const key = foldName(c.name)
      if (!key) continue
      // A different mobile under the same name is a different person.
      const mobiles = new Set(customers.filter((o) => foldName(o.name) === key && o.mobile).map((o) => o.mobile))
      const group = mobiles.size > 1 && c.mobile ? `${key}|${c.mobile}` : key
      byPerson.set(group, [...(byPerson.get(group) ?? []), c])
    }
    for (const same of byPerson.values()) {
      const [keep, ...rest] = [...same].sort((a, b) => b.updatedAt - a.updatedAt)
      const name = properText(keep.name)
      const fill = {
        mobile: keep.mobile ?? rest.find((r) => r.mobile)?.mobile,
        altMobile: keep.altMobile ?? rest.find((r) => r.altMobile)?.altMobile,
        uid: keep.uid ?? rest.find((r) => r.uid)?.uid,
        address: keep.address ?? rest.find((r) => r.address)?.address,
      }
      if (rest.length) {
        report.customersMerged.push(`${name}: ${same.length} records → 1 (${same.map((c) => `"${c.name}"`).join(', ')})`)
      } else if (name !== keep.name) {
        report.customersRenamed.push(`"${keep.name}" → "${name}"`)
      }
      if (dryRun || (!rest.length && name === keep.name)) continue
      await ctx.db.patch(keep._id, {
        name,
        ...Object.fromEntries(Object.entries(fill).filter(([, value]) => value !== undefined)),
        updatedAt: now,
      })
      for (const r of rest) await ctx.db.delete(r._id)
    }

    return { dryRun: !!dryRun, ...report }
  },
})
